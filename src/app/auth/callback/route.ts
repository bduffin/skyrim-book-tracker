import { NextResponse } from 'next/server';
import { authErrorPath } from '@/features/auth/auth-error-message';
import { isSafeReturnPath } from '@/features/auth/return-path';
import { pathAfterSignIn } from '@/features/profile/data';
import { createClient } from '@/lib/supabase/server';

/** Enough of a logged value to diagnose from, without letting one flood logs. */
const LOG_LIMIT = 500;

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');

    // Vercel deployments sit behind a proxy, so `origin` can be internal in
    // production -- prefer x-forwarded-host there, which Vercel sets to the
    // host the reader asked for. Used for failures as well as success, so
    // both land on the same site.
    const forwardedHost = request.headers.get('x-forwarded-host');
    const isLocalEnv = process.env.NODE_ENV === 'development';
    const base =
        !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;

    // Only ever redirect to a safe relative path: an unvalidated `next` from
    // the query string is an open-redirect vector, and anyone can write a
    // callback URL, so this cannot rely on signInWithGitHub having checked it
    // on the way out. Same rule as there (`isSafeReturnPath`).
    const requested = searchParams.get('next');
    const next =
        requested !== null && isSafeReturnPath(requested) ? requested : '/';

    if (code) {
        const supabase = await createClient();
        const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            // A first sign-in goes through setup on its way to `next`
            // (Profiles FR-4).
            const path = await pathAfterSignIn(data.user.id, next);
            return NextResponse.redirect(`${base}${path}`);
        }

        console.error('Failed to exchange the sign-in code:', error);
        return NextResponse.redirect(
            `${base}${authErrorPath({ errorCode: error.code })}`,
        );
    }

    // No code: Supabase sends a failed sign-in -- including Cancel on
    // GitHub's consent screen -- back here with the error on the query.
    // Only the codes travel on; the description is logged here, because the
    // error page never receives it (`authErrorPath`). Logged as an object
    // rather than bare strings because the values are attacker-controlled,
    // and Node quotes and escapes strings inside an object, so embedded
    // newlines cannot forge extra log lines.
    const error = searchParams.get('error');
    const errorCode = searchParams.get('error_code');
    const errorDescription = searchParams.get('error_description');
    console.warn('Sign-in returned an error', {
        error: error?.slice(0, LOG_LIMIT),
        errorCode: errorCode?.slice(0, LOG_LIMIT),
        errorDescription: errorDescription?.slice(0, LOG_LIMIT),
    });
    return NextResponse.redirect(
        `${base}${authErrorPath({ error, errorCode })}`,
    );
}

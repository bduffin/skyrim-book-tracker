import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authErrorPath } from '@/features/auth/auth-error-message';
import { publicOrigin } from '@/features/auth/public-origin';
import { loginNext } from '@/features/auth/return-path';
import { clearCodeVerifierCookies } from '@/features/auth/sign-in-cookies';
import { pathAfterSignIn } from '@/features/profile/data';
import { createClient } from '@/lib/supabase/server';

/** Enough of a logged value to diagnose from, without letting one flood logs. */
const LOG_LIMIT = 500;

/**
 * GitHub's return from sign-in, success or failure. Whatever the outcome, the
 * round trip it started is over, so its code-verifier cookies are cleared
 * afterwards (`clearCodeVerifierCookies`) -- in a `finally`, so no path through
 * the handler can skip it, and only after the code exchange has read them.
 */
export async function GET(request: Request) {
    try {
        return await handleCallback(request);
    } finally {
        clearCodeVerifierCookies(await cookies());
    }
}

async function handleCallback(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');

    // Used for failures as well as success, so both land on the same site.
    // The request's own origin is a last resort only: behind Vercel's proxy
    // it can be internal.
    const base = publicOrigin(request.headers) ?? origin;

    // Only ever redirect to a safe relative path: an unvalidated `next` from
    // the query string is an open-redirect vector, and anyone can write a
    // callback URL, so this cannot rely on signInWithGitHub having checked it
    // on the way out. Same rule as there (`loginNext`).
    const next = loginNext(searchParams.get('next'));

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

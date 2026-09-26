import { NextResponse } from 'next/server';
import { isSafeReturnPath } from '@/features/auth/return-path';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');

    // Only ever redirect to a safe relative path: an unvalidated `next` from
    // the query string is an open-redirect vector, and anyone can write a
    // callback URL, so this cannot rely on signInWithGitHub having checked it
    // on the way out. Same rule as there (`isSafeReturnPath`).
    const requested = searchParams.get('next');
    const next =
        requested !== null && isSafeReturnPath(requested) ? requested : '/';

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            // Vercel deployments sit behind a proxy, so `origin` can be
            // internal in production — prefer x-forwarded-host there.
            const forwardedHost = request.headers.get('x-forwarded-host');
            const isLocalEnv = process.env.NODE_ENV === 'development';
            if (isLocalEnv) {
                return NextResponse.redirect(`${origin}${next}`);
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`);
            } else {
                return NextResponse.redirect(`${origin}${next}`);
            }
        }
    }

    // Something went wrong — send them to an error page (or back to home).
    return NextResponse.redirect(`${origin}/auth/auth-error`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { BOOKS_PATH } from '@/features/books/scope';
import { createClient } from '@/lib/supabase/server';

import {
    AUTH_ERROR_PATH,
    authErrorPath,
    SIGN_OUT_FAILED_CODE,
} from './auth-error-message';
import { signInNext } from './return-path';

/**
 * Starts GitHub sign-in from a `<form>`, so it works with JavaScript disabled.
 *
 * The server client's `signInWithOAuth` does not navigate anywhere: it stores
 * the PKCE code verifier in a cookie -- which a Server Action may set -- and
 * returns the Supabase project's `/auth/v1/authorize` URL, which this
 * redirects to. From there the flow is unchanged: Supabase sends the reader on
 * to GitHub, GitHub back to Supabase, and Supabase to `/auth/callback`, which
 * exchanges the code using that cookie.
 *
 * `redirectTo` is built from the request's `Origin` header rather than an
 * environment variable, so localhost, previews and production each come back
 * to themselves. It is safe to trust here: Next rejects a Server Action whose
 * `Origin` does not match its host, and Supabase checks the result against its
 * Redirect URLs allow-list regardless.
 */
export async function signInWithGitHub(formData: FormData): Promise<void> {
    const requestHeaders = await headers();
    const origin = requestHeaders.get('origin');
    if (origin === null) redirect(AUTH_ERROR_PATH);

    const next = signInNext({
        formData,
        referer: requestHeaders.get('referer'),
        origin,
    });

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
            redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
    });

    if (error || !data.url) {
        console.error('Failed to start GitHub sign-in:', error);
        // Only the code travels: the error page maps it to fixed,
        // app-written copy and never renders free text from its URL.
        redirect(authErrorPath({ errorCode: error?.code }));
    }

    // Outside any try/catch: redirect() works by throwing.
    redirect(data.url);
}

/**
 * Signs the reader out of this browser only, from a `<form>`, so it works
 * with JavaScript disabled.
 *
 * `scope: 'local'` is deliberate. Supabase's default is `'global'`, which
 * revokes the user's sessions across all devices. A "sign out everywhere"
 * control, if needed, should be separate.
 *
 * A failure is not hidden, because it can leave either side signed in. From
 * `_signOut` in @supabase/auth-js: when the logout API call fails, the library
 * still deletes this browser's session cookies, but the server-side session
 * -- and its refresh token -- survives, so a copy of the cookies taken
 * earlier could keep minting access tokens. And when the session cannot be
 * read at all, nothing is deleted and the reader is still signed in. Either
 * way the reader goes to the auth error page, which says so in fixed wording,
 * rather than to /books as if all were well.
 *
 * Even a successful sign-out does not cut short an access token already
 * issued: `getClaims()` verifies the JWT locally, without asking whether its
 * session still exists, so a copied token works until it expires (the
 * project's JWT expiry, an hour by default).
 */
export async function signOut(): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });

    // Every cached render was built for a signed-in reader -- the header, the
    // row toggles, their collection -- so drop them all, not just one path.
    revalidatePath('/', 'layout');

    if (error) {
        console.error('Sign-out did not complete:', error);
        redirect(authErrorPath({ errorCode: SIGN_OUT_FAILED_CODE }));
    }
    // Straight to the catalog: the collection page would bounce a signed-out
    // reader there anyway.
    redirect(BOOKS_PATH);
}

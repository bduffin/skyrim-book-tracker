'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { returnPathFrom } from './return-path';

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
export async function signInWithGitHub(): Promise<void> {
    const requestHeaders = await headers();
    const origin = requestHeaders.get('origin');
    if (origin === null) redirect('/auth/auth-error');

    const next = returnPathFrom(requestHeaders.get('referer'), origin);

    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
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
        const code = error?.code
            ? `?error_code=${encodeURIComponent(error.code)}`
            : '';
        redirect(`/auth/auth-error${code}`);
    }

    // Outside any try/catch: redirect() works by throwing.
    redirect(data.url);
}

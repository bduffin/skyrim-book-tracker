import { createClient } from '@supabase/supabase-js';

/**
 * A server-side client with no session and no cookies, for an Auth call that
 * needs neither: sending an emailed sign-in code (`send-code`).
 *
 * Not `server.ts`'s client, because `@supabase/ssr` forces the PKCE flow, and
 * a PKCE `signInWithOtp` writes code-verifier cookies -- with a 400-day
 * lifetime -- and an `auth.flow_state` row, neither of which an emailed code
 * ever uses: `verifyOtp` checks the code alone. Here the flow is implicit and
 * nothing is persisted, so sending a code leaves nothing behind in the
 * browser, and no cookie that another tab's GitHub sign-in depends on is
 * touched.
 *
 * Checking the code still goes through `server.ts`'s client, which is what
 * writes the session cookies.
 */
export function createStatelessClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
            auth: {
                flowType: 'implicit',
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        },
    );
}

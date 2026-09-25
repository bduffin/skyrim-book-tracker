import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in viewer's user id (the JWT's `sub`), or `null` when signed out.
 *
 * `getClaims()` verifies the JWT locally against the project's published keys,
 * so the id is safe to use for authorization without a network round trip.
 * Not `getSession()`: on the server that reads the session out of the cookie
 * without verifying it, so anything it returns could have been forged.
 *
 * A failure reads as signed out rather than throwing, matching `SiteHeader`:
 * the header already degrades that way on the same failure, and a page that
 * showed the signed-in view under a signed-out header would disagree with
 * itself.
 */
export async function getViewerId(): Promise<string | null> {
    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
    const supabase = await createClient();

    try {
        const { data } = await supabase.auth.getClaims();
        return data?.claims.sub ?? null;
    } catch (error) {
        console.error('Unable to determine auth state:', error);
        return null;
    }
}

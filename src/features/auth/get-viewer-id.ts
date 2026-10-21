import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * The signed-in viewer's verified JWT claims, or `null` when signed out.
 *
 * `getClaims()` verifies the JWT locally against the project's published keys,
 * so the claims are safe to use for authorization without a network round
 * trip. Not `getSession()`: on the server that reads the session out of the
 * cookie without verifying it, so anything it returns could have been forged.
 *
 * A failure -- `getClaims()` can throw, on a network failure fetching the
 * keys, rather than return an error -- reads as signed out rather than
 * throwing. The header renders from the root layout, outside every route's
 * error boundary, so throwing there would take down the whole app, and a page
 * that showed the signed-in view under a signed-out header would disagree
 * with itself.
 *
 * Wrapped in React's `cache`, which is scoped to one server request, so the
 * header and the page share one verification. The client is still created
 * inside the call, per request, never at module scope.
 */
export const getViewerClaims = cache(async () => {
    const supabase = await createClient();

    try {
        const { data } = await supabase.auth.getClaims();
        return data?.claims ?? null;
    } catch (error) {
        console.error('Unable to determine auth state:', error);
        return null;
    }
});

/** The signed-in viewer's user id (the JWT's `sub`), or `null`. */
export async function getViewerId(): Promise<string | null> {
    return (await getViewerClaims())?.sub ?? null;
}

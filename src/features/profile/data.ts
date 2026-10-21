import 'server-only';

import { unstable_rethrow } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { pathAfterProfileCheck } from './profile-input';

/** What a profile row holds, as the app reads it. */
export type Profile = {
    isPublic: boolean;
    username: string | null;
};

/**
 * A profile lookup's outcome. A failure is its own case, never `none`: "has
 * not chosen" and "could not tell" lead different places -- read as `none`,
 * a database hiccup would send every sign-in through setup (Profiles FR-4),
 * and `/settings` would offer the defaults to a user who had chosen private.
 */
export type ProfileLookup =
    | { status: 'found'; profile: Profile }
    | { status: 'none' }
    | { status: 'error' };

/**
 * `userId`'s profile row, as the caller is allowed to see it.
 *
 * RLS, not this function, decides whether a private row is visible, so a
 * private user looked up by anyone else is `none`, exactly as a user with no
 * row is (Profiles NFR-5). The query still names its user rather than relying
 * on RLS to narrow it: public rows are readable by everyone.
 */
export async function getProfile(userId: string): Promise<ProfileLookup> {
    // A thrown failure becomes `error` as well as a returned one, so callers
    // only ever handle the three outcomes -- in particular /auth/callback,
    // which must send a user on to `next` however the check failed
    // (Profiles FR-4) rather than fail after the session is already set.
    let result;
    try {
        const supabase = await createClient();
        result = await supabase
            .from('profile')
            .select('is_public, username')
            .eq('user_id', userId)
            .maybeSingle();
    } catch (error) {
        // Next's own control-flow errors -- `cookies()` marking a render as
        // dynamic, say -- are not failures, and must reach Next.
        unstable_rethrow(error);
        console.error('Failed to load profile:', error);
        return { status: 'error' };
    }

    const { data, error } = result;
    if (error) {
        console.error('Failed to load profile:', error);
        return { status: 'error' };
    }
    if (data === null) return { status: 'none' };

    return {
        status: 'found',
        profile: { isPublic: data.is_public, username: data.username },
    };
}

/**
 * Where a successful sign-in should land (Profiles FR-4): `/settings` with
 * `next` when the user has no profile row yet, otherwise `next`.
 *
 * Every sign-in path calls this once the session exists: `/auth/callback`
 * today, and email sign-in's verify step later. It returns the path rather
 * than redirecting, so a Route Handler (`NextResponse.redirect`) and a Server
 * Action (`redirect()`) can both use it.
 *
 * The lookup runs as the signed-in user, so the caller must have established
 * the session first. The same request is enough: in a Route Handler or Server
 * Action, `cookies()` is one mutable store seeded from the request, so the
 * cookies the code exchange sets are what this lookup's client reads. Run as
 * `anon` instead, a private user's row would be invisible, and every one of
 * their sign-ins would land on setup.
 *
 * `next` must already have passed `isSafeReturnPath`.
 */
export async function pathAfterSignIn(
    userId: string,
    next: string,
): Promise<string> {
    const lookup = await getProfile(userId);
    return pathAfterProfileCheck(lookup.status, next);
}

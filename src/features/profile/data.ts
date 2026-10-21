import 'server-only';

import { createClient } from '@/lib/supabase/server';

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
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('profile')
        .select('is_public, username')
        .eq('user_id', userId)
        .maybeSingle();
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

/**
 * The signed-in reader's avatar, if one can be trusted, and the initial shown
 * when not. Pure, so it is unit-tested and `next.config.ts` can import the
 * host from it.
 */

import { signedInWithGitHub, type AccountClaims } from './github-claims';

/**
 * Where an avatar may be loaded from: GitHub's avatar CDN, under its
 * user-avatar paths (`/u/<id>`), which is what GitHub sign-in supplies.
 *
 * `next.config.ts` builds its `next/image` allow-list from these same two
 * constants, and they must stay one source: a URL this module accepts but the
 * allow-list does not is not merely a missing picture -- `next/image` throws
 * while rendering and the page fails with a 500.
 */
export const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com';
export const GITHUB_AVATAR_PATH_PREFIX = '/u/';

/**
 * The avatar URL from the session's `user_metadata`, or `null` to show the
 * initial instead.
 *
 * Only for an account GitHub signs in, by the same rule as the header's name
 * (`signedInWithGitHub`): a sign-up can plant an `avatar_url` in GitHub's
 * exact shape -- someone else's picture -- as easily as a name. The rule is
 * here rather than in the header so that no caller can skip it.
 *
 * Checked, never passed through: `user_metadata` is editable by the user
 * themselves (`supabase.auth.updateUser({ data })`), so `avatar_url` can hold
 * any string. Only the exact shape GitHub sign-in supplies is accepted --
 * HTTPS, GitHub's avatar host, `/u/<numeric id>` -- and the URL is then
 * *rebuilt* from the id rather than passed through, so nothing the user wrote
 * reaches the page and what does is guaranteed to match `next.config.ts`'s
 * allow-list. Anything else would fail that allow-list, and `next/image`
 * throws rather than falling back, so the page would fail with a 500.
 */
export function avatarUrlFor(claims: AccountClaims): string | null {
    if (!signedInWithGitHub(claims)) return null;

    const raw = claims.user_metadata?.avatar_url;
    if (typeof raw !== 'string') return null;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    if (url.protocol !== 'https:' || url.hostname !== GITHUB_AVATAR_HOST) {
        return null;
    }

    const id = url.pathname.slice(GITHUB_AVATAR_PATH_PREFIX.length);
    if (
        !url.pathname.startsWith(GITHUB_AVATAR_PATH_PREFIX) ||
        !/^\d+$/.test(id)
    ) {
        return null;
    }

    return `https://${GITHUB_AVATAR_HOST}${GITHUB_AVATAR_PATH_PREFIX}${id}`;
}

/**
 * The fallback's letter: the name's first character, upper-cased.
 * By code point, not by UTF-16 unit, so a name starting with an emoji or an
 * astral-plane letter is not cut in half.
 *
 * `null` with no name (`headerNameFor`), for the badge's person icon: the
 * initial of the "Signed in" shown in its place would read as a name.
 */
export function initialFor(name: string | null): string | null {
    if (name === null) return null;
    const [first] = Array.from(name.trim());
    return first ? first.toUpperCase() : '?';
}

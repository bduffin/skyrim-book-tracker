import { signedInWithGitHub, type AccountClaims } from './github-claims';

/**
 * The name the header shows (Email FR-8): GitHub's, and only when GitHub
 * supplied it (`signedInWithGitHub` says why).
 *
 * Never the email address either: its part before the `@` is often a real
 * name, and the header is on every page and in every screenshot.
 *
 * Pure and dependency-free so node:test can import it (architecture.md
 * section 11).
 */

/** What is shown in place of a name when there is none to show. */
export const NAMELESS_LABEL = 'Signed in';

/**
 * GitHub's `user_name` when GitHub is one of the account's providers and the
 * value is a non-empty string, otherwise `null`: the header then shows
 * `NAMELESS_LABEL` beside a plain badge. Profiles M2 puts the profile's
 * username ahead of this (Profiles FR-7).
 */
export function headerNameFor(claims: AccountClaims): string | null {
    if (!signedInWithGitHub(claims)) return null;
    const userName = claims.user_metadata?.user_name;
    return typeof userName === 'string' && userName.trim() !== ''
        ? userName
        : null;
}

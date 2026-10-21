/**
 * Whether the session's account signs in with GitHub, the condition for
 * trusting anything in `user_metadata` as GitHub's (Email FR-8).
 *
 * Everything in `user_metadata` is written by whoever made the account or
 * holds its session. A sign-up through Supabase's API stores whatever
 * metadata the caller sends, and on the email path that survives the owner
 * confirming the address later (Email spec, Current State), so an attacker
 * who pre-registers someone's address could choose the name and picture
 * their header shows. `app_metadata` is written by Supabase alone, so its
 * `providers` says reliably whether GitHub signed this account in.
 *
 * And once it has, GitHub's own values are the ones stored. In Supabase
 * Auth's source (v2.195.0, `internal/api/external.go`), linking GitHub to an
 * existing account and every later GitHub sign-in both call
 * `UpdateUserMetaData` with GitHub's identity data, which overwrites each key
 * it carries (`internal/models/user.go`) -- `user_name` and `avatar_url`
 * among them -- while leaving other keys alone. So a planted `user_name` or
 * `avatar_url` does not survive the account's first GitHub sign-in; any other
 * planted key does, which is why nothing reads one.
 *
 * Pure and dependency-free so node:test and `next.config.ts` can import it
 * (architecture.md section 11).
 */

/** The parts of the session's JWT claims that say who signed in. */
export type AccountClaims = {
    app_metadata?: { providers?: unknown };
    user_metadata?: Record<string, unknown>;
};

export function signedInWithGitHub(claims: AccountClaims): boolean {
    const providers = claims.app_metadata?.providers;
    return Array.isArray(providers) && providers.includes('github');
}

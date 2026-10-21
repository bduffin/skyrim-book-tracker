/**
 * Supabase's PKCE code-verifier cookies, which outlive a GitHub sign-in.
 *
 * `signInWithOAuth` through the server client sets them with a 400-day
 * lifetime: `sb-<ref>-auth-token-code-verifier`, `-flows-code-verifier`, and
 * one `-flow-<id>-code-verifier` per attempt. The code exchange clears only its
 * own flow's, and an attempt abandoned partway clears nothing, so the privacy
 * notice's "short-lived cookies used during sign-in itself" holds only because
 * `/auth/callback` clears them all once GitHub sends the reader back. Sign-out
 * clears them too (auth-js's `removeAllPKCEVerifiers`). Email sign-in never
 * sets them: it sends codes from a client with no cookies
 * (`createStatelessClient`).
 *
 * Clearing them all, not only the finished flow's, is a deliberate trade: a
 * second GitHub sign-in started in another tab before the first returns fails
 * once and works when retried, which is cheaper than leaving another
 * attempt's cookies for 400 days.
 *
 * Pure apart from the store it is handed, so node:test can import it
 * (architecture.md section 11).
 */

/**
 * Whether a cookie is one of the code-verifier cookies. Never the session
 * cookie itself, `sb-<ref>-auth-token` and its numbered chunks.
 */
export function isCodeVerifierCookie(name: string): boolean {
    return /^sb-.+-auth-token(-.+)?-code-verifier$/.test(name);
}

/**
 * Deletes every code-verifier cookie the request carried, through the
 * request's own `cookies()` store, so the deletions reach the response it
 * returns. Call it only once the sign-in that set them is over.
 */
export function clearCodeVerifierCookies(store: {
    getAll(): { name: string }[];
    delete(options: { name: string; path: string }): unknown;
}): void {
    for (const { name } of store.getAll()) {
        if (isCodeVerifierCookie(name)) store.delete({ name, path: '/' });
    }
}

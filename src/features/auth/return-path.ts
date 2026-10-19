/**
 * Where a reader goes after signing in, and which paths are allowed to be
 * that destination. Pure, so the rules are unit-tested apart from the Server
 * Action and the callback route that apply them.
 */

/** Any origin will do: it only gives `URL` something to resolve against. */
const RESOLVE_BASE = 'http://return-path.invalid';

/**
 * Whether `path` is a safe place to send a reader after sign-in: a relative
 * path on this site that is not one of the sign-in pages.
 *
 * The one rule, used by both ends of the flow -- `returnPathFrom` when sign-in
 * starts, and `/auth/callback` when it finishes -- because the callback's
 * `next` can arrive without ever passing through the first: anyone can write
 * a callback URL.
 *
 * - It must start with `/`, which refuses every absolute URL.
 * - Not `//`, and not `/\` either: browsers read a backslash as a slash, and
 *   both resolve as protocol-relative URLs to another host. The callback
 *   happens to prefix the app's origin, which defuses them today; this does
 *   not rely on that.
 * - Already in the form a browser resolves it to. Otherwise the checks below
 *   would judge one path and the browser would go to another:
 *   `/books/../auth/callback` passes a prefix test and lands on the callback,
 *   and so do encoded dots (`%2e%2e`). An unusual but harmless path that is
 *   not in resolved form is refused too, which only costs the fallback to `/`.
 * - Not `/auth/`, so finishing sign-in never lands back on the error page or
 *   the callback itself, and not `/login` or anything under it, so it never
 *   lands back on the sign-in page.
 */
export function isSafeReturnPath(path: string): boolean {
    if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        path.startsWith('/\\')
    ) {
        return false;
    }

    let resolved: URL;
    try {
        resolved = new URL(path, RESOLVE_BASE);
    } catch {
        return false;
    }
    if (resolved.origin !== RESOLVE_BASE) return false;
    if (`${resolved.pathname}${resolved.search}${resolved.hash}` !== path) {
        return false;
    }

    const { pathname } = resolved;
    return (
        !pathname.startsWith('/auth/') &&
        pathname !== '/login' &&
        !pathname.startsWith('/login/')
    );
}

/**
 * The page a reader signed in from, as a relative path, or `/` when that
 * cannot be established.
 *
 * Taken from the sign-in form's `Referer`, because the header the button sits
 * in renders from the root layout, which is never told the current URL. A
 * form POST carries its page there, and browsers' default referrer policy
 * sends the full URL on a same-origin request.
 *
 * Every refusal falls back to `/`, which FR-8 already routes by auth state,
 * so a signed-in reader who lost their place still lands on their own
 * collection.
 */
export function returnPathFrom(referer: string | null, origin: string): string {
    if (referer === null) return '/';

    let url: URL;
    try {
        url = new URL(referer);
    } catch {
        return '/';
    }

    // Never another site: `next` must not become an open redirect.
    if (url.origin !== origin) return '/';

    const path = `${url.pathname}${url.search}`;
    return isSafeReturnPath(path) ? path : '/';
}

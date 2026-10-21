/**
 * The origin readers reach this app at, from a request's headers: the one
 * rule for every redirect back to the site and every check of whether a URL
 * is the site's own.
 *
 * Outside development, Vercel's proxy sits in front of the app, so the
 * request's own URL can carry an internal host; `x-forwarded-host` is the one
 * the reader asked for, and Vercel serves only HTTPS. Without that header --
 * in development, where `next dev` is reached directly, or under a local
 * `next start` -- `Host` is the reader's own, over HTTPS only when
 * `x-forwarded-proto` says so, the same test Next applies to the request URL.
 *
 * `null` with neither header: a caller deciding whether a URL is this site's
 * own has nothing to compare against, and should refuse.
 *
 * Pure, so node:test can import it (architecture.md section 11).
 */
export function publicOrigin(
    headers: Pick<Headers, 'get'>,
    isDevelopment: boolean = process.env.NODE_ENV === 'development',
): string | null {
    const forwardedHost = headers.get('x-forwarded-host');
    if (!isDevelopment && forwardedHost) return `https://${forwardedHost}`;

    const host = headers.get('host');
    if (!host) return null;
    const isHttps = headers.get('x-forwarded-proto')?.includes('https');
    return `${isHttps ? 'https' : 'http'}://${host}`;
}

/**
 * Whether a request's `Origin` header names this site, failing closed: a
 * missing header and the opaque `null` some browsers send both count as
 * another site. When this site's own origin cannot be established there is
 * nothing to compare with, so the caller refuses before asking.
 *
 * Route Handlers need this themselves. Next checks `Origin` against the host
 * for Server Actions only, so without it any site could post a form to one.
 */
export function isSameOrigin(
    originHeader: string | null,
    origin: string,
): boolean {
    return originHeader === origin;
}

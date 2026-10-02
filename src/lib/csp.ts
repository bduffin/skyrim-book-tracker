/**
 * The Content Security Policy, built per request around a fresh nonce.
 *
 * Pure, so the policy is unit-tested apart from the proxy that sends it.
 */

/**
 * Enforced. To trial a change to the policy without blocking anything, switch
 * this to `Content-Security-Policy-Report-Only`, which logs violations in the
 * browser console instead. Next reads the nonce from either name on the
 * request (`app-render.js`), so the proxy sends this one header both ways.
 */
export const CSP_HEADER = 'Content-Security-Policy';

/** A fresh, unguessable nonce, as Next's CSP guide makes one. */
export function createNonce(): string {
    return btoa(crypto.randomUUID());
}

export function contentSecurityPolicy({
    nonce,
    isDev,
    supabaseOrigin,
}: {
    nonce: string;
    isDev: boolean;
    /**
     * Where sign-in's form submission is redirected: the Supabase project's
     * `/auth/v1/authorize`, which redirects on to GitHub. Chrome checks
     * `form-action` against every redirect that follows a form submission,
     * so without both hosts the no-JavaScript sign-in would be blocked.
     * `null` when the project URL is unset, when sign-in cannot work anyway.
     */
    supabaseOrigin: string | null;
}): string {
    return [
        "default-src 'self'",
        // Next attaches the nonce to every script it renders, including its
        // inline bootstrap. 'strict-dynamic' then admits what those scripts
        // load, and makes browsers that support it ignore 'self', so only
        // scripts carrying the nonce run. Development additionally needs
        // eval, which React uses to rebuild server error stacks.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
        // No nonce here, unlike Next's example: a nonce in style-src makes
        // browsers ignore 'unsafe-inline', and the progress meters set their
        // width through a `style` attribute, which no nonce can cover.
        // `next/image` also writes `style="color:transparent"` on every image.
        // Nothing renders user- or UESP-supplied HTML (`react/no-danger`), so
        // an injected style has no way in.
        "style-src 'self' 'unsafe-inline'",
        // Avatars come through /_next/image, so GitHub's host is not needed.
        "img-src 'self'",
        "font-src 'self'",
        // Development's HMR websocket.
        `connect-src 'self'${isDev ? ' ws:' : ''}`,
        `form-action 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''} https://github.com`,
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
    ].join('; ');
}

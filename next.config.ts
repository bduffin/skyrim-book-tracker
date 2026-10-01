import type { NextConfig } from 'next';

import {
    GITHUB_AVATAR_HOST,
    GITHUB_AVATAR_PATH_PREFIX,
} from './src/features/auth/avatar';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Where sign-in's form submission is redirected: the Supabase project's
 * `/auth/v1/authorize`, which redirects on to GitHub. Chrome checks
 * `form-action` against every redirect that follows a form submission, so
 * without both hosts the no-JavaScript sign-in would be blocked. Omitted when
 * the variable is unset -- sign-in cannot work then anyway, and `next
 * typegen` on a fresh checkout loads this file before any `.env.local` exists.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    : null;

/**
 * Report-only for now: violations are logged in the browser console and
 * nothing is blocked. Next's inline bootstrap scripts will be reported under
 * `script-src`, and allowing them needs a per-request nonce from the proxy,
 * which is the work that has to happen before this can be enforced.
 *
 * `style-src` allows inline styles because the progress meters set their
 * width through a `style` attribute, which no nonce can cover. `next/image`
 * also writes `style="color:transparent"` on every image, so removing the
 * meters' style alone would not let this drop `'unsafe-inline'`. Nothing
 * renders user- or UESP-supplied HTML (`react/no-danger`), so an injected
 * style has no way in.
 *
 * Development additionally allows `eval` and the HMR websocket, so the
 * console shows only what production would report.
 */
const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Avatars come through /_next/image, so GitHub's host is not needed here.
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    `form-action 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''} https://github.com`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
    poweredByHeader: false,
    images: {
        // The header's avatar (`UserBadge`). Only GitHub's avatar CDN, and
        // only its user-avatar paths: `next/image` fetches through this app's
        // server, so an open pattern here would make it a proxy for any image
        // on the web. Host and path both come from the constants
        // `avatarUrlFor` checks against: a URL it accepts but this refuses
        // makes next/image throw and the page fail with a 500.
        remotePatterns: [
            {
                protocol: 'https',
                hostname: GITHUB_AVATAR_HOST,
                pathname: `${GITHUB_AVATAR_PATH_PREFIX}**`,
            },
        ],
    },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'Content-Security-Policy-Report-Only',
                        value: contentSecurityPolicy,
                    },
                    // Browsers ignore frame-ancestors in a report-only
                    // policy, so this is what stops framing until the CSP
                    // is enforced.
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    // Must keep the full URL on same-origin requests:
                    // sign-in's return path is read from the form's Referer.
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin',
                    },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(), geolocation=()',
                    },
                ],
            },
        ];
    },
};

export default nextConfig;

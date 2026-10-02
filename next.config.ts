import type { NextConfig } from 'next';

import {
    GITHUB_AVATAR_HOST,
    GITHUB_AVATAR_PATH_PREFIX,
} from './src/features/auth/avatar';

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
                    // The Content Security Policy is not here: it carries a
                    // per-request nonce, so src/proxy.ts sends it.
                    //
                    // The CSP's frame-ancestors does this job in current
                    // browsers. Kept for older ones that never read it, and
                    // for any time the CSP goes back to report-only, which
                    // browsers ignore frame-ancestors in.
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

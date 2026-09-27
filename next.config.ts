import type { NextConfig } from 'next';

import {
    GITHUB_AVATAR_HOST,
    GITHUB_AVATAR_PATH_PREFIX,
} from './src/features/auth/avatar';

const nextConfig: NextConfig = {
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
};

export default nextConfig;

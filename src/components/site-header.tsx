import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import { getDisplayName } from '@/features/auth/get-display-name';
import { AccountMenu } from '@/features/auth/components/account-menu';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';
import { MENU_ITEM_CLASS } from '@/features/auth/components/menu-item';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { UserBadge } from '@/features/auth/components/user-badge';
import { SiteLogo } from '@/components/site-logo';
import { SiteNav } from '@/components/site-nav';
import { collectionPath } from '@/features/collection/route';
import { settingsPath } from '@/features/profile/profile-input';

export async function SiteHeader() {
    const supabase = await createClient();

    // getClaims() can throw (e.g. on a network failure) rather than
    // returning an error, and SiteHeader renders from the root layout,
    // which sits outside any route's error.tsx boundary. Degrade to a
    // signed-out header rather than letting it take down the whole app.
    let claims;
    try {
        const { data } = await supabase.auth.getClaims();
        claims = data?.claims;
    } catch (error) {
        console.error('Unable to determine auth state:', error);
    }

    const displayName = claims ? getDisplayName(claims) : null;

    return (
        <>
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-iron-900 px-4 py-3 text-frost-50">
                <SiteLogo />
                {claims && displayName !== null ? (
                    <AccountMenu
                        label={displayName}
                        badge={
                            <UserBadge
                                displayName={displayName}
                                metadata={claims.user_metadata}
                            />
                        }
                    >
                        <Link href={settingsPath()} className={MENU_ITEM_CLASS}>
                            Settings
                        </Link>
                        <SignOutButton />
                    </AccountMenu>
                ) : (
                    <GitHubLoginButton />
                )}
            </header>
            <SiteNav
                collectionHref={claims ? collectionPath(claims.sub) : null}
            />
        </>
    );
}

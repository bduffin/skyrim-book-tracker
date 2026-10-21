import Link from 'next/link';

import { getViewerClaims } from '@/features/auth/get-viewer-id';
import { getDisplayName } from '@/features/auth/get-display-name';
import { AccountMenu } from '@/features/auth/components/account-menu';
import { SignInLink } from '@/features/auth/components/sign-in-link';
import { MENU_ITEM_CLASS } from '@/features/auth/components/menu-item';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { UserBadge } from '@/features/auth/components/user-badge';
import { SiteLogo } from '@/components/site-logo';
import { SiteNav } from '@/components/site-nav';
import { collectionPath } from '@/features/collection/route';
import { settingsPath } from '@/features/profile/profile-input';

export async function SiteHeader() {
    const claims = await getViewerClaims();
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
                    <SignInLink />
                )}
            </header>
            <SiteNav
                collectionHref={claims ? collectionPath(claims.sub) : null}
            />
        </>
    );
}

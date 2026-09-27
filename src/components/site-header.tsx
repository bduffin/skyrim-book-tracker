import { createClient } from '@/lib/supabase/server';
import { getDisplayName } from '@/features/auth/get-display-name';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';
import { SignOutButton } from '@/features/auth/components/sign-out-button';
import { SiteLogo } from '@/components/site-logo';
import { SiteNav } from '@/components/site-nav';
import { collectionPath } from '@/features/collection/route';

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

    return (
        <>
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-iron-900 px-4 py-3 text-frost-50">
                <SiteLogo />
                {claims ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span>Welcome, {getDisplayName(claims)}</span>
                        <SignOutButton />
                    </div>
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

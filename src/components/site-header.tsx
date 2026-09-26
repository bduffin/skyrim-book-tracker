import { createClient } from '@/lib/supabase/server';
import { getDisplayName } from '@/features/auth/get-display-name';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';
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
            {/*
             * `flex-wrap`: when the logo and the controls do not fit side by
             * side, the controls move to a line of their own rather than the
             * name being cut -- below 428px signed out, measured with the
             * sign-in button.
             */}
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-iron-900 px-4 py-3 text-frost-50">
                <SiteLogo />
                {claims ? (
                    <span>Welcome, {getDisplayName(claims)}</span>
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

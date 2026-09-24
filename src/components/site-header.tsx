import { createClient } from '@/lib/supabase/server';
import { getDisplayName } from '@/features/auth/get-display-name';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';

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
        <header className="flex justify-end bg-iron-900 px-4 py-3 text-frost-50">
            {claims ? (
                <span>Welcome, {getDisplayName(claims)}</span>
            ) : (
                <GitHubLoginButton />
            )}
        </header>
    );
}

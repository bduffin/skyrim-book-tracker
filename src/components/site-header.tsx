import { createClient } from '../lib/supabase/server';
import { getDisplayName } from '../features/auth/get-display-name';
import { GitHubLoginButton } from '../features/auth/components/github-login-button';

export async function SiteHeader() {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;

    return (
        <header className="flex justify-end border-b px-4 py-3">
            {claims ? (
                <span>Welcome, {getDisplayName(claims)}</span>
            ) : (
                <GitHubLoginButton />
            )}
        </header>
    );
}

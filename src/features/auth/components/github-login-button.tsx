'use client';

import { createClient } from '@/lib/supabase/client';

export function GitHubLoginButton() {
    const supabase = createClient();

    async function signIn() {
        await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
    }

    return (
        <button
            onClick={signIn}
            className="rounded bg-black px-4 py-2 text-white"
        >
            Sign in with GitHub
        </button>
    );
}

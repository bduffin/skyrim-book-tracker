'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function GitHubLoginButton() {
    const supabase = createClient();
    const [failed, setFailed] = useState(false);

    async function signIn() {
        setFailed(false);
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) {
            setFailed(true);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <button
                onClick={signIn}
                className="rounded bg-black px-4 py-2 text-white"
            >
                Sign in with GitHub
            </button>
            {failed && (
                <span className="text-sm text-red-600">
                    Couldn&apos;t sign in. Please try again.
                </span>
            )}
        </div>
    );
}

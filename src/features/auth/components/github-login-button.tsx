import { ActionFailureGuard } from '@/components/action-failure-guard';

import { signInWithGitHub } from '../actions';

/**
 * The sign-in button: a `<form>` posting to a Server Action, so signing in
 * works with JavaScript disabled, and returns the reader to the page they
 * signed in from (`return-path.ts`).
 *
 * A failure to start sign-in lands on `/auth/auth-error`, which says what went
 * wrong in fixed wording. A failure to reach the server at all never gets that
 * far, so it is said beside the button instead (`ActionFailureGuard`).
 */
export function GitHubLoginButton({
    tone = 'header',
    insideLiveRegion = false,
}: {
    /**
     * `header` is frost on the iron header; `inline` inverts it for the light
     * page, where the frost fill would all but vanish.
     */
    tone?: 'header' | 'inline';
    /** Set where the button sits inside a live region; see the guard. */
    insideLiveRegion?: boolean;
}) {
    return (
        <ActionFailureGuard
            insideLiveRegion={insideLiveRegion}
            message="Couldn’t reach the server to sign in. Check your connection and try again."
            messageClassName={`max-w-xs pt-1.5 text-sm ${
                tone === 'header' ? 'text-frost-50' : 'text-iron-900'
            }`}
        >
            <form action={signInWithGitHub}>
                <button
                    type="submit"
                    className={
                        tone === 'header'
                            ? 'rounded bg-frost-50 px-4 py-2 font-medium text-iron-900 transition-colors hover:bg-frost-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-frost-50'
                            : 'rounded bg-iron-900 px-3 py-1.5 text-sm font-medium text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800'
                    }
                >
                    Sign in with GitHub
                </button>
            </form>
        </ActionFailureGuard>
    );
}

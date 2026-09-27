import { signInWithGitHub } from '../actions';

/**
 * The sign-in button: a `<form>` posting to a Server Action, so signing in
 * works with JavaScript disabled, and returns the reader to the page they
 * signed in from (`return-path.ts`).
 *
 * A Server Component; nothing here needs the browser. A failure to start
 * sign-in lands on `/auth/auth-error`, which says what went wrong in fixed
 * wording, rather than on an inline message beside the button.
 */
export function GitHubLoginButton({
    tone = 'header',
}: {
    /**
     * `header` is frost on the iron header; `inline` inverts it for the light
     * page, where the frost fill would all but vanish.
     */
    tone?: 'header' | 'inline';
}) {
    return (
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
    );
}

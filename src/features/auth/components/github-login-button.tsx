import { ActionFailureGuard } from '@/components/action-failure-guard';

import { signInWithGitHub } from '../actions';

/**
 * The sign-in page's GitHub button: a `<form>` posting to a Server Action, so
 * signing in works with JavaScript disabled.
 *
 * `next` travels as a hidden field, because the form's own `Referer` is the
 * sign-in page. The action checks it again, since a hidden field can be
 * changed before it is posted.
 *
 * A failure to start sign-in lands on `/auth/auth-error`, which says what went
 * wrong in fixed wording. A failure to reach the server at all never gets that
 * far, so it is said beside the button instead (`ActionFailureGuard`).
 */
export function GitHubLoginButton({ next }: { next: string }) {
    return (
        <ActionFailureGuard
            message="Couldn’t reach the server to sign in. Check your connection and try again."
            messageClassName="max-w-xs pt-1.5 text-sm text-iron-900"
        >
            <form action={signInWithGitHub}>
                <input type="hidden" name="next" value={next} />
                <button
                    type="submit"
                    className="rounded bg-iron-900 px-4 py-2 font-medium text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800"
                >
                    Sign in with GitHub
                </button>
            </form>
        </ActionFailureGuard>
    );
}

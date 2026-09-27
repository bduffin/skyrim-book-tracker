import { signOut } from '../actions';

/**
 * The header's sign-out control: a `<form>` posting to a Server Action, so it
 * works with JavaScript disabled, the same pattern as `GitHubLoginButton`.
 *
 * Outlined rather than filled: the solid frost button is the header's call to
 * action for signing *in*, and signing out should not compete with the
 * reader's own name for attention. frost-300 on iron-900 is well past the 3:1
 * a control's boundary needs.
 */
export function SignOutButton() {
    return (
        <form action={signOut}>
            <button
                type="submit"
                className="rounded border border-frost-300 px-3 py-1.5 text-sm text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-frost-50"
            >
                Sign out
            </button>
        </form>
    );
}

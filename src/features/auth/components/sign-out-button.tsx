import { ActionFailureGuard } from '@/components/action-failure-guard';

import { signOut } from '../actions';

import { MENU_ITEM_CLASS } from './menu-item';

/**
 * The account menu's sign-out item: a `<form>` posting to a Server Action, so
 * it works with JavaScript disabled, the same pattern as the sign-in page's
 * GitHub button.
 *
 * A failure to reach the server at all is said inside the menu rather than
 * replacing the page (`ActionFailureGuard`). It says the reader is still
 * signed in, which is true: nothing was sent, so nothing was deleted.
 */
export function SignOutButton() {
    return (
        <ActionFailureGuard
            message="Couldn’t reach the server, so you’re still signed in. Check your connection and try again."
            messageClassName="px-4 pb-2 text-sm text-iron-900"
        >
            <form action={signOut}>
                <button type="submit" className={MENU_ITEM_CLASS}>
                    Sign out
                </button>
            </form>
        </ActionFailureGuard>
    );
}

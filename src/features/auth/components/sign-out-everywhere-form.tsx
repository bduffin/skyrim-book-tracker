import Link from 'next/link';

import { ActionFailureGuard } from '@/components/action-failure-guard';
import { SECONDARY_ACTION_CLASS } from '@/components/secondary-action';

import { signOutEverywhere } from '../actions';

/**
 * The confirmation page's form for **Sign out everywhere** (Email FR-10): a
 * `<form>` posting to the Server Action, so it works with JavaScript
 * disabled, beside a way back that signs nothing out.
 *
 * A failure to reach the server at all is said beside the button
 * (`ActionFailureGuard`), and says the reader is still signed in everywhere,
 * which is true: nothing was sent, so nothing was revoked.
 */
export function SignOutEverywhereForm({ cancelHref }: { cancelHref: string }) {
    return (
        <ActionFailureGuard
            message="Couldn’t reach the server, so you’re still signed in everywhere. Check your connection and try again."
            messageClassName="pt-2 text-sm text-iron-900"
        >
            <form
                action={signOutEverywhere}
                className="flex flex-wrap items-center gap-3"
            >
                <button
                    type="submit"
                    className="rounded bg-iron-900 px-4 py-2 font-medium text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800"
                >
                    Sign out everywhere
                </button>
                <Link href={cancelHref} className={SECONDARY_ACTION_CLASS}>
                    Cancel
                </Link>
            </form>
        </ActionFailureGuard>
    );
}

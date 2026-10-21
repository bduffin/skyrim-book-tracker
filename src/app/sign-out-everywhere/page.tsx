import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/page-title';
import { SignOutEverywhereForm } from '@/features/auth/components/sign-out-everywhere-form';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { BOOKS_PATH } from '@/features/books/scope';
import { settingsPath } from '@/features/profile/profile-input';

export const metadata: Metadata = {
    title: 'Sign out everywhere',
    robots: { index: false, follow: false },
};

/**
 * The confirmation step for **Sign out everywhere** (Email FR-10), linked
 * from `/settings`, so one stray click there signs nothing out. It also says
 * what the action can't do at once: other devices can stay signed in for up
 * to an hour.
 *
 * Cancel goes back to plain `/settings`, where the only link here is: never
 * to the exact URL the reader came from, which could be `/settings?saved=1`
 * and repeat a save confirmation for a save that didn't happen. Signed out,
 * it redirects to /books with a 307, as /settings does.
 */
export default async function SignOutEverywherePage() {
    if ((await getViewerId()) === null) redirect(BOOKS_PATH);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Sign out everywhere</PageTitle>

            <div className="space-y-4 px-4 text-iron-600">
                <p>
                    This signs you out of Arcanaeum on every device and browser
                    where you’re signed in, including this one. Use it if you’ve
                    signed in somewhere you no longer trust, or think someone
                    else has gotten into your account.
                </p>
                <p>
                    Another device can stay signed in for up to an hour, until
                    the sign-in it already holds runs out. After that it’s
                    signed out for good, and signing in again needs a new code
                    or GitHub.
                </p>
                <SignOutEverywhereForm cancelHref={settingsPath()} />
            </div>
        </main>
    );
}

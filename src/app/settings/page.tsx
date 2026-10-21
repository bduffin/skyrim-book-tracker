import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/page-title';
import { SECONDARY_ACTION_CLASS } from '@/components/secondary-action';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { SIGN_OUT_EVERYWHERE_PATH } from '@/features/auth/route';
import { safeReturnPath } from '@/features/auth/return-path';
import { BOOKS_PATH } from '@/features/books/scope';
import { ProfileForm } from '@/features/profile/components/profile-form';
import { getProfile } from '@/features/profile/data';
import { isSavedParam } from '@/features/profile/profile-input';

export const metadata: Metadata = {
    title: 'Settings',
    // Only ever the viewer's own settings, so nothing here is worth indexing.
    robots: { index: false, follow: false },
};

/**
 * One page for first-time setup and later changes (Profiles FR-5, Profiles
 * Decision 6). Sign-in sends a user here with `next` while they have no
 * profile row (Profiles FR-4); otherwise it is reached from the account menu,
 * or from the collection page's notice while there is no row. Below the
 * profile form, it links to Sign out everywhere (Email FR-10).
 *
 * Signed out, it redirects to /books with a 307, as the collection page does.
 */
export default async function SettingsPage({
    searchParams,
}: PageProps<'/settings'>) {
    const [params, viewerId] = await Promise.all([searchParams, getViewerId()]);
    if (viewerId === null) redirect(BOOKS_PATH);

    const lookup = await getProfile(viewerId);
    // Never fall back to the defaults when the row could not be read: a user
    // who chose private would see public preselected, and saving the form as
    // shown would make them public. The route's error page is the safe answer.
    if (lookup.status === 'error') {
        throw new Error('Could not load the viewer’s profile.');
    }
    const hasProfile = lookup.status === 'found';

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Settings</PageTitle>

            <div className="space-y-6 px-4">
                {!hasProfile && (
                    <p className="text-iron-600">
                        Before you carry on, take a moment to set up your
                        account. You can change these settings at any time.
                    </p>
                )}

                <ProfileForm
                    isPublic={
                        lookup.status === 'found'
                            ? lookup.profile.isPublic
                            : true
                    }
                    next={safeReturnPath(params.next)}
                    saved={isSavedParam(params.saved)}
                />

                {/*
                 * A link to a confirmation page rather than the form itself
                 * (Email FR-10): signing out every device is not something to
                 * do with one stray click. Not during first-time setup, which
                 * a just-signed-in user is here to finish, with one session.
                 */}
                {hasProfile && (
                    <section
                        aria-labelledby="sign-out-everywhere"
                        className="space-y-3 border-t border-frost-300 pt-6"
                    >
                        <h2
                            id="sign-out-everywhere"
                            className="font-serif text-lg text-iron-900"
                        >
                            Sign out everywhere
                        </h2>
                        <p className="text-iron-600">
                            Sign out on every device and browser at once, if
                            you’ve signed in somewhere you no longer trust.
                        </p>
                        <Link
                            href={SIGN_OUT_EVERYWHERE_PATH}
                            className={`inline-block ${SECONDARY_ACTION_CLASS}`}
                        >
                            Sign out everywhere…
                        </Link>
                    </section>
                )}
            </div>
        </main>
    );
}

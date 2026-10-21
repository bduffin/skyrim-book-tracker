import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/page-title';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { publicOrigin } from '@/features/auth/public-origin';
import { loginPageNext } from '@/features/auth/return-path';

export const metadata: Metadata = {
    title: 'Sign in',
    robots: { index: false },
};

/**
 * The sign-in page (Email FR-1), reached from every "Sign in" link.
 *
 * Where the reader goes afterwards is worked out here, on the way in, and
 * carried in each form as a hidden `next` (`loginPageNext`).
 *
 * A reader who is already signed in is sent straight on with a 307, so going
 * back from the destination after signing in moves forward again rather than
 * showing the forms.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
    const [params, requestHeaders, viewerId] = await Promise.all([
        searchParams,
        headers(),
        getViewerId(),
    ]);
    const next = loginPageNext({
        param: params.next,
        referer: requestHeaders.get('referer'),
        origin: publicOrigin(requestHeaders),
    });
    if (viewerId !== null) redirect(next);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Sign in</PageTitle>

            <div className="flex flex-col items-center gap-6 px-4 text-center">
                <p className="text-iron-600">
                    Sign in to mark books as read and collected, and keep track
                    of your progress.
                </p>
                <GitHubLoginButton next={next} />
            </div>
        </main>
    );
}

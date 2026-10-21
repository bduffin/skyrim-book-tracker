import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/page-title';
import {
    CodeStep,
    EmailStep,
} from '@/features/auth/components/email-sign-in-forms';
import { GitHubLoginButton } from '@/features/auth/components/github-login-button';
import {
    isEmailSignInEnabled,
    PENDING_EMAIL_COOKIE,
} from '@/features/auth/email-sign-in';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { loginErrorMessage } from '@/features/auth/login-error-message';
import { publicOrigin } from '@/features/auth/public-origin';
import { loginPageNext } from '@/features/auth/return-path';

export const metadata: Metadata = {
    title: 'Sign in',
    robots: { index: false },
};

const ERROR_ID = 'login-error';

/**
 * The sign-in page (Email FR-1), reached from every "Sign in" link: GitHub
 * and an email address, then a code step once a code is on its way.
 *
 * Where the reader goes afterwards is worked out here, on the way in, and
 * carried in each form as a hidden `next` (`loginPageNext`).
 *
 * A reader who is already signed in is sent straight on with a 307, so going
 * back from the destination after signing in moves forward again rather than
 * showing the forms.
 *
 * With email sign-in switched off (Email FR-12), only GitHub is offered, and
 * a leftover pending-address cookie is ignored, so the page never shows a
 * form whose handler would answer 404.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
    const [params, requestHeaders, cookieStore, viewerId] = await Promise.all([
        searchParams,
        headers(),
        cookies(),
        getViewerId(),
    ]);
    const next = loginPageNext({
        param: params.next,
        referer: requestHeaders.get('referer'),
        origin: publicOrigin(requestHeaders),
    });
    if (viewerId !== null) redirect(next);

    const emailEnabled = isEmailSignInEnabled();
    const pendingEmail = emailEnabled
        ? (cookieStore.get(PENDING_EMAIL_COOKIE)?.value ?? null)
        : null;
    const error = emailEnabled ? loginErrorMessage(params.error) : null;
    const step = { next, errorId: ERROR_ID, hasError: error !== null };

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Sign in</PageTitle>

            <div className="flex flex-col items-center gap-6 px-4 text-center">
                {/*
                 * Always in the document, so it is an established live region
                 * before a message is put in it.
                 */}
                <p
                    id={ERROR_ID}
                    role="alert"
                    className="w-full max-w-sm rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-left text-sm text-steel-800 empty:hidden"
                >
                    {error}
                </p>

                {pendingEmail !== null ? (
                    <CodeStep email={pendingEmail} {...step} />
                ) : (
                    <>
                        <p className="text-iron-600">
                            Sign in to mark books as read and collected, and
                            keep track of your progress.
                        </p>
                        <GitHubLoginButton next={next} />
                        {emailEnabled && (
                            <>
                                <div
                                    aria-hidden="true"
                                    className="flex w-full max-w-sm items-center gap-3 text-sm text-iron-500"
                                >
                                    <span className="h-px flex-1 bg-frost-300" />
                                    or
                                    <span className="h-px flex-1 bg-frost-300" />
                                </div>
                                <EmailStep {...step} />
                            </>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

import type { Metadata } from 'next';
import Link from 'next/link';

import { PageTitle } from '@/components/page-title';
import {
    authErrorMessage,
    authErrorTitle,
} from '@/features/auth/auth-error-message';

/**
 * One usable value from a query param, or `undefined`.
 *
 * `PageProps` types a param honestly as `string | string[] | undefined`, and
 * the array case is real: `?error=a&error=b` arrives as two values. The
 * handwritten type this replaced claimed a plain string, so nothing forced
 * that case to be handled. Repeated and blank params both read as absent,
 * the same rule `src/features/books/scope.ts` applies -- there is no
 * non-arbitrary way to pick between two error codes, and an empty one says
 * nothing.
 */
function single(value: string | string[] | undefined): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The tab title follows the heading: "Sign-in failed" for every provider
 * error, "Sign-out didn't finish" for the one failure that is not a sign-in.
 */
export async function generateMetadata({
    searchParams,
}: PageProps<'/auth/auth-error'>): Promise<Metadata> {
    const params = await searchParams;
    return {
        title: authErrorTitle({
            error: single(params.error),
            errorCode: single(params.error_code),
        }),
    };
}

/** Enough of a logged value to diagnose from, without letting one flood logs. */
const LOG_LIMIT = 500;

export default async function AuthErrorPage({
    searchParams,
}: PageProps<'/auth/auth-error'>) {
    const params = await searchParams;
    // Supabase's redirect carries three params -- the standard OAuth `error`,
    // its own more specific `error_code`, and free-text `error_description`
    // -- which are the three @supabase/auth-js reads from a redirect URL.
    const error = single(params.error);
    const errorCode = single(params.error_code);
    const errorDescription = single(params.error_description);

    if (error || errorCode || errorDescription) {
        // Logged, never rendered: see auth-error-message.ts for why the page
        // shows only app-written copy. Passed as an object rather than as
        // bare strings because the values are attacker-controlled, and Node
        // quotes and escapes strings inside an object -- a description with
        // embedded newlines logged bare would forge whole extra log lines.
        console.warn('Auth error page reached', {
            error: error?.slice(0, LOG_LIMIT),
            errorCode: errorCode?.slice(0, LOG_LIMIT),
            errorDescription: errorDescription?.slice(0, LOG_LIMIT),
        });
    }

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>{authErrorTitle({ error, errorCode })}</PageTitle>
            <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
                <p className="max-w-md text-iron-500">
                    {authErrorMessage({ error, errorCode })}
                </p>
                <Link
                    href="/"
                    className="rounded border border-frost-300 bg-white px-4 py-2 text-iron-900 transition-colors hover:bg-frost-100"
                >
                    Back to home
                </Link>
            </div>
        </main>
    );
}

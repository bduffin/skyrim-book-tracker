import type { Metadata } from 'next';
import Link from 'next/link';

import { PageTitle } from '@/components/page-title';

export const metadata: Metadata = {
    title: 'Sign-in failed',
};

/**
 * One usable value from a query param, or `undefined`.
 *
 * `PageProps` types a param honestly as `string | string[] | undefined`, and
 * the array case is real: `?error=a&error=b` arrives as two values. The
 * handwritten type this replaced claimed a plain string, so nothing forced
 * that case to be handled. Repeated and blank params both read as absent,
 * the same rule `src/features/books/scope.ts` applies -- there is no
 * non-arbitrary way to pick between two error messages, and an empty one
 * would render an empty paragraph instead of the fallback.
 */
function single(value: string | string[] | undefined): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export default async function AuthErrorPage({
    searchParams,
}: PageProps<'/auth/auth-error'>) {
    const params = await searchParams;
    const error = single(params.error);
    const errorDescription = single(params.error_description);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Sign-in failed</PageTitle>
            <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
                <p className="max-w-md text-iron-500">
                    {errorDescription ??
                        error ??
                        'Something went wrong while signing you in. Please try again.'}
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

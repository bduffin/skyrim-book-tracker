import type { Metadata } from 'next';
import Link from 'next/link';

import { MESSAGE_ACTION_CLASS, MessagePage } from '@/components/message-page';
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

export default async function AuthErrorPage({
    searchParams,
}: PageProps<'/auth/auth-error'>) {
    const params = await searchParams;
    // Only the two codes, which choose among app-written messages (see
    // auth-error-message.ts). Nothing is logged here: everything that
    // redirects to this page -- the callback and the sign-in and sign-out
    // actions -- has already logged the failure, the callback including
    // Supabase's `error_description`, which never reaches this page.
    const error = single(params.error);
    const errorCode = single(params.error_code);

    return (
        <MessagePage
            title={authErrorTitle({ error, errorCode })}
            message={authErrorMessage({ error, errorCode })}
            action={
                <Link href="/" className={MESSAGE_ACTION_CLASS}>
                    Back to home
                </Link>
            }
        />
    );
}

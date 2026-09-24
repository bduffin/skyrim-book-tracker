import Link from 'next/link';

import { PageTitle } from '@/components/page-title';

export default async function AuthErrorPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string; error_description?: string }>;
}) {
    const { error, error_description: errorDescription } = await searchParams;

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

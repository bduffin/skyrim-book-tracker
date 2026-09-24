'use client';

import { useEffect } from 'react';

import { PageTitle } from '@/components/page-title';

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        // The same max-w-3xl frame as /books, so the title plate sits where
        // it does on every other page. It also has to: PageTitle's divider
        // lines are flex-1, and inside an items-center column they would
        // shrink to the width of the title and vanish.
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Can&apos;t load this page</PageTitle>
            <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
                <p className="max-w-md text-iron-500">
                    Something went wrong loading this page.
                </p>
                <button
                    onClick={() => reset()}
                    className="rounded border border-frost-300 bg-white px-4 py-2 text-iron-900 transition-colors hover:bg-frost-100"
                >
                    Try again
                </button>
            </div>
        </main>
    );
}

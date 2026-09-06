'use client';

import { useEffect } from 'react';

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
        <main className="flex flex-col items-center gap-4 px-4 py-16 text-center">
            <h1>Can&apos;t load this page</h1>
            <p className="max-w-md text-gray-600">
                Something went wrong loading this page.
            </p>
            <button
                onClick={() => reset()}
                className="rounded border px-4 py-2 hover:bg-gray-100"
            >
                Try again
            </button>
        </main>
    );
}

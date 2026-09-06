'use client';

import { useEffect } from 'react';

// Catches errors thrown by the root layout itself (e.g. SiteHeader), which
// sit outside error.tsx's reach since error.tsx can't wrap the layout that
// renders it. Must render its own <html>/<body> — this replaces the whole
// document.
export default function GlobalError({
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
        <html lang="en">
            <body>
                <main className="flex flex-col items-center gap-4 px-4 py-16 text-center">
                    <h1>Something went wrong</h1>
                    <p className="max-w-md text-gray-600">
                        The app hit an unexpected error and couldn&apos;t
                        render.
                    </p>
                    <button
                        onClick={() => reset()}
                        className="rounded border px-4 py-2 hover:bg-gray-100"
                    >
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}

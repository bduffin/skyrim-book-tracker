'use client';

import { useEffect } from 'react';

// Imported here as well as in the root layout, because this replaces the
// root layout outright: none of what it loads applies when this renders.
import './globals.css';
import { fontVariables } from './fonts';
import { PageTitle } from '@/components/page-title';

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
        <html lang="en" className={fontVariables}>
            <body>
                <main className="mx-auto max-w-3xl py-6">
                    <PageTitle>Something went wrong</PageTitle>
                    <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
                        <p className="max-w-md text-iron-500">
                            The app hit an unexpected error and couldn&apos;t
                            render.
                        </p>
                        <button
                            onClick={() => reset()}
                            className="rounded border border-frost-300 bg-white px-4 py-2 text-iron-900 transition-colors hover:bg-frost-100"
                        >
                            Try again
                        </button>
                    </div>
                </main>
            </body>
        </html>
    );
}

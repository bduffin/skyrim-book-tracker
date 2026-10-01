'use client';

import { useEffect } from 'react';

// Imported here as well as in the root layout, because this replaces the
// root layout outright: none of what it loads applies when this renders.
import './globals.css';
import { fontVariables } from './fonts';
import { MESSAGE_ACTION_CLASS, MessagePage } from '@/components/message-page';

// Catches errors thrown by the root layout itself (e.g. SiteHeader), which
// sit outside error.tsx's reach since error.tsx can't wrap the layout that
// renders it. Must render its own <html>/<body> — this replaces the whole
// document.
export default function GlobalError({
    error,
    retry,
}: {
    error: Error & { digest?: string };
    retry: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <html lang="en" className={fontVariables}>
            <body>
                <MessagePage
                    title="Something went wrong"
                    message="The app hit an unexpected error and couldn't render."
                    action={
                        <button
                            onClick={() => retry()}
                            className={MESSAGE_ACTION_CLASS}
                        >
                            Try again
                        </button>
                    }
                />
            </body>
        </html>
    );
}

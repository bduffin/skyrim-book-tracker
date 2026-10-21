'use client';

import { useState, type ReactNode } from 'react';

import { ActionErrorBoundary } from './action-error-boundary';

/**
 * Wraps a server-rendered `<form action={serverAction}>` whose action can
 * throw rather than answer -- a dropped connection -- and shows `message`
 * beside it instead of letting the error escape.
 *
 * For forms with no action state of their own to report through, such as
 * signing in and out. Without it, the error goes to the nearest error
 * boundary, and for a form in the header -- rendered from the root layout,
 * outside every route's `error.tsx` -- that is `global-error.tsx`, which
 * replaces the whole app.
 *
 * The message clears when the form is submitted again. The form itself stays
 * a Server Component passed in as children, so it still posts without
 * JavaScript, where none of this runs.
 */
export function ActionFailureGuard({
    message,
    messageClassName,
    insideLiveRegion = false,
    children,
}: {
    message: string;
    /** Colours and spacing for where the message sits: header or page. */
    messageClassName: string;
    /**
     * When the guard already sits inside a live region, which announces the
     * message as it appears. A second region nested in the first is read
     * inconsistently -- twice by some screen readers, not at all by others.
     */
    insideLiveRegion?: boolean;
    children: ReactNode;
}) {
    const [failed, setFailed] = useState(false);
    return (
        <div onSubmitCapture={() => setFailed(false)}>
            <ActionErrorBoundary
                onError={(error) => {
                    console.error('Form action failed to complete:', error);
                    setFailed(true);
                }}
            >
                {children}
            </ActionErrorBoundary>
            {/*
             * Always in the document, so it is an established live region
             * before the message is put in it.
             */}
            <p
                role={insideLiveRegion ? undefined : 'alert'}
                className={`empty:hidden ${messageClassName}`}
            >
                {failed && message}
            </p>
        </div>
    );
}

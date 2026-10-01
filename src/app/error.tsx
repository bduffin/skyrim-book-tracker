'use client';

import { useEffect } from 'react';

import { MESSAGE_ACTION_CLASS, MessagePage } from '@/components/message-page';

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
        <MessagePage
            title="Can't load this page"
            message="Something went wrong loading this page."
            action={
                <button
                    onClick={() => reset()}
                    className={MESSAGE_ACTION_CLASS}
                >
                    Try again
                </button>
            }
        />
    );
}

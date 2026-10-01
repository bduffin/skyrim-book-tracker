import type { Metadata } from 'next';
import Link from 'next/link';

import { MESSAGE_ACTION_CLASS, MessagePage } from '@/components/message-page';

export const metadata: Metadata = {
    title: 'Page not found',
};

/**
 * Every 404: an unknown URL, and anything that calls `notFound()`.
 *
 * Deliberately says nothing about why. Browse FR-10 has a private collection
 * answer with a 404 indistinguishable from a user who never existed, and that
 * holds only while this page reads the same whatever led here.
 */
export default function NotFound() {
    return (
        <MessagePage
            title="Page not found"
            message="This page does not exist, has been moved, or you do not have permission to access it."
            action={
                <Link href="/" className={MESSAGE_ACTION_CLASS}>
                    Back to home
                </Link>
            }
        />
    );
}

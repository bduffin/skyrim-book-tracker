import { redirect } from 'next/navigation';

import { getViewerId } from '@/features/auth/get-viewer-id';
import { BOOKS_PATH } from '@/features/books/scope';
import { collectionPath } from '@/features/collection/route';

/**
 * FR-8: `/` sends the visitor to whichever page is theirs -- their own
 * collection when signed in, the catalogue when not.
 *
 * `redirect()` issues a **307**. A permanent 308 would be cached by the
 * browser indefinitely, so anyone who first landed here signed out would have
 * `/` -> `/books` burned in and never reach their collection afterwards.
 */
export default async function Home() {
    const viewerId = await getViewerId();
    redirect(viewerId === null ? BOOKS_PATH : collectionPath(viewerId));
}

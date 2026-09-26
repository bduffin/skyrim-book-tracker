import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/page-title';
import { PaginationNav } from '@/components/pagination-nav';
import { getViewerId } from '@/features/auth/get-viewer-id';
import { BookList } from '@/features/books/components/book-list';
import { BOOKS_PATH } from '@/features/books/scope';
import { ProgressSummary } from '@/features/collection/components/progress-summary';
import { getMarkedBooksPage, getProgress } from '@/features/collection/data';
import { collectionPath, isOwnCollection } from '@/features/collection/route';
import { PAGE_SIZE, parsePageParam } from '@/lib/pagination';

export const metadata: Metadata = {
    title: 'My collection',
    // FR-10: viewable and indexable are two different consents, and only one
    // of them is quickly reversible. Uniform rather than per-user, and never
    // paired with a robots.txt Disallow -- a page that is not crawled is a
    // page whose noindex is never read.
    robots: { index: false, follow: false },
};

/**
 * A user's own tracking view (FR-8): progress (FR-5) and every book they have
 * marked, with the same rows and toggles as /books.
 *
 * Owner-only until FR-10's visibility setting exists: public viewing must not
 * ship before the setting that turns it off. Everyone else -- signed out, or
 * asking for another user's page -- is sent to /books. `redirect()` issues a
 * 307, which is what keeps that bounce from being cached.
 */
export default async function CollectionPage({
    params,
    searchParams,
}: PageProps<'/collection/[user]'>) {
    const [{ user }, query] = await Promise.all([params, searchParams]);
    const viewerId = await getViewerId();
    if (viewerId === null || !isOwnCollection(user, viewerId)) {
        redirect(BOOKS_PATH);
    }

    // Both from the database on every render, so a toggle's revalidation
    // brings the meters and the list back to true state together (NFR-6).
    const [progress, books] = await Promise.all([
        getProgress(viewerId),
        getMarkedBooksPage({
            userId: viewerId,
            page: parsePageParam(query.page),
        }),
    ]);

    const first = (books.page - 1) * PAGE_SIZE + 1;
    const last = Math.min(books.page * PAGE_SIZE, books.total);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>My collection</PageTitle>

            <ProgressSummary progress={progress} />

            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-5 pb-2 text-sm text-iron-500">
                <p>
                    {books.total === 0 ? (
                        'No books marked yet'
                    ) : (
                        <>
                            Showing {first}–{last} of {books.total} marked ·
                            page {books.page} of {books.pageCount}
                        </>
                    )}
                </p>
                {/*
                 * Quick-add is deferred (FR-8); until it lands, adding a
                 * book means finding it in the catalogue, which this names.
                 */}
                <Link
                    href={BOOKS_PATH}
                    className="underline underline-offset-2 transition-colors hover:text-iron-900"
                >
                    Find books to add
                </Link>
            </div>

            {books.rows.length === 0 ? (
                <div className="border-y border-frost-200 px-4 py-12 text-center">
                    <p className="text-iron-900">
                        You haven’t marked any books as read or collected yet.
                    </p>
                    <p className="pt-2 text-sm text-iron-500">
                        <Link
                            href={BOOKS_PATH}
                            className="underline underline-offset-2 transition-colors hover:text-iron-900"
                        >
                            Browse the catalog
                        </Link>{' '}
                        to start tracking.
                    </p>
                </div>
            ) : (
                <BookList books={books.rows} signedIn />
            )}
            <PaginationNav
                basePath={collectionPath(viewerId)}
                page={books.page}
                pageCount={books.pageCount}
                params={query}
            />
        </main>
    );
}

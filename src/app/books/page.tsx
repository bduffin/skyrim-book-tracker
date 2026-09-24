import type { Metadata } from 'next';
import Link from 'next/link';

import { getBooksPage } from '@/features/books/data';
import {
    BOOKS_PATH,
    isDefaultFilters,
    parseFilters,
    parsePageParam,
    PAGE_SIZE,
} from '@/features/books/scope';
import { BookFilters } from '@/features/books/components/book-filters';
import { BookList } from '@/features/books/components/book-list';
import { EmptyState } from '@/features/books/components/empty-state';
import { PaginationNav } from '@/features/books/components/pagination-nav';
import { PageTitle } from '@/components/page-title';

export const metadata: Metadata = {
    title: 'Books',
};

export default async function BooksPage({ searchParams }: PageProps<'/books'>) {
    // searchParams is async in Next 16 and must be awaited before it is read.
    // The whole object is kept, not just `page`, so pagination links carry the
    // active filters through unchanged.
    const params = await searchParams;
    const filters = parseFilters(params);
    const books = await getBooksPage({
        page: parsePageParam(params.page),
        filters,
    });

    const first = (books.page - 1) * PAGE_SIZE + 1;
    const last = Math.min(books.page * PAGE_SIZE, books.total);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <PageTitle>Books</PageTitle>

            <BookFilters filters={filters} />

            {/*
             * Below the controls rather than under the heading: this line is a
             * result of the filters, so above them it described something the
             * reader had not set yet.
             *
             * "Reset filters" lives here rather than in the form so that
             * everything in this bar -- the count, the link and the list below
             * it -- reflects server state together. Inside the form it would
             * have tracked the optimistic value and disagreed with the count
             * beside it for the length of a round trip.
             */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-5 pb-2 text-sm text-iron-500">
                {/* A filter that matches nothing is reachable now that the
                    query honors them, and the range arithmetic reads "1-0 of
                    0" there. The designed empty state is the next step; this
                    only keeps the bar from printing nonsense meanwhile. */}
                <p>
                    {books.total === 0 ? (
                        'No matching books'
                    ) : (
                        <>
                            Showing {first}–{last} of {books.total} · page{' '}
                            {books.page} of {books.pageCount}
                        </>
                    )}
                </p>
                {!isDefaultFilters(filters) && (
                    <Link
                        href={BOOKS_PATH}
                        className="underline underline-offset-2 transition-colors hover:text-iron-900"
                    >
                        Reset filters
                    </Link>
                )}
            </div>

            {books.rows.length === 0 ? (
                <EmptyState filters={filters} />
            ) : (
                <BookList books={books.rows} />
            )}
            <PaginationNav
                page={books.page}
                pageCount={books.pageCount}
                params={params}
            />
        </main>
    );
}

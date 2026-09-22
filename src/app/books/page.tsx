import type { Metadata } from 'next';

import { getBooksPage } from '@/features/books/data';
import {
    parseFilters,
    parsePageParam,
    PAGE_SIZE,
} from '@/features/books/scope';
import { BookList } from '@/features/books/components/book-list';
import { PaginationNav } from '@/features/books/components/pagination-nav';

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
            <header className="px-4 pb-4">
                <h1>Books</h1>
                {/* A filter that matches nothing is reachable for the first
                    time now that the query honours them, and the range
                    arithmetic reads "1-0 of 0" there. The designed empty state
                    is the next step; this only keeps the header from printing
                    nonsense in the meantime. */}
                <p className="pt-1 text-sm text-gray-600">
                    {books.total === 0 ? (
                        'No matching books'
                    ) : (
                        <>
                            Showing {first}–{last} of {books.total} · page{' '}
                            {books.page} of {books.pageCount}
                        </>
                    )}
                </p>
            </header>
            <BookList books={books.rows} />
            <PaginationNav
                page={books.page}
                pageCount={books.pageCount}
                params={params}
            />
        </main>
    );
}

import type { Metadata } from 'next';

import { getBooksPage } from '@/features/books/data';
import { parsePageParam, PAGE_SIZE } from '@/features/books/scope';
import { BookList } from '@/features/books/components/book-list';
import { PaginationNav } from '@/features/books/components/pagination-nav';

export const metadata: Metadata = {
    title: 'Books',
};

export default async function BooksPage({ searchParams }: PageProps<'/books'>) {
    // searchParams is async in Next 16 and must be awaited before it is read.
    // The whole object is kept, not just `page`, so pagination links can carry
    // Browse M2's filters through unchanged.
    const params = await searchParams;
    const books = await getBooksPage({ page: parsePageParam(params.page) });

    const first = (books.page - 1) * PAGE_SIZE + 1;
    const last = Math.min(books.page * PAGE_SIZE, books.total);

    return (
        <main className="mx-auto max-w-3xl py-6">
            <header className="px-4 pb-4">
                <h1>Books</h1>
                <p className="pt-1 text-sm text-gray-600">
                    Showing {first}–{last} of {books.total} · page {books.page}{' '}
                    of {books.pageCount}
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

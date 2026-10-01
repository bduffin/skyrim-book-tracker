import type { Metadata } from 'next';
import Link from 'next/link';

import { getViewerId } from '@/features/auth/get-viewer-id';
import { getBooksPage } from '@/features/books/data';
import { PAGE_SIZE, parsePageParam } from '@/lib/pagination';
import {
    BOOKS_PATH,
    filtersQuery,
    isDefaultFilters,
    parseFilters,
} from '@/features/books/scope';
import { BookFilters } from '@/features/books/components/book-filters';
import { BookList } from '@/features/books/components/book-list';
import { EmptyState } from '@/features/books/components/empty-state';
import { FlagFilterNotice } from '@/features/books/components/flag-filter-notice';
import { ResultsFocus } from '@/features/books/components/results-focus';
import {
    RESULTS_ID,
    resultsAnnouncement,
    showsFlagFilterNotice,
} from '@/features/books/results-announcement';
import { PaginationNav } from '@/components/pagination-nav';
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
    const viewerId = await getViewerId();
    const books = await getBooksPage({
        page: parsePageParam(params.page),
        filters,
        viewerId,
    });

    const first = (books.page - 1) * PAGE_SIZE + 1;
    const last = Math.min(books.page * PAGE_SIZE, books.total);
    // Identifies what is on screen, so the announcement and focus recovery
    // both react to every filter or page change -- including one that leaves
    // the count the same.
    const view = `${filtersQuery(filters)}#${books.page}`;

    return (
        <main className="group/books mx-auto max-w-3xl py-6">
            <PageTitle>Books</PageTitle>

            <BookFilters filters={filters} />
            <ResultsFocus view={view} />

            {/*
             * Everything below the form is a result of it, so this is what
             * dims while a filter change is in flight -- keyed off the form's
             * aria-busy through :has(), so the server-rendered results need no
             * client state of their own. The delay applies only on the way in,
             * so a fast round trip never flickers, and clearing is immediate.
             */}
            <div className="transition-opacity group-has-aria-busy/books:opacity-60 group-has-aria-busy/books:delay-150">
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
                    {/*
                     * The count, and what a filter or page change announces
                     * (NFR-7, AC-16). Sighted readers see the line with its
                     * dash and dot; screen readers get a sentence holding the
                     * count and then the signed-out notice when it applies,
                     * so a change is one announcement rather than two racing
                     * ones. Plain text and nothing else: with the visible bar
                     * and notice as the region, links included, VoiceOver in
                     * Chromium read a search as "Reset filters reset filters,
                     * one of one, page one of one", and aria-atomic did not
                     * cure it.
                     *
                     * The region is always rendered, so a soft navigation
                     * changes its content rather than inserting a new region,
                     * which would not be read. The sentence is keyed by the
                     * view, so a change that leaves it the same -- unticking
                     * a source no matching book comes from -- still replaces
                     * it and is still announced.
                     *
                     * Focusable from script only (tabIndex -1), for
                     * ResultsFocus to land on when a link removes itself.
                     */}
                    <p
                        id={RESULTS_ID}
                        role="status"
                        aria-atomic="true"
                        tabIndex={-1}
                        className="relative rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800"
                    >
                        <span aria-hidden="true">
                            {books.total === 0 ? (
                                'No matching books'
                            ) : (
                                <>
                                    Showing {first}–{last} of {books.total} ·
                                    page {books.page} of {books.pageCount}
                                </>
                            )}
                        </span>
                        {/*
                         * Laid exactly over the visible line rather than
                         * `sr-only`, so VoiceOver's cursor outlines the count
                         * the reader can see: an sr-only box sits after the
                         * visible text, and the cursor was drawn there.
                         * Invisible by transparent text, clipped to the line;
                         * pointer-events and select-none keep the visible text
                         * beneath it clickable and selectable, and forced
                         * colors would otherwise repaint it opaque.
                         *
                         * One string, not JSX text: VoiceOver in Chromium read
                         * a line built from several text nodes as "423 1 9".
                         */}
                        <span
                            key={view}
                            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-nowrap text-transparent select-none forced-colors:[forced-color-adjust:none]"
                        >
                            {resultsAnnouncement({
                                total: books.total,
                                page: books.page,
                                pageCount: books.pageCount,
                                notice: showsFlagFilterNotice(
                                    filters,
                                    viewerId !== null,
                                ),
                            })}
                        </span>
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

                <FlagFilterNotice
                    filters={filters}
                    signedIn={viewerId !== null}
                />

                {books.rows.length === 0 ? (
                    <EmptyState filters={filters} />
                ) : (
                    <BookList books={books.rows} signedIn={viewerId !== null} />
                )}
                <PaginationNav
                    basePath={BOOKS_PATH}
                    page={books.page}
                    pageCount={books.pageCount}
                    params={params}
                />
            </div>
        </main>
    );
}

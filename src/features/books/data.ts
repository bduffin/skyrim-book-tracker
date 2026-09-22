import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
    clampPage,
    escapeLike,
    pageCountFor,
    rangeFor,
    type BookFilters,
    type FlagFilter,
} from './scope';
import type { BookCategory, BookRow, BookSource } from './types';

export type BooksPage = {
    rows: BookRow[];
    /** Rows matching the active filters, not the catalogue as a whole (MI1). */
    total: number;
    /** The page actually returned, which may be clamped from the one asked for. */
    page: number;
    pageCount: number;
};

/** Only the columns FR-1 renders; the rest of `book` is not this feature's. */
const COLUMNS = 'id, title, category, source, skill';

/**
 * What `COLUMNS` selects.
 *
 * Stated rather than inferred: supabase-js shapes a result by parsing the
 * select string, which only works when that string is a literal, and the
 * embed below makes it computed. There are no generated database types in this
 * project for it to fall back on, so the inferred row is `GenericStringError`
 * -- a type error at every field, not a silent `any`.
 */
type BookQueryRow = {
    id: string;
    title: string;
    category: BookCategory;
    source: BookSource;
    skill: string | null;
};

/**
 * How the read/collected filters reach `user_book`.
 *
 * The join shape is not a free choice -- it is forced by what PostgREST can
 * express, measured against the project rather than assumed:
 *
 * - `user_book!inner(...)` drops books with no matching row, which is what a
 *   `true` filter means.
 * - A filter on a *left*-joined embed narrows the embedded rows and leaves
 *   every parent in place. So `user_book.is_read=eq.false` does **not** mean
 *   "books this viewer has not read" -- it returns the whole catalogue.
 *
 * A `false` filter is therefore an anti-join, and PostgREST spells that as:
 * prefilter the embed down to the rows that would *contradict* the filter,
 * then keep the parents whose embed came back empty (`user_book=is.null`).
 *
 * `read=false, collected=false` prefilters on either flag rather than on row
 * existence. The `user_book_touched` check constraint makes those equivalent
 * today -- a stored row always has one flag set -- but writing the predicate
 * out keeps this correct on its own terms instead of on that constraint's.
 *
 * Note both filters share one embed, which is why they cannot be a `true` and
 * a `false` anti-join at once. They never need to be: `read=true` already
 * implies the row exists, so `collected=false` alongside it is an ordinary
 * equality on that same row.
 */
function embedFor(read: FlagFilter, collected: FlagFilter): string {
    if (read === 'any' && collected === 'any') return '';

    // `book_id` rather than the flags: this embed exists to filter, and in the
    // anti-join case it is prefiltered, so reading the flags off it would
    // under-report. Browse M3 needs a second, unfiltered embed to display them.
    const join = read === 'true' || collected === 'true' ? '!inner' : '!left';
    return `, user_book${join}(book_id)`;
}

/**
 * One page of the catalogue under FR-3's filters and FR-9's title search.
 *
 * Ordered by title and then `uesp_page_id`. Title alone is not deterministic --
 * two titles are duplicated inside the default scope -- and a non-deterministic
 * sort makes pagination drop or repeat rows between pages (FR-6).
 */
export async function getBooksPage({
    page,
    filters,
}: {
    page: number;
    filters: BookFilters;
}): Promise<BooksPage> {
    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
    const supabase = await createClient();

    const { read, collected } = filters;
    const select = `${COLUMNS}${embedFor(read, collected)}`;

    const scoped = (options?: { count: 'exact'; head: boolean }) => {
        let query = supabase
            .from('book')
            .select(select, options)
            .eq('is_obtainable', true)
            .in('category', [...filters.categories])
            .in('source', [...filters.sources]);

        if (filters.skill !== null) {
            query = query.eq('skill', filters.skill);
        }

        // Escaped so `%`, `_` and PostgREST's own `*` match literally; without
        // it a single `%` returns all 1,207 books instead of none (AC-13).
        if (filters.q !== null) {
            query = query.ilike('title', `%${escapeLike(filters.q)}%`);
        }

        if (read === 'true' || collected === 'true') {
            // Inner join: the row exists, so both flags are plain equalities.
            if (read !== 'any') {
                query = query.eq('user_book.is_read', read === 'true');
            }
            if (collected !== 'any') {
                query = query.eq(
                    'user_book.is_collected',
                    collected === 'true',
                );
            }
        } else if (read === 'false' || collected === 'false') {
            // Anti-join: prefilter the embed to the contradicting rows, then
            // keep only the books whose embed came back empty.
            const contradictions = [
                ...(read === 'false' ? ['is_read.eq.true'] : []),
                ...(collected === 'false' ? ['is_collected.eq.true'] : []),
            ];
            query = query
                .or(contradictions.join(','), { referencedTable: 'user_book' })
                .is('user_book', null);
        }

        return query;
    };

    // Counted first, in a head request that returns no rows, because the page
    // has to be clamped *before* the range is built: PostgREST answers a range
    // starting past the last row with a 416 rather than an empty list, so
    // `?page=99` would throw instead of falling back (AC-10).
    const { count, error: countError } = await scoped({
        count: 'exact',
        head: true,
    });
    if (countError) {
        console.error('Failed to count books:', countError);
        throw new Error(countError.message);
    }

    const total = count ?? 0;
    const pageCount = pageCountFor(total);
    const clamped = clampPage(page, pageCount);
    const [from, to] = rangeFor(clamped);

    const { data, error } = await scoped()
        .order('title', { ascending: true })
        .order('uesp_page_id', { ascending: true })
        .range(from, to);
    if (error) {
        console.error('Failed to load books:', error);
        throw new Error(error.message);
    }

    return {
        rows: ((data ?? []) as unknown as BookQueryRow[]).map((row) => ({
            id: row.id,
            title: row.title,
            category: row.category,
            source: row.source,
            skill: row.skill,
            // Still false for every row: Browse M2 joins user_book to *filter*
            // by it, not to display it, and the filtering embed is prefiltered
            // in the anti-join case. The toggles and the display join are M3's.
            isRead: false,
            isCollected: false,
        })),
        total,
        page: clamped,
        pageCount,
    };
}

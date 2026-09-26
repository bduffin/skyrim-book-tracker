import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { clampPage, pageCountFor, rangeFor } from '@/lib/pagination';

import { escapeLike, type BookFilters } from './scope';
import {
    applyFlagFilters,
    BOOK_COLUMNS,
    flagEmbed,
    resolveFlagFilters,
    toBookRow,
    VIEWER_FLAGS_EMBED,
    withViewerFlags,
    type BookColumnsRow,
    type ViewerFlagsEmbed,
} from './query';
import type { BookRow } from './types';

export type BooksPage = {
    rows: BookRow[];
    /** Rows matching the active filters, not the catalogue as a whole (MI1). */
    total: number;
    /** The page actually returned, which may be clamped from the one asked for. */
    page: number;
    pageCount: number;
};

/** What the list query selects: `BOOK_COLUMNS`, plus the viewer's flags. */
type BookQueryRow = BookColumnsRow & {
    /** Absent when the viewer is signed out and the embed is not selected. */
    viewer_flags?: ViewerFlagsEmbed;
};

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
    viewerId,
}: {
    page: number;
    filters: BookFilters;
    /** From `getViewerId()`; `null` renders every row untouched (FR-2). */
    viewerId: string | null;
}): Promise<BooksPage> {
    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
    const supabase = await createClient();

    const flags = resolveFlagFilters(filters.read, filters.collected, viewerId);
    // A signed-out visitor filtering on read or collected books: nothing can
    // match, and asking the database would only hand the answer to RLS.
    if (flags === null) return { rows: [], total: 0, page: 1, pageCount: 1 };

    const { read, collected } = flags;
    const filterSelect = `${BOOK_COLUMNS}${flagEmbed(read, collected)}`;

    const scoped = (
        select: string,
        options?: { count: 'exact'; head: boolean },
    ) => {
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

        return applyFlagFilters(query, read, collected, viewerId);
    };

    // Counted first, in a head request that returns no rows, because the page
    // has to be clamped *before* the range is built: PostgREST answers a range
    // starting past the last row with a 416 rather than an empty list, so
    // `?page=99` would throw instead of falling back (AC-10).
    const { count, error: countError } = await scoped(filterSelect, {
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

    // Only the page of rows needs the displayed flags, not the count above.
    // A signed-out viewer has no row to display, so the join is skipped
    // rather than made and coalesced away.
    const rows =
        viewerId === null
            ? scoped(filterSelect)
            : withViewerFlags(
                  scoped(`${filterSelect}${VIEWER_FLAGS_EMBED}`),
                  viewerId,
              );

    const { data, error } = await rows
        .order('title', { ascending: true })
        .order('uesp_page_id', { ascending: true })
        .range(from, to);
    if (error) {
        console.error('Failed to load books:', error);
        throw new Error(error.message);
    }

    return {
        rows: ((data ?? []) as unknown as BookQueryRow[]).map((row) =>
            toBookRow(row, row.viewer_flags),
        ),
        total,
        page: clamped,
        pageCount,
    };
}

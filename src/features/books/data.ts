import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
    DEFAULT_CATEGORIES,
    DEFAULT_SOURCES,
    clampPage,
    pageCountFor,
    rangeFor,
} from './scope';
import type { BookRow } from './types';

export type BooksPage = {
    rows: BookRow[];
    /** Rows in the default scope, not in the catalogue as a whole (MI1). */
    total: number;
    /** The page actually returned, which may be clamped from the one asked for. */
    page: number;
    pageCount: number;
};

/** Only the columns FR-1 renders; the rest of `book` is not this feature's. */
const COLUMNS = 'id, title, category, source, skill';

/**
 * One page of the catalogue, scoped to FR-3's defaults.
 *
 * Ordered by title and then `uesp_page_id`. Title alone is not deterministic --
 * two titles are duplicated inside the default scope -- and a non-deterministic
 * sort makes pagination drop or repeat rows between pages (FR-6).
 */
export async function getBooksPage({
    page,
}: {
    page: number;
}): Promise<BooksPage> {
    // Per-request, never module scope: a cached client can leak one user's
    // session into another request under Vercel's Fluid compute.
    const supabase = await createClient();

    const scoped = (options?: { count: 'exact'; head: boolean }) =>
        supabase
            .from('book')
            .select(COLUMNS, options)
            .eq('is_obtainable', true)
            .in('category', [...DEFAULT_CATEGORIES])
            .in('source', [...DEFAULT_SOURCES]);

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
        rows: (data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            category: row.category,
            source: row.source,
            skill: row.skill,
            // Browse M1 does not join user_book at all. Both false is what FR-2
            // specifies for an anonymous visitor, not a placeholder for M3.
            isRead: false,
            isCollected: false,
        })),
        total,
        page: clamped,
        pageCount,
    };
}

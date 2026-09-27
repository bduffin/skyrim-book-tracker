import 'server-only';

import type { BooksPage } from '@/features/books/data';
import {
    toBookRow,
    type BookColumnsRow,
    type ViewerFlagsEmbed,
} from '@/features/books/query';
import { clampPage, pageCountFor, rangeFor } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

import { markedBooksQuery } from './marked';
import {
    DEFAULT_PROGRESS_SCOPE,
    flagCountQuery,
    totalCountQuery,
    type ProgressSummary,
} from './progress';

/**
 * A user's progress summary (FR-5), from the database on every render --
 * never from anything a client has cached -- so it reflects true state after
 * any change (NFR-6).
 *
 * Three head requests in parallel rather than one: each is a count PostgREST
 * can answer directly, and none waits on another.
 */
export async function getProgress(
    userId: string,
    scope = DEFAULT_PROGRESS_SCOPE,
): Promise<ProgressSummary> {
    const supabase = await createClient();

    const [total, collected, read] = await Promise.all([
        totalCountQuery(supabase, scope),
        flagCountQuery(supabase, userId, 'collected', scope),
        flagCountQuery(supabase, userId, 'read', scope),
    ]);

    for (const { error } of [total, collected, read]) {
        if (error) {
            console.error('Failed to count progress:', error);
            throw new Error(error.message);
        }
    }

    return {
        scope,
        total: total.count ?? 0,
        collected: collected.count ?? 0,
        read: read.count ?? 0,
    };
}

/**
 * One page of the books `userId` has marked (FR-8), in the catalogue's own
 * order -- title, then `uesp_page_id` -- so pagination is deterministic (FR-6).
 *
 * Counted before the range is built, for the reason `getBooksPage` gives: a
 * range past the last row is a 416 from PostgREST, not an empty list, and
 * here the last row can vanish between renders -- unmarking a book on the
 * final page removes it -- so clamping matters more, not less.
 */
export async function getMarkedBooksPage({
    userId,
    page,
}: {
    userId: string;
    page: number;
}): Promise<BooksPage> {
    const supabase = await createClient();

    const { count, error: countError } = await markedBooksQuery(
        supabase,
        userId,
        { count: 'exact', head: true },
    );
    if (countError) {
        console.error('Failed to count marked books:', countError);
        throw new Error(countError.message);
    }

    const total = count ?? 0;
    const pageCount = pageCountFor(total);
    const clamped = clampPage(page, pageCount);
    const [from, to] = rangeFor(clamped);

    const { data, error } = await markedBooksQuery(supabase, userId)
        .order('title', { ascending: true })
        .order('uesp_page_id', { ascending: true })
        .range(from, to);
    if (error) {
        console.error('Failed to load marked books:', error);
        throw new Error(error.message);
    }

    type MarkedRow = BookColumnsRow & { marked: ViewerFlagsEmbed };
    return {
        rows: ((data ?? []) as unknown as MarkedRow[]).map((row) =>
            toBookRow(row, row.marked),
        ),
        total,
        page: clamped,
        pageCount,
    };
}

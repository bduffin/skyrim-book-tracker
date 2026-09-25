/**
 * The progress summary's counts (FR-5): how many books are in the default
 * scope, and how many of those one user has collected and has read.
 *
 * Query builders only -- this module creates no client and performs no I/O,
 * which is why it carries no `server-only` and can be driven by the database
 * test directly, the same arrangement as `src/features/books/query.ts`.
 *
 * **Every count is over the same scope.** `<total>` is FR-3's default scope,
 * not `count(book)`, so the collected and read counts have to be limited to it
 * as well: a collected Creation Club note counted in the numerator but not the
 * denominator would let a meter pass 100%. That includes `is_obtainable`,
 * which `getBooksPage` applies to every list and the defaults do not name.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_CATEGORIES, DEFAULT_SOURCES } from '@/features/books/scope';

export type ProgressSummary = {
    /** Books in FR-3's default scope; computed, never hardcoded (MI1). */
    total: number;
    collected: number;
    read: number;
};

/** A head request over the default scope: it returns a count and no rows. */
function scopedCount(supabase: SupabaseClient, select: string) {
    return supabase
        .from('book')
        .select(select, { count: 'exact', head: true })
        .eq('is_obtainable', true)
        .in('category', [...DEFAULT_CATEGORIES])
        .in('source', [...DEFAULT_SOURCES]);
}

/** Counts the default scope itself. */
export function totalCountQuery(supabase: SupabaseClient) {
    return scopedCount(supabase, 'id');
}

const FLAG_COLUMNS = {
    collected: 'is_collected',
    read: 'is_read',
} as const;

/**
 * Counts the books in the default scope that `userId` has collected, or read.
 *
 * The `user_book` embed is `!inner`, so a book with no matching row drops out
 * of the count, and it is aliased, so no filter addresses it by its table name
 * (see `src/features/books/query.ts` on PostgREST#4075).
 *
 * Limited to `userId` explicitly rather than left to RLS: once FR-10 lets
 * anyone read a public user's rows, an unscoped count would add up every
 * public user's progress. The parameter names whose progress this is, not who
 * is looking -- on a public collection page those will differ.
 */
export function flagCountQuery(
    supabase: SupabaseClient,
    userId: string,
    flag: keyof typeof FLAG_COLUMNS,
) {
    return scopedCount(supabase, 'id, progress:user_book!inner(book_id)')
        .eq('progress.user_id', userId)
        .eq(`progress.${FLAG_COLUMNS[flag]}`, true);
}

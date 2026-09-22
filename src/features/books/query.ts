/**
 * How the read/collected filters reach `user_book`.
 *
 * Split out of `data.ts` so the database test can drive the *same* code the
 * app does. A test that re-implements this branch would only prove the
 * re-implementation consistent with itself, which is the failure mode
 * `scripts/lib/uesp-parse.test.mts` describes: an implementation can be
 * confidently wrong, and a copy of it agrees.
 *
 * No `server-only` here, and deliberately so -- this module creates no client
 * and performs no I/O. It shapes a query builder it is handed. NFR-3's rule is
 * about Client Components reaching the database, and nothing here can.
 *
 * The join shape is not a free choice. It is forced by what PostgREST can
 * express, measured against a real stack rather than assumed:
 *
 * - `user_book!inner(...)` drops books with no matching row, which is what a
 *   `true` filter means.
 * - A filter on a *left*-joined embed narrows the embedded rows and leaves
 *   every parent in place. So `user_book.is_read=eq.false` does **not** mean
 *   "books this viewer has not read" -- it returns the whole catalog.
 *
 * A `false` filter is therefore an anti-join, which PostgREST spells as:
 * prefilter the embed down to the rows that would *contradict* the filter,
 * then keep the parents whose embed came back empty (`user_book=is.null`).
 */

import type { FlagFilter } from './scope';

/**
 * The `user_book` embed a pair of flag filters needs, including the leading
 * comma, or an empty string when neither flag is filtered.
 *
 * Selects `book_id` rather than the flags: this embed exists to filter, and in
 * the anti-join case it is prefiltered, so reading the flags off it would
 * under-report a book whose row exists but does not match. Browse M3 needs a
 * second, unfiltered embed to display them.
 */
export function flagEmbed(read: FlagFilter, collected: FlagFilter): string {
    if (read === 'any' && collected === 'any') return '';

    const join = read === 'true' || collected === 'true' ? '!inner' : '!left';
    return `, user_book${join}(book_id)`;
}

/**
 * The subset of a PostgREST filter builder this module touches.
 *
 * Structural rather than imported from `@supabase/postgrest-js`: the client is
 * untyped in this project, so the real builder's generics carry no information
 * worth threading through, and naming only the three methods used keeps a test
 * double honest.
 */
export type FlagQuery<Q> = {
    eq(column: string, value: boolean): Q;
    is(column: string, value: null): Q;
    or(filters: string, options: { referencedTable: string }): Q;
};

/**
 * Applies the read/collected predicates to a query already carrying
 * `flagEmbed`'s select.
 *
 * Both filters share one embed, which is why they cannot be a `true` and a
 * `false` anti-join at once. They never need to be: `read=true` already
 * implies the row exists, so `collected=false` alongside it is an ordinary
 * equality on that same row.
 */
export function applyFlagFilters<Q extends FlagQuery<Q>>(
    query: Q,
    read: FlagFilter,
    collected: FlagFilter,
): Q {
    if (read === 'true' || collected === 'true') {
        // Inner join: the row exists, so both flags are plain equalities.
        let next = query;
        if (read !== 'any')
            next = next.eq('user_book.is_read', read === 'true');
        if (collected !== 'any') {
            next = next.eq('user_book.is_collected', collected === 'true');
        }
        return next;
    }

    if (read === 'false' || collected === 'false') {
        // Anti-join. `read=false, collected=false` prefilters on *either* flag
        // rather than on row existence: the `user_book_touched` check
        // constraint makes those equivalent today, since a stored row always
        // has one flag set, but writing the predicate out keeps this correct
        // on its own terms instead of on that constraint's.
        const contradictions = [
            ...(read === 'false' ? ['is_read.eq.true'] : []),
            ...(collected === 'false' ? ['is_collected.eq.true'] : []),
        ];
        return query
            .or(contradictions.join(','), { referencedTable: 'user_book' })
            .is('user_book', null);
    }

    return query;
}

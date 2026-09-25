/**
 * How the book list reaches `user_book`: the read/collected filters, and the
 * viewer's own flags that each row displays.
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
 * An *embed* is PostgREST's nested join ("resource embedding",
 * https://docs.postgrest.org/en/stable/references/api/resource_embedding.html).
 * `viewer_flags:user_book(is_read, is_collected)` in a `book` select returns
 * each book once, with its matching `user_book` rows as an array inside it,
 * where a flat SQL join would repeat the book once per row. The difference that
 * matters here: a filter on an embed trims that array and leaves the book in
 * place, unless `!inner` or `is.null` says otherwise.
 *
 * So the join shape is not a free choice. It is forced by what PostgREST can
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
 * then keep the parents whose embed came back empty (`flag_filter=is.null`).
 *
 * **Both `user_book` embeds are aliased, and every filter addresses them by
 * alias.** The list embeds the table twice -- once here to filter, once in
 * `VIEWER_FLAGS_EMBED` to display -- and PostgREST lets an aliased embed still
 * be addressed by its table name, so a filter written as `user_book.*` also
 * matches `viewer_flags:user_book`. With the filtering embed left bare,
 * `user_book.or=(is_read.eq.true)` emptied the display embed and `read=false`
 * came back with no rows at all (measured on 14.5). This is PostgREST#4075,
 * https://github.com/PostgREST/postgrest/issues/4075: 16.0 deprecates
 * addressing an aliased embed by its table name, and only
 * `url-use-legacy-target-names = false` turns the old behavior off. Addressing
 * embeds only by alias gives the same results before, during and after that
 * change.
 */

import type { FlagFilter } from './scope';

/** `flagEmbed`'s alias, which every predicate below addresses it by. */
const FLAG_FILTER = 'flag_filter';

/**
 * The `user_book` embed a pair of flag filters needs, including the leading
 * comma, or an empty string when neither flag is filtered.
 *
 * Selects `book_id` rather than the flags: this embed exists to filter, and in
 * the anti-join case it is prefiltered, so reading the flags off it would
 * under-report a book whose row exists but does not match. The flags a row
 * *displays* come from `VIEWER_FLAGS_EMBED` instead.
 */
export function flagEmbed(read: FlagFilter, collected: FlagFilter): string {
    if (read === 'any' && collected === 'any') return '';

    const join = read === 'true' || collected === 'true' ? '!inner' : '!left';
    return `, ${FLAG_FILTER}:user_book${join}(book_id)`;
}

/**
 * The read/collected filters as they apply to one viewer, or `null` when they
 * match no book at all.
 *
 * Only a signed-in viewer's filters need the database. A signed-out visitor
 * has read and collected nothing (FR-2), so their answer is known up front: a
 * `true` filter matches no book, and a `false` one matches every book and is
 * no filter at all. Deciding that here rather than letting RLS decide it
 * matters because RLS only gives that answer while it hides every row from
 * `anon` -- FR-10's public-read policy will let `anon` see public users' rows,
 * and a `read=true` resolved by the database would then match books that
 * *anyone* has read.
 */
export function resolveFlagFilters(
    read: FlagFilter,
    collected: FlagFilter,
    viewerId: string | null,
): { read: FlagFilter; collected: FlagFilter } | null {
    if (viewerId !== null) return { read, collected };
    if (read === 'true' || collected === 'true') return null;
    return { read: 'any', collected: 'any' };
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
    eq(column: string, value: boolean | string): Q;
    is(column: string, value: null): Q;
    or(filters: string, options: { referencedTable: string }): Q;
};

/**
 * Applies the read/collected predicates to a query already carrying
 * `flagEmbed`'s select, for one viewer's own rows.
 *
 * Scoped to the viewer explicitly, as `withViewerFlags` is, rather than left
 * to RLS: once FR-10 lets anyone read a public user's rows, an unscoped embed
 * would make `read=true` match books any public user has read. Takes filters
 * already through `resolveFlagFilters`, which is what leaves a signed-out
 * visitor with nothing to scope; a flag filter arriving with no viewer means
 * that step was skipped, so it throws rather than quietly falling back to RLS.
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
    viewerId: string | null,
): Q {
    if (read === 'any' && collected === 'any') return query;
    if (viewerId === null) {
        throw new Error(
            'A read/collected filter needs a viewer; resolve it with ' +
                'resolveFlagFilters first.',
        );
    }

    // Both branches below filter this same embed, so pinning it to the viewer
    // once covers the inner join and the anti-join alike: the anti-join then
    // looks for the viewer's own contradicting row, not anybody's.
    const own = query.eq(`${FLAG_FILTER}.user_id`, viewerId);

    if (read === 'true' || collected === 'true') {
        // Inner join: the row exists, so both flags are plain equalities.
        let next = own;
        if (read !== 'any')
            next = next.eq(`${FLAG_FILTER}.is_read`, read === 'true');
        if (collected !== 'any') {
            next = next.eq(`${FLAG_FILTER}.is_collected`, collected === 'true');
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
        return own
            .or(contradictions.join(','), { referencedTable: FLAG_FILTER })
            .is(FLAG_FILTER, null);
    }

    return own;
}

/**
 * The embed a row's displayed flags are read from (FR-1), including the
 * leading comma.
 *
 * A second embed of `user_book` rather than a reuse of `flagEmbed`'s, which is
 * prefiltered in the anti-join case and would under-report. Aliased, as
 * `flagEmbed`'s is -- see the top of this file for what happens when only one
 * of the two has an alias. Unfiltered by the flags, and never `!inner` -- a
 * book with no row must still come back, as untouched.
 */
export const VIEWER_FLAGS_EMBED =
    ', viewer_flags:user_book(is_read, is_collected)';

/** What `VIEWER_FLAGS_EMBED` returns: a to-many embed, so always an array. */
export type ViewerFlagsEmbed = { is_read: boolean; is_collected: boolean }[];

/** The subset of a PostgREST filter builder `withViewerFlags` touches. */
export type ViewerQuery<Q> = {
    eq(column: string, value: string): Q;
};

/**
 * Narrows `VIEWER_FLAGS_EMBED` to the viewer's own row.
 *
 * RLS does this today -- `user_book_select_own` admits only the caller's rows
 * -- but FR-10 will add a policy letting anyone read a *public* user's rows,
 * and from then on an unscoped embed would return every public user's flags
 * for each book, with nothing erroring. Filtering on an embedded column narrows
 * the embedded rows and leaves every book in place (the same PostgREST
 * behaviour the anti-join works around), which is exactly what this wants.
 */
export function withViewerFlags<Q extends ViewerQuery<Q>>(
    query: Q,
    viewerId: string,
): Q {
    return query.eq('viewer_flags.user_id', viewerId);
}

/**
 * A row's displayed flags, coalescing an absent `user_book` row -- or a
 * signed-out viewer, for whom the embed is never selected -- to untouched
 * (Decision #4).
 *
 * At most one row can match: `withViewerFlags` pins the user and
 * `(user_id, book_id)` is the primary key.
 */
export function readViewerFlags(embed: ViewerFlagsEmbed | undefined): {
    isRead: boolean;
    isCollected: boolean;
} {
    const [row] = embed ?? [];
    return {
        isRead: row?.is_read ?? false,
        isCollected: row?.is_collected ?? false,
    };
}

/**
 * The collection page's list: every book one user has marked read or
 * collected (FR-8).
 *
 * A query builder only, like `progress.ts`, so the database test drives the
 * same code the page does.
 *
 * **Every marked book, in any category or source** -- not only the default
 * scope the progress meters count. A marked Creation Club note is still the
 * user's data, and hiding it would leave them no way to see or unmark it
 * short of hunting it down in the filtered catalogue. So the list can hold
 * more books than the meters count, deliberately (FR-8).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { BOOK_COLUMNS } from '@/features/books/query';

/**
 * The user's own `user_book` rows. `!inner`, because being marked is what puts
 * a book on this list at all; aliased, so no filter addresses it by its table
 * name (`src/features/books/query.ts` on PostgREST#4075). It carries the flags
 * each row displays, and since the list is exactly the marked books, it can:
 * there is no filtering embed here to under-report.
 */
const MARKED_EMBED = ', marked:user_book!inner(is_read, is_collected)';

/**
 * Books `userId` has marked. Limited to `userId` explicitly rather than left to
 * RLS: once FR-10 lets anyone read a public user's rows, an unscoped list would
 * show every public user's books. `userId` names whose collection this is, not
 * who is looking.
 */
export function markedBooksQuery(
    supabase: SupabaseClient,
    userId: string,
    options?: { count: 'exact'; head: boolean },
) {
    // Annotated as a plain string: inferred as a template-literal type, the
    // select sends supabase-js's parser past tsc's depth limit (TS2589).
    const select: string = `${BOOK_COLUMNS}${MARKED_EMBED}`;
    return supabase
        .from('book')
        .select(select, options)
        .eq('marked.user_id', userId);
}

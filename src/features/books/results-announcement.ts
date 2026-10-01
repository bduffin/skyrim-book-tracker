import { hasFlagFilter, type BookFilters } from './scope';

/**
 * The id of the results count line, which takes focus when a soft navigation
 * removes the focused element. Here rather than beside `ResultsFocus`: a
 * Server Component importing a value from a 'use client' module gets a client
 * reference, not the string.
 */
export const RESULTS_ID = 'results';

/**
 * The signed-out flag-filter notice's explanation (FR-2), shared by the
 * visible notice and the results announcement so the two cannot drift.
 */
export const FLAG_FILTER_NOTICE =
    'Read and Collected filter by your own tracking. You’re signed out, so for now no book counts as read or collected.';

/** Whether the signed-out flag-filter notice applies to this view (FR-2). */
export function showsFlagFilterNotice(
    filters: BookFilters,
    signedIn: boolean,
): boolean {
    return !signedIn && hasFlagFilter(filters);
}

/**
 * What a screen reader hears after a filter or page change (NFR-7, AC-16):
 * the result count, then the flag-filter notice when it applies.
 *
 * Written as a sentence rather than read off the visible count line, whose
 * en dash and middle dot are layout, not words. The page number is left out
 * when there is only one page, where it says nothing.
 */
export function resultsAnnouncement({
    total,
    page,
    pageCount,
    notice,
}: {
    total: number;
    page: number;
    pageCount: number;
    notice: boolean;
}): string {
    const count =
        total === 0
            ? 'No books match.'
            : `${total} ${total === 1 ? 'book matches' : 'books match'}${
                  pageCount > 1 ? `, page ${page} of ${pageCount}` : ''
              }.`;

    return notice ? `${count} ${FLAG_FILTER_NOTICE}` : count;
}

import Link from 'next/link';

import { BOOKS_PATH, isDefaultFilters, type BookFilters } from '../scope';

/**
 * What `/books` shows when nothing matches (OQ-7).
 *
 * A sibling of the results bar rather than a mode of the list: both are
 * rendered by the page, which already owns the resolved filters, so the list
 * stays a component that renders the rows it is handed.
 *
 * Filters made zero results reachable for the first time at Browse M2, and a
 * dead end with no way out of it is the actual failure -- so the way back
 * matters more than the wording. It says "Reset filters" rather than "Clear
 * all filters" because `/books` is FR-3's *default scope*, not the absence of
 * filtering: the category and source allowlists still apply there, so "clear
 * all" would describe a view this app never renders.
 *
 * There is deliberately a second reset link here even though the results bar
 * above carries one. They read differently -- that one is a persistent control
 * sitting beside the count, this one is a way out offered at the point the
 * reader has hit the dead end -- and the bar's can be scrolled past once the
 * filter panel is tall.
 *
 * The search term is named back when there is one, which is what catches a
 * typo. The active filters are not: assembling readable prose for every
 * combination of six controls is a lot of copy to get subtly wrong, for a case
 * the controls immediately above are already showing.
 */
export function EmptyState({ filters }: { filters: BookFilters }) {
    return (
        <div className="border-y border-gray-100 px-4 py-12 text-center">
            <p className="text-gray-900">
                {filters.q !== null ? (
                    <>No books match “{filters.q}” with these filters.</>
                ) : (
                    <>No books match these filters.</>
                )}
            </p>
            {/*
             * Suppressed under the default scope. That cannot happen against a
             * populated catalog -- the defaults always match 423 books -- but
             * on a stack where the import has not run, `/books` renders zero
             * with no filters applied, and there a reset link would promise
             * something it cannot deliver.
             */}
            {!isDefaultFilters(filters) && (
                <p className="pt-2 text-sm text-gray-600">
                    <Link
                        href={BOOKS_PATH}
                        className="underline underline-offset-2 transition-colors hover:text-gray-900"
                    >
                        Reset filters
                    </Link>{' '}
                    to return to the full catalog.
                </p>
            )}
        </div>
    );
}

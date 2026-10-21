import Link from 'next/link';

import { SignInLink } from '@/features/auth/components/sign-in-link';

import {
    FLAG_FILTER_NOTICE,
    showsFlagFilterNotice,
} from '../results-announcement';
import { filtersHref, withoutFlagFilters, type BookFilters } from '../scope';

/**
 * Tells a signed-out visitor that the read and collected filters answer from
 * their own tracking (FR-2): with none, `read=true` matches nothing and
 * `read=false` matches everything. Shown whenever one is set, not only when
 * the list is empty -- `read=false` lists every book and looks right, which
 * is the case that most needs saying.
 *
 * Not a live region: the page's results announcement carries this sentence
 * after the count (`resultsAnnouncement`), so a filter change is one
 * announcement rather than two racing ones. Announcing is the only way to
 * reach the reader at that moment -- focus stays on the radio they just
 * changed, so a description attached to the filter group would not be read
 * again. The visible copy stays readable, because a screen reader user who
 * reaches these links by reading the page needs the sentence before them.
 *
 * Two ways out: sign in, which returns to this same URL (`loginPageNext`),
 * or the same view without just these two filters -- unlike "Reset filters",
 * which drops everything.
 */
export function FlagFilterNotice({
    filters,
    signedIn,
}: {
    filters: BookFilters;
    signedIn: boolean;
}) {
    const shown = showsFlagFilterNotice(filters, signedIn);

    return (
        <div className="px-4">
            {shown && (
                <div className="mb-3 rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm text-steel-800">
                    <p>{FLAG_FILTER_NOTICE}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <SignInLink tone="inline" />
                        <Link
                            href={filtersHref(withoutFlagFilters(filters))}
                            className="underline underline-offset-2 transition-colors hover:text-iron-900"
                        >
                            Show without these filters
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}

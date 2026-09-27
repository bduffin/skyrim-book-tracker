import Link from 'next/link';

import { GitHubLoginButton } from '@/features/auth/components/github-login-button';

import {
    filtersHref,
    hasFlagFilter,
    withoutFlagFilters,
    type BookFilters,
} from '../scope';

/**
 * Tells a signed-out visitor that the read and collected filters answer from
 * their own tracking (FR-2): with none, `read=true` matches nothing and
 * `read=false` matches everything. Shown whenever one is set, not only when
 * the list is empty -- `read=false` lists every book and looks right, which
 * is the case that most needs saying.
 *
 * The wrapper is a polite live region that is always rendered, so the notice
 * is announced when a filter change brings it in. Focus stays on the radio
 * the reader just changed, so a description attached to the filter group
 * would not be read again at that moment.
 *
 * Two ways out: sign in, which returns to this same URL (`return-path.ts`),
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
    const shown = !signedIn && hasFlagFilter(filters);

    return (
        <div role="status" className="px-4">
            {shown && (
                <div className="mb-3 rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm text-steel-800">
                    <p>
                        Read and Collected filter by your own tracking. You’re
                        signed out, so for now no book counts as read or
                        collected.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <GitHubLoginButton tone="inline" />
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

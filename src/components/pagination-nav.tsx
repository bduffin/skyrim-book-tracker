import Link from 'next/link';

import { pageQuery, paginationItems } from '@/lib/pagination';
import type { SearchParams } from '@/lib/search-params';

function hrefFor(basePath: string, page: number, params: SearchParams) {
    const query = pageQuery(page, params);
    return query ? `${basePath}?${query}` : basePath;
}

const SLOT =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm';
const LINK = `${SLOT} border border-frost-300 bg-white text-iron-600 transition-colors hover:bg-frost-100`;
const CURRENT = `${SLOT} border border-iron-900 bg-iron-900 font-medium text-frost-50`;
const DISABLED = `${SLOT} border border-frost-200 text-frost-300`;

/**
 * Pagination for the book list (FR-6).
 *
 * Plain links, never buttons with handlers: paging is a navigation, so it works
 * with JavaScript disabled and the browser gets real history and
 * open-in-new-tab for free (architecture.md section 9).
 *
 * Previous/Next render as spans at the ends rather than as disabled links,
 * so they are not focusable when there is nothing to activate.
 *
 * `basePath` is the route being paged, so `/books` and `/collection/[user]`
 * (FR-8) can share this; every other param is carried through unchanged.
 */
export function PaginationNav({
    basePath,
    page,
    pageCount,
    params,
}: {
    basePath: string;
    page: number;
    pageCount: number;
    params: SearchParams;
}) {
    if (pageCount <= 1) return null;

    return (
        <nav
            aria-label="Pagination"
            className="flex flex-wrap items-center justify-center gap-1.5 px-4 py-6"
        >
            {page > 1 ? (
                <Link
                    href={hrefFor(basePath, page - 1, params)}
                    rel="prev"
                    className={LINK}
                >
                    Previous
                </Link>
            ) : (
                <span className={DISABLED}>Previous</span>
            )}

            {paginationItems(page, pageCount).map((item, i) =>
                item === 'gap' ? (
                    <span
                        key={`gap-${i}`}
                        aria-hidden="true"
                        className={`${SLOT} text-iron-500`}
                    >
                        …
                    </span>
                ) : item === page ? (
                    <span key={item} aria-current="page" className={CURRENT}>
                        {item}
                    </span>
                ) : (
                    <Link
                        key={item}
                        href={hrefFor(basePath, item, params)}
                        aria-label={`Page ${item}`}
                        className={LINK}
                    >
                        {item}
                    </Link>
                ),
            )}

            {page < pageCount ? (
                <Link
                    href={hrefFor(basePath, page + 1, params)}
                    rel="next"
                    className={LINK}
                >
                    Next
                </Link>
            ) : (
                <span className={DISABLED}>Next</span>
            )}
        </nav>
    );
}

import Link from 'next/link';

import {
    BOOKS_PATH,
    pageQuery,
    paginationItems,
    type SearchParams,
} from '../scope';

function hrefFor(page: number, params: SearchParams) {
    const query = pageQuery(page, params);
    return query ? `${BOOKS_PATH}?${query}` : BOOKS_PATH;
}

const SLOT =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm';
const LINK = `${SLOT} border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50`;
const CURRENT = `${SLOT} border border-gray-900 bg-gray-900 font-medium text-white`;
const DISABLED = `${SLOT} border border-gray-100 text-gray-300`;

/**
 * Pagination for the book list (FR-6).
 *
 * Plain links, never buttons with handlers: paging is a navigation, so it works
 * with JavaScript disabled and the browser gets real history and
 * open-in-new-tab for free (architecture.md section 9).
 *
 * Previous/Next render as spans at the ends rather than as disabled links,
 * so they are not focusable when there is nothing to activate.
 */
export function PaginationNav({
    page,
    pageCount,
    params,
}: {
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
                    href={hrefFor(page - 1, params)}
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
                        className={`${SLOT} text-gray-400`}
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
                        href={hrefFor(item, params)}
                        aria-label={`Page ${item}`}
                        className={LINK}
                    >
                        {item}
                    </Link>
                ),
            )}

            {page < pageCount ? (
                <Link
                    href={hrefFor(page + 1, params)}
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

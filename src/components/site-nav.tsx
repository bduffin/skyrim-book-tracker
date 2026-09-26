'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BOOKS_PATH } from '@/features/books/scope';

import { navSectionFor, type NavSection } from './site-nav-state';

/**
 * The secondary nav under the header: linking the catalog and, when signed in,
 * the viewer's own collection (FR-8).
 *
 * A Client Component only for `usePathname`, which is what marks the current
 * link; the links themselves are plain navigations.
 *
 * "My collection" is left out when signed out rather than shown: it would only
 * bounce the visitor straight back to /books.
 */
export function SiteNav({ collectionHref }: { collectionHref: string | null }) {
    const current = navSectionFor(usePathname());

    return (
        <nav
            aria-label="Main"
            // The light counterpart to the iron header: white, as the filter
            // panel is, with an explicit border colour, since Tailwind v4's
            // default is currentColor.
            className="border-b border-frost-300 bg-white px-4"
        >
            <ul className="flex gap-x-6">
                <NavLink href={BOOKS_PATH} section="books" current={current}>
                    Books
                </NavLink>
                {collectionHref !== null && (
                    <NavLink
                        href={collectionHref}
                        section="collection"
                        current={current}
                    >
                        My collection
                    </NavLink>
                )}
            </ul>
        </nav>
    );
}

/**
 * One link. The current one is marked two ways at once: `aria-current` for
 * assistive technology, and on screen a heavier weight with an iron-900
 * underline -- not colour alone, and a text decoration rather than a border,
 * which forced-colors mode repaints in the link's own system colour instead
 * of erasing.
 */
function NavLink({
    href,
    section,
    current,
    children,
}: {
    href: string;
    section: NavSection;
    current: NavSection | null;
    children: ReactNode;
}) {
    const isCurrent = section === current;
    return (
        <li>
            <Link
                href={href}
                aria-current={isCurrent ? 'page' : undefined}
                // `py-2.5` makes each link a 40px-tall target, well past WCAG
                // 2.5.8's 24px.
                className={`inline-block rounded-sm py-2.5 text-sm underline-offset-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800 ${
                    isCurrent
                        ? 'font-medium text-iron-900 underline decoration-iron-900 decoration-2'
                        : 'text-iron-600 hover:text-iron-900 hover:underline hover:decoration-frost-300 hover:decoration-2'
                }`}
            >
                {children}
            </Link>
        </li>
    );
}

/**
 * Which section of the site a path belongs to, for the secondary nav's
 * `aria-current`. Pure, so it is unit-tested apart from the component.
 */

export type NavSection = 'books' | 'collection';

/**
 * The section `pathname` is in, or `null` for a page in neither (the auth
 * error page, say), which marks no link as current.
 *
 * Matched on whole path segments, never a bare prefix: `/bookshelf` is not
 * `/books`. Any collection counts as the collection section; the nav only
 * ever links the viewer's own, and until FR-10 that is the only one a viewer
 * can open.
 */
export function navSectionFor(pathname: string): NavSection | null {
    const [first] = pathname.split('/').filter(Boolean);
    if (first === 'books') return 'books';
    if (first === 'collection') return 'collection';
    return null;
}

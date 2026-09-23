/**
 * Domain types for the book catalogue.
 *
 * Separate from `data.ts` because that module imports `server-only`, which
 * throws outside a React Server Component environment -- anything a test or a
 * Client Component has to see cannot live there.
 */

/** The six categories `book_category_valid` enforces. */
export type BookCategory =
    'skill_book' | 'book' | 'journal' | 'note' | 'black_book' | 'treasure_map';

/** The five sources `book_source_valid` enforces. */
export type BookSource =
    'base' | 'dawnguard' | 'dragonborn' | 'hearthfire' | 'creation_club';

/**
 * One row of the book list (FR-1).
 *
 * `isRead`/`isCollected` are coalesced from the viewer's `user_book` row, which
 * is absent for an untouched book. Browse M1 has no user join at all, so both
 * are `false` for every row -- which is what FR-2 specifies for an anonymous
 * visitor, rather than a placeholder waiting on M3.
 */
export type BookRow = {
    id: string;
    title: string;
    category: BookCategory;
    source: BookSource;
    skill: string | null;
    /** The UESP page this row was imported from, for the outbound link (FR-7). */
    uespTitle: string;
    isRead: boolean;
    isCollected: boolean;
};

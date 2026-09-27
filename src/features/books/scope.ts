/**
 * The pure half of the browse query: which books are in scope by default, and
 * how `/books`' filter params are read and written. The pagination arithmetic
 * that used to live here is shared with the collection page, so it moved to
 * `src/lib/pagination.ts`.
 *
 * Split from `data.ts` deliberately. That module imports `server-only`, which
 * resolves to a module that throws outside a React Server Component
 * environment, so `node:test` cannot import it -- anything worth asserting has
 * to live here instead (architecture.md section 11).
 */

import type { SearchParams } from '@/lib/search-params';

import type { BookCategory, BookSource } from './types';

/**
 * FR-3's default category allowlist. An allowlist rather than a blocklist so a
 * seventh category added later defaults *off*, instead of silently widening
 * every player's completion denominator.
 */
export const DEFAULT_CATEGORIES: readonly BookCategory[] = [
    'skill_book',
    'book',
    'black_book',
];

/** FR-3's default source allowlist: everything except Creation Club. */
export const DEFAULT_SOURCES: readonly BookSource[] = [
    'base',
    'dawnguard',
    'dragonborn',
    'hearthfire',
];

/**
 * Every category `book_category_valid` enforces, in the order the filter
 * control offers them: FR-3's defaults first, then the opt-ins. The list comes
 * from the check constraint rather than from `select distinct category`, so an
 * empty table still renders a full set of controls.
 */
export const CATEGORIES: readonly BookCategory[] = [
    'skill_book',
    'book',
    'black_book',
    'journal',
    'note',
    'treasure_map',
];

/** Every source `book_source_valid` enforces; defaults first, as above. */
export const SOURCES: readonly BookSource[] = [
    'base',
    'dawnguard',
    'dragonborn',
    'hearthfire',
    'creation_club',
];

/**
 * Skyrim's 18 skills, exactly as `book_skill_valid` spells them -- the values
 * are stored verbatim, so the filter compares against these strings rather than
 * a normalized form. Grouped the way the game's skill tree does.
 */
export const SKILLS: readonly string[] = [
    // Combat
    'One-Handed',
    'Two-Handed',
    'Archery',
    'Block',
    'Smithing',
    'Heavy Armor',
    // Magic
    'Alteration',
    'Conjuration',
    'Destruction',
    'Illusion',
    'Restoration',
    'Enchanting',
    // Stealth
    'Light Armor',
    'Sneak',
    'Lockpicking',
    'Pickpocket',
    'Speech',
    'Alchemy',
];

/**
 * A read or collected filter (FR-3): each flag filters independently, and
 * `any` -- the default -- applies no predicate at all.
 */
export type FlagFilter = 'any' | 'true' | 'false';

/** The resolved, validated filter state behind one render of the list. */
export type BookFilters = {
    categories: readonly BookCategory[];
    sources: readonly BookSource[];
    /**
     * `null` applies no skill predicate. There is deliberately no "has a
     * skill" option: `skill` is non-null only on `skill_book` (90 of 91 -- the
     * Oghma Infinium is the `artifact_type` exception that
     * `book_skill_book_has_skill` carves out), so `category=skill_book`
     * already asks that question through a control FR-3 specifies.
     */
    skill: string | null;
    read: FlagFilter;
    collected: FlagFilter;
    /** `null` applies no title predicate; an empty `?q=` never reaches here. */
    q: string | null;
};

/** What `/books` renders with no query string: FR-3's default scope. */
export const DEFAULT_FILTERS: BookFilters = {
    categories: DEFAULT_CATEGORIES,
    sources: DEFAULT_SOURCES,
    skill: null,
    read: 'any',
    collected: 'any',
    q: null,
};

/** Trimmed, non-empty values of a param that may arrive repeated. */
function paramValues(raw: string | string[] | undefined): string[] {
    if (raw === undefined) return [];
    return (Array.isArray(raw) ? raw : [raw])
        .map((value) => value.trim())
        .filter((value) => value !== '');
}

/**
 * Reads a repeatable allowlist param (`?category=book&category=note`) into the
 * subset of `allowed` it names, dropping anything unrecognised (R4, AC-10).
 *
 * Two deliberate choices. Results come back in `allowed` order rather than URL
 * order, which dedupes and keeps the generated query stable regardless of how
 * the params were typed. And an *empty* selection falls back to `fallback`
 * rather than matching nothing: a GET form omits a checkbox group entirely when
 * every box is unchecked, so "no categories" and "no `category` param" arrive
 * here identical, and defaults are the more useful reading of the pair -- the
 * other one renders an empty list with no way to tell why.
 *
 * Note this is the opposite of `parsePageParam`'s treatment (in `src/lib/pagination.ts`) of a repeated
 * param. There, repetition is ambiguous and falls back; here it is the encoding.
 */
export function parseAllowlistParam<T extends string>(
    raw: string | string[] | undefined,
    allowed: readonly T[],
    fallback: readonly T[],
): readonly T[] {
    const named = new Set(paramValues(raw));
    const picked = allowed.filter((value) => named.has(value));
    return picked.length > 0 ? picked : fallback;
}

/**
 * Reads `?read=` / `?collected=` into a tri-state, falling back to `any` on
 * anything else -- including a repeated param, which is ambiguous for a
 * single-valued control the way `parsePageParam` treats it.
 */
export function parseFlagParam(raw: string | string[] | undefined): FlagFilter {
    if (typeof raw !== 'string') return 'any';

    const value = raw.trim().toLowerCase();
    return value === 'true' || value === 'false' ? value : 'any';
}

/**
 * Reads `?skill=` into one of `SKILLS`, or `null` for any.
 *
 * Matched case-insensitively and returned canonicalised, so a hand-typed
 * `?skill=one-handed` works and still produces the exact string the column
 * stores.
 */
export function parseSkillParam(
    raw: string | string[] | undefined,
): string | null {
    if (typeof raw !== 'string') return null;

    const value = raw.trim().toLowerCase();
    return SKILLS.find((skill) => skill.toLowerCase() === value) ?? null;
}

/**
 * The longest term worth sending to the database.
 *
 * Above the longest title in the catalogue (93 characters, measured), so
 * slicing to it can never make a term match something the full term would not:
 * anything longer already matches nothing. That is what makes the cap safe to
 * apply silently rather than rejecting the term, which would drop the predicate
 * and show the *whole* list -- a tampered param looking like a working search.
 */
export const MAX_SEARCH_LENGTH = 128;

/**
 * Reads `?q=` into a title search term, or `null` for no predicate at all.
 *
 * An absent or blank `q` must apply no predicate rather than an empty `ilike`
 * (FR-9): `%%` matches every row, so the two are the same result today and
 * diverge the moment a title is null.
 */
export function parseSearchParam(
    raw: string | string[] | undefined,
): string | null {
    if (typeof raw !== 'string') return null;

    const trimmed = raw.trim().slice(0, MAX_SEARCH_LENGTH);
    return trimmed === '' ? null : trimmed;
}

/** Resolves a page's whole query string into validated filter state (R4). */
export function parseFilters(params: SearchParams): BookFilters {
    return {
        categories: parseAllowlistParam(
            params.category,
            CATEGORIES,
            DEFAULT_CATEGORIES,
        ),
        sources: parseAllowlistParam(params.source, SOURCES, DEFAULT_SOURCES),
        skill: parseSkillParam(params.skill),
        read: parseFlagParam(params.read),
        collected: parseFlagParam(params.collected),
        q: parseSearchParam(params.q),
    };
}

/** Set equality over two allowlist selections, which are always deduped. */
function sameValues<T>(a: readonly T[], b: readonly T[]): boolean {
    return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Whether the resolved filters are FR-3's defaults -- i.e. whether `/books`
 * with no query string would render the same list.
 *
 * Drives the empty state's reset link, which should not offer to return to a
 * view the reader is already looking at.
 */
export function isDefaultFilters(filters: BookFilters): boolean {
    return (
        sameValues(filters.categories, DEFAULT_CATEGORIES) &&
        sameValues(filters.sources, DEFAULT_SOURCES) &&
        filters.skill === null &&
        filters.read === 'any' &&
        filters.collected === 'any' &&
        filters.q === null
    );
}

/**
 * Whether a read or collected filter is set -- the two that answer from the
 * viewer's own tracking, and so the two a signed-out visitor needs told about
 * (FR-2).
 */
export function hasFlagFilter(filters: BookFilters): boolean {
    return filters.read !== 'any' || filters.collected !== 'any';
}

/**
 * The same view with only the read and collected filters removed: the
 * signed-out notice's way out (FR-2). Everything else the reader chose is
 * kept, which is what separates it from "Reset filters".
 */
export function withoutFlagFilters(filters: BookFilters): BookFilters {
    return { ...filters, read: 'any', collected: 'any' };
}

/** The catalogue route (FR-8). */
export const BOOKS_PATH = '/books';

/**
 * The query string for a filter state, omitting everything already implied by
 * the defaults so the default view's URL is a bare `/books`.
 *
 * Omission is safe because `parseFilters` reads an absent allowlist param back
 * as the default set -- the same round trip `pageQuery` relies on when it drops
 * `page=1`. `page` is absent by construction rather than by choice: changing a
 * filter resets to page 1 (FR-3), and building the query from the filter state
 * alone is what makes that structural instead of something to remember.
 */
export function filtersQuery(filters: BookFilters): string {
    const query = new URLSearchParams();

    if (!sameValues(filters.categories, DEFAULT_CATEGORIES)) {
        for (const category of filters.categories) {
            query.append('category', category);
        }
    }
    if (!sameValues(filters.sources, DEFAULT_SOURCES)) {
        for (const source of filters.sources) query.append('source', source);
    }
    if (filters.skill !== null) query.set('skill', filters.skill);
    if (filters.read !== 'any') query.set('read', filters.read);
    if (filters.collected !== 'any') query.set('collected', filters.collected);
    if (filters.q !== null) query.set('q', filters.q);

    return query.toString();
}

/** `filtersQuery` as a href, which is what every control actually needs. */
export function filtersHref(filters: BookFilters): string {
    const query = filtersQuery(filters);
    return query ? `${BOOKS_PATH}?${query}` : BOOKS_PATH;
}

/**
 * Escapes a search term so its LIKE metacharacters match literally (FR-9,
 * AC-13). Backslash is Postgres's default LIKE escape character, so escaping
 * it first is what keeps a typed `\` from escaping the character after it.
 *
 * `*` is escaped alongside `%` and `_` even though it means nothing to
 * Postgres: PostgREST rewrites `*` to `%` inside a `like`/`ilike` value before
 * the pattern ever reaches the database. Verified against the project --
 * `title=ilike.%*%` returns all 1,207 books, exactly as `%%` does -- so a
 * reader typing a single asterisk would otherwise match the entire catalogue.
 * That one is invisible in the SQL and is the reason this cannot just be the
 * usual two-character escape.
 */
export function escapeLike(term: string): string {
    return term.replace(/[\\%_*]/g, (char) => `\\${char}`);
}

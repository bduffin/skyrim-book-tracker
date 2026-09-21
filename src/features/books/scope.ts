/**
 * The pure half of the browse query: which books are in scope by default, and
 * the pagination arithmetic over them.
 *
 * Split from `data.ts` deliberately. That module imports `server-only`, which
 * resolves to a module that throws outside a React Server Component
 * environment, so `node:test` cannot import it -- anything worth asserting has
 * to live here instead (architecture.md section 11).
 */

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

/** Decision #3. */
export const PAGE_SIZE = 50;

/**
 * Reads `?page=` into a 1-based page number, falling back to 1 on anything
 * unusable rather than erroring (R4, AC-10).
 *
 * Stricter than `parseInt` on purpose: that reads `"12abc"` as 12, so a
 * tampered param would sail through looking like a plausible page. Repeated
 * params arrive as an array and count as unusable -- there is no
 * non-arbitrary way to choose between `?page=2&page=3`, and falling back to
 * the default is more predictable than picking one.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
    if (typeof raw !== 'string') return 1;

    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return 1;

    const page = Number(trimmed);
    // A 20-digit param passes the regex and then quietly loses precision, so
    // anything past the safe-integer range is unusable input too.
    if (!Number.isSafeInteger(page) || page < 1) return 1;

    return page;
}

/**
 * Total pages for a row count. Never returns 0 -- an empty result is "page 1
 * of 1" showing nothing, which is a thing the UI can render, where "page 1 of
 * 0" is not.
 */
export function pageCountFor(total: number): number {
    if (!Number.isFinite(total) || total <= 0) return 1;
    return Math.ceil(total / PAGE_SIZE);
}

/**
 * Pins a requested page inside the range that actually exists. `parsePageParam`
 * cannot do this: it runs before the row count is known, so a page past the end
 * is only detectable here.
 */
export function clampPage(page: number, pageCount: number): number {
    if (page < 1) return 1;
    if (page > pageCount) return pageCount;
    return page;
}

/**
 * Inclusive `[from, to]` row offsets for a 1-based page, in the form
 * PostgREST's `.range()` takes.
 */
export function rangeFor(page: number): [number, number] {
    const from = (page - 1) * PAGE_SIZE;
    return [from, from + PAGE_SIZE - 1];
}

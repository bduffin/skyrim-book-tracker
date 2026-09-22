/**
 * Display names for the catalogue's fixed vocabularies.
 *
 * Separate from `scope.ts`, which owns what the values *are* and which of them
 * are in scope; this owns only how they read. Kept out of `data.ts` for the
 * usual reason -- that module imports `server-only`, and the filter controls
 * are a Client Component.
 *
 * These maps are total, unlike the partial ones `book-row.tsx` renders tags
 * from: a filter control has to name every option it offers, including the
 * ones a row deliberately leaves untagged.
 */

import type { BookCategory, BookSource } from './types';

export const CATEGORY_LABELS: Record<BookCategory, string> = {
    skill_book: 'Skill book',
    book: 'Book',
    black_book: 'Black Book',
    journal: 'Journal',
    note: 'Note',
    treasure_map: 'Treasure map',
};

export const SOURCE_LABELS: Record<BookSource, string> = {
    base: 'Skyrim',
    dawnguard: 'Dawnguard',
    dragonborn: 'Dragonborn',
    hearthfire: 'Hearthfire',
    creation_club: 'Creation Club',
};

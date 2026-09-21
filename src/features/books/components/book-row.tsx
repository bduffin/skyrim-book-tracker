import type { ReactNode } from 'react';
import type { BookRow as Book } from '../types';

/**
 * Only the categories worth calling out. `book` is deliberately absent: it is
 * 310 of the 423 books in the default scope, so tagging it would put a label
 * meaning "ordinary" on three rows in four.
 */
const CATEGORY_LABELS: Partial<Record<Book['category'], string>> = {
    skill_book: 'Skill book',
    journal: 'Journal',
    note: 'Note',
    black_book: 'Black Book',
    treasure_map: 'Treasure map',
};

/**
 * Add-on sources only. `base` is 360 of 423, and labelling it "Skyrim" inside
 * an app about Skyrim tells the reader nothing.
 */
const SOURCE_LABELS: Partial<Record<Book['source'], string>> = {
    dawnguard: 'Dawnguard',
    dragonborn: 'Dragonborn',
    hearthfire: 'Hearthfire',
    creation_club: 'Creation Club',
};

/**
 * One tone per kind of fact. `Skill book` and `Dragonborn` answer different
 * questions -- what a thing is, versus which release it came from -- so they
 * should not read as two of the same lozenge.
 *
 * Colour is redundant here, never the sole carrier: each tag also says what it
 * is in words, so the distinction survives being unable to tell the tones apart.
 */
const TONES = {
    /** What kind of thing it is. Neutral, as the baseline classification. */
    category: 'border-gray-200 bg-gray-50 text-gray-700',
    /** Which release it came from -- only ever an add-on (63 of 423). */
    source: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    /** What it does to your character. */
    skill: 'border-emerald-200 bg-emerald-50 text-emerald-700',
} as const;

function Tag({
    children,
    tone,
}: {
    children: ReactNode;
    tone: keyof typeof TONES;
}) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
        >
            {children}
        </span>
    );
}

/**
 * One book in the list (FR-1).
 *
 * Tags sit inline after the title rather than in a right-hand column: aligned
 * columns read as a sortable table, which promises an affordance this data
 * cannot honour -- category, source and skill are filter facets (FR-3), not
 * dimensions anyone compares down a column.
 *
 * Server-rendered; the read/collected toggles arrive with Browse M3. Every
 * field is interpolated rather than injected as HTML, since the text comes
 * from UESP wikitext (NFR-8, AC-11).
 */
export function BookRow({ book }: { book: Book }) {
    const category = CATEGORY_LABELS[book.category];
    const source = SOURCE_LABELS[book.source];

    return (
        <li className="px-4 py-3 transition-colors hover:bg-gray-50">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
                <span className="font-medium text-gray-900">{book.title}</span>
                {category && <Tag tone="category">{category}</Tag>}
                {source && <Tag tone="source">{source}</Tag>}
                {book.skill && <Tag tone="skill">+1 {book.skill}</Tag>}
            </div>
        </li>
    );
}

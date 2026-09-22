import type { ReactNode } from 'react';
import type { BookRow as Book } from '../types';

import { CATEGORY_LABELS, SOURCE_LABELS } from '../labels';

/**
 * The values not worth tagging, rather than a second set of labels.
 *
 * `book` is 310 of the 423 books in the default scope and `base` is 360, so
 * tagging either puts a label meaning "ordinary" on most of the page. The
 * filter controls still have to name them (`labels.ts`), which is why this is
 * a list of omissions and not a partial label map -- the two would otherwise
 * drift into disagreeing about how a category is spelled.
 */
const UNTAGGED_CATEGORIES = new Set<Book['category']>(['book']);
const UNTAGGED_SOURCES = new Set<Book['source']>(['base']);

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
    const category = UNTAGGED_CATEGORIES.has(book.category)
        ? null
        : CATEGORY_LABELS[book.category];
    const source = UNTAGGED_SOURCES.has(book.source)
        ? null
        : SOURCE_LABELS[book.source];

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

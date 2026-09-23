import type { ReactNode } from 'react';
import Image from 'next/image';
import type { BookRow as Book } from '../types';

import { CATEGORY_LABELS, SOURCE_LABELS } from '../labels';
import { uespUrl } from '../uesp';

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
 * A skill book whose bonus is not a single skill.
 *
 * Every other skill book carries `+1 <skill>`; this one would carry nothing,
 * which left the most powerful book in the game as the only skill book that
 * looked unremarkable. The Oghma Infinium grants +5 across six skills in a
 * path you choose, so `{{Game Book}}`'s single-valued `skill=` is empty on it.
 *
 * Keyed on the absent skill rather than on `artifact_type = 'Daedric Artifact'`
 * or on the title. Nothing constrains `artifact_type` to one row, so a future
 * add-on shipping a second Daedric artifact would silently acquire this label;
 * titles are not unique either (`Olaf and the Dragon` appears twice) and are
 * exposed to the `cleanTitle` normalization hazard, where a change on one side
 * of the comparison quietly unmatches it. `book_single_null_skill_idx` is a
 * partial unique index permitting exactly ONE null-skill skill book, so this
 * test cannot start matching two books without the import failing loudly
 * first -- which is the moment to revisit the wording, not a silent mislabel.
 */
function isMultiSkill(book: Book): boolean {
    return book.category === 'skill_book' && book.skill === null;
}

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
    /**
     * The same fact as `skill`, turned up -- not a fourth kind of fact, so
     * it stays green: the hue still means "what it does to your character".
     *
     * Emphasis by *luminance*, not by tint. Earlier attempts varied only
     * saturation within emerald, which is precisely the signal lost to
     * colour vision deficiency and in grayscale -- measured, the lightest
     * of them sat at 0.874 background luminance against the ordinary tag's
     * 0.947, so it stayed just another pale pill. Inverting to 0.059 keeps
     * it obviously different without relying on hue at all. Text contrast
     * is 8.47, above the ordinary tag's own 5.09.
     *
     * Deliberately not black, which would read louder still: `bg-gray-900`
     * is this app's *interactive* fill (the sign-in button, the current
     * pagination page), so a black pill sitting inertly in a row would
     * borrow an affordance it does not have.
     */
    skillRare: 'border-emerald-900 bg-emerald-900 text-emerald-100',
} as const;

/**
 * UESP's own logo, used to mark the outbound link.
 *
 * Licensed CC BY-SA 3.0 Unported by UESP, which is a *copyright* licence --
 * see the attribution in the footer and the README. Trademark is a separate
 * right that no Creative Commons licence grants, so the use stays nominative:
 * it identifies where the link goes and nothing about it claims affiliation.
 *
 * Used unmodified. Resizing is a format change the licence permits, but
 * recolouring it to suit a theme would be a derivative work and would have to
 * ship under CC BY-SA 3.0 itself -- worth remembering during any styling pass.
 *
 * `alt=""` because the link's `aria-label` already names the destination;
 * announcing the logo as well would just repeat it.
 */
function UespLogo() {
    return (
        <Image
            src="/uesp-logo.png"
            alt=""
            // 36px is the smallest size at which the wordmark inside the
            // logo resolves into "UESP" rather than a tan speck; below
            // about 28 it is unreadable at any density. The cost is row
            // height, 56px to 72px, or roughly one extra screenful over a
            // 50-book page.
            width={36}
            height={36}
            className="size-9 shrink-0"
        />
    );
}

/**
 * The conventional "arrow leaving a box" external-link glyph.
 *
 * Carries the "this leaves the site" half of the signal; the logo beside it
 * carries the "goes to UESP" half. Decorative, like the logo: the link's
 * `aria-label` says both.
 */
function ExternalLinkIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3 shrink-0"
        >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
        </svg>
    );
}

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
            {/*
             * Two blocks centred against each other, rather than one flat
             * baseline row. The link is an inline-flex around a 36px logo,
             * so its baseline sits near its own bottom edge; with the
             * whole row baseline-aligned it dragged the title down with
             * it, leaving 22px of dead space above the title and none
             * below. The title and its tags keep a baseline group of their
             * own, which is what makes the pills sit on the title's
             * baseline instead of floating beside it.
             */}
            <div className="flex items-center gap-x-2.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
                    <span className="font-medium text-gray-900">
                        {book.title}
                    </span>
                    {category && <Tag tone="category">{category}</Tag>}
                    {source && <Tag tone="source">{source}</Tag>}
                    {book.skill ? (
                        <Tag tone="skill">+1 {book.skill}</Tag>
                    ) : (
                        isMultiSkill(book) && (
                            <Tag tone="skillRare">Forbidden knowledge</Tag>
                        )
                    )}
                </div>
                <a
                    href={uespUrl(book.uespTitle)}
                    // A new tab, so following a link does not cost the reader
                    // the filtered list they built.
                    target="_blank"
                    // `noopener` only, deliberately **not** `noreferrer`.
                    // Sending traffic UESP can see is half the point of
                    // linking out at all, and noreferrer would strip the
                    // header that tells them where it came from. Every browser
                    // inside the floor already implies noopener for
                    // target=_blank; it is stated anyway, as the intent.
                    rel="noopener"
                    // "wiki" carries the weight that a bare "UESP" cannot:
                    // it says what is on the other side to a reader who has
                    // never heard of the site, in one short word that is
                    // repeated on all fifty rows. A bare "Details" would say
                    // that too, but credits nobody and takes the label NG1's
                    // own detail page would want.
                    //
                    // The title is prefixed for screen readers, which would
                    // otherwise hear fifty identical entries in a links list.
                    // The accessible name contains the visible label verbatim,
                    // which is what WCAG 2.5.3 requires.
                    aria-label={`${book.title} on the UESP wiki`}
                    // `py-1` is not decoration: it lifts the tap target to 24px
                    // tall, which is WCAG 2.5.8's minimum. The text alone is 16.
                    // A tooltip earns its place once the visible label is
                    // gone: a mouse user has no other way to learn where this
                    // goes without clicking it.
                    title={`${book.title} on the UESP wiki`}
                    // The rounded fill covers both marks at once, which is
                    // what makes them read as a single control rather than two
                    // decorations that happen to sit together. It has to be
                    // two steps darker than the row's own hover, not one:
                    // against `bg-gray-50` a `bg-gray-100` chip is invisible,
                    // because the row highlights at the same moment.
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                >
                    <UespLogo />
                    <ExternalLinkIcon />
                </a>
            </div>
        </li>
    );
}

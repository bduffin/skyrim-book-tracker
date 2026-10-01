'use client';

import { useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { CATEGORY_LABELS, SOURCE_LABELS } from '../labels';
import {
    BOOKS_PATH,
    CATEGORIES,
    SKILLS,
    SOURCES,
    adoptsUrlTerm,
    filtersHref,
    type BookFilters,
    type FlagFilter,
} from '../scope';
import type { BookCategory, BookSource } from '../types';

/** How long to wait after the last keystroke before searching (R6). */
const SEARCH_DEBOUNCE_MS = 300;

/*
 * Focus is an *outline*, never Tailwind's `ring`. A ring is a box-shadow, and
 * forced-colors mode (Windows High Contrast) strips box-shadows entirely, so
 * a ring-only control has no visible focus there at all. `outline-hidden`
 * rather than `outline-none` for the same reason: it keeps a transparent
 * outline that forced-colors mode paints in the system color.
 *
 * steel-800 against the white panel clears WCAG's 3:1 for focus indicators
 * with plenty to spare.
 */
const FOCUS =
    'outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-steel-800';

/*
 * The placeholder is as light as AA allows (iron-400, 4.53:1 on white; the
 * next slate step is 4.41) and a weight lighter than typed text. The weight
 * is what separates "example" from "already typed" without spending any
 * more contrast, and Jost is variable, so it costs no extra font file.
 */
const FIELD = `rounded-md border border-frost-300 bg-white py-1.5 text-sm text-iron-900 placeholder:font-light placeholder:text-iron-400 ${FOCUS}`;

const LABEL = 'text-xs font-medium tracking-[0.18em] text-iron-500 uppercase';

/*
 * The chips and segments hide their real input and style the <label> around
 * it by that input's state, through `:has()`. Chrome 105, Safari 15.4 and
 * Firefox 121 support it, all inside the app's floor of 111 / 16.4 / 128
 * (architecture.md section 9) -- checked rather than assumed, since Tailwind
 * shipping a `has-*` variant says nothing about where `:has()` runs.
 *
 * `sr-only`, never `display: none`: the input has to stay focusable for the
 * keyboard and present for the GET form to submit it.
 *
 * In forced-colors mode every background is repainted to the system Canvas,
 * which would erase the iron fill that is the *only* sign a segment is
 * chosen. So a chosen control opts out of the repaint and uses the system's
 * own Highlight pair, which is exactly what forced-colors mode reserves for
 * "selected".
 */
const CHOSEN =
    'has-checked:border-iron-900 has-checked:bg-iron-900 has-checked:font-medium has-checked:text-frost-50 forced-colors:has-checked:[forced-color-adjust:none] forced-colors:has-checked:bg-[Highlight] forced-colors:has-checked:text-[HighlightText]';

const FOCUS_WITHIN =
    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-steel-800';

function CheckIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            // Shown only while checked, by CSS rather than by the `checked`
            // prop, so it stays correct with JavaScript disabled too.
            className="hidden size-3.5 shrink-0 group-has-checked:block"
        >
            <path d="M5 12l5 5L20 7" />
        </svg>
    );
}

/**
 * One choice among three, so the three sit *joined*: the visual grammar says
 * "pick one" before a word is read, against the separated chips below, which
 * say "pick any".
 *
 * `any` travels as an empty value, never as the string "any": an omitted param
 * is what "no filter" means everywhere else, so a JS-free GET submission
 * produces the same URL the enhanced path does. It has to be a segment of its
 * own, because a radio cannot be unchecked by clicking it again.
 */
function FlagSegments({
    name,
    label,
    value,
    onChange,
    trueLabel,
    falseLabel,
}: {
    name: string;
    label: string;
    value: FlagFilter;
    onChange: (next: FlagFilter) => void;
    trueLabel: string;
    falseLabel: string;
}) {
    const options: [FlagFilter, string][] = [
        ['any', 'Any'],
        ['true', trueLabel],
        ['false', falseLabel],
    ];

    return (
        <fieldset>
            <legend className={`${LABEL} pb-1.5`}>{label}</legend>
            <div className="flex">
                {options.map(([option, text]) => (
                    <label
                        key={option}
                        // Each segment carries its own border and overlaps its
                        // neighbour by a pixel, rather than the group clipping
                        // with overflow-hidden -- which would also clip the
                        // focus outline off the segment that has it.
                        className={`-ml-px cursor-pointer border border-frost-300 bg-white px-3 py-1.5 text-sm text-iron-600 transition-colors first:ml-0 first:rounded-l-md last:rounded-r-md not-has-checked:hover:bg-frost-100 has-checked:relative has-checked:z-10 has-focus-visible:relative has-focus-visible:z-20 ${CHOSEN} ${FOCUS_WITHIN}`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={option === 'any' ? '' : option}
                            checked={value === option}
                            onChange={() => onChange(option)}
                            className="sr-only"
                        />
                        {text}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

/**
 * An independent toggle, so the chips sit *apart* -- against the joined
 * segments above, which say "pick one".
 *
 * Chosen chips carry a check mark as well as the iron fill. The fill is a
 * luminance change, so it survives grayscale; the mark is the cue that does
 * not depend on fill at all, where the segments have their position within a
 * group to lean on and a chip has nothing.
 */
function Chip({
    name,
    value,
    label,
    checked,
    onChange,
}: {
    name: string;
    value: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label
            className={`group inline-flex cursor-pointer items-center gap-1 rounded-full border border-frost-300 bg-white px-3 py-1 text-sm text-iron-600 transition-colors not-has-checked:hover:bg-frost-100 ${CHOSEN} ${FOCUS_WITHIN}`}
        >
            <input
                type="checkbox"
                name={name}
                value={value}
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="sr-only"
            />
            <CheckIcon />
            {label}
        </label>
    );
}

/**
 * The filter controls (FR-3) and title search (FR-9).
 *
 * A real `<form method="get" action="/books">`, so with JavaScript disabled it
 * submits as an ordinary navigation and every filter still works
 * (architecture.md section 9) -- the same reason pagination is plain links.
 * With JavaScript, `onSubmit` is intercepted and `router.push` soft-navigates
 * instead, which is what AC-3 asks for. The form carries no `page` field, so
 * either path drops it and resets to page 1 (FR-3) structurally rather than by
 * remembering to.
 *
 * Native controls throughout rather than a component library's: a scripted
 * listbox is a dead button without JavaScript, which would make the degraded
 * path a broken page instead of a slower one. They also bring their own
 * keyboard and screen-reader behaviour (NFR-7).
 *
 * Everything but the search box is *controlled from the URL* rather than
 * holding its own state, so the URL stays the single source of truth
 * (architecture.md section 9) and the back button resyncs the controls for
 * free. `useOptimistic` only covers the gap while the round-trip is in flight
 * -- interaction state, not server data, which is the line section 9 draws.
 */
export function BookFilters({ filters }: { filters: BookFilters }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [shown, setShown] = useOptimistic(filters);
    const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    // The search box is the one control that cannot be driven straight from
    // the URL: it navigates on a debounce, so a URL-derived value would lag
    // the keyboard by 300ms and read as dropped keystrokes.
    const urlTerm = filters.q ?? '';
    const [term, setTerm] = useState(urlTerm);
    const [seenUrlTerm, setSeenUrlTerm] = useState(urlTerm);
    const [sent, setSent] = useState(urlTerm);

    // Adopt the URL's term when it changed for a reason that was not this box
    // -- a reset, the back button, a hand-edited address. A filter change is a
    // soft navigation that keeps this component mounted, so the initial
    // `useState` alone would leave the box showing a term the list no longer
    // applies.
    //
    // Adjusting state during render rather than in an effect is React's own
    // recommendation for deriving from a changed prop: it re-renders before
    // anything paints, where an effect would show one frame of the stale term.
    if (urlTerm !== seenUrlTerm) {
        setSeenUrlTerm(urlTerm);
        if (adoptsUrlTerm(urlTerm, seenUrlTerm, sent)) {
            setSent(urlTerm);
            setTerm(urlTerm);
        }
    }

    function apply(next: BookFilters) {
        clearTimeout(debounce.current);
        setSent(next.q ?? '');
        startTransition(() => {
            setShown(next);
            router.push(filtersHref(next));
        });
    }

    function search(next: string) {
        setTerm(next);
        clearTimeout(debounce.current);
        debounce.current = setTimeout(
            () => apply({ ...shown, q: next.trim() || null }),
            SEARCH_DEBOUNCE_MS,
        );
    }

    /**
     * Adds or removes one value, rebuilding the selection in allowlist order.
     *
     * Appending would make the query string's param order depend on the order
     * the boxes were clicked. It reads back as the same set -- parseFilters
     * normalizes -- but two people filtering the same way would produce
     * different URLs, which is a poor property for something whose whole job
     * is being shareable.
     */
    function toggle<T extends string>(
        all: readonly T[],
        selected: readonly T[],
        value: T,
        checked: boolean,
    ): readonly T[] {
        const next = new Set(selected);
        if (checked) next.add(value);
        else next.delete(value);
        return all.filter((candidate) => next.has(candidate));
    }

    return (
        <div className="px-4">
            <form
                method="get"
                action={BOOKS_PATH}
                onSubmit={(event) => {
                    event.preventDefault();
                    apply({ ...shown, q: term.trim() || null });
                }}
                // Also what dims the results while a filter change is in
                // flight: the page styles them off this attribute, so the
                // form itself -- and the search box being typed in -- stays
                // at full strength.
                aria-busy={pending}
                // White on the frost page, which lifts the controls off the
                // list below them.
                className="flex flex-col gap-4 rounded-lg border border-frost-300 bg-white p-4"
            >
                <div className="flex flex-wrap items-end gap-4">
                    <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                        <span className={LABEL}>Search titles</span>
                        <span className="relative">
                            {/*
                             * On the left: Chromium and Safari draw a native
                             * clear button inside type="search" on the right
                             * as soon as there is text, and the two collide.
                             */}
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-iron-500"
                            >
                                <circle cx="11" cy="11" r="7" />
                                <path d="m20 20-3.5-3.5" />
                            </svg>
                            <input
                                type="search"
                                name="q"
                                value={term}
                                onChange={(event) => search(event.target.value)}
                                placeholder="e.g. Dwemer"
                                className={`${FIELD} w-full pr-2.5 pl-8`}
                            />
                        </span>
                    </label>

                    <label className="flex w-full flex-col gap-1.5 sm:w-48">
                        <span className={LABEL}>Skill</span>
                        {/*
                         * Only the closed trigger is styled. Its popup stays
                         * the platform's own: styling that needs
                         * `appearance: base-select`, which has not been checked
                         * against the Firefox 128 / Safari 16.4 floor.
                         */}
                        <span className="relative">
                            <select
                                name="skill"
                                value={shown.skill ?? ''}
                                onChange={(event) =>
                                    apply({
                                        ...shown,
                                        skill: event.target.value || null,
                                    })
                                }
                                className={`${FIELD} w-full cursor-pointer appearance-none pr-8 pl-2.5`}
                            >
                                <option value="">Any skill</option>
                                {SKILLS.map((skill) => (
                                    <option key={skill} value={skill}>
                                        {skill}
                                    </option>
                                ))}
                            </select>
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-iron-500"
                            >
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </span>
                    </label>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-4">
                    <FlagSegments
                        name="read"
                        label="Read"
                        value={shown.read}
                        onChange={(read) => apply({ ...shown, read })}
                        trueLabel="Read"
                        falseLabel="Unread"
                    />
                    <FlagSegments
                        name="collected"
                        label="Collected"
                        value={shown.collected}
                        onChange={(collected) => apply({ ...shown, collected })}
                        trueLabel="Collected"
                        falseLabel="Not collected"
                    />
                </div>

                <fieldset>
                    <legend className={`${LABEL} pb-1.5`}>Category</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map((category) => (
                            <Chip
                                key={category}
                                name="category"
                                value={category}
                                label={CATEGORY_LABELS[category]}
                                checked={shown.categories.includes(category)}
                                onChange={(checked) =>
                                    apply({
                                        ...shown,
                                        categories: toggle<BookCategory>(
                                            CATEGORIES,
                                            shown.categories,
                                            category,
                                            checked,
                                        ),
                                    })
                                }
                            />
                        ))}
                    </div>
                </fieldset>

                <fieldset>
                    <legend className={`${LABEL} pb-1.5`}>Source</legend>
                    <div className="flex flex-wrap gap-1.5">
                        {SOURCES.map((source) => (
                            <Chip
                                key={source}
                                name="source"
                                value={source}
                                label={SOURCE_LABELS[source]}
                                checked={shown.sources.includes(source)}
                                onChange={(checked) =>
                                    apply({
                                        ...shown,
                                        sources: toggle<BookSource>(
                                            SOURCES,
                                            shown.sources,
                                            source,
                                            checked,
                                        ),
                                    })
                                }
                            />
                        ))}
                    </div>
                </fieldset>

                <noscript>
                    <button
                        type="submit"
                        className="self-start rounded-md border border-iron-900 bg-iron-900 px-3 py-1.5 text-sm font-medium text-frost-50"
                    >
                        Apply filters
                    </button>
                </noscript>
            </form>
        </div>
    );
}

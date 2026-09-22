'use client';

import { useOptimistic, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { CATEGORY_LABELS, SOURCE_LABELS } from '../labels';
import {
    BOOKS_PATH,
    CATEGORIES,
    SKILLS,
    SOURCES,
    filtersHref,
    type BookFilters,
    type FlagFilter,
} from '../scope';
import type { BookCategory, BookSource } from '../types';

/** How long to wait after the last keystroke before searching (R6). */
const SEARCH_DEBOUNCE_MS = 300;

const FIELD =
    'rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900';
const LABEL = 'text-xs font-semibold tracking-wide text-gray-500 uppercase';

/**
 * `any` travels as an empty value, never as the string "any": an omitted param
 * is what "no filter" means everywhere else, so a JS-free GET submission
 * produces the same tidy URL the enhanced path does.
 */
function FlagSelect({
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
    return (
        <label className="flex flex-col gap-1">
            <span className={LABEL}>{label}</span>
            <select
                name={name}
                value={value === 'any' ? '' : value}
                onChange={(event) =>
                    onChange((event.target.value || 'any') as FlagFilter)
                }
                className={FIELD}
            >
                <option value="">Any</option>
                <option value="true">{trueLabel}</option>
                <option value="false">{falseLabel}</option>
            </select>
        </label>
    );
}

function Check({
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
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input
                type="checkbox"
                name={name}
                value={value}
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="size-4 rounded border-gray-300"
            />
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
    const [sent, setSent] = useState(urlTerm);

    // Adopt the URL's term when it changed for a reason that was not this box
    // -- a reset, the back button, a hand-edited address. Comparing against
    // what was last *sent* rather than against `term` is what keeps a slow
    // round-trip from clobbering characters typed while it was in flight.
    //
    // Adjusting state during render rather than in an effect is React's own
    // recommendation for deriving from a changed prop: it re-renders before
    // anything paints, where an effect would show one frame of the stale term.
    if (sent !== urlTerm) {
        setSent(urlTerm);
        setTerm(urlTerm);
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
                aria-busy={pending}
                className={`flex flex-col gap-3.5 rounded-lg border border-gray-200 bg-gray-50 p-4 transition-opacity ${
                    pending ? 'opacity-60' : ''
                }`}
            >
                <div className="flex flex-wrap items-end gap-4">
                    <label className="flex flex-1 flex-col gap-1">
                        <span className={LABEL}>Search titles</span>
                        <input
                            type="search"
                            name="q"
                            value={term}
                            onChange={(event) => search(event.target.value)}
                            placeholder="e.g. Dwemer"
                            className={`${FIELD} min-w-48`}
                        />
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className={LABEL}>Skill</span>
                        <select
                            name="skill"
                            value={shown.skill ?? ''}
                            onChange={(event) =>
                                apply({
                                    ...shown,
                                    skill: event.target.value || null,
                                })
                            }
                            className={FIELD}
                        >
                            <option value="">Any skill</option>
                            {SKILLS.map((skill) => (
                                <option key={skill} value={skill}>
                                    {skill}
                                </option>
                            ))}
                        </select>
                    </label>

                    <FlagSelect
                        name="read"
                        label="Read"
                        value={shown.read}
                        onChange={(read) => apply({ ...shown, read })}
                        trueLabel="Read"
                        falseLabel="Unread"
                    />
                    <FlagSelect
                        name="collected"
                        label="Collected"
                        value={shown.collected}
                        onChange={(collected) => apply({ ...shown, collected })}
                        trueLabel="Collected"
                        falseLabel="Not collected"
                    />
                </div>

                <div className="flex flex-wrap gap-x-8 gap-y-4">
                    <fieldset>
                        <legend className={`${LABEL} pb-1.5`}>Category</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {CATEGORIES.map((category) => (
                                <Check
                                    key={category}
                                    name="category"
                                    value={category}
                                    label={CATEGORY_LABELS[category]}
                                    checked={shown.categories.includes(
                                        category,
                                    )}
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
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {SOURCES.map((source) => (
                                <Check
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
                </div>

                <noscript>
                    <button
                        type="submit"
                        className="self-start rounded-md border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
                    >
                        Apply filters
                    </button>
                </noscript>
            </form>
        </div>
    );
}

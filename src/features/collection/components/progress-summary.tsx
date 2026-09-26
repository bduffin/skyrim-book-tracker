import { CATEGORY_LABELS, SOURCE_LABELS } from '@/features/books/labels';
import { CATEGORIES, SOURCES } from '@/features/books/scope';

import type { ProgressScope, ProgressSummary as Progress } from '../progress';

/**
 * The collection page's progress summary (FR-5): two meters, collected and
 * read, over the same scope's total. Independent counts, never combined.
 *
 * Headed with the scope's name, and with the scope itself one click away,
 * because the list below it holds every marked book while the meters count
 * only this scope -- a reader who has marked only notes sees them listed and
 * both meters at zero, and should be able to see why without being told.
 *
 * Server-rendered from `getProgress` on every request, so it is true database
 * state rather than anything a client computed from its optimistic toggles
 * (NFR-6, R2).
 */
export function ProgressSummary({ progress }: { progress: Progress }) {
    return (
        <section
            aria-labelledby="progress-heading"
            // The same white panel as the /books filters, which lifts it off
            // the frost page in the same way.
            className="mx-4 rounded-lg border border-frost-300 bg-white p-4"
        >
            <h2
                id="progress-heading"
                className="pb-4 text-xs font-medium tracking-[0.18em] text-iron-500 uppercase"
            >
                Progress · {progress.scope.name}
            </h2>
            <div className="grid gap-5 sm:grid-cols-2">
                <Meter
                    label="Collected"
                    count={progress.collected}
                    total={progress.total}
                />
                <Meter
                    label="Read"
                    count={progress.read}
                    total={progress.total}
                />
            </div>
            <ScopeDetails scope={progress.scope} />
        </section>
    );
}

/**
 * The scope shown as the filters it is, rather than described in prose: every
 * category and source, the counted ones checked. Generated from the scope's
 * data, so a custom meter's scope would render the same way with no wording
 * written for it.
 *
 * Every option rather than only the counted ones, because what the reader is
 * usually looking for is the exclusion -- "Note" visibly unchecked answers
 * "why doesn't my note count?" directly.
 *
 * A native `<details>`: it opens without JavaScript, and the browser gives it
 * its keyboard handling and its expanded/collapsed state for screen readers.
 */
function ScopeDetails({ scope }: { scope: ProgressScope }) {
    return (
        <details className="group mt-4 border-t border-frost-200 pt-3 text-sm">
            <summary className="w-fit cursor-pointer rounded-sm text-iron-600 underline-offset-2 hover:text-iron-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800">
                What’s included?
            </summary>
            <div className="flex flex-col gap-3 pt-3">
                <ScopeFacet
                    label="Category"
                    options={CATEGORIES.map((category) => ({
                        label: CATEGORY_LABELS[category],
                        counted: scope.categories.includes(category),
                    }))}
                />
                <ScopeFacet
                    label="Source"
                    options={SOURCES.map((source) => ({
                        label: SOURCE_LABELS[source],
                        counted: scope.sources.includes(source),
                    }))}
                />
            </div>
        </details>
    );
}

/**
 * One facet of a scope, laid out like the /books filter chips so it reads as
 * the same filters -- but in the light frost tone rather than the iron fill,
 * which in this app means "selected and clickable", and these are neither
 * clickable nor controls.
 *
 * The check mark and weight carry "counted" visually; for a screen reader the
 * uncounted ones say so in words, since a list of names alone would suggest
 * every one of them is in.
 */
function ScopeFacet({
    label,
    options,
}: {
    label: string;
    options: { label: string; counted: boolean }[];
}) {
    return (
        <div>
            <p className="pb-1.5 text-xs font-medium tracking-[0.18em] text-iron-500 uppercase">
                {label}
            </p>
            <ul className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                    <li
                        key={option.label}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 ${
                            option.counted
                                ? 'border-iron-500 bg-frost-100 font-medium text-iron-900'
                                : 'border-frost-300 text-iron-500'
                        }`}
                    >
                        {option.counted && (
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="size-3.5 shrink-0"
                            >
                                <path d="M5 12l5 5L20 7" />
                            </svg>
                        )}
                        {option.label}
                        {!option.counted && (
                            <span className="sr-only">, not counted</span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * One meter: the figure in words, and a bar that repeats it.
 *
 * The text carries the information and the bar is decoration, hence
 * `aria-hidden`. A `<meter>` or `<progress>` element would announce the same
 * figure a second time, and their bars can only be styled through
 * per-browser pseudo-elements. "of", not a slash, because a screen reader
 * reads "12 / 423" as "12 slash 423".
 */
function Meter({
    label,
    count,
    total,
}: {
    label: string;
    count: number;
    total: number;
}) {
    const percent = total > 0 ? Math.min(100, (count / total) * 100) : 0;

    return (
        <div>
            <p className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium tracking-[0.18em] text-iron-500 uppercase">
                    {label}
                </span>
                <span className="text-sm text-iron-500">
                    <span className="font-serif text-2xl text-iron-900">
                        {count}
                    </span>{' '}
                    of {total}
                </span>
            </p>
            <div
                aria-hidden="true"
                // The track carries a border so its extent stays visible in
                // forced-colors mode, which repaints both fills to Canvas.
                className="mt-2 h-2 overflow-hidden rounded-full border border-frost-300 bg-frost-100"
            >
                <div
                    // iron-900, the app's "selected" fill. Forced-colors mode
                    // would erase it, so there it takes CanvasText instead.
                    className="h-full bg-iron-900 forced-colors:bg-[CanvasText] forced-colors:[forced-color-adjust:none]"
                    style={{
                        width: `${percent}%`,
                        // One book of 423 is a quarter of a percent, which
                        // would draw nothing at all: a first book marked
                        // should still show on the bar.
                        minWidth: count > 0 ? '0.25rem' : undefined,
                    }}
                />
            </div>
        </div>
    );
}

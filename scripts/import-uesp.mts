/**
 * UESP book import (Import M1: streaming + dry run).
 *
 * Reads a downloaded UESP XML dump, filters to Skyrim in-game book pages,
 * classifies and maps them, and reports what it found. Database writes are
 * Import M2 -- today this is dry-run only.
 *
 *   yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --dry-run
 *
 * See docs/specs/prd-import-uesp-books.md. The pure parsing lives in
 * uesp-parse.mts; this file is the I/O glue around it.
 */

import { parseArgs, type ImportOptions } from './lib/cli-args.mjs';
import { forEachPage, type DumpPage } from './lib/stream-dump.mjs';
import {
    assertDependencyResolved,
    extractCategoryLinks,
    loreTitleFor,
    mapToBookRow,
    mapToLocationRows,
    normalizeSkill,
    parseArtifactSummary,
    parseGameBookTemplate,
    parseLoreBook,
    parseUnobtainableBooks,
    UNOBTAINABLE_PAGE_TITLE,
    type BookRow,
    type LoreIndex,
    type LoreMetadata,
    type MappedLocation,
    type ParsedPage,
} from './lib/uesp-parse.mjs';

const SKYRIM_NS = 134;
const LORE_NS = 130;

type Collected = {
    books: ParsedPage[];
    lore: LoreIndex;
    unobtainable: Set<string>;
    skipped: { noTemplate: number; wrongNamespace: number };
};

/**
 * One streaming pass collects all three inputs.
 *
 * The spec once described the lore index and the unobtainable list as separate
 * passes; they are gathered here instead because a pass costs minutes and the
 * buffered result is ~2.3 MB. Buffering is unavoidable regardless: a book's
 * lore page can appear later in the dump than the book itself.
 */
async function collect(dumpPath: string): Promise<Collected> {
    const books: ParsedPage[] = [];
    const lore: LoreIndex = new Map();
    let unobtainable = new Set<string>();
    const skipped = { noTemplate: 0, wrongNamespace: 0 };

    const { pagesSeen, compression } = await forEachPage(
        dumpPath,
        (page: DumpPage) => {
            if (page.ns === LORE_NS) {
                const meta = parseLoreBook(page.wikitext);
                if (meta) lore.set(page.title.slice('Lore:'.length), meta);
                return;
            }
            if (page.ns !== SKYRIM_NS) {
                skipped.wrongNamespace += 1;
                return;
            }
            if (page.title === UNOBTAINABLE_PAGE_TITLE) {
                unobtainable = parseUnobtainableBooks(page.wikitext);
                return;
            }

            const params = parseGameBookTemplate(page.wikitext);
            if (!params) {
                skipped.noTemplate += 1;
                return;
            }
            books.push({
                uespPageId: page.pageId,
                uespTitle: page.title,
                params,
                artifactType: parseArtifactSummary(page.wikitext),
                categoryLinks: extractCategoryLinks(page.wikitext),
                lore: null, // resolved below, once every lore page has been seen
                unobtainable: undefined,
            });
        },
    );

    process.stderr.write(
        `read ${pagesSeen.toLocaleString()} pages (${compression})\n`,
    );
    return { books, lore, unobtainable, skipped };
}

/** Attaches the lore metadata and unobtainable set each book needs to map. */
function resolve(collected: Collected): {
    pages: ParsedPage[];
    loreResolved: number;
    loreReferenced: number;
} {
    let loreResolved = 0;
    let loreReferenced = 0;

    const pages = collected.books.map((book) => {
        const loreTitle = loreTitleFor(book.params['lorename']);
        let meta: LoreMetadata | null = null;
        if (loreTitle) {
            loreReferenced += 1;
            meta = collected.lore.get(loreTitle.slice('Lore:'.length)) ?? null;
            if (meta) loreResolved += 1;
        }
        return { ...book, lore: meta, unobtainable: collected.unobtainable };
    });

    return { pages, loreResolved, loreReferenced };
}

function tally<T extends string>(values: T[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of values) out[v] = (out[v] ?? 0) + 1;
    return out;
}

function table(counts: Record<string, number>): string {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `    ${k.padEnd(16)}${String(n).padStart(6)}`)
        .join('\n');
}

/** FR-17: the report is what catches regressions a total count cannot. */
function report(
    pages: ParsedPage[],
    rows: BookRow[],
    locations: MappedLocation[],
    meta: {
        options: ImportOptions;
        skipped: Collected['skipped'];
        unobtainable: number;
        loreResolved: number;
        loreReferenced: number;
    },
): void {
    const lines: string[] = [];
    const push = (s = '') => lines.push(s);

    push();
    push('═══ UESP book import — dry run ═══');
    push();
    push(`  dump        ${meta.options.dumpPath}`);
    push(`  dump date   ${meta.options.dumpDate ?? '(unknown)'}`);
    push(`  licence     Content from UESP, CC BY-SA 2.5`);
    push();
    push(`  books       ${rows.length.toLocaleString()}`);
    push(
        `  skipped     ${meta.skipped.noTemplate} ns-134 pages with no {{Game Book}}`,
    );
    push();
    push('  by category');
    push(table(tally(rows.map((r) => r.category))));
    push();
    push('  by source');
    push(table(tally(rows.map((r) => r.source))));
    push();

    const byTier = tally(locations.map((l) => l.location_type));
    const withLocations = new Set(locations.map((l) => l.uespPageId));
    push('  locations');
    push(`    rows            ${locations.length.toLocaleString()}`);
    push(table(byTier));
    push(
        `    books with none ${(rows.length - withLocations.size).toLocaleString()}`,
    );
    push();

    // Cross-page dependencies: a changed count is drift, zero is breakage (FR-6c).
    push('  cross-page dependencies');
    push(`    unobtainable listed   ${meta.unobtainable}`);
    push(
        `    lorenames resolved    ${meta.loreResolved} of ${meta.loreReferenced}`,
    );
    push();

    const nonNumericValue = rows.filter(
        (r) => r.value && !/^\d+(\.\d+)?$/.test(r.value),
    );
    const skillBooksNoSkill = rows.filter(
        (r) => r.category === 'skill_book' && r.skill === null,
    );
    // A page that HAS a |skill= we failed to normalize -- a lookup-table gap
    // (FR-10), distinct from a page that simply has no skill.
    const unmappedSkill = pages.filter(
        (p) => p.params['skill'] && normalizeSkill(p.params['skill']) === null,
    );
    push('  data-quality checks');
    push(
        `    non-numeric value     ${nonNumericValue.length}  ${nonNumericValue.map((r) => r.title).join(', ')}`,
    );
    push(
        `    skill_book, no skill  ${skillBooksNoSkill.length}  ${skillBooksNoSkill.map((r) => r.title).join(', ')}`,
    );
    push(
        `    unmapped skill values ${unmappedSkill.length}  ${unmappedSkill
            .map((p) => `${p.uespTitle}=${p.params['skill']}`)
            .join(', ')}`,
    );
    push(
        `    not obtainable        ${rows.filter((r) => !r.is_obtainable).length}`,
    );
    push();

    process.stdout.write(lines.join('\n') + '\n');
}

export async function run(options: ImportOptions): Promise<void> {
    const collected = await collect(options.dumpPath);

    // Both dependencies fail silently otherwise -- a renamed page, section or
    // template yields an empty result and the run would "succeed" with wrong
    // data (FR-4a, FR-6c).
    assertDependencyResolved(
        'unobtainable books',
        collected.unobtainable.size,
        UNOBTAINABLE_PAGE_TITLE,
    );

    const { pages, loreResolved, loreReferenced } = resolve(collected);
    if (loreReferenced > 0) {
        assertDependencyResolved(
            'lore metadata',
            loreResolved,
            `namespace ${LORE_NS}`,
        );
    }

    const rows = pages.map(mapToBookRow);
    const locations = pages.flatMap(mapToLocationRows);

    report(pages, rows, locations, {
        options,
        skipped: collected.skipped,
        unobtainable: collected.unobtainable.size,
        loreResolved,
        loreReferenced,
    });

    if (!options.dryRun) {
        throw new Error(
            'Database writes are Import M2 and are not implemented yet. Re-run with --dry-run.',
        );
    }
}

// This file is the entry point and nothing imports it, so it can simply run.
// Anything needed elsewhere lives in scripts/lib/.
try {
    await run(parseArgs(process.argv.slice(2)));
} catch (err) {
    // FR-1: a clear message, not a stack trace.
    process.stderr.write(`\nimport failed: ${(err as Error).message}\n\n`);
    process.exitCode = 1;
}

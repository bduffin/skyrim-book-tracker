/**
 * UESP book import (Import M2: streaming, dry run, and writes).
 *
 * Reads a downloaded UESP XML dump, filters to Skyrim in-game book pages,
 * classifies and maps them, reports what it found, and -- unless --dry-run --
 * upserts them into `book` and replaces their `book_location` rows.
 *
 *   yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --dry-run
 *   yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --url=http://127.0.0.1:54321
 *
 * See docs/specs/prd-import-uesp-books.md. The pure parsing lives in
 * uesp-parse.mts; this file is the I/O glue around it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { parseArgs, type ImportOptions } from './lib/cli-args.mjs';
import {
    chunk,
    createImportClient,
    dedupeByKey,
    groupLocations,
    resolveTarget,
    type Target,
} from './lib/db.mjs';
import { forEachPage, type DumpPage } from './lib/stream-dump.mjs';
import {
    assertDependencyResolved,
    attachBookIds,
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
        target: Target | null;
        skipped: Collected['skipped'];
        unobtainable: number;
        loreResolved: number;
        loreReferenced: number;
    },
): void {
    const lines: string[] = [];
    const push = (s = '') => lines.push(s);

    push();
    push(
        meta.target
            ? `═══ UESP book import → ${meta.target.host} ═══`
            : '═══ UESP book import — dry run ═══',
    );
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
    // Joined with '·' rather than ', ': book titles contain commas
    // ("Ancient Tales of the Dwemer, Part VI: ..."), so a comma-separated list
    // reads as more entries than the count beside it claims.
    push('  data-quality checks');
    push(
        `    non-numeric value     ${nonNumericValue.length}  ${nonNumericValue.map((r) => r.title).join(' · ')}`,
    );
    push(
        `    skill_book, no skill  ${skillBooksNoSkill.length}  ${skillBooksNoSkill.map((r) => r.title).join(' · ')}`,
    );
    push(
        `    unmapped skill values ${unmappedSkill.length}  ${unmappedSkill
            .map((p) => `${p.uespTitle}=${p.params['skill']}`)
            .join(' · ')}`,
    );
    push(
        `    not obtainable        ${rows.filter((r) => !r.is_obtainable).length}`,
    );
    push();

    process.stdout.write(lines.join('\n') + '\n');
}

type WriteOutcome = {
    booksSent: number;
    booksNew: number;
    booksUpdated: number;
    collapsed: number;
    locationRows: number;
    bookChunks: number;
};

/**
 * Every `uesp_page_id` already in the table, so the report can separate new
 * rows from updated ones (FR-17) -- PostgREST's upsert cannot tell us which
 * was which.
 *
 * Paged explicitly. A single `select()` is capped server-side (1,000 rows by
 * default), which is fewer than the 1,207 books we import: taking the first
 * response as the whole table would silently report ~200 existing books as
 * "new" on every run.
 */
async function existingPageIds(client: SupabaseClient): Promise<Set<number>> {
    const PAGE = 1000;
    const seen = new Set<number>();
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
            .from('book')
            .select('uesp_page_id')
            .range(from, from + PAGE - 1);
        if (error) {
            throw new Error(`reading existing books failed: ${error.message}`);
        }
        for (const row of data ?? []) seen.add(row.uesp_page_id as number);
        if (!data || data.length < PAGE) return seen;
    }
}

/** Upserts books, then replaces their locations chunk by chunk (FR-12, FR-13). */
async function write(
    target: Target,
    rows: BookRow[],
    locations: MappedLocation[],
): Promise<WriteOutcome> {
    const client = createImportClient(target);
    const { rows: unique, collapsed } = dedupeByKey(rows, 'uesp_page_id');
    const before = await existingPageIds(client);

    const idsByPageId = new Map<number, string>();
    const bookChunks = chunk(unique);
    for (const [i, batch] of bookChunks.entries()) {
        const { data, error } = await client
            .from('book')
            .upsert(batch, { onConflict: 'uesp_page_id' })
            .select('id, uesp_page_id');
        if (error) {
            throw new Error(
                `book upsert failed on chunk ${i + 1}/${bookChunks.length}: ` +
                    `${error.message}${error.hint ? `\n  hint: ${error.hint}` : ''}`,
            );
        }
        for (const row of data ?? []) {
            idsByPageId.set(row.uesp_page_id as number, row.id as string);
        }
        process.stderr.write(
            `  upserted ${idsByPageId.size}/${unique.length} books\n`,
        );
    }

    // Locations are replaced, not upserted, and the delete is scoped to the
    // book_ids in each payload -- so this must be chunked the same way (FR-13).
    const grouped = groupLocations(
        unique.map((r) => r.uesp_page_id),
        locations,
    );
    let locationRows = 0;
    let booksScoped = 0;
    const locChunks = chunk(grouped);
    for (const [i, batch] of locChunks.entries()) {
        const { data, error } = await client.rpc('replace_book_locations', {
            p_books: attachBookIds(batch, idsByPageId),
        });
        if (error) {
            throw new Error(
                `replace_book_locations failed on chunk ${i + 1}/` +
                    `${locChunks.length}: ${error.message}`,
            );
        }
        locationRows += (data as number) ?? 0;
        booksScoped += batch.length;
        process.stderr.write(
            `  replaced locations for ${booksScoped}/${grouped.length} books\n`,
        );
    }

    const booksNew = unique.filter((r) => !before.has(r.uesp_page_id)).length;
    return {
        booksSent: unique.length,
        booksNew,
        booksUpdated: unique.length - booksNew,
        collapsed,
        locationRows,
        bookChunks: bookChunks.length,
    };
}

function reportWrite(target: Target, out: WriteOutcome): void {
    process.stdout.write(
        [
            '  writes',
            `    target            ${target.host}${target.isLocal ? '' : '  (REMOTE)'}`,
            `    books upserted    ${out.booksSent.toLocaleString()} in ${out.bookChunks} chunk(s)`,
            `    new               ${out.booksNew.toLocaleString()}`,
            `    updated           ${out.booksUpdated.toLocaleString()}`,
            `    duplicate keys    ${out.collapsed}`,
            `    location rows     ${out.locationRows.toLocaleString()}`,
            '',
            '',
        ].join('\n'),
    );
}

export async function run(options: ImportOptions): Promise<void> {
    // FR-14: settle the target BEFORE the ~30s of streaming, so a mistargeted
    // run or a missing credential fails in a second rather than at the end. In
    // --dry-run no target is resolved at all, so no credential is read (FR-15).
    const target = options.dryRun
        ? null
        : resolveTarget(options.url ?? '', options.allowRemote);
    if (target) {
        process.stderr.write(
            `target ${target.host} (${target.isLocal ? 'local' : 'REMOTE'})\n`,
        );
    }

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

    // FR-14: the counts are printed before the first write, so a surprising
    // number is visible while it is still just a number on screen.
    report(pages, rows, locations, {
        options,
        target,
        skipped: collected.skipped,
        unobtainable: collected.unobtainable.size,
        loreResolved,
        loreReferenced,
    });

    if (target) reportWrite(target, await write(target, rows, locations));
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

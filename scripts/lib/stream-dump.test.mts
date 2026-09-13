/** Dump streaming: compression detection and page extraction (FR-2). */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCompression, forEachPage } from './stream-dump.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'sample-dump.xml');
const DUMP = join(
    HERE,
    '..',
    '..',
    'data',
    'uespwiki-2026-08-30-current.xml.bz2',
);

describe('detectCompression (FR-2)', () => {
    test('detects plain XML by content, not extension', async () => {
        assert.equal(await detectCompression(FIXTURE), 'none');
    });

    test('the real dump is bzip2', async (t) => {
        if (!existsSync(DUMP)) return t.skip('dump not present (gitignored)');
        assert.equal(await detectCompression(DUMP), 'bzip2');
    });
});

describe('forEachPage (FR-2)', () => {
    test('emits the PAGE id, not the revision or contributor id', async () => {
        const seen: { title: string; pageId: number }[] = [];
        await forEachPage(FIXTURE, (p) =>
            seen.push({ title: p.title, pageId: p.pageId }),
        );
        const thief = seen.find((p) => p.title === 'Skyrim:Thief (book)');
        assert.ok(thief);
        // The page id is ~6 digits; a revision id is an order of magnitude larger.
        assert.ok(
            thief.pageId > 0 && thief.pageId < 1_000_000,
            `got ${thief.pageId}`,
        );
    });

    test('carries namespace and wikitext through', async () => {
        const seen: { ns: number; wikitext: string; title: string }[] = [];
        await forEachPage(FIXTURE, (p) => seen.push(p));
        assert.equal(seen.length, 32);
        assert.ok(
            seen.some((p) => p.ns === 116),
            'the Oblivion page',
        );
        assert.ok(
            seen.some((p) => p.ns === 130),
            'the Lore page',
        );
        const deathbrand = seen.find(
            (p) => p.title === 'Skyrim:Deathbrand (book)',
        );
        assert.match(deathbrand?.wikitext ?? '', /\{\{Game Book/);
    });

    test('a file with no pages fails loudly rather than importing nothing', async () => {
        await assert.rejects(
            () => forEachPage(join(HERE, 'stream-dump.test.mts'), () => {}),
            /No <page> elements found/,
        );
    });
});

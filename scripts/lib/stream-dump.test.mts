/** Dump streaming: compression detection and page extraction (FR-2). */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

    // A <page> we cannot use must be COUNTED, not dropped in silence: that is
    // how a change to the dump's own shape would erase books unnoticed (AC-9).
    test('counts pages missing a title, ns or id instead of dropping them', async () => {
        const tmp = join(tmpdir(), `dump-malformed-${process.pid}.xml`);
        writeFileSync(
            tmp,
            `<mediawiki>
               <page><title>A</title><ns>134</ns><id>1</id>
                 <revision><text>{{Game Book}}</text></revision></page>
               <page><title>No id here</title><ns>134</ns>
                 <revision><text>{{Game Book}}</text></revision></page>
               <page><ns>134</ns><id>3</id>
                 <revision><text>{{Game Book}}</text></revision></page>
             </mediawiki>`,
        );
        try {
            const seen: string[] = [];
            const out = await forEachPage(tmp, (pg) => seen.push(pg.title));
            assert.deepEqual(seen, ['A']);
            assert.equal(out.pagesSeen, 1);
            assert.equal(out.pagesMalformed, 2, 'both must be reported');
        } finally {
            rmSync(tmp, { force: true });
        }
    });

    // Deliberately a temp file, not a source file: this test used to read
    // stream-dump.test.mts itself, which quietly started passing pages the
    // moment a test above embedded a <page> literal.
    test('a file with no pages fails loudly rather than importing nothing', async () => {
        const tmp = join(tmpdir(), `dump-empty-${process.pid}.xml`);
        writeFileSync(tmp, '<mediawiki><siteinfo/></mediawiki>');
        try {
            await assert.rejects(
                () => forEachPage(tmp, () => {}),
                /No <page> elements found/,
            );
        } finally {
            rmSync(tmp, { force: true });
        }
    });
});

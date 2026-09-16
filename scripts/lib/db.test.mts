/** Target guard and batching for the UESP import (FR-12, FR-13, FR-14). */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chunk, dedupeByKey, groupLocations, resolveTarget } from './db.mjs';
import type { MappedLocation } from './uesp-parse.mjs';

const REMOTE = 'https://rjfjulktcxnqpnodzngp.supabase.co';

describe('resolveTarget (FR-14)', () => {
    test('accepts every flavour of loopback without --allow-remote', () => {
        for (const url of [
            'http://localhost:54321',
            'http://127.0.0.1:54321',
            'http://127.0.0.2:54321', // the whole 127.0.0.0/8 range
            'http://[::1]:54321',
            'http://db.localhost:54321',
        ]) {
            assert.equal(resolveTarget(url, false).isLocal, true, url);
        }
    });

    test('refuses a remote target unless --allow-remote is passed', () => {
        assert.throws(
            () => resolveTarget(REMOTE, false),
            /Refusing to write to the remote database/,
        );
        const target = resolveTarget(REMOTE, true);
        assert.equal(target.isLocal, false);
        assert.equal(target.host, 'rjfjulktcxnqpnodzngp.supabase.co');
    });

    // The guard is the only thing standing between a typo and a live rewrite,
    // so it matches the parsed hostname rather than searching the raw string.
    test('is not fooled by hosts that merely contain "localhost"', () => {
        for (const url of [
            'https://localhost.evil.com',
            'https://prod.example.com/?redirect=localhost',
            'https://notlocalhost',
            'https://127.0.0.1.evil.com',
        ]) {
            assert.throws(() => resolveTarget(url, false), /Refusing/, url);
        }
    });

    test('names the missing option rather than failing obscurely', () => {
        assert.throws(() => resolveTarget('', false), /Pass --url=/);
        assert.throws(
            () => resolveTarget('not a url', true),
            /not a valid URL/,
        );
    });
});

describe('dedupeByKey (FR-12)', () => {
    test('collapses repeated conflict keys, keeping the last', () => {
        const { rows, collapsed } = dedupeByKey(
            [
                { uesp_page_id: 1, title: 'first' },
                { uesp_page_id: 2, title: 'other' },
                { uesp_page_id: 1, title: 'last' },
            ],
            'uesp_page_id',
        );
        assert.equal(rows.length, 2);
        assert.equal(collapsed, 1);
        assert.equal(rows.find((r) => r.uesp_page_id === 1)?.title, 'last');
    });

    test('reports nothing collapsed when keys are already unique', () => {
        const rows = [{ uesp_page_id: 1 }, { uesp_page_id: 2 }];
        assert.equal(dedupeByKey(rows, 'uesp_page_id').collapsed, 0);
    });
});

describe('chunk (FR-12)', () => {
    test('splits without dropping or duplicating', () => {
        const items = Array.from({ length: 7 }, (_, i) => i);
        assert.deepEqual(chunk(items, 3), [[0, 1, 2], [3, 4, 5], [6]]);
        assert.deepEqual(chunk(items, 7), [items]);
        assert.deepEqual(chunk([], 3), []);
    });

    test('rejects a zero size instead of looping forever', () => {
        assert.throws(() => chunk([1], 0), /size must be >= 1/);
    });
});

describe('groupLocations (FR-13)', () => {
    const locations: MappedLocation[] = [
        {
            uespPageId: 1,
            location_name: 'College of Winterhold',
            location_type: 'place',
            notes: 'Arcanaeum',
        },
        {
            uespPageId: 1,
            location_name: 'College of Winterhold',
            location_type: 'place',
            notes: "Arch-Mage's Quarters",
        },
        {
            uespPageId: 3,
            location_name: 'Dragonsreach',
            location_type: 'place',
            notes: null,
        },
    ];

    // The ~157 books with no locations must still be sent: their empty array is
    // what clears stale rows (AC-4a). Omitting them would strand old rows.
    test('includes books with no locations, carrying an empty array', () => {
        const grouped = groupLocations([1, 2, 3], locations);
        assert.equal(grouped.length, 3);
        assert.deepEqual(
            grouped.find((g) => g.uespPageId === 2),
            { uespPageId: 2, locations: [] },
        );
    });

    test('keeps the same place twice when the notes differ (AC-4b)', () => {
        const [first] = groupLocations([1], locations);
        assert.equal(first.locations.length, 2);
        assert.deepEqual(
            first.locations.map((l) => l.notes),
            ['Arcanaeum', "Arch-Mage's Quarters"],
        );
    });

    test('drops locations whose book was never upserted', () => {
        const grouped = groupLocations([1], locations);
        assert.equal(grouped.length, 1);
        assert.ok(!grouped.some((g) => g.uespPageId === 3));
    });

    test('strips uespPageId from the rows the RPC receives', () => {
        const [first] = groupLocations([1], locations);
        assert.deepEqual(Object.keys(first.locations[0]).sort(), [
            'location_name',
            'location_type',
            'notes',
        ]);
    });
});

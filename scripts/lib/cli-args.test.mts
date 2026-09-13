/** Argument handling for the UESP import (FR-1, FR-18). */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, dumpDateFromFilename } from './cli-args.mjs';

describe('parseArgs (FR-1)', () => {
    test('takes the dump path as a required positional', () => {
        const o = parseArgs(['data/dump.xml.bz2']);
        assert.equal(o.dumpPath, 'data/dump.xml.bz2');
        assert.equal(o.dryRun, false);
        assert.equal(o.allowRemote, false);
    });

    test('errors clearly when the path is missing', () => {
        assert.throws(() => parseArgs([]), /Usage: yarn import:uesp/);
        assert.throws(
            () => parseArgs(['--dry-run']),
            /Usage: yarn import:uesp/,
        );
    });

    test('rejects a second positional rather than silently ignoring it', () => {
        assert.throws(
            () => parseArgs(['a.bz2', 'b.bz2']),
            /Expected one dump path, got 2/,
        );
    });

    test('rejects unknown options rather than ignoring a typo', () => {
        assert.throws(
            () => parseArgs(['d.bz2', '--dryrun']),
            /Unknown option: --dryrun/,
        );
    });

    test('reads flags', () => {
        const o = parseArgs(['d.bz2', '--dry-run', '--allow-remote']);
        assert.equal(o.dryRun, true);
        assert.equal(o.allowRemote, true);
    });
});

describe('dumpDateFromFilename (FR-18)', () => {
    test('reads the date UESP encodes in the filename', () => {
        assert.equal(
            dumpDateFromFilename('data/uespwiki-2026-08-30-current.xml.bz2'),
            '2026-08-30',
        );
    });

    test('null when the file has been renamed', () => {
        assert.equal(dumpDateFromFilename('data/dump.xml.bz2'), null);
    });

    test('an explicit --dump-date overrides the filename', () => {
        const o = parseArgs([
            'uespwiki-2026-08-30-current.xml.bz2',
            '--dump-date=2026-01-01',
        ]);
        assert.equal(o.dumpDate, '2026-01-01');
    });
});

/**
 * The user-id gate and the statements built from it (Privacy AC-9, §12.2).
 *
 * Both halves are tested: the gate alone could be correct while the builder
 * substituted something else, or left a placeholder behind.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildStatement,
    COMMANDS,
    parseRequestArgs,
    parseUserId,
    rowsFrom,
    PLACEHOLDER,
    TEMPLATES,
} from './privacy-sql.mjs';

const ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

describe('parseUserId', () => {
    test('accepts a canonical UUID', () => {
        assert.equal(parseUserId(ID), ID);
    });

    test('accepts upper and mixed case, and lowercases it', () => {
        assert.equal(parseUserId(ID.toUpperCase()), ID);
        assert.equal(parseUserId('1B4e28BA-2fa1-11D2-883f-0016D3cca427'), ID);
    });

    const refused: [string, string][] = [
        ['a quote', `${ID}'`],
        ['a quote mid-id', `1b4e28ba-2fa1-11d2-883f-0016d3cc'427`],
        ['an appended SQL fragment', `${ID}'::uuid; drop table auth.users; --`],
        ['a trailing comment', `${ID}--`],
        ['leading whitespace', ` ${ID}`],
        ['trailing whitespace', `${ID} `],
        ['a trailing newline', `${ID}\n`],
        ['braces', `{${ID}}`],
        ['a missing hyphen', '1b4e28ba2fa1-11d2-883f-0016d3cca427'],
        ['no hyphens', '1b4e28ba2fa111d2883f0016d3cca427'],
        ['an extra character', `${ID}0`],
        ['a missing character', ID.slice(0, -1)],
        ['a non-hex character', '1b4e28ba-2fa1-11d2-883f-0016d3cca42g'],
        ['the URN form', `urn:uuid:${ID}`],
        ['an email address', 'someone@example.com'],
        ['the empty string', ''],
    ];
    for (const [name, input] of refused) {
        test(`refuses ${name}`, () => {
            assert.throws(() => parseUserId(input), /Not a user id/);
        });
    }
});

describe('buildStatement', () => {
    for (const command of COMMANDS) {
        test(`${command}: every placeholder becomes the quoted, cast id`, () => {
            const sql = buildStatement(command, ID.toUpperCase());
            const placeholders = count(TEMPLATES[command], PLACEHOLDER);

            assert.ok(placeholders > 0, 'the template takes the id');
            assert.equal(count(sql, PLACEHOLDER), 0);
            assert.equal(count(sql, `'${ID}'::uuid`), placeholders);
            // The id appears nowhere except at those placeholders -- and the
            // input's own casing appears nowhere at all.
            assert.equal(count(sql, ID), placeholders);
            assert.equal(count(sql, ID.toUpperCase()), 0);
        });

        test(`${command}: refuses a bad id before building anything`, () => {
            assert.throws(
                () => buildStatement(command, `${ID}' or true --`),
                /Not a user id/,
            );
        });
    }

    test('export never selects the GitHub tokens', () => {
        const sql = buildStatement('export', ID);
        assert.doesNotMatch(
            sql,
            /provider_access_token|provider_refresh_token/,
        );
    });
});

describe('parseRequestArgs', () => {
    test('reads command, id and target', () => {
        assert.deepEqual(parseRequestArgs(['show', ID, '--linked']), {
            command: 'show',
            userId: ID,
            target: 'linked',
        });
        assert.deepEqual(
            parseRequestArgs(['--local', 'verify', ID.toUpperCase()]),
            { command: 'verify', userId: ID, target: 'local' },
        );
    });

    test('requires a target rather than defaulting to one', () => {
        assert.throws(() => parseRequestArgs(['show', ID]), /exactly one of/);
    });

    test('refuses both targets at once', () => {
        assert.throws(
            () => parseRequestArgs(['show', ID, '--local', '--linked']),
            /exactly one of/,
        );
    });

    test('refuses an unknown command', () => {
        assert.throws(
            () => parseRequestArgs(['delete', ID, '--local']),
            /Unknown command: delete/,
        );
    });

    test('refuses an unknown option rather than ignoring a typo', () => {
        assert.throws(
            () => parseRequestArgs(['show', ID, '--linkd']),
            /Unknown option: --linkd/,
        );
    });

    test('refuses a missing or extra positional', () => {
        assert.throws(() => parseRequestArgs(['show', '--local']), /Usage/);
        assert.throws(
            () => parseRequestArgs(['show', ID, ID, '--local']),
            /Usage/,
        );
    });

    test('refuses a bad id', () => {
        assert.throws(
            () => parseRequestArgs(['show', 'someone@example.com', '--local']),
            /Not a user id/,
        );
    });
});

describe('rowsFrom', () => {
    test('reads the bare array printed to a person', () => {
        assert.deepEqual(rowsFrom('[{"n": 1}]'), [{ n: 1 }]);
    });

    test('reads the wrapped form printed to an agent', () => {
        const wrapped = JSON.stringify({
            boundary: 'abc',
            rows: [{ n: 1 }],
            warning: 'untrusted',
        });
        assert.deepEqual(rowsFrom(wrapped), [{ n: 1 }]);
    });

    test('refuses anything else rather than guessing', () => {
        assert.throws(() => rowsFrom('Connecting...'), /Could not read/);
        assert.throws(() => rowsFrom('{"error": "x"}'), /Unexpected/);
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    FLAG_FIELDS,
    flagFailureMessage,
    parseSetFlagInput,
    rpcArgsFor,
} from './flag-input';

const BOOK = '3f6c2a1e-8b4d-4e2f-9a7c-1d5e6f7a8b9c';

/** Builds real FormData, since that is what the action receives. */
function form(fields: [string, string | Blob][]): FormData {
    const data = new FormData();
    for (const [name, value] of fields) data.append(name, value);
    return data;
}

const valid = (): [string, string][] => [
    [FLAG_FIELDS.bookId, BOOK],
    [FLAG_FIELDS.flag, 'read'],
    [FLAG_FIELDS.value, 'true'],
];

describe('parseSetFlagInput (FR-4, R5)', () => {
    test('reads a valid submission', () => {
        assert.deepEqual(parseSetFlagInput(form(valid())), {
            bookId: BOOK,
            flag: 'read',
            value: true,
        });
    });

    test('reads both flags and both values', () => {
        assert.deepEqual(
            parseSetFlagInput(
                form([
                    [FLAG_FIELDS.bookId, BOOK],
                    [FLAG_FIELDS.flag, 'collected'],
                    [FLAG_FIELDS.value, 'false'],
                ]),
            ),
            { bookId: BOOK, flag: 'collected', value: false },
        );
    });

    test('accepts an upper-case UUID, which Postgres does too', () => {
        const input = parseSetFlagInput(
            form([
                [FLAG_FIELDS.bookId, BOOK.toUpperCase()],
                ...valid().slice(1),
            ]),
        );
        assert.equal(input?.bookId, BOOK.toUpperCase());
    });

    test('rejects a missing field', () => {
        for (const missing of Object.values(FLAG_FIELDS)) {
            const fields = valid().filter(([name]) => name !== missing);
            assert.equal(parseSetFlagInput(form(fields)), null, missing);
        }
    });

    // `get` would quietly take the first; there is no right answer between
    // two book ids, so neither is used.
    test('rejects a repeated field', () => {
        for (const repeated of Object.values(FLAG_FIELDS)) {
            const extra = valid().find(([name]) => name === repeated)!;
            assert.equal(
                parseSetFlagInput(form([...valid(), extra])),
                null,
                repeated,
            );
        }
    });

    test('rejects a book id that is not a UUID', () => {
        for (const bookId of ['', '42', `${BOOK}x`, ` ${BOOK}`, 'not-a-uuid']) {
            const fields: [string, string][] = [
                [FLAG_FIELDS.bookId, bookId],
                ...valid().slice(1),
            ];
            assert.equal(parseSetFlagInput(form(fields)), null, bookId);
        }
    });

    // Strict, unlike the URL parsers: a tampered write has no safe default.
    test('rejects a flag or value outside its allowlist', () => {
        for (const [name, value] of [
            [FLAG_FIELDS.flag, 'Read'],
            [FLAG_FIELDS.flag, 'is_read'],
            [FLAG_FIELDS.value, 'TRUE'],
            [FLAG_FIELDS.value, '1'],
            [FLAG_FIELDS.value, 'on'],
        ]) {
            const fields = valid().map(([n, v]): [string, string] =>
                n === name ? [n, value] : [n, v],
            );
            assert.equal(
                parseSetFlagInput(form(fields)),
                null,
                `${name}=${value}`,
            );
        }
    });

    test('rejects a file where text was expected', () => {
        const fields: [string, string | Blob][] = [
            [FLAG_FIELDS.bookId, new Blob([BOOK])],
            ...valid().slice(1),
        ];
        assert.equal(parseSetFlagInput(form(fields)), null);
    });

    // R5: identity comes from the session. A user_id in the form is not
    // rejected -- it is simply never read, and never reaches the result.
    test('ignores a user id in the form rather than carrying it', () => {
        const input = parseSetFlagInput(
            form([
                ...valid(),
                ['user_id', 'b0b0b0b0-0000-4000-8000-000000000000'],
            ]),
        );
        assert.deepEqual(Object.keys(input!).sort(), [
            'bookId',
            'flag',
            'value',
        ]);
    });
});

describe('rpcArgsFor (FR-4)', () => {
    // Omitting the other flag is what set_book_flags reads as "leave it as it
    // is"; sending it as false would clear it.
    test('sends only the flag being changed', () => {
        assert.deepEqual(
            rpcArgsFor({ bookId: BOOK, flag: 'read', value: false }),
            {
                p_book_id: BOOK,
                p_is_read: false,
            },
        );
        assert.deepEqual(
            rpcArgsFor({ bookId: BOOK, flag: 'collected', value: true }),
            { p_book_id: BOOK, p_is_collected: true },
        );
    });
});

describe('flagFailureMessage (FR-4, MI6)', () => {
    const TITLE = 'The Lusty Argonian Maid';

    test('names the book in every message', () => {
        for (const failure of [
            'unauthenticated',
            'unreachable',
            'write_failed',
            'invalid_input',
        ] as const) {
            assert.match(
                flagFailureMessage(failure, TITLE),
                /Lusty Argonian/,
                failure,
            );
        }
    });

    test('tells a signed-out reader to sign in, not that something broke', () => {
        assert.match(flagFailureMessage('unauthenticated', TITLE), /Sign in/);
    });

    test('points a connection failure at the connection', () => {
        assert.match(flagFailureMessage('unreachable', TITLE), /connection/);
    });
});

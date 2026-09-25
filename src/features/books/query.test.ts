import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFlagFilters, resolveFlagFilters } from './query';

const VIEWER = '00000000-0000-0000-0000-00000000000a';

describe('resolveFlagFilters (FR-2, FR-3)', () => {
    test('a signed-in viewer’s filters pass through for the database', () => {
        assert.deepEqual(resolveFlagFilters('true', 'false', VIEWER), {
            read: 'true',
            collected: 'false',
        });
    });

    test('a signed-out visitor’s true filter matches nothing', () => {
        assert.equal(resolveFlagFilters('true', 'any', null), null);
        assert.equal(resolveFlagFilters('any', 'true', null), null);
        assert.equal(resolveFlagFilters('true', 'false', null), null);
    });

    // Every book is unread and uncollected for them, so a false filter keeps
    // the whole list: it is no filter at all, and needs no join.
    test('a signed-out visitor’s false filter is no filter', () => {
        const none = { read: 'any', collected: 'any' };
        assert.deepEqual(resolveFlagFilters('false', 'any', null), none);
        assert.deepEqual(resolveFlagFilters('false', 'false', null), none);
        assert.deepEqual(resolveFlagFilters('any', 'any', null), none);
    });
});

describe('applyFlagFilters', () => {
    /** Records every call, so the predicates can be read back in order. */
    function recorder() {
        const calls: string[] = [];
        const query = {
            eq(column: string, value: boolean | string) {
                calls.push(`eq ${column} ${value}`);
                return query;
            },
            is(column: string, value: null) {
                calls.push(`is ${column} ${value}`);
                return query;
            },
            or(filters: string, options: { referencedTable: string }) {
                calls.push(`or ${options.referencedTable} ${filters}`);
                return query;
            },
        };
        return { query, calls };
    }

    test('no flag filter adds no predicate, with or without a viewer', () => {
        for (const viewer of [VIEWER, null]) {
            const { query, calls } = recorder();
            applyFlagFilters(query, 'any', 'any', viewer);
            assert.deepEqual(calls, []);
        }
    });

    // Once FR-10 lets anyone read a public user's rows, an embed scoped only
    // by RLS would match other users' rows. The DB test proves the scoping
    // works; this pins that both join shapes carry it.
    test('both the inner join and the anti-join are scoped to the viewer', () => {
        for (const [read, collected] of [
            ['true', 'any'],
            ['false', 'any'],
        ] as const) {
            const { query, calls } = recorder();
            applyFlagFilters(query, read, collected, VIEWER);
            assert.equal(calls[0], `eq flag_filter.user_id ${VIEWER}`);
        }
    });

    test('a flag filter with no viewer throws rather than falling back to RLS', () => {
        const { query } = recorder();
        assert.throws(
            () => applyFlagFilters(query, 'false', 'any', null),
            /resolveFlagFilters/,
        );
    });
});

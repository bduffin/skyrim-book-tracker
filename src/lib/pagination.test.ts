/**
 * Tests for the shared pagination arithmetic, moved here from
 * `src/features/books/scope.test.ts` with the code they cover.
 *
 * Expectations are written from FR-6 and the measured catalogue, not captured
 * from this implementation. The default scope's 423 books and 9 pages recur
 * below because they are the real case this was verified against.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    clampPage,
    pageCountFor,
    pageQuery,
    paginationItems,
    parsePageParam,
    rangeFor,
} from './pagination';

describe('parsePageParam (AC-10)', () => {
    test('reads a valid page', () => {
        assert.equal(parsePageParam('1'), 1);
        assert.equal(parsePageParam('2'), 2);
        assert.equal(parsePageParam('9'), 9);
    });

    test('tolerates surrounding whitespace', () => {
        assert.equal(parsePageParam('  3  '), 3);
    });

    test('falls back to 1 when the param is absent or empty', () => {
        assert.equal(parsePageParam(undefined), 1);
        assert.equal(parsePageParam(''), 1);
        assert.equal(parsePageParam('   '), 1);
    });

    test('rejects a trailing-garbage number that parseInt would accept', () => {
        // parseInt('12abc') is 12; this must not be page 12.
        assert.equal(parsePageParam('12abc'), 1);
    });

    test('rejects non-integers and signed forms', () => {
        assert.equal(parsePageParam('abc'), 1);
        assert.equal(parsePageParam('2.5'), 1);
        assert.equal(parsePageParam('1e3'), 1);
        assert.equal(parsePageParam('-3'), 1);
        assert.equal(parsePageParam('+3'), 1);
    });

    test('rejects zero, which is not a 1-based page', () => {
        assert.equal(parsePageParam('0'), 1);
    });

    test('rejects a number too large to represent exactly', () => {
        assert.equal(parsePageParam('99999999999999999999'), 1);
    });

    test('rejects a repeated param rather than guessing which one won', () => {
        assert.equal(parsePageParam(['2', '3']), 1);
        assert.equal(parsePageParam([]), 1);
    });
});

describe('pageCountFor (FR-6)', () => {
    test('an empty result is still one page', () => {
        assert.equal(pageCountFor(0), 1);
    });

    test('a partial page counts as a page', () => {
        assert.equal(pageCountFor(1), 1);
        assert.equal(pageCountFor(49), 1);
    });

    test('an exactly full page does not spill into a second', () => {
        assert.equal(pageCountFor(50), 1);
        assert.equal(pageCountFor(100), 2);
    });

    test('one row past a full page starts the next', () => {
        assert.equal(pageCountFor(51), 2);
    });

    test('the default scope is 9 pages', () => {
        // 423 books in FR-3's default scope: 8 full pages plus 23.
        assert.equal(pageCountFor(423), 9);
    });

    test('nonsense totals degrade to one page', () => {
        assert.equal(pageCountFor(-5), 1);
        assert.equal(pageCountFor(Number.NaN), 1);
    });
});

describe('clampPage', () => {
    test('leaves a page that exists alone', () => {
        assert.equal(clampPage(1, 9), 1);
        assert.equal(clampPage(9, 9), 9);
    });

    test('pins a page past the end to the last one', () => {
        assert.equal(clampPage(10, 9), 9);
        assert.equal(clampPage(1000, 9), 9);
    });

    test('pins a page below the start to the first', () => {
        assert.equal(clampPage(0, 9), 1);
    });
});

describe('rangeFor', () => {
    test('page 1 starts at row 0 and is inclusive at both ends', () => {
        assert.deepEqual(rangeFor(1), [0, 49]);
    });

    test('page 2 begins where page 1 stopped, with no gap or overlap', () => {
        assert.deepEqual(rangeFor(2), [50, 99]);
    });

    test('the last page of the default scope', () => {
        assert.deepEqual(rangeFor(9), [400, 449]);
    });
});

describe('paginationItems (FR-6)', () => {
    test('a single page needs no elision', () => {
        assert.deepEqual(paginationItems(1, 1), [1]);
        assert.deepEqual(paginationItems(1, 2), [1, 2]);
    });

    test('the default scope, from the first page', () => {
        // 9 pages: first, a window of two ahead, then the last.
        assert.deepEqual(paginationItems(1, 9), [1, 2, 3, 'gap', 9]);
    });

    test('the default scope, from the last page', () => {
        assert.deepEqual(paginationItems(9, 9), [1, 'gap', 7, 8, 9]);
    });

    test('9 pages are few enough to show whole from the middle', () => {
        assert.deepEqual(paginationItems(5, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('a long run elides on both sides', () => {
        assert.deepEqual(paginationItems(25, 50), [
            1,
            'gap',
            23,
            24,
            25,
            26,
            27,
            'gap',
            50,
        ]);
    });

    test('a gap standing in for one page shows the page instead', () => {
        // 1 and 3 are both shown, so eliding "2" would cost the same width
        // as printing it.
        assert.deepEqual(paginationItems(5, 50)[1], 2);
    });
});

describe('pageQuery (FR-6)', () => {
    test('page 1 is the default and is left out', () => {
        assert.equal(pageQuery(1), '');
        assert.equal(pageQuery(1, {}), '');
    });

    test('later pages carry the param', () => {
        assert.equal(pageQuery(2), 'page=2');
    });

    test('other params survive, so Browse M2 filters keep working', () => {
        assert.equal(
            pageQuery(2, { category: 'book' }),
            'category=book&page=2',
        );
        assert.equal(pageQuery(1, { category: 'book' }), 'category=book');
    });

    test('a repeated param keeps every value', () => {
        assert.equal(
            pageQuery(2, { category: ['book', 'black_book'] }),
            'category=book&category=black_book&page=2',
        );
    });

    test('an incoming page param is replaced, never duplicated', () => {
        assert.equal(pageQuery(3, { page: '2' }), 'page=3');
    });

    test('an undefined value is dropped rather than stringified', () => {
        assert.equal(pageQuery(2, { category: undefined }), 'page=2');
    });
});

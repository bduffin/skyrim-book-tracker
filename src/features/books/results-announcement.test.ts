/**
 * Browse M5 tests for the results announcement (NFR-7, AC-16).
 *
 * Expectations are the sentences a listener should hear, written out by hand
 * rather than captured from this implementation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    FLAG_FILTER_NOTICE,
    resultsAnnouncement,
    showsFlagFilterNotice,
} from './results-announcement';
import { DEFAULT_FILTERS } from './scope';

describe('resultsAnnouncement (NFR-7, AC-16)', () => {
    test('the default scope names the count and the page', () => {
        assert.equal(
            resultsAnnouncement({
                total: 423,
                page: 1,
                pageCount: 9,
                notice: false,
            }),
            '423 books match, page 1 of 9.',
        );
    });

    test('a later page names that page', () => {
        assert.equal(
            resultsAnnouncement({
                total: 423,
                page: 9,
                pageCount: 9,
                notice: false,
            }),
            '423 books match, page 9 of 9.',
        );
    });

    test('a single page leaves the page out', () => {
        assert.equal(
            resultsAnnouncement({
                total: 12,
                page: 1,
                pageCount: 1,
                notice: false,
            }),
            '12 books match.',
        );
    });

    test('one book is singular', () => {
        assert.equal(
            resultsAnnouncement({
                total: 1,
                page: 1,
                pageCount: 1,
                notice: false,
            }),
            '1 book matches.',
        );
    });

    test('no books says so rather than counting zero', () => {
        assert.equal(
            resultsAnnouncement({
                total: 0,
                page: 1,
                pageCount: 1,
                notice: false,
            }),
            'No books match.',
        );
    });

    test('the notice follows the count', () => {
        assert.equal(
            resultsAnnouncement({
                total: 0,
                page: 1,
                pageCount: 1,
                notice: true,
            }),
            `No books match. ${FLAG_FILTER_NOTICE}`,
        );
    });

    test('carries no layout punctuation for a screen reader to spell out', () => {
        const spoken = resultsAnnouncement({
            total: 423,
            page: 2,
            pageCount: 9,
            notice: true,
        });
        assert.doesNotMatch(spoken, /[–·]/);
    });
});

describe('showsFlagFilterNotice (FR-2)', () => {
    test('only when signed out with a flag filter set', () => {
        const flagged = { ...DEFAULT_FILTERS, read: 'false' as const };
        assert.equal(showsFlagFilterNotice(flagged, false), true);
        assert.equal(showsFlagFilterNotice(flagged, true), false);
        assert.equal(showsFlagFilterNotice(DEFAULT_FILTERS, false), false);
    });
});

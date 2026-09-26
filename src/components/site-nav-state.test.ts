import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { navSectionFor } from './site-nav-state';

describe('navSectionFor', () => {
    test('/books, with or without a trailing slash', () => {
        assert.equal(navSectionFor('/books'), 'books');
        assert.equal(navSectionFor('/books/'), 'books');
    });

    test('a collection page is the collection section', () => {
        assert.equal(
            navSectionFor('/collection/8d2f1c3a-5b6e-4f70-9a81-2c3d4e5f6a7b'),
            'collection',
        );
    });

    // Whole segments only: a prefix match would light up the wrong link.
    test('a path that merely starts with a section name is not in it', () => {
        assert.equal(navSectionFor('/bookshelf'), null);
        assert.equal(navSectionFor('/collections'), null);
    });

    test('pages in neither section mark nothing current', () => {
        assert.equal(navSectionFor('/'), null);
        assert.equal(navSectionFor('/auth/auth-error'), null);
    });
});

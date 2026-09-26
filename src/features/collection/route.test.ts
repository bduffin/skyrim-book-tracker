import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { collectionPath, isOwnCollection } from './route';

const VIEWER = '8d2f1c3a-5b6e-4f70-9a81-2c3d4e5f6a7b';
const SOMEONE_ELSE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('collectionPath (FR-8)', () => {
    test('puts the user id in the segment', () => {
        assert.equal(collectionPath(VIEWER), `/collection/${VIEWER}`);
    });
});

describe('isOwnCollection (FR-8, FR-10)', () => {
    test('the viewer’s own id is theirs', () => {
        assert.equal(isOwnCollection(VIEWER, VIEWER), true);
    });

    test('an upper-cased link to their own id is still theirs', () => {
        assert.equal(isOwnCollection(VIEWER.toUpperCase(), VIEWER), true);
    });

    // Until FR-10's setting exists, every non-owner is bounced.
    test('another user’s collection is not', () => {
        assert.equal(isOwnCollection(SOMEONE_ELSE, VIEWER), false);
    });

    test('nothing is a signed-out visitor’s', () => {
        assert.equal(isOwnCollection(VIEWER, null), false);
    });

    test('a segment that is not an id is nobody’s', () => {
        for (const segment of ['', 'bduffin', `${VIEWER}x`, ` ${VIEWER}`]) {
            assert.equal(isOwnCollection(segment, VIEWER), false, segment);
        }
    });
});

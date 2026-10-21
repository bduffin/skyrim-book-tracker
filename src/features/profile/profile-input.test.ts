import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    isSavedParam,
    nextFromParam,
    parseProfileInput,
    pathAfterProfileCheck,
    PROFILE_FIELDS,
    SAVED_PATH,
    saveDestination,
    settingsPath,
} from './profile-input';

/** Builds real FormData, since that is what the action receives. */
function form(fields: [string, string | Blob][]): FormData {
    const data = new FormData();
    for (const [name, value] of fields) data.append(name, value);
    return data;
}

describe('parseProfileInput (Profiles FR-5)', () => {
    test('reads public and private', () => {
        assert.deepEqual(
            parseProfileInput(form([[PROFILE_FIELDS.isPublic, 'true']])),
            { isPublic: true, next: null },
        );
        assert.deepEqual(
            parseProfileInput(form([[PROFILE_FIELDS.isPublic, 'false']])),
            { isPublic: false, next: null },
        );
    });

    test('rejects a missing, repeated or unrecognized choice', () => {
        for (const fields of [
            [],
            [[PROFILE_FIELDS.isPublic, '']],
            [[PROFILE_FIELDS.isPublic, 'TRUE']],
            [[PROFILE_FIELDS.isPublic, 'on']],
            [[PROFILE_FIELDS.isPublic, '1']],
            [
                [PROFILE_FIELDS.isPublic, 'true'],
                [PROFILE_FIELDS.isPublic, 'false'],
            ],
            [[PROFILE_FIELDS.isPublic, new Blob(['true'])]],
        ] as [string, string | Blob][][]) {
            assert.equal(parseProfileInput(form(fields)), null);
        }
    });

    test('keeps a safe next, filters included', () => {
        assert.deepEqual(
            parseProfileInput(
                form([
                    [PROFILE_FIELDS.isPublic, 'false'],
                    [PROFILE_FIELDS.next, '/books?source=base&page=2'],
                ]),
            ),
            { isPublic: false, next: '/books?source=base&page=2' },
        );
    });

    test('drops an unsafe, empty or repeated next without failing the save', () => {
        for (const next of [
            ['https://example.com/'],
            ['//example.com/'],
            ['/auth/callback'],
            ['/books/../auth/callback'],
            [''],
            ['/books', '/collection'],
        ]) {
            assert.deepEqual(
                parseProfileInput(
                    form([
                        [PROFILE_FIELDS.isPublic, 'true'],
                        ...next.map((value): [string, string] => [
                            PROFILE_FIELDS.next,
                            value,
                        ]),
                    ]),
                ),
                { isPublic: true, next: null },
                `next: ${JSON.stringify(next)}`,
            );
        }
    });
});

describe('saveDestination (Profiles FR-5)', () => {
    test('goes to next when given, otherwise to the confirmation', () => {
        assert.equal(
            saveDestination({ isPublic: true, next: '/books?source=base' }),
            '/books?source=base',
        );
        assert.equal(
            saveDestination({ isPublic: true, next: null }),
            '/settings?saved=1',
        );
        assert.equal(SAVED_PATH, '/settings?saved=1');
    });
});

describe('settingsPath', () => {
    test('is plain /settings without a destination', () => {
        assert.equal(settingsPath(), '/settings');
    });

    test('carries next encoded, so its own query survives intact', () => {
        assert.equal(
            settingsPath('/books?source=base&page=2'),
            '/settings?next=%2Fbooks%3Fsource%3Dbase%26page%3D2',
        );
    });

    test('round-trips through the page’s own reading of next', () => {
        const next = '/books?source=base&page=2';
        const url = new URL(settingsPath(next), 'http://example.test');
        assert.equal(nextFromParam(url.searchParams.get('next')!), next);
    });
});

describe('pathAfterProfileCheck (Profiles FR-4)', () => {
    const next = '/books?source=base';

    test('no row: setup, carrying next', () => {
        assert.equal(
            pathAfterProfileCheck('none', next),
            '/settings?next=%2Fbooks%3Fsource%3Dbase',
        );
    });

    test('a row: straight to next', () => {
        assert.equal(pathAfterProfileCheck('found', next), next);
    });

    test('a failed check: straight to next, never setup', () => {
        assert.equal(pathAfterProfileCheck('error', next), next);
    });
});

describe('nextFromParam', () => {
    test('keeps one safe path', () => {
        assert.equal(nextFromParam('/books?source=base'), '/books?source=base');
    });

    test('reads anything else as absent', () => {
        for (const value of [
            undefined,
            '',
            'https://example.com/',
            '/auth/auth-error',
            ['/books', '/books'],
        ]) {
            assert.equal(nextFromParam(value), null);
        }
    });
});

describe('isSavedParam', () => {
    test('is true for exactly 1', () => {
        assert.equal(isSavedParam('1'), true);
    });

    test('is false for anything else, so the link carries no text', () => {
        for (const value of [undefined, '', '0', 'true', 'yes', '1 ', ['1']]) {
            assert.equal(isSavedParam(value), false);
        }
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { avatarUrlFor, initialFor } from './avatar';

describe('avatarUrlFor', () => {
    test('uses a GitHub avatar, rebuilt from its id without the query', () => {
        assert.equal(
            avatarUrlFor({
                avatar_url:
                    'https://avatars.githubusercontent.com/u/1234567?v=4',
            }),
            'https://avatars.githubusercontent.com/u/1234567',
        );
    });

    // Rebuilt from the id, so what reaches next/image is always a URL its
    // allow-list accepts, whatever the user put in their metadata.
    test('nothing user-written survives into the URL', () => {
        for (const url of [
            'https://avatars.githubusercontent.com/u/1?x=), url(https://evil.test/p.png',
            'https://avatars.githubusercontent.com/u/1)',
            'https://avatars.githubusercontent.com/u/1/../../x',
            'https://avatars.githubusercontent.com/u/abc',
            'https://avatars.githubusercontent.com/u/',
        ]) {
            const result = avatarUrlFor({ avatar_url: url });
            assert.ok(
                result === null ||
                    /^https:\/\/avatars\.githubusercontent\.com\/u\/\d+$/.test(
                        result,
                    ),
                url,
            );
        }
        assert.equal(
            avatarUrlFor({
                avatar_url: 'https://avatars.githubusercontent.com/u/abc',
            }),
            null,
        );
    });

    test('shows the initial when there is no avatar', () => {
        assert.equal(avatarUrlFor(undefined), null);
        assert.equal(avatarUrlFor({}), null);
        assert.equal(avatarUrlFor({ avatar_url: '' }), null);
        assert.equal(avatarUrlFor({ avatar_url: 42 }), null);
    });

    // user_metadata is editable by the user, so avatar_url can be anything.
    test('refuses anything but HTTPS on GitHub’s user-avatar paths', () => {
        for (const url of [
            'https://evil.test/me.png',
            'https://avatars.githubusercontent.com.evil.test/u/1',
            'http://avatars.githubusercontent.com/u/1',
            // The right host but not a user-avatar path: accepting it would
            // fail next/image's allow-list, which throws a 500.
            'https://avatars.githubusercontent.com/something-else',
            'https://avatars.githubusercontent.com/',
            'https://avatars.githubusercontent.com/in/1',
            'javascript:alert(1)',
            'not a url',
        ]) {
            assert.equal(avatarUrlFor({ avatar_url: url }), null, url);
        }
    });
});

describe('initialFor', () => {
    test('upper-cases the first letter', () => {
        assert.equal(initialFor('bduffin'), 'B');
    });

    test('ignores leading space, and never returns nothing', () => {
        assert.equal(initialFor('  ada'), 'A');
        assert.equal(initialFor(''), '?');
        assert.equal(initialFor('   '), '?');
    });

    test('keeps a character outside the basic plane whole', () => {
        assert.equal(initialFor('𝔅en'), '𝔅');
    });
});

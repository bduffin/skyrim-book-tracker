import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { headerNameFor } from './header-name';

/** What a sign-up could plant: every name key a provider uses. */
const PLANTED = {
    user_name: 'planted',
    preferred_username: 'planted',
    full_name: 'Planted Name',
    name: 'Planted Name',
};

describe('headerNameFor (Email FR-8)', () => {
    test('is GitHub’s user_name when github is a provider', () => {
        assert.equal(
            headerNameFor({
                app_metadata: { providers: ['github'] },
                user_metadata: { user_name: 'octocat', full_name: 'Mona' },
            }),
            'octocat',
        );
    });

    test('still is when the account has an email identity too', () => {
        assert.equal(
            headerNameFor({
                app_metadata: { providers: ['email', 'github'] },
                user_metadata: { user_name: 'octocat' },
            }),
            'octocat',
        );
    });

    test('is nothing for an email-only account, whatever its metadata says', () => {
        assert.equal(
            headerNameFor({
                app_metadata: { providers: ['email'] },
                user_metadata: PLANTED,
            }),
            null,
        );
    });

    test('never falls back to another name key', () => {
        assert.equal(
            headerNameFor({
                app_metadata: { providers: ['github'] },
                user_metadata: {
                    preferred_username: 'planted',
                    full_name: 'Planted Name',
                    name: 'Planted Name',
                },
            }),
            null,
        );
    });

    test('is nothing for a blank or non-string user_name', () => {
        for (const userName of ['', '   ', 42, null, ['octocat']]) {
            assert.equal(
                headerNameFor({
                    app_metadata: { providers: ['github'] },
                    user_metadata: { user_name: userName },
                }),
                null,
            );
        }
    });

    test('is nothing without a providers list, or with a malformed one', () => {
        for (const app_metadata of [
            undefined,
            {},
            { providers: 'github' },
            { providers: [] },
        ]) {
            assert.equal(
                headerNameFor({ app_metadata, user_metadata: PLANTED }),
                null,
            );
        }
    });

    test('never shows any part of the email address', () => {
        const claims = {
            email: 'jane.doe@example.com',
            app_metadata: { providers: ['email'] },
            user_metadata: { email: 'jane.doe@example.com' },
        };
        assert.equal(headerNameFor(claims), null);
    });
});

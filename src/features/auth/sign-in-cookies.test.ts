import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    clearCodeVerifierCookies,
    isCodeVerifierCookie,
} from './sign-in-cookies';

describe('isCodeVerifierCookie', () => {
    test('matches the three code-verifier cookies a code send leaves', () => {
        for (const name of [
            'sb-127-auth-token-code-verifier',
            'sb-127-auth-token-flows-code-verifier',
            'sb-127-auth-token-flow-9168c8af77bd863c22d1a8491d24cb96-code-verifier',
            'sb-rjfjulktcxnqpnodzngp-auth-token-code-verifier',
        ]) {
            assert.equal(isCodeVerifierCookie(name), true, name);
        }
    });

    // Deleting these would sign the reader straight back out.
    test('never matches the session cookie or its chunks', () => {
        for (const name of [
            'sb-127-auth-token',
            'sb-127-auth-token.0',
            'sb-127-auth-token.1',
            'email-sign-in',
            'code-verifier',
        ]) {
            assert.equal(isCodeVerifierCookie(name), false, name);
        }
    });
});

describe('clearCodeVerifierCookies', () => {
    test('deletes the verifiers, at the path they were set on, and nothing else', () => {
        const deleted: { name: string; path: string }[] = [];
        clearCodeVerifierCookies({
            getAll: () =>
                [
                    'sb-127-auth-token',
                    'sb-127-auth-token-code-verifier',
                    'sb-127-auth-token-flows-code-verifier',
                    'email-sign-in',
                ].map((name) => ({ name })),
            delete: (options) => deleted.push(options),
        });
        assert.deepEqual(deleted, [
            { name: 'sb-127-auth-token-code-verifier', path: '/' },
            { name: 'sb-127-auth-token-flows-code-verifier', path: '/' },
        ]);
    });
});

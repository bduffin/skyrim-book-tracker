import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isNativeFormPost } from './server-action';

// Header values as a browser sent them to this app's own action, recorded
// from both kinds of request rather than taken from the spec.
describe('isNativeFormPost', () => {
    test('a form submitted as a navigation is a native form POST', () => {
        assert.equal(
            isNativeFormPost(
                new Headers({
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-dest': 'document',
                }),
            ),
            true,
        );
    });

    test('a fetch from Next’s client is not', () => {
        assert.equal(
            isNativeFormPost(
                new Headers({
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-dest': 'empty',
                    'next-action': '60ced7591911b4fc5ccaf45639ce97573426f4bc57',
                }),
            ),
            false,
        );
    });

    test('a request without Fetch Metadata is not, so it gets no redirect', () => {
        assert.equal(isNativeFormPost(new Headers()), false);
    });

    test('the header name is matched case-insensitively, as HTTP requires', () => {
        assert.equal(
            isNativeFormPost(new Headers({ 'Sec-Fetch-Mode': 'navigate' })),
            true,
        );
    });
});

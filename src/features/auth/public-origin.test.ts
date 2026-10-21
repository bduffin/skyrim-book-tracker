import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { publicOrigin } from './public-origin';

describe('publicOrigin', () => {
    test('outside development, is the forwarded host over HTTPS', () => {
        const headers = new Headers({
            host: 'internal.vercel.invalid',
            'x-forwarded-host': 'arcanaeum.app',
        });
        assert.equal(publicOrigin(headers, false), 'https://arcanaeum.app');
    });

    test('in development, is the host, never the forwarded host', () => {
        const headers = new Headers({
            host: 'localhost:3000',
            'x-forwarded-host': 'somewhere.invalid',
        });
        assert.equal(publicOrigin(headers, true), 'http://localhost:3000');
    });

    // A local `next start`: no proxy in front, so no forwarded host.
    test('outside development without a forwarded host, is the host', () => {
        assert.equal(
            publicOrigin(new Headers({ host: 'localhost:3000' }), false),
            'http://localhost:3000',
        );
    });

    test('uses HTTPS for the host only when x-forwarded-proto says so', () => {
        assert.equal(
            publicOrigin(
                new Headers({
                    host: 'localhost:3000',
                    'x-forwarded-proto': 'https',
                }),
                true,
            ),
            'https://localhost:3000',
        );
    });

    test('is null with neither header', () => {
        assert.equal(publicOrigin(new Headers(), false), null);
        assert.equal(publicOrigin(new Headers(), true), null);
    });
});

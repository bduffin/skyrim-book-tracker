import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { contentSecurityPolicy, createNonce } from './csp';

const SUPABASE = 'https://example-ref.supabase.co';

/** The policy as a map of directive name to its sources. */
function directives(policy: string): Map<string, string[]> {
    return new Map(
        policy.split('; ').map((d) => {
            const [name, ...sources] = d.split(' ');
            return [name, sources];
        }),
    );
}

const production = directives(
    contentSecurityPolicy({
        nonce: 'abc123',
        isDev: false,
        supabaseOrigin: SUPABASE,
    }),
);

describe('contentSecurityPolicy', () => {
    test('scripts need the nonce, and strict-dynamic admits what they load', () => {
        assert.deepEqual(production.get('script-src'), [
            "'self'",
            "'nonce-abc123'",
            "'strict-dynamic'",
        ]);
    });

    // A nonce in style-src would make browsers ignore 'unsafe-inline', which
    // the meters' style attributes and next/image both depend on.
    test('styles carry no nonce, so inline styles stay allowed', () => {
        assert.deepEqual(production.get('style-src'), [
            "'self'",
            "'unsafe-inline'",
        ]);
    });

    test('production allows no eval and no websocket', () => {
        assert.ok(!production.get('script-src')!.includes("'unsafe-eval'"));
        assert.deepEqual(production.get('connect-src'), ["'self'"]);
    });

    test('development adds eval and the HMR websocket', () => {
        const dev = directives(
            contentSecurityPolicy({
                nonce: 'abc123',
                isDev: true,
                supabaseOrigin: SUPABASE,
            }),
        );
        assert.ok(dev.get('script-src')!.includes("'unsafe-eval'"));
        assert.deepEqual(dev.get('connect-src'), ["'self'", 'ws:']);
    });

    test('forms may post to the site and redirect through Supabase to GitHub', () => {
        assert.deepEqual(production.get('form-action'), [
            "'self'",
            SUPABASE,
            'https://github.com',
        ]);
    });

    test('without a Supabase project, form-action names only the site and GitHub', () => {
        const policy = directives(
            contentSecurityPolicy({
                nonce: 'abc123',
                isDev: false,
                supabaseOrigin: null,
            }),
        );
        assert.deepEqual(policy.get('form-action'), [
            "'self'",
            'https://github.com',
        ]);
    });

    test('the page cannot be framed, and plugins and base rewrites are off', () => {
        assert.deepEqual(production.get('frame-ancestors'), ["'none'"]);
        assert.deepEqual(production.get('object-src'), ["'none'"]);
        assert.deepEqual(production.get('base-uri'), ["'self'"]);
    });
});

describe('createNonce', () => {
    test('is different every time', () => {
        const nonces = new Set(Array.from({ length: 100 }, createNonce));
        assert.equal(nonces.size, 100);
    });

    // It goes inside a quoted 'nonce-…' source, so it must be base64 and
    // carry nothing that could end the source early.
    test('is base64, with nothing that could break out of the source', () => {
        assert.match(createNonce(), /^[A-Za-z0-9+/]+=*$/);
    });
});

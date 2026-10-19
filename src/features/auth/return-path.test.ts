import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isSafeReturnPath, returnPathFrom } from './return-path';

const ORIGIN = 'http://localhost:3000';

describe('returnPathFrom', () => {
    test('returns the page signed in from, query string included', () => {
        assert.equal(
            returnPathFrom(`${ORIGIN}/books?read=true&page=2`, ORIGIN),
            '/books?read=true&page=2',
        );
    });

    test('keeps a collection path as it is', () => {
        assert.equal(
            returnPathFrom(`${ORIGIN}/collection/abc`, ORIGIN),
            '/collection/abc',
        );
    });

    test('falls back to / with no referer, or one that does not parse', () => {
        assert.equal(returnPathFrom(null, ORIGIN), '/');
        assert.equal(returnPathFrom('not a url', ORIGIN), '/');
    });

    // An open redirect would let a crafted link bounce a freshly signed-in
    // reader to another site.
    test('never returns to another origin', () => {
        assert.equal(returnPathFrom('https://evil.test/books', ORIGIN), '/');
        assert.equal(
            returnPathFrom('http://localhost:3001/books', ORIGIN),
            '/',
        );
        assert.equal(
            returnPathFrom('https://localhost:3000/books', ORIGIN),
            '/',
        );
    });

    test('refuses a protocol-relative path', () => {
        assert.equal(returnPathFrom(`${ORIGIN}//evil.test/x`, ORIGIN), '/');
    });

    test('does not return to the sign-in page', () => {
        assert.equal(returnPathFrom(`${ORIGIN}/login`, ORIGIN), '/');
        assert.equal(
            returnPathFrom(`${ORIGIN}/login?next=/books`, ORIGIN),
            '/',
        );
    });

    test('does not return to the auth pages', () => {
        assert.equal(returnPathFrom(`${ORIGIN}/auth/auth-error`, ORIGIN), '/');
        assert.equal(
            returnPathFrom(`${ORIGIN}/auth/callback?code=x`, ORIGIN),
            '/',
        );
    });
});

describe('isSafeReturnPath', () => {
    test('accepts a path on this site, query string included', () => {
        for (const path of [
            '/',
            '/books',
            '/books?read=true',
            '/collection/abc',
        ]) {
            assert.equal(isSafeReturnPath(path), true, path);
        }
    });

    test('refuses absolute URLs and anything not starting with /', () => {
        for (const path of [
            'https://evil.test',
            'evil.test',
            '',
            'javascript:alert(1)',
        ]) {
            assert.equal(isSafeReturnPath(path), false, path);
        }
    });

    // Both resolve as protocol-relative URLs to another host in a browser.
    test('refuses // and /\\', () => {
        assert.equal(isSafeReturnPath('//evil.test'), false);
        assert.equal(isSafeReturnPath('/\\evil.test'), false);
    });

    test('refuses the auth pages', () => {
        assert.equal(isSafeReturnPath('/auth/auth-error'), false);
        assert.equal(isSafeReturnPath('/auth/callback?code=x'), false);
    });

    test('refuses the sign-in page and anything under it', () => {
        for (const path of [
            '/login',
            '/login?next=/books',
            '/login/',
            '/login/send-code',
        ]) {
            assert.equal(isSafeReturnPath(path), false, path);
        }
    });

    test('accepts a page whose name only starts with login', () => {
        assert.equal(isSafeReturnPath('/loginhelp'), true);
    });

    // A browser resolves these before requesting them, so a prefix check on
    // the raw string would judge a different path from the one visited.
    test('refuses dot segments, plain or encoded', () => {
        for (const path of [
            '/books/../auth/callback',
            '/books/%2e%2e/auth/callback',
            '/books/%2E%2E/login',
            '/books/./x',
            '/books/..',
        ]) {
            assert.equal(isSafeReturnPath(path), false, path);
        }
    });

    test('accepts a query string carrying its own encoded characters', () => {
        assert.equal(isSafeReturnPath('/books?q=Oghma%20Infinium'), true);
        assert.equal(isSafeReturnPath('/books?q=Oghma+Infinium&page=2'), true);
    });
});

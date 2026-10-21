import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    emailStepGate,
    isEmailSignInEnabled,
    loginPath,
    parseCode,
    parseEmail,
    pendingEmailCookieOptions,
} from './email-sign-in';

describe('isEmailSignInEnabled (Email FR-12)', () => {
    test('is on only for exactly the string true', () => {
        assert.equal(
            isEmailSignInEnabled({ EMAIL_SIGN_IN_ENABLED: 'true' }),
            true,
        );
        for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
            assert.equal(
                isEmailSignInEnabled({ EMAIL_SIGN_IN_ENABLED: value }),
                false,
                String(value),
            );
        }
    });
});

describe('parseEmail', () => {
    test('lower-cases, so send and verify use one string', () => {
        assert.equal(
            parseEmail('Jane.Doe@Example.COM'),
            'jane.doe@example.com',
        );
    });

    test('keeps an address, trimmed', () => {
        assert.equal(parseEmail('  jane@example.com '), 'jane@example.com');
        assert.equal(
            parseEmail('a+tag@sub.example.co.uk'),
            'a+tag@sub.example.co.uk',
        );
    });

    test('refuses anything without exactly one @ with text either side', () => {
        for (const value of [
            '',
            'jane',
            '@example.com',
            'jane@',
            'jane@@example.com',
            'jane@example@com',
        ]) {
            assert.equal(parseEmail(value), null, value);
        }
    });

    test('refuses whitespace inside, and an address over 254 characters', () => {
        assert.equal(parseEmail('jane doe@example.com'), null);
        assert.equal(parseEmail(`${'a'.repeat(243)}@example.com`), null);
        assert.equal(
            parseEmail(`${'a'.repeat(242)}@example.com`),
            `${'a'.repeat(242)}@example.com`,
        );
    });

    test('refuses anything that is not a string', () => {
        assert.equal(parseEmail(null), null);
        assert.equal(parseEmail(undefined), null);
    });
});

describe('parseCode (Email FR-2)', () => {
    test('keeps eight digits, leading zeros included', () => {
        assert.equal(parseCode('01234567'), '01234567');
    });

    test('strips spaces, as a code copied from an email may carry', () => {
        assert.equal(parseCode(' 0123 4567 '), '01234567');
    });

    test('refuses any other length, or anything but digits', () => {
        for (const value of [
            '',
            '1234567',
            '123456789',
            '1234567a',
            '١٢٣٤٥٦٧٨',
        ]) {
            assert.equal(parseCode(value), null, value);
        }
        assert.equal(parseCode(null), null);
    });
});

describe('loginPath', () => {
    test('carries next with its own query whole', () => {
        const path = loginPath({ next: '/books?read=true&source=base' });
        assert.equal(
            path,
            '/login?next=%2Fbooks%3Fread%3Dtrue%26source%3Dbase',
        );
        const url = new URL(path, 'http://example.test');
        assert.equal(
            url.searchParams.get('next'),
            '/books?read=true&source=base',
        );
        assert.equal(url.searchParams.get('read'), null);
    });

    test('carries an error code beside next', () => {
        assert.equal(
            loginPath({ next: '/books', error: 'app_code_invalid' }),
            '/login?next=%2Fbooks&error=app_code_invalid',
        );
    });

    test('leaves next off when it is /', () => {
        assert.equal(loginPath({ next: '/' }), '/login');
        assert.equal(
            loginPath({ next: '/', error: 'app_send_failed' }),
            '/login?error=app_send_failed',
        );
    });
});

describe('pendingEmailCookieOptions (Email FR-5)', () => {
    test('is HttpOnly, Lax, scoped to /login, and lasts as long as a code', () => {
        assert.deepEqual(pendingEmailCookieOptions(false), {
            httpOnly: true,
            sameSite: 'lax',
            secure: true,
            path: '/login',
            maxAge: 600,
        });
    });

    test('is not Secure in development, which is plain HTTP', () => {
        assert.equal(pendingEmailCookieOptions(true).secure, false);
    });
});

describe('emailStepGate', () => {
    const ORIGIN = 'https://arcanaeum.app';
    const open = {
        originHeader: ORIGIN,
        origin: ORIGIN,
        enabled: true,
        signedIn: false,
    };

    test('is open for this site, switched on, signed out', () => {
        assert.equal(emailStepGate(open), 'open');
    });

    // Another site learns nothing, not even whether the switch is on.
    test('refuses another origin before anything else', () => {
        for (const originHeader of [null, 'null', 'https://evil.example']) {
            assert.equal(
                emailStepGate({
                    ...open,
                    originHeader,
                    enabled: false,
                    signedIn: true,
                }),
                'forbidden',
            );
        }
    });

    test('is disabled with the switch off, signed in or not', () => {
        assert.equal(emailStepGate({ ...open, enabled: false }), 'disabled');
        assert.equal(
            emailStepGate({ ...open, enabled: false, signedIn: true }),
            'disabled',
        );
    });

    test('sends a signed-in visitor on rather than replacing the session', () => {
        assert.equal(emailStepGate({ ...open, signedIn: true }), 'signed-in');
    });
});

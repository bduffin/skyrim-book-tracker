import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CODE_INVALID_CODE,
    EMAIL_INVALID_CODE,
    loginErrorMessage,
    loginPageMessages,
    NEW_CODE_SENT_MESSAGE,
    SEND_FAILED_CODE,
    SEND_TOO_SOON_CODE,
    sendFailure,
    TOO_MANY_CODE,
    CODE_STEP_EXPIRED_CODE,
    VERIFY_FAILED_CODE,
    verifyFailure,
} from './login-error-message';

describe('loginErrorMessage (Email FR-13)', () => {
    test('has app-written copy for each of the app’s codes', () => {
        for (const code of [
            EMAIL_INVALID_CODE,
            CODE_INVALID_CODE,
            SEND_FAILED_CODE,
            SEND_TOO_SOON_CODE,
            VERIFY_FAILED_CODE,
            TOO_MANY_CODE,
            CODE_STEP_EXPIRED_CODE,
        ]) {
            assert.equal(typeof loginErrorMessage(code), 'string', code);
        }
    });

    // The page is reachable by any link: an unknown code must not become
    // text on the page.
    test('shows nothing for anything else', () => {
        for (const value of [
            undefined,
            '',
            'otp_expired',
            'Your account is locked, email us',
            'constructor',
            '__proto__',
            ['app_send_failed'],
        ]) {
            assert.equal(loginErrorMessage(value), null, String(value));
        }
    });
});

describe('verifyFailure', () => {
    test('a wrong or expired code is the reader’s to fix', () => {
        assert.deepEqual(verifyFailure('otp_expired'), {
            error: CODE_INVALID_CODE,
            expected: true,
        });
    });

    // The whole site's Auth budget, spent: an error, not a typo.
    test('a rate limit says so, and is logged as an error', () => {
        assert.deepEqual(verifyFailure('over_request_rate_limit'), {
            error: TOO_MANY_CODE,
            expected: false,
        });
    });

    test('anything else is not, and is logged as an error', () => {
        for (const code of ['unexpected_failure', undefined]) {
            assert.deepEqual(verifyFailure(code), {
                error: VERIFY_FAILED_CODE,
                expected: false,
            });
        }
    });
});

describe('sendFailure', () => {
    // A double press: the first send went through, so the code step opens.
    test('a send too soon goes on to the code step', () => {
        assert.deepEqual(sendFailure('over_email_send_rate_limit'), {
            error: SEND_TOO_SOON_CODE,
            expected: true,
            pending: 'set',
        });
    });

    test('a rate limit says so, stays put, and is logged as an error', () => {
        assert.deepEqual(sendFailure('over_request_rate_limit'), {
            error: TOO_MANY_CODE,
            expected: false,
            pending: 'keep',
        });
    });

    // Never an address error on a code step, which has no field to fix.
    test('an address Supabase refuses goes back to the email step', () => {
        assert.deepEqual(sendFailure('email_address_invalid'), {
            error: EMAIL_INVALID_CODE,
            expected: true,
            pending: 'clear',
        });
    });

    test('anything else is a failure to send, leaving the step as it was', () => {
        for (const code of ['unexpected_failure', undefined]) {
            assert.deepEqual(sendFailure(code), {
                error: SEND_FAILED_CODE,
                expected: false,
                pending: 'keep',
            });
        }
    });
});

describe('loginPageMessages', () => {
    test('an error goes to the alert, and nothing to the status', () => {
        assert.deepEqual(
            loginPageMessages({
                error: CODE_INVALID_CODE,
                sent: '1',
                codeStep: true,
            }),
            { error: loginErrorMessage(CODE_INVALID_CODE), notice: null },
        );
    });

    test('a new code is announced on the code step only', () => {
        assert.deepEqual(
            loginPageMessages({ error: undefined, sent: '1', codeStep: true }),
            { error: null, notice: NEW_CODE_SENT_MESSAGE },
        );
        assert.deepEqual(
            loginPageMessages({ error: undefined, sent: '1', codeStep: false }),
            { error: null, notice: null },
        );
    });

    test('anything else in the URL shows nothing', () => {
        assert.deepEqual(
            loginPageMessages({
                error: 'Your account is locked',
                sent: 'hello',
                codeStep: true,
            }),
            { error: null, notice: null },
        );
    });
});

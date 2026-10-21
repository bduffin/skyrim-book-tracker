import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CODE_INVALID_CODE,
    EMAIL_INVALID_CODE,
    loginErrorMessage,
    SEND_FAILED_CODE,
    SEND_TOO_SOON_CODE,
    sendFailure,
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
            codeStep: true,
        });
    });

    test('an address Supabase refuses stays on the email step', () => {
        assert.deepEqual(sendFailure('email_address_invalid'), {
            error: EMAIL_INVALID_CODE,
            expected: true,
            codeStep: false,
        });
    });

    test('anything else is a failure to send, logged as an error', () => {
        for (const code of ['unexpected_failure', undefined]) {
            assert.deepEqual(sendFailure(code), {
                error: SEND_FAILED_CODE,
                expected: false,
                codeStep: false,
            });
        }
    });
});

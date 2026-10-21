/**
 * Tests for the sign-in error page's message selection.
 *
 * Expectations are transcribed from the two sources the mapping cites --
 * RFC 6749 section 4.1.2.1 for the standard `error` values, and Supabase's
 * error-code documentation for `error_code` -- not captured from the
 * implementation. They pin the *classification*, not the prose, so editing
 * the copy does not break them; one test checks every kind has some.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTH_ERROR_COPY,
    authErrorKind,
    authErrorPath,
    authErrorMessage,
    authErrorTitle,
    SIGN_OUT_EVERYWHERE_FAILED_CODE,
    SIGN_OUT_FAILED_CODE,
    SIGNED_OUT_CODE,
    type AuthErrorKind,
} from './auth-error-message';

describe('authErrorKind: RFC 6749 error values', () => {
    // "The resource owner or authorization server denied the request."
    test('access_denied is a cancelled sign-in', () => {
        assert.equal(authErrorKind({ error: 'access_denied' }), 'cancelled');
    });

    // "encountered an unexpected condition" / "temporary overloading or
    // maintenance of the server" -- both worth retrying later.
    test('server_error and temporarily_unavailable are transient', () => {
        assert.equal(authErrorKind({ error: 'server_error' }), 'unavailable');
        assert.equal(
            authErrorKind({ error: 'temporarily_unavailable' }),
            'unavailable',
        );
    });

    // The remaining four describe a malformed or unauthorized *request* --
    // the app's side of the integration, which the reader cannot fix.
    test('the request-shape errors are misconfiguration', () => {
        for (const error of [
            'invalid_request',
            'unauthorized_client',
            'unsupported_response_type',
            'invalid_scope',
        ]) {
            assert.equal(authErrorKind({ error }), 'misconfigured', error);
        }
    });
});

describe('authErrorKind: Supabase error codes', () => {
    // "Ask the user to sign in again."
    test('an expired or missing PKCE flow state asks for a fresh sign-in', () => {
        assert.equal(
            authErrorKind({ errorCode: 'flow_state_expired' }),
            'expired',
        );
        assert.equal(
            authErrorKind({ errorCode: 'flow_state_not_found' }),
            'expired',
        );
    });

    // "try again in a few minutes" / "Retry the request" / "Auth service is
    // degraded".
    test('rate limits, timeouts and degraded service are transient', () => {
        for (const errorCode of [
            'over_request_rate_limit',
            'request_timeout',
            'unexpected_failure',
        ]) {
            assert.equal(
                authErrorKind({ errorCode }),
                'unavailable',
                errorCode,
            );
        }
    });

    // "sent out when a verification email is sent after completing the OAuth
    // flow".
    test('an unverified provider email points at the verification email', () => {
        assert.equal(
            authErrorKind({ errorCode: 'provider_email_needs_verification' }),
            'verifyEmail',
        );
    });

    test('disabled sign-ups and banned users get their own messages', () => {
        assert.equal(
            authErrorKind({ errorCode: 'signup_disabled' }),
            'signupDisabled',
        );
        assert.equal(
            authErrorKind({ errorCode: 'user_banned' }),
            'accountBlocked',
        );
    });

    // Each documented as a provider-integration, server-configuration or
    // client-library problem.
    test('integration and configuration faults are misconfiguration', () => {
        for (const errorCode of [
            'bad_oauth_state',
            'bad_oauth_callback',
            'oauth_provider_not_supported',
            'provider_disabled',
            'bad_code_verifier',
            'validation_failed',
        ]) {
            assert.equal(
                authErrorKind({ errorCode }),
                'misconfigured',
                errorCode,
            );
        }
    });
});

describe('authErrorKind: precedence and fallback', () => {
    // A standard server_error can stand for several Supabase conditions, so
    // the more specific code has to win when both are present.
    test('a recognized Supabase code beats the standard error value', () => {
        assert.equal(
            authErrorKind({
                error: 'server_error',
                errorCode: 'flow_state_expired',
            }),
            'expired',
        );
    });

    test('an unrecognized Supabase code falls through to the error value', () => {
        assert.equal(
            authErrorKind({
                error: 'access_denied',
                errorCode: 'something_new',
            }),
            'cancelled',
        );
    });

    test('nothing recognized, or nothing at all, is the generic message', () => {
        assert.equal(authErrorKind({}), 'unknown');
        assert.equal(authErrorKind({ error: 'made_up' }), 'unknown');
        assert.equal(authErrorKind({ errorCode: 'made_up' }), 'unknown');
    });

    // Codes are lowercase identifiers in both sources; guessing at variants
    // would widen what a crafted link can select, for no real input.
    test('matching is exact', () => {
        assert.equal(authErrorKind({ error: 'ACCESS_DENIED' }), 'unknown');
        assert.equal(authErrorKind({ error: ' access_denied' }), 'unknown');
    });

    // A plain object would answer these from Object.prototype and return a
    // function; the lookup has to fall through to the generic message.
    test('prototype property names are not codes', () => {
        for (const name of [
            'constructor',
            '__proto__',
            'toString',
            'hasOwnProperty',
            'valueOf',
        ]) {
            assert.equal(authErrorKind({ error: name }), 'unknown', name);
            assert.equal(authErrorKind({ errorCode: name }), 'unknown', name);
        }
    });
});

describe('authErrorMessage', () => {
    test('every kind has copy', () => {
        const kinds: AuthErrorKind[] = [
            'cancelled',
            'expired',
            'unavailable',
            'verifyEmail',
            'signupDisabled',
            'accountBlocked',
            'misconfigured',
            'unknown',
        ];
        for (const kind of kinds) {
            assert.equal(typeof AUTH_ERROR_COPY[kind], 'string', kind);
            assert.ok(AUTH_ERROR_COPY[kind].trim().length > 0, kind);
        }
    });

    test('returns the copy for the kind it resolves to', () => {
        assert.equal(
            authErrorMessage({ error: 'access_denied' }),
            AUTH_ERROR_COPY.cancelled,
        );
        assert.equal(authErrorMessage({}), AUTH_ERROR_COPY.unknown);
    });

    // The injection this module exists to close: whatever a code-shaped
    // param contains, the result is one of the app's own strings.
    test('always returns one of the app-authored messages', () => {
        const ours = new Set(Object.values(AUTH_ERROR_COPY));
        for (const hostile of [
            'Your account is locked, email support@evil.example',
            '<script>alert(1)</script>',
            'constructor',
            '',
        ]) {
            assert.ok(ours.has(authErrorMessage({ error: hostile })), hostile);
            assert.ok(
                ours.has(authErrorMessage({ errorCode: hostile })),
                hostile,
            );
        }
    });
});

describe('sign-out failures', () => {
    test('the app’s own code maps to the sign-out kind', () => {
        assert.equal(
            authErrorKind({ errorCode: SIGN_OUT_FAILED_CODE }),
            'signOutIncomplete',
        );
    });

    // Written to be true in both failure modes: signed out here but not on
    // the server, or still signed in because nothing was deleted.
    test('the copy covers both ways sign-out can fail', () => {
        const message = authErrorMessage({ errorCode: SIGN_OUT_FAILED_CODE });
        assert.match(message, /close your browser/);
        assert.match(message, /sign out again/);
    });

    test('the title says sign-out, and every other kind still says sign-in', () => {
        assert.equal(
            authErrorTitle({ errorCode: SIGN_OUT_FAILED_CODE }),
            "Sign-out didn't finish",
        );
        assert.equal(
            authErrorTitle({ error: 'access_denied' }),
            'Sign-in failed',
        );
        assert.equal(authErrorTitle({}), 'Sign-in failed');
    });

    test('the app code is namespaced away from Supabase’s', () => {
        assert.ok(SIGN_OUT_FAILED_CODE.startsWith('app_'));
    });
});

describe('sign-out-everywhere failures (Email FR-10)', () => {
    test('the app’s own code maps to a kind of its own', () => {
        assert.equal(
            authErrorKind({ errorCode: SIGN_OUT_EVERYWHERE_FAILED_CODE }),
            'signOutEverywhereIncomplete',
        );
    });

    // What matters after this one fails is the other devices.
    test('the copy says other devices may be signed in, and how to retry', () => {
        const message = authErrorMessage({
            errorCode: SIGN_OUT_EVERYWHERE_FAILED_CODE,
        });
        assert.match(message, /other devices may still be signed in/);
        assert.match(message, /Sign out everywhere again/);
    });

    test('the title says sign-out, not sign-in', () => {
        assert.equal(
            authErrorTitle({ errorCode: SIGN_OUT_EVERYWHERE_FAILED_CODE }),
            "Sign-out didn't finish",
        );
    });

    test('the app code is namespaced away from Supabase’s', () => {
        assert.ok(SIGN_OUT_EVERYWHERE_FAILED_CODE.startsWith('app_'));
    });
});

describe('a write after the session ended', () => {
    test('the app’s own code maps to the signed-out kind', () => {
        assert.equal(
            authErrorKind({ errorCode: SIGNED_OUT_CODE }),
            'signedOut',
        );
    });

    test('the copy says nothing was saved and how to recover', () => {
        const message = authErrorMessage({ errorCode: SIGNED_OUT_CODE });
        assert.match(message, /wasn't saved/);
        assert.match(message, /Sign in/);
    });

    test('the title does not call it a failed sign-in', () => {
        assert.equal(
            authErrorTitle({ errorCode: SIGNED_OUT_CODE }),
            'Not saved',
        );
    });

    test('the app code is namespaced away from Supabase’s', () => {
        assert.ok(SIGNED_OUT_CODE.startsWith('app_'));
    });
});

describe('authErrorPath', () => {
    test('carries the provider’s error and code as the page reads them', () => {
        assert.equal(
            authErrorPath({
                error: 'access_denied',
                errorCode: 'access_denied',
            }),
            '/auth/auth-error?error=access_denied&error_code=access_denied',
        );
    });

    test('carries either one alone', () => {
        assert.equal(
            authErrorPath({ error: 'server_error' }),
            '/auth/auth-error?error=server_error',
        );
        assert.equal(
            authErrorPath({ errorCode: 'flow_state_expired' }),
            '/auth/auth-error?error_code=flow_state_expired',
        );
    });

    test('is the bare page when there is nothing to carry', () => {
        assert.equal(authErrorPath({}), '/auth/auth-error');
        assert.equal(
            authErrorPath({ error: null, errorCode: null }),
            '/auth/auth-error',
        );
        assert.equal(
            authErrorPath({ error: '', errorCode: '  ' }),
            '/auth/auth-error',
        );
    });

    // The values come from a URL anyone can write, so they must stay inside
    // their own parameter rather than add new ones.
    test('encodes a value that tries to add a parameter of its own', () => {
        assert.equal(
            authErrorPath({ error: 'x&error_description=Account locked' }),
            '/auth/auth-error?error=x%26error_description%3DAccount+locked',
        );
    });
});

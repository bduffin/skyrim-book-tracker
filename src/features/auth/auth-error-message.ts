/**
 * The message the sign-in error page shows, chosen from a fixed set of
 * app-written copy by the error *codes* on the redirect -- never from its
 * free text.
 *
 * Why never the free text: the page is reachable by anyone with a link, so
 * rendering a query param lets someone craft
 * `/auth/auth-error?error_description=Your+account+is+locked,+email+...` and
 * have this app say it, on its own domain. React escapes the text, so it is
 * not XSS, but it is content injection. It also misreads the parameter:
 * RFC 6749 section 4.1.2.1 describes `error_description` as text "used to
 * assist the client developer in understanding the error", not as something
 * for the person signing in. The page logs it server-side instead.
 *
 * A crafted link can still choose *which* of the messages below appears, by
 * passing a known code -- which is harmless, since every one of them is ours.
 *
 * Pure and dependency-free so node:test can import it (architecture.md
 * section 11).
 */

/**
 * Grouped by what the reader can do about it, not one message per code:
 * Supabase's own error-code docs sort them the same way -- "ask the user to
 * sign in again", "try again in a few minutes", or a configuration fault
 * that no retry will fix.
 */
export type AuthErrorKind =
    | 'cancelled'
    | 'expired'
    | 'unavailable'
    | 'verifyEmail'
    | 'signupDisabled'
    | 'accountBlocked'
    | 'misconfigured'
    | 'unknown';

export const AUTH_ERROR_COPY: Record<AuthErrorKind, string> = {
    cancelled: "Sign-in was cancelled, so you're not signed in.",
    expired:
        'Your sign-in took too long to finish and expired. Please sign in again.',
    unavailable:
        'The sign-in service is having trouble right now. Please try again in a few minutes.',
    verifyEmail:
        "Your email address needs verifying first. We've sent you an email with a link; follow it, then sign in again.",
    signupDisabled: "New accounts can't be created right now.",
    accountBlocked: "This account can't sign in right now.",
    misconfigured:
        "Sign-in isn't set up correctly on our side, so it couldn't finish. This isn't something you did.",
    unknown: 'Something went wrong while signing you in. Please try again.',
};

/*
 * Supabase Auth's own codes, which it sends as `error_code` on the redirect
 * (the parameter @supabase/auth-js reads alongside `error` and
 * `error_description`). Meanings from
 * https://supabase.com/docs/guides/auth/debugging/error-codes, restricted to
 * the codes an OAuth sign-in or the PKCE code exchange can produce.
 *
 * A Map, not an object literal: an object would answer lookups for
 * `constructor`, `toString` and `__proto__` from its prototype, so
 * `?error=constructor` would return a function instead of falling through.
 */
const BY_SUPABASE_CODE = new Map<string, AuthErrorKind>([
    // "Flow states expire after a while ... Ask the user to sign in again."
    ['flow_state_not_found', 'expired'],
    ['flow_state_expired', 'expired'],
    // "Ask the user to try again in a few minutes." / "Retry the request." /
    // "Auth service is degraded".
    ['over_request_rate_limit', 'unavailable'],
    ['request_timeout', 'unavailable'],
    ['unexpected_failure', 'unavailable'],
    // "sent out when a verification email is sent after completing the OAuth
    // flow" -- so the email really has been sent, and the copy can say so.
    ['provider_email_needs_verification', 'verifyEmail'],
    ['signup_disabled', 'signupDisabled'],
    ['user_banned', 'accountBlocked'],
    // Each of these is described as a provider-integration, server-config or
    // client-library problem: retrying will not help, and it is not the
    // reader's doing, so the copy says both.
    ['bad_oauth_state', 'misconfigured'],
    ['bad_oauth_callback', 'misconfigured'],
    ['oauth_provider_not_supported', 'misconfigured'],
    ['provider_disabled', 'misconfigured'],
    ['bad_code_verifier', 'misconfigured'],
    ['validation_failed', 'misconfigured'],
]);

/*
 * The standard OAuth values of `error`, RFC 6749 section 4.1.2.1 -- the only
 * seven the authorization-code grant allows. Used when there is no
 * recognized Supabase code.
 */
const BY_OAUTH_ERROR = new Map<string, AuthErrorKind>([
    // "The resource owner or authorization server denied the request" --
    // in practice, pressing Cancel on the provider's consent screen.
    ['access_denied', 'cancelled'],
    ['server_error', 'unavailable'],
    ['temporarily_unavailable', 'unavailable'],
    ['invalid_request', 'misconfigured'],
    ['unauthorized_client', 'misconfigured'],
    ['unsupported_response_type', 'misconfigured'],
    ['invalid_scope', 'misconfigured'],
]);

/**
 * Which message applies. Supabase's `error_code` is consulted first because
 * it is the more specific of the two -- a `server_error` from the standard's
 * seven values can stand for several different Supabase codes.
 *
 * Matching is exact. The codes are lowercase identifiers in both sources, and
 * anything unrecognized falls back to the generic message, which is the safe
 * direction to be wrong in.
 */
export function authErrorKind({
    error,
    errorCode,
}: {
    error?: string;
    errorCode?: string;
}): AuthErrorKind {
    return (
        (errorCode !== undefined && BY_SUPABASE_CODE.get(errorCode)) ||
        (error !== undefined && BY_OAUTH_ERROR.get(error)) ||
        'unknown'
    );
}

/**
 * The copy to show. There is deliberately no parameter for a description:
 * the type is what guarantees free text cannot reach the page through here.
 */
export function authErrorMessage(codes: {
    error?: string;
    errorCode?: string;
}): string {
    return AUTH_ERROR_COPY[authErrorKind(codes)];
}

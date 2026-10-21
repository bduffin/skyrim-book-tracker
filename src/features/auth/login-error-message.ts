/**
 * Why an email sign-in step failed, as the sign-in page says it (Email
 * FR-13).
 *
 * The handlers never forward Supabase's text: they map its error to one of
 * the app's own codes, and the page maps that code to fixed, app-written
 * copy. The page is reachable by any link, so anything else in `error` is
 * ignored rather than shown -- the reason `auth-error-message.ts` gives.
 *
 * Pure and dependency-free so node:test can import it (architecture.md
 * section 11).
 */

/** Prefixed `app_`, as in `auth-error-message.ts`, so no Supabase code collides. */
export const EMAIL_INVALID_CODE = 'app_email_invalid';
export const CODE_INVALID_CODE = 'app_code_invalid';
export const SEND_FAILED_CODE = 'app_send_failed';
export const SEND_TOO_SOON_CODE = 'app_send_too_soon';
export const VERIFY_FAILED_CODE = 'app_verify_failed';

/** A Map, not an object, so `constructor` and friends are never found. */
const MESSAGES = new Map<string, string>([
    [EMAIL_INVALID_CODE, 'That doesn’t look like an email address.'],
    [
        CODE_INVALID_CODE,
        'That code didn’t work. Check it, or send a new one — codes last 10 minutes.',
    ],
    [SEND_FAILED_CODE, 'We couldn’t send a code. Please try again.'],
    [
        SEND_TOO_SOON_CODE,
        'We couldn’t send a new code just now. If one arrived in the last minute, enter it below; if not, wait a minute and try again.',
    ],
    [
        VERIFY_FAILED_CODE,
        'Something went wrong checking your code. Please try again.',
    ],
]);

/** The message for an `error` query parameter, or `null` to show nothing. */
export function loginErrorMessage(code: unknown): string | null {
    return typeof code === 'string' ? (MESSAGES.get(code) ?? null) : null;
}

/**
 * What a failed step does next: the code to show, and whether the failure is
 * the reader's own -- a wrong code, an address Supabase refuses, a resend too
 * soon -- logged as a warning rather than an error, so a typo never looks
 * like an outage in the logs.
 */
export type StepFailure = { error: string; expected: boolean };

/**
 * For a failed `verifyOtp`. Supabase reports a wrong code and an expired one
 * alike, as `otp_expired`; anything else is not the reader's doing. The
 * pending-address cookie stays either way, so the code step does too.
 */
export function verifyFailure(supabaseCode: string | undefined): StepFailure {
    return supabaseCode === 'otp_expired'
        ? { error: CODE_INVALID_CODE, expected: true }
        : { error: VERIFY_FAILED_CODE, expected: false };
}

/**
 * For a failed `signInWithOtp`, plus whether to go on to the code step.
 *
 * A send refused as too soon goes on to the code step: the usual cause is a
 * second press of Send code, whose first press did send a code -- and whose
 * response, with the cookie that would have opened the code step, the
 * browser abandoned for the second. Supabase reports the project's email cap
 * the same way, so the message is worded to be true of both.
 */
export function sendFailure(
    supabaseCode: string | undefined,
): StepFailure & { codeStep: boolean } {
    switch (supabaseCode) {
        case 'over_email_send_rate_limit':
            return {
                error: SEND_TOO_SOON_CODE,
                expected: true,
                codeStep: true,
            };
        case 'email_address_invalid':
            return {
                error: EMAIL_INVALID_CODE,
                expected: true,
                codeStep: false,
            };
        default:
            return {
                error: SEND_FAILED_CODE,
                expected: false,
                codeStep: false,
            };
    }
}

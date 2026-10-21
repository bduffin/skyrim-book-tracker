/**
 * Why an email sign-in step failed, as the sign-in page says it (Email
 * FR-13).
 *
 * The handlers never forward Supabase's text: they map its error to one of
 * the app's own codes, and the page maps that code to fixed, app-written
 * copy. The page is reachable by any link, so anything else in `error` is
 * ignored rather than shown -- the reason `auth-error-message.ts` gives.
 *
 * Pure, so node:test can import it (architecture.md section 11).
 */

import { isSentParam } from './email-sign-in';

/** Prefixed `app_`, as in `auth-error-message.ts`, so no Supabase code collides. */
export const EMAIL_INVALID_CODE = 'app_email_invalid';
export const CODE_INVALID_CODE = 'app_code_invalid';
export const SEND_FAILED_CODE = 'app_send_failed';
export const SEND_TOO_SOON_CODE = 'app_send_too_soon';
export const VERIFY_FAILED_CODE = 'app_verify_failed';
export const TOO_MANY_CODE = 'app_too_many';
export const CODE_STEP_EXPIRED_CODE = 'app_code_step_expired';

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
    [
        TOO_MANY_CODE,
        'Too many attempts from here. Wait a few minutes, then try again.',
    ],
    [
        CODE_STEP_EXPIRED_CODE,
        'Your sign-in timed out. Enter your email address again.',
    ],
]);

/**
 * What the code step says after **Send a new code** succeeds, carried as
 * `sent=1` rather than as a code: it is not an error. A new code replaces the
 * one before it, so the message says which to use.
 */
export const NEW_CODE_SENT_MESSAGE =
    'We sent a new code. Please use the newest code: earlier ones no longer work.';

/**
 * Supabase's per-IP limit on Auth requests. Every Auth call runs on the
 * server, so this is the whole site's budget, not one visitor's (Email
 * spec, Current State): logged as an error, since it means someone has
 * spent it.
 */
const TOO_MANY: StepFailure = { error: TOO_MANY_CODE, expected: false };

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
    switch (supabaseCode) {
        case 'otp_expired':
            return { error: CODE_INVALID_CODE, expected: true };
        case 'over_request_rate_limit':
            return TOO_MANY;
        default:
            return { error: VERIFY_FAILED_CODE, expected: false };
    }
}

/**
 * What a send does to the pending-address cookie, and so to the code step:
 * `set` opens it (or restarts its 10 minutes), `keep` leaves whatever step
 * the reader was on, `clear` sends them back to the email step.
 */
export type PendingCookie = 'set' | 'keep' | 'clear';

/**
 * For a failed `signInWithOtp`, plus what happens to the code step.
 *
 * - Too soon `set`s it: the usual cause is a second press of Send code, whose
 *   first press did send a code -- and whose response, with the cookie that
 *   would have opened the code step, the browser abandoned for the second.
 *   Supabase reports the project's email cap the same way, so the message is
 *   worded to be true of both.
 * - A refused address `clear`s it, so the error is shown beside the email
 *   field it is about, never on a code step with no field to correct.
 * - Anything else `keep`s the reader where they were: on the email step after
 *   a first send, on the code step after **Send a new code**.
 */
export function sendFailure(
    supabaseCode: string | undefined,
): StepFailure & { pending: PendingCookie } {
    switch (supabaseCode) {
        case 'over_email_send_rate_limit':
            return {
                error: SEND_TOO_SOON_CODE,
                expected: true,
                pending: 'set',
            };
        case 'email_address_invalid':
            return {
                error: EMAIL_INVALID_CODE,
                expected: true,
                pending: 'clear',
            };
        case 'over_request_rate_limit':
            return { ...TOO_MANY, pending: 'keep' };
        default:
            return {
                error: SEND_FAILED_CODE,
                expected: false,
                pending: 'keep',
            };
    }
}

/**
 * What the sign-in page shows above its forms: an error, from the fixed
 * copy above, or, failing that, the notice that a new code went out -- only
 * on the code step, which is the only place one can have been sent from.
 *
 * Kept apart because they are announced differently: an error as an alert,
 * the notice politely, as a status.
 */
export function loginPageMessages({
    error,
    sent,
    codeStep,
}: {
    error: unknown;
    sent: unknown;
    codeStep: boolean;
}): { error: string | null; notice: string | null } {
    const message = loginErrorMessage(error);
    return {
        error: message,
        notice:
            message === null && codeStep && isSentParam(sent)
                ? NEW_CODE_SENT_MESSAGE
                : null,
    };
}

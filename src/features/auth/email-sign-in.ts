/**
 * The rules email sign-in's page and its two Route Handlers share (Email
 * FR-1 to FR-5, FR-12): what a valid address and code look like, where a
 * failure is sent, the pending-address cookie, and the switch.
 *
 * Pure, so node:test can import it (architecture.md section 11).
 */

import { isSameOrigin } from './public-origin';

/** The sign-in page, which every email step redirects back to. */
export const LOGIN_PATH = '/login';

/** Digits in a sign-in code: `otp_length` in Supabase Auth (Email Decision 4). */
export const CODE_LENGTH = 8;

/** How long a code works, in seconds: `otp_expiry` in Supabase Auth. */
export const CODE_LIFETIME_SECONDS = 600;

/**
 * The cookie holding the address a code was sent to, so the address never
 * travels in a URL and a refresh of the code step neither resends the code
 * nor loses the address (Email Decision 13).
 */
export const PENDING_EMAIL_COOKIE = 'email-sign-in';

/**
 * The pending-address cookie's attributes (Email FR-5). It lasts as long as
 * the code, is unreadable from page scripts, and is sent only to `/login`
 * and the two handlers under it.
 */
export function pendingEmailCookieOptions(
    isDevelopment: boolean = process.env.NODE_ENV === 'development',
) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: !isDevelopment,
        path: LOGIN_PATH,
        maxAge: CODE_LIFETIME_SECONDS,
    } as const;
}

/**
 * Whether email sign-in is offered (Email FR-12). Off until the hosted
 * project's Email provider is on, so production can run this code before
 * then without showing a form that cannot work.
 */
export function isEmailSignInEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.EMAIL_SIGN_IN_ENABLED === 'true';
}

/** The longest address SMTP allows (RFC 5321's 256-octet path, less `<>`). */
const MAX_EMAIL_LENGTH = 254;

/**
 * A posted address, trimmed and lower-cased, if it is plausibly one: at most
 * 254 characters, exactly one `@` with something either side, and no
 * whitespace inside. Deliberately loose -- Supabase checks it properly, and
 * whether it works is settled by the code arriving.
 *
 * Lower-cased so the address a code is sent to and the one it is checked
 * against are the same string whatever a phone's keyboard capitalized, with
 * no reliance on Supabase normalizing both calls alike.
 */
export function parseEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (email.length > MAX_EMAIL_LENGTH || /\s/.test(email)) return null;
    const [local, domain, ...rest] = email.split('@');
    return rest.length === 0 && local && domain ? email : null;
}

/**
 * A posted code with any spaces removed, if it is exactly `CODE_LENGTH`
 * digits. Kept as a string throughout: a code can start with a zero.
 */
export function parseCode(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const code = value.replace(/\s/g, '');
    return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) ? code : null;
}

/**
 * `/login`, carrying `next` and an error code. Built with `URLSearchParams`,
 * so a `next` with a query of its own arrives whole rather than as extra
 * parameters. `next` is left off when it is `/`, where the page falls back
 * anyway.
 */
export function loginPath({
    next,
    error,
}: {
    next: string;
    error?: string;
}): string {
    const params = new URLSearchParams();
    if (next !== '/') params.set('next', next);
    if (error !== undefined) params.set('error', error);
    const query = params.toString();
    return query === '' ? LOGIN_PATH : `${LOGIN_PATH}?${query}`;
}

/**
 * Whether a POST to an email step may go ahead (Email FR-4, FR-5), in the
 * order the checks must run:
 *
 * - `forbidden`: `Origin` is not this site's. First, so another site learns
 *   nothing, not even whether the switch is on.
 * - `disabled`: the switch is off, so the step does not exist (404).
 * - `signed-in`: there is a session already. Sent on to `next` rather than
 *   letting a stale code step replace one account's session with another's.
 * - `open`: go ahead.
 */
export type EmailStepGate = 'forbidden' | 'disabled' | 'signed-in' | 'open';

export function emailStepGate({
    originHeader,
    origin,
    enabled,
    signedIn,
}: {
    originHeader: string | null;
    origin: string;
    enabled: boolean;
    signedIn: boolean;
}): EmailStepGate {
    if (!isSameOrigin(originHeader, origin)) return 'forbidden';
    if (!enabled) return 'disabled';
    return signedIn ? 'signed-in' : 'open';
}

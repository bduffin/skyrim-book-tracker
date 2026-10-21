/**
 * The pure half of `/settings` (Profiles FR-5): what the form submits, how
 * that is validated, what `saveProfile` answers, and the page's own URLs.
 *
 * Split from `actions.ts` so it can be unit-tested -- a `'use server'` module
 * can only export async functions -- and so the form can import the field
 * names without importing the action's server-side dependencies.
 *
 * No username yet: the field arrives with Profiles M2, and until then the
 * action writes only `is_public`, so saving can never clear a username.
 */

import { safeReturnPath } from '@/features/auth/return-path';
import { singleField, type FormFields } from '@/lib/form-fields';

export const SETTINGS_PATH = '/settings';

/** Where a save with no `next` lands, to show its confirmation. */
export const SAVED_PATH = `${SETTINGS_PATH}?saved=1`;

/** The form field names. One source, so the form and parser cannot drift. */
export const PROFILE_FIELDS = {
    isPublic: 'is_public',
    next: 'next',
} as const;

/**
 * A validated submission. Never carries a user id: that comes from the
 * session, whatever the form says (Profiles FR-2).
 */
export type ProfileInput = {
    isPublic: boolean;
    /** A safe return path, or `null` to stay on `/settings`. */
    next: string | null;
};

/**
 * What the action answers, shaped for `useActionState`. There is no success
 * state: a successful save always redirects. A failure carries the submitted
 * choice, when it got far enough to have one, so the form re-renders with it
 * rather than with the stored value (Profiles FR-5).
 */
export type SaveProfileResult =
    | { status: 'idle' }
    | {
          status: 'error';
          error: 'invalid_input' | 'unauthenticated' | 'write_failed';
          isPublic: boolean | null;
      };

export const IDLE: SaveProfileResult = { status: 'idle' };

/**
 * Reads the form into a `ProfileInput`, or `null` if the visibility choice is
 * missing, repeated or not exactly `'true'` or `'false'`. A tampered write has
 * no safe default, so it is rejected rather than guessed at.
 *
 * `next` is different: a missing or unsafe one costs only the redirect, so it
 * falls back to staying on `/settings` rather than failing the save. It is
 * checked again here, not trusted from the page that rendered it, because the
 * form's fields are whatever the browser sends.
 */
export function parseProfileInput(form: FormFields): ProfileInput | null {
    const isPublic = singleField(form, PROFILE_FIELDS.isPublic);
    if (isPublic !== 'true' && isPublic !== 'false') return null;

    const next = singleField(form, PROFILE_FIELDS.next);
    return {
        isPublic: isPublic === 'true',
        next: safeReturnPath(next),
    };
}

/** Where a successful save goes: back to `next`, or to the confirmation. */
export function saveDestination(input: ProfileInput): string {
    return input.next ?? SAVED_PATH;
}

/**
 * `/settings`, carrying where to go after the first save. Only the first-login
 * redirect adds `next` (Profiles FR-4), so the destination follows from how
 * the user arrived.
 */
export function settingsPath(next?: string): string {
    return next === undefined
        ? SETTINGS_PATH
        : `${SETTINGS_PATH}?${PROFILE_FIELDS.next}=${encodeURIComponent(next)}`;
}

/**
 * Where a sign-in lands, given what the profile check found (Profiles FR-4):
 * setup when there is no row, carrying `next`; otherwise `next` itself.
 *
 * A failed check goes to `next` too. The user's setting is unchanged either
 * way -- no row stays owner-only (Profiles FR-3) -- and a database hiccup must
 * not route every sign-in through setup.
 *
 * `next` must already have passed `isSafeReturnPath`.
 */
export function pathAfterProfileCheck(
    status: 'found' | 'none' | 'error',
    next: string,
): string {
    return status === 'none' ? settingsPath(next) : next;
}

type Param = string | string[] | undefined;

/**
 * Whether to show the save confirmation. Only exactly `1`: the param carries
 * no text of its own, so a link cannot make the page say anything.
 */
export function isSavedParam(value: Param): boolean {
    return value === '1';
}

/** Why a save did not happen, as the form shows it (Profiles FR-5). */
export type ProfileFailure =
    Extract<SaveProfileResult, { status: 'error' }>['error'] | 'unreachable';

export function profileFailureMessage(failure: ProfileFailure): string {
    switch (failure) {
        case 'unauthenticated':
            return 'You’re signed out, so your settings weren’t saved. Sign in and try again.';
        case 'unreachable':
            return 'Couldn’t reach the server, so your settings weren’t saved. Check your connection and try again.';
        case 'write_failed':
            return 'Couldn’t save your settings. Try again.';
        case 'invalid_input':
            return 'Couldn’t save your settings. Reload the page and try again.';
    }
}

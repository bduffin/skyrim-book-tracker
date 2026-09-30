/**
 * The pure half of the read/collected write path (FR-4): what a toggle's form
 * submits, how that is validated, and what the Server Action answers.
 *
 * Split from `actions.ts` so it can be unit-tested -- a `'use server'` module
 * can only export async functions, and the action itself needs a request
 * context to run -- and so the toggle form can import the field names without
 * importing the action's server-side dependencies.
 *
 * Validated by hand rather than with a schema library, for the same reason as
 * `src/features/books/scope.ts` (R4): every field is either a UUID or a
 * member of a two- or three-item allowlist.
 */

import { returnPathFrom } from '@/features/auth/return-path';

/** The form field names a toggle submits. One source, so they cannot drift. */
export const FLAG_FIELDS = {
    bookId: 'bookId',
    flag: 'flag',
    value: 'value',
} as const;

/** Which flag a toggle owns. Each toggle writes only its own (FR-4). */
export type FlagName = 'read' | 'collected';

/**
 * A validated request to change one flag on one book. Never carries a user id:
 * that comes from the session, whatever the form says (R5).
 */
export type SetFlagInput = {
    bookId: string;
    flag: FlagName;
    value: boolean;
};

/**
 * What the action answers, shaped for `useActionState`: `idle` is the state a
 * toggle holds before its first submission.
 *
 * `error` carries the book it was about, when the input got far enough to name
 * one, so the rollback toast can say which book failed.
 */
export type SetFlagResult =
    | { status: 'idle' }
    | {
          status: 'ok';
          bookId: string;
          isRead: boolean;
          isCollected: boolean;
      }
    | {
          status: 'error';
          bookId: string | null;
          error: 'invalid_input' | 'unauthenticated' | 'write_failed';
      };

export const IDLE: SetFlagResult = { status: 'idle' };

/**
 * The subset of `FormData` this reads. `getAll` rather than `get` so that a
 * repeated field is visible and can be rejected: `get` silently returns the
 * first, and there is no non-arbitrary way to choose between two book ids.
 */
export type FormFields = {
    getAll(name: string): unknown[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A field's single string value, or `null` if absent, repeated or a file. */
function single(form: FormFields, name: string): string | null {
    const values = form.getAll(name);
    if (values.length !== 1) return null;
    const [value] = values;
    return typeof value === 'string' ? value : null;
}

/**
 * Reads a toggle's submission into a `SetFlagInput`, or `null` if any field is
 * missing, repeated or not one of its allowed values.
 *
 * Strict on purpose, unlike the URL parsers in `scope.ts`, which fall back to
 * defaults on bad input. A tampered filter param can safely degrade to the
 * default view; a tampered *write* has no safe default, so it is rejected.
 */
export function parseSetFlagInput(form: FormFields): SetFlagInput | null {
    const bookId = single(form, FLAG_FIELDS.bookId);
    const flag = single(form, FLAG_FIELDS.flag);
    const value = single(form, FLAG_FIELDS.value);

    if (bookId === null || !UUID.test(bookId)) return null;
    if (flag !== 'read' && flag !== 'collected') return null;
    if (value !== 'true' && value !== 'false') return null;

    return { bookId, flag, value: value === 'true' };
}

/**
 * The `set_book_flags` arguments for one flag change. The other flag is left
 * out entirely, which the function reads as "leave it as it is" -- so toggling
 * one can never touch the other (FR-4).
 */
export function rpcArgsFor(input: SetFlagInput): {
    p_book_id: string;
    p_is_read?: boolean;
    p_is_collected?: boolean;
} {
    return input.flag === 'read'
        ? { p_book_id: input.bookId, p_is_read: input.value }
        : { p_book_id: input.bookId, p_is_collected: input.value };
}

/**
 * The id on a toggle's form, which a no-JavaScript write redirects back to.
 * One per toggle, so the page lands on the control that was pressed.
 */
export function flagAnchor(flag: FlagName, bookId: string): string {
    return `${flag}-${bookId}`;
}

/**
 * Where a successful no-JavaScript write redirects: the page the toggle was
 * on, taken from the form's `Referer` by the same rule sign-in uses, plus the
 * toggle's own fragment.
 *
 * Redirecting turns the native form POST into a GET, so refreshing or going
 * back afterwards does not ask to resubmit the form, and the fragment brings
 * the page back scrolled to the toggle rather than to the top. A browser
 * never sends a fragment in `Referer`, which is why it is rebuilt here.
 */
export function writeReturnTarget(
    referer: string | null,
    origin: string,
    input: SetFlagInput,
): string {
    const path = returnPathFrom(referer, origin);
    return `${path}#${flagAnchor(input.flag, input.bookId)}`;
}

/**
 * Why a toggle's change did not stick: one of the action's own errors, or
 * `unreachable` when the action never answered at all -- a dropped connection
 * throws rather than returning a result.
 */
export type FlagFailure =
    Extract<SetFlagResult, { status: 'error' }>['error'] | 'unreachable';

/**
 * The rollback toast's message (FR-4, MI6). Names the book, since the toggle
 * has already flipped back by the time it is read and the reader may have
 * clicked several.
 *
 * `invalid_input` shares the generic wording: it means the form was tampered
 * with or is out of date, and neither is anything the reader can act on.
 */
export function flagFailureMessage(
    failure: FlagFailure,
    title: string,
): string {
    switch (failure) {
        case 'unauthenticated':
            return `You’re signed out. Changes to “${title}” not saved. Sign in to track books.`;
        case 'unreachable':
            return `Couldn’t reach the server. Changes to “${title}” cannot be saved. Check your connection and try again.`;
        case 'write_failed':
        case 'invalid_input':
            return `Couldn’t save changes to “${title}”.`;
    }
}

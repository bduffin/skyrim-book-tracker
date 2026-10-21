'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { ActionErrorBoundary } from '@/components/action-error-boundary';

import { saveProfile } from '../actions';
import {
    IDLE,
    PROFILE_FIELDS,
    profileFailureMessage,
    type ProfileFailure,
} from '../profile-input';

/**
 * The `/settings` form (Profiles FR-5): one form for first-time setup and
 * later changes, posting to `saveProfile`.
 *
 * Inside an error boundary of its own, so an action that throws rather than
 * answering -- a dropped connection -- shows a message beside the form
 * instead of replacing the page.
 */
export function ProfileForm(props: {
    /** The stored choice, or the default (public) when there is no row. */
    isPublic: boolean;
    /** Where sign-in was headed, when sign-in sent the user here. */
    next: string | null;
    /** Whether the last save redirected here (`?saved=1`). */
    saved: boolean;
}) {
    // Held above the boundary, which remounts the form below it. Cleared as
    // soon as the next submission starts: a later save that succeeds and
    // redirects back here keeps this component's state, and would otherwise
    // still say the settings were not saved.
    const [unreachable, setUnreachable] = useState(false);
    return (
        <ActionErrorBoundary
            onError={(error) => {
                console.error('Saving settings failed to complete:', error);
                setUnreachable(true);
            }}
        >
            <Form
                {...props}
                unreachable={unreachable}
                onSubmitStart={() => setUnreachable(false)}
            />
        </ActionErrorBoundary>
    );
}

/**
 * A real `<form>` posting to the Server Action, so it works with JavaScript
 * disabled (Profiles NFR-3), enhanced by `useActionState` when it runs.
 *
 * A failure re-renders the form with the choice that was submitted rather
 * than the stored one, so a retry does not silently revert it. Without
 * JavaScript that is the server render of the POST's own response, with the
 * result already in the action state.
 *
 * With JavaScript, React calls the form's native `reset()` once every action
 * completes, failures included, which puts each radio back to its
 * `defaultChecked`. So the submitted choice is shown by updating
 * `defaultChecked`, which React does in place before that reset runs. Neither
 * controlled radios (the reset reverts them to the server-rendered default,
 * and their unchanged state never puts them back) nor a remount (which drops
 * keyboard focus from a radio that submitted the form with Enter) would do.
 */
function Form({
    isPublic,
    next,
    saved,
    unreachable,
    onSubmitStart,
}: {
    isPublic: boolean;
    next: string | null;
    saved: boolean;
    unreachable: boolean;
    onSubmitStart: () => void;
}) {
    const [result, submit] = useActionState(saveProfile, IDLE);
    const errorId = useId();

    const failure: ProfileFailure | null =
        result.status === 'error'
            ? result.error
            : unreachable
              ? 'unreachable'
              : null;
    const chosen =
        result.status === 'error' && result.isPublic !== null
            ? result.isPublic
            : isPublic;

    return (
        <form action={submit} onSubmit={onSubmitStart} className="space-y-5">
            {/*
             * Always in the document, so it is an established live region
             * before the confirmation is put in it (Profiles NFR-4). Fixed,
             * app-written text that `saved` only switches on -- and off again
             * once a later submission fails, so the page never says both
             * "saved" and "not saved" at once.
             */}
            <p
                role="status"
                className="rounded-md border border-pine-400 bg-pine-50 px-3 py-2 text-pine-800 empty:hidden"
            >
                {saved && failure === null && 'Your settings are saved.'}
            </p>

            {next !== null && (
                <input type="hidden" name={PROFILE_FIELDS.next} value={next} />
            )}
            <fieldset
                className="space-y-2"
                aria-describedby={failure ? errorId : undefined}
            >
                <legend className="pb-2 font-serif text-lg">
                    Who can see your collection
                </legend>
                <div className="space-y-2">
                    <Option
                        value="true"
                        defaultChecked={chosen}
                        label="Public"
                        // Profiles FR-3: nothing here may say public viewing
                        // is live before Browse M6 makes it so.
                        hint="Anyone with a link to your collection will be able to see the books you’ve marked, once public collections are available. Until then, only you can."
                    />
                    <Option
                        value="false"
                        defaultChecked={!chosen}
                        label="Private"
                        hint="Only you can see your collection."
                    />
                </div>
            </fieldset>

            {/*
             * Always in the document, so it is an established live region
             * before an error is put in it -- a region added along with its
             * content is not reliably announced (Profiles NFR-4).
             */}
            <p
                id={errorId}
                role="alert"
                className="text-sm text-iron-900 empty:hidden"
            >
                {failure && profileFailureMessage(failure)}
            </p>

            <SaveButton continues={next !== null} />
        </form>
    );
}

function Option({
    value,
    defaultChecked,
    label,
    hint,
}: {
    value: 'true' | 'false';
    defaultChecked: boolean;
    label: string;
    hint: string;
}) {
    const hintId = useId();
    return (
        <label className="flex cursor-pointer gap-3 rounded-md border border-frost-300 bg-white p-3 transition-colors hover:bg-frost-100 has-checked:border-iron-900">
            <input
                type="radio"
                name={PROFILE_FIELDS.isPublic}
                value={value}
                defaultChecked={defaultChecked}
                aria-describedby={hintId}
                // A native radio, not a styled stand-in: it keeps its own
                // focus ring and forced-colors rendering for free.
                className="mt-1 size-4 shrink-0 accent-iron-900"
            />
            <span>
                <span className="block font-medium text-iron-900">{label}</span>
                <span id={hintId} className="block text-sm text-iron-600">
                    {hint}
                </span>
            </span>
        </label>
    );
}

/**
 * Split out because `useFormStatus` reads the *enclosing* form's submission
 * and so has to be called from inside it.
 */
function SaveButton({ continues }: { continues: boolean }) {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            // `aria-disabled`, never `disabled`, while in flight: a disabled
            // button drops focus to the page body.
            aria-disabled={pending || undefined}
            onClick={(event) => {
                if (pending) event.preventDefault();
            }}
            className="rounded bg-iron-900 px-4 py-2 text-frost-50 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800 aria-disabled:cursor-progress"
        >
            {pending ? 'Saving…' : continues ? 'Save and continue' : 'Save'}
        </button>
    );
}

'use client';

import {
    Component,
    createRef,
    Fragment,
    useActionState,
    useEffect,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';

import { useToast } from '@/components/toast';

import { setBookFlags } from '../actions';
import {
    FLAG_FIELDS,
    flagFailureMessage,
    IDLE,
    type FlagName,
} from '../flag-input';

/**
 * A book's read and collected toggles (FR-4), for a signed-in viewer.
 *
 * Two independent toggles rather than one control, because the flags are
 * independent (Decision #2): each is its own form, submits only its own flag,
 * and has its own pending state, so one in flight never blocks the other.
 */
export function FlagToggles({
    bookId,
    title,
    isRead,
    isCollected,
}: {
    bookId: string;
    title: string;
    isRead: boolean;
    isCollected: boolean;
}) {
    return (
        <div className="flex shrink-0 items-center gap-1.5">
            <GuardedToggle
                bookId={bookId}
                title={title}
                flag="read"
                pressed={isRead}
            />
            <GuardedToggle
                bookId={bookId}
                title={title}
                flag="collected"
                pressed={isCollected}
            />
        </div>
    );
}

type ToggleProps = {
    bookId: string;
    title: string;
    flag: FlagName;
    /** Server truth, from the last render of the list. */
    pressed: boolean;
};

/** Gives the error boundary below a way to raise a toast, which needs a hook. */
function GuardedToggle(props: ToggleProps) {
    const toast = useToast();
    return (
        <UnreachableBoundary
            onError={() =>
                toast(flagFailureMessage('unreachable', props.title))
            }
        >
            <FlagToggle {...props} />
        </UnreachableBoundary>
    );
}

/**
 * Catches an action that threw instead of answering -- a dropped connection,
 * a server that did not respond -- which `useActionState` rethrows to the
 * nearest error boundary. Without this one, that is the route's `error.tsx`,
 * and a single failed click would replace the whole page.
 *
 * It cannot be avoided by wrapping the action in a client function that
 * catches: only a Server Action passed to `<form action>` directly still
 * submits with JavaScript disabled, which is why the toggle does not.
 *
 * On a catch it raises the toast and remounts the toggle, which resets its
 * action state and shows the server's value again -- the rollback FR-4 asks
 * for, reached by a different road than a returned error.
 *
 * Remounting replaces the button, and a focused element that leaves the page
 * drops focus to the start of the document -- so a keyboard user who pressed
 * the toggle would be sent back to the top of a fifty-row list. The boundary
 * notes whether focus was inside it just before the old button goes, and
 * puts it on the new one afterwards. Only then: restoring it unconditionally
 * would pull focus back from wherever the reader had moved on to.
 */
class UnreachableBoundary extends Component<
    { onError: () => void; children: ReactNode },
    { failed: boolean; attempt: number }
> {
    state = { failed: false, attempt: 0 };

    private readonly wrapper = createRef<HTMLDivElement>();
    private restoreFocus = false;

    static getDerivedStateFromError() {
        return { failed: true };
    }

    /**
     * Runs just before React commits the failed render that removes the
     * button -- the last moment the old button is still in the document.
     * `componentDidCatch` is too late: it runs after that commit, by which
     * time focus has already fallen to the body.
     */
    getSnapshotBeforeUpdate(
        _props: unknown,
        previous: { failed: boolean },
    ): boolean {
        if (previous.failed || !this.state.failed) return false;
        return this.wrapper.current?.contains(document.activeElement) ?? false;
    }

    componentDidUpdate(_props: unknown, _state: unknown, hadFocus: boolean) {
        if (hadFocus) this.restoreFocus = true;
        if (this.restoreFocus && !this.state.failed) {
            this.restoreFocus = false;
            this.wrapper.current?.querySelector('button')?.focus();
        }
    }

    componentDidCatch(error: unknown) {
        console.error('Book flag action failed to complete:', error);
        this.props.onError();
        this.setState(({ attempt }) => ({
            failed: false,
            attempt: attempt + 1,
        }));
    }

    render() {
        // The wrapper outlives the remount, so it is still there to look for
        // focus in and to find the new button through.
        return (
            <div ref={this.wrapper}>
                {this.state.failed ? null : (
                    <Fragment key={this.state.attempt}>
                        {this.props.children}
                    </Fragment>
                )}
            </div>
        );
    }
}

const LABELS: Record<FlagName, string> = {
    read: 'Read',
    collected: 'Collected',
};

/**
 * One toggle: a real `<form>` posting to the Server Action, so it works with
 * JavaScript disabled (architecture.md section 9), enhanced by
 * `useActionState` when it runs.
 *
 * The value it submits is the opposite of the *server's* value, not of what
 * is on screen. Two clicks while the first is in flight therefore send the
 * same value twice and land on it, rather than racing each other back and
 * forth.
 */
function FlagToggle({ bookId, title, flag, pressed }: ToggleProps) {
    const [result, submit] = useActionState(setBookFlags, IDLE);
    const toast = useToast();

    // A returned failure: the toggle has already rolled back by now -- it
    // shows server truth again once the submission settles -- so this only
    // has to say so. Keyed on the result object, which is new on every
    // submission, so two identical failures raise two toasts.
    useEffect(() => {
        if (result.status === 'error') {
            toast(flagFailureMessage(result.error, title));
        }
    }, [result, title, toast]);

    return (
        <form action={submit}>
            <input type="hidden" name={FLAG_FIELDS.bookId} value={bookId} />
            <input type="hidden" name={FLAG_FIELDS.flag} value={flag} />
            <input
                type="hidden"
                name={FLAG_FIELDS.value}
                value={String(!pressed)}
            />
            <ToggleButton flag={flag} title={title} pressed={pressed} />
        </form>
    );
}

/**
 * The button, split out because `useFormStatus` reads the *enclosing* form's
 * submission and so has to be called from inside it.
 *
 * Optimistic by way of `useFormStatus` rather than `useOptimistic`: while the
 * form is pending it shows the value being submitted, and once the submission
 * settles it shows `pressed` again -- the new server value on success, the
 * unchanged one on failure. So the rollback needs no code of its own, and the
 * form can keep the bare Server Action that the no-JavaScript path depends on.
 */
function ToggleButton({
    flag,
    title,
    pressed,
}: {
    flag: FlagName;
    title: string;
    pressed: boolean;
}) {
    const { pending, data } = useFormStatus();
    const shown = pending ? data?.get(FLAG_FIELDS.value) === 'true' : pressed;

    function ignoreWhilePending(event: MouseEvent) {
        if (pending) event.preventDefault();
    }

    return (
        <button
            type="submit"
            aria-pressed={shown}
            // `aria-disabled`, never `disabled`, while in flight (R8): a
            // disabled button drops focus to the page body, so a keyboard user
            // who pressed it would lose their place in a fifty-row list.
            aria-disabled={pending || undefined}
            onClick={ignoreWhilePending}
            // The title is in the accessible name, after the visible label so
            // the name still starts with what is on screen (WCAG 2.5.3):
            // "Read, A Brief History of the Empire, toggle button, pressed".
            // Fifty bare "Read" buttons would be indistinguishable in a
            // screen reader's list of controls.
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800 aria-disabled:cursor-progress ${
                shown
                    ? // iron-900 is the app's "selected" fill. In forced-colors
                      // mode the fill would be repainted away, leaving nothing to
                      // show the state, so it takes the system Highlight pair
                      // instead, as the filter chips do.
                      'border-iron-900 bg-iron-900 font-medium text-frost-50 hover:bg-iron-600 forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:[forced-color-adjust:none]'
                    : 'border-frost-300 bg-white text-iron-600 hover:bg-frost-100'
            }`}
        >
            {flag === 'read' ? <ReadIcon /> : <CollectedIcon />}
            <span>{LABELS[flag]}</span>
            <span className="sr-only">, {title}</span>
        </button>
    );
}

function ReadIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            className="size-4 shrink-0"
        >
            {/* An open book. */}
            <path d="M3 6c3-1.3 6-1 9 1 3-2 6-2.3 9-1v12c-3-1.3-6-1-9 1-3-2-6-2.3-9-1z" />
            <path d="M12 7v12" />
        </svg>
    );
}

function CollectedIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            className="size-4 shrink-0"
        >
            {/* A satchel: in your inventory. */}
            <path d="M5 9h14l-1.2 11H6.2z" />
            <path d="M9 9V7a3 3 0 0 1 6 0v2" />
        </svg>
    );
}

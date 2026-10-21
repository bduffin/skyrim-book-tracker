'use client';

import {
    useActionState,
    useCallback,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type MouseEvent,
    type ReactNode,
    type Ref,
} from 'react';
import { useFormStatus } from 'react-dom';

import { ActionErrorBoundary } from '@/components/action-error-boundary';
import { useToast } from '@/components/toast';

import { setBookFlags } from '../actions';
import {
    FLAG_FIELDS,
    flagAnchor,
    flagFailureMessage,
    IDLE,
    type FlagName,
    type SetFlagResult,
} from '../flag-input';

/**
 * A book's read and collected toggles (FR-4), rendered for every viewer.
 *
 * Two independent toggles rather than one control, because the flags are
 * independent (Decision #2): each is its own form, submits only its own flag,
 * and has its own pending state, so one in flight never blocks the other.
 *
 * Signed out, pressing one opens a sign-in prompt instead of tracking
 * (FR-2). The toggles look the same either way, so a visitor learns the app
 * can track before being asked to sign in for it.
 */
export function FlagToggles({
    bookId,
    title,
    isRead,
    isCollected,
    signedIn,
    signInButton,
}: {
    bookId: string;
    title: string;
    isRead: boolean;
    isCollected: boolean;
    signedIn: boolean;
    /**
     * The sign-in form, rendered by the server and passed in, so this Client
     * Component never imports the sign-in action itself.
     */
    signInButton: ReactNode;
}) {
    // One prompt per row at most: opening one toggle's closes the other's.
    const [prompt, setPrompt] = useState<FlagName | null>(null);

    const shared = { bookId, title, signedIn, signInButton };
    return (
        // Positioned, so each toggle's prompt anchors to the pair rather than
        // to whichever toggle opened it -- the same place for both.
        <div className="relative flex shrink-0 items-center gap-1.5">
            <GuardedToggle
                {...shared}
                flag="read"
                pressed={isRead}
                promptOpen={prompt === 'read'}
                setPromptOpen={(open) => setPrompt(open ? 'read' : null)}
            />
            <GuardedToggle
                {...shared}
                flag="collected"
                pressed={isCollected}
                promptOpen={prompt === 'collected'}
                setPromptOpen={(open) => setPrompt(open ? 'collected' : null)}
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
    signedIn: boolean;
    signInButton: ReactNode;
    /** Whether this toggle's sign-in prompt was opened by pressing it. */
    promptOpen: boolean;
    setPromptOpen: (open: boolean) => void;
};

/**
 * The toggle inside an error boundary of its own, so an action that throws
 * rather than answering -- a dropped connection -- raises a toast instead of
 * replacing the page. Remounting the toggle shows the server's value again:
 * the rollback FR-4 asks for, reached by a different road than a returned
 * error.
 */
function GuardedToggle(props: ToggleProps) {
    const toast = useToast();
    return (
        <ActionErrorBoundary
            onError={(error) => {
                console.error('Book flag action failed to complete:', error);
                toast(flagFailureMessage('unreachable', props.title));
            }}
        >
            <FlagToggle {...props} />
        </ActionErrorBoundary>
    );
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
function FlagToggle({
    bookId,
    title,
    flag,
    pressed,
    signedIn,
    signInButton,
    promptOpen,
    setPromptOpen,
}: ToggleProps) {
    const [result, submit] = useActionState(setBookFlags, IDLE);
    const toast = useToast();
    const wrapper = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);

    // The server's `unauthenticated` answer opens the prompt too. That is the
    // only way it opens without JavaScript -- the form posts, and the page
    // comes back with this result in the action state -- and, with it, the
    // way a signed-in page whose session has expired finds out.
    // Remembering which result was dismissed, rather than clearing a flag,
    // keeps this derivable during the server render.
    const [dismissed, setDismissed] = useState<SetFlagResult | null>(null);
    const unauthenticated =
        result.status === 'error' &&
        result.error === 'unauthenticated' &&
        result !== dismissed;
    const shown = promptOpen || unauthenticated;

    const close = useCallback(
        (refocus: boolean) => {
            setDismissed(result);
            setPromptOpen(false);
            // Closing removes the prompt, and focus inside it would fall to
            // the document body; the toggle that opened it is where it goes.
            if (refocus) button.current?.focus();
        },
        [result, setPromptOpen],
    );

    // A returned failure: the toggle has already rolled back by now -- it
    // shows server truth again once the submission settles -- so this only
    // has to say so. Keyed on the result object, which is new on every
    // submission, so two identical failures raise two toasts. Not for
    // `unauthenticated`, which the prompt answers with a way to sign in.
    useEffect(() => {
        if (result.status === 'error' && result.error !== 'unauthenticated') {
            toast(flagFailureMessage(result.error, title));
        }
    }, [result, title, toast]);

    // A click anywhere outside this toggle and its prompt closes the prompt.
    useEffect(() => {
        if (!shown) return;
        function onPointerDown(event: PointerEvent) {
            if (!wrapper.current?.contains(event.target as Node)) close(false);
        }
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [shown, close]);

    return (
        <div
            ref={wrapper}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && shown) close(true);
            }}
        >
            {/*
             * The target a successful no-JavaScript write redirects back to
             * (`writeReturnTarget`). The margin keeps the row's title in view
             * above it: on a narrow screen the toggles sit on the line below
             * the title, which a flush scroll would cut off.
             */}
            <form
                action={submit}
                id={flagAnchor(flag, bookId)}
                className="scroll-mt-16"
            >
                <input type="hidden" name={FLAG_FIELDS.bookId} value={bookId} />
                <input type="hidden" name={FLAG_FIELDS.flag} value={flag} />
                <input
                    type="hidden"
                    name={FLAG_FIELDS.value}
                    value={String(!pressed)}
                />
                <ToggleButton
                    ref={button}
                    flag={flag}
                    title={title}
                    pressed={pressed}
                    // Signed out, a press opens the prompt without a round
                    // trip. Without JavaScript this never runs and the form
                    // posts, which the server answers the same way.
                    onSignedOutPress={
                        signedIn ? undefined : () => setPromptOpen(!promptOpen)
                    }
                />
            </form>
            {/*
             * Always in the document, so it is an established live region
             * before the prompt is put in it -- a region added along with its
             * content is not reliably announced. Focus stays on the toggle.
             */}
            <div role="status">
                {shown && (
                    <SignInPrompt
                        flag={flag}
                        title={title}
                        signInButton={signInButton}
                        onClose={() => close(true)}
                    />
                )}
            </div>
        </div>
    );
}

/** Nothing to subscribe to: whether this is the server render never changes. */
const subscribeNever = () => () => {};

/**
 * The "sign in to track" prompt (FR-2), anchored under the row's toggles.
 *
 * The sign-in form returns the reader to this same URL, filters and page
 * included (`return-path.ts`).
 */
function SignInPrompt({
    flag,
    title,
    signInButton,
    onClose,
}: {
    flag: FlagName;
    title: string;
    signInButton: ReactNode;
    onClose: () => void;
}) {
    // "Not now" closes the prompt in place once JavaScript runs. Before that
    // -- or without it -- a button would do nothing, so the server renders a
    // link instead: an empty href is the current URL, filters and page
    // included, and following it re-renders without the POST's result.
    const hydrated = useSyncExternalStore(
        subscribeNever,
        () => true,
        () => false,
    );
    const dismissClass =
        'rounded px-2 py-1.5 text-iron-500 underline-offset-2 transition-colors hover:text-iron-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-steel-800';

    return (
        <div className="absolute top-full left-0 z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-frost-300 bg-white p-3 text-sm text-iron-600 shadow-lg sm:right-0 sm:left-auto">
            <p>
                Sign in to mark “{title}” as{' '}
                {flag === 'read' ? 'read' : 'collected'} and keep track of your
                progress.
            </p>
            <div className="mt-3 flex items-center gap-3">
                {signInButton}
                {hydrated ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className={dismissClass}
                    >
                        Not now
                    </button>
                ) : (
                    <a href="" className={dismissClass}>
                        Not now
                    </a>
                )}
            </div>
        </div>
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
    ref,
    flag,
    title,
    pressed,
    onSignedOutPress,
}: {
    ref: Ref<HTMLButtonElement>;
    flag: FlagName;
    title: string;
    pressed: boolean;
    onSignedOutPress: (() => void) | undefined;
}) {
    const { pending, data } = useFormStatus();
    const shown = pending ? data?.get(FLAG_FIELDS.value) === 'true' : pressed;

    function onClick(event: MouseEvent) {
        if (pending) {
            event.preventDefault();
        } else if (onSignedOutPress) {
            event.preventDefault();
            onSignedOutPress();
        }
    }

    return (
        <button
            ref={ref}
            type="submit"
            aria-pressed={shown}
            // `aria-disabled`, never `disabled`, while in flight (R8): a
            // disabled button drops focus to the page body, so a keyboard user
            // who pressed it would lose their place in a fifty-row list.
            aria-disabled={pending || undefined}
            onClick={onClick}
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

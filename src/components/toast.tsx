'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';

import {
    addToast,
    removeToast,
    TOAST_DURATION_MS,
    type Toast,
} from './toast-queue';

type Show = (message: string) => void;

const ToastContext = createContext<Show | null>(null);

/**
 * Shows a toast. Throws outside `ToastProvider`, because a toast that silently
 * goes nowhere is the failure this whole component exists to prevent.
 */
export function useToast(): Show {
    const show = useContext(ToastContext);
    if (show === null) {
        throw new Error('useToast must be used inside a ToastProvider.');
    }
    return show;
}

/**
 * A minimal toast queue (MI6), built rather than installed: it needs one kind
 * of message, and shadcn/ui is not set up yet.
 *
 * Client-side state only, which is the line `architecture.md` section 9 draws:
 * a toast queue is interaction state, not server data.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const nextId = useRef(0);

    const show = useCallback<Show>((message) => {
        const id = nextId.current++;
        setToasts((queue) => addToast(queue, { id, message }));
    }, []);

    const dismiss = useCallback((id: number) => {
        setToasts((queue) => removeToast(queue, id));
    }, []);

    return (
        <ToastContext.Provider value={show}>
            {children}
            <ToastRegion toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
}

/**
 * The live region every toast renders into.
 *
 * Always mounted, even when empty. Screen readers announce changes to a live
 * region that already exists; one inserted together with its content is often
 * not announced at all, so a region rendered only when a toast arrives would
 * be silent exactly when it matters.
 *
 * `role="status"` is polite: the announcement waits for the reader to finish
 * rather than interrupting (WCAG 4.1.3). MI6 asks for a non-blocking toast,
 * and a failed toggle has already rolled back visibly, so nothing here is
 * urgent enough for `alert`.
 *
 * Hovering or focusing anywhere in the region pauses every timer (WCAG 2.2.1),
 * so a slow reader, or a keyboard user tabbing to the dismiss button, does not
 * lose the message out from under them.
 */
function ToastRegion({
    toasts,
    onDismiss,
}: {
    toasts: Toast[];
    onDismiss: (id: number) => void;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const paused = hovered || focused;

    return (
        <div
            role="status"
            // Bottom of the viewport, clear of the header's sign-in control,
            // and inset by the page's 16px gutter on a phone.
            className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
                // Only when focus leaves the region, not when it moves between
                // two toasts' buttons inside it.
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setFocused(false);
                }
            }}
        >
            {toasts.map((toast) => (
                <ToastItem
                    key={toast.id}
                    toast={toast}
                    paused={paused}
                    onDismiss={onDismiss}
                />
            ))}
        </div>
    );
}

function ToastItem({
    toast,
    paused,
    onDismiss,
}: {
    toast: Toast;
    paused: boolean;
    onDismiss: (id: number) => void;
}) {
    // A pause restarts the full duration rather than resuming the remainder:
    // simpler, and erring toward more time to read, never less.
    useEffect(() => {
        if (paused) return;
        const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
        return () => clearTimeout(timer);
    }, [paused, toast.id, onDismiss]);

    return (
        <div
            // Iron on frost, inverted: the same pair as body text, 13.69:1.
            // The border matches the fill, so it is invisible normally and is
            // what keeps the toast's edge visible in forced-colors mode, which
            // repaints every background to the system Canvas.
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-iron-900 bg-iron-900 py-2.5 pr-2 pl-4 text-sm text-frost-50 shadow-lg"
        >
            <p className="flex-1 py-0.5">{toast.message}</p>
            <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss"
                // Outline, never a ring: rings are box-shadows, which
                // forced-colors mode strips. frost-50 on iron-900 is well past
                // the 3:1 a focus indicator needs.
                //
                // `outline-solid` is load-bearing. `outline-hidden` sets
                // Tailwind's --tw-outline-style to none, and `outline-2` only
                // sets the width and reads the style from that variable, so
                // without it the focused button draws no outline at all.
                className="shrink-0 rounded p-1 text-frost-50 outline-hidden hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-frost-50 focus-visible:outline-solid"
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="size-4"
                >
                    <path d="M6 6l12 12M18 6 6 18" />
                </svg>
            </button>
        </div>
    );
}

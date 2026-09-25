/**
 * The pure half of the toast (MI6's "non-blocking error toast"): what a toast
 * is, and how the queue of them changes. Split from `toast.tsx` so it can be
 * unit-tested without rendering anything.
 */

export type Toast = {
    /** Unique for the page's lifetime; React's key, and what dismissal names. */
    id: number;
    message: string;
};

/**
 * How many toasts can be on screen at once. Several toggles failing in quick
 * succession -- a dropped connection, say -- would otherwise stack a column of
 * them up the screen. The oldest go first: the newest is the one about what
 * the reader just did.
 */
export const MAX_TOASTS = 3;

/** How long a toast stays up while nobody is hovering over or focused in it. */
export const TOAST_DURATION_MS = 8000;

export function addToast(queue: readonly Toast[], toast: Toast): Toast[] {
    return [...queue, toast].slice(-MAX_TOASTS);
}

export function removeToast(queue: readonly Toast[], id: number): Toast[] {
    return queue.filter((toast) => toast.id !== id);
}

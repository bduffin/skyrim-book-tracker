'use client';

import { useEffect, useRef } from 'react';

import { RESULTS_ID } from '../results-announcement';

/**
 * Puts focus back on the results count when a soft navigation removes the
 * element that had it (NFR-7, AC-16). Renders nothing.
 *
 * "Reset filters" is not shown on the view it resets to, "Show without these
 * filters" goes with the notice it sits in, and the empty state's reset goes
 * with the empty state -- so each one deletes the element the reader just
 * pressed, focus falls to <body>, and VoiceOver answers with its "web
 * content" hint instead of the result. The count is the place to land: it
 * says what the reader is now looking at, and the next Tab goes on into it.
 *
 * Only when the element that last had focus is *gone*: focus on <body> for
 * any other reason -- a fresh arrival, the back button, a click on blank
 * page -- is the reader's own, and taking it would be the bug. A full page
 * load is beyond this; with JavaScript off, focus starts at the top as it
 * does on any page load, and a URL fragment only scrolls (checked in Dia).
 */
export function ResultsFocus({ view }: { view: string }) {
    const lastFocused = useRef<Element | null>(null);

    useEffect(() => {
        // Removing the focused element moves focus to <body> without a
        // focusin, so this keeps the element that was removed.
        const remember = (event: FocusEvent) => {
            lastFocused.current = event.target as Element;
        };
        document.addEventListener('focusin', remember);
        return () => document.removeEventListener('focusin', remember);
    }, []);

    useEffect(() => {
        const last = lastFocused.current;
        if (
            last !== null &&
            !last.isConnected &&
            (document.activeElement === null ||
                document.activeElement === document.body)
        ) {
            document.getElementById(RESULTS_ID)?.focus();
        }
    }, [view]);

    return null;
}

'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The signed-in reader's account menu: their badge as the trigger, and
 * Settings and Sign out inside.
 *
 * A native `<details>`/`<summary>` disclosure, so it opens and closes with
 * JavaScript disabled and its expanded state is announced without ARIA of our
 * own. Not `role="menu"`, which promises arrow-key handling a link and a
 * button do not need, and not the `popover` attribute, which is newer than
 * the browser floor (architecture.md section 9).
 *
 * JavaScript adds what `<details>` lacks: closing on Escape, on a click
 * outside, and after a navigation, which would otherwise leave the panel open
 * over the new page.
 */
export function AccountMenu({
    label,
    badge,
    children,
}: {
    /** Who is signed in, as text: the start of the trigger's accessible name. */
    label: string;
    /** Who is signed in, rendered by the server. */
    badge: ReactNode;
    /** The menu's items, rendered by the server so its forms still post. */
    children: ReactNode;
}) {
    const details = useRef<HTMLDetailsElement>(null);
    const [open, setOpen] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        if (details.current) details.current.open = false;
    }, [pathname]);

    // Subscribed only while open: otherwise every press anywhere on the page
    // would run this for a menu that is almost always closed.
    useEffect(() => {
        if (!open) return;
        function onPointerDown(event: PointerEvent) {
            const menu = details.current;
            if (menu && !menu.contains(event.target as Node)) {
                menu.open = false;
            }
        }
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    return (
        <details
            ref={details}
            className="group relative"
            onToggle={(event) => setOpen(event.currentTarget.open)}
            onKeyDown={(event) => {
                const menu = details.current;
                if (event.key === 'Escape' && menu?.open) {
                    menu.open = false;
                    // Closing hides whatever had focus inside the panel; the
                    // trigger is where it goes back to.
                    menu.querySelector('summary')?.focus();
                }
            }}
        >
            <summary
                // Starts with the visible name, so the accessible name still
                // begins with what is on screen (WCAG 2.5.3). Set whole rather
                // than built from an sr-only suffix, whose join with the
                // badge's text the browser spaces as it likes.
                aria-label={`${label}, account menu`}
                className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 transition-colors hover:bg-iron-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-frost-50 [&::-webkit-details-marker]:hidden"
            >
                {badge}
                <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                >
                    <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
                </svg>
            </summary>
            <div
                // Following a link closes the menu even when the navigation
                // keeps the pathname -- Settings from /settings?saved=1 --
                // which the pathname effect above cannot see. Not on Sign
                // out: a failure to reach the server is said inside the menu.
                onClick={(event) => {
                    const menu = details.current;
                    if (menu && (event.target as Element).closest('a')) {
                        menu.open = false;
                    }
                }}
                className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md border border-frost-300 bg-white py-1 shadow-lg"
            >
                {children}
            </div>
        </details>
    );
}

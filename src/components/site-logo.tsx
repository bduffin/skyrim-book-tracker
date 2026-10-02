import Link from 'next/link';

/**
 * The app's mark: a closed book with a gold check on its cover -- a book you
 * have tracked. Original artwork; nothing here is Bethesda's or UESP's.
 *
 * Drawn for the dark header: frost strokes and a gold-400 check (6.38:1 on
 * iron-900). `src/app/icon.svg` is the same drawing on its own dark tile for
 * the browser tab, where the ground is often light -- change one, change the
 * other.
 *
 * `currentColor` for the book, so forced-colors mode repaints it with the
 * link text; the check keeps a fixed gold, and in forced-colors mode takes
 * the link color too, rather than a gold the user's theme did not choose.
 */
export function BookCheckMark({ className }: { className?: string }) {
    return (
        <svg
            aria-hidden="true"
            // Cropped to the drawing -- the book's outer stroke edges, 0.9 either
            // side of its 7..26 by 4..28 rectangle -- so the mark starts
            // exactly where its box does. Padded, it sat 6px in from the
            // header's gutter, visibly off from anything wrapped beneath it.
            viewBox="6.1 3.1 20.8 25.8"
            fill="none"
            className={className}
        >
            <rect
                x="7"
                y="4"
                width="19"
                height="24"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path d="M10 4v24" stroke="currentColor" strokeWidth="1.8" />
            <path
                d="M13.5 16l3 3 6-7"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-gold-400 forced-colors:stroke-[LinkText]"
            />
        </svg>
    );
}

/**
 * The header's logo, linking home: `/` takes a signed-in reader to their
 * collection and anyone else to the catalog (FR-8).
 *
 * The name, Arcanaeum, over what the site is, in the small spaced capitals
 * the app's other labels use. Stacked rather than on one line so the whole
 * thing fits a 320px phone without shrinking: the full name shows at every
 * width, and on a narrow screen it is the header's other controls that give
 * way, wrapping onto a second line (see `SiteHeader`). "Skyrim" stays in the
 * description, never the name, which is what keeps the site's own name clear
 * of Bethesda's trademark.
 *
 * Its accessible name is the visible text, joined by a colon screen readers
 * hear and sighted readers do not need: "Arcanaeum: Skyrim Book Tracker".
 */
export function SiteLogo() {
    return (
        <Link
            href="/"
            className="flex items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-frost-50"
        >
            {/* 21 by 26: the cropped drawing at the size it was drawn at. */}
            <BookCheckMark className="h-[26px] w-[21px] shrink-0" />
            <span className="flex flex-col gap-1 whitespace-nowrap">
                <span className="font-serif text-xl leading-none font-medium">
                    Arcanaeum
                </span>
                <span className="sr-only">: </span>
                {/* frost-300 on iron-900: 9.79:1. */}
                <span className="text-xs leading-none font-medium tracking-[0.18em] text-frost-300 uppercase">
                    Skyrim Book Tracker
                </span>
            </span>
        </Link>
    );
}

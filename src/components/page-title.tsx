import type { ReactNode } from 'react';

/**
 * A page's title, centered over a gold hairline with a diamond at its midpoint.
 *
 * Centered because the ornament is symmetric: the diamond only reads as part
 * of the title when it sits under the word. With the title left-aligned it sat
 * at the page's midpoint, far from anything it belonged to.
 *
 * The ornament is decorative, hence `aria-hidden`, and gold on purpose:
 * gold-600 is 3.63 against the page, which clears WCAG's 3:1 for graphics but
 * not the 4.5 text needs -- so gold draws lines here and never carries words.
 */
export function PageTitle({ children }: { children: ReactNode }) {
    return (
        <header className="px-4 pb-5 text-center">
            <h1>{children}</h1>
            <div aria-hidden="true" className="mt-2 flex items-center gap-2">
                <span className="h-px flex-1 bg-gold-600" />
                <span className="size-1.5 rotate-45 bg-gold-600" />
                <span className="h-px flex-1 bg-gold-600" />
            </div>
        </header>
    );
}

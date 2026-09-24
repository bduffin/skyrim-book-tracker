import { EB_Garamond, Jost } from 'next/font/google';

/*
 * One definition shared by the root layout and `global-error.tsx`. The latter
 * replaces the root layout entirely when it renders, so it gets nothing the
 * layout sets up -- defining the fonts twice would also load them twice.
 *
 * Self-hosted by next/font at build time: no request reaches Google from a
 * reader's browser, and the fallback metrics are adjusted so the swap causes
 * no layout shift. Both are variable fonts, so one file per family covers
 * every weight the theme uses.
 */
export const jost = Jost({ subsets: ['latin'], variable: '--font-jost' });

export const garamond = EB_Garamond({
    subsets: ['latin'],
    variable: '--font-eb-garamond',
});

/** Both variables, for the `className` of an `<html>` element. */
export const fontVariables = `${jost.variable} ${garamond.variable}`;

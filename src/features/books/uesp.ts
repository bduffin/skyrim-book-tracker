/**
 * Links back to the UESP page each book was imported from.
 *
 * Deepens FR-7's attribution from a single footer notice to per-item credit,
 * and gives a reader somewhere to find detail the app deliberately does not
 * store (NFR-5 keeps book text out of this database, and NG1's detail page is
 * deferred). It also sends traffic to the project the data comes from.
 *
 * Pure and dependency-free so it can be unit tested; `uesp_title` is `not
 * null` on every row, so there is no absent case to model.
 */

/** MediaWiki article base, as the dump's own `<base>` element gives it. */
const WIKI_BASE = 'https://en.uesp.net/wiki/';

/**
 * The canonical UESP URL for a stored `uesp_title` (e.g.
 * `Skyrim:Oghma Infinium`).
 *
 * This reproduces MediaWiki's `wfUrlencode`, which is *not* the same as
 * `encodeURIComponent`. The difference is one character and it is not
 * cosmetic: `encodeURIComponent` leaves an apostrophe bare where MediaWiki
 * writes `%27`, and 389 of the catalogue's 1,207 titles contain one. Those
 * URLs still resolve, but none of them match the address UESP itself links to
 * -- so every visit would take a needless redirect and arrive with a URL the
 * site does not recognise as its own.
 *
 * `wfUrlencode` percent-encodes via `rawurlencode` and then decodes a fixed
 * set back, which is what the two passes below reproduce: encode the five
 * characters `encodeURIComponent` leaves alone, then restore the ones
 * MediaWiki keeps literal.
 *
 * Verified against UESP's own search results for every shape the catalogue
 * contains: the `Skyrim:` namespace colon, apostrophes with parentheses,
 * `&`, `?`, `"`, a forward slash (`Skyrim:The Alduin/Akatosh Dichotomy`), and
 * comma-plus-period. Non-ASCII titles exist but only on four charset-test
 * books that are `is_obtainable = false`, so no link is ever rendered for one.
 */
export function uespUrl(uespTitle: string): string {
    const encoded = encodeURIComponent(uespTitle.replace(/ /g, '_'))
        // Left bare by encodeURIComponent; rawurlencode escapes them.
        .replace(/'/g, '%27')
        .replace(/!/g, '%21')
        .replace(/\*/g, '%2A')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        // ...and then wfUrlencode puts these back as literal characters.
        .replace(/%3B/gi, ';')
        .replace(/%40/gi, '@')
        .replace(/%24/gi, '$')
        .replace(/%21/gi, '!')
        .replace(/%2A/gi, '*')
        .replace(/%28/gi, '(')
        .replace(/%29/gi, ')')
        .replace(/%2C/gi, ',')
        .replace(/%2F/gi, '/')
        .replace(/%3A/gi, ':')
        .replace(/%7E/gi, '~');

    return `${WIKI_BASE}${encoded}`;
}

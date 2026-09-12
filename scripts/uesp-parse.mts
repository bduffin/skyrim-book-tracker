/**
 * Pure parsing / classification / mapping functions for the UESP book import.
 *
 * Every function here is I/O-free and unit-tested against
 * `scripts/__fixtures__/sample-dump.xml` (FR-20). The streaming, database and
 * CLI glue lives in `import-uesp.mts`.
 *
 * See docs/specs/prd-import-uesp-books.md for the requirements these implement.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RawParams = Record<string, string>;

export type Category =
    'skill_book' | 'book' | 'journal' | 'note' | 'black_book' | 'treasure_map';

export type Source =
    'base' | 'dawnguard' | 'dragonborn' | 'hearthfire' | 'creation_club';

export type Skill =
    | 'One-Handed'
    | 'Two-Handed'
    | 'Archery'
    | 'Block'
    | 'Smithing'
    | 'Heavy Armor'
    | 'Light Armor'
    | 'Alteration'
    | 'Conjuration'
    | 'Destruction'
    | 'Illusion'
    | 'Restoration'
    | 'Enchanting'
    | 'Alchemy'
    | 'Sneak'
    | 'Lockpicking'
    | 'Pickpocket'
    | 'Speech';

export type LocationTier = 'place' | 'carrier' | 'nearby';

/** The three fields a lore page can supply to its book (FR-4a). */
export type LoreMetadata = {
    description: string | null;
    author: string | null;
    textnote: string | null;
};

/** lorename -> lore metadata, built by the ns-130 pass. */
export type LoreIndex = Map<string, LoreMetadata>;

export type ParsedPage = {
    uespPageId: number; // <page><id> -- the identity (FR-5)
    uespTitle: string; // 'Skyrim:Deathbrand (book)'
    params: RawParams; // {{Game Book}} params ONLY (FR-4)
    artifactType: string | null; // {{Artifact Summary}}'s |artifacttype -- a DIFFERENT template
    categoryLinks: string[]; // explicitly-written [[Category:...]] links
    lore: LoreMetadata | null; // resolved from the ns-130 pass via lorename (FR-4a)
    unobtainable?: ReadonlySet<string>; // from parseUnobtainableBooks (FR-6c)
};

export type ParsedLocation = {
    name: string;
    notes: string | null;
    locationType: LocationTier;
};

export type BookRow = {
    uesp_page_id: number;
    uesp_title: string;
    title: string;
    category: Category;
    source: Source;
    skill: Skill | null;
    game_id: string | null;
    game_id_extra: string[] | null;
    description: string | null;
    author: string | null;
    value: string | null;
    weight: number | null;
    icon: string | null;
    lorename: string | null;
    errata: string | null;
    gameplay_note: string | null;
    series_up: string | null;
    series_prev: string | null;
    series_next: string | null;
    is_quest_related: boolean;
    artifact_type: string | null;
    is_obtainable: boolean;
    is_unique: boolean | null;
};

export type MappedLocation = {
    uespPageId: number;
    location_name: string;
    location_type: LocationTier;
    notes: string | null;
};

export type LocationRow = {
    location_name: string;
    location_type: LocationTier;
    notes: string | null;
};

export type LocationBatchEntry = {
    book_id: string;
    locations: LocationRow[];
};

export const SKILLS: readonly Skill[] = [
    'One-Handed',
    'Two-Handed',
    'Archery',
    'Block',
    'Smithing',
    'Heavy Armor',
    'Light Armor',
    'Alteration',
    'Conjuration',
    'Destruction',
    'Illusion',
    'Restoration',
    'Enchanting',
    'Alchemy',
    'Sneak',
    'Lockpicking',
    'Pickpocket',
    'Speech',
];

/**
 * Books UESP does not list but that are still unobtainable (FR-6c).
 *
 * Kept deliberately tiny. The authoritative list comes from UESP's own
 * `Skyrim:Unobtainable Items` page (see parseUnobtainableBooks); this covers
 * only the one page it omits -- Shalidor's Insights (unused pages), which
 * documents cut assets and would otherwise sit in the default browse scope
 * beside its real sibling.
 */
const UNOBTAINABLE_TITLE_SUFFIXES = [/\(unused pages\)$/i];
// `lorename=none` is a sentinel on 729 of the 845 books that set it (FR-6a).
const LORENAME_SENTINEL = 'none';

// ─────────────────────────────────────────────────────────────────────────────
// Wikitext primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes HTML comments and <nowiki> blocks. Both can contain a literal
 * `{{Game Book}}` that must not be mistaken for a real invocation (FR-3).
 */
export function stripCommentsAndNowiki(wikitext: string): string {
    return wikitext
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<nowiki>[\s\S]*?<\/nowiki>/gi, '');
}

/** True if the page is a redirect, which never carries a real template (FR-3). */
export function isRedirect(wikitext: string): boolean {
    return /^\s*#REDIRECT/i.test(wikitext);
}

/**
 * Finds a template invocation's body, brace- and link-aware.
 *
 * Returns the text between `{{Name` and its matching `}}`, or null. The name
 * match is case-insensitive and tolerates whitespace and underscores, because
 * MediaWiki treats `{{Game Book`, `{{ game book` and `{{Game_Book` alike.
 */
export function findTemplateBody(
    wikitext: string,
    templateName: string,
): string | null {
    const namePattern = templateName.trim().replace(/\s+/g, '[\\s_]+');
    const opener = new RegExp(`\\{\\{\\s*${namePattern}\\s*(?=[|}\\n])`, 'i');
    const match = opener.exec(wikitext);
    if (!match) return null;

    let i = match.index + match[0].length;
    let braceDepth = 1;
    let linkDepth = 0;

    while (i < wikitext.length) {
        if (wikitext.startsWith('{{', i)) {
            braceDepth += 1;
            i += 2;
        } else if (wikitext.startsWith('}}', i)) {
            braceDepth -= 1;
            if (braceDepth === 0)
                return wikitext.slice(match.index + match[0].length, i);
            i += 2;
        } else if (wikitext.startsWith('[[', i)) {
            linkDepth += 1;
            i += 2;
        } else if (wikitext.startsWith(']]', i)) {
            if (linkDepth > 0) linkDepth -= 1;
            i += 2;
        } else {
            i += 1;
        }
    }
    // Unterminated template (the malformed fixture page).
    return null;
}

/**
 * Splits a template body into `key=value` params on top-level pipes only.
 * A `|` inside `[[a|b]]` or a nested `{{x|y}}` is not a separator -- 95% of
 * book pages carry a piped link inside the template and 16% nest another
 * template, so this is the common case, not an edge case.
 */
export function splitTemplateParams(body: string): RawParams {
    const parts: string[] = [];
    let current = '';
    let braceDepth = 0;
    let linkDepth = 0;
    let i = 0;

    while (i < body.length) {
        if (body.startsWith('{{', i)) {
            braceDepth += 1;
            current += '{{';
            i += 2;
        } else if (body.startsWith('}}', i)) {
            if (braceDepth > 0) braceDepth -= 1;
            current += '}}';
            i += 2;
        } else if (body.startsWith('[[', i)) {
            linkDepth += 1;
            current += '[[';
            i += 2;
        } else if (body.startsWith(']]', i)) {
            if (linkDepth > 0) linkDepth -= 1;
            current += ']]';
            i += 2;
        } else if (body[i] === '|' && braceDepth === 0 && linkDepth === 0) {
            parts.push(current);
            current = '';
            i += 1;
        } else {
            current += body[i];
            i += 1;
        }
    }
    parts.push(current);

    const params: RawParams = {};
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq === -1) continue; // positional param; {{Game Book}} has none
        const key = part.slice(0, eq).trim().toLowerCase();
        if (!key) continue;
        params[key] = part.slice(eq + 1).trim();
    }
    return params;
}

/** Unwraps `[[Target|Label]]` -> `Label`, `[[Skyrim:Target#Anchor]]` -> `Target`. */
export function unwrapLinks(text: string): string {
    return text.replace(/\[\[([^\]]*?)\]\]/g, (_full, inner: string) => {
        const pipe = inner.indexOf('|');
        if (pipe !== -1) return inner.slice(pipe + 1);
        const withoutAnchor = inner.split('#')[0];
        const colon = withoutAnchor.lastIndexOf(':');
        return colon === -1 ? withoutAnchor : withoutAnchor.slice(colon + 1);
    });
}

/** Removes `{{...}}` templates, brace-aware, so `{{Map Link|x=1|y=2}}` goes whole. */
export function stripTemplates(text: string): string {
    let out = '';
    let depth = 0;
    let i = 0;
    while (i < text.length) {
        if (text.startsWith('{{', i)) {
            depth += 1;
            i += 2;
        } else if (text.startsWith('}}', i)) {
            if (depth > 0) depth -= 1;
            i += 2;
        } else {
            if (depth === 0) out += text[i];
            i += 1;
        }
    }
    return out;
}

const ENTITIES: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
};

/**
 * Normalizes a value for storage: decodes entities, drops residual markup and
 * collapses whitespace. Applied to every stored string (FR-19).
 */
export function cleanWikitext(value: string): string {
    if (!value) return '';
    let out = value;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
    out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    out = out.replace(/<ref[^>]*\/>/gi, '');
    out = stripTemplates(out);
    out = unwrapLinks(out);
    out = out.replace(/<br\s*\/?>/gi, ' ');
    out = out.replace(/<[^>]+>/g, '');
    out = out.replace(/'{2,}/g, ''); // ''italic'' / '''bold'''
    out = out.replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
    return out.replace(/\s+/g, ' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Template extraction (FR-4)
// ─────────────────────────────────────────────────────────────────────────────

/** Parses the page's `{{Game Book}}` params, or null if it has none. */
export function parseGameBookTemplate(wikitext: string): RawParams | null {
    const clean = stripCommentsAndNowiki(wikitext);
    if (isRedirect(clean)) return null;
    const body = findTemplateBody(clean, 'Game Book');
    if (body === null) return null;
    return splitTemplateParams(body);
}

/**
 * Reads `|artifacttype=` from `{{Artifact Summary}}` -- a SEPARATE template
 * that only the Oghma Infinium carries. It is deliberately not merged into the
 * Game Book params: both templates define `type`, `value` and `weight`, and
 * Artifact Summary's `type` is `[[Skyrim:Books|Book]]` where Game Book's is
 * `List 0`-`List 4`, so merging would silently corrupt that field.
 */
export function parseArtifactSummary(wikitext: string): string | null {
    const clean = stripCommentsAndNowiki(wikitext);
    const body = findTemplateBody(clean, 'Artifact Summary');
    if (body === null) return null;
    const value = splitTemplateParams(body)['artifacttype'];
    if (!value) return null;
    return cleanWikitext(value) || null;
}

/**
 * Reads the three transcluded metadata fields from a `{{Lore Book}}` page.
 *
 * MediaWiki renders these onto the book page, so a book-page-only parse loses
 * them: `Skyrim:Thief (book)` has no `description`, but `Lore:Thief` supplies
 * "The second chapter of the adventures of Eslaf Erol". The page's body prose
 * is deliberately NOT read -- that is the full text NG2 excludes.
 */
export function parseLoreBook(wikitext: string): LoreMetadata | null {
    const clean = stripCommentsAndNowiki(wikitext);
    const body = findTemplateBody(clean, 'Lore Book');
    if (body === null) return null;
    const params = splitTemplateParams(body);
    return {
        description: cleanWikitext(params['description'] ?? '') || null,
        author: cleanWikitext(params['author'] ?? '') || null,
        textnote: cleanWikitext(params['textnote'] ?? '') || null,
    };
}

/** The lore page a book's `lorename` points at: `Thief` -> `Lore:Thief`. */
export function loreTitleFor(
    lorename: string | null | undefined,
): string | null {
    if (!lorename) return null;
    const trimmed = cleanWikitext(lorename);
    if (!trimmed || trimmed.toLowerCase() === LORENAME_SENTINEL) return null;
    return `Lore:${trimmed}`;
}

/** Explicitly-written `[[Category:...]]` links. Template-injected ones are absent from a dump. */
export function extractCategoryLinks(wikitext: string): string[] {
    const clean = stripCommentsAndNowiki(wikitext);
    const links: string[] = [];
    const re = /\[\[Category:([^\]|]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) links.push(m[1].trim());
    return links;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification (FR-7, FR-9, FR-10)
// ─────────────────────────────────────────────────────────────────────────────

function iconOf(params: RawParams): string {
    return (params['icon'] ?? '')
        .replace(/^SR-icon-book-/i, '')
        .replace(/\.png$/i, '');
}

/**
 * Tiered, and the ORDER IS LOAD-BEARING -- `icon` is artwork and is reused.
 *
 *   1. skill_book -- `skill=` or an artifact type. Must come first: the 25
 *      magic-school skill books carry SpellTome icons.
 *   2. black_book -- a Black Book icon (7 pages, all Dragonborn).
 *   3. note       -- `note=1` OR a Note-family icon, unless tier 4 claims it.
 *   4. journal    -- a Journal icon; wins over `note=1` when the title also
 *      says "Journal" (recovers Sculptor Visthar's and Urzog's Journals).
 *   5. book       -- everything else.
 */
export function classifyCategory(page: ParsedPage): Category {
    const { params, uespTitle, artifactType } = page;
    const icon = iconOf(params);

    if (params['skill'] || artifactType) return 'skill_book';
    if (/black\s*book/i.test(icon)) return 'black_book';
    // Title-derived, unlike every other tier -- treasure maps carry no icon, no
    // type and value=0, so no field distinguishes them. The title does: it
    // matches all 12 with zero false positives across 1,207 books. Needed
    // because only 11 set note=1; Velehk Sain's Treasure Map sets nothing and
    // would otherwise fall through to `book`.
    if (/\btreasure map\b/i.test(uespTitle)) return 'treasure_map';

    const isNoteIcon = /note/i.test(icon);
    const isJournalIcon = /journal/i.test(icon);
    const titleSaysJournal = /journal/i.test(uespTitle);
    const flaggedNote = Boolean(params['note']);

    if ((flaggedNote || isNoteIcon) && !(isJournalIcon && titleSaysJournal)) {
        return 'note';
    }
    if (isJournalIcon) return 'journal';
    return 'book';
}

/**
 * `smod` -> Creation Club category link -> `mod` -> base.
 *
 * `smod` alone is not enough: only 2 of the 329 Creation Club pages set
 * `smod=CC`. And `mod` alone is not enough either -- 4 pages carry `mod=` with
 * no `smod` and no CC category, and would otherwise be filed as base game.
 */
export function classifySource(
    params: RawParams,
    categoryLinks: string[],
): Source {
    const smod = (params['smod'] ?? '').trim().toUpperCase();
    if (smod === 'DG') return 'dawnguard';
    if (smod === 'DB') return 'dragonborn';
    if (smod === 'HF') return 'hearthfire';

    if (categoryLinks.some((c) => /^Skyrim-Creation Club/i.test(c))) {
        return 'creation_club';
    }

    const mod = params['mod'] ?? '';
    if (/dawnguard/i.test(mod)) return 'dawnguard';
    if (/dragonborn/i.test(mod)) return 'dragonborn';
    if (/hearthfire/i.test(mod)) return 'hearthfire';
    if (mod.trim()) return 'creation_club';

    return 'base';
}

const SKILL_ALIASES: Record<string, Skill> = {
    'one handed': 'One-Handed',
    'two handed': 'Two-Handed',
    marksman: 'Archery',
    speechcraft: 'Speech',
    security: 'Lockpicking',
};

/**
 * Exact match after trim/case-fold, plus a small alias table. Deliberately not
 * substring scanning: a value naming two skills would silently pick one, and
 * `book.skill` holds only one.
 */
export function normalizeSkill(raw: string | null | undefined): Skill | null {
    if (!raw) return null;
    const cleaned = cleanWikitext(raw).toLowerCase();
    if (!cleaned) return null;
    const exact = SKILLS.find((s) => s.toLowerCase() === cleaned);
    if (exact) return exact;
    return SKILL_ALIASES[cleaned] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Location parsing (FR-11)
// ─────────────────────────────────────────────────────────────────────────────

const LEADING_LINK = /^\[\[([^\]]*?)\]\]/;
const CARRIER_PREFIX = /^(held|carried)\s+by\s+/i;
const DISTANCE_PREFIX = /^[~<>]?\s*[\d,.]+\s*(ft|feet|m|meters?)\b[^[]*/i;

function labelOf(linkInner: string): string {
    const pipe = linkInner.indexOf('|');
    if (pipe !== -1) return linkInner.slice(pipe + 1).trim();
    const withoutAnchor = linkInner.split('#')[0];
    const colon = withoutAnchor.lastIndexOf(':');
    return (
        colon === -1 ? withoutAnchor : withoutAnchor.slice(colon + 1)
    ).trim();
}

function tidyNotes(text: string): string | null {
    const cleaned = cleanWikitext(text)
        .replace(/^[,;.\s]+/, '')
        .trim();
    return cleaned || null;
}

/**
 * Splits a `loc` field into location rows.
 *
 * Bullets are `*`-prefixed with inconsistent leading whitespace. Extraction is
 * tiered because a leading-link-else-plain-text rule misreads roughly a quarter
 * of bullets -- notably the 81 `Carried by [[NPC]]` cases, where the link is a
 * person, not a place.
 */
export function parseLocations(
    rawLoc: string | null | undefined,
): ParsedLocation[] {
    if (!rawLoc || !rawLoc.trim()) return [];

    const out: ParsedLocation[] = [];
    let parent: ParsedLocation | null = null;
    let children: string[] = [];

    // A parent with `**` children describes one place holding several copies
    // (The Legend of Red Eagle lists three spots inside Deepwood Redoubt). Each
    // child becomes its own row under the PARENT's name -- flattening them
    // would produce a location literally called "interior".
    const flush = () => {
        if (!parent) return;
        if (children.length) {
            for (const child of children) {
                out.push({
                    name: parent.name,
                    notes: tidyNotes(child),
                    locationType: parent.locationType,
                });
            }
        } else {
            out.push(parent);
        }
        parent = null;
        children = [];
    };

    for (const line of rawLoc.split('\n')) {
        // Only `*`-led lines are bullets. Anything else is prose -- Vernaccus
        // and Bourlor ends with an italic aside, and Showhide templates leave
        // stray lines behind.
        const bullet = /^\s*(\*+)\s*(.*)$/.exec(line);
        if (!bullet) continue;
        const depth = bullet[1].length;
        const content = bullet[2].trim();
        if (!content) continue;

        if (depth === 1) {
            flush();
            parent = parseLocationBullet(content);
        } else if (parent) {
            children.push(content);
        }
    }
    flush();

    return out;
}

export function parseLocationBullet(bullet: string): ParsedLocation | null {
    // Templates go first so {{Map Link|x=1|y=2}} can't be mistaken for content.
    const text = stripTemplates(bullet).trim();
    if (!text) return null;

    // Tier 2 -- an NPC carries it. Check before the leading-link tier, since
    // "Carried by [[X]]" would otherwise look like tier 4.
    const carrier = CARRIER_PREFIX.exec(text);
    if (carrier) {
        const rest = text.slice(carrier[0].length);
        const link = LEADING_LINK.exec(rest);
        const name = link
            ? labelOf(link[1])
            : cleanWikitext(rest.split(',')[0]);
        const notes = link ? tidyNotes(rest.slice(link[0].length)) : null;
        if (!name) return null;
        return { name, notes, locationType: 'carrier' };
    }

    // Tier 3 -- a bearing from a landmark.
    const distance = DISTANCE_PREFIX.exec(text);
    if (distance) {
        const rest = text.slice(distance[0].length);
        const link = LEADING_LINK.exec(rest.trim());
        if (link) {
            const name = labelOf(link[1]);
            const bearing = cleanWikitext(distance[0]).trim();
            const trailing = tidyNotes(rest.trim().slice(link[0].length));
            const notes = [bearing, trailing].filter(Boolean).join(' ').trim();
            if (name)
                return { name, notes: notes || null, locationType: 'nearby' };
        }
    }

    // Tier 1 -- the common case: bullet opens with the location link.
    const leading = LEADING_LINK.exec(text);
    if (leading) {
        const name = labelOf(leading[1]);
        const notes = tidyNotes(text.slice(leading[0].length));
        if (name) return { name, notes, locationType: 'place' };
    }

    // Tier 4 -- a link appears later in the bullet; take the first one.
    const anyLink = /\[\[([^\]]*?)\]\]/.exec(text);
    if (anyLink) {
        const name = labelOf(anyLink[1]);
        const notes = tidyNotes(
            text.slice(0, anyLink.index) +
                ' ' +
                text.slice(anyLink.index + anyLink[0].length),
        );
        if (name) return { name, notes, locationType: 'place' };
    }

    // Tier 5 -- plain text.
    const comma = text.indexOf(',');
    const name = cleanWikitext(comma === -1 ? text : text.slice(0, comma));
    const notes = comma === -1 ? null : tidyNotes(text.slice(comma + 1));
    if (!name) return null;
    return { name, notes, locationType: 'place' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Title cleanup (FR-19)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strips the namespace prefix and ONLY the exact ` (book)` disambiguator --
 * stripping arbitrary parentheticals would collapse many Note/Journal/Letter
 * pages into identical titles. `sumtitle` wins when the template supplies one.
 */
/** The page whose "Unobtainable Books & Notes" section is authoritative (FR-6c). */
export const UNOBTAINABLE_PAGE_TITLE = 'Skyrim:Unobtainable Items';

/**
 * Extracts the unobtainable book titles from `Skyrim:Unobtainable Items`.
 *
 * Scoped to the "Unobtainable Books & Notes" section on purpose: the same page
 * also lists unobtainable weapons, armour, scrolls and spell tomes, none of
 * which are {{Game Book}} pages. `{{Book Normal}}` happens to be unique to that
 * section today, but relying on that would break the moment someone reuses it.
 *
 * Returns fully-qualified titles ("Skyrim:Tolfdir's Book") for direct
 * comparison against ParsedPage.uespTitle.
 */
export function parseUnobtainableBooks(wikitext: string): Set<string> {
    const clean = stripCommentsAndNowiki(wikitext);
    const heading = /==+\s*Unobtainable Books\s*&\s*Notes\s*==+/i.exec(clean);
    if (!heading) return new Set();

    const start = heading.index + heading[0].length;
    const rest = clean.slice(start);
    const next = /\n==[^=]/.exec(rest);
    const section = next ? rest.slice(0, next.index) : rest;

    const titles = new Set<string>();
    const row = /\{\{\s*Book Normal\s*\|([^}]+)\}\}/gi;
    let m: RegExpExecArray | null;
    while ((m = row.exec(section)) !== null) {
        // {{Book Normal|Page Title}} or {{Book Normal|Page Title|Display Title}}
        const pageTitle = m[1].split('|')[0].trim();
        if (pageTitle) titles.add(`Skyrim:${pageTitle}`);
    }
    return titles;
}

/**
 * Fails the run when a cross-page dependency yields nothing (FR-4a, FR-6c).
 *
 * Both the unobtainable list and the lore index depend on pages outside the
 * book set, and both break silently: a renamed page, a changed section heading
 * or a renamed template all produce an empty result rather than an error. The
 * import would then "succeed" with eight unobtainable books in the default
 * scope, or with description coverage quietly down by 111 books.
 *
 * A changed COUNT is legitimate data drift and is only reported (FR-17); zero
 * is structural breakage. This throws at contributor time, when someone is
 * running an import against a new dump and can fix it -- it cannot reach a user.
 *
 * IMPORTANT: pass the count PARSED FROM THE SOURCE PAGE, never an effective
 * count that includes local supplements. UNOBTAINABLE_TITLE_SUFFIXES would
 * contribute 1 on its own, so a merged set turns a broken page's 0 into a 1 and
 * this guard silently stops firing. The two are deliberately kept apart:
 * parseUnobtainableBooks returns only what the page yielded, and isObtainable
 * applies the supplement separately at classification time.
 */
export function assertDependencyResolved(
    what: string,
    size: number,
    sourcePage: string,
): void {
    if (size > 0) return;
    throw new Error(
        `${what} resolved 0 entries from "${sourcePage}". ` +
            `This is structural breakage, not data drift -- the page, its ` +
            `section heading, or its row template has most likely been renamed. ` +
            `Continuing would silently produce a catalogue with wrong data.`,
    );
}

/**
 * Whether a player can acquire this book (FR-6c).
 *
 * `true` means "nothing has marked this otherwise", NOT "verified obtainable".
 * Pass the set from parseUnobtainableBooks; the local suffix list supplements it.
 */
export function isObtainable(
    uespTitle: string,
    unobtainable: ReadonlySet<string> = new Set(),
): boolean {
    const title = uespTitle.trim();
    if (unobtainable.has(title)) return false;
    return !UNOBTAINABLE_TITLE_SUFFIXES.some((re) => re.test(title));
}

export function cleanTitle(
    uespTitle: string,
    sumtitle?: string | null,
): string {
    if (sumtitle && sumtitle.trim()) return cleanWikitext(sumtitle);
    const withoutNamespace = uespTitle.replace(/^[A-Za-z ]+:/, '');
    return cleanWikitext(withoutNamespace.replace(/\s*\(book\)$/i, ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping (FR-5, FR-6)
// ─────────────────────────────────────────────────────────────────────────────

function textOrNull(params: RawParams, key: string): string | null {
    const raw = params[key];
    if (!raw) return null;
    const cleaned = cleanWikitext(raw);
    return cleaned || null;
}

function numberOrNull(params: RawParams, key: string): number | null {
    const raw = params[key];
    if (!raw) return null;
    const cleaned = cleanWikitext(raw);
    return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

export function mapToBookRow(page: ParsedPage): BookRow {
    const { params, uespPageId, uespTitle, artifactType, categoryLinks, lore } =
        page;

    // The book page's own value always wins; the lore page fills the gap (FR-4a).
    const description =
        textOrNull(params, 'description') ?? lore?.description ?? null;
    const author = textOrNull(params, 'author') ?? lore?.author ?? null;
    const errata = textOrNull(params, 'textnote') ?? lore?.textnote ?? null;

    const lorenameRaw = textOrNull(params, 'lorename');
    const extras = ['id2', 'id3', 'id4', 'id5']
        .map((k) => textOrNull(params, k))
        .filter((v): v is string => Boolean(v));

    return {
        uesp_page_id: uespPageId,
        uesp_title: uespTitle,
        title: cleanTitle(uespTitle, params['sumtitle']),
        category: classifyCategory(page),
        source: classifySource(params, categoryLinks),
        skill: normalizeSkill(params['skill']),
        game_id: textOrNull(params, 'id'),
        game_id_extra: extras.length ? extras : null,
        description,
        author,
        // text, not integer: 3 pages carry dual values such as
        // "65 (Skill Book)<br>6 (Normal)" -- two of them skill books.
        value: textOrNull(params, 'value'),
        weight: numberOrNull(params, 'weight'),
        icon: textOrNull(params, 'icon'),
        lorename:
            lorenameRaw && lorenameRaw.toLowerCase() === LORENAME_SENTINEL
                ? null
                : lorenameRaw,
        errata,
        gameplay_note: textOrNull(params, 'comment'),
        series_up: textOrNull(params, 'up'),
        series_prev: textOrNull(params, 'prev'),
        series_next: textOrNull(params, 'next'),
        is_quest_related: Boolean(params['quest'] || params['questrel']),
        artifact_type: artifactType,
        is_obtainable: isObtainable(uespTitle, page.unobtainable),
        // No {{Game Book}} field supplies this; unknown must not be stored as false.
        is_unique: null,
    };
}

export function mapToLocationRows(page: ParsedPage): MappedLocation[] {
    const parsed = parseLocations(page.params['loc']);
    const seen = new Set<string>();
    const rows: MappedLocation[] = [];

    for (const loc of parsed) {
        // Dedupe identical (name, notes) pairs -- no DB constraint guards this,
        // and the same place with DIFFERENT notes is valid (15 books rely on it).
        const key = `${loc.name} ${loc.notes ?? ''} ${loc.locationType}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
            uespPageId: page.uespPageId,
            location_name: loc.name,
            location_type: loc.locationType,
            notes: loc.notes,
        });
    }
    return rows;
}

/**
 * Builds the RPC payload for a whole chunk.
 *
 * Takes every successfully parsed book, not just flattened location rows: a
 * book with zero locations has no rows to flatten, and omitting it would leave
 * its stale locations in place (FR-13).
 */
export function attachBookIds(
    parsed: { uespPageId: number; locations: LocationRow[] }[],
    idsByPageId: Map<number, string>,
): LocationBatchEntry[] {
    const entries: LocationBatchEntry[] = [];
    for (const book of parsed) {
        const bookId = idsByPageId.get(book.uespPageId);
        if (!bookId) continue; // book was skipped or its chunk failed
        entries.push({ book_id: bookId, locations: book.locations });
    }
    return entries;
}

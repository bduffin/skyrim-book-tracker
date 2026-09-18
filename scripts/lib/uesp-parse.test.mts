/**
 * M0 tests: every FR-20 pure function, against real pages in
 * `fixtures/sample-dump.xml`.
 *
 * Expectations are hand-transcribed from the fixture's wikitext, not captured
 * from this implementation's output -- the point of the gate is to catch the
 * parser being confidently wrong, which a snapshot could not do.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fixture, loadFixturePages } from './fixtures/load.mjs';
import {
    attachBookIds,
    classifyCategory,
    classifySource,
    cleanTitle,
    cleanWikitext,
    extractCategoryLinks,
    mapToBookRow,
    mapToLocationRows,
    normalizeSkill,
    parseArtifactSummary,
    parseGameBookTemplate,
    parseLocations,
    parseLoreBook,
    loreTitleFor,
    isObtainable,
    parseUnobtainableBooks,
    cleanKeepingLinks,
    unwrapLinks,
    assertDependencyResolved,
    UNOBTAINABLE_PAGE_TITLE,
    type LoreIndex,
    type ParsedPage,
} from './uesp-parse.mjs';

/**
 * Builds the ns-130 lore index the real run's second pass produces (FR-4a).
 * Keyed by lorename, i.e. the page title with the `Lore:` prefix removed.
 */
function buildLoreIndex(): LoreIndex {
    const index: LoreIndex = new Map();
    for (const page of loadFixturePages()) {
        if (!page.title.startsWith('Lore:')) continue;
        const lore = parseLoreBook(page.wikitext);
        if (lore) index.set(page.title.slice('Lore:'.length), lore);
    }
    return index;
}

const LORE_INDEX = buildLoreIndex();
const UNOBTAINABLE = parseUnobtainableBooks(
    fixture(UNOBTAINABLE_PAGE_TITLE).wikitext,
);

/** Builds the ParsedPage a real run would hand to the classifiers. */
function pageFor(title: string): ParsedPage {
    const f = fixture(title);
    const params = parseGameBookTemplate(f.wikitext);
    assert.ok(params, `expected a {{Game Book}} template on ${title}`);
    const loreTitle = loreTitleFor(params['lorename']);
    return {
        uespPageId: f.pageId,
        uespTitle: f.title,
        params,
        artifactType: parseArtifactSummary(f.wikitext),
        categoryLinks: extractCategoryLinks(f.wikitext),
        lore: loreTitle
            ? (LORE_INDEX.get(loreTitle.slice('Lore:'.length)) ?? null)
            : null,
        unobtainable: UNOBTAINABLE,
    };
}

describe('fixture integrity', () => {
    test('loads every page, including the two non-Skyrim cases', () => {
        const pages = loadFixturePages();
        assert.equal(pages.length, 32);
        assert.ok(
            pages.some((p) => p.ns === 116),
            'needs an Oblivion page',
        );
        assert.ok(
            pages.some(
                (p) => p.ns === 134 && !/\{\{\s*Game Book/i.test(p.wikitext),
            ),
            'needs a ns-134 page that is not a Game Book',
        );
    });
});

describe('parseGameBookTemplate (FR-4)', () => {
    test('extracts params with piped links intact', () => {
        const params = parseGameBookTemplate(
            fixture('Skyrim:Deathbrand (book)').wikitext,
        );
        assert.ok(params);
        assert.equal(params['id'], 'xx03661a');
        assert.equal(params['lorename'], 'Deathbrand');
        assert.equal(params['value'], '20');
        assert.equal(params['type'], 'List 4');
        // A pipe inside [[Skyrim:Dragonborn|Dragonborn]] is not a separator.
        assert.equal(params['mod'], '[[Skyrim:Dragonborn|Dragonborn]]');
    });

    test('returns null for a page with no Game Book template', () => {
        assert.equal(
            parseGameBookTemplate(fixture('Skyrim:High Elves').wikitext),
            null,
        );
    });

    test('{{Game Book Compilation}} is a DIFFERENT template and must not match', () => {
        // Series index pages listing volumes -- not obtainable books. 38 of them
        // in the catalog, all with no |id=. A loose `{{Game Book` substring test
        // matches them, which is how they were briefly counted as books.
        for (const title of [
            'Skyrim:The Song of Pelinal',
            'Skyrim:Discovering Ruunvald',
            'Skyrim:Black Book (book)',
        ]) {
            assert.equal(
                parseGameBookTemplate(fixture(title).wikitext),
                null,
                `${title} is a compilation, not a book`,
            );
        }
    });

    test('returns null for an unterminated template', () => {
        const page = fixture('Skyrim:Fixture Malformed Page');
        assert.equal(parseGameBookTemplate(page.wikitext), null);
    });

    test('ignores a commented-out invocation', () => {
        assert.equal(
            parseGameBookTemplate('<!-- {{Game Book|id=1}} -->'),
            null,
        );
        assert.equal(
            parseGameBookTemplate('<nowiki>{{Game Book|id=1}}</nowiki>'),
            null,
        );
    });

    test('tolerates whitespace and underscores in the template name', () => {
        assert.deepEqual(parseGameBookTemplate('{{ game_book |id=7}}'), {
            id: '7',
        });
    });
});

describe('parseArtifactSummary (FR-4)', () => {
    test('reads artifacttype from the SEPARATE Artifact Summary template', () => {
        const oghma = fixture('Skyrim:Oghma Infinium');
        assert.equal(parseArtifactSummary(oghma.wikitext), 'Daedric Artifact');
        // The decisive check: it is NOT a Game Book param, so a Game-Book-only
        // parse would leave Oghma classified as `book`.
        const params = parseGameBookTemplate(oghma.wikitext);
        assert.equal(params?.['artifacttype'], undefined);
    });

    test('does not leak Artifact Summary values into Game Book params', () => {
        // Both templates define `value`; Artifact Summary's is also 2500 here,
        // but `type` differs and must come from Game Book.
        const params = parseGameBookTemplate(
            fixture('Skyrim:Oghma Infinium').wikitext,
        );
        assert.equal(
            params?.['type'],
            undefined,
            'Game Book has no type on this page',
        );
    });

    test('returns null when the page has no artifact template', () => {
        assert.equal(
            parseArtifactSummary(fixture('Skyrim:Thief (book)').wikitext),
            null,
        );
    });
});

describe('classifyCategory (FR-7)', () => {
    const cases: [string, string][] = [
        ['Skyrim:Thief (book)', 'skill_book'],
        ['Skyrim:Breathing Water', 'skill_book'], // SpellTome icon, skill= wins
        ['Skyrim:Oghma Infinium', 'skill_book'], // via artifacttype
        ['Skyrim:Black Book: Waking Dreams (book)', 'black_book'],
        ['Skyrim:Dark Brotherhood Assassin’s Note'.replace('’', "'"), 'note'],
        ['Skyrim:Treasure Map X', 'treasure_map'], // title-derived tier
        ['Skyrim:Mysterious Note (Delphine)', 'note'], // Note icon, no flag
        ['Skyrim:Thalmor Dossier: Ulfric Stormcloak', 'note'], // Journal icon + note=1
        ["Skyrim:Urzog's Journal", 'journal'], // title tiebreak beats note=1
        ["Skyrim:Hamelyn's Journal", 'journal'],
        ['Skyrim:Alduin is Real', 'book'],
    ];

    for (const [title, expected] of cases) {
        test(`${title} -> ${expected}`, () => {
            assert.equal(classifyCategory(pageFor(title)), expected);
        });
    }

    test('the magic-school skill book really does carry a SpellTome icon', () => {
        // Guards the reason tier 1 must precede the icon tiers.
        const params = parseGameBookTemplate(
            fixture('Skyrim:Breathing Water').wikitext,
        );
        assert.match(params?.['icon'] ?? '', /SpellTome/);
        assert.equal(params?.['skill'], 'Alteration');
    });
});

describe('treasure_map tier (FR-7)', () => {
    test('classifies a flagged treasure map', () => {
        assert.equal(
            classifyCategory(pageFor('Skyrim:Treasure Map X')),
            'treasure_map',
        );
    });

    test('classifies the outlier that sets neither note nor icon', () => {
        // Velehk Sain's Treasure Map carries no note=1 and no icon, so before
        // this tier it fell through to `book` while its 11 siblings were notes.
        const page = pageFor('Skyrim:Treasure Map X');
        assert.equal(
            classifyCategory({
                ...page,
                uespTitle: "Skyrim:Velehk Sain's Treasure Map",
            }),
            'treasure_map',
        );
    });

    test('does not fire on ordinary titles', () => {
        const page = pageFor('Skyrim:Alduin is Real');
        assert.equal(classifyCategory(page), 'book');
    });
});

describe('classifySource (FR-9)', () => {
    const cases: [string, string][] = [
        ['Skyrim:Thief (book)', 'base'],
        ["Skyrim:Cultists' Orders", 'dragonborn'], // smod=DB
        ['Skyrim:The Aetherium Wars', 'dawnguard'], // smod=DG
        ['Skyrim:Breezehome Furnishings', 'hearthfire'], // smod=HF
        ['Skyrim:Mysterious Note (Staff of Sheogorath)', 'creation_club'],
        ['Skyrim:Ransom Note', 'hearthfire'], // mod= with no smod
    ];

    for (const [title, expected] of cases) {
        test(`${title} -> ${expected}`, () => {
            const page = pageFor(title);
            assert.equal(
                classifySource(page.params, page.categoryLinks),
                expected,
            );
        });
    }

    test('Ransom Note has no smod, so mod= is what saves it', () => {
        const page = pageFor('Skyrim:Ransom Note');
        assert.equal(page.params['smod'], undefined);
        assert.match(page.params['mod'] ?? '', /Hearthfire/);
    });
});

describe('normalizeSkill (FR-10)', () => {
    test('maps canonical names', () => {
        assert.equal(normalizeSkill('Pickpocket'), 'Pickpocket');
        assert.equal(normalizeSkill('  alteration '), 'Alteration');
    });

    test('maps aliases', () => {
        assert.equal(normalizeSkill('One Handed'), 'One-Handed');
        assert.equal(normalizeSkill('Speechcraft'), 'Speech');
    });

    test('does NOT substring-match a multi-skill value', () => {
        // The hazard exact matching exists to avoid: silently picking one.
        assert.equal(normalizeSkill('Block, Heavy Armor'), null);
    });

    test('returns null for absent or unknown values', () => {
        assert.equal(normalizeSkill(null), null);
        assert.equal(normalizeSkill(''), null);
        assert.equal(normalizeSkill('Unarmed'), null);
    });
});

describe('parseLocations (FR-11)', () => {
    // notes carry the WHOLE bullet with links intact, so the sentence survives
    // wherever the place sat in it; `unwrapLinks` is the renderer (FR-11).
    test('tier 1 - leading link, notes keep the whole bullet', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Deathbrand (book)').params['loc'],
        );
        assert.equal(locs.length, 11);
        assert.equal(locs[0].name, 'Bloodskal Barrow');
        assert.equal(locs[0].locationType, 'place');
        assert.match(locs[0].notes ?? '', /^\[\[Skyrim:Bloodskal Barrow\|/);
        assert.match(
            unwrapLinks(locs[0].notes ?? ''),
            /^Bloodskal Barrow, one on a dresser near a double bed/,
        );
    });

    test('tier 2 - Carried by [[NPC]] is a carrier, not a place', () => {
        const locs = parseLocations(
            pageFor("Skyrim:Dark Brotherhood Assassin's Note").params['loc'],
        );
        assert.equal(locs.length, 1);
        assert.equal(locs[0].name, 'Assassins');
        assert.equal(locs[0].locationType, 'carrier');
        // "Carried by X" is information the name alone does not carry, so it is
        // kept -- unlike a bullet that is nothing but the place link.
        assert.match(
            unwrapLinks(locs[0].notes ?? ''),
            /^Carried by Assassins$/,
        );
    });

    test('tier 3 - distance from a landmark, with the Map Link stripped', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Thief (book)').params['loc'],
        );
        const nearby = locs.find((l) => l.locationType === 'nearby');
        assert.ok(nearby, 'expected a nearby tier');
        assert.equal(nearby.name, 'Ivarstead');
        assert.match(nearby.notes ?? '', /630 ft WSW of/);
        assert.doesNotMatch(nearby.notes ?? '', /Map Link|zoom=/);
    });

    // The bug this contract exists to prevent: excising a mid-sentence link
    // closed the gap and left wreckage -- "Basement of , behind a locked door",
    // "The , on a bookshelf", "On ' skeleton in ...". 86 rows were visibly
    // damaged before notes carried the whole bullet.
    test('a mid-sentence place survives in the note', () => {
        const locs = parseLocations(
            [
                '*Basement of [[Skyrim:Black-Briar Manor|Black-Briar Manor]], behind a [[Skyrim:Lockpicking|master-locked]] door',
                "*The [[SR:Blue Palace|Blue Palace]], on a bookshelf in Sybille Stentor's room",
                '*630 ft WSW of [[Skyrim:Ivarstead|Ivarstead]] {{Map Link|x=1|y=2}}',
            ].join('\n'),
        );
        assert.deepEqual(
            locs.map((l) => unwrapLinks(l.notes ?? '')),
            [
                'Basement of Black-Briar Manor, behind a master-locked door',
                "The Blue Palace, on a bookshelf in Sybille Stentor's room",
                '630 ft WSW of Ivarstead',
            ],
        );
        // No orphaned punctuation from a removed link.
        for (const l of locs) {
            assert.doesNotMatch(l.notes ?? '', /\s,|\s:|of\s*,/);
        }
    });

    test('a bullet that is only the place carries no note', () => {
        const [only] = parseLocations('*[[Skyrim:Dragonsreach|Dragonsreach]]');
        assert.equal(only.name, 'Dragonsreach');
        assert.equal(only.notes, null, 'repeating the name adds nothing');
    });

    test('tier 4 - link not at the start of the bullet', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Treasure Map X').params['loc'],
        );
        assert.equal(locs[0].name, 'Stony Creek Cave');
        assert.equal(locs[0].locationType, 'place');
        assert.match(locs[0].notes ?? '', /Inside/);
    });

    test('link anchors are dropped from the name', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Thief (book)').params['loc'],
        );
        assert.ok(
            locs.some((l) => l.name === 'Bleak Falls Temple'),
            'anchor link should yield its label',
        );
    });

    test('the same place twice with different notes survives', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Alduin is Real').params['loc'],
        );
        const college = locs.filter((l) => l.name === 'College of Winterhold');
        assert.equal(college.length, 2, 'both College entries must survive');
        assert.notEqual(college[0].notes, college[1].notes);
    });

    test('** sub-bullets become rows under the PARENT location', () => {
        const locs = parseLocations(
            pageFor('Skyrim:The Legend of Red Eagle').params['loc'],
        );
        const deepwood = locs.filter((l) => l.name === 'Deepwood Redoubt');
        assert.equal(
            deepwood.length,
            3,
            'three copies inside Deepwood Redoubt',
        );
        // The bug this guards: a location literally named "interior".
        assert.ok(
            !locs.some((l) => /^interior/i.test(l.name)),
            'sub-bullet text must never become a location name',
        );
        // Each child carries the parent's own text. Without it these were the
        // only rows whose notes never named their place, and a parent like
        // `Fort Dawnguard, on the ground floor` lost that detail entirely.
        for (const d of deepwood) {
            assert.match(
                unwrapLinks(d.notes ?? ''),
                /^Deepwood Redoubt/,
                'child notes must lead with the parent location',
            );
        }
        assert.equal(
            new Set(deepwood.map((d) => d.notes)).size,
            3,
            'the three copies stay distinguishable',
        );
    });

    test('non-bullet prose is ignored', () => {
        const locs = parseLocations(
            pageFor('Skyrim:Vernaccus and Bourlor').params['loc'],
        );
        assert.ok(
            !locs.some((l) =>
                /Only locations for the skill book/i.test(l.name),
            ),
            'trailing italic aside is not a location',
        );
    });

    test('empty and missing loc are both empty lists', () => {
        const empty = pageFor('Skyrim:The Nirnroot Missive');
        const missing = pageFor("Skyrim:Saint Jiub's Opus");
        assert.equal(
            empty.params['loc'],
            '',
            'key present, value empty (146 pages)',
        );
        assert.equal(
            missing.params['loc'],
            undefined,
            'key absent entirely (11 pages)',
        );
        assert.deepEqual(parseLocations(empty.params['loc']), []);
        assert.deepEqual(parseLocations(missing.params['loc']), []);
    });
});

describe('cleanTitle / cleanWikitext (FR-19)', () => {
    test('strips the namespace and only the exact " (book)" suffix', () => {
        assert.equal(cleanTitle('Skyrim:Deathbrand (book)'), 'Deathbrand');
        assert.equal(
            cleanTitle('Skyrim:Mysterious Note (Delphine)'),
            'Mysterious Note (Delphine)',
            'other parentheticals disambiguate and must be kept',
        );
    });

    test('prefers sumtitle when present', () => {
        assert.equal(cleanTitle('Skyrim:Whatever', 'Real Title'), 'Real Title');
    });

    test('decodes entities and strips markup', () => {
        assert.equal(cleanWikitext("''italic'' text"), 'italic text');
        assert.equal(
            cleanWikitext('Sunder &amp; Wraithguard'),
            'Sunder & Wraithguard',
        );
        assert.equal(cleanWikitext('a<br />b'), 'a b');
        assert.equal(
            cleanWikitext('[[Skyrim:Pirate|a pirate]] boss'),
            'a pirate boss',
        );
        assert.equal(cleanWikitext('[[Skyrim:Windhelm]]'), 'Windhelm');
    });
});

describe('mapToBookRow (FR-5, FR-6)', () => {
    test('Deathbrand maps every field we import', () => {
        const row = mapToBookRow(pageFor('Skyrim:Deathbrand (book)'));
        assert.equal(row.title, 'Deathbrand');
        assert.equal(row.uesp_title, 'Skyrim:Deathbrand (book)');
        assert.equal(row.category, 'book');
        assert.equal(row.source, 'dragonborn');
        assert.equal(
            row.game_id,
            'xx03661a',
            'xx placeholder is preserved verbatim',
        );
        assert.equal(row.value, '20');
        assert.equal(row.weight, 1);
        assert.equal(row.lorename, 'Deathbrand');
        assert.equal(row.is_quest_related, true);
        assert.equal(
            row.is_unique,
            null,
            'no source field -- must not default to false',
        );
        assert.equal(row.artifact_type, null);
    });

    test('lorename=none becomes null, not the literal string', () => {
        const row = mapToBookRow(pageFor("Skyrim:Hamelyn's Journal"));
        assert.equal(row.lorename, null);
    });

    test('dual |value= is stored verbatim as text', () => {
        const row = mapToBookRow(pageFor('Skyrim:Vernaccus and Bourlor'));
        assert.equal(row.value, '65 (Skill Book) 6 (Normal)');
        assert.equal(row.skill, 'Archery');
        assert.equal(row.category, 'skill_book');
    });

    test('slash-separated value is also kept verbatim', () => {
        assert.equal(
            mapToBookRow(pageFor('Skyrim:Fragment: On Artaeum')).value,
            '20 / 5',
        );
    });

    test('id2 lands in game_id_extra', () => {
        const row = mapToBookRow(pageFor('Skyrim:Fragment: On Artaeum'));
        assert.equal(row.game_id, '0001AD06');
        assert.deepEqual(row.game_id_extra, ['00072841']);
    });

    test('a page with no |id= still imports, with a null game_id', () => {
        const row = mapToBookRow(pageFor('Skyrim:Letter from the Empire'));
        assert.equal(row.game_id, null);
        assert.ok(
            row.uesp_page_id > 0,
            'identity comes from the page id, not game_id',
        );
    });

    test('Creation Club fexxx id is preserved and the source is CC', () => {
        const row = mapToBookRow(
            pageFor('Skyrim:Mysterious Note (Staff of Sheogorath)'),
        );
        assert.match(row.game_id ?? '', /^fexxx/i);
        assert.equal(row.source, 'creation_club');
    });

    test('Oghma is a skill book with a null skill', () => {
        const row = mapToBookRow(pageFor('Skyrim:Oghma Infinium'));
        assert.equal(row.category, 'skill_book');
        assert.equal(row.skill, null);
        assert.equal(row.artifact_type, 'Daedric Artifact');
    });
});

describe('parseLoreBook + lore fallback (FR-4a)', () => {
    test('reads the subtitle UESP renders but the book page does not carry', () => {
        const lore = parseLoreBook(fixture('Lore:Thief').wikitext);
        assert.ok(lore);
        assert.equal(
            lore.description,
            'The second chapter of the adventures of Eslaf Erol',
        );
        assert.equal(lore.author, 'Reven');
        assert.match(lore.textnote ?? '', /completely fictional/);
    });

    test('the book page genuinely lacks these fields', () => {
        // The whole reason FR-4a exists -- confirm we are not testing a no-op.
        const params = parseGameBookTemplate(
            fixture('Skyrim:Thief (book)').wikitext,
        );
        assert.equal(params?.['description'], undefined);
        assert.equal(params?.['author'], undefined);
        assert.equal(params?.['lorename'], 'Thief');
    });

    test('lorename resolves to its Lore page by exact title', () => {
        assert.equal(loreTitleFor('Thief'), 'Lore:Thief');
        assert.equal(
            loreTitleFor('none'),
            null,
            'the sentinel resolves to nothing',
        );
        assert.equal(loreTitleFor(''), null);
        assert.equal(loreTitleFor(undefined), null);
    });

    test('the lore value fills the gap on the mapped row', () => {
        const row = mapToBookRow(pageFor('Skyrim:Thief (book)'));
        assert.equal(
            row.description,
            'The second chapter of the adventures of Eslaf Erol',
        );
        assert.equal(row.author, 'Reven');
        assert.match(row.errata ?? '', /completely fictional/);
    });

    test("the book page's own value wins over the lore page", () => {
        const page = pageFor('Skyrim:Thief (book)');
        const overridden = mapToBookRow({
            ...page,
            params: { ...page.params, description: 'Book page wins' },
        });
        assert.equal(overridden.description, 'Book page wins');
    });

    test('a book with no lorename is unaffected', () => {
        const row = mapToBookRow(pageFor("Skyrim:Hamelyn's Journal"));
        assert.equal(row.lorename, null);
    });
});

describe('assertDependencyResolved (FR-4a, FR-6c)', () => {
    test('passes when the dependency resolved something', () => {
        assert.doesNotThrow(() =>
            assertDependencyResolved(
                'unobtainable books',
                UNOBTAINABLE.size,
                UNOBTAINABLE_PAGE_TITLE,
            ),
        );
    });

    test('throws on zero, naming the page and the likely cause', () => {
        assert.throws(
            () =>
                assertDependencyResolved(
                    'unobtainable books',
                    0,
                    UNOBTAINABLE_PAGE_TITLE,
                ),
            /resolved 0 entries.*Unobtainable Items[\s\S]*renamed/,
        );
    });

    test('the local supplement must not mask a broken page', () => {
        // The trap: merging UNOBTAINABLE_TITLE_SUFFIXES into the parsed set
        // would turn a broken page's 0 into a 1, and the guard would stop
        // firing. parseUnobtainableBooks must return ONLY what the page gave.
        const broken = parseUnobtainableBooks(
            fixture(UNOBTAINABLE_PAGE_TITLE).wikitext.replace(
                /Unobtainable Books & Notes/g,
                'Renamed',
            ),
        );
        assert.equal(broken.size, 0, 'parsed set carries no local supplement');
        // ...while the supplement still works independently.
        assert.equal(
            isObtainable("Skyrim:Shalidor's Insights (unused pages)", broken),
            false,
        );
        assert.throws(() =>
            assertDependencyResolved(
                'unobtainable books',
                broken.size,
                UNOBTAINABLE_PAGE_TITLE,
            ),
        );
    });

    test('a renamed section yields zero, which is what the guard catches', () => {
        // The failure mode that motivates this: page present, section renamed,
        // parse returns an empty set and the run would otherwise report success.
        const renamed = fixture(UNOBTAINABLE_PAGE_TITLE).wikitext.replace(
            /Unobtainable Books & Notes/g,
            'Unobtainable Books',
        );
        const parsed = parseUnobtainableBooks(renamed);
        assert.equal(
            parsed.size,
            0,
            'section rename must produce an empty set',
        );
        assert.throws(() =>
            assertDependencyResolved(
                'unobtainable books',
                parsed.size,
                UNOBTAINABLE_PAGE_TITLE,
            ),
        );
    });
});

describe('parseUnobtainableBooks + isObtainable (FR-6c)', () => {
    test("reads UESP's curated list", () => {
        assert.equal(UNOBTAINABLE.size, 23);
        assert.ok(UNOBTAINABLE.has("Skyrim:Tolfdir's Book"));
        assert.ok(UNOBTAINABLE.has('Skyrim:The Secrets of Ragnvald'));
    });

    test('includes the typography test assets', () => {
        // Bethesda font/encoding tests UESP documents; titles are strings of
        // accented vowels. They would otherwise render as collectible books.
        assert.ok(UNOBTAINABLE.has('Skyrim:Ä ö ü ß Ä Ö Ü'));
        assert.ok(
            UNOBTAINABLE.has(
                'Skyrim:123 Abc Def Ghijklmnop Qrstu VWXYZ 123456789',
            ),
        );
    });

    test('is scoped to the Books & Notes section', () => {
        // The same page lists unobtainable spell tomes; Spell Tome: Spectral
        // Arrow must not leak in. The fixture includes that section to prove it.
        const raw = fixture(UNOBTAINABLE_PAGE_TITLE).wikitext;
        assert.match(
            raw,
            /Spectral Arrow/,
            'fixture must contain the other section',
        );
        assert.ok(
            ![...UNOBTAINABLE].some((t) =>
                /Spectral Arrow|Spell Tome/i.test(t),
            ),
            'nothing from the Spell Tomes section may be included',
        );
    });

    test('takes the display title, not the page title, from two-arg rows', () => {
        // {{Book Normal|Anonymous Letter (Imperial)|Anonymous Letter}}
        assert.ok(UNOBTAINABLE.has('Skyrim:Anonymous Letter (Imperial)'));
        assert.ok(!UNOBTAINABLE.has('Skyrim:Anonymous Letter'));
    });

    test('returns an empty set when the section is absent', () => {
        assert.equal(
            parseUnobtainableBooks('== Something Else ==\nnothing here').size,
            0,
        );
    });

    test('flags UESP-listed books', () => {
        assert.equal(
            isObtainable("Skyrim:Tolfdir's Book", UNOBTAINABLE),
            false,
        );
    });

    test('keeps the local supplement UESP omits', () => {
        assert.equal(
            isObtainable(
                "Skyrim:Shalidor's Insights (unused pages)",
                UNOBTAINABLE,
            ),
            false,
        );
        assert.equal(
            isObtainable("Skyrim:Shalidor's Insights (book)", UNOBTAINABLE),
            true,
        );
    });

    test('ordinary books stay obtainable, and the row carries it', () => {
        assert.equal(
            isObtainable('Skyrim:Deathbrand (book)', UNOBTAINABLE),
            true,
        );
        assert.equal(
            mapToBookRow(pageFor('Skyrim:Thief (book)')).is_obtainable,
            true,
        );
    });
});

describe('mapToLocationRows + attachBookIds (FR-11, FR-13)', () => {
    test('dedupes identical rows but keeps same-place-different-notes', () => {
        const rows = mapToLocationRows(pageFor('Skyrim:Alduin is Real'));
        const college = rows.filter(
            (r) => r.location_name === 'College of Winterhold',
        );
        assert.equal(college.length, 2);
        const keys = rows.map((r) => `${r.location_name}|${r.notes}`);
        assert.equal(new Set(keys).size, keys.length, 'no exact duplicates');
    });

    test('a book with no locations yields no rows', () => {
        assert.deepEqual(
            mapToLocationRows(pageFor("Skyrim:Saint Jiub's Opus")),
            [],
        );
    });

    test('zero-location books are still sent, so stale rows get cleared', () => {
        const entries = attachBookIds(
            [
                { uespPageId: 1, locations: [] },
                {
                    uespPageId: 2,
                    locations: [
                        {
                            location_name: 'Dragonsreach',
                            location_type: 'place',
                            notes: null,
                        },
                    ],
                },
            ],
            new Map([
                [1, 'uuid-1'],
                [2, 'uuid-2'],
            ]),
        );
        assert.equal(entries.length, 2);
        assert.deepEqual(entries[0], { book_id: 'uuid-1', locations: [] });
    });

    test('books whose id is unknown are dropped, never sent with a dangling id', () => {
        const entries = attachBookIds(
            [{ uespPageId: 99, locations: [] }],
            new Map<number, string>(),
        );
        assert.deepEqual(entries, []);
    });
});

describe('cleanKeepingLinks (FR-11)', () => {
    test('cleans everything except the links', () => {
        assert.equal(
            cleanKeepingLinks(
                "In a chest &nbsp;in ''[[Skyrim:Dragonsreach|Dragonsreach]]''" +
                    ' <!-- hidden --><br>upstairs {{Map Link|x=1}}',
            ),
            'In a chest in [[Skyrim:Dragonsreach|Dragonsreach]] upstairs',
        );
    });

    test('preserves the spacing either side of a link', () => {
        // Splitting on links and cleaning each segment would lose these spaces,
        // because cleanWikitext trims; masking keeps them.
        assert.equal(cleanKeepingLinks('a [[X|x]] b'), 'a [[X|x]] b');
    });

    // A DLC marker or Map Link sitting between the place and its comma used to
    // leave the space behind: `Fort Dawnguard , to the right`.
    test('closes the gap left by a stripped inline template', () => {
        assert.equal(
            cleanKeepingLinks(
                '[[Skyrim:Fort_Dawnguard|Fort Dawnguard]] {{DG}}, to the right',
            ),
            '[[Skyrim:Fort_Dawnguard|Fort Dawnguard]], to the right',
        );
        assert.equal(
            cleanWikitext(
                '([[Skyrim:The Rift|The Rift]]) {{Map Link|x=1}}, outside',
            ),
            '(The Rift), outside',
        );
    });

    // A spaced ellipsis is real text, not template residue. `Lore:Where Were
    // You ... Dragon Broke` is looked up by its exact page title, so collapsing
    // that space costs a lorename resolution (FR-4a) -- silently, because the
    // dependency guard only fails at zero.
    // Alias placeholders are runtime substitutions, not HTML. Stripping them
    // as tags left `Letter from`, `Fijeh's Letter to`, and a book called `To`.
    test('renders Creation Kit alias placeholders rather than eating them', () => {
        assert.equal(
            cleanWikitext('Letter from <Alias=QuestGiver>'),
            'Letter from (Quest Giver)',
        );
        assert.equal(cleanWikitext('To <Alias=Player>'), 'To (Player)');
        assert.equal(
            cleanWikitext('Writ of Execution: <alias=player>'),
            'Writ of Execution: (player)',
        );
        // One sumtitle writes its `=` as the numeric entity `&#61;`.
        assert.equal(
            cleanWikitext("Fijeh's Letter to <Alias&#61;Player>"),
            "Fijeh's Letter to (Player)",
        );
        // Real HTML is still removed.
        assert.equal(cleanWikitext('a <b>bold</b> word'), 'a bold word');
    });

    test('leaves a spaced ellipsis alone', () => {
        assert.equal(
            cleanWikitext('Where Were You ... Dragon Broke'),
            'Where Were You ... Dragon Broke',
        );
        assert.equal(cleanWikitext('a , b'), 'a, b');
        assert.equal(cleanWikitext('end .'), 'end.');
    });

    test('unwrapLinks renders it back to plain text', () => {
        const kept = cleanKeepingLinks(
            'Southeast of the [[Skyrim:Abandoned Shack|Abandoned Shack]], on a body',
        );
        assert.equal(
            unwrapLinks(kept),
            'Southeast of the Abandoned Shack, on a body',
        );
    });
});

/**
 * Browse M1 tests for the pure half of the browse query.
 *
 * Expectations are written from FR-3, FR-6 and the measured catalogue, not
 * captured from this implementation -- the point of the gate is to catch the
 * arithmetic being confidently wrong, which a snapshot could not do.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    CATEGORIES,
    DEFAULT_CATEGORIES,
    DEFAULT_FILTERS,
    DEFAULT_SOURCES,
    MAX_SEARCH_LENGTH,
    SKILLS,
    SOURCES,
    clampPage,
    escapeLike,
    filtersQuery,
    isDefaultFilters,
    pageCountFor,
    pageQuery,
    paginationItems,
    parseAllowlistParam,
    parseFilters,
    parseFlagParam,
    parsePageParam,
    parseSearchParam,
    parseSkillParam,
    rangeFor,
} from './scope';

describe('default scope (FR-3)', () => {
    // Pinned rather than smoke-tested: these are allowlists, so a value
    // appearing here by accident widens every player's denominator, and the
    // 423-book figure the rest of the milestone is verified against silently
    // stops being the number in play.
    test('categories are exactly skill_book, book, black_book', () => {
        assert.deepEqual(
            [...DEFAULT_CATEGORIES],
            ['skill_book', 'book', 'black_book'],
        );
    });

    test('sources are everything but creation_club', () => {
        assert.deepEqual(
            [...DEFAULT_SOURCES],
            ['base', 'dawnguard', 'dragonborn', 'hearthfire'],
        );
    });
});

describe('parsePageParam (AC-10)', () => {
    test('reads a valid page', () => {
        assert.equal(parsePageParam('1'), 1);
        assert.equal(parsePageParam('2'), 2);
        assert.equal(parsePageParam('9'), 9);
    });

    test('tolerates surrounding whitespace', () => {
        assert.equal(parsePageParam('  3  '), 3);
    });

    test('falls back to 1 when the param is absent or empty', () => {
        assert.equal(parsePageParam(undefined), 1);
        assert.equal(parsePageParam(''), 1);
        assert.equal(parsePageParam('   '), 1);
    });

    test('rejects a trailing-garbage number that parseInt would accept', () => {
        // parseInt('12abc') is 12; this must not be page 12.
        assert.equal(parsePageParam('12abc'), 1);
    });

    test('rejects non-integers and signed forms', () => {
        assert.equal(parsePageParam('abc'), 1);
        assert.equal(parsePageParam('2.5'), 1);
        assert.equal(parsePageParam('1e3'), 1);
        assert.equal(parsePageParam('-3'), 1);
        assert.equal(parsePageParam('+3'), 1);
    });

    test('rejects zero, which is not a 1-based page', () => {
        assert.equal(parsePageParam('0'), 1);
    });

    test('rejects a number too large to represent exactly', () => {
        assert.equal(parsePageParam('99999999999999999999'), 1);
    });

    test('rejects a repeated param rather than guessing which one won', () => {
        assert.equal(parsePageParam(['2', '3']), 1);
        assert.equal(parsePageParam([]), 1);
    });
});

describe('pageCountFor (FR-6)', () => {
    test('an empty result is still one page', () => {
        assert.equal(pageCountFor(0), 1);
    });

    test('a partial page counts as a page', () => {
        assert.equal(pageCountFor(1), 1);
        assert.equal(pageCountFor(49), 1);
    });

    test('an exactly full page does not spill into a second', () => {
        assert.equal(pageCountFor(50), 1);
        assert.equal(pageCountFor(100), 2);
    });

    test('one row past a full page starts the next', () => {
        assert.equal(pageCountFor(51), 2);
    });

    test('the default scope is 9 pages', () => {
        // 423 books in FR-3's default scope: 8 full pages plus 23.
        assert.equal(pageCountFor(423), 9);
    });

    test('nonsense totals degrade to one page', () => {
        assert.equal(pageCountFor(-5), 1);
        assert.equal(pageCountFor(Number.NaN), 1);
    });
});

describe('clampPage', () => {
    test('leaves a page that exists alone', () => {
        assert.equal(clampPage(1, 9), 1);
        assert.equal(clampPage(9, 9), 9);
    });

    test('pins a page past the end to the last one', () => {
        assert.equal(clampPage(10, 9), 9);
        assert.equal(clampPage(1000, 9), 9);
    });

    test('pins a page below the start to the first', () => {
        assert.equal(clampPage(0, 9), 1);
    });
});

describe('rangeFor', () => {
    test('page 1 starts at row 0 and is inclusive at both ends', () => {
        assert.deepEqual(rangeFor(1), [0, 49]);
    });

    test('page 2 begins where page 1 stopped, with no gap or overlap', () => {
        assert.deepEqual(rangeFor(2), [50, 99]);
    });

    test('the last page of the default scope', () => {
        assert.deepEqual(rangeFor(9), [400, 449]);
    });
});

describe('paginationItems (FR-6)', () => {
    test('a single page needs no elision', () => {
        assert.deepEqual(paginationItems(1, 1), [1]);
        assert.deepEqual(paginationItems(1, 2), [1, 2]);
    });

    test('the default scope, from the first page', () => {
        // 9 pages: first, a window of two ahead, then the last.
        assert.deepEqual(paginationItems(1, 9), [1, 2, 3, 'gap', 9]);
    });

    test('the default scope, from the last page', () => {
        assert.deepEqual(paginationItems(9, 9), [1, 'gap', 7, 8, 9]);
    });

    test('9 pages are few enough to show whole from the middle', () => {
        assert.deepEqual(paginationItems(5, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('a long run elides on both sides', () => {
        assert.deepEqual(paginationItems(25, 50), [
            1,
            'gap',
            23,
            24,
            25,
            26,
            27,
            'gap',
            50,
        ]);
    });

    test('a gap standing in for one page shows the page instead', () => {
        // 1 and 3 are both shown, so eliding "2" would cost the same width
        // as printing it.
        assert.deepEqual(paginationItems(5, 50)[1], 2);
    });
});

describe('pageQuery (FR-6)', () => {
    test('page 1 is the default and is left out', () => {
        assert.equal(pageQuery(1), '');
        assert.equal(pageQuery(1, {}), '');
    });

    test('later pages carry the param', () => {
        assert.equal(pageQuery(2), 'page=2');
    });

    test('other params survive, so Browse M2 filters keep working', () => {
        assert.equal(
            pageQuery(2, { category: 'book' }),
            'category=book&page=2',
        );
        assert.equal(pageQuery(1, { category: 'book' }), 'category=book');
    });

    test('a repeated param keeps every value', () => {
        assert.equal(
            pageQuery(2, { category: ['book', 'black_book'] }),
            'category=book&category=black_book&page=2',
        );
    });

    test('an incoming page param is replaced, never duplicated', () => {
        assert.equal(pageQuery(3, { page: '2' }), 'page=3');
    });

    test('an undefined value is dropped rather than stringified', () => {
        assert.equal(pageQuery(2, { category: undefined }), 'page=2');
    });
});

describe('filter vocabularies (FR-3)', () => {
    // Transcribed from the check constraints in
    // 20260914000000_book_import_schema.sql, not from the implementation: a
    // value missing here is a filter the reader cannot reach, and a value that
    // is not in the constraint is a control that always returns nothing.
    test('categories are the six book_category_valid enforces', () => {
        assert.deepEqual([...CATEGORIES].sort(), [
            'black_book',
            'book',
            'journal',
            'note',
            'skill_book',
            'treasure_map',
        ]);
    });

    test('sources are the five book_source_valid enforces', () => {
        assert.deepEqual([...SOURCES].sort(), [
            'base',
            'creation_club',
            'dawnguard',
            'dragonborn',
            'hearthfire',
        ]);
    });

    test('skills are Skyrim’s 18, spelled as the column stores them', () => {
        assert.equal(SKILLS.length, 18);
        assert.deepEqual([...SKILLS].sort(), [
            'Alchemy',
            'Alteration',
            'Archery',
            'Block',
            'Conjuration',
            'Destruction',
            'Enchanting',
            'Heavy Armor',
            'Illusion',
            'Light Armor',
            'Lockpicking',
            'One-Handed',
            'Pickpocket',
            'Restoration',
            'Smithing',
            'Sneak',
            'Speech',
            'Two-Handed',
        ]);
    });

    // The defaults have to be reachable through the controls, or the filter
    // panel cannot render the view the user arrives on.
    test('every default is offered as an option', () => {
        for (const category of DEFAULT_CATEGORIES) {
            assert.ok(CATEGORIES.includes(category), category);
        }
        for (const source of DEFAULT_SOURCES) {
            assert.ok(SOURCES.includes(source), source);
        }
    });
});

describe('parseAllowlistParam (FR-3, AC-10)', () => {
    const allowed = ['a', 'b', 'c'] as const;
    const fallback = ['a'] as const;

    test('reads a single value', () => {
        assert.deepEqual(parseAllowlistParam('b', allowed, fallback), ['b']);
    });

    test('reads a repeated param, which is how a checkbox group arrives', () => {
        assert.deepEqual(parseAllowlistParam(['b', 'c'], allowed, fallback), [
            'b',
            'c',
        ]);
    });

    test('returns values in allowlist order, not URL order', () => {
        assert.deepEqual(parseAllowlistParam(['c', 'a'], allowed, fallback), [
            'a',
            'c',
        ]);
    });

    test('dedupes a value repeated in the URL', () => {
        assert.deepEqual(
            parseAllowlistParam(['b', 'b', 'b'], allowed, fallback),
            ['b'],
        );
    });

    test('drops unknown values but keeps the recognised ones', () => {
        assert.deepEqual(
            parseAllowlistParam(['b', 'nope'], allowed, fallback),
            ['b'],
        );
    });

    // A GET form omits a checkbox group entirely when every box is unchecked,
    // so "none selected" and "no param" are indistinguishable by the time they
    // reach here. Defaults are the more useful reading of the pair: the other
    // renders an empty list with nothing to explain it.
    test('falls back when the param is absent, empty or all unknown', () => {
        assert.deepEqual(
            parseAllowlistParam(undefined, allowed, fallback),
            fallback,
        );
        assert.deepEqual(parseAllowlistParam('', allowed, fallback), fallback);
        assert.deepEqual(parseAllowlistParam([], allowed, fallback), fallback);
        assert.deepEqual(
            parseAllowlistParam('nope', allowed, fallback),
            fallback,
        );
    });

    test('tolerates surrounding whitespace', () => {
        assert.deepEqual(parseAllowlistParam('  b  ', allowed, fallback), [
            'b',
        ]);
    });
});

describe('parseFlagParam (FR-3, AC-10)', () => {
    test('reads the two real values', () => {
        assert.equal(parseFlagParam('true'), 'true');
        assert.equal(parseFlagParam('false'), 'false');
    });

    test('is case- and whitespace-insensitive', () => {
        assert.equal(parseFlagParam(' TRUE '), 'true');
    });

    test('falls back to any on anything else', () => {
        assert.equal(parseFlagParam(undefined), 'any');
        assert.equal(parseFlagParam(''), 'any');
        assert.equal(parseFlagParam('yes'), 'any');
        assert.equal(parseFlagParam('1'), 'any');
        assert.equal(parseFlagParam('any'), 'any');
    });

    // Same reasoning as parsePageParam: a single-valued control has no
    // non-arbitrary way to choose between two values.
    test('treats a repeated param as unusable', () => {
        assert.equal(parseFlagParam(['true', 'false']), 'any');
    });
});

describe('parseSkillParam (FR-3, AC-10)', () => {
    test('reads a skill exactly as spelled', () => {
        assert.equal(parseSkillParam('One-Handed'), 'One-Handed');
        assert.equal(parseSkillParam('Heavy Armor'), 'Heavy Armor');
    });

    // Canonicalised rather than merely accepted, so the value handed to the
    // query is the string the column actually stores.
    test('matches case-insensitively and returns the canonical spelling', () => {
        assert.equal(parseSkillParam('one-handed'), 'One-Handed');
        assert.equal(parseSkillParam('  SPEECH  '), 'Speech');
    });

    test('falls back to any skill on anything unrecognised', () => {
        assert.equal(parseSkillParam(undefined), null);
        assert.equal(parseSkillParam(''), null);
        assert.equal(parseSkillParam('Juggling'), null);
        assert.equal(parseSkillParam(['Sneak', 'Block']), null);
    });
});

describe('parseSearchParam (FR-9, AC-13)', () => {
    test('reads a term', () => {
        assert.equal(parseSearchParam('Dwemer'), 'Dwemer');
    });

    test('trims, since a stray space would narrow the match', () => {
        assert.equal(parseSearchParam('  Dwemer  '), 'Dwemer');
    });

    // An empty q must apply no predicate at all, not an empty ilike: `%%`
    // matches every row today and stops doing so the moment a title is null.
    test('reads an absent or blank term as no predicate', () => {
        assert.equal(parseSearchParam(undefined), null);
        assert.equal(parseSearchParam(''), null);
        assert.equal(parseSearchParam('   '), null);
    });

    test('treats a repeated param as unusable', () => {
        assert.equal(parseSearchParam(['a', 'b']), null);
    });

    // The cap sits above the longest title in the catalogue (93 characters,
    // measured), so slicing can never make a term match something the full
    // term would not -- anything longer already matches nothing. Dropping the
    // term instead would show the whole list, which reads as a working search.
    test('caps an over-long term above the longest title', () => {
        assert.ok(MAX_SEARCH_LENGTH > 93);
        const long = 'x'.repeat(MAX_SEARCH_LENGTH + 50);
        assert.equal(parseSearchParam(long)?.length, MAX_SEARCH_LENGTH);
    });
});

describe('escapeLike (FR-9, AC-13)', () => {
    test('leaves an ordinary term alone', () => {
        assert.equal(escapeLike('Dwemer'), 'Dwemer');
    });

    test('escapes the LIKE metacharacters', () => {
        assert.equal(escapeLike('100%'), '100\\%');
        assert.equal(escapeLike('a_b'), 'a\\_b');
    });

    // PostgREST rewrites `*` to `%` inside a like/ilike value before the
    // pattern reaches Postgres. Verified against the project: an unescaped
    // `%*%` returns all 1,207 books exactly as `%%` does, so a reader typing a
    // single asterisk would otherwise match the whole catalogue.
    test('escapes the asterisk PostgREST treats as a wildcard', () => {
        assert.equal(escapeLike('*'), '\\*');
        assert.equal(escapeLike('a*b'), 'a\\*b');
    });

    // Backslash first, or the escape character introduced for a later
    // metacharacter would itself be escaped.
    test('escapes a backslash so it cannot escape what follows it', () => {
        assert.equal(escapeLike('\\'), '\\\\');
        assert.equal(escapeLike('\\%'), '\\\\\\%');
    });
});

describe('parseFilters (FR-3, FR-9, R4)', () => {
    test('a bare /books is the default scope', () => {
        assert.deepEqual(parseFilters({}), DEFAULT_FILTERS);
    });

    test('reads every control from the query string', () => {
        assert.deepEqual(
            parseFilters({
                category: ['note', 'journal'],
                source: 'creation_club',
                skill: 'Sneak',
                read: 'false',
                collected: 'true',
                q: 'Dwemer',
            }),
            {
                categories: ['journal', 'note'],
                sources: ['creation_club'],
                skill: 'Sneak',
                read: 'false',
                collected: 'true',
                q: 'Dwemer',
            },
        );
    });

    // AC-10: a tampered param falls back to its default without erroring, and
    // without taking the rest of the query down with it.
    test('an invalid param falls back without disturbing the others', () => {
        assert.deepEqual(
            parseFilters({ category: 'bogus', skill: 'Juggling', q: 'Dwemer' }),
            { ...DEFAULT_FILTERS, q: 'Dwemer' },
        );
    });

    test('page is not a filter and is ignored here', () => {
        assert.deepEqual(parseFilters({ page: '4' }), DEFAULT_FILTERS);
    });
});

describe('isDefaultFilters (OQ-7)', () => {
    test('recognises the default scope', () => {
        assert.equal(isDefaultFilters(DEFAULT_FILTERS), true);
        assert.equal(isDefaultFilters(parseFilters({})), true);
    });

    // Order reflects how the URL was typed, not a difference in what is being
    // shown, so it must not make the reset link appear.
    test('ignores the order of an allowlist selection', () => {
        assert.equal(
            isDefaultFilters({
                ...DEFAULT_FILTERS,
                categories: ['book', 'black_book', 'skill_book'],
            }),
            true,
        );
    });

    test('spots every kind of narrowing', () => {
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, categories: ['book'] }),
            false,
        );
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, sources: ['base'] }),
            false,
        );
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, skill: 'Sneak' }),
            false,
        );
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, read: 'false' }),
            false,
        );
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, collected: 'true' }),
            false,
        );
        assert.equal(isDefaultFilters({ ...DEFAULT_FILTERS, q: 'a' }), false);
    });

    // A widening is still not the default view, even though it selects more.
    test('a widened selection is not the default either', () => {
        assert.equal(
            isDefaultFilters({ ...DEFAULT_FILTERS, categories: CATEGORIES }),
            false,
        );
    });
});

describe('filtersQuery (FR-3, AC-3)', () => {
    test('the default scope is a bare /books', () => {
        assert.equal(filtersQuery(DEFAULT_FILTERS), '');
    });

    test('omits an allowlist that matches its default', () => {
        assert.equal(
            filtersQuery({ ...DEFAULT_FILTERS, skill: 'Sneak' }),
            'skill=Sneak',
        );
    });

    test('writes a changed allowlist out in full', () => {
        assert.equal(
            filtersQuery({ ...DEFAULT_FILTERS, categories: ['note', 'book'] }),
            'category=note&category=book',
        );
    });

    test('writes the flags and the search term', () => {
        assert.equal(
            filtersQuery({
                ...DEFAULT_FILTERS,
                read: 'false',
                collected: 'true',
                q: 'Dwemer',
            }),
            'read=false&collected=true&q=Dwemer',
        );
    });

    // FR-3: changing a filter resets to page 1. Building the query from the
    // filter state alone is what makes that structural rather than a step
    // somebody has to remember, so there is nowhere for a page to survive.
    test('never carries a page', () => {
        assert.ok(
            !filtersQuery({ ...DEFAULT_FILTERS, q: 'a' }).includes('page'),
        );
    });

    test('escapes a term that would otherwise break the query string', () => {
        assert.equal(
            filtersQuery({ ...DEFAULT_FILTERS, q: 'a&b=c' }),
            'q=a%26b%3Dc',
        );
    });
});

describe('filters round-trip (AC-3, AC-13: a copied URL reproduces the view)', () => {
    // The property that makes a URL shareable: whatever filtersQuery writes,
    // parseFilters has to read back as the same state. Asserted over the
    // awkward cases rather than the tidy one, since that is where a param
    // name, an omitted default or an encoding would drift.
    const cases: Record<string, Parameters<typeof filtersQuery>[0]> = {
        default: DEFAULT_FILTERS,
        // In allowlist order, which is the only order parseFilters ever
        // produces -- the round trip holds up to that normalisation, and the
        // normalisation itself is asserted in parseAllowlistParam above.
        'narrowed categories': {
            ...DEFAULT_FILTERS,
            categories: ['journal', 'note'],
        },
        'widened sources': { ...DEFAULT_FILTERS, sources: SOURCES },
        'every control at once': {
            categories: ['treasure_map'],
            sources: ['creation_club'],
            skill: 'Heavy Armor',
            read: 'false',
            collected: 'true',
            q: 'The Book of the Dragonborn',
        },
        'a term with query-string punctuation': {
            ...DEFAULT_FILTERS,
            q: 'a&b=c?d#e+f',
        },
        'a term with LIKE metacharacters': {
            ...DEFAULT_FILTERS,
            q: '100% *_\\',
        },
    };

    // Rebuilt the way Next hands searchParams over: a bare string for a param
    // that appears once, an array only when it repeats. Collapsing every value
    // to an array instead would quietly exercise the repeated-param path, which
    // several of these parsers deliberately reject.
    function asSearchParams(query: string) {
        const parsed = new URLSearchParams(query);
        return Object.fromEntries(
            [...new Set(parsed.keys())].map((key) => {
                const values = parsed.getAll(key);
                return [key, values.length === 1 ? values[0] : values];
            }),
        );
    }

    for (const [name, filters] of Object.entries(cases)) {
        test(name, () => {
            assert.deepEqual(
                parseFilters(asSearchParams(filtersQuery(filters))),
                filters,
            );
        });
    }
});

/**
 * Tests for the UESP article URL builder.
 *
 * The expectations are transcribed from UESP's own search results, which Ben
 * checked by hand against the live site -- not captured from this function.
 * That distinction is the whole point here: an encoder can be confidently
 * wrong and still produce URLs that resolve, because MediaWiki redirects a
 * merely-valid encoding to its canonical one. Only the canonical form is
 * correct, and only the wiki can say what that is.
 *
 * The site refuses plain `curl` and disallows automated browsing, so these
 * cannot be re-derived from the network; re-verify by hand if the rule ever
 * changes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { uespUrl } from './uesp';

describe('uespUrl (FR-7)', () => {
    test('spaces become underscores and the namespace colon stays literal', () => {
        assert.equal(
            uespUrl('Skyrim:Oghma Infinium'),
            'https://en.uesp.net/wiki/Skyrim:Oghma_Infinium',
        );
    });

    // 389 of 1,207 titles. encodeURIComponent leaves the apostrophe bare,
    // which resolves but is not the URL UESP itself links to.
    test('an apostrophe is percent-encoded, parentheses are not', () => {
        assert.equal(
            uespUrl("Skyrim:Stranger's Final Instructions (pickpocket)"),
            'https://en.uesp.net/wiki/Skyrim:Stranger%27s_Final_Instructions_(pickpocket)',
        );
    });

    test('an ampersand is percent-encoded', () => {
        assert.equal(
            uespUrl('Skyrim:Reality & Other Falsehoods'),
            'https://en.uesp.net/wiki/Skyrim:Reality_%26_Other_Falsehoods',
        );
    });

    test('a question mark is percent-encoded, a second colon is not', () => {
        assert.equal(
            uespUrl('Skyrim:Nightingales: Fact or Fiction?'),
            'https://en.uesp.net/wiki/Skyrim:Nightingales:_Fact_or_Fiction%3F',
        );
    });

    test('double quotes are percent-encoded', () => {
        assert.equal(
            uespUrl('Skyrim:The "Madmen" of the Reach'),
            'https://en.uesp.net/wiki/Skyrim:The_%22Madmen%22_of_the_Reach',
        );
    });

    // The one that looks most like it should break: a slash inside a path
    // segment. MediaWiki keeps it literal.
    test('a forward slash stays literal', () => {
        assert.equal(
            uespUrl('Skyrim:The Alduin/Akatosh Dichotomy'),
            'https://en.uesp.net/wiki/Skyrim:The_Alduin/Akatosh_Dichotomy',
        );
    });

    test('commas and periods stay literal', () => {
        assert.equal(
            uespUrl('Skyrim:16 Accords of Madness, v. IX'),
            'https://en.uesp.net/wiki/Skyrim:16_Accords_of_Madness,_v._IX',
        );
    });

    // Not reachable from the UI -- the four titles carrying accents are all
    // is_obtainable = false, and that is not a user control (FR-3) -- but the
    // encoder should still be correct rather than merely unexercised.
    test('non-ASCII characters are UTF-8 percent-encoded', () => {
        assert.equal(
            uespUrl('Skyrim:Ä ö ü ß Ä Ö Ü'),
            'https://en.uesp.net/wiki/Skyrim:%C3%84_%C3%B6_%C3%BC_%C3%9F_%C3%84_%C3%96_%C3%9C',
        );
    });
});

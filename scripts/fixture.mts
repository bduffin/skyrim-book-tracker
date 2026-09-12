/**
 * Fixture loader for the M0 tests.
 *
 * Reads `__fixtures__/sample-dump.xml` and exposes each `<page>` by title. This
 * is deliberately a small regex reader rather than the real `sax` streamer:
 * M0 tests the pure functions, and pulling in the streaming dependency here
 * would couple them to M1's I/O path.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type FixturePage = {
    title: string;
    ns: number;
    pageId: number;
    wikitext: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(HERE, '__fixtures__', 'sample-dump.xml');

const XML_ENTITIES: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&', // last: decoding it first would corrupt the others
};

function decodeXml(text: string): string {
    let out = text;
    for (const [entity, char] of Object.entries(XML_ENTITIES)) {
        out = out.split(entity).join(char);
    }
    return out;
}

function tag(block: string, name: string): string | null {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
    return m ? m[1] : null;
}

let cached: FixturePage[] | null = null;

export function loadFixturePages(): FixturePage[] {
    if (cached) return cached;
    const xml = readFileSync(FIXTURE_PATH, 'utf8');
    const pages: FixturePage[] = [];

    for (const block of xml.split('<page>').slice(1)) {
        const body = block.split('</page>')[0];
        const title = tag(body, 'title');
        const ns = tag(body, 'ns');
        const text = tag(body, 'text');
        // <id> appears for both the page and the revision; the first is the page.
        const pageId = /<id>(\d+)<\/id>/.exec(body);
        if (title === null || ns === null || pageId === null) continue;
        pages.push({
            title: decodeXml(title),
            ns: Number(ns),
            pageId: Number(pageId[1]),
            wikitext: decodeXml(text ?? ''),
        });
    }

    cached = pages;
    return pages;
}

/** Looks up one fixture page by exact title, throwing if it is missing. */
export function fixture(title: string): FixturePage {
    const page = loadFixturePages().find((p) => p.title === title);
    if (!page) {
        throw new Error(
            `Fixture page not found: ${title}\nAvailable: ${loadFixturePages()
                .map((p) => p.title)
                .join(', ')}`,
        );
    }
    return page;
}

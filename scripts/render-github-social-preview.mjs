/**
 * Renders .github/social-preview.png, the GitHub repo's social preview: the card
 * shown when the repository is linked from Slack, LinkedIn, Discord and the
 * like. GitHub does not read it from the repo -- upload it by hand under
 * Settings -> General -> Social preview after re-rendering.
 *
 *   node scripts/render-github-social-preview.mjs
 *
 * The site's own identity, so the card matches the header and the favicon:
 * the BookCheckMark drawing (src/components/site-logo.tsx and
 * src/app/icon.svg), the frost-and-iron palette (src/app/globals.css), and
 * the two families src/app/fonts.ts self-hosts.
 *
 * Laid out with next/og's ImageResponse (Satori, then resvg) in Node, so no
 * browser is involved. Satori needs TTF/OTF at fixed weights, which next/font
 * does not keep, so the fonts are fetched from Google Fonts -- the source
 * next/font uses -- into memory on every run; nothing is saved. Needs network.
 *
 * Contrast on iron-900, measured: frost-50 13.69:1, frost-300 9.79:1,
 * gold-400 6.38:1 -- all clear of AA for text. gold-600 (3.77:1) draws only
 * the hairline ornament, never words.
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createElement as h } from 'react';

// next/og is CommonJS with no `exports` map, so ESM `import` cannot resolve
// the bare `next/og` subpath; require() can.
const { ImageResponse } = createRequire(import.meta.url)('next/og');

const WIDTH = 1280;
const HEIGHT = 640;
const OUT = fileURLToPath(
    new URL('../.github/social-preview.png', import.meta.url),
);

const COLORS = {
    iron900: '#1c2833',
    frost50: '#f2f5f7',
    frost300: '#c9d2da',
    gold400: '#c9a45a',
    gold600: '#9a7b3f',
};

/**
 * Each family and weight the card uses, as TTF. Google Fonts answers a
 * request without a browser's user agent with one TrueType file per weight,
 * which is the format Satori reads; checked rather than assumed, and the
 * script fails loudly if that ever changes instead of rendering a fallback
 * face.
 */
async function loadFonts() {
    const css = await fetch(
        'https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500&family=Jost:wght@400;500',
    ).then((response) => {
        if (!response.ok)
            throw new Error(`Google Fonts CSS: ${response.status}`);
        return response.text();
    });

    const faces = css
        .split('@font-face')
        .slice(1)
        .map((block) => ({
            name: block.match(/font-family: '([^']+)'/)?.[1],
            weight: Number(block.match(/font-weight: (\d+)/)?.[1]),
            url: block.match(/src: url\(([^)]+)\) format\('truetype'\)/)?.[1],
        }));
    if (faces.length !== 4 || faces.some((face) => !face.name || !face.url)) {
        throw new Error(
            'Expected four TrueType faces from Google Fonts; got:\n' +
                JSON.stringify(faces, null, 2),
        );
    }

    return Promise.all(
        faces.map(async ({ name, weight, url }) => ({
            name,
            weight,
            style: 'normal',
            data: await fetch(url).then((response) => {
                if (!response.ok)
                    throw new Error(`${name} ${weight}: ${response.status}`);
                return response.arrayBuffer();
            }),
        })),
    );
}

/** The BookCheckMark, cropped to its drawing like the header's copy. */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6.1 3.1 20.8 25.8" fill="none">
  <rect x="7" y="4" width="19" height="24" rx="1.5" stroke="${COLORS.frost50}" stroke-width="1.8"/>
  <path d="M10 4v24" stroke="${COLORS.frost50}" stroke-width="1.8"/>
  <path d="M13.5 16l3 3 6-7" stroke="${COLORS.gold400}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const serif = 'EB Garamond';
const sans = 'Jost';

/** The page title's ornament: a gold hairline with a diamond at its midpoint. */
function ornament() {
    const line = h('div', {
        style: { flex: 1, height: 1, backgroundColor: COLORS.gold600 },
    });
    return h(
        'div',
        {
            style: {
                display: 'flex',
                alignItems: 'center',
                width: 280,
                marginTop: 26,
                gap: 10,
            },
        },
        line,
        h('div', {
            style: {
                width: 8,
                height: 8,
                backgroundColor: COLORS.gold600,
                transform: 'rotate(45deg)',
            },
        }),
        line,
    );
}

function card() {
    return h(
        'div',
        {
            style: {
                width: WIDTH,
                height: HEIGHT,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: COLORS.iron900,
                color: COLORS.frost50,
                fontFamily: sans,
                position: 'relative',
            },
        },
        // The frame, inset like a book plate.
        h('div', {
            style: {
                position: 'absolute',
                top: 36,
                left: 36,
                right: 36,
                bottom: 36,
                border: `2px solid ${COLORS.gold400}`,
            },
        }),
        h('img', {
            src: `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`,
            width: 64,
            height: 79,
        }),
        h(
            'div',
            {
                style: {
                    marginTop: 22,
                    fontFamily: serif,
                    fontWeight: 500,
                    fontSize: 116,
                    lineHeight: 1,
                },
            },
            'Arcanaeum',
        ),
        // Spaced capitals, like the header's subtitle. Letter-spacing also
        // trails the last letter, which pulls the text off center; the same
        // amount of left padding puts it back.
        h(
            'div',
            {
                style: {
                    marginTop: 14,
                    fontWeight: 500,
                    fontSize: 25,
                    letterSpacing: '0.32em',
                    paddingLeft: '0.32em',
                    color: COLORS.gold400,
                },
            },
            'SKYRIM BOOK TRACKER',
        ),
        ornament(),
        h(
            'div',
            { style: { marginTop: 24, fontFamily: serif, fontSize: 34 } },
            'Track what you’ve read and collected across 1,200+ books',
        ),
        h(
            'div',
            { style: { marginTop: 40, fontSize: 21, color: COLORS.frost300 } },
            'Next.js · TypeScript · Supabase · Built with Claude Code',
        ),
        h(
            'div',
            {
                style: {
                    marginTop: 10,
                    fontWeight: 500,
                    fontSize: 22,
                    color: COLORS.gold400,
                },
            },
            'arcanaeum.app',
        ),
    );
}

const image = new ImageResponse(card(), {
    width: WIDTH,
    height: HEIGHT,
    fonts: await loadFonts(),
});
const png = Buffer.from(await image.arrayBuffer());
writeFileSync(OUT, png);
console.log(
    `.github/social-preview.png: ${WIDTH}x${HEIGHT}, ${Math.round(png.length / 1024)} KB` +
        ' (GitHub allows up to 1 MB)',
);

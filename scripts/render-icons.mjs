/**
 * Renders the PNG images from `src/app/icon.svg`, which is the single source
 * for the browser icons and the link-preview image:
 *
 *   src/app/icon.svg              the favicon itself, for browsers that take SVG
 *   src/app/icon.png              32x32, for browsers that do not
 *   src/app/apple-icon.png        180x180, for iOS "Add to Home Screen"
 *   src/app/opengraph-image.png   1200x630, shown when a link is shared
 *
 * Next.js picks all of them up by filename and emits their tags -- <link> for
 * the icons, og:image for the preview, made absolute by the root layout's
 * metadataBase; nothing else refers to them. Run this after any change to `icon.svg`:
 *
 *   node scripts/render-icons.mjs
 *
 * The header's `BookCheckMark` (src/components/site-logo.tsx) is the same
 * drawing as JSX and has to be edited by hand to match.
 *
 * Needs `sharp`, which Next installs as an *optional* dependency for image
 * optimization -- normally present, but not guaranteed, hence the check below.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let sharp;
try {
    ({ default: sharp } = await import('sharp'));
} catch {
    console.error(
        'This script needs `sharp`, which is not installed.\n' +
            '  Next normally brings it in as an optional dependency; if it ' +
            'is missing, add it with `yarn add --dev sharp`.',
    );
    process.exit(1);
}

const app = fileURLToPath(new URL('../src/app/', import.meta.url));
const source = readFileSync(`${app}icon.svg`, 'utf8');

/*
 * The drawing without its tile: the one <g> in icon.svg, taken whole so the
 * apple icon can place it on a background of its own. A regex, not an XML
 * parser, because the file is ours and has exactly one group; if that stops
 * being true, this fails loudly instead of rendering half a drawing.
 */
const groups = source.match(/<g\b[^>]*>([\s\S]*?)<\/g>/g) ?? [];
if (groups.length !== 1) {
    throw new Error(
        `Expected exactly one <g> in icon.svg (the drawing), found ${groups.length}.`,
    );
}
const drawing = groups[0].replace(/^<g\b[^>]*>|<\/g>$/g, '');

/*
 * 32x32: icon.svg as it is, rounded tile and all. Rendered at a high density
 * and then scaled down, so the result is antialiased rather than rasterized at
 * 1x, where the check's thin stroke goes ragged.
 */
await sharp(Buffer.from(source), { density: 1152 })
    .resize(32, 32)
    .png()
    .toFile(`${app}icon.png`);

/*
 * 180x180 for iOS: a full-bleed square with no transparency, because iOS
 * applies its own rounded mask and a pre-rounded tile would leave light
 * slivers inside it. The drawing is centered at about 62% of the height.
 */
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#1c2833"/>
  <g fill="none" transform="translate(90 90) scale(4.3) translate(-16.5 -16)">${drawing}</g>
</svg>`;
await sharp(Buffer.from(apple), { density: 288 })
    .resize(180, 180)
    .flatten({ background: '#1c2833' })
    .png()
    .toFile(`${app}apple-icon.png`);

/*
 * 1200x630 for link previews (Open Graph's recommended size): the drawing
 * alone, centered on the header's iron-900. No text -- a preview shows the
 * page's title and description beside the image, and the site's web fonts are
 * not available to sharp. The drawing is about 300px tall, under half the
 * height, so it survives the square crops some apps apply.
 */
const preview = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1c2833"/>
  <g fill="none" transform="translate(600 315) scale(11.6) translate(-16.5 -16)">${drawing}</g>
</svg>`;
await sharp(Buffer.from(preview))
    .flatten({ background: '#1c2833' })
    .png()
    .toFile(`${app}opengraph-image.png`);

for (const file of ['icon.png', 'apple-icon.png', 'opengraph-image.png']) {
    const { width, height, hasAlpha } = await sharp(`${app}${file}`).metadata();
    console.log(`src/app/${file}: ${width}x${height}, alpha: ${hasAlpha}`);
}

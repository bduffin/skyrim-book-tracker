/**
 * Email AC-7: every Auth email a public endpoint or a signed-in user can
 * trigger carries the code and no link (Email Decision 12), and the local
 * stack's `config.toml` actually uses these files.
 *
 * Read from disk rather than imported: the files are what the local stack
 * sends and what gets pasted into the hosted dashboard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const TEMPLATES = ['confirmation', 'magic_link', 'recovery', 'email_change'];

const config = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8');

/** One `[auth.email.template.<name>]` table from `config.toml`, or `null`. */
function templateTable(name: string): Record<string, string> | null {
    const header = `[auth.email.template.${name}]\n`;
    const start = config.indexOf(header);
    if (start === -1) return null;
    const body = config.slice(start + header.length).split(/\n\s*\n|\n\[/)[0];
    const table: Record<string, string> = {};
    for (const match of body.matchAll(/^(\w+)\s*=\s*"([^"]*)"$/gm)) {
        table[match[1]] = match[2];
    }
    return table;
}

for (const name of TEMPLATES) {
    describe(`the ${name} email`, () => {
        const table = templateTable(name);
        const html = readFileSync(
            join(ROOT, 'supabase/templates', `${name}.html`),
            'utf8',
        );

        test('is the one config.toml sends', () => {
            assert.ok(
                table,
                `config.toml has no [auth.email.template.${name}]`,
            );
            assert.equal(
                table.content_path,
                `./supabase/templates/${name}.html`,
            );
        });

        test('carries the code', () => {
            assert.match(html, /\{\{\s*\.Token\s*\}\}/);
        });

        // A link and a code spend one token, so a mail scanner following
        // the link would use up the code.
        test('carries no link, and nothing a link could be built from', () => {
            assert.doesNotMatch(html, /\.ConfirmationURL|\.TokenHash/);
            assert.doesNotMatch(html, /\.SiteURL|\.RedirectTo/);
            assert.doesNotMatch(html, /href|https?:/i);
        });

        // What a lock screen or an inbox preview shows.
        test('keeps the code out of the subject and the first line', () => {
            assert.ok(table?.subject, 'no subject');
            assert.doesNotMatch(table.subject, /\.Token/);
            const [firstLine] = html.trim().split('\n');
            assert.doesNotMatch(firstLine, /\.Token/);
        });

        test('never mentions passwords', () => {
            assert.doesNotMatch(html, /password/i);
            assert.doesNotMatch(table?.subject ?? '', /password/i);
        });
    });
}

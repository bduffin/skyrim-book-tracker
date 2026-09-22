/**
 * Database plumbing for the UESP import (Import M2).
 *
 * Everything here that can be pure IS pure, because the interesting failures
 * are decisions rather than I/O: which database a run is about to write to
 * (FR-14), and whether a chunk carries a repeated conflict key (FR-12). Those
 * are the parts worth testing without a server, so they take plain values and
 * return plain values; only `createImportClient` touches the network, and only
 * `promptForSecretKey` touches the terminal.
 *
 * See docs/specs/prd-import-uesp-books.md §12.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { LocationRow, MappedLocation } from './uesp-parse.mjs';

/** Upsert/RPC batch size (FR-12, FR-13). ~3 round trips for the 1,207 books. */
export const CHUNK_SIZE = 500;

export type Target = {
    url: string;
    host: string;
    isLocal: boolean;
};

/**
 * Hosts that mean "a database I can freely destroy".
 *
 * Matched on the parsed hostname, never on the raw URL: a substring test for
 * 'localhost' would happily accept `https://localhost.evil.com` and, worse,
 * `https://prod.example.com/?x=localhost`.
 */
export function isLocalHost(hostname: string): boolean {
    // `URL.hostname` KEEPS the brackets on an IPv6 literal, so `[::1]` arrives
    // bracketed; it also normalizes `[0:0:0:0:0:0:0:1]` down to `[::1]` for us.
    const host = hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1') return true;
    // 127.0.0.0/8 -- the whole loopback range, not just 127.0.0.1.
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Decides where this run is allowed to write (FR-14).
 *
 * The secret key bypasses RLS, so an accidental run against the hosted
 * project rewrites live data with no undo. Remote therefore requires saying so
 * out loud. The refusal happens HERE, before the dump is read, so a mistargeted
 * run costs a second rather than the ~30s of streaming that precedes the first
 * write -- and long before any credential is loaded.
 */
export function resolveTarget(rawUrl: string, allowRemote: boolean): Target {
    if (!rawUrl) {
        throw new Error(
            'No Supabase URL. Pass --url=<url> or set NEXT_PUBLIC_SUPABASE_URL ' +
                '(e.g. in .env.local). For the local stack: --url=http://127.0.0.1:54321',
        );
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Supabase URL is not a valid URL: ${rawUrl}`);
    }

    const isLocal = isLocalHost(parsed.hostname);
    if (!isLocal && !allowRemote) {
        throw new Error(
            `Refusing to write to the remote database at ${parsed.host}.\n` +
                '  The secret key bypasses row-level security, so this would rewrite live data.\n' +
                '  Re-run with --allow-remote if that is what you want, or point\n' +
                '  --url at the local stack (http://127.0.0.1:54321).',
        );
    }

    return { url: rawUrl, host: parsed.host, isLocal };
}

/**
 * Collapses rows sharing a conflict key, keeping the last (FR-12).
 *
 * Postgres raises `ON CONFLICT DO UPDATE command cannot affect row a second
 * time` when one statement touches the same key twice, which would abort the
 * whole chunk. Deduping happens across the FULL set before chunking, not per
 * chunk: two copies split across chunk boundaries would not raise, so a
 * per-chunk dedupe would report a collapsed count that depends on batch size.
 *
 * `uesp_page_id` is unique by construction, so a non-zero count here means the
 * dump yielded the same page twice -- worth reporting (FR-17), not fatal.
 */
export function dedupeByKey<T, K extends keyof T>(
    rows: readonly T[],
    key: K,
): { rows: T[]; collapsed: number } {
    const byKey = new Map<T[K], T>();
    for (const row of rows) byKey.set(row[key], row);
    return { rows: [...byKey.values()], collapsed: rows.length - byKey.size };
}

export function chunk<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
    if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

/**
 * Reads the secret key from the terminal without echoing it (FR-16).
 *
 * Raw mode, so nothing is drawn for the pasted characters -- not even
 * asterisks, whose count leaks the key length. The prompt goes to stderr so it
 * never lands in a redirected report. Raw mode also disables SIGINT, so Ctrl-C
 * is handled by hand; without that, a user who changed their mind would be
 * stuck with a terminal whose echo is still off.
 */
export function promptForSecretKey(
    label = 'Supabase secret key (input hidden): ',
): Promise<string> {
    const { stdin, stderr } = process;
    if (!stdin.isTTY) {
        return Promise.reject(
            new Error(
                'SUPABASE_SECRET_KEY is not set and stdin is not a terminal, so it\n' +
                    '  cannot be prompted for. Set it in the environment for non-interactive\n' +
                    '  runs, or use --dry-run, which needs no credentials.',
            ),
        );
    }

    stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    return new Promise<string>((resolve, reject) => {
        let typed = '';
        const done = (finish: () => void) => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            stderr.write('\n');
            finish();
        };
        const onData = (rawBatch: string) => {
            // Bracketed paste: terminals wrap pasted text in ESC[200~ … ESC[201~
            // when the mode is left enabled. The ESC is dropped as a control
            // character below, which would otherwise leave a literal "[200~"
            // buried in the key -- and a key that is wrong by five characters
            // fails as a 401 that says nothing about why.
            const batch = rawBatch.replace(/\u001b\[20[01]~/g, '');
            for (const ch of batch) {
                if (ch === '\r' || ch === '\n') {
                    return done(() => resolve(typed));
                }
                if (ch === '\u0003') {
                    // Ctrl-C: raw mode swallowed the signal, so exit
                    // deliberately or the user cannot back out.
                    return done(() => reject(new Error('cancelled')));
                }
                if (ch === '\u0004') {
                    // Ctrl-D, matching every shell: submit what has been typed,
                    // or cancel when there is nothing to submit.
                    return typed
                        ? done(() => resolve(typed))
                        : done(() => reject(new Error('cancelled')));
                }
                if (ch === '\u007f' || ch === '\b') {
                    typed = typed.slice(0, -1);
                    continue;
                }
                // Drop any other control character rather than letting it into
                // the key. `.trim()` would not remove it -- it is not
                // whitespace -- so it would surface as an opaque 401 much later.
                if (ch < '\u0020') continue;
                typed += ch;
            }
        };
        stdin.on('data', onData);
    });
}

/**
 * Where the secret key comes from, in order (FR-16).
 *
 * The environment wins so that local runs and any future CI need no
 * interaction, but `--prompt-key` overrides it -- necessary because
 * `.env.local` holds ONE key while `--url` can point at either database, and a
 * local key sent to the hosted project (or the reverse) fails as an opaque 401.
 *
 * Both arguments are injectable so the precedence is testable without a TTY.
 */
export async function resolveSecretKey(
    options: { promptKey: boolean },
    env: Record<string, string | undefined> = process.env,
    prompt: () => Promise<string> = promptForSecretKey,
): Promise<string> {
    const fromEnv = env['SUPABASE_SECRET_KEY'];
    const secret = !options.promptKey && fromEnv ? fromEnv : await prompt();

    if (!secret.trim()) throw new Error('No secret key given.');
    // A pasted publishable key would not bypass RLS, and would surface much
    // later as a confusing row-level-security denial rather than a bad key.
    if (secret.startsWith('sb_publishable_')) {
        throw new Error(
            'That is the publishable key, not the secret key. The import needs the\n' +
                '  secret key (sb_secret_...), which bypasses RLS.',
        );
    }
    return secret.trim();
}

/**
 * Builds the writing client (FR-16).
 *
 * Takes the key rather than reading the environment itself, so that acquiring
 * the credential (which may block on a human) is separable from connecting.
 * Constructed only on the write path, never at module scope: `--dry-run` must
 * run with no credentials at all (FR-15, AC-8), and importing this module for
 * tests must not need an environment. Session persistence is off -- there is no
 * user here, and a script that wrote a token file would be a surprise.
 */
export function createImportClient(
    target: Target,
    secretKey: string,
): SupabaseClient {
    return createClient(target.url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

/**
 * Turns a failed first contact into a sentence about what to change (FR-1).
 *
 * Pure, so every branch is testable without a server. PostgREST reports these
 * as codes and low-level strings -- "Expected 3 parts in JWT; got 1" is what a
 * mistyped key actually produces, which says nothing about the key being the
 * thing to fix.
 */
export function describeConnectionError(
    error: { message?: string; code?: string; hint?: string | null },
    target: Target,
): string {
    const message = error.message ?? '';
    const code = error.code ?? '';

    if (/JWT|jwt|invalid.*(api|key|token)|Unauthorized/i.test(message)) {
        return (
            `The secret key was rejected by ${target.host}.\n` +
            `  Check it is the SECRET key (sb_secret_...) for THAT project -- keys are\n` +
            `  per-project, so the local stack's key is not valid against the hosted one\n` +
            '  and vice versa. `supabase status` prints the local one; the dashboard\n' +
            '  (Project Settings -> API Keys) has the hosted one.'
        );
    }
    if (code === '42501' || /permission denied/i.test(message)) {
        return (
            `The key connected to ${target.host} but lacks the privileges the import needs.\n` +
            '  This is what a publishable key looks like at this point: it authenticates\n' +
            '  fine, then cannot write. The import needs the secret key, which maps to\n' +
            '  service_role and bypasses RLS.'
        );
    }
    if (code === 'PGRST202' || /Could not find the function/i.test(message)) {
        return (
            `${target.host} has no replace_book_locations function, so the schema\n` +
            '  migration has not been applied there. Run `supabase db push --linked`\n' +
            '  (hosted) or `supabase start` / `supabase migration up --local` (local).'
        );
    }
    return `Could not reach ${target.host}: ${message}${code ? ` [${code}]` : ''}`;
}

/**
 * Proves the credential works BEFORE the ~34s streaming pass (FR-16).
 *
 * `replace_book_locations([])` is an unusually good probe: EXECUTE on it is
 * granted to `service_role` alone, and an empty payload is a verified no-op
 * (array_agg over no rows yields NULL, so `= any(NULL)` deletes nothing). One
 * round trip therefore establishes that the key is valid, that it carries the
 * privilege the import needs, and that the migration has been applied -- the
 * three things that otherwise surface 34 seconds later as a stack of unrelated
 * error messages.
 */
export async function verifyCredentials(
    client: SupabaseClient,
    target: Target,
): Promise<void> {
    const { error } = await client.rpc('replace_book_locations', {
        p_books: [],
    });
    if (error) throw new Error(describeConnectionError(error, target));
}

/**
 * Turns the flat location list into one entry per book (FR-13).
 *
 * Driven by `pageIds`, not by the locations: a book with NO locations must
 * still appear, carrying an empty array. That empty array is what clears stale
 * rows for a book whose `loc` was removed upstream (AC-4a) -- iterating the
 * locations instead would silently omit those ~157 books and leave their old
 * rows in place forever.
 */
export function groupLocations(
    pageIds: readonly number[],
    locations: readonly MappedLocation[],
): { uespPageId: number; locations: LocationRow[] }[] {
    const byPage = new Map<number, LocationRow[]>();
    for (const id of pageIds) byPage.set(id, []);
    for (const loc of locations) {
        // A location for an unknown page would be a bug upstream; drop it
        // rather than inventing a book entry the upsert never created.
        byPage.get(loc.uespPageId)?.push({
            location_name: loc.location_name,
            location_type: loc.location_type,
            notes: loc.notes,
        });
    }
    return [...byPage].map(([uespPageId, locations]) => ({
        uespPageId,
        locations,
    }));
}

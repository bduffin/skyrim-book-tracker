/**
 * Database plumbing for the UESP import (Import M2).
 *
 * Everything here that can be pure IS pure, because the interesting failures
 * are decisions rather than I/O: which database a run is about to write to
 * (FR-14), and whether a chunk carries a repeated conflict key (FR-12). Those
 * are the parts worth testing without a server, so they take plain values and
 * return plain values; only `createImportClient` touches the network.
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
function isLocalHost(hostname: string): boolean {
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
 * Builds the writing client (FR-16).
 *
 * Called only on the write path, never at module scope: `--dry-run` must run
 * with no credentials at all (FR-15, AC-8), and importing this module for tests
 * must not need an environment. Session persistence is off -- there is no user
 * here, and a script that wrote a token file would be a surprise.
 */
export function createImportClient(target: Target): SupabaseClient {
    const secret = process.env['SUPABASE_SECRET_KEY'];
    if (!secret) {
        throw new Error(
            'SUPABASE_SECRET_KEY is not set. It is read from .env.local via\n' +
                '  --env-file-if-exists; `supabase status` prints the local one.\n' +
                '  Use --dry-run to run without any credentials.',
        );
    }
    return createClient(target.url, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
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

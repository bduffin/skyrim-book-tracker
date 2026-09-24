/**
 * Database tests for Browse M2's read/collected filters (FR-3).
 *
 * These need real Postgres and real row-level security. A mocked PostgREST
 * would prove only that the mock agrees with whatever this code already does,
 * and the thing actually worth gating on is the opposite: that PostgREST's
 * join semantics mean what the query assumes. A filter on a LEFT-joined embed
 * narrows the embedded rows and leaves every parent in place, so
 * `user_book.is_read=eq.false` returns the whole catalog rather than the unread
 * part of it -- a bug that looks like a working filter until somebody marks a
 * book read.
 *
 * Local stack only, guarded by the importer's own `isLocalHost` rather than by
 * a well-aimed environment variable: this creates a user and writes rows, and
 * the secret key bypasses RLS.
 *
 * Run with `yarn test:db`. Kept out of `yarn test`, which stays fast and needs
 * no Docker.
 *
 * The fixtures are self-contained: the test inserts its own books rather than
 * assuming the UESP catalog has been imported, so it passes on a stack that has
 * only had `supabase start` run against it. Counts are asserted as deltas from
 * a measured baseline for the same reason -- what matters is which books the
 * filters include, not how many happen to be in the table.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { applyFlagFilters, flagEmbed } from '../../src/features/books/query.js';
import {
    DEFAULT_CATEGORIES,
    DEFAULT_SOURCES,
    type FlagFilter,
} from '../../src/features/books/scope.js';

import { localStack } from './lib/stack.mjs';

/** `uesp_page_id` is NOT NULL and unique; real pages are far below this. */
const FIXTURE_PAGE_ID_BASE = 990_000_000;

const EMAIL = 'browse-m2-flag-filters@example.test';
const PASSWORD = 'correct-horse-battery-staple';

/**
 * Counts books the way `getBooksPage` does, through the same `flagEmbed` and
 * `applyFlagFilters` the app calls. The base scope is FR-3's defaults, which
 * is not what these tests are about -- the flags are.
 */
async function countFor(
    supabase: SupabaseClient,
    read: FlagFilter,
    collected: FlagFilter,
): Promise<number> {
    const query = supabase
        .from('book')
        .select(`id, title${flagEmbed(read, collected)}`, {
            count: 'exact',
            head: true,
        })
        .eq('is_obtainable', true)
        .in('category', [...DEFAULT_CATEGORIES])
        .in('source', [...DEFAULT_SOURCES]);

    const { count, error } = await applyFlagFilters(query, read, collected);
    if (error) throw new Error(`${read}/${collected}: ${error.message}`);
    return count ?? 0;
}

describe('read/collected filters against the database (FR-3)', () => {
    let admin: SupabaseClient;
    let viewer: SupabaseClient;
    let userId: string;
    let bookIds: string[] = [];

    /** Books in the default scope with no `user_book` row for this viewer. */
    let untouched = 0;

    before(async () => {
        const stack = localStack();
        admin = createClient(stack.url, stack.secretKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        // Measured before the fixtures land, so the assertions below hold
        // whether or not the UESP catalog has been imported locally.
        const baseline = await countFor(admin, 'any', 'any');

        const fixtures = [
            'Browse M2 fixture: read and collected',
            'Browse M2 fixture: read only',
            'Browse M2 fixture: collected only',
        ].map((title, i) => ({
            title,
            uesp_title: title,
            uesp_page_id: FIXTURE_PAGE_ID_BASE + i,
            category: 'book',
            source: 'base',
            is_obtainable: true,
        }));

        const { data: inserted, error: insertError } = await admin
            .from('book')
            .insert(fixtures)
            .select('id, uesp_page_id');
        if (insertError) throw insertError;

        // Ordered by uesp_page_id so A/B/C below match the titles above;
        // insert() does not promise to return rows in the order given.
        bookIds = inserted!
            .sort((a, b) => a.uesp_page_id - b.uesp_page_id)
            .map((row) => row.id);
        const [A, B, C] = bookIds;

        const { data: created, error: userError } =
            await admin.auth.admin.createUser({
                email: EMAIL,
                password: PASSWORD,
                email_confirm: true,
            });
        if (userError) throw userError;
        userId = created.user!.id;

        const { error: trackError } = await admin.from('user_book').insert([
            { user_id: userId, book_id: A, is_read: true, is_collected: true },
            { user_id: userId, book_id: B, is_read: true, is_collected: false },
            { user_id: userId, book_id: C, is_read: false, is_collected: true },
        ]);
        if (trackError) throw trackError;

        // All three fixtures are tracked, so the untouched set is unchanged
        // from the baseline -- which is what `read=false, collected=false`
        // must return.
        untouched = baseline;

        viewer = createClient(stack.url, stack.publishableKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: signInError } = await viewer.auth.signInWithPassword({
            email: EMAIL,
            password: PASSWORD,
        });
        if (signInError) throw signInError;
    });

    after(async () => {
        // Deleting the books cascades to user_book (on delete cascade).
        if (bookIds.length) await admin.from('book').delete().in('id', bookIds);
        if (userId) await admin.auth.admin.deleteUser(userId);
    });

    test('no flag filter returns the whole default scope', async () => {
        assert.equal(await countFor(viewer, 'any', 'any'), untouched + 3);
    });

    test('read=true returns only books with a read row', async () => {
        assert.equal(await countFor(viewer, 'true', 'any'), 2);
    });

    // The one an embedded filter gets wrong: a LEFT-joined
    // `user_book.is_read=eq.false` leaves every parent in place, so this would
    // return untouched + 3 instead of excluding the two read books.
    test('read=false excludes read books, including untracked ones', async () => {
        assert.equal(await countFor(viewer, 'false', 'any'), untouched + 1);
    });

    test('collected=true returns only books with a collected row', async () => {
        assert.equal(await countFor(viewer, 'any', 'true'), 2);
    });

    test('collected=false excludes collected books', async () => {
        assert.equal(await countFor(viewer, 'any', 'false'), untouched + 1);
    });

    test('the flags combine independently', async () => {
        assert.equal(await countFor(viewer, 'true', 'true'), 1);
        assert.equal(await countFor(viewer, 'true', 'false'), 1);
        assert.equal(await countFor(viewer, 'false', 'true'), 1);
    });

    // Both false means no row at all. Expressed as an anti-join over either
    // flag rather than over row existence, so it does not lean on
    // user_book_touched to be correct.
    test('read=false and collected=false returns only untouched books', async () => {
        assert.equal(await countFor(viewer, 'false', 'false'), untouched);
    });

    // FR-2: an anonymous visitor sees every book as untouched. RLS is what
    // makes this true -- user_book_select_own admits no rows without a session
    // -- so a policy that leaked would show up here as a non-zero read count.
    test('a signed-out visitor has read nothing and collected nothing', async () => {
        const stack = localStack();
        const anon = createClient(stack.url, stack.publishableKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        assert.equal(await countFor(anon, 'true', 'any'), 0);
        assert.equal(await countFor(anon, 'any', 'true'), 0);
        assert.equal(await countFor(anon, 'false', 'false'), untouched + 3);
    });
});

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

import {
    applyFlagFilters,
    flagEmbed,
    readViewerFlags,
    resolveFlagFilters,
    VIEWER_FLAGS_EMBED,
    withViewerFlags,
    type ViewerFlagsEmbed,
} from '../../src/features/books/query.js';
import {
    DEFAULT_CATEGORIES,
    DEFAULT_SOURCES,
    type FlagFilter,
} from '../../src/features/books/scope.js';

import { createSignedInUser, localStack } from './lib/stack.mjs';

/** `uesp_page_id` is NOT NULL and unique; real pages are far below this. */
const FIXTURE_PAGE_ID_BASE = 990_000_000;

const EMAIL = 'browse-m2-flag-filters@example.test';
const OTHER_EMAIL = 'browse-m3-flag-display-other@example.test';

/**
 * Counts books the way `getBooksPage` does, through the same
 * `resolveFlagFilters`, `flagEmbed` and `applyFlagFilters` the app calls. The
 * base scope is FR-3's defaults, which is not what these tests are about --
 * the flags are.
 */
async function countFor(
    supabase: SupabaseClient,
    viewerId: string | null,
    requestedRead: FlagFilter,
    requestedCollected: FlagFilter,
): Promise<number> {
    const flags = resolveFlagFilters(
        requestedRead,
        requestedCollected,
        viewerId,
    );
    if (flags === null) return 0;
    const { read, collected } = flags;

    const query = supabase
        .from('book')
        .select(`id, title${flagEmbed(read, collected)}`, {
            count: 'exact',
            head: true,
        })
        .eq('is_obtainable', true)
        .in('category', [...DEFAULT_CATEGORIES])
        .in('source', [...DEFAULT_SOURCES]);

    const { count, error } = await applyFlagFilters(
        query,
        read,
        collected,
        viewerId,
    );
    if (error) throw new Error(`${read}/${collected}: ${error.message}`);
    return count ?? 0;
}

type Shown = { isRead: boolean; isCollected: boolean };

/**
 * The flags each of `bookIds` displays under a pair of filters, built the way
 * `getBooksPage` builds its page of rows: `flagEmbed` and `applyFlagFilters`
 * for the filters, `VIEWER_FLAGS_EMBED` and `withViewerFlags` for the display.
 * Books the filters exclude are absent from the result.
 */
async function shownFor(
    supabase: SupabaseClient,
    viewerId: string,
    bookIds: string[],
    read: FlagFilter,
    collected: FlagFilter,
): Promise<Map<string, Shown>> {
    // Annotated as a plain string, as data.ts's is. Passed inline, the
    // template infers as a template-literal type, which supabase-js's select
    // parser tries to turn into a row type, and tsc gives up (TS2589).
    const select: string = `id${flagEmbed(read, collected)}${VIEWER_FLAGS_EMBED}`;
    const query = withViewerFlags(
        supabase.from('book').select(select).in('id', bookIds),
        viewerId,
    );

    const { data, error } = await applyFlagFilters(
        query,
        read,
        collected,
        viewerId,
    );
    if (error) throw new Error(`${read}/${collected}: ${error.message}`);

    const rows = data as unknown as {
        id: string;
        viewer_flags: ViewerFlagsEmbed;
    }[];
    return new Map(
        rows.map((row) => [row.id, readViewerFlags(row.viewer_flags)]),
    );
}

describe('read/collected filters against the database (FR-3)', () => {
    let admin: SupabaseClient;
    let viewer: SupabaseClient;
    let userId: string;
    let otherUserId: string;
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
        const baseline = await countFor(admin, null, 'any', 'any');

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

        ({ userId, client: viewer } = await createSignedInUser(
            stack,
            admin,
            EMAIL,
        ));

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

        // A second user with the opposite flags on B and C, and no row on A.
        // Invisible to the viewer under today's RLS; the display tests below
        // read through the admin client, which is not.
        const { data: other, error: otherError } =
            await admin.auth.admin.createUser({
                email: OTHER_EMAIL,
                email_confirm: true,
            });
        if (otherError) throw otherError;
        otherUserId = other.user!.id;

        const { error: otherTrackError } = await admin
            .from('user_book')
            .insert([
                {
                    user_id: otherUserId,
                    book_id: B,
                    is_read: false,
                    is_collected: true,
                },
                {
                    user_id: otherUserId,
                    book_id: C,
                    is_read: true,
                    is_collected: false,
                },
            ]);
        if (otherTrackError) throw otherTrackError;
    });

    after(async () => {
        // Deleting the books cascades to user_book (on delete cascade).
        if (bookIds.length) await admin.from('book').delete().in('id', bookIds);
        if (userId) await admin.auth.admin.deleteUser(userId);
        if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
    });

    test('no flag filter returns the whole default scope', async () => {
        assert.equal(
            await countFor(viewer, userId, 'any', 'any'),
            untouched + 3,
        );
    });

    test('read=true returns only books with a read row', async () => {
        assert.equal(await countFor(viewer, userId, 'true', 'any'), 2);
    });

    // The one an embedded filter gets wrong: a LEFT-joined
    // `user_book.is_read=eq.false` leaves every parent in place, so this would
    // return untouched + 3 instead of excluding the two read books.
    test('read=false excludes read books, including untracked ones', async () => {
        assert.equal(
            await countFor(viewer, userId, 'false', 'any'),
            untouched + 1,
        );
    });

    test('collected=true returns only books with a collected row', async () => {
        assert.equal(await countFor(viewer, userId, 'any', 'true'), 2);
    });

    test('collected=false excludes collected books', async () => {
        assert.equal(
            await countFor(viewer, userId, 'any', 'false'),
            untouched + 1,
        );
    });

    test('the flags combine independently', async () => {
        assert.equal(await countFor(viewer, userId, 'true', 'true'), 1);
        assert.equal(await countFor(viewer, userId, 'true', 'false'), 1);
        assert.equal(await countFor(viewer, userId, 'false', 'true'), 1);
    });

    // Both false means no row at all. Expressed as an anti-join over either
    // flag rather than over row existence, so it does not lean on
    // user_book_touched to be correct.
    test('read=false and collected=false returns only untouched books', async () => {
        assert.equal(
            await countFor(viewer, userId, 'false', 'false'),
            untouched,
        );
    });

    // FR-2: an anonymous visitor sees every book as untouched. Decided by
    // resolveFlagFilters without asking the database, so this holds whatever
    // RLS lets anon read; that anon can read no user_book rows today is
    // asserted in rls.test.mts instead.
    test('a signed-out visitor has read nothing and collected nothing', async () => {
        const stack = localStack();
        const anon = createClient(stack.url, stack.publishableKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        assert.equal(await countFor(anon, null, 'true', 'any'), 0);
        assert.equal(await countFor(anon, null, 'any', 'true'), 0);
        assert.equal(
            await countFor(anon, null, 'false', 'false'),
            untouched + 3,
        );
    });

    // FR-10 will let anyone read a public user's user_book rows, and then RLS
    // alone no longer confines the filtering embed to the viewer. The admin
    // client bypasses RLS the same way, and the other user's flags on B and C
    // are the opposite of the viewer's, so an unscoped embed gets every one of
    // these counts wrong: read=true would count C, which only the other user
    // has read, and read=false would drop it.
    test('the filters count only the viewer’s own rows, even where RLS would admit others', async () => {
        assert.equal(await countFor(admin, userId, 'true', 'any'), 2);
        assert.equal(
            await countFor(admin, userId, 'false', 'any'),
            untouched + 1,
        );
        assert.equal(await countFor(admin, userId, 'any', 'true'), 2);
        assert.equal(
            await countFor(admin, userId, 'any', 'false'),
            untouched + 1,
        );
    });

    describe('each row displays the viewer’s own flags (FR-1)', () => {
        const expected = () =>
            new Map<string, Shown>([
                [bookIds[0], { isRead: true, isCollected: true }],
                [bookIds[1], { isRead: true, isCollected: false }],
                [bookIds[2], { isRead: false, isCollected: true }],
            ]);

        test('with no flag filter', async () => {
            assert.deepEqual(
                await shownFor(viewer, userId, bookIds, 'any', 'any'),
                expected(),
            );
        });

        // The case the filtering embed gets wrong. Its anti-join prefilters
        // the embed down to read rows, so the collected-only book's row is
        // filtered out of it and reading flags off it would show that book
        // as not collected.
        test('under read=false, a collected book still shows collected', async () => {
            assert.deepEqual(
                await shownFor(viewer, userId, bookIds, 'false', 'any'),
                new Map([[bookIds[2], { isRead: false, isCollected: true }]]),
            );
        });

        test('under collected=false, a read book still shows read', async () => {
            assert.deepEqual(
                await shownFor(viewer, userId, bookIds, 'any', 'false'),
                new Map([[bookIds[1], { isRead: true, isCollected: false }]]),
            );
        });

        test('under an inner-joined filter, both flags still show', async () => {
            assert.deepEqual(
                await shownFor(viewer, userId, bookIds, 'true', 'any'),
                new Map([
                    [bookIds[0], { isRead: true, isCollected: true }],
                    [bookIds[1], { isRead: true, isCollected: false }],
                ]),
            );
        });

        // FR-10 will let anyone read a public user's user_book rows, and then
        // RLS alone no longer confines the embed to the viewer. The admin
        // client bypasses RLS the same way, so this is that future today:
        // withViewerFlags must be what keeps each user's flags off the other's
        // rows.
        //
        // Checked from both sides, because the first side alone can pass by
        // luck: an unscoped embed on B or C holds both users' rows, and
        // readViewerFlags takes the first, which was the viewer's on every run
        // measured. Book A cannot hide it -- only the viewer has a row there,
        // so an unscoped embed shows it to the other user as read and collected.
        test('another user’s rows never display, even where RLS would admit them', async () => {
            assert.deepEqual(
                await shownFor(admin, userId, bookIds, 'any', 'any'),
                expected(),
            );
            assert.deepEqual(
                await shownFor(admin, otherUserId, bookIds, 'any', 'any'),
                new Map([
                    [bookIds[0], { isRead: false, isCollected: false }],
                    [bookIds[1], { isRead: false, isCollected: true }],
                    [bookIds[2], { isRead: true, isCollected: false }],
                ]),
            );
        });

        test('a viewer with no rows sees every book untouched', async () => {
            const untouchedFlags = { isRead: false, isCollected: false };
            assert.deepEqual(
                await shownFor(
                    admin,
                    crypto.randomUUID(),
                    bookIds,
                    'any',
                    'any',
                ),
                new Map(bookIds.map((id) => [id, untouchedFlags])),
            );
        });
    });
});

/**
 * Database tests for the progress summary's counts (FR-5, MI1).
 *
 * The property worth gating on is that the collected and read counts are
 * scoped exactly like the total. Each fixture outside the default scope is
 * one way a numerator could outgrow its denominator: an excluded category, an
 * excluded source, an unobtainable book. Each is marked both read and
 * collected, so leaking any of them into a count shows up as a wrong number.
 *
 * Counted through the same builders `getProgress` uses, against the local
 * stack only (`tests/db/lib/stack.mts`). The total is asserted as a delta
 * from a baseline measured before the fixtures land, so this passes whether or
 * not the UESP catalog has been imported locally.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
    flagCountQuery,
    totalCountQuery,
} from '../../src/features/collection/progress.js';
import { markedBooksQuery } from '../../src/features/collection/marked.js';
import {
    readViewerFlags,
    type ViewerFlagsEmbed,
} from '../../src/features/books/query.js';

import { adminClient, createSignedInUser, localStack } from './lib/stack.mjs';

/** Offset from the other test files' bases; see `set-book-flags.test.mts`. */
const FIXTURE_PAGE_ID_BASE = 990_000_300;

type Fixture = {
    key: string;
    category: string;
    source: string;
    is_obtainable: boolean;
};

/** In the default scope: category `book`, source `base`, obtainable. */
const inScope = (key: string): Fixture => ({
    key,
    category: 'book',
    source: 'base',
    is_obtainable: true,
});

const FIXTURES: Fixture[] = [
    inScope('read-and-collected'),
    inScope('read-only'),
    inScope('collected-only'),
    inScope('only-the-other-user-tracks'),
    { ...inScope('excluded-category'), category: 'note' },
    { ...inScope('excluded-source'), source: 'creation_club' },
    { ...inScope('unobtainable'), is_obtainable: false },
];

async function counted(
    query: PromiseLike<{ count: number | null; error: unknown }>,
) {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
}

describe('progress counts (FR-5)', () => {
    let admin: SupabaseClient;
    let viewer: { userId: string; client: SupabaseClient };
    let other: { userId: string; client: SupabaseClient };
    let baselineTotal = 0;
    /** Fixture book ids by key, for the marked-list tests. */
    const bookIds = new Map<string, string>();

    before(async () => {
        const stack = localStack();
        admin = adminClient(stack);

        // Measured before the fixtures land, so the total's assertion holds
        // whether or not the UESP catalog has been imported.
        baselineTotal = await counted(totalCountQuery(admin));

        const { data: books, error: bookError } = await admin
            .from('book')
            .insert(
                FIXTURES.map((fixture, i) => ({
                    title: `Browse M3 progress fixture: ${fixture.key}`,
                    uesp_title: `Browse M3 progress fixture: ${fixture.key}`,
                    uesp_page_id: FIXTURE_PAGE_ID_BASE + i,
                    category: fixture.category,
                    source: fixture.source,
                    is_obtainable: fixture.is_obtainable,
                })),
            )
            .select('id, uesp_page_id');
        if (bookError) throw bookError;
        for (const book of books!) {
            const fixture = FIXTURES[book.uesp_page_id - FIXTURE_PAGE_ID_BASE];
            bookIds.set(fixture.key, book.id);
        }
        const id = (key: string) => bookIds.get(key)!;

        viewer = await createSignedInUser(
            stack,
            admin,
            'browse-m3-progress-viewer@example.test',
        );
        other = await createSignedInUser(
            stack,
            admin,
            'browse-m3-progress-other@example.test',
        );

        const both = { is_read: true, is_collected: true };
        const { error: trackError } = await admin.from('user_book').insert([
            {
                user_id: viewer.userId,
                book_id: id('read-and-collected'),
                ...both,
            },
            {
                user_id: viewer.userId,
                book_id: id('read-only'),
                is_read: true,
                is_collected: false,
            },
            {
                user_id: viewer.userId,
                book_id: id('collected-only'),
                is_read: false,
                is_collected: true,
            },
            // Everything out of scope is marked both ways, so a leak into
            // either count is visible.
            {
                user_id: viewer.userId,
                book_id: id('excluded-category'),
                ...both,
            },
            { user_id: viewer.userId, book_id: id('excluded-source'), ...both },
            { user_id: viewer.userId, book_id: id('unobtainable'), ...both },
            // The other user's progress, on a book the viewer has not touched
            // and on one they have.
            {
                user_id: other.userId,
                book_id: id('only-the-other-user-tracks'),
                ...both,
            },
            { user_id: other.userId, book_id: id('read-only'), ...both },
        ]);
        if (trackError) throw trackError;
    });

    after(async () => {
        // Deleting the books cascades to user_book; by page-id range so every
        // fixture goes whatever failed partway.
        await admin
            .from('book')
            .delete()
            .gte('uesp_page_id', FIXTURE_PAGE_ID_BASE)
            .lt('uesp_page_id', FIXTURE_PAGE_ID_BASE + 100);
        if (viewer) await admin.auth.admin.deleteUser(viewer.userId);
        if (other) await admin.auth.admin.deleteUser(other.userId);
    });

    // Four of the seven fixtures are in the default scope; the note, the
    // Creation Club book and the unobtainable book are not.
    test('the total counts only the default scope', async () => {
        assert.equal(await counted(totalCountQuery(admin)), baselineTotal + 4);
    });

    test('collected counts only in-scope books the user has collected', async () => {
        assert.equal(
            await counted(
                flagCountQuery(viewer.client, viewer.userId, 'collected'),
            ),
            2,
        );
    });

    test('read counts only in-scope books the user has read', async () => {
        assert.equal(
            await counted(flagCountQuery(viewer.client, viewer.userId, 'read')),
            2,
        );
    });

    // FR-10 will let anyone read a public user's user_book rows. The admin
    // client bypasses RLS the same way, so this is that future today: the
    // other user's rows are visible to the query, and the explicit user limit
    // is the only thing keeping them out of the viewer's counts.
    test('another user’s progress never counts, even where RLS would admit it', async () => {
        assert.equal(
            await counted(flagCountQuery(admin, viewer.userId, 'collected')),
            2,
        );
        assert.equal(
            await counted(flagCountQuery(admin, viewer.userId, 'read')),
            2,
        );
        assert.equal(
            await counted(flagCountQuery(admin, other.userId, 'read')),
            2,
        );
    });

    test('a user with no progress counts zero', async () => {
        assert.equal(
            await counted(
                flagCountQuery(admin, crypto.randomUUID(), 'collected'),
            ),
            0,
        );
    });

    /**
     * The marked list for `userId`, as fixture key -> displayed flags, over
     * this file's fixtures only (the local stack may hold other test data).
     */
    async function markedFor(
        supabase: SupabaseClient,
        userId: string,
    ): Promise<Map<string, { isRead: boolean; isCollected: boolean }>> {
        const keyById = new Map([...bookIds].map(([key, id]) => [id, key]));
        const { data, error } = await markedBooksQuery(supabase, userId).in(
            'id',
            [...bookIds.values()],
        );
        if (error) throw error;
        const rows = data as unknown as {
            id: string;
            marked: ViewerFlagsEmbed;
        }[];
        return new Map(
            rows.map((row) => [
                keyById.get(row.id)!,
                readViewerFlags(row.marked),
            ]),
        );
    }

    describe('the marked-books list (FR-8)', () => {
        const both = { isRead: true, isCollected: true };
        const expected = () =>
            new Map([
                ['read-and-collected', both],
                ['read-only', { isRead: true, isCollected: false }],
                ['collected-only', { isRead: false, isCollected: true }],
                ['excluded-category', both],
                ['excluded-source', both],
                ['unobtainable', both],
            ]);

        // Unlike the meters, the list is every marked book: a marked note or
        // Creation Club book is still the user's data, and hiding it would
        // leave no way to unmark it from here.
        test('holds every marked book, in or out of the default scope, with its flags', async () => {
            assert.deepEqual(
                await markedFor(viewer.client, viewer.userId),
                expected(),
            );
        });

        // Through the admin client, which sees the other user's rows the way
        // FR-10's public-read policy will: the explicit user limit is all that
        // keeps their book -- and their flags on the viewer's -- out.
        test('never includes another user’s books or flags, even where RLS would admit them', async () => {
            assert.deepEqual(await markedFor(admin, viewer.userId), expected());
        });

        test('a user who has marked nothing has an empty list', async () => {
            assert.deepEqual(
                await markedFor(admin, crypto.randomUUID()),
                new Map(),
            );
        });
    });
});

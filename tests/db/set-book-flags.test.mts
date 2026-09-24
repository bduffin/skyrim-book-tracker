/**
 * Database tests for `set_book_flags`, the write path behind Browse M3's
 * read/collected toggles (FR-4).
 *
 * Driven through supabase-js and PostgREST, the path the Server Action uses,
 * rather than through psql. That is the realistic path, and it also avoids a
 * crash in the local image: a denied function call from a psql session that
 * has `set role anon` segfaults the local Postgres, where the same call
 * through PostgREST returns a clean 42501.
 *
 * Every test gets a book of its own, so none depends on another having run
 * first or on what it left behind. Local stack only (`tests/db/lib/stack.mts`);
 * the fixtures are self-contained, so an imported catalog is not required.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
    adminClient,
    anonClient,
    createSignedInUser,
    localStack,
    type LocalStack,
} from './lib/stack.mjs';

/**
 * `uesp_page_id` is NOT NULL and unique; real pages are far below this. Offset
 * from `book-filters.test.mts`'s base so a run that dies before its `after`
 * cannot leave rows that collide with the other file's next run.
 */
const FIXTURE_PAGE_ID_BASE = 990_000_100;

/** How many books the concurrency test races at once. */
const RACE_BOOKS = 10;

type Flags = { is_read: boolean; is_collected: boolean };

/**
 * Calls the function the way the Server Action will. A flag left `undefined`
 * is omitted from the body entirely, which PostgREST fills from the argument's
 * `default null`.
 */
function setFlags(
    client: SupabaseClient,
    bookId: string,
    flags: { isRead?: boolean | null; isCollected?: boolean | null },
) {
    const args: Record<string, unknown> = { p_book_id: bookId };
    if (flags.isRead !== undefined) args.p_is_read = flags.isRead;
    if (flags.isCollected !== undefined) {
        args.p_is_collected = flags.isCollected;
    }
    return client.rpc('set_book_flags', args).single<Flags>();
}

describe('set_book_flags (FR-4)', () => {
    let stack: LocalStack;
    let admin: SupabaseClient;
    let userA: { userId: string; client: SupabaseClient };
    let userB: { userId: string; client: SupabaseClient };

    const bookIds: string[] = [];
    let nextPageId = FIXTURE_PAGE_ID_BASE;

    /** A fresh book no one has touched, cleaned up in `after`. */
    async function freshBook(): Promise<string> {
        const pageId = nextPageId++;
        const title = `Browse M3 fixture ${pageId}`;
        const { data, error } = await admin
            .from('book')
            .insert({
                title,
                uesp_title: title,
                uesp_page_id: pageId,
                category: 'book',
                source: 'base',
                is_obtainable: true,
            })
            .select('id')
            .single();
        if (error) throw error;
        bookIds.push(data.id);
        return data.id;
    }

    /** What is actually stored, read past RLS. `null` means no row. */
    async function stored(
        userId: string,
        bookId: string,
    ): Promise<Flags | null> {
        const { data, error } = await admin
            .from('user_book')
            .select('is_read, is_collected')
            .eq('user_id', userId)
            .eq('book_id', bookId)
            .maybeSingle<Flags>();
        if (error) throw error;
        return data;
    }

    /** Seeds a row directly, bypassing the function under test. */
    async function seed(userId: string, bookId: string, flags: Flags) {
        const { error } = await admin
            .from('user_book')
            .insert({ user_id: userId, book_id: bookId, ...flags });
        if (error) throw error;
    }

    before(async () => {
        stack = localStack();
        admin = adminClient(stack);
        userA = await createSignedInUser(
            stack,
            admin,
            'browse-m3-set-flags-a@example.test',
        );
        userB = await createSignedInUser(
            stack,
            admin,
            'browse-m3-set-flags-b@example.test',
        );
    });

    after(async () => {
        // Deleting the books cascades to user_book and user_book_note, and
        // deleting the users would too; both, so neither leaks on a failure
        // partway through.
        if (bookIds.length) await admin.from('book').delete().in('id', bookIds);
        if (userA) await admin.auth.admin.deleteUser(userA.userId);
        if (userB) await admin.auth.admin.deleteUser(userB.userId);
    });

    describe('a null flag leaves that flag as it is', () => {
        test('on an untouched book, it reads as false', async () => {
            const book = await freshBook();

            const { data, error } = await setFlags(userA.client, book, {
                isRead: true,
            });

            assert.equal(error, null);
            assert.deepEqual(data, { is_read: true, is_collected: false });
            assert.deepEqual(await stored(userA.userId, book), data);
        });

        test('on a collected book, collected is kept', async () => {
            const book = await freshBook();
            await seed(userA.userId, book, {
                is_read: false,
                is_collected: true,
            });

            const { data, error } = await setFlags(userA.client, book, {
                isRead: true,
            });

            assert.equal(error, null);
            assert.deepEqual(data, { is_read: true, is_collected: true });
            assert.deepEqual(await stored(userA.userId, book), data);
        });

        test('setting a flag that is already set changes nothing', async () => {
            const book = await freshBook();
            await seed(userA.userId, book, {
                is_read: true,
                is_collected: false,
            });

            const { data, error } = await setFlags(userA.client, book, {
                isRead: true,
            });

            assert.equal(error, null);
            assert.deepEqual(data, { is_read: true, is_collected: false });
            assert.deepEqual(await stored(userA.userId, book), data);
        });

        // PostgREST passes an explicit JSON null through as SQL NULL, and an
        // omitted argument takes its `default null`; the two must agree.
        test('an explicit null behaves the same as an omitted flag', async () => {
            const book = await freshBook();
            await seed(userA.userId, book, {
                is_read: false,
                is_collected: true,
            });

            const { data, error } = await setFlags(userA.client, book, {
                isRead: true,
                isCollected: null,
            });

            assert.equal(error, null);
            assert.deepEqual(data, { is_read: true, is_collected: true });
        });
    });

    test('the flags change independently of each other', async () => {
        const book = await freshBook();

        await setFlags(userA.client, book, { isCollected: true });
        assert.deepEqual(await stored(userA.userId, book), {
            is_read: false,
            is_collected: true,
        });

        await setFlags(userA.client, book, { isRead: true });
        assert.deepEqual(await stored(userA.userId, book), {
            is_read: true,
            is_collected: true,
        });

        await setFlags(userA.client, book, { isRead: false });
        assert.deepEqual(await stored(userA.userId, book), {
            is_read: false,
            is_collected: true,
        });
    });

    test('both flags can be set in one call', async () => {
        const book = await freshBook();

        const { data, error } = await setFlags(userA.client, book, {
            isRead: true,
            isCollected: true,
        });

        assert.equal(error, null);
        assert.deepEqual(data, { is_read: true, is_collected: true });
        assert.deepEqual(await stored(userA.userId, book), data);
    });

    // user_book_touched rejects an all-false row, so this is the case that
    // has to become a delete rather than an update.
    test('clearing the last true flag deletes the row', async () => {
        const book = await freshBook();
        await seed(userA.userId, book, { is_read: true, is_collected: false });

        const { data, error } = await setFlags(userA.client, book, {
            isRead: false,
        });

        assert.equal(error, null);
        assert.deepEqual(data, { is_read: false, is_collected: false });
        assert.equal(await stored(userA.userId, book), null);
    });

    test('clearing a flag on an untouched book writes nothing', async () => {
        const book = await freshBook();

        const { data, error } = await setFlags(userA.client, book, {
            isCollected: false,
        });

        assert.equal(error, null);
        assert.deepEqual(data, { is_read: false, is_collected: false });
        assert.equal(await stored(userA.userId, book), null);
    });

    // user_book_note has no foreign key to user_book, precisely so that
    // clearing both flags can never take a note with it.
    test('deleting the row leaves the note on that book alone', async () => {
        const book = await freshBook();
        await seed(userA.userId, book, { is_read: true, is_collected: false });
        const { error: noteError } = await admin.from('user_book_note').insert({
            user_id: userA.userId,
            book_id: book,
            notes: 'Found on the shelf behind the Jarl.',
        });
        if (noteError) throw noteError;

        await setFlags(userA.client, book, { isRead: false });

        assert.equal(await stored(userA.userId, book), null);
        const { data: note } = await admin
            .from('user_book_note')
            .select('notes')
            .eq('user_id', userA.userId)
            .eq('book_id', book)
            .maybeSingle();
        assert.deepEqual(note, {
            notes: 'Found on the shelf behind the Jarl.',
        });
    });

    test('a call with neither flag is rejected and writes nothing', async () => {
        const book = await freshBook();

        const { data, error } = await setFlags(userA.client, book, {});

        assert.equal(data, null);
        assert.equal(error?.code, '22023');
        assert.equal(await stored(userA.userId, book), null);
    });

    // EXECUTE is revoked from anon, so PostgREST refuses before the body's own
    // auth.uid() check is ever reached. Either one would stop the write.
    test('a signed-out caller is refused', async () => {
        const book = await freshBook();

        const { data, error } = await setFlags(anonClient(stack), book, {
            isRead: true,
        });

        assert.equal(data, null);
        assert.equal(error?.code, '42501');
        const { count } = await admin
            .from('user_book')
            .select('*', { count: 'exact', head: true })
            .eq('book_id', book);
        assert.equal(count, 0);
    });

    // The user id comes from the session, never an argument (R5), so another
    // user's call can only ever write that user's own row.
    describe("one user's call never touches another user's row", () => {
        test('setting a flag writes only the caller’s row', async () => {
            const book = await freshBook();
            await seed(userA.userId, book, {
                is_read: false,
                is_collected: true,
            });

            await setFlags(userB.client, book, { isRead: true });

            assert.deepEqual(await stored(userA.userId, book), {
                is_read: false,
                is_collected: true,
            });
            assert.deepEqual(await stored(userB.userId, book), {
                is_read: true,
                is_collected: false,
            });
        });

        test('clearing a flag deletes only the caller’s row', async () => {
            const book = await freshBook();
            await seed(userA.userId, book, {
                is_read: true,
                is_collected: false,
            });

            const { data, error } = await setFlags(userB.client, book, {
                isRead: false,
            });

            assert.equal(error, null);
            assert.deepEqual(data, { is_read: false, is_collected: false });
            assert.deepEqual(await stored(userA.userId, book), {
                is_read: true,
                is_collected: false,
            });
        });
    });

    // Two first toggles on an untouched book can both reach the insert. The
    // loser's `on conflict` update must write only its own flag, or it
    // overwrites the winner's with the `false` it computed from a row it never
    // saw. Whether a given pair actually collides is up to timing, so several
    // books are raced at once; the assertion holds for either ordering, so this
    // cannot fail spuriously, only fail to exercise the conflict on a quiet run.
    test('two first toggles racing on one book both stick', async () => {
        const books = await Promise.all(
            Array.from({ length: RACE_BOOKS }, () => freshBook()),
        );

        const results = await Promise.all(
            books.flatMap((book) => [
                setFlags(userA.client, book, { isRead: true }),
                setFlags(userA.client, book, { isCollected: true }),
            ]),
        );
        for (const { error } of results) assert.equal(error, null);

        for (const book of books) {
            assert.deepEqual(await stored(userA.userId, book), {
                is_read: true,
                is_collected: true,
            });
        }
    });
});

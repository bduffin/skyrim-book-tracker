/**
 * Row-level security tests for AC-7 (NFR-3, R5): user B can neither read nor
 * write user A's `user_book` rows, and `book`/`book_location` are publicly
 * readable but not writable by `anon` or `authenticated`.
 *
 * Two things shape every test here:
 *
 * - **Denials come in two forms.** An `insert` that fails a policy is an error
 *   (42501). An `update` or `delete` whose `using` clause matches nothing is
 *   *not* -- PostgREST reports success with zero rows affected. So a write test
 *   that only checked for an error would pass against a table with no RLS at
 *   all; each one re-reads the target through the admin client instead.
 * - **Every "sees nothing" has a positive control.** B reading zero of A's rows
 *   proves nothing unless A can read them, since a policy that admits nobody
 *   would pass too.
 *
 * `user_book_note` is covered alongside `user_book` although AC-7 names only
 * the latter: it carries the same owner-only policies, and it is the table
 * FR-10 calls categorically more sensitive.
 *
 * Local stack only (`tests/db/lib/stack.mts`), through supabase-js rather than
 * psql -- see the header of `set-book-flags.test.mts` for why.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
    adminClient,
    anonClient,
    createSignedInUser,
    localStack,
} from './lib/stack.mjs';

/** Offset from the other test files' bases; see `set-book-flags.test.mts`. */
const FIXTURE_PAGE_ID_BASE = 990_000_200;

const TITLE = 'Browse M3 RLS fixture';
const NOTE = 'Behind the loose stone in the Hall of the Dead.';
const LOCATION = 'Browse M3 RLS fixture location';

/** Postgres' insufficient_privilege, which PostgREST passes through. */
const DENIED = '42501';

type User = { userId: string; client: SupabaseClient };

describe('row-level security (AC-7)', () => {
    let admin: SupabaseClient;
    let anon: SupabaseClient;
    let userA: User;
    let userB: User;

    /** A has a user_book row and a note on this one. */
    let bookA: string;
    /** B has a user_book row on this one, and A does not. */
    let bookB: string;

    before(async () => {
        const stack = localStack();
        admin = adminClient(stack);
        anon = anonClient(stack);

        const { data: books, error: bookError } = await admin
            .from('book')
            .insert(
                [0, 1].map((i) => ({
                    title: `${TITLE} ${i}`,
                    uesp_title: `${TITLE} ${i}`,
                    uesp_page_id: FIXTURE_PAGE_ID_BASE + i,
                    category: 'book',
                    source: 'base',
                    is_obtainable: true,
                })),
            )
            .select('id, uesp_page_id');
        if (bookError) throw bookError;
        [bookA, bookB] = books!
            .sort((a, b) => a.uesp_page_id - b.uesp_page_id)
            .map((row) => row.id);

        const { error: locationError } = await admin
            .from('book_location')
            .insert({ book_id: bookA, location_name: LOCATION });
        if (locationError) throw locationError;

        userA = await createSignedInUser(
            stack,
            admin,
            'browse-m3-rls-a@example.test',
        );
        userB = await createSignedInUser(
            stack,
            admin,
            'browse-m3-rls-b@example.test',
        );

        const { error: trackError } = await admin.from('user_book').insert([
            {
                user_id: userA.userId,
                book_id: bookA,
                is_read: true,
                is_collected: false,
            },
            {
                user_id: userB.userId,
                book_id: bookB,
                is_read: true,
                is_collected: false,
            },
        ]);
        if (trackError) throw trackError;

        const { error: noteError } = await admin
            .from('user_book_note')
            .insert({ user_id: userA.userId, book_id: bookA, notes: NOTE });
        if (noteError) throw noteError;
    });

    after(async () => {
        // Deleting the books cascades to book_location, user_book and
        // user_book_note; the users are deleted too so neither leaks when a
        // test fails partway. By page-id range rather than by id, so a forged
        // insert that wrongly succeeded is cleaned up with the rest.
        await admin
            .from('book')
            .delete()
            .gte('uesp_page_id', FIXTURE_PAGE_ID_BASE)
            .lt('uesp_page_id', FIXTURE_PAGE_ID_BASE + 100);
        if (userA) await admin.auth.admin.deleteUser(userA.userId);
        if (userB) await admin.auth.admin.deleteUser(userB.userId);
    });

    /** A's user_book row as actually stored, read past RLS. */
    async function storedRowOfA() {
        const { data, error } = await admin
            .from('user_book')
            .select('user_id, book_id, is_read, is_collected')
            .eq('user_id', userA.userId)
            .eq('book_id', bookA)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    const ROW_OF_A = () => ({
        user_id: userA.userId,
        book_id: bookA,
        is_read: true,
        is_collected: false,
    });

    describe('user_book is owner-only', () => {
        test('the owner can read their own row (positive control)', async () => {
            const { data, error } = await userA.client
                .from('user_book')
                .select('book_id')
                .eq('book_id', bookA);

            assert.equal(error, null);
            assert.deepEqual(data, [{ book_id: bookA }]);
        });

        test("another user cannot read the owner's row", async () => {
            const { data, error } = await userB.client
                .from('user_book')
                .select('book_id')
                .eq('user_id', userA.userId);

            assert.equal(error, null);
            assert.deepEqual(data, []);
        });

        test("another user cannot insert a row carrying the owner's id", async () => {
            const { error } = await userB.client.from('user_book').insert({
                user_id: userA.userId,
                book_id: bookB,
                is_read: true,
            });

            assert.equal(error?.code, DENIED);
            const { count } = await admin
                .from('user_book')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userA.userId)
                .eq('book_id', bookB);
            assert.equal(count, 0);
        });

        test("another user cannot upsert over the owner's row", async () => {
            const { error } = await userB.client.from('user_book').upsert(
                {
                    user_id: userA.userId,
                    book_id: bookA,
                    is_read: false,
                    is_collected: true,
                },
                { onConflict: 'user_id,book_id' },
            );

            assert.equal(error?.code, DENIED);
            assert.deepEqual(await storedRowOfA(), ROW_OF_A());
        });

        // Not an error: the `using` clause hides A's row from B, so the update
        // matches nothing and PostgREST reports zero rows.
        test("another user cannot update the owner's row", async () => {
            const { data, error } = await userB.client
                .from('user_book')
                .update({ is_collected: true })
                .eq('user_id', userA.userId)
                .eq('book_id', bookA)
                .select();

            assert.equal(error, null);
            assert.deepEqual(data, []);
            assert.deepEqual(await storedRowOfA(), ROW_OF_A());
        });

        test("another user cannot delete the owner's row", async () => {
            const { data, error } = await userB.client
                .from('user_book')
                .delete()
                .eq('user_id', userA.userId)
                .eq('book_id', bookA)
                .select();

            assert.equal(error, null);
            assert.deepEqual(data, []);
            assert.deepEqual(await storedRowOfA(), ROW_OF_A());
        });

        // The `with check` on update is what stops this: B can see and update
        // their own row, but not into one that belongs to somebody else.
        test('a user cannot hand their own row to someone else', async () => {
            const { error } = await userB.client
                .from('user_book')
                .update({ user_id: userA.userId })
                .eq('user_id', userB.userId)
                .eq('book_id', bookB);

            assert.equal(error?.code, DENIED);
            const { count } = await admin
                .from('user_book')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userB.userId)
                .eq('book_id', bookB);
            assert.equal(count, 1);
        });

        test('a signed-out visitor cannot write a row', async () => {
            const { error } = await anon.from('user_book').insert({
                user_id: userA.userId,
                book_id: bookB,
                is_read: true,
            });

            assert.equal(error?.code, DENIED);
        });
    });

    describe('user_book_note is owner-only', () => {
        test('the owner can read their own note (positive control)', async () => {
            const { data, error } = await userA.client
                .from('user_book_note')
                .select('notes')
                .eq('book_id', bookA);

            assert.equal(error, null);
            assert.deepEqual(data, [{ notes: NOTE }]);
        });

        test('neither another user nor a signed-out visitor can read it', async () => {
            for (const client of [userB.client, anon]) {
                const { data, error } = await client
                    .from('user_book_note')
                    .select('notes')
                    .eq('book_id', bookA);

                assert.equal(error, null);
                assert.deepEqual(data, []);
            }
        });

        test('another user cannot overwrite or delete it', async () => {
            await userB.client
                .from('user_book_note')
                .update({ notes: 'overwritten' })
                .eq('user_id', userA.userId);
            await userB.client
                .from('user_book_note')
                .delete()
                .eq('user_id', userA.userId);

            const { data } = await admin
                .from('user_book_note')
                .select('notes')
                .eq('user_id', userA.userId)
                .eq('book_id', bookA);
            assert.deepEqual(data, [{ notes: NOTE }]);
        });
    });

    describe('book and book_location are readable by anyone, writable by no one', () => {
        const callers = () =>
            [
                ['a signed-out visitor', anon],
                ['a signed-in user', userB.client],
            ] as const;

        test('both can be read signed out and signed in (positive control)', async () => {
            for (const [, client] of callers()) {
                const { data: book } = await client
                    .from('book')
                    .select('id')
                    .eq('id', bookA);
                assert.deepEqual(book, [{ id: bookA }]);

                const { data: location } = await client
                    .from('book_location')
                    .select('location_name')
                    .eq('book_id', bookA);
                assert.deepEqual(location, [{ location_name: LOCATION }]);
            }
        });

        test('neither can insert into them', async () => {
            for (const [who, client] of callers()) {
                const { error: bookError } = await client.from('book').insert({
                    title: `${TITLE} forged`,
                    uesp_title: `${TITLE} forged`,
                    uesp_page_id: FIXTURE_PAGE_ID_BASE + 99,
                    category: 'book',
                    source: 'base',
                });
                assert.equal(bookError?.code, DENIED, `${who}: book`);

                const { error: locationError } = await client
                    .from('book_location')
                    .insert({ book_id: bookA, location_name: 'forged' });
                assert.equal(
                    locationError?.code,
                    DENIED,
                    `${who}: book_location`,
                );
            }
        });

        test('neither can update or delete them', async () => {
            for (const [, client] of callers()) {
                await client
                    .from('book')
                    .update({ title: 'forged' })
                    .eq('id', bookA);
                await client
                    .from('book_location')
                    .update({ location_name: 'forged' })
                    .eq('book_id', bookA);
                await client
                    .from('book_location')
                    .delete()
                    .eq('book_id', bookA);
                await client.from('book').delete().eq('id', bookA);
            }

            const { data: book } = await admin
                .from('book')
                .select('title')
                .eq('id', bookA);
            assert.deepEqual(book, [{ title: `${TITLE} 0` }]);

            const { data: location } = await admin
                .from('book_location')
                .select('location_name')
                .eq('book_id', bookA);
            assert.deepEqual(location, [{ location_name: LOCATION }]);
        });

        // The import's one write path into book_location. EXECUTE is granted
        // to service_role only, so a signed-in user is refused before the body
        // runs -- rather than relying on RLS to deny its delete and insert.
        test('a signed-in user cannot call replace_book_locations', async () => {
            const { error } = await userB.client.rpc('replace_book_locations', {
                p_books: [{ book_id: bookA, locations: [] }],
            });

            assert.equal(error?.code, DENIED);
            const { count } = await admin
                .from('book_location')
                .select('*', { count: 'exact', head: true })
                .eq('book_id', bookA);
            assert.equal(count, 1);
        });
    });
});

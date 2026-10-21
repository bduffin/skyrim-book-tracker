/**
 * Row-level security and constraints on `profile` (Profiles AC-1, Profiles
 * AC-2, and the database half of Profiles AC-4).
 *
 * The same two rules as `rls.test.mts` shape every test: a denied `update`
 * is not an error but zero rows affected, so each write test re-reads the
 * target through the admin client; and every "sees nothing" has a positive
 * control, since a policy that admitted nobody would pass it too.
 *
 * Usernames are set through the admin client: the form does not offer them
 * until Profiles M2, but the column, its constraint and its index ship with
 * the table, and Profiles AC-1's username lookup is a property of the row
 * policy.
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
    type LocalStack,
} from './lib/stack.mjs';

/** Postgres' insufficient_privilege, which PostgREST passes through. */
const DENIED = '42501';
const NOT_NULL = '23502';
const UNIQUE = '23505';
const CHECK = '23514';

const PRIVATE_NAME = 'profiles-m1-private';
const PUBLIC_NAME = 'profiles-m1-public';
const UNREGISTERED_NAME = 'profiles-m1-nobody';

type User = { userId: string; client: SupabaseClient };

describe('profile (Profiles AC-1, Profiles AC-2, Profiles AC-4)', () => {
    let stack: LocalStack;
    let admin: SupabaseClient;
    let anon: SupabaseClient;
    /** Has a private row, with a username. */
    let owner: User;
    /** Has a public row, with a username. */
    let publicUser: User;
    /** Has no row: the second signed-in reader, and the one attempting writes. */
    let other: User;
    /** Has no row, and never writes: the target of forged writes. */
    let bystander: User;
    /**
     * Created by the cascade test, which deletes it itself. Held here so
     * `after` still deletes it when that test fails before getting that far;
     * a leftover user would make every later run fail at `createUser`.
     */
    let leaving: User | undefined;

    before(async () => {
        stack = localStack();
        admin = adminClient(stack);
        anon = anonClient(stack);

        owner = await createSignedInUser(
            stack,
            admin,
            'profiles-m1-owner@example.test',
        );
        publicUser = await createSignedInUser(
            stack,
            admin,
            'profiles-m1-public@example.test',
        );
        other = await createSignedInUser(
            stack,
            admin,
            'profiles-m1-other@example.test',
        );
        bystander = await createSignedInUser(
            stack,
            admin,
            'profiles-m1-bystander@example.test',
        );

        const { error } = await admin.from('profile').insert([
            { user_id: owner.userId, is_public: false, username: PRIVATE_NAME },
            {
                user_id: publicUser.userId,
                is_public: true,
                username: PUBLIC_NAME,
            },
        ]);
        if (error) throw error;
    });

    after(async () => {
        // Deleting the users cascades to their profile rows, including any a
        // forged write wrongly created.
        for (const user of [owner, publicUser, other, bystander, leaving]) {
            if (user) await admin.auth.admin.deleteUser(user.userId);
        }
    });

    /** A user's row as actually stored, read past RLS. */
    async function storedRow(userId: string) {
        const { data, error } = await admin
            .from('profile')
            .select('user_id, is_public, username')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    const OWNER_ROW = () => ({
        user_id: owner.userId,
        is_public: false,
        username: PRIVATE_NAME,
    });

    const PUBLIC_ROW = () => ({
        user_id: publicUser.userId,
        is_public: true,
        username: PUBLIC_NAME,
    });

    describe('reading (Profiles AC-1)', () => {
        for (const [reader, client] of [
            ['anon', () => anon],
            ['another signed-in user', () => other.client],
        ] as const) {
            test(`${reader} reads a public row (positive control)`, async () => {
                const { data, error } = await client()
                    .from('profile')
                    .select('user_id, is_public')
                    .eq('user_id', publicUser.userId);

                assert.equal(error, null);
                assert.deepEqual(data, [
                    { user_id: publicUser.userId, is_public: true },
                ]);
            });

            test(`${reader} does not read a private row`, async () => {
                const { data, error } = await client()
                    .from('profile')
                    .select('user_id')
                    .eq('user_id', owner.userId);

                assert.equal(error, null);
                assert.deepEqual(data, []);
            });

            test(`${reader} finds a public username (positive control)`, async () => {
                const { data, error } = await client()
                    .from('profile')
                    .select('user_id')
                    .eq('username', PUBLIC_NAME);

                assert.equal(error, null);
                assert.deepEqual(data, [{ user_id: publicUser.userId }]);
            });

            test(`${reader} gets the same answer for a private username as for an unregistered one`, async () => {
                const lookup = (username: string) =>
                    client()
                        .from('profile')
                        .select('user_id')
                        .eq('username', username);
                const [held, unheld] = await Promise.all([
                    lookup(PRIVATE_NAME),
                    lookup(UNREGISTERED_NAME),
                ]);

                assert.deepEqual(
                    { data: held.data, error: held.error },
                    { data: [], error: null },
                );
                assert.deepEqual(
                    { data: unheld.data, error: unheld.error },
                    { data: [], error: null },
                );
            });
        }

        test('the owner reads their own private row', async () => {
            const { data, error } = await owner.client
                .from('profile')
                .select('user_id, is_public, username')
                .eq('user_id', owner.userId);

            assert.equal(error, null);
            assert.deepEqual(data, [OWNER_ROW()]);
        });

        test('a listing as anon holds public rows only', async () => {
            const { data, error } = await anon
                .from('profile')
                .select('user_id')
                .in('user_id', [owner.userId, publicUser.userId]);

            assert.equal(error, null);
            assert.deepEqual(data, [{ user_id: publicUser.userId }]);
        });

        test('anon reads user_id, is_public and username, and nothing else', async () => {
            const { data, error } = await anon
                .from('profile')
                .select('*')
                .eq('user_id', publicUser.userId)
                .single();

            assert.equal(error, null);
            assert.deepEqual(Object.keys(data!).sort(), [
                'is_public',
                'user_id',
                'username',
            ]);
        });
    });

    describe('writing (Profiles AC-2)', () => {
        test("another user cannot insert a row carrying someone else's id", async () => {
            const { error } = await other.client
                .from('profile')
                .insert({ user_id: bystander.userId, is_public: true });

            assert.equal(error?.code, DENIED);
            assert.equal(await storedRow(bystander.userId), null);
        });

        test("another user cannot update the owner's row", async () => {
            await other.client
                .from('profile')
                .update({ is_public: true })
                .eq('user_id', owner.userId);

            assert.deepEqual(await storedRow(owner.userId), OWNER_ROW());
        });

        test("another user cannot upsert over the owner's row", async () => {
            const { error } = await other.client
                .from('profile')
                .upsert(
                    { user_id: owner.userId, is_public: true },
                    { onConflict: 'user_id' },
                );

            assert.equal(error?.code, DENIED);
            assert.deepEqual(await storedRow(owner.userId), OWNER_ROW());
        });

        // The two above aim at a row the writer cannot even see. These aim at
        // one it can, so an update policy copied from the select policy --
        // `is_public or own` in both `using` and `with check` -- fails here.
        // The write keeps the row public, which is what gets it past such a
        // `with check`: making it private would be refused either way.
        test('another user cannot update a public row they can read', async () => {
            await other.client
                .from('profile')
                .update({ username: 'profiles-m1-hijack' })
                .eq('user_id', publicUser.userId);

            assert.deepEqual(await storedRow(publicUser.userId), PUBLIC_ROW());
        });

        test('another user cannot upsert over a public row they can read', async () => {
            const { error } = await other.client.from('profile').upsert(
                {
                    user_id: publicUser.userId,
                    is_public: true,
                    username: 'profiles-m1-hijack',
                },
                { onConflict: 'user_id' },
            );

            assert.equal(error?.code, DENIED);
            assert.deepEqual(await storedRow(publicUser.userId), PUBLIC_ROW());
        });

        test('the owner cannot move their row to another user id', async () => {
            const { error } = await owner.client
                .from('profile')
                .update({ user_id: bystander.userId })
                .eq('user_id', owner.userId);

            assert.equal(error?.code, DENIED);
            assert.deepEqual(await storedRow(owner.userId), OWNER_ROW());
            assert.equal(await storedRow(bystander.userId), null);
        });

        test('the owner cannot delete their row: it goes with the account', async () => {
            const { error } = await owner.client
                .from('profile')
                .delete()
                .eq('user_id', owner.userId);

            assert.equal(error?.code, DENIED);
            assert.deepEqual(await storedRow(owner.userId), OWNER_ROW());
        });

        test('anon cannot insert', async () => {
            const { error } = await anon
                .from('profile')
                .insert({ user_id: bystander.userId, is_public: true });

            assert.equal(error?.code, DENIED);
            assert.equal(await storedRow(bystander.userId), null);
        });

        test('anon cannot update, even a public row it can read', async () => {
            const { error } = await anon
                .from('profile')
                .update({ is_public: false })
                .eq('user_id', publicUser.userId);

            assert.equal(error?.code, DENIED);
            assert.equal((await storedRow(publicUser.userId))?.is_public, true);
        });

        test("saveProfile's upsert creates the caller's row, then changes it without touching the username", async () => {
            // The shape saveProfile sends: user_id and is_public only, so a
            // username set some other way survives a visibility change.
            const save = (isPublic: boolean) =>
                other.client
                    .from('profile')
                    .upsert(
                        { user_id: other.userId, is_public: isPublic },
                        { onConflict: 'user_id' },
                    );

            assert.equal((await save(true)).error, null);
            assert.deepEqual(await storedRow(other.userId), {
                user_id: other.userId,
                is_public: true,
                username: null,
            });

            const { error: nameError } = await admin
                .from('profile')
                .update({ username: 'profiles-m1-other' })
                .eq('user_id', other.userId);
            if (nameError) throw nameError;

            assert.equal((await save(false)).error, null);
            assert.deepEqual(await storedRow(other.userId), {
                user_id: other.userId,
                is_public: false,
                username: 'profiles-m1-other',
            });
        });
    });

    describe('constraints (Profiles AC-4, Profiles FR-1, Profiles FR-6)', () => {
        test('an insert omitting is_public fails: there is no default', async () => {
            const { error } = await bystander.client
                .from('profile')
                .insert({ user_id: bystander.userId });

            assert.equal(error?.code, NOT_NULL);
            assert.equal(await storedRow(bystander.userId), null);
        });

        test('is_public cannot be null', async () => {
            const { error } = await bystander.client
                .from('profile')
                .insert({ user_id: bystander.userId, is_public: null });

            assert.equal(error?.code, NOT_NULL);
            assert.equal(await storedRow(bystander.userId), null);
        });

        for (const [why, username] of [
            ['with uppercase', 'Lydia'],
            ['that is too short', 'ab'],
            ['that is too long', 'a'.repeat(31)],
            ['the length of a UUID', 'a'.repeat(36)],
            ['with a space', 'ly dia'],
        ] as const) {
            test(`a username ${why} is refused`, async () => {
                const { error } = await admin
                    .from('profile')
                    .update({ username })
                    .eq('user_id', publicUser.userId);

                assert.equal(error?.code, CHECK);
                assert.equal(
                    (await storedRow(publicUser.userId))?.username,
                    PUBLIC_NAME,
                );
            });
        }

        test('a username held by someone else is refused', async () => {
            const { error } = await admin
                .from('profile')
                .update({ username: PRIVATE_NAME })
                .eq('user_id', publicUser.userId);

            assert.equal(error?.code, UNIQUE);
            assert.equal(
                (await storedRow(publicUser.userId))?.username,
                PUBLIC_NAME,
            );
        });

        test('deleting the account deletes the row', async () => {
            leaving = await createSignedInUser(
                stack,
                admin,
                'profiles-m1-leaving@example.test',
            );
            const { userId, client } = leaving;
            const { error } = await client
                .from('profile')
                .insert({ user_id: userId, is_public: true });
            if (error) throw error;
            assert.notEqual(await storedRow(userId), null);

            const { error: deleteError } =
                await admin.auth.admin.deleteUser(userId);
            if (deleteError) throw deleteError;
            leaving = undefined;

            assert.equal(await storedRow(userId), null);
        });
    });
});

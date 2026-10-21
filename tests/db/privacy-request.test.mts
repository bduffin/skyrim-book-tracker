/**
 * The privacy-request queries against real data (Privacy AC-5, AC-6): an
 * export holds one user's data and nothing of another's, and a deletion run
 * as the procedure runs it leaves no row for that id anywhere.
 *
 * Driven through `runRequest`, the same path `yarn privacy:request` takes,
 * hard-coded to `local` and only after `localStack()` has refused anything
 * else. Deleting the user through the admin client stands in for the
 * dashboard's Delete user (FR-4 step 3), which calls the same Auth endpoint.
 *
 * Two users throughout, because the failure that matters is a query that
 * reaches past its user: each has a session from a real code sign-in, a
 * GitHub identity, a sign-in record holding tokens, a mark, a note and a
 * profile.
 */

import { execFileSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runRequest } from '../../scripts/lib/privacy-query.mjs';
import {
    adminClient,
    createSignedInUser,
    localStack,
    type LocalStack,
} from './lib/stack.mjs';

const FIXTURE_PAGE_ID_BASE = 990_000_400;

type Fixture = {
    userId: string;
    email: string;
    githubId: string;
    token: string;
    note: string;
    bookTitle: string;
    isPublic: boolean;
    username: string;
};

/** One statement against the local stack; fixture values only, never input. */
function sqlLocal(statement: string): void {
    execFileSync('supabase', ['db', 'query', '--local', statement], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

describe('privacy requests (Privacy FR-4, FR-6)', () => {
    let stack: LocalStack;
    let admin: SupabaseClient;
    const bookIds: string[] = [];
    const users: Fixture[] = [];

    async function seedUser(
        tag: string,
        pageId: number,
        isPublic: boolean,
    ): Promise<Fixture> {
        const email = `privacy-request-${tag}@example.test`;
        const { userId } = await createSignedInUser(stack, admin, email);
        const fixture: Fixture = {
            userId,
            email,
            githubId: `9900040${pageId % 10}`,
            token: `gho_privacy_fixture_${tag}`,
            note: `Privacy fixture note ${tag}`,
            bookTitle: `Privacy fixture ${pageId}`,
            isPublic,
            username: `privacy-fixture-${tag}`,
        };
        users.push(fixture);

        sqlLocal(`do $$ begin
            -- Timestamps set, as Auth sets them: it cannot load a user whose
            -- identity has a null created_at, and fails the delete with a 500.
            insert into auth.identities
                (provider_id, user_id, identity_data, provider,
                 created_at, updated_at, last_sign_in_at)
            values ('${fixture.githubId}', '${userId}',
                    jsonb_build_object('provider_id', '${fixture.githubId}',
                                       'user_name', 'privacy-${tag}',
                                       'email', '${email}'),
                    'github', now(), now(), now());
            insert into auth.flow_state
                (id, user_id, provider_type, authentication_method,
                 provider_access_token, provider_refresh_token,
                 created_at, updated_at)
            values (gen_random_uuid(), '${userId}', 'github', 'oauth',
                    '${fixture.token}', '${fixture.token}_refresh',
                    now(), now());
        end $$`);

        const { data: book, error } = await admin
            .from('book')
            .insert({
                title: fixture.bookTitle,
                uesp_title: fixture.bookTitle,
                uesp_page_id: pageId,
                category: 'book',
                source: 'base',
                is_obtainable: true,
            })
            .select('id')
            .single();
        if (error) throw error;
        bookIds.push(book.id);

        const { error: markError } = await admin
            .from('user_book')
            .insert({ user_id: userId, book_id: book.id, is_read: true });
        if (markError) throw markError;
        const { error: noteError } = await admin
            .from('user_book_note')
            .insert({ user_id: userId, book_id: book.id, notes: fixture.note });
        if (noteError) throw noteError;
        const { error: profileError } = await admin.from('profile').insert({
            user_id: userId,
            is_public: fixture.isPublic,
            username: fixture.username,
        });
        if (profileError) throw profileError;

        return fixture;
    }

    before(async () => {
        stack = localStack();
        admin = adminClient(stack);
        // One public profile and one private, so the export is shown to carry
        // whichever the user chose.
        await seedUser('a', FIXTURE_PAGE_ID_BASE, true);
        await seedUser('b', FIXTURE_PAGE_ID_BASE + 1, false);
    });

    after(async () => {
        // In SQL rather than through Auth, so a user Auth cannot load is still
        // removed. flow_state does not cascade from auth.users, which is the
        // point of FR-4 step 4, so it goes by hand whatever the tests did.
        for (const u of users) {
            sqlLocal(
                `delete from auth.flow_state where user_id = '${u.userId}'`,
            );
            sqlLocal(`delete from auth.users where id = '${u.userId}'`);
        }
        if (bookIds.length) await admin.from('book').delete().in('id', bookIds);
    });

    test('show gives the stored email and GitHub id', () => {
        const [a] = users;
        const rows = runRequest('show', a.userId, 'local');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].email, a.email);
        assert.equal(rows[0].github_id, a.githubId);
    });

    test("export holds every stored item for one user and nothing of the other's (AC-6)", () => {
        const [a, b] = users;
        const [{ export: text }] = runRequest('export', a.userId, 'local');
        assert.equal(typeof text, 'string');
        const data = JSON.parse(text as string);

        assert.equal(data.account.id, a.userId);
        assert.equal(data.account.email, a.email);
        assert.ok(
            data.identities.some(
                (i: {
                    provider: string;
                    identity_data: { provider_id: string };
                }) =>
                    i.provider === 'github' &&
                    i.identity_data.provider_id === a.githubId,
            ),
        );
        assert.ok(data.sessions.length >= 1, 'the code sign-in session');
        assert.equal(data.sign_in_records.length, 1);
        assert.deepEqual(Object.keys(data.sign_in_records[0]).sort(), [
            'created_at',
            'method',
            'provider',
        ]);
        assert.deepEqual(
            data.books.map((x: { title: string }) => x.title),
            [a.bookTitle],
        );
        assert.deepEqual(
            data.notes.map((x: { notes: string }) => x.notes),
            [a.note],
        );
        assert.deepEqual(data.profile, {
            is_public: a.isPublic,
            username: a.username,
        });

        // No credential, and nothing of the other user's, anywhere in the text.
        for (const absent of [
            a.token,
            b.token,
            b.userId,
            b.email,
            b.githubId,
            b.note,
            b.bookTitle,
            b.username,
        ]) {
            assert.ok(!(text as string).includes(absent), `contains ${absent}`);
        }
    });

    test('deleting a user as FR-4 steps 3 to 5 leaves no row for that id (AC-5)', async () => {
        const [a, b] = users;

        // Before: verify must see the rows, or a clean result proves nothing.
        const before = runRequest('verify', a.userId, 'local');
        const held = before
            .filter((r) => r.remaining !== 0)
            .map((r) => r.table_name);
        for (const table of [
            'auth.users',
            'auth.identities',
            'auth.sessions',
            'auth.refresh_tokens',
            'auth.flow_state',
            'public.user_book',
            'public.user_book_note',
            'public.profile',
        ]) {
            assert.ok(
                held.includes(table),
                `verify sees ${table} before deletion`,
            );
        }

        // Step 3: delete the user.
        const { error } = await admin.auth.admin.deleteUser(a.userId);
        if (error) throw error;

        // flow_state is all that survives the cascade.
        const between = runRequest('verify', a.userId, 'local');
        assert.deepEqual(
            between.filter((r) => r.remaining !== 0).map((r) => r.table_name),
            ['auth.flow_state'],
        );

        // Step 4: delete the sign-in records.
        const [{ deleted }] = runRequest(
            'delete-flow-state',
            a.userId,
            'local',
        );
        assert.equal(deleted, 1);

        // Step 5: zero rows everywhere.
        const after = runRequest('verify', a.userId, 'local');
        assert.ok(after.length > 0);
        assert.deepEqual(
            after.filter((r) => r.remaining !== 0),
            [],
        );

        // And the other user is untouched.
        const other = runRequest('verify', b.userId, 'local');
        const otherHeld = other
            .filter((r) => r.remaining !== 0)
            .map((r) => r.table_name);
        assert.ok(otherHeld.includes('auth.users'));
        assert.ok(otherHeld.includes('auth.flow_state'));
        assert.ok(otherHeld.includes('public.user_book_note'));
        assert.ok(otherHeld.includes('public.profile'));
    });

    test('export reads a user with no profile row as null, not an error', async () => {
        const [, b] = users;
        const { error } = await admin
            .from('profile')
            .delete()
            .eq('user_id', b.userId);
        if (error) throw error;

        // Put back afterwards, so no other test depends on running first.
        try {
            const [{ export: text }] = runRequest('export', b.userId, 'local');
            assert.equal(JSON.parse(text as string).profile, null);
        } finally {
            const { error: restoreError } = await admin.from('profile').insert({
                user_id: b.userId,
                is_public: b.isPublic,
                username: b.username,
            });
            if (restoreError) throw restoreError;
        }
    });
});

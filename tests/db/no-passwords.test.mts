/**
 * Tests for the password trigger (`..._no_passwords.sql`, Email FR-6,
 * AC-2): no account holds a password, however it was written, and a password
 * sign-in is refused before and after confirmation -- including the
 * pre-registration takeover the trigger exists to stop.
 *
 * Every account is made through Supabase Auth, never by inserting rows,
 * because Auth writes a new user in more than one step and the trigger has to
 * hold across all of them. The stored password is read through
 * `supabase db query --local`, since PostgREST does not expose `auth`.
 *
 * These fail if a Supabase upgrade renames `encrypted_password` or starts
 * accepting a sign-in without one (Email R2).
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';

import { queryValue } from './lib/local-query.mjs';
import {
    adminClient,
    anonClient,
    createSignedInUser,
    emailedCode,
    localStack,
    type LocalStack,
} from './lib/stack.mjs';

const PREFIX = `no-passwords-${Date.now()}`;
const PASSWORD = 'correct-horse-battery-staple';

/** Whether the user's row holds a password: `null` is the only right answer. */
function storedPassword(userId: string): string {
    return queryValue(
        `select case when encrypted_password is null then 'null'
                     when encrypted_password = '' then 'empty'
                     else 'set' end
           from auth.users where id = '${userId}'`,
    );
}

/** Looked up in the table itself, so it never depends on a page of users. */
function userIdFor(email: string): string {
    const id = queryValue(`select id from auth.users where email = '${email}'`);
    assert.notEqual(id, 'null', `no user for ${email}`);
    return id;
}

/**
 * A password sign-in's error code, or `null` if it returned a session.
 * Posted to Auth's token endpoint directly rather than through supabase-js,
 * so whatever refuses it is Auth itself, never a check in the client library.
 */
async function passwordSignIn(
    stack: LocalStack,
    email: string,
    password: string,
): Promise<string | null> {
    const response = await fetch(
        `${stack.url}/auth/v1/token?grant_type=password`,
        {
            method: 'POST',
            headers: {
                apikey: stack.publishableKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        },
    );
    const body = await response.json();
    if (response.ok) {
        assert.ok(body.access_token, 'a password sign-in returned no session');
        return null;
    }
    return body.error_code ?? `HTTP ${response.status}`;
}

/** Refused by Auth, both with the password given and with a blank one. */
async function assertPasswordsRefused(stack: LocalStack, email: string) {
    assert.equal(
        await passwordSignIn(stack, email, PASSWORD),
        'invalid_credentials',
    );
    assert.equal(await passwordSignIn(stack, email, ''), 'invalid_credentials');
}

describe('no passwords (Email FR-6)', () => {
    let stack: LocalStack;
    let admin: SupabaseClient;
    const email = (name: string) => `${PREFIX}-${name}@example.test`;

    before(() => {
        stack = localStack();
        admin = adminClient(stack);
    });

    after(async () => {
        const ids = queryValue(
            `select string_agg(id::text, ',') from auth.users where email like '${PREFIX}-%'`,
        );
        if (ids === 'null') return;
        for (const id of ids.split(',')) {
            await admin.auth.admin.deleteUser(id);
        }
    });

    test('auth.users still has the column the trigger clears', () => {
        assert.equal(
            queryValue(
                `select count(*) from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users'
                    and column_name = 'encrypted_password'`,
            ),
            '1',
        );
    });

    test('only Supabase Auth can run the trigger function', () => {
        const can = (role: string) =>
            queryValue(
                `has_function_privilege('${role}', 'private.clear_password()', 'execute')`,
            );
        assert.equal(can('supabase_auth_admin'), 'true');
        assert.equal(can('anon'), 'false');
        assert.equal(can('authenticated'), 'false');
    });

    test('a sign-up with a password stores none, and the password is refused', async () => {
        const address = email('signup');
        const { error } = await anonClient(stack).auth.signUp({
            email: address,
            password: PASSWORD,
        });
        assert.equal(error, null);
        const userId = userIdFor(address);

        assert.equal(storedPassword(userId), 'null');
        await assertPasswordsRefused(stack, address);

        // Confirmation is a write too; the password stays refused after it.
        const { error: confirmError } = await admin.auth.admin.updateUserById(
            userId,
            { email_confirm: true },
        );
        assert.equal(confirmError, null);
        assert.equal(storedPassword(userId), 'null');
        await assertPasswordsRefused(stack, address);
    });

    // Supabase stores a random password on every account a code creates.
    test('an account created by a code holds no password', async () => {
        const address = email('code');
        const { error } = await anonClient(stack).auth.signInWithOtp({
            email: address,
            options: { shouldCreateUser: true },
        });
        assert.equal(error, null);
        assert.equal(storedPassword(userIdFor(address)), 'null');
    });

    test('an account created through the admin API holds no password', async () => {
        const address = email('admin');
        const { data, error } = await admin.auth.admin.createUser({
            email: address,
            password: PASSWORD,
            email_confirm: true,
        });
        assert.equal(error, null);
        assert.equal(storedPassword(data.user!.id), 'null');
        await assertPasswordsRefused(stack, address);
    });

    test('a password a signed-in user sets is cleared', async () => {
        const address = email('update');
        const { userId, client } = await createSignedInUser(
            stack,
            admin,
            address,
        );
        // Accepted by Auth, so what clears it is the trigger, not a refusal.
        const { error } = await client.auth.updateUser({ password: PASSWORD });
        assert.equal(error, null);

        assert.equal(storedPassword(userId), 'null');
        await assertPasswordsRefused(stack, address);
    });

    // The takeover confirmed on 2026-10-05 (Email spec, Current State), by the
    // path an owner takes: an attacker signs the owner's address up with a
    // password; Auth emails that address a "Confirm signup" code; the owner
    // enters it, confirming that same account; the attacker's password must
    // not work.
    test('a pre-registration leaves no password that works after the owner signs in', async () => {
        const address = email('takeover');
        const { error } = await anonClient(stack).auth.signUp({
            email: address,
            password: PASSWORD,
            options: { data: { user_name: 'planted' } },
        });
        assert.equal(error, null);
        const userId = userIdFor(address);

        const owner = anonClient(stack);
        const { data, error: verifyError } = await owner.auth.verifyOtp({
            email: address,
            token: await emailedCode(stack, address),
            type: 'email',
        });
        assert.equal(verifyError, null);
        assert.equal(
            data.user?.id,
            userId,
            'the owner reached another account',
        );
        assert.ok(data.user?.email_confirmed_at, 'the code did not confirm');

        assert.equal(storedPassword(userId), 'null');
        await assertPasswordsRefused(stack, address);
    });
});

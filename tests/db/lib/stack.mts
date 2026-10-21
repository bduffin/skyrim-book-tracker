/**
 * The local Supabase stack the database tests run against, and the clients
 * they use to reach it.
 *
 * Shared rather than copied into each test file because `localStack` is the
 * safety guard: these tests create users and write rows, and the secret key
 * bypasses RLS. Two copies of a guard are two chances for one to drift.
 *
 * Not a test file itself -- `yarn test:db` globs `*.test.mts`, so this is only
 * ever imported.
 *
 * `yarn test:db` runs the files one at a time (`--test-concurrency=1`), and
 * must keep doing so: every file shares this one database, and tests that
 * assert deltas from a measured baseline assume nothing else writes to `book`
 * mid-run. Run concurrently, `set-book-flags.test.mts`'s fixtures landed inside
 * `book-filters.test.mts`'s default-scope count and failed it by 13.
 */

import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { isLocalHost } from '../../../scripts/lib/db.mjs';

export type LocalStack = {
    url: string;
    publishableKey: string;
    secretKey: string;
    /** Mailpit, which catches every email the local stack's Auth sends. */
    mailpitUrl: string;
};

/**
 * Where the local stack is listening, straight from the CLI rather than from
 * `.env.local` -- which points wherever the developer last pointed it, and is
 * exactly the well-aimed environment variable this must not trust. Guarded by
 * the importer's own `isLocalHost`.
 */
export function localStack(): LocalStack {
    let raw: string;
    try {
        raw = execFileSync('supabase', ['status', '-o', 'json'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
        throw new Error(
            'Could not read the local Supabase stack.\n' +
                '  Start it with `supabase start` (Docker must be running), ' +
                'then re-run `yarn test:db`.',
        );
    }

    const status = JSON.parse(raw);
    const url: string = status.API_URL;
    const host = new URL(url).hostname;
    if (!isLocalHost(host)) {
        throw new Error(
            `Refusing to run database tests against ${host}.\n` +
                '  These create a user and write rows, and the secret key ' +
                'bypasses row-level security.',
        );
    }

    return {
        url,
        publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
        secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
        mailpitUrl: status.MAILPIT_URL ?? status.INBUCKET_URL,
    };
}

/** A client with no session: the publishable key alone resolves to `anon`. */
export function anonClient(stack: LocalStack): SupabaseClient {
    return createClient(stack.url, stack.publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/** The secret key resolves to `service_role`, which bypasses RLS. */
export function adminClient(stack: LocalStack): SupabaseClient {
    return createClient(stack.url, stack.secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/**
 * Creates a confirmed user and returns their id and a client signed in as
 * them. The caller deletes the user afterwards, which cascades to their
 * `user_book` and `user_book_note` rows.
 *
 * Signed in with a one-time code, as email sign-in does, never a password:
 * no account can hold one (Email FR-6), so a password sign-in would fail.
 * The code comes from the admin API's `generateLink`, which returns it without
 * sending an email, so the tests neither wait on Mailpit nor run into the
 * minimum gap between two emails to one address.
 */
export async function createSignedInUser(
    stack: LocalStack,
    admin: SupabaseClient,
    email: string,
): Promise<{ userId: string; client: SupabaseClient }> {
    const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
    });
    if (error) throw error;

    const client = await signInWithCode(stack, admin, email);
    return { userId: data.user!.id, client };
}

/** A client signed in as an existing user, with a code from `generateLink`. */
export async function signInWithCode(
    stack: LocalStack,
    admin: SupabaseClient,
    email: string,
): Promise<SupabaseClient> {
    const { data: link, error: linkError } =
        await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkError) throw linkError;

    const client = anonClient(stack);
    const { error: verifyError } = await client.auth.verifyOtp({
        email,
        token: link.properties.email_otp,
        type: 'email',
    });
    if (verifyError) throw verifyError;
    return client;
}

/**
 * The sign-in code in the newest email Auth sent to `email`, read from
 * Mailpit, as the address's owner would read it. Waits briefly for delivery.
 */
export async function emailedCode(
    stack: LocalStack,
    email: string,
): Promise<string> {
    const search = `${stack.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`;
    for (let attempt = 0; attempt < 20; attempt++) {
        const { messages } = await (await fetch(search)).json();
        if (messages.length > 0) {
            const message = await (
                await fetch(
                    `${stack.mailpitUrl}/api/v1/message/${messages[0].ID}`,
                )
            ).json();
            const code = /\b\d{8}\b/.exec(message.Text)?.[0];
            if (code) return code;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`No code reached Mailpit for ${email}`);
}

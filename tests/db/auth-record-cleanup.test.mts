/**
 * Tests for the two daily auth-record cleanups: `delete-expired-auth-records`
 * (`20261003201942_schedule_auth_record_cleanup.sql`, Privacy FR-7, AC-8),
 * deleting sign-in records over a day old and sessions unused for 90 days,
 * and `delete-abandoned-email-sign-ups`
 * (`20261021061807_delete_abandoned_email_sign_ups.sql`, Email FR-7, AC-3),
 * deleting email sign-ups nobody confirmed. Each is scheduled, and each
 * deletes what it should while keeping recent rows.
 *
 * The rows live in `auth`, which PostgREST does not expose, so these go
 * through `supabase db query --local`, like `rls-auto-enable.test.mts` and for
 * the same reason: each probe is one `do` block that writes its fixtures, runs
 * the job's command as stored in `cron.job`, and raises an exception carrying
 * the result, which rolls everything back -- including whatever else on the
 * local stack the command deleted. Running the stored command, rather than a
 * copy of it, is what makes this a test of the migration.
 */

import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { localStack } from './lib/stack.mjs';
import { probe } from './lib/local-query.mjs';

const JOB = 'delete-expired-auth-records';
const SIGN_UP_JOB = 'delete-abandoned-email-sign-ups';

const run = (job: string) =>
    `execute (select command from cron.job where jobname = '${job}');`;
const runJob = run(JOB);

describe('auth record cleanup (Privacy FR-7)', () => {
    before(() => {
        localStack(); // throws unless the stack is local
    });

    test('the job is scheduled daily, as postgres', () => {
        const result = probe(
            'perform 1;',
            `(select jsonb_build_object('schedule', schedule, 'username', username, 'active', active)
                from cron.job where jobname = '${JOB}')`,
        );
        assert.deepEqual(result, {
            schedule: '17 3 * * *',
            username: 'postgres',
            active: true,
        });
    });

    test('deletes sign-in records over a day old and keeps recent ones', () => {
        const old = randomUUID();
        const fresh = randomUUID();
        const result = probe(
            `insert into auth.flow_state (id, provider_type, authentication_method, created_at)
             values ('${old}', 'github', 'oauth', now() - interval '2 days'),
                    ('${fresh}', 'github', 'oauth', now() - interval '1 minute');
             ${runJob}`,
            `jsonb_build_object(
                'old', exists (select 1 from auth.flow_state where id = '${old}'),
                'fresh', exists (select 1 from auth.flow_state where id = '${fresh}'))`,
        );
        assert.deepEqual(result, { old: false, fresh: true });
    });

    test('deletes sessions unused for 90 days, with their refresh tokens', () => {
        const user = randomUUID();
        const idle = randomUUID();
        const neverRefreshed = randomUUID();
        const recent = randomUUID();
        // updated_at is old but refreshed_at is recent: kept, which shows the
        // latest of the columns counts, and that refreshed_at is read as UTC.
        const refreshedOnly = randomUUID();
        const ago = (days: number) => `now() - interval '${days} days'`;
        const utc = (days: number) => `(${ago(days)}) at time zone 'UTC'`;

        const result = probe(
            `insert into auth.users (id) values ('${user}');
             insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
             values ('${idle}', '${user}', ${ago(200)}, ${ago(91)}, ${utc(91)}),
                    ('${neverRefreshed}', '${user}', ${ago(200)}, ${ago(91)}, null),
                    ('${recent}', '${user}', ${ago(200)}, ${ago(1)}, ${utc(1)}),
                    ('${refreshedOnly}', '${user}', ${ago(200)}, ${ago(91)}, ${utc(1)});
             insert into auth.refresh_tokens (token, user_id, session_id, revoked)
             values ('cleanup-probe-idle', '${user}', '${idle}', false),
                    ('cleanup-probe-recent', '${user}', '${recent}', false);
             ${runJob}`,
            `jsonb_build_object(
                'idle', exists (select 1 from auth.sessions where id = '${idle}'),
                'neverRefreshed', exists (select 1 from auth.sessions where id = '${neverRefreshed}'),
                'recent', exists (select 1 from auth.sessions where id = '${recent}'),
                'refreshedOnly', exists (select 1 from auth.sessions where id = '${refreshedOnly}'),
                'idleToken', exists (select 1 from auth.refresh_tokens where token = 'cleanup-probe-idle'),
                'recentToken', exists (select 1 from auth.refresh_tokens where token = 'cleanup-probe-recent'),
                'user', exists (select 1 from auth.users where id = '${user}'))`,
        );
        assert.deepEqual(result, {
            idle: false,
            neverRefreshed: false,
            recent: true,
            refreshedOnly: true,
            idleToken: false,
            recentToken: true,
            user: true,
        });
    });

    // The expired-records job must not touch accounts: that is the sign-up
    // job's alone, so a failure in one never rolls back the other.
    test('the expired-records job deletes no account', () => {
        const id = randomUUID();
        const result = probe(
            `insert into auth.users (id, confirmation_sent_at) values ('${id}', now() - interval '2 days');
             insert into auth.identities (provider_id, user_id, identity_data, provider)
             values ('${id}', '${id}', '{}'::jsonb, 'email');
             ${runJob}`,
            `jsonb_build_object('kept', exists (select 1 from auth.users where id = '${id}'))`,
        );
        assert.deepEqual(result, { kept: true });
    });
});

describe('abandoned email sign-up cleanup (Email FR-7)', () => {
    before(() => {
        localStack(); // throws unless the stack is local
    });

    test('the job is scheduled daily, as postgres, after the other', () => {
        const result = probe(
            'perform 1;',
            `(select jsonb_build_object('schedule', schedule, 'username', username, 'active', active)
                from cron.job where jobname = '${SIGN_UP_JOB}')`,
        );
        assert.deepEqual(result, {
            schedule: '27 3 * * *',
            username: 'postgres',
            active: true,
        });
    });

    // Email AC-3. Each kept account differs from a deleted one in exactly one
    // condition, so each shows that condition matters.
    test('deletes abandoned email sign-ups, and only those', () => {
        const ids = {
            abandoned: randomUUID(),
            abandonedReset: randomUUID(),
            recentCode: randomUUID(),
            recentReset: randomUUID(),
            neverSent: randomUUID(),
            noIdentity: randomUUID(),
            alsoGitHub: randomUUID(),
            confirmed: randomUUID(),
        };
        const ago = (interval: string) => `now() - interval '${interval}'`;
        const user = (
            id: string,
            confirmed: string,
            sent: string,
            reset = 'null',
        ) => `('${id}', ${confirmed}, ${sent}, ${reset}, ${ago('30 days')})`;
        const identity = (id: string, provider: string) =>
            `('${id}-${provider}', '${id}', '{}'::jsonb, '${provider}')`;

        const result = probe(
            `insert into auth.users (id, email_confirmed_at, confirmation_sent_at, recovery_sent_at, created_at)
             values ${user(ids.abandoned, 'null', ago('2 days'))},
                    ${user(ids.abandonedReset, 'null', 'null', ago('2 days'))},
                    ${user(ids.recentCode, 'null', ago('1 hour'))},
                    ${user(ids.recentReset, 'null', ago('2 days'), ago('1 minute'))},
                    ${user(ids.neverSent, 'null', 'null')},
                    ${user(ids.noIdentity, 'null', ago('2 days'))},
                    ${user(ids.alsoGitHub, 'null', ago('2 days'))},
                    ${user(ids.confirmed, ago('2 days'), ago('2 days'))};
             insert into auth.identities (provider_id, user_id, identity_data, provider)
             values ${identity(ids.abandoned, 'email')},
                    ${identity(ids.abandonedReset, 'email')},
                    ${identity(ids.recentCode, 'email')},
                    ${identity(ids.recentReset, 'email')},
                    ${identity(ids.neverSent, 'email')},
                    ${identity(ids.alsoGitHub, 'email')},
                    ${identity(ids.alsoGitHub, 'github')},
                    ${identity(ids.confirmed, 'email')};
             ${run(SIGN_UP_JOB)}`,
            `jsonb_build_object(${Object.entries(ids)
                .map(
                    ([name, id]) =>
                        `'${name}', exists (select 1 from auth.users where id = '${id}')`,
                )
                .join(', ')})`,
        );
        assert.deepEqual(result, {
            abandoned: false,
            abandonedReset: false,
            recentCode: true,
            recentReset: true,
            neverSent: true,
            noIdentity: true,
            alsoGitHub: true,
            confirmed: true,
        });
    });

    // What PRD section 12.2 says goes with the account: its identity, its
    // sessions, and its one-time tokens, which hold its address.
    test('takes the account’s identity, sessions and one-time tokens with it', () => {
        const id = randomUUID();
        const session = randomUUID();
        const result = probe(
            `insert into auth.users (id, confirmation_sent_at) values ('${id}', now() - interval '2 days');
             insert into auth.identities (provider_id, user_id, identity_data, provider)
             values ('${id}', '${id}', '{}'::jsonb, 'email');
             insert into auth.sessions (id, user_id) values ('${session}', '${id}');
             insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to)
             values (gen_random_uuid(), '${id}', 'confirmation_token', 'cleanup-probe', 'abandoned@example.test');
             ${run(SIGN_UP_JOB)}`,
            `jsonb_build_object(
                'identity', exists (select 1 from auth.identities where user_id = '${id}'),
                'session', exists (select 1 from auth.sessions where id = '${session}'),
                'token', exists (select 1 from auth.one_time_tokens where user_id = '${id}'))`,
        );
        assert.deepEqual(result, {
            identity: false,
            session: false,
            token: false,
        });
    });
});

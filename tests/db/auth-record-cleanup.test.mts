/**
 * Tests for the daily auth-record cleanup
 * (`20261003201942_schedule_auth_record_cleanup.sql`, Privacy FR-7, AC-8):
 * the job is scheduled, and its command deletes sign-in records over a day old
 * and sessions unused for 90 days while keeping recent ones.
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

const runJob = `execute (select command from cron.job where jobname = '${JOB}');`;

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
});

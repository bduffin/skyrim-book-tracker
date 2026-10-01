/**
 * Tests for the `ensure_rls` event trigger
 * (`20261001223138_enforce_rls_on_new_tables.sql`): a table created in
 * `public` gets row-level security without asking for it, a table elsewhere
 * does not, and the trigger's function has no API surface.
 *
 * Creating tables is DDL, which PostgREST cannot run, so these go through
 * `supabase db query --local` -- hard-coded to the local stack, and only after
 * `localStack()` has refused anything else. The CLI takes one statement per
 * call, so each probe is a single `do` block that creates its tables, reads
 * what it needs, and then raises an exception carrying the result. The raise
 * is what rolls everything back: no probe table outlives its test, even when
 * an assertion fails.
 */

import { execFileSync } from 'node:child_process';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anonClient, localStack } from './lib/stack.mjs';

const SENTINEL = 'rls-probe-result:';

/**
 * Runs `body` inside a `do` block whose last statement raises `result` -- a
 * jsonb expression the body can reach -- and returns it parsed. Anything else
 * the block raises is a genuine failure and is rethrown.
 */
function probe(body: string, result: string): Record<string, unknown> {
    const sql = `do $$ begin ${body} raise exception '${SENTINEL}%', (${result}); end $$`;

    let output: string;
    try {
        output = execFileSync('supabase', ['db', 'query', '--local', sql], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const { stdout = '', stderr = '' } = error as {
            stdout?: string;
            stderr?: string;
        };
        output = `${stdout}${stderr}`;
    }

    const at = output.indexOf(SENTINEL);
    if (at === -1) {
        throw new Error(`The probe did not reach its result:\n${output}`);
    }
    // The CLI wraps the message in its own JSON, so the result arrives with
    // its quotes escaped; it ends at the first unescaped quote or newline.
    const raw = output.slice(at + SENTINEL.length).split(/(?<!\\)"|\n/)[0];
    return JSON.parse(raw.replaceAll('\\"', '"'));
}

/** Whether RLS is enabled on each named table, as a jsonb object. */
function rlsOf(tables: string[]): string {
    const pairs = tables
        .map(
            (t) =>
                `'${t}', (select relrowsecurity from pg_class where oid = '${t}'::regclass)`,
        )
        .join(', ');
    return `jsonb_build_object(${pairs})`;
}

describe('RLS on new tables (ensure_rls)', () => {
    before(() => {
        localStack(); // throws unless the stack is local
    });

    test('a table created in public has RLS on, however it was created', () => {
        const result = probe(
            `create table public.rls_probe_plain (id int);
             create table public.rls_probe_as as select 1 as id;
             create table public.rls_probe_parted (id int) partition by range (id);`,
            rlsOf([
                'public.rls_probe_plain',
                'public.rls_probe_as',
                'public.rls_probe_parted',
            ]),
        );
        assert.deepEqual(result, {
            'public.rls_probe_plain': true,
            'public.rls_probe_as': true,
            'public.rls_probe_parted': true,
        });
    });

    // A positive control for the test above: a trigger that enabled RLS on
    // everything would pass it too, and would reach into schemas Supabase
    // manages.
    test('a table created outside public is left alone', () => {
        const result = probe(
            `create schema rls_probe_schema;
             create table rls_probe_schema.t (id int);`,
            rlsOf(['rls_probe_schema.t']),
        );
        assert.deepEqual(result, { 'rls_probe_schema.t': false });
    });

    // Supabase's own copy lived in public and was callable through
    // /rest/v1/rpc. PGRST202 is PostgREST's "no such function", as opposed to
    // a permission error, so it shows the name resolves to nothing at all.
    test('the function cannot be called through the API', async () => {
        const anon = anonClient(localStack());
        const { error } = await anon.rpc('rls_auto_enable');
        assert.equal(error?.code, 'PGRST202');
    });
});

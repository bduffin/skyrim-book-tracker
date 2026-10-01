-- Migration: enforce_rls_on_new_tables
--
-- Enables row-level security on every table created in `public`, as it is
-- created. A `public` table without RLS is readable and writable by anyone
-- holding the publishable key, through PostgREST; with RLS on and no policy,
-- anon and authenticated are denied everything. So a migration -- or a table
-- made in the dashboard -- that forgets `enable row level security` fails
-- closed instead of open. Every migration so far enables it explicitly; this
-- is the net under the next one that does not.
--
-- The hosted project already had a version of this that no migration created:
-- `public.rls_auto_enable()` and the `ensure_rls` event trigger, which match
-- Supabase's option to auto-enable RLS at project creation. This replaces it
-- with one the migrations own, so every environment -- the local stack, the
-- hosted project, and any project built from these files later -- has the same
-- net. The drops below remove Supabase's copy where it exists and do nothing
-- where it does not. It differs from that copy in three ways:
--
-- * SECURITY INVOKER, where Supabase's was SECURITY DEFINER. Whoever runs
--   `create table` owns the new table, so the caller can always enable RLS on
--   it itself, which is the test for not needing a definer function. The
--   definer copy was executable by anon and authenticated through
--   `/rest/v1/rpc` (Supabase Advisors lints 0028 and 0029).
-- * In the `private` schema, which PostgREST does not expose, with EXECUTE
--   revoked -- so it has no API surface at all, not merely a harmless one.
-- * Fails closed. Supabase's caught any error, logged it, and let the
--   `create table` succeed without RLS, which is the outcome this exists to
--   prevent. Here an error aborts the statement that created the table.
--
-- Event triggers need no superuser here: on Supabase the non-superuser
-- `postgres` role may create them, which is how the hosted copy came to be
-- owned by `postgres`. Checked on the local stack before this was written.
--
-- The trigger fires only on the three table-creating tags, so the `alter table`
-- it issues does not fire it again.

drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

create schema if not exists private;
-- Not exposed through PostgREST (config.toml's api.schemas lists public and
-- graphql_public), and nothing outside the database has any business in it.
revoke all on schema private from public, anon, authenticated;

create function private.rls_auto_enable()
returns event_trigger
language plpgsql
security invoker      -- the default; stated so the next reader need not know that
set search_path = ''  -- no mutable search_path; catalog references are qualified
as $$
declare
  cmd record;
begin
  for cmd in
    select *
      from pg_catalog.pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
       and object_type in ('table', 'partitioned table')
       and schema_name = 'public'
  loop
    -- object_identity is already quoted and schema-qualified.
    execute pg_catalog.format(
      'alter table %s enable row level security', cmd.object_identity
    );
  end loop;
end $$;

-- The roles that create tables in `public` are `postgres`, which owns this
-- function, and superusers, so none needs a grant. Postgres grants EXECUTE to
-- PUBLIC on every new function, and Supabase's default privileges may grant
-- anon and authenticated directly, so all three are named.
revoke execute on function private.rls_auto_enable() from public, anon, authenticated;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.rls_auto_enable();

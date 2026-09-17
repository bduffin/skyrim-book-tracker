-- Migration: pin_set_updated_at_search_path
-- Silences Supabase Advisors lint 0011_function_search_path_mutable.
--
-- set_updated_at() shipped in 20260819040000_user_book.sql without a pinned
-- search_path, before replace_book_locations() established the convention. The
-- original migration is already applied to both the local stack and the linked
-- project, so this replaces the function rather than editing that file -- an
-- applied migration must keep describing what actually ran.
--
-- Severity, so nobody re-derives it later: this function is SECURITY INVOKER,
-- so a hijacked `now()` would execute as the caller and escalate nothing. It is
-- also not reachable -- shadowing a pg_catalog function requires creating one,
-- and neither anon nor authenticated holds CREATE on any schema. The fix is
-- consistency and defence in depth, not a live hole. It would stop being either
-- of those the moment this became SECURITY DEFINER, which is the scenario the
-- pin is really insuring against.
--
-- `now()` still resolves under an empty search_path: pg_catalog remains
-- implicitly searched. Only unqualified `public` references would break, and
-- this body has none.

create or replace function set_updated_at() returns trigger
  language plpgsql
  security invoker      -- the default; stated so the next reader need not know that
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- The triggers in 20260819040000_user_book.sql bind to this function by name,
-- so `create or replace` re-points them with no trigger changes needed.

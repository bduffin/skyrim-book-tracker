-- Migration: set_book_flags
-- Feature: Browse Books & Track Collection, Browse M3 (prd-browse-and-track.md FR-4)
--
-- The write path behind the read/collected toggles. It is a function rather
-- than a sequence of client calls because choosing between upsert and delete
-- is a read-modify-write: clearing the last true flag must *delete* the row,
-- since user_book_touched rejects one with both flags false, and whether a
-- flag is the last one depends on the row's current state. PostgREST cannot
-- hold a transaction across statements, so that decision has to happen inside
-- one call.
--
-- Only the flags passed change; a null argument leaves that flag as it is.
-- Toggling one never touches the other (FR-4).
--
-- Concurrency, so nobody re-derives it:
--
-- * An existing row is locked with `for update` before anything is decided,
--   so two toggles on the same book serialize. If the first deletes the row,
--   the second's select re-reads after the lock is released, finds nothing,
--   and inserts -- which is the right answer.
-- * An absent row cannot be locked, so two first toggles on the same book can
--   both reach the insert. The loser's `on conflict` update therefore sets only
--   the flag it was asked to change, falling back to the stored value for the
--   other, rather than writing the pair it computed from a row it never saw.
--   `returning` reports what was actually stored.
-- * That update can never produce an all-false row: the insert branch is only
--   reached when a flag is true, and a true flag either came from an argument
--   (which the update writes) or from a row this call has locked.

create function public.set_book_flags(
  p_book_id      uuid,
  p_is_read      boolean default null,
  p_is_collected boolean default null
)
returns table (is_read boolean, is_collected boolean)
language plpgsql
security invoker      -- the default; stated so the next reader need not know that.
                      -- RLS on user_book applies to the caller, and the policies
                      -- are what enforce ownership (NFR-3).
set search_path = ''  -- no mutable search_path; tables are schema-qualified below
as $$
#variable_conflict use_column
declare
  -- From the session, never from an argument (R5). The owner-only policies
  -- would reject another user's id anyway; this is the second of the two
  -- places identity is enforced.
  v_user_id      uuid := (select auth.uid());
  v_is_read      boolean;
  v_is_collected boolean;
begin
  if v_user_id is null then
    raise exception 'set_book_flags requires a signed-in user'
      using errcode = '42501';  -- insufficient_privilege
  end if;

  if p_book_id is null then
    raise exception 'p_book_id must not be null'
      using errcode = '22004';  -- null_value_not_allowed
  end if;

  -- Rejected rather than treated as a no-op: the caller always means to change
  -- something, so a call that changes nothing is a bug worth surfacing.
  if p_is_read is null and p_is_collected is null then
    raise exception 'set_book_flags needs p_is_read, p_is_collected or both'
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  select ub.is_read, ub.is_collected
    into v_is_read, v_is_collected
    from public.user_book ub
   where ub.user_id = v_user_id
     and ub.book_id = p_book_id
     for update;

  -- No row reads as both false: untouched (Decision #4).
  v_is_read      := coalesce(p_is_read, v_is_read, false);
  v_is_collected := coalesce(p_is_collected, v_is_collected, false);

  if not (v_is_read or v_is_collected) then
    -- Also the path for clearing a flag on an untouched book, where there is
    -- nothing to delete and the result is already both-false.
    delete from public.user_book ub
     where ub.user_id = v_user_id
       and ub.book_id = p_book_id;
  else
    insert into public.user_book as ub (user_id, book_id, is_read, is_collected)
    values (v_user_id, p_book_id, v_is_read, v_is_collected)
    on conflict (user_id, book_id) do update
       set is_read      = coalesce(p_is_read, ub.is_read),
           is_collected = coalesce(p_is_collected, ub.is_collected)
    returning ub.is_read, ub.is_collected
         into v_is_read, v_is_collected;
  end if;

  return query select v_is_read, v_is_collected;
end $$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase's default
-- privileges additionally grant it to anon and authenticated directly, so
-- revoking from PUBLIC alone would leave both able to call it. Revoke all
-- three, then hand it back to the one role that should have it: tracking needs
-- a signed-in user, so anon has no business calling this even though the
-- auth.uid() check above would stop it.
revoke execute on function public.set_book_flags(uuid, boolean, boolean) from public;
revoke execute on function public.set_book_flags(uuid, boolean, boolean) from anon, authenticated;
grant  execute on function public.set_book_flags(uuid, boolean, boolean) to authenticated;

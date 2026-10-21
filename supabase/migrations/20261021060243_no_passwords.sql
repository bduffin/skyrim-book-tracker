-- Migration: no_passwords
--
-- No account can hold a password (Email FR-6, Email Decision 3). Supabase
-- cannot turn passwords off while its Email provider is on: `/auth/v1/signup`
-- always accepts one, and a signed-in user can add one through
-- `PUT /auth/v1/user`. Left alone, that lets someone sign an address up with a
-- password of their choosing before its owner arrives; the owner's later code
-- confirms that same account, and the attacker's password then works
-- (confirmed on the local stack, 2026-10-05). Supabase also stores a random
-- password on every account a code sign-in creates.
--
-- This clears the password on every row Supabase Auth writes, which closes all
-- of those at once: Auth refuses a password sign-in outright when the stored
-- password is null, before comparing anything, and nothing hashes to null.
--
-- * BEFORE, assigning `new` only. It never writes the table, so it cannot fire
--   itself, and it cannot fail on a row of any shape.
-- * Every insert and every update, not only `update of encrypted_password`:
--   Auth writes whole rows as well as single columns.
-- * SECURITY INVOKER. The caller is Auth's own role, `supabase_auth_admin`,
--   which owns `auth.users` and so can always write the row it is writing;
--   nothing here needs more than that. It is the one role granted EXECUTE,
--   and `USAGE` on `private`, which it had none of.
-- * In `private`, which PostgREST does not expose, with EXECUTE revoked from
--   `anon` and `authenticated` by name: Supabase's default privileges grant
--   them EXECUTE directly, beyond what revoking from `public` removes.
--
-- It depends on a column of Supabase's own table, so `no-passwords.test.mts`
-- checks that the column exists and that a password sign-in is refused, and
-- fails if a Supabase upgrade changes either.

grant usage on schema private to supabase_auth_admin;

create function private.clear_password()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.encrypted_password := null;
  return new;
end;
$$;

revoke execute on function private.clear_password() from public, anon, authenticated;
grant execute on function private.clear_password() to supabase_auth_admin;

create trigger users_no_password
  before insert or update on auth.users
  for each row execute function private.clear_password();

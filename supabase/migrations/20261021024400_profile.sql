-- Migration: profile
-- Feature: User Profiles, Profiles M1 (Profiles FR-1 to FR-3; prd-profiles.md
-- §12, technical design)
--
-- One row per user who has completed setup, holding their public/private
-- choice and, from Profiles M2, an optional username. The whole table ships
-- here, username column and all, so Profiles M2 needs no migration.
--
-- A row is created only by the setup form's Server Action, running as the user
-- under the insert policy below (Profiles Decision 1). There is no trigger on
-- auth.users: one would run as the auth admin and need a security definer
-- function to write here, and would create a row -- and so a visibility -- for
-- every sign-up whether or not they ever chose one. So the absence of a row
-- means "has not chosen", which every reader treats as private (Profiles FR-3).
--
-- Public rows are readable by anon. That is what lets Browse M6's public-read
-- policy on user_book ask "does a public profile exist for this user?" without
-- a definer function, and what will let a signed-out visitor resolve a public
-- username. Whatever this table holds is therefore published for every public
-- account (Profiles NFR-1), which is why it has no timestamps (Profiles FR-1)
-- and why select is granted column by column below.

create table public.profile (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Required and deliberately without a default: a row exists only once the
  -- user has submitted the choice, so the database never picks it for them.
  is_public  boolean not null,
  -- Optional. Lowercase only, so the unique index below is case-insensitive
  -- without citext; never 36 characters, so never mistaken for a UUID.
  username   text
             constraint profile_username_format check (username ~ '^[a-z0-9_-]{3,30}$')
);

comment on table public.profile is
  'Public rows are readable by anon: every granted column is published. '
  'Grant select per column; anything not safe to publish goes in its own '
  'owner-only table.';

-- Nulls are distinct by default, so any number of users can have no username.
create unique index profile_username_key on public.profile (username);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profile enable row level security;

-- Rows, not columns: a private user's row does not exist for anyone else, so
-- a username lookup cannot tell "private" from "never registered" (Profiles
-- Decision 3).
create policy profile_select_public_or_own on public.profile
  for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);

create policy profile_insert_own on public.profile
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy profile_update_own on public.profile
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy: the row goes when the auth user does (on delete cascade).

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────

-- Supabase's default privileges grant anon and authenticated everything on a
-- new table, truncate included, which RLS does not govern. Revoked, then
-- granted back per column, so a column added later is unpublished until a
-- migration grants it -- the grant is where publication is decided (Profiles
-- NFR-1).
--
-- user_id is updatable only so an upsert may name it in its update half; the
-- update policy's with check pins it to auth.uid(), so the one value it can be
-- set to is the one it already holds.
revoke all on public.profile from anon, authenticated;
grant select (user_id, is_public, username) on public.profile to anon, authenticated;
grant insert (user_id, is_public, username) on public.profile to authenticated;
grant update (user_id, is_public, username) on public.profile to authenticated;

-- Migration: 0001_user_book
-- Feature: Browse Books & Track Collection (see docs/specs/prd-browse-and-track.md §12)
--
-- Adds per-user book tracking with a three-state status model:
--   unread -> read -> collected   ('collected' implies 'read')
--
-- 'unread' is NOT a stored value: it is the absence of a user_book row.
-- Reverting a book to 'unread' deletes the row. Adding 'unread' to the enum
-- later (OQ-8, to preserve notes) is a non-breaking `ALTER TYPE ... ADD VALUE`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Status enum
-- ─────────────────────────────────────────────────────────────────────────────
create type user_book_status as enum ('read', 'collected');

-- ─────────────────────────────────────────────────────────────────────────────
-- PLACEHOLDER reference tables.
--
-- These are owned by the separate UESP import task and WILL be replaced before
-- real data lands (skill/category normalization is still TBD — M2/OQ-2/OQ-8).
-- They exist here only so user_book's foreign keys resolve and the read-path
-- join compiles. Do not build durable assumptions on these columns yet.
-- ─────────────────────────────────────────────────────────────────────────────
create table book (
  id          uuid primary key default gen_random_uuid(),
  game_id     text unique,                       -- UESP / in-game identifier
  title       text not null,
  category    text not null,                     -- PLACEHOLDER: normalize later (OQ-8)
  skill       text,                              -- PLACEHOLDER: normalize later (M2)
  description text,
  is_unique   boolean not null default false
);

create table book_location (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references book (id) on delete cascade,
  location_name text not null,
  location_type text,                            -- e.g. dungeon | city | house
  notes         text
);

create index book_location_book_idx on book_location (book_id);

-- Catalog ordering / pagination (default title A→Z — M4) and filter columns.
create index book_title_idx    on book (title);
create index book_skill_idx    on book (skill);
create index book_category_idx on book (category);

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user tracking
-- ─────────────────────────────────────────────────────────────────────────────
create table user_book (
  user_id    uuid not null references auth.users (id) on delete cascade,
  book_id    uuid not null references book (id)        on delete cascade,
  status     user_book_status not null,
  notes      text,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)                 -- one row per (user, book)
);

-- Read path: fetch the current user's rows for the 50 visible books.
create index user_book_user_idx on user_book (user_id);
-- Progress counts per user, filtered by status.
create index user_book_user_status_idx on user_book (user_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger user_book_set_updated_at
  before update on user_book
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- user_book: owner-only, all verbs. The `with check` clauses are what stop a
-- client from writing another user's user_id (defense in depth alongside the
-- Server Action deriving user_id from the session).
alter table user_book enable row level security;

create policy user_book_select_own on user_book
  for select using ((select auth.uid()) = user_id);

create policy user_book_insert_own on user_book
  for insert with check ((select auth.uid()) = user_id);

create policy user_book_update_own on user_book
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

create policy user_book_delete_own on user_book
  for delete using ((select auth.uid()) = user_id);

-- Reference tables: public read, no client write (NFR-3).
-- The import task uses the service-role key, which bypasses RLS.
alter table book          enable row level security;
alter table book_location enable row level security;

create policy book_public_read          on book          for select using (true);
create policy book_location_public_read on book_location for select using (true);

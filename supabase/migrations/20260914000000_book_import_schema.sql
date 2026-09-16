-- Migration: book_import_schema
-- Feature: Import UESP Book Data (see docs/specs/prd-import-uesp-books.md §12)
--
-- Reshapes the placeholder book table around what the UESP dump actually
-- provides. Safe to do destructively: both tables are still empty.

-- ── Identity ─────────────────────────────────────────────────────────────────
-- The MediaWiki page id, not the Creation Kit Form ID. Measured against the
-- 2026-08-30 dump: 1,198 of 1,207 books carry a |id= value but only 1,120 are
-- distinct -- Creation Club items render as `fexxx8NN` placeholders (fexxx819
-- alone is shared by 11 pages) and DLC items as `xx......`. Upserting on that
-- would silently merge ~44 distinct books. Page ids are unique by construction.
alter table book add column uesp_page_id integer;
alter table book add constraint book_uesp_page_id_unique unique (uesp_page_id);
alter table book alter column uesp_page_id set not null;

-- game_id demotes from key to attribute: still useful, no longer trusted to be
-- unique, and null on 9 pages (1 omits the |id= key, 8 supply it empty).
alter table book drop constraint if exists book_game_id_key;
alter table book add column game_id_extra text[]; -- |id2..|id5, 6 pages

-- ── Attributes ───────────────────────────────────────────────────────────────
alter table book add column uesp_title       text not null;  -- 'Skyrim:Deathbrand (book)'
alter table book add column source           text not null;
alter table book add column icon             text;
alter table book add column author           text;
-- text, not integer: 3 pages carry dual values (`65 (Skill Book)<br>6 (Normal)`
-- on Vernaccus and Bourlor, `20 / 5` on Fragment: On Artaeum), two of them skill
-- books where the distinction is real. An integer column would fail those inserts.
alter table book add column value            text;           -- base gold, verbatim from the source
alter table book add column weight           numeric(6, 2);  -- 1.0 most books, 0 notes
alter table book add column lorename         text;   -- null when the source says 'none' (734 pages)
alter table book add column errata           text;   -- |textnote: variants, duplicate ids, naming errors (51)
alter table book add column gameplay_note    text;   -- |comment: quest relevance, links to other books (48)
alter table book add column series_up        text;
alter table book add column series_prev      text;
alter table book add column series_next      text;
alter table book add column is_quest_related boolean not null default false;
alter table book add column artifact_type    text;           -- |artifacttype from {{Artifact Summary}}

-- CURATED, not derived (FR-6c). `true` means "nothing has marked this
-- otherwise", NOT "verified obtainable" -- do not trust it as complete.
-- Exactly one book is false today: Skyrim:Shalidor's Insights (unused pages),
-- a page documenting cut game assets that would otherwise sit in the default
-- browse scope as an un-completable base-game book. No index: at ~1,200 rows a
-- sequential scan beats an index lookup.
alter table book add column is_obtainable boolean not null default true;

-- is_unique has no source parameter in {{Game Book}} (R10/OQ-2). Unknown must
-- not be stored as false, so the not-null default is removed.
alter table book alter column is_unique drop not null;
alter table book alter column is_unique drop default;

alter table book add constraint book_category_valid
  check (category in ('skill_book', 'book', 'journal', 'note', 'black_book', 'treasure_map'));

alter table book add constraint book_source_valid
  check (source in ('base', 'dawnguard', 'dragonborn', 'hearthfire', 'creation_club'));

alter table book add constraint book_skill_valid
  check (
    skill is null
    or skill in (
      'One-Handed', 'Two-Handed', 'Archery', 'Block', 'Smithing',
      'Heavy Armor', 'Light Armor', 'Alteration', 'Conjuration',
      'Destruction', 'Illusion', 'Restoration', 'Enchanting',
      'Alchemy', 'Sneak', 'Lockpicking', 'Pickpocket', 'Speech'
    )
  );

-- A skill book without a skill is a parse failure, not valid data (AC-2) -- with
-- exactly one legitimate exception. The Oghma Infinium grants +5 across six
-- skills in a chosen path, so {{Game Book}}'s single-valued |skill= is empty on
-- it; it is identified instead by |artifacttype=Daedric Artifact. Measured: one
-- book in 1,207 carries artifact_type, and it is that one.
alter table book add constraint book_skill_book_has_skill
  check (category <> 'skill_book' or skill is not null or artifact_type is not null);

-- The check above permits a null-skill skill book; this index permits only ONE.
-- A second is never valid data -- unlike the book_location case, where repeated
-- location names are legitimate -- so it belongs at write time, not only in the
-- run report. Indexing `category` (constant under the predicate) rather than a
-- constant expression keeps this a plain, unambiguous partial unique index.
-- Note the failure mode: a violation aborts the whole ~500-book upsert chunk
-- rather than logging one row. That is the intent -- the data is wrong, loudly.
create unique index book_single_null_skill_idx
  on book (category)
  where category = 'skill_book' and skill is null;

create index book_source_idx    on book (source);
create index book_quest_rel_idx on book (is_quest_related) where is_quest_related;

-- ── Locations ────────────────────────────────────────────────────────────────
-- NO unique constraint on book_location. Replacement (FR-13) is the idempotency
-- mechanism, so no conflict target is needed -- and a unique constraint here
-- would reject valid data: 15 books legitimately list the same place twice with
-- different notes (e.g. `Alduin is Real` -> College of Winterhold/Arcanaeum AND
-- College of Winterhold/Arch-Mage's Quarters). Both rows share a location_type,
-- so unique (book_id, location_name, location_type) makes the second illegal,
-- and because the insert runs inside replace_book_locations(), one violation
-- rolls back the whole chunk -- including its delete -- leaving every book in
-- that chunk on stale locations. Duplicate (name, notes) pairs are deduped in
-- the script instead (FR-11).
--
-- book_location_book_idx is therefore KEPT: with no unique index to cover it,
-- it is the only index on the book_id foreign key, serving both lookups and the
-- on-delete cascade.

-- Batched, atomic location replacement. PostgREST cannot span statements
-- transactionally, so delete-then-insert must live in the database; and calling
-- it once per book would mean 1,207 round trips for 2,327 location rows
-- across 1,050 books, so it takes a batch.
--
-- Scope matters: the delete is limited to the book_ids present in the payload,
-- so books absent from this call (ones that failed to parse) keep their existing
-- locations untouched. A book WITH no locations must still be included, with an
-- empty array -- that is what clears rows for a book whose loc field was removed
-- upstream.
create or replace function replace_book_locations(p_books jsonb)
returns integer
language plpgsql
security invoker          -- the caller's RLS applies; the import runs as service_role
set search_path = ''      -- no mutable search_path; tables are schema-qualified below
as $$
declare
  v_book_ids uuid[];
  v_inserted integer;
begin
  select array_agg((b->>'book_id')::uuid)
    into v_book_ids
    from jsonb_array_elements(p_books) as b;

  delete from public.book_location where book_id = any(v_book_ids);

  insert into public.book_location (book_id, location_name, location_type, notes)
  select (b->>'book_id')::uuid,
         l->>'location_name',
         l->>'location_type',
         l->>'notes'
    from jsonb_array_elements(p_books) as b
   cross join lateral jsonb_array_elements(
           case when jsonb_typeof(b->'locations') = 'array'
                then b->'locations' else '[]'::jsonb end) as l;

  -- jsonb_typeof guard, not coalesce: coalesce only swaps SQL NULL, so an
  -- explicit JSON `"locations": null` would still reach jsonb_array_elements
  -- and throw, rolling back the chunk. An empty p_books makes array_agg
  -- return SQL NULL, so `= any(NULL)` deletes nothing -- a no-op, as intended.
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase's
-- anon/authenticated roles inherit that. An anonymous call would currently fail
-- anyway -- book_location has RLS enabled with only a public SELECT policy, so
-- the delete and insert are denied -- but that safety rests on a policy being
-- *absent* rather than on an explicit grant, which is the wrong thing to depend
-- on. Deny by default and hand EXECUTE only to the role the import runs as.
revoke execute on function replace_book_locations(jsonb) from public;
revoke execute on function replace_book_locations(jsonb) from anon, authenticated;
grant  execute on function replace_book_locations(jsonb) to service_role;

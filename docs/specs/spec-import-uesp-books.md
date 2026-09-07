# Spec: Import UESP Book Data

> Stage: Draft — awaiting review before PRD generation.

---

## Problem Thesis

The `book` and `book_location` tables exist (migration `20260819040000_user_book.sql`) but are empty — nothing populates them yet. The app can't browse or track anything until this data exists. UESP is the canonical source, but it must be accessed via their sanctioned bulk-download mechanism, not live scraping: their `robots.txt` explicitly disallows the MediaWiki API and bot crawling for all agents, and specifically names Anthropic crawlers (`anthropic-ai`, `ClaudeBot`, `Claude-Web`) as disallowed from the entire site.

---

## Current State

- `book` (id, game_id, title, category, skill, description, is_unique) and `book_location` (id, book_id, location_name, location_type, notes) exist and are empty.
- No import tooling exists yet.
- UESP publishes a weekly full-wiki XML dump at `dumps.uesp.net` — current revisions only, all namespaces, no images, no revision history (~176MB compressed as of the most recent dump).
- Individual Skyrim book pages use a documented `{{Book Summary}}`-style template (see `UESPWiki:Style_Guide/Book_Layout`) with fields including `id` (Creation Kit ID), `skill`, `weight`, `value`, and `loc` (location(s)).
- `book.category` and `book.skill` are untyped placeholder `text` columns pending normalization — this is tracked as OQ-2 (skill) and OQ-8 (category) in `docs/specs/prd-browse-and-track.md`.
- Live scraping (API or HTML crawling) is not an option — see Problem Thesis.

---

## Desired State

A repeatable, local, dump-file-based import script that:

1. Reads a manually-downloaded UESP XML dump.
2. Filters it down to Skyrim book pages.
3. Parses each page's `Book Summary` template into structured fields.
4. Normalizes `skill` and `category` into small, fixed sets of values.
5. Upserts the result into `book`/`book_location` using the Supabase service-role key.
6. Is safely re-runnable — running it again (same dump or a newer one) updates existing rows rather than duplicating them.

---

## Source Material

- Data source: [dumps.uesp.net](https://dumps.uesp.net) (weekly XML dump)
- Book page template structure: [UESPWiki:Style Guide/Book Layout](https://en.uesp.net/wiki/UESPWiki:Style_Guide/Book_Layout)
- License: [UESPWiki:Copyright and Ownership](https://en.uesp.net/wiki/UESPWiki:Copyright_and_Ownership) — CC BY-SA 2.5
- Schema: `supabase/migrations/20260819040000_user_book.sql` (`book`, `book_location` tables)
- Open questions this resolves: `docs/specs/prd-browse-and-track.md` OQ-2 (skill normalization), OQ-8 (category taxonomy)

---

## Constraints

- No live requests to UESP's web servers or API — dump-file based only (`robots.txt` disallows bot/API access and specifically names Anthropic crawlers).
- Metadata only — no full book text stored (architecture.md §2.2, PRD NG6). This is a licensing/scope constraint already established, not new to this task.
- CC BY-SA 2.5 attribution required in the UI and README (PRD FR-7) — this task should record the source dump's date for that attribution and for provenance.
- Import writes use the Supabase **service-role key** (bypasses RLS) — never the app's normal Server Action path, since this is an offline/admin operation, not a user action.
- The script is a one-off local dev tool, not part of the deployed Next.js app's runtime.
- The dump file itself (~176MB) is not committed to the repo.

---

## Requirements

**Must-have:**

- [ ] Script accepts a path to a downloaded UESP XML dump file.
- [ ] Filters the dump to Skyrim book pages (title prefix and/or category membership).
- [ ] Parses `Book Summary` template fields (`id`, `skill`, `loc`, etc.) per page.
- [ ] Maps parsed data onto the `book`/`book_location` schema columns.
- [ ] Normalizes `skill` to a fixed set of valid Skyrim skill names (resolves OQ-2).
- [ ] Normalizes `category` to a fixed, small taxonomy (resolves OQ-8).
- [ ] Upserts on `book.game_id` as the natural idempotency key — re-running never duplicates rows.
- [ ] Adds a unique constraint on `book_location(book_id, location_name, location_type)` (new migration) and upserts against it — re-running never duplicates location rows.
- [ ] Reads the service-role key from environment, never commits it.
- [ ] Logs a run summary: books found, imported, updated, skipped, errored.

**Nice-to-have (out of scope for this spec):**

- Cover art / image import.
- Full book text storage (excluded on licensing grounds, not just scope).
- Scheduled/automatic re-running (cron, CI) — manual invocation is fine for now.
- Importing books from other TES games (Oblivion, Morrowind, ESO, etc.).

---

## Assumptions

- A human downloads the dump file manually and periodically; the script itself never fetches it.
- `book.id` (uuid) stays internally generated; `book.game_id` (the UESP/Creation Kit ID) is the natural key used for upsert idempotency.
- A book's `loc` field may list multiple locations — each becomes its own `book_location` row.
- Some books will have missing or ambiguous fields (no skill, no known location) — these should still import with nulls where appropriate rather than failing the whole run.
- The dump's category/title conventions are stable enough to reliably identify "Skyrim book pages" as a set.

---

## Success Criteria

1. Running the script against a current dump populates `book` with the large majority of Skyrim's ~800 books (the "/820" figure referenced in the PRD's progress bar).
2. Every imported book has a resolved `category` from the fixed taxonomy; skill books have a non-null, normalized `skill`.
3. Books with known locations have corresponding `book_location` rows.
4. Re-running the script against the same or a newer dump produces no duplicate `book` rows.
5. No network requests are made to `en.uesp.net` during script execution — dump-file input only.
6. The source dump's date and UESP's CC BY-SA 2.5 license are recorded (script comment/log or README) for attribution.

---

## Decisions

| #   | Question                      | Decision                                                                                                                                                                                                                                               |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Data source mechanism         | UESP's sanctioned weekly XML dump (`dumps.uesp.net`), not live scraping or the MediaWiki API — `robots.txt` disallows both and specifically names Anthropic bots.                                                                                      |
| 2   | Idempotency key               | `book.game_id` (UESP/Creation Kit ID) — upsert on conflict, never insert-only.                                                                                                                                                                         |
| 3   | Where the script lives        | A one-off local script (e.g. `scripts/import-uesp.ts`), run manually via `tsx`; not part of the deployed app.                                                                                                                                          |
| 4   | Full book text                | Never stored — metadata only, per the existing licensing-driven scope constraint (NG6).                                                                                                                                                                |
| 5   | `book_location` idempotency   | Add a unique constraint on `(book_id, location_name, location_type)` (migration required) and upsert against it — preserves row identity across re-runs rather than delete-and-reinsert.                                                               |
| 6   | `location_type` normalization | Left as free text, not normalized. Not part of OQ-2/OQ-8, and no current feature (per `prd-browse-and-track.md`) filters or groups by it — the detail page that would show it is deferred (NG1). Revisit only if a future feature needs it as a facet. |

# Spec: Import UESP Book Data

> Stage: Verified against a real dump. See `docs/specs/prd-import-uesp-books.md` for the implementation plan; this file holds the problem, scope and decisions.

---

## Problem Thesis

The `book` and `book_location` tables exist (migration `20260819040000_user_book.sql`) but are empty — nothing populates them yet. The app can't browse or track anything until this data exists. UESP is the canonical source, but it must be accessed via their sanctioned bulk-download mechanism, not live scraping: their `robots.txt` explicitly disallows the MediaWiki API and bot crawling for all agents, and specifically names Anthropic crawlers (`anthropic-ai`, `ClaudeBot`, `Claude-Web`) as disallowed from the entire site.

---

## Current State

- `book` (id, game_id, title, category, skill, description, is_unique) and `book_location` (id, book_id, location_name, location_type, notes) exist and are empty. Both are placeholders and need reshaping before real data lands.
- No import tooling exists yet.
- UESP publishes a weekly full-wiki XML dump at `dumps.uesp.net` — current revisions only, all namespaces, no images, no revision history. The current file is `uespwiki-2026-08-30-current.xml.bz2`, **177MB, bzip2-compressed**, MediaWiki 1.31.16, export schema 0.10. The filename encodes the dump date.
- Skyrim lives in **namespace 134**, a real MediaWiki namespace with 17,515 pages. DLC books are in it too — no separate DLC namespace.
- In-game book pages use the **`{{Game Book}}`** template — **1,207 pages** in ns 134. A separate `{{Game Book Compilation}}` template marks 38 series index pages, which are not obtainable books and are excluded. Its well-populated fields are `value` and `weight` (1,206 each), `id` (1,198), `icon`, `lorename`, `description` (462 on the page, 573 after the lore-page fallback), `author` (461 → 571), `quest`, `type` (259), `sumtitle`, `questrel`, `up`/`next`/`prev`, `skill` (90 — plus the Oghma Infinium, which raises six skills and is identified by `artifacttype` instead).
- Two adjacent namespaces are **not** what this task wants: ns 130 (`Lore:`) holds 4,035 `{{Lore Book}}` pages — the shared book _text_ across all TES games — and ns 140 (`Books:`) holds real-world published novels under `{{Real Book Summary}}`.
- `book.category` and `book.skill` are untyped placeholder `text` columns pending normalization — `docs/specs/prd-browse-and-track.md` FR-3 depends on this task fixing both.
- Live scraping (API or HTML crawling) is not an option — see Problem Thesis.

---

## Desired State

A repeatable, local, dump-file-based import script that:

1. Reads a manually-downloaded UESP XML dump, streaming and decompressing it without expanding it to disk.
2. Filters to Skyrim in-game book pages: namespace 134 **and** a `{{Game Book}}` invocation.
3. Parses each page's template into structured fields.
4. Classifies each book into a fixed category and a fixed content source, and normalizes `skill`.
5. Writes to `book`/`book_location` using the Supabase service-role key, guarded against hitting the wrong database.
6. Is safely re-runnable — the same dump or a newer one updates rows in place, never duplicating them, and converges location sets to what the dump says.

---

## Source Material

- Data source: [dumps.uesp.net](https://dumps.uesp.net) — weekly full-wiki XML dump, downloaded by a human via a browser (a plain `curl` is refused).
- Book page template: [Template:Game Book](https://en.uesp.net/wiki/Template:Game_Book)
- License: [UESPWiki:Copyright and Ownership](https://en.uesp.net/wiki/UESPWiki:Copyright_and_Ownership) — CC BY-SA 2.5
- Schema: `supabase/migrations/20260819040000_user_book.sql` (`book`, `book_location` tables)
- Resolves for `docs/specs/prd-browse-and-track.md` FR-3: the normalized `skill` set and the `category` taxonomy its filters are built on

---

## Constraints

- No live requests to UESP's web servers or API **from the script** — dump-file input only. The human download is the sanctioned input to this task; `robots.txt` binds automated crawlers.
- Metadata only — no full book text stored. This is a **scope** decision, not a licensing prohibition: CC BY-SA 2.5 permits redistribution with attribution and share-alike, and architecture.md §2.2 contemplates it. The text lives in ns 130, which this task never reads.
- CC BY-SA 2.5 attribution required in the UI and README (`prd-browse-and-track.md` FR-7) — this task records the source dump's date and licence for that attribution and for provenance.
- Import writes use the Supabase **service-role key** (bypasses RLS) — never the app's normal Server Action path, since this is an offline/admin operation. Because that key bypasses RLS, the script must refuse to write to a non-localhost database without an explicit opt-in flag.
- The script is a one-off local dev tool, not part of the deployed Next.js app's runtime.
- The dump file (177MB) is never committed; `/data/` is gitignored.
- `bzip2` must be on `PATH`. No special Postgres version is required — the `nulls not distinct` dependency went away with the `book_location` unique constraint.

---

## Requirements

**Must-have:**

- [ ] Script accepts a path to a downloaded UESP XML dump file, streamed and decompressed by detecting compression from the file's magic bytes rather than its extension.
- [ ] Filters to namespace 134 pages invoking `{{Game Book}}`, ignoring HTML comments, `<nowiki>` blocks and redirects.
- [ ] Parses `{{Game Book}}` fields per page with a brace- and link-aware parser (a `|` inside `[[…|…]]` is not a parameter separator).
- [ ] Maps parsed data onto the `book`/`book_location` schema, importing the template's full attribute set rather than a minimal subset.
- [ ] Upserts on the MediaWiki page id as the identity key — re-running never duplicates rows.
- [ ] Normalizes `skill` to a fixed set of valid Skyrim skill names (`prd-browse-and-track.md` FR-3).
- [ ] Classifies `category` into a fixed taxonomy and `source` into base / DLC / Creation Club (`prd-browse-and-track.md` FR-3).
- [ ] Replaces each successfully parsed book's location set atomically, so locations removed upstream disappear.
- [ ] Reads the service-role key from environment, never commits it, and refuses to write to a remote database without an explicit flag.
- [ ] Logs a run summary broken down by category and source: found, new, updated, skipped, errored.

**Nice-to-have (out of scope for this spec):**

- Cover art / image import (the `icon` filename is stored; no image is fetched).
- Full book text storage.
- Scheduled/automatic re-running (cron, CI) — manual invocation is fine for now.
- Books from other TES games — namespace 134 excludes them for free.
- Spell tomes and recipes, which are consumable item pages under a different template.

---

## Assumptions

- A human downloads the dump file manually and periodically; the script itself never fetches it.
- `book.id` (uuid) stays internally generated; the MediaWiki page id is the natural key used for upsert idempotency.
- A book's `loc` field lists locations as a `*`-bulleted list, each with free-text placement notes after the location name — each becomes its own `book_location` row.
- Some books have missing or ambiguous fields (no skill, no location, no Form ID) — these still import, with nulls, rather than failing the run.
- Namespace 134 plus a `{{Game Book}}` invocation reliably identifies the catalog.

---

## Success Criteria

1. Running the script against a current dump imports ~1,207 books — 881 base + DLC (684 base, 136 Dragonborn, 51 Dawnguard, 10 Hearthfire) plus 326 Creation Club.
2. Every imported book has a category from the fixed taxonomy and a source from the fixed set; every skill book has a non-null, normalized `skill`.
3. Books with known locations have corresponding `book_location` rows, with placement notes populated.
4. Re-running against the same dump leaves `book_location` **identical** — equal row count and an equal multiset of `(page id, location_name, notes)`. Non-growth alone is not enough: replacement makes silent _shrinkage_ the failure mode to guard against.
5. No network requests are made to `en.uesp.net`/`dumps.uesp.net` during script execution — dump-file input only.
6. The source dump's date and UESP's CC BY-SA 2.5 license are recorded (run summary and README) for attribution.
7. Pointing the script at a remote Supabase URL without the explicit opt-in flag refuses to write.

---

## Decisions

| #   | Question                      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Data source mechanism         | UESP's sanctioned weekly XML dump (`dumps.uesp.net`), not live scraping or the MediaWiki API — `robots.txt` disallows both and specifically names Anthropic bots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | Identity / idempotency key    | The **MediaWiki page id** (`<page><id>`). The Creation Kit Form ID is not viable: of 1,198 pages carrying one, only 1,120 values are distinct, because Creation Club items render as `fexxx8NN` placeholders (one is shared by 11 pages). Form IDs are stored as non-unique attributes instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Where the script lives        | A one-off local script, `scripts/import-uesp.mts`, run manually via `tsx`; not part of the deployed app. `.mts` because the repo is otherwise CommonJS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Full book text                | Never stored — metadata only. A scope decision, not a licensing one (see Constraints).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | `book_location` idempotency   | **Replace per book**, inside a Postgres function so the delete and re-insert are one transaction. Replacement only runs for books that parsed successfully, so a parser regression cannot wipe good rows. Pure upsert was rejected: it never removes locations deleted upstream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | `location_type` normalization | Free text, carrying the FR-11 extraction tier — `place`, `carrier` or `nearby`. Not mapped to a curated taxonomy of place kinds. Recording the tier is what keeps `Carried by [[Assassins]]` distinguishable from an actual location. No current feature filters or groups by it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Category taxonomy             | `skill_book` (has `skill=`, or `artifacttype=` — the Oghma Infinium raises six skills so its single-valued `skill=` is empty), `black_book`, `treasure_map` (title-derived; no template field distinguishes them), `journal`, `note`, `book`. Order is load-bearing: `skill=` first (icon artwork is reused — the 25 magic-school skill books carry spell-tome icons), then `black_book`, then `note` (`note=1` **or** a Note-family icon — each signal misses what the other catches), then `journal`, then `book`. One tiebreak: a Journal-family icon **and** "Journal" in the title beats `note=1`, which correctly recovers the 2 of 8 ambiguous pages (`Sculptor Visthar's Journal`, `Urzog's Journal`) that are journals by name. Wiki categories can't be used: the template injects them at render time, so they aren't in the dump. |
| 8   | Quest relation                | A boolean flag, not a category — a skill book can also be quest-related, which a single-value taxonomy can't express.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 9   | Creation Club content         | Imported, but flagged via a `source` column (base / dawnguard / dragonborn / hearthfire / creation_club) so the UI can filter it. Detected from the category link, not `smod` — only 2 of 327 CC pages set `smod=CC`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | Wikitext parsing              | A local brace/link-aware parser, not `wtf_wikipedia` — despite the markup being non-trivial (95% of pages carry a piped `[[a\|b]]` link inside the template, 16% nest another template inside it). Chosen because the library ships fetch APIs that would violate the no-network constraint, and silently normalizes or drops params it doesn't recognize. The nesting is one level of simple inline templates, so a brace counter is bounded work.                                                                                                                                                                                                                                                                                                                                                                                           |
| 11  | Editorial text fields         | `textnote` → `errata` (variants, duplicate ids, naming errors) and `comment` → `gameplay_note` (quest relevance, links to other books). Two columns, not one: they are semantically different and never co-occur across 1,207 books.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | Filtering and collapsing      | Neither happens at import. UESP already collapses in-game variants to one page, and unobtainable/cut books are imported with their `errata` intact — prose-based exclusion misfires (it flags `Amaund Motierre's Sealed Letter`, a real quest item). Browse decides what to show, as it does for Creation Club.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

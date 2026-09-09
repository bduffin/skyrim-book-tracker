# PRD: Import UESP Book Data

> Stage: PRD — derived from `docs/specs/spec-import-uesp-books.md`, grounded in `docs/architecture.md`.
> Status: Rewritten against a real dump (`uespwiki-2026-08-30-current.xml.bz2`, 177MB, bzip2, MediaWiki 1.31.16, export schema 0.10). Every count below is measured from that file, not assumed.

## Core Thesis (preserved from spec)

> The `book` and `book_location` tables exist but are empty — nothing populates them yet. The app can't browse or track anything until this data exists. UESP is the canonical source, but it must be accessed via their sanctioned bulk-download mechanism, not live scraping.

---

## 0. What inspecting the dump changed

The previous draft was written before a dump existed. Nearly every structural assumption in it was wrong. This table is the record, so the same guesses aren't made again.

| Previous assumption                             | Measured reality                                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template is `{{Book Summary}}`                  | `{{Game Book}}`. `Book Summary` appears **once** in the entire wiki.                                                                                                                       |
| `Skyrim:` is a title prefix, namespace unknown  | Namespace **134**, a real MediaWiki namespace holding 17,515 pages.                                                                                                                        |
| Dump is `.gz`                                   | **`.bz2`** — the case the old FR-2 treated as an error.                                                                                                                                    |
| `--dump-date` must be supplied by hand          | The filename encodes it: `uespwiki-YYYY-MM-DD-current.xml.bz2`.                                                                                                                            |
| `book.game_id` is a unique natural key          | 1,198 pages carry an `id`; only **1,120 are distinct**. 78 pages collide. Unusable as identity.                                                                                            |
| Category comes from a `type` field              | `type` is `List 0`–`List 4`, present on 258 of 1,245 pages. Not a taxonomy.                                                                                                                |
| Category can come from wiki category membership | `{{Game Book}}` injects categories at render time; a dump holds only literally-written ones.                                                                                               |
| `book_location.notes` has no source             | Every `loc` bullet carries free-text notes after the location link.                                                                                                                        |
| `value`/`weight` are marginal                   | The two best-populated fields in the template — 1,207 of 1,245 each.                                                                                                                       |
| ~800 books                                      | **918** base + DLC (716 base, 142 Dragonborn, 51 Dawnguard, 9 Hearthfire), plus 327 Creation Club = 1,245. The old estimate was a fair guess at base+DLC; Creation Club is what it missed. |

---

## 1. Problem Statement

The app has no book data to browse or track — `book` and `book_location` are empty, and every feature in `prd-browse-and-track.md` depends on them being populated. UESP is the only viable structured source, and its `robots.txt` disallows both the MediaWiki API and bot crawling, naming Anthropic crawlers specifically. The sanctioned mechanism is UESP's weekly full-wiki XML dump, downloaded by a human. This task builds a local, re-runnable import script that turns that dump into normalized rows, resolving the normalization questions `prd-browse-and-track.md` defers to it (A1, R1, OQ-2, OQ-8 there).

## 2. Goals and Non-Goals

### Goals

- G1. Populate `book`/`book_location` from the downloaded dump. **The script makes no HTTP requests except its Supabase writes** — no UESP access at runtime, and no HTTP client dependency beyond `supabase-js`.
- G2. Resolve `prd-browse-and-track.md`'s OQ-2 (skill) and OQ-8 (category) with enumerated values enforced by Postgres check constraints, derived from the dump rather than invented.
- G3. Make re-running safe: no duplicate or lost rows, on the same dump or a newer one.
- G4. Import the template's full attribute set, not a minimal subset — the pages are richly populated and the UI will surface these fields.
- G5. Keep parsing verifiable in small increments (pure functions, fixture tests, `--dry-run`) rather than only checkable against a 177MB file and a live database.
- G6. Record dump provenance (date, CC BY-SA 2.5) durably.

### Non-Goals

- NG1. Cover art / image import. The `icon` **filename** is stored as metadata (it drives categorization); no image is fetched or hosted.
- NG2. Full book text storage — a **scope** decision, not a licensing prohibition. CC BY-SA 2.5 permits redistribution with attribution and share-alike, and architecture.md §2.2 contemplates it. The text lives in namespace 130 (`Lore:`, 4,035 `{{Lore Book}}` pages) and this task never reads that namespace.
- NG3. Scheduled/automatic re-running — manual invocation only.
- NG4. Books from other TES games. Namespace 134 is Skyrim-only, so this falls out of the filter for free.
- NG5. Real-world novels — namespace 140 (`Books:`) holds published fiction (`{{Real Book Summary}}`), not in-game items. Excluded by the namespace filter.
- NG6. `location_type` normalization — stays free text (spec Decision #6), and in practice stays null (FR-11).
- NG7. Spell tomes (93) and recipes (28) as tracked items — they are consumable item pages, not `{{Game Book}}` pages, and importing them would require parsing a second template (OQ-7).

## 3. Current State Analysis

- **Greenfield tooling.** No `scripts/` directory, no XML/wikitext dependencies, no test runner in `package.json`.
- **The schema is placeholder-quality and structurally wrong for this data.** `book` has `game_id text unique` as its natural key — which the dump disproves (§0) — and no column for the identifier that does work. `category`/`skill` are untyped `text`.
- **`.env.local`** has `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only — no service-role key. `.env*.local` is gitignored.
- **`.gitignore`** now ignores `/data/`, where the dump lives.
- **Stack fit.** Node 24 (`.nvmrc`), TypeScript 6, Yarn 4.17.1 — supports `tsx` and Node's native `--env-file`.

## 4. Proposed Solution

A single local script, `scripts/import-uesp.mts`, run manually, structured as pure parsing/mapping functions wrapped by thin I/O glue:

```
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 [--dry-run] [--allow-remote]
        │
        ▼
[bzip2 -dc] ──► XML stream ──► [sax] ──► one <page> at a time
        │  (bzip2 detected by magic bytes 'BZh'; gzip '1f 8b' also supported)
        ▼
filter: <ns> == 134  AND  wikitext invokes {{Game Book}}   (loose match)
        │  1,245 pages
        ▼
parseGameBookTemplate(wikitext)   ──► flat { key: value } params
        │
        ├─ identity:   <page><id>            ──► uesp_page_id  (unique, stable)
        ├─ attributes: id/id2..id5, value, weight, author, description, icon, lorename
        ├─ classifyCategory(params)          ──► skill_book | book | journal | note
        │                                        | black_book
        ├─ classifySource(smod, categories)  ──► base | dawnguard | dragonborn
        │                                        | hearthfire | creation_club
        ├─ normalizeSkill(params.skill)      ──► one of 18 Skyrim skills | null
        └─ parseLocations(params.loc)        ──► [{ name, notes }]
        │
        ▼
  --dry-run ? report : write via supabase-js (service-role key)
        │        book:          onConflict 'uesp_page_id'
        │        book_location: replace-per-book via transactional RPC
        ▼
  run report by category and source: found / new / updated / skipped / errored
```

**Key design tradeoffs**

- **MediaWiki page `<id>` as identity, not the Form ID.** Measured: 78 of 1,198 pages share a `|id=` value, because Creation Club items render as `fexxx8NN` placeholders (`fexxx819` alone is used by 11 pages) and DLC items as `xx……`. Upserting on that would silently merge ~44 distinct books while reporting zero duplicates. Page `<id>` is unique by MediaWiki construction, present on every page, and stable across renames. Tradeoff: a page deleted and recreated upstream gets a new id and imports as a new row — rare, and detectable via the stored title.
- **Classification from `icon`, not from wiki categories.** Categories are template-injected and absent from the dump; replicating them would mean parsing `Template:Game Book` and reimplementing its logic. `icon` is present on 1,164 pages and cleanly separates the types the UI needs.
- **`bzip2 -dc` subprocess over an npm bz2 library.** No new dependency, no 2–4GB intermediate file, and `bzip2` ships with macOS and every Linux distro. Tradeoff: a system dependency, checked for at startup with a clear error.
- **Hand-rolled template parser over `wtf_wikipedia`.** Not because the markup is simple — measured, it isn't: **95% of the 1,245 pages carry a piped `[[a|b]]` link inside the template and 16% nest another template inside it** (`{{Map Link}}` 185, plus `{{DB}}`/`{{DG}}`/`{{CC}}`/`{{HF}}`, `{{Lore Link}}`, `{{Showhide/Start}}`, `{{Bug}}`, `{{sic}}`). The parser must therefore be genuinely brace- and link-aware, and that is real work — roughly 80 lines — not a shortcut. It is chosen because (a) `wtf_wikipedia` ships fetch APIs, which would make NFR-2's "no HTTP client dependency" false and hollow out R7, and (b) its documented failure mode is silently normalizing or dropping params it doesn't recognize — wrong-but-plausible values reaching the database, which skip-and-continue cannot catch. The nesting is one level of simple inline templates, not arbitrary recursion, so a brace counter is bounded. M0's value-level diff against hand-transcribed expected params is the gate on it.
- **Replace-per-book locations over pure upsert.** Locations are the feature's point — a stale location sends a player somewhere the book isn't. Replacement happens only for books that parsed successfully, so a parse regression cannot wipe good rows.

## 5. Requirements

### Functional (FR)

- **FR-1 — CLI entry.** Takes the dump path as a required positional argument; errors clearly (no stack trace) if missing or unreadable.
- **FR-2 — Streaming parse.** `createReadStream` → compression detection by **magic bytes** (`BZh` → `bzip2 -dc` subprocess; `1f 8b` → `zlib.createGunzip()`; neither → treat as plain XML) → `sax.createStream()`. Never `zlib.gunzip`, which is the one-shot buffer API. Detection is by content, not extension: a truncated HTML error page named `.xml.bz2` must fail loudly rather than be parsed as XML.
- **FR-3 — Catalog filter.** A page qualifies only if `<ns>` is **134** _and_ its wikitext invokes `{{Game Book}}`. The match is case-insensitive and tolerant of whitespace/underscores (`{{Game Book`, `{{ game book`, `{{Game_Book`). HTML comments and `<nowiki>` blocks are stripped before the test, so a commented-out example doesn't qualify. Redirect pages are skipped. Expected yield: 1,245 pages.
- **FR-4 — Template extraction.** `parseGameBookTemplate(wikitext)` returns the template's flat parameters, or `null` if the page has no parseable invocation. Brace- and link-aware: a `|` inside `[[…|…]]` or a nested `{{…}}` is not a parameter separator.
- **FR-5 — Identity.** `uesp_page_id` (the `<page><id>` integer) is the upsert key. `game_id` (the `|id=` Form ID) is stored as a **non-unique, nullable attribute**, alongside `game_id_extra` for `id2`–`id5` (6 pages). Placeholder prefixes (`xx`, `fexxx`) are preserved verbatim, never expanded.
- **FR-6a — Sentinel and field semantics.** `lorename` is `none` on **734 of the 852 pages that set it** — a sentinel, not a value; it is stored as null, leaving ~118 real lore links. `description` is the short subtitle UESP shows under the title ("A hint on how to solve Shalidor's Maze") and maps to `book.description`. `note` is a **boolean flag** — its only value across 488 pages is `1` — not prose. `textnote` and `comment` are different things and **never co-occur** (0 of 1,245 pages set both): `textnote` is italicised errata about the record (variants, duplicate ids, naming errors) and maps to `errata`; `comment` is plain-text gameplay significance (quest relevance, links to other books) and maps to `gameplay_note`.
- **FR-6 — Attribute mapping.** All populated template fields map to columns: `description` (501), `author` (486), `value` (1,207), `weight` (1,207), `icon` (1,164), `lorename` (852), `sumtitle` (233), `errata` (51), `gameplay_note` (48), and the series links `up`/`next`/`prev` (~165 each).
- **FR-6b — Faithful import, no editorial filtering.** Every ns-134 `{{Game Book}}` page becomes a row. The script never excludes or merges books: UESP has already collapsed in-game variants to one page (a page reading "there are five versions of this book" is one book), and unobtainable or cut content stays in with its `errata` intact. Prose-based exclusion was rejected as unreliable — matching phrases like "cannot be found" yields ~19 pages including false positives such as `Amaund Motierre's Sealed Letter`, a quest item players do receive. Filtering is a browse-time concern, consistent with how `source` handles Creation Club; a curated exclusion list, if ever wanted, belongs in a hand-maintained table, not parser output. 49 pages have no `loc` field at all, which the UI can render as "no known location" from zero `book_location` rows.
- **FR-7 — Category classification.** `classifyCategory(params)` → one of `skill_book`, `black_book`, `note`, `journal`, `book`, evaluated **in that order** — the order is load-bearing:
    1. `skill_book` — has `skill=` (90). Must come first: `icon` is artwork and is reused, so the 25 magic-school skill books carry `SR-icon-book-SpellTome*.png` and would otherwise misclassify.
    2. `black_book` — icon `Black Book` (7, all Dragonborn).
    3. `note` — **`note=1` OR a Note-family icon** (`Note`/`TornNote`/`BloodstainedNote`). Union, because measured, each signal misses things the other catches: 42 Treasure Maps carry the flag with **no icon at all**, and 64 obvious notes (`Mysterious Note (Delphine)`, `Amaund Motierre's Sealed Letter`, `Museum Pamphlet`) carry the icon with no flag. The disagreement is wiki data-entry inconsistency, not a semantic distinction. `note` is boolean — its only value across 488 pages is `1`. Yield ~552.
    4. `journal` — icon `Journal*`. Comes **after** `note` deliberately: 8 pages (the Thalmor Dossiers) carry journal artwork and `note=1`, and a dossier is a document rather than a personal journal. Yield ~198.
    5. `book` — everything else (~444). An unrecognized icon lands here and is logged.

- **FR-8 — Quest relation.** `is_quest_related` is a **boolean flag, not a category** — true when `quest` (312) or `questrel` (222) is present. A skill book can also be quest-related; a single-value taxonomy could not express that.
- **FR-9 — Source classification.** `classifySource()` → `dawnguard` | `dragonborn` | `hearthfire` from `smod` (DG 51, DB 142, HF 9); `creation_club` from a `[[Category:Skyrim-Creation Club-…]]` link (327); otherwise `base` (~716). **`smod` alone is insufficient** — only 2 CC pages set `smod=CC` while 327 carry the category. **`mod` is the fallback when `smod` is absent** — measured, 4 pages carry `mod=[[Skyrim:Dawnguard|Dawnguard]]`, `mod=Hearthfire` or a Creation Club content name with no `smod` and no CC category link (e.g. `Skyrim:Discovering Ruunvald`, `Skyrim:Ransom Note`); classifying on `smod` alone files them as `base`. Resolution order: `smod` → CC category link → `mod` name → `base`.
- **FR-10 — Skill normalization.** `normalizeSkill(raw)` maps onto Skyrim's 18 skills by **exact match after trim/case-fold, plus a small alias table** (`One Handed` → `One-Handed`). Not substring scanning: a value naming two skills would otherwise silently pick one. Unmapped values → `null` + logged for table extension; never fail the run.
- **FR-11 — Location parsing.** `parseLocations(raw)` splits the `loc` field on `*` bullets (leading whitespace is inconsistent — the first bullet often has none) and per bullet extracts the location name and free-text notes. Real shape:

    ```
    *[[Skyrim:Bloodskal Barrow|Bloodskal Barrow]], one on a dresser near a double bed, and another on shelves
    * Haknir's Shoal, on a [[Skyrim:Pirate|pirate]] boss
    ```

    The name is the link label where present and plain text otherwise; notes are everything after the first comma, with links unwrapped to their labels. A link inside the notes must not be mistaken for the location. `location_type` is written null — no source field exists for it. Present on 1,196 pages.

- **FR-12 — `book` upsert.** Batched (chunks of ~500) on conflict `uesp_page_id`, deduped by conflict key before each chunk — Postgres raises `ON CONFLICT DO UPDATE command cannot affect row a second time` if a key repeats within one statement.
- **FR-13 — `book_location` replacement.** For each successfully parsed book, replace its location set atomically via a Postgres function (`replace_book_locations(p_book_id uuid, p_rows jsonb)`) that deletes and re-inserts in one transaction. PostgREST cannot span statements transactionally, so this must be an RPC. Books that failed to parse keep their existing locations untouched.
- **FR-14 — Target-database guard.** The script refuses to write to a non-localhost Supabase URL unless `--allow-remote` is passed, and prints the target host and row counts before the first write. The service-role key bypasses RLS: an accidental run against production writes 1,245 rows into live data with no undo.
- **FR-15 — `--dry-run`.** Parses, classifies and maps as normal, writes nothing, constructs no Supabase client and reads no credentials — so it runs before the service-role key exists. Emits the FR-17 report.
- **FR-16 — Credentials.** Reads `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` via `--env-file=.env.local`; never logged, never committed. The client is constructed inside the run function, not at module scope, so importing the module for tests needs no env.
- **FR-17 — Run report.** Broken down **by category and source**, not just totals: pages found, new, updated, skipped (with reason), errored, duplicate keys collapsed, unmapped skills, unrecognized icons. Plus the dump date and a CC BY-SA 2.5 note.
- **FR-18 — Provenance.** The dump date is parsed from the filename (`uespwiki-YYYY-MM-DD-current.xml.bz2`), with `--dump-date=YYYY-MM-DD` as an override for a renamed file. Recorded in the run report and in a README attribution section (owned by M3).
- **FR-19 — Cleanup.** `cleanTitle(pageTitle)` strips the `Skyrim:` prefix and a trailing ` (book)` disambiguator — **only that exact suffix**, since stripping arbitrary parenthetical qualifiers would collapse many `Note`/`Journal`/`Letter` pages into identical titles. `display_title` prefers `sumtitle` where present. The full page title is stored separately as `uesp_title` for linking, debugging and attribution. `cleanWikitext(value)` decodes entities (`&nbsp;`, `&amp;`) and strips residual markup from every stored string.
- **FR-20 — Unit-testable parsing.** `parseGameBookTemplate`, `parseLocations`, `classifyCategory`, `classifySource`, `normalizeSkill`, `cleanTitle`, `cleanWikitext`, `mapToBookRow`, `mapToLocationRows`, `attachBookIds` are pure (no I/O), each covered by tests in `scripts/*.test.mts` run via `yarn test`. Note `tsconfig.json` sets `strict: false`, so `| null` unions are not compiler-enforced — these handle absent values explicitly and are tested for it.

### Non-Functional (NFR)

- **NFR-1 — Memory.** Peak memory scales with one page, not the dump. The decompressed stream is never buffered whole.
- **NFR-2 — No UESP access from the script.** Zero requests to `en.uesp.net`/`dumps.uesp.net`. The only HTTP the script performs is Supabase writes. No parsing dependency may expose a fetch API (§4).
- **NFR-3 — Resilience.** A malformed page is logged and skipped, never aborting the run. This extends to writes: no single page's data can abort a batch, and a failed chunk is reported rather than left silently partial.
- **NFR-4 — Idempotency.** Re-running against the same or a newer dump produces no duplicate `book` rows, and location sets converge to the dump's contents.
- **NFR-5 — Secrets.** Service-role key from env only; never logged, never committed.
- **NFR-6 — Scope.** Dev-only tooling; nothing in `src/` imports from `scripts/`.
- **NFR-7 — Testability.** All parsing/classification/mapping verifiable via `yarn test` with no database and no 177MB file.

## 6. Constraints and Assumptions

### Constraints

- Dump-file input only; the human download from `dumps.uesp.net` is the sanctioned input to this task, not a violation of it (robots.txt binds automated crawlers).
- Metadata only — no full book text (NG2). The text is in namespace 130, which this task never reads.
- CC BY-SA 2.5 attribution required in UI/README (`prd-browse-and-track.md` FR-7); this task records the dump date and licence, it doesn't render the UI attribution.
- Writes use the service-role key, bypassing RLS — never the app's Server Action path.
- Identity is `uesp_page_id`; `game_id` is an attribute (§0, FR-5).
- The dump is bzip2; `bzip2` must be on `PATH`.
- Postgres 15+ (`nulls not distinct` is 15+ syntax). Verify the local Supabase CLI's image major version matches the hosted project before M2.

### Assumptions

- A human downloads the dump periodically; the script never fetches it.
- `book.id` (uuid) stays internally generated. `uesp_page_id` is the natural upsert key.
- Pages missing fields still import, with nulls — 47 pages lack `|id=` entirely and must not be dropped.
- Namespace 134 plus `{{Game Book}}` identifies the catalog. DLC books are in ns 134 (verified: `Skyrim:Deathbrand (book)` carries `{{Mod Header|Dragonborn}}`), so no separate DLC namespace handling is needed.

## 7. Risks and Mitigations

| ID  | Risk                                                           | Likelihood | Impact | Mitigation                                                                                                                                                          |
| --- | -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | An accidental run against the production database.             | Med        | High   | FR-14's localhost guard plus printed target confirmation. This is the highest-severity operational risk in the task.                                                |
| R2  | `icon` classification mis-sorts a book type.                   | Med        | Med    | Fixture cases per icon family; unrecognized icons fall to `book` and are logged with counts, so drift is visible in every run report (FR-17).                       |
| R3  | `parseLocations` regresses and mangles location sets.          | Med        | High   | Replacement happens only for successfully parsed books (FR-13). Fixture cases for: no-link location, link-inside-notes, two copies in one location, label ≠ target. |
| R4  | Creation Club misclassified as base game.                      | Med        | Low    | FR-9 uses the category link, not `smod` (which marks only 2 of 327). Cross-checked against `mod` count; mismatch logged.                                            |
| R5  | Skill values vary in phrasing across pages.                    | Med        | Low    | Exact match plus alias table (FR-10); unmapped values logged, cheap to fix since re-runs are idempotent.                                                            |
| R6  | The fixture misses an edge case present in the full dump.      | Med        | Low    | M1's dry run over all 1,245 pages is a required gate before any write, and reports by class so a whole missing class is visible.                                    |
| R7  | A future change adds UESP network calls.                       | Low        | High   | No parsing dependency with a fetch API (§4); `supabase-js` is the only HTTP client.                                                                                 |
| R8  | A page deleted and recreated upstream imports as a new row.    | Low        | Low    | Accepted. `uesp_title` is stored, so the duplicate is detectable.                                                                                                   |
| R9  | A write chunk fails mid-run, leaving tables partially updated. | Low        | Med    | Chunks are separate statements, not one transaction. Failures are logged with their keys and surfaced in the report; recovery is re-running, which is idempotent.   |
| R10 | `is_unique` has no source in the template.                     | High       | Low    | Column left **nullable and unpopulated** — "unknown" must not be stored as `false` (OQ-2).                                                                          |

## 8. Milestones

> **Prerequisite, satisfied:** `data/uespwiki-2026-08-30-current.xml.bz2` is on disk.

- **M0 — Fixture + pure functions.** Cut `scripts/__fixtures__/sample-dump.xml` from real `<page>` elements: a skill book, a multi-location book (Deathbrand — 11 locations, mixed link/plain forms), a note, a journal, a magic-school skill book carrying a `SpellTome` icon (proves icon-vs-`skill=` precedence), a black book, a Creation Club book with an `fexxx` id, a page with no `|id=`, an `id2` page, a non-`{{Game Book}}` ns-134 page, and an ns-116 (Oblivion) book that must be filtered out. Attribute the excerpts as CC BY-SA in the fixture header. Implement and test all FR-20 functions. **Exit:** tests green, including a value-level diff against hand-transcribed expected params.
- **M1 — Streaming + dry run.** Wire the bzip2/sax streamer to M0's functions. **Exit:** a dry run over the full dump reports ~1,245 books with the expected distribution (90 skill, ~444 book, ~206 journal, ~498 note, 7 black book) across five sources and no unexpected crashes.
- **M2 — Migration + writes.** Apply the §12.1 migration **first**, then upserts, the `replace_book_locations` RPC, the target guard, and the report. **Exit:** re-running the same dump produces zero duplicates and a stable location count.
- **M3 — Full run + attribution.** Run against the real dump; add the README attribution section. **Exit:** §9 met.

## 9. Acceptance Criteria

- AC-1. A run against the dump imports ~1,245 books, with the distribution in M1's exit gate. (FR-3, FR-7)
- AC-2. Every book has a category and a source from the fixed sets. Every `skill_book` has a non-null normalized `skill`. (FR-7, FR-9, FR-10)
- AC-3. Books with locations have one `book_location` row per location, with notes populated where the source provides them. (FR-11)
- AC-4. Re-running produces no duplicate `book` rows and no growth in `book_location`. (NFR-4)
- AC-5. The script makes no requests to UESP during execution. (NFR-2)
- AC-6. The dump date and CC BY-SA 2.5 licence appear in the run report and the README. (FR-18)
- AC-7. `yarn test` passes with no network, no database, and no 177MB file. (FR-20)
- AC-8. `--dry-run` runs to completion with no `SUPABASE_SERVICE_ROLE_KEY` set. (FR-15)
- AC-9. A malformed page is logged and the run completes. (NFR-3)
- AC-10. Pointing the script at a remote Supabase URL without `--allow-remote` refuses to write. (FR-14)

## 10. Success Metrics

- **Coverage:** ≥ 98% of the 1,245 ns-134 `{{Game Book}}` pages produce a row. The denominator is the page count, not "pages that parsed" — a filter measured against itself proves nothing.
- **Class distribution** matches M1's dry run within a few pages; a whole class collapsing to zero is a parser regression.
- **Skill completeness:** 100% of `skill_book` rows have a non-null skill (AC-2). An unmapped value is a lookup-table gap to fix and re-run, not an acceptable resting state.
- **Identity integrity:** `count(*) == count(distinct uesp_page_id)`, and no book loses locations across consecutive runs of the same dump.
- **Test coverage:** every FR-20 function has at least one fixture-backed case.

## 11. Open Questions

- **OQ-1:** Should the catalog default to `skill_book` + `book` only, with `note`/`journal`/`black_book` opt-in via UI checkboxes? This is a `prd-browse-and-track.md` filter-default decision; the import stores everything with a category and source either way.
- **OQ-2:** `is_unique` has no `{{Game Book}}` parameter. Leave permanently null, drop the column, or derive it another way? Left nullable for now (R10).
- **OQ-3:** Model book **series** relationally (`up`/`next`/`prev`, ~165 pages each) or store the raw title strings? Currently stored as text; no feature reads them yet.
- **OQ-4:** UESP's own "820 readable items" breakdown (307 lore books, 192 letters/notes, 97 journals, 93 spell tomes, 91 skill books, 28 recipes, 7 Black Books, 5 quest books) does not reconcile with what `{{Game Book}}` yields: skill books agree (90 + Oghma Infinium = 91) and Black Books agree exactly (7), but notes measure 295 against 192, `book` 444 against 307, and journals 110 against 97. Spell tomes and recipes are **not** `{{Game Book}}` pages at all — they are consumable item pages under a different template, so tracking them would need a second source and is currently out of scope (NG7). Worth reconciling before the progress-bar denominator is finalized in `prd-browse-and-track.md`.

---

## 12. Technical Design

### 12.1 Migration

`supabase/migrations/<timestamp>_book_import_schema.sql`. **Requires Postgres 15+.**

```sql
-- Migration: book_import_schema
-- Feature: Import UESP Book Data (see docs/specs/prd-import-uesp-books.md §12)
--
-- Reshapes the placeholder book table around what the UESP dump actually
-- provides. Safe to do destructively: both tables are still empty.

-- ── Identity ─────────────────────────────────────────────────────────────────
-- The MediaWiki page id, not the Creation Kit Form ID. Measured against the
-- 2026-08-30 dump: 1,198 of 1,245 pages carry a |id= value but only 1,120 are
-- distinct -- Creation Club items render as `fexxx8NN` placeholders (fexxx819
-- alone is shared by 11 pages) and DLC items as `xx......`. Upserting on that
-- would silently merge ~44 distinct books. Page ids are unique by construction.
alter table book add column uesp_page_id integer;
alter table book add constraint book_uesp_page_id_unique unique (uesp_page_id);
alter table book alter column uesp_page_id set not null;

-- game_id demotes from key to attribute: still useful, no longer trusted to be
-- unique, and absent on 47 pages.
alter table book drop constraint if exists book_game_id_key;
alter table book add column game_id_extra text[]; -- |id2..|id5, 6 pages

-- ── Attributes ───────────────────────────────────────────────────────────────
alter table book add column uesp_title       text not null;  -- 'Skyrim:Deathbrand (book)'
alter table book add column source           text not null;
alter table book add column icon             text;
alter table book add column author           text;
alter table book add column value            integer;        -- base gold, pre-modifiers
alter table book add column weight           numeric(6, 2);  -- 1.0 most books, 0 notes
alter table book add column lorename         text;   -- null when the source says 'none' (734 pages)
alter table book add column errata           text;   -- |textnote: variants, duplicate ids, naming errors (51)
alter table book add column gameplay_note    text;   -- |comment: quest relevance, links to other books (48)
alter table book add column series_up        text;
alter table book add column series_prev      text;
alter table book add column series_next      text;
alter table book add column is_quest_related boolean not null default false;

-- is_unique has no source parameter in {{Game Book}} (R10/OQ-2). Unknown must
-- not be stored as false, so the not-null default is removed.
alter table book alter column is_unique drop not null;
alter table book alter column is_unique drop default;

alter table book add constraint book_category_valid
  check (category in ('skill_book', 'book', 'journal', 'note', 'black_book'));

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

-- A skill book without a skill is a parse failure, not valid data (AC-2).
alter table book add constraint book_skill_book_has_skill
  check (category <> 'skill_book' or skill is not null);

create index book_source_idx    on book (source);
create index book_quest_rel_idx on book (is_quest_related) where is_quest_related;

-- ── Locations ────────────────────────────────────────────────────────────────
-- Replaced per book rather than upserted (FR-13), so no unique constraint is
-- needed as a conflict target -- but one still guards against a parser emitting
-- the same location twice for one book. `nulls not distinct` because
-- location_type is always null for now (no source field) and Postgres would
-- otherwise treat every null as distinct.
alter table book_location
  add constraint book_location_unique
  unique nulls not distinct (book_id, location_name, location_type);

-- Superseded by the unique index above, whose leftmost column is book_id --
-- book_id lookups and the FK's on-delete cascade both stay indexed.
drop index if exists book_location_book_idx;

-- Atomic per-book location replacement. PostgREST cannot span statements
-- transactionally, so delete-then-insert must live in the database.
create or replace function replace_book_locations(p_book_id uuid, p_rows jsonb)
returns void language plpgsql as $$
begin
  delete from book_location where book_id = p_book_id;
  insert into book_location (book_id, location_name, location_type, notes)
  select p_book_id,
         r->>'location_name',
         r->>'location_type',
         r->>'notes'
    from jsonb_array_elements(p_rows) as r;
end $$;
```

### 12.2 Script Structure (`scripts/import-uesp.mts`)

```ts
type RawParams = Record<string, string>;

type Category = 'skill_book' | 'book' | 'journal' | 'note' | 'black_book';
type Source =
    'base' | 'dawnguard' | 'dragonborn' | 'hearthfire' | 'creation_club';
type Skill =
    | 'One-Handed'
    | 'Two-Handed'
    | 'Archery'
    | 'Block'
    | 'Smithing'
    | 'Heavy Armor'
    | 'Light Armor'
    | 'Alteration'
    | 'Conjuration'
    | 'Destruction'
    | 'Illusion'
    | 'Restoration'
    | 'Enchanting'
    | 'Alchemy'
    | 'Sneak'
    | 'Lockpicking'
    | 'Pickpocket'
    | 'Speech';

type ParsedPage = {
    uespPageId: number; // <page><id> -- the identity
    uespTitle: string; // 'Skyrim:Deathbrand (book)'
    params: RawParams;
    categoryLinks: string[]; // explicitly-written [[Category:...]] links
};

// Brace- and link-aware: '|' inside [[a|b]] or {{x|y}} is not a separator.
function parseGameBookTemplate(wikitext: string): RawParams | null;

function classifyCategory(params: RawParams): Category;
function classifySource(params: RawParams, categoryLinks: string[]): Source;
function normalizeSkill(raw: string | null): Skill | null;

// '*[[Skyrim:X|X]], on a shelf' -> [{ name: 'X', notes: 'on a shelf' }]
function parseLocations(
    rawLoc: string,
): { name: string; notes: string | null }[];

function cleanTitle(uespTitle: string, sumtitle?: string): string;
function cleanWikitext(value: string): string;

type BookRow = {
    uesp_page_id: number;
    uesp_title: string;
    title: string;
    category: Category;
    source: Source;
    skill: Skill | null;
    game_id: string | null;
    game_id_extra: string[] | null;
    description: string | null;
    author: string | null;
    value: number | null;
    weight: number | null;
    icon: string | null;
    lorename: string | null;
    errata: string | null;
    gameplay_note: string | null;
    series_up: string | null;
    series_prev: string | null;
    series_next: string | null;
    is_quest_related: boolean;
    is_unique: boolean | null;
};

type MappedLocation = {
    uespPageId: number;
    location_name: string;
    location_type: null;
    notes: string | null;
};
type LocationRow = {
    location_name: string;
    location_type: null;
    notes: string | null;
};

function mapToBookRow(page: ParsedPage): BookRow;
function mapToLocationRows(page: ParsedPage): MappedLocation[];
function attachBookIds(
    rows: MappedLocation[],
    idsByPageId: Map<number, string>,
): Map<string, LocationRow[]>;
```

I/O glue (exercised via `--dry-run`, not unit-tested directly):

- Detect compression by magic bytes; spawn `bzip2 -dc` or `zlib.createGunzip()`; pipe into `sax.createStream()`.
- Per `<page>`: filter (FR-3) → parse → classify → map.
- Pre-fetch existing `uesp_page_id`s into a Set so the report can distinguish new from updated — a PostgREST upsert does not reveal which rows it inserted.
- Dedupe by conflict key, batch-upsert `book` (chunks of ~500, `onConflict: 'uesp_page_id'`) with `.select('id, uesp_page_id')` so each chunk returns its uuids; build the id map, then call `replace_book_locations` per successfully parsed book.
- Guard the target host (FR-14) before the first write.

### 12.3 Dependencies

> Versions are illustrative — resolve via `yarn add` at build time.

`@supabase/supabase-js` is **already a dependency** (`^2.112.2`); do not re-add it. `wtf_wikipedia` is **not** used (§4). `bzip2` is a system binary, not an npm package — checked for at startup.

```json
{
    "devDependencies": {
        "tsx": "^4",
        "sax": "^1",
        "@types/sax": "^1"
    }
}
```

```json
{
    "scripts": {
        "test": "node --import tsx --test \"scripts/**/*.test.mts\"",
        "import:uesp": "node --env-file=.env.local --import tsx scripts/import-uesp.mts"
    }
}
```

Script and test files are `.mts`, not `.ts`: `package.json` has no `"type"` field, so a `.ts` under `scripts/` resolves as CommonJS while `tsconfig.json` is set to `module: esnext` / `moduleResolution: bundler`. `.mts` is unambiguously ESM without making the whole repo ESM. `tsconfig.json`'s `include` already covers `**/*.mts`.

### 12.4 Running it

```bash
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --dry-run
```

`.env.local` gains `SUPABASE_SERVICE_ROLE_KEY=` (never committed). The dump date is read from the filename; `--dump-date=YYYY-MM-DD` overrides. Writing to a non-localhost URL requires `--allow-remote` (FR-14).

### 12.5 Existing checks

`tsconfig.json`'s `include` is `**/*.ts` / `**/*.mts`, so `scripts/**` is covered by the project's existing checks from the first file. Per CLAUDE.md it must pass `eslint`, `tsc --noEmit -p tsconfig.json`, and `prettier --check`. That check list gains `yarn test` as part of this task.

### 12.6 `.gitignore`

`/data/` is already ignored — the dump lives there and is never committed.

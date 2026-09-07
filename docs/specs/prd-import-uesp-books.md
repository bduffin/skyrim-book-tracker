# PRD: Import UESP Book Data

> Stage: PRD — derived from `docs/specs/spec-import-uesp-books.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved from spec)

> The `book` and `book_location` tables exist but are empty — nothing populates them yet. The app can't browse or track anything until this data exists. UESP is the canonical source, but it must be accessed via their sanctioned bulk-download mechanism, not live scraping: their `robots.txt` explicitly disallows the MediaWiki API and bot crawling for all agents, and specifically names Anthropic crawlers as disallowed from the entire site.

---

## 0. Contradictions & Missing Info (resolved in this PRD)

| #   | Type    | Issue                                                                                                                     | Resolution in this PRD                                                                                                                                                                                                                |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MI1 | Missing | Spec requires normalizing `category` to "a fixed, small taxonomy" but doesn't enumerate it.                               | Not guessed here either — the exact source template field and value set are unconfirmed until a real dump is inspected. §4 M0 makes this an explicit first build step, with a catch-all `other` bucket so nothing blocks on it. OQ-1. |
| MI2 | Missing | Spec requires normalizing `skill` but doesn't enumerate the target set.                                                   | Enumerated explicitly: Skyrim's 18 canonical skills (§4).                                                                                                                                                                             |
| MI3 | Missing | Spec says the dump is "~176MB compressed" but not which compression format.                                               | Handle `.gz` (Node's built-in `zlib`); error clearly on `.bz2` asking for manual decompression rather than adding an unverified dependency. OQ-2.                                                                                     |
| MI4 | Missing | Spec has no testing/verification strategy for a script parsing messy, inconsistent real-world wikitext across ~800 pages. | Pure-function decomposition + a committed sample fixture + `yarn test` (Node's built-in test runner) + a `--dry-run` mode, so parsing logic is verified incrementally, not only against a full live run.                              |
| MI5 | Missing | Spec's original idempotency decision covered only `book`, not `book_location`.                                            | Closed as spec Decision #5 (this session): unique constraint on `book_location(book_id, location_name, location_type)`, upserted against — requires a new migration.                                                                  |
| MI6 | Missing | Spec didn't say whether `location_type` needs its own normalized taxonomy.                                                | Closed as spec Decision #6 (this session): stays free text; no current feature reads it structurally (checked against `prd-browse-and-track.md`).                                                                                     |

---

## 1. Problem Statement

The app has no book data to browse or track — `book` and `book_location` are empty, and every feature in `prd-browse-and-track.md` depends on them being populated. UESP is the only viable structured source, but its `robots.txt` disallows both the MediaWiki API and bot crawling generally, and specifically names Anthropic crawlers as disallowed site-wide. The only sanctioned mechanism is UESP's own weekly full-wiki XML dump. This task builds a local, re-runnable, dump-file-based import script that turns that raw dump into normalized rows in `book`/`book_location`, resolving the two normalization open questions (`skill`, `category`) that `prd-browse-and-track.md` depends on but defers to this task (A1, R1, OQ-2, OQ-8 there).

## 2. Goals and Non-Goals

### Goals

- G1. Populate `book`/`book_location` from UESP's sanctioned XML dump — **the script makes zero network requests** to `en.uesp.net`/`dumps.uesp.net` (or anywhere else) at runtime. This is scoped to the script deliberately: robots.txt binds automated crawlers, not the one sanctioned bulk download a human performs, which the whole plan depends on.
- G2. Resolve `prd-browse-and-track.md`'s OQ-2 (skill) and OQ-8 (category) with concrete, enumerated normalization — enforced in Postgres via check constraints (§12.1), not only in the import script. OQ-8 asks "fixed enum vs free-text"; this answers _fixed set_.
- G3. Make re-running the script — same dump or a newer one — safe: no duplicate `book` or `book_location` rows.
- G4. Keep the parsing logic verifiable in small increments (unit tests against a committed fixture, a `--dry-run` mode) rather than only checkable by running the full ~176MB dump against a live database — the wikitext being parsed is real, inconsistently-edited content across ~800 pages, not a clean structured feed.
- G5. Record dump provenance (date, CC BY-SA 2.5 license) durably — in the run summary _and_ a README attribution section (FR-13/FR-13a), not stdout alone. Rendering attribution in the UI stays `prd-browse-and-track.md` FR-7's job.

### Non-Goals (this PRD)

- NG1. Cover art / image import.
- NG2. Full book text storage — a **scope** decision: this task imports structured metadata only. Not a licensing prohibition; CC BY-SA 2.5 permits redistributing the text with attribution and share-alike, and architecture.md §2.2 explicitly contemplates it ("if full text is ever stored or rendered, ensure attribution is highly visible"), it just prefers metadata. Consistent with NG6 in `prd-browse-and-track.md` and NFR-5 there.
- NG3. Scheduled/automatic re-running (cron, CI) — manual invocation only.
- NG4. Importing books from other TES games (Oblivion, Morrowind, ESO, etc.).
- NG5. `location_type` normalization (spec Decision #6) — stays free text.
- NG6. Any network access to UESP _by the script_, including for verifying dump freshness — it only ever reads a local file. The human-performed download from `dumps.uesp.net` is the sanctioned input to this task, not a violation of it.
- NG7. Importing the template's `value` and `weight` stats — the Creation Kit base gold value and the inventory weight. Both are available and architecture.md §6 lists them as book metadata, so this is a decision rather than an oversight: no column exists for either, nothing in `prd-browse-and-track.md` reads them, and `weight` is near-constant across books (1.0 for most, 0 for notes) so it carries little signal. Cheap to add later — the template is already being parsed and re-runs are idempotent.

## 3. Current State Analysis

- **Greenfield tooling.** No `scripts/` directory, no XML/wikitext dependencies, no test runner wired up in `package.json` yet.
- **Schema exists, placeholder-quality.** `book`/`book_location` were created in `supabase/migrations/20260819040000_user_book.sql` explicitly as placeholders "to be replaced before real data lands" — `category`/`skill` are untyped `text`. This task is that replacement: the new migration (§12.1) adds check constraints pinning both columns to the fixed taxonomies defined here, so the normalization is enforced by Postgres and not only by the import script.
- **Neither upsert key is enforceable as-is.** `book_location` has no unique constraint at all (required before Decision #5's upsert can work), and `book.game_id` is `text unique` but **nullable**, which makes `on conflict (game_id)` unable to dedupe null keys. Both are fixed by one new migration (§12.1).
- **`.env.local`** currently has `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only — no service-role key yet. `.env*.local` is already gitignored.
- **`.gitignore`** has no entry for a local dump-storage location — needs one so the ~176MB dump is never accidentally committed.
- **Stack fit.** Node 24 (`.nvmrc`), TypeScript, Yarn 4 — supports running the script via `tsx` and reading env vars via Node's native `--env-file`, with no new runtime dependencies for either.

## 4. Proposed Solution

A single local script, `scripts/import-uesp.mts`, run manually via `tsx`, structured as pure parsing/mapping functions wrapped by thin I/O glue:

```
yarn import:uesp <dump-path> --dump-date=YYYY-MM-DD [--dry-run]   (both args required)
        │
        ▼
[sax, streaming] dump.xml(.gz) ──► one <page> at a time (title, ns, text)
        │  (gzip detected by magic bytes → zlib.createGunzip(); bzip2 → clear error)
        ▼
filter: title in "Skyrim:" space  AND  text invokes {{Book Summary}} (loose match)
        │  matched pages only (prefix is a hard filter, not a cross-check — see FR-3)
        ▼
extractBookSummaryTemplate(text)          [wtf_wikipedia]  ──► raw template params
        │
        ▼
parseTemplateFields(rawParams)            ──► { id, skill, loc, type, ... } (strings)
        │
        ├─ normalizeSkill(raw.skill)      ──► one of 18 Skyrim skills | null
        ├─ normalizeCategory(raw.type)    ──► fixed taxonomy (incl. "other" catch-all)
        └─ mapToBookRow / mapToLocationRows
        │
        ▼
  --dry-run ? log mapped rows : upsert via supabase-js (service-role key)
        │        book:          onConflict "game_id"
        │        book_location: onConflict "book_id,location_name,location_type"
        ▼
  run summary: found / imported / updated / skipped / errored (+ dump date, license note)
```

**Key design tradeoffs:**

- **Streaming XML parse (`sax`) vs. a full DOM parse.** Chosen so a multi-hundred-MB dump is never fully resident in memory; `<page>` elements in a MediaWiki dump don't nest, so accumulating one page at a time is safe. Tradeoff: slightly more state-tracking code than a one-shot `parse()` call.
- **`wtf_wikipedia` vs. a hand-rolled template parser.** A hand-rolled brace-counter has to correctly track both `{{}}` template nesting and `[[]]` link nesting (e.g. a pipe inside `[[Windhelm|the city]]` must not be read as a template-parameter separator) on top of HTML comments and emphasis markup — real risk of breaking on the inconsistent editing found across ~800 real pages. `wtf_wikipedia` is a real MediaWiki parser, at the cost of being a genuine new dependency built for _Wikipedia's_ conventions — it renders wikitext to plain text and normalizes or drops params it doesn't recognize, and `Book Summary` is not one of its known infoboxes, so its behavior here is unverified until M0's value-level diff (R2). This is a starting choice, not a commitment: if that diff fails, M0 falls back to the hand-rolled splitter behind the same function signature and the same tests.
- **Pure functions + fixture tests vs. testing only against the full dump.** Chosen so parsing logic iterates fast and deterministically without needing the real 176MB dump or a live database on every change. Tradeoff: the fixture can't cover every edge case in ~800 real pages, so a dry run against the real dump (M1) remains a required gate before any DB write (M2).
- **Unique constraint + upsert vs. delete-and-reinsert for `book_location`** (spec Decision #5). Chosen to preserve row identity across re-runs at the cost of a new migration, rather than the simpler delete-then-insert.
- **Explicit `--dump-date` flag vs. parsing a date out of the dump.** The dump's filename/internal-timestamp convention from `dumps.uesp.net` isn't confirmed, so rather than guess a parsing scheme, the person running the import supplies the date they downloaded it. Cheap, unambiguous, revisit only if this proves annoying in practice.

## 5. Requirements

### Functional (FR)

- **FR-1 — CLI entry.** `scripts/import-uesp.mts` takes the dump file path as a required positional argument; errors clearly (no stack trace) if missing or the file doesn't exist.
- **FR-2 — Streaming parse.** Dump is streamed via `sax`, never fully loaded into memory: `createReadStream(path)` → (optional) `zlib.createGunzip()` → `sax.createStream()`. It must be `createGunzip()`, the stream transform — `zlib.gunzip` is the one-shot buffer API and would materialize the whole decompressed dump (well over a GB) in memory, violating NFR-1. Compression is detected by **sniffing the first bytes** (gzip `1f 8b`, bzip2 `BZh`), not by file extension, so a dump saved without its extension isn't silently fed to the XML parser as binary. A bzip2 dump produces a clear error asking the user to decompress it first (OQ-2).
- **FR-3 — Skyrim book filter.** A page is a candidate book page only if **both** hold: its title is in UESP's `Skyrim:` space, **and** its wikitext contains a `Book Summary` template invocation. The match is **case-insensitive and tolerant of whitespace and underscores** after the braces — MediaWiki accepts `{{Book Summary`, `{{ Book Summary`, `{{book summary`, and `{{Book_Summary` as the same call, so a literal substring test would silently miss pages. The template's exact name and capitalisation are themselves unverified until a real dump is inspected (OQ-1). The `Skyrim:` space covers DLC books as well as base-game ones (e.g. `Skyrim:Deathbrand (book)`), so no separate Dawnguard/Dragonborn handling is needed. The prefix check is a **hard filter, not a cross-check**: the dump is the full wiki across all namespaces, so a template-only filter would also match other games' book pages (excluded by NG4), `Template:Book Summary`'s own documentation page, and `UESPWiki:Style_Guide/Book_Layout` — the page the spec cites as the format reference, which necessarily contains example invocations. Pages failing the prefix check are dropped and counted as `skipped` (FR-11). How the `Skyrim:` space is represented in the dump — a numbered MediaWiki namespace in `<ns>` versus a title prefix inside ns 0 — is OQ-6.
- **FR-4 — Template extraction.** `extractBookSummaryTemplate(wikitext)` (via `wtf_wikipedia`) returns the `Book Summary` template's raw parameters, or `null` if the page (despite matching FR-3's substring check) has no parseable template.
- **FR-5 — Field mapping.** Parsed fields (`id`, `skill`, `loc`, category-bearing field, description, uniqueness) map onto `book`/`book_location` columns. The template's `value`/`weight` stats are deliberately not imported (NG7).
- **FR-6 — Skill normalization.** `normalizeSkill(raw)` maps free-text skill values onto one of Skyrim's 18 skills (One-Handed, Two-Handed, Archery, Block, Smithing, Heavy Armor, Light Armor, Alteration, Conjuration, Destruction, Illusion, Restoration, Enchanting, Alchemy, Sneak, Lockpicking, Pickpocket, Speech) via a lookup table matched on trimmed/lowercased substrings (R4); unmapped values → `null` + logged, never fail the run.
- **FR-7 — Category normalization.** `normalizeCategory(raw)` maps onto a small fixed taxonomy, finalized empirically in M0 against real sample pages (MI1); unmapped values → an explicit `other` value + logged, never fail the run.
- **FR-8 — `book` upsert.** Batched upsert (chunks of ~500) on conflict `game_id`. A page whose template yields no usable `id` is **skipped, never written with a null `game_id`** — `on conflict (game_id)` cannot dedupe NULLs (Postgres treats them as distinct), so a null key would insert a duplicate on every re-run. The new migration also makes `book.game_id` `not null` (§12.1) so the invariant holds at the DB level. Rows are **deduped by conflict key before each chunk is sent** (last occurrence wins): Postgres raises `ON CONFLICT DO UPDATE command cannot affect row a second time` if the same key appears twice in one statement, which would kill the whole ~500-row chunk. Collapsed duplicates are counted and reported in the run summary (FR-11).
- **FR-9 — `book_location` upsert.** Requires a new migration adding `unique (book_id, location_name, location_type)` on `book_location`; upserts against that constraint (spec Decision #5). The same migration drops the now-redundant `book_location_book_idx`: the constraint's unique index has `book_id` as its leftmost column, so book_id lookups and the foreign key's `on delete cascade` both remain indexed. A book's `loc` field may list multiple locations — each becomes its own row, deduped by `(book_id, location_name, location_type)` before the upsert for the same reason as FR-8 (a `loc` list naming the same place twice would otherwise abort the statement).
- **FR-9a — `book_id` resolution.** `book.id` is a server-generated uuid, so location rows cannot be built at mapping time. `mapToLocationRows` emits rows keyed by `game_id`; the `book` upsert chains `.select('id, game_id')` to return the uuids for the chunk it just wrote; `attachBookIds` folds those into real `book_id`s before the `book_location` upsert. A location whose `game_id` is absent from the map (its book was skipped or its chunk failed) is dropped and counted, never written with a dangling id.
- **FR-9b — `loc` splitting.** Splitting one `loc` value into location rows is its own named pure function, `parseLocations(raw)`, unit-tested with its own fixture cases (FR-14) — it is the highest-variance parsing step here and the unique constraint depends entirely on its output being stable across runs. Its actual rules (delimiter — `<br />`? a `*` list? commas? — plus link unwrapping for `[[Whiterun|Dragonsreach]]` and whether nested location templates appear) are **not yet known**: see OQ-7, resolved in M0 against real sample pages.
- **FR-9c — `location_type` / `notes` provenance.** No `Book Summary` field has been confirmed as the source for either column, so both are **written null** until M0 identifies one. Consequence, stated so it isn't discovered later: with `location_type` null across the board, the unique key effectively degenerates to `(book_id, location_name)` — which is still correct and still idempotent thanks to `nulls not distinct` (§12.1), but it means two genuinely different locations sharing a name would collapse into one row. If M0 finds a source for `location_type`, populating it widens the key and that collapse stops.
- **FR-10 — `--dry-run` mode.** Parses and maps as normal but skips all Supabase writes, logging the mapped rows that would have been written instead. It constructs no Supabase client and reads no credentials, so it runs with no `SUPABASE_SERVICE_ROLE_KEY` present — M1's dry run therefore precedes M2's credential setup rather than depending on it.
- **FR-11 — Run summary.** A PostgREST upsert returns the affected rows but not whether each was inserted or updated (`xmax = 0` isn't exposed), so the script **pre-fetches the existing `game_id` set** (`select game_id from book` — one cheap query at this table size) before writing and classifies each row against it. Logs: pages found (matched FR-3), books imported (new), updated (existing), skipped (non-`Skyrim:` page per FR-3, or no usable `id`/`game_id` per FR-8), errored (parse failure), and duplicate conflict keys collapsed before writing (FR-8/FR-9) — plus per-error book title/id for triage.
- **FR-12 — Credentials.** Reads `SUPABASE_SERVICE_ROLE_KEY` (new var) and `NEXT_PUBLIC_SUPABASE_URL` from the environment via Node's native `--env-file=.env.local`, passed by the `import:uesp` script (§12.3/§12.4 — one canonical invocation, not three); never logs or commits the key. The client is constructed **inside the run function, never at module scope** — a module-scope client would be built at import time, so importing this module in a unit test would demand env vars and construct a client for no reason. (CLAUDE.md's module-scope rule exists for a different reason — Vercel Fluid compute sharing an instance across concurrent users' requests — which doesn't reach a single-process CLI holding a sessionless service-role client.) Under `--dry-run` no client is constructed at all and no credentials are read, which is what lets M1 run before the service-role key exists (FR-10).
- **FR-13 — Provenance.** `--dump-date=YYYY-MM-DD` is a **required** flag — omitting it is an argument error, the same as omitting the dump path (FR-1). It costs the operator nothing and it is what makes AC-6 satisfiable on every run. It is recorded in the run summary alongside a CC BY-SA 2.5 attribution note, and written durably to the README attribution section (FR-13a) — stdout alone does not survive the terminal.
- **FR-13a — Durable attribution.** A README section records the source (UESP), the dump date of the most recent import, and the CC BY-SA 2.5 licence. Owned by M3, when a real dump has actually been imported. This is the provenance record the spec asked for; rendering attribution in the UI remains `prd-browse-and-track.md` FR-7's job, not this task's.
- **FR-14 — Unit-testable parsing.** `extractBookSummaryTemplate`, `parseTemplateFields`, `normalizeSkill`, `normalizeCategory`, `cleanTitle`, `cleanWikitext`, `mapToBookRow`, `parseLocations`, `mapToLocationRows`, `attachBookIds` are pure functions (no I/O), each covered by unit tests run via `yarn test` against a committed fixture (`scripts/__fixtures__/sample-dump.xml`). Tests live beside their sources as `scripts/*.test.mts`, matching the `test` script's glob (§12.3). Note that `tsconfig.json` sets `strict: false`, so the compiler will **not** enforce the `| null` unions in §12.2 — these functions handle absent values explicitly and are tested for it, rather than relying on type checking to catch it.
- **FR-15 — Title and wikitext cleanup.** Values reaching the database are cleaned, not stored raw. `cleanTitle(pageTitle)` strips the `Skyrim:` namespace prefix and a trailing disambiguator such as ` (book)` — `book.title` renders directly in the catalogue list (`prd-browse-and-track.md` FR-1), so `Skyrim:Deathbrand (book)` is not an acceptable display title. `cleanWikitext(value)` decodes HTML entities (`&nbsp;`, `&amp;`) and strips residual markup (`''emphasis''`, `<br />`, `<ref>…</ref>`, HTML comments, leftover braces) from every stored string — titles, location names, and `description` alike. Both are pure and fixture-tested (FR-14).

### Non-Functional (NFR)

- **NFR-1 — Memory.** The full dump is never loaded into memory at once; peak memory scales with a single page's size, not the dump's.
- **NFR-2 — No live UESP access from the script.** Zero network requests to `en.uesp.net` or `dumps.uesp.net` during script execution — the script has no HTTP client dependency at all. Scoped to the script: obtaining the dump is a human step performed beforehand (G1/NG6).
- **NFR-3 — Resilience.** A single malformed or unparseable page is logged as skipped/errored; it never aborts the run. This extends to the write path: no single page's data can abort a write batch (see FR-8's conflict-key dedupe), and a failed chunk is logged and reported rather than left silently partial.
- **NFR-4 — Idempotency.** Re-running against the same or a newer dump produces zero duplicate `book` or `book_location` rows.
- **NFR-5 — Secrets.** The service-role key is read from env only; never logged, never committed (`.env*.local` already gitignored).
- **NFR-6 — Scope.** The script is dev-only tooling; no route, page, or Server Action in the deployed app depends on it or imports from `scripts/`.
- **NFR-7 — Testability.** Parsing/normalization/mapping logic is verifiable via `yarn test` without a live database or the real ~176MB dump.

## 6. Constraints and Assumptions

### Constraints (from spec + architecture + this PRD)

- No live requests to UESP's servers or API — dump-file input only (robots.txt disallows both, and specifically names Anthropic crawlers).
- Metadata only — no full book text stored (architecture.md §2.2, NG6).
- CC BY-SA 2.5 attribution required in UI/README (`prd-browse-and-track.md` FR-7); this task records the dump date and license for that purpose (FR-13), it doesn't render the attribution itself.
- Writes use the Supabase service-role key, bypassing RLS — never the app's normal Server Action path.
- The script is a one-off local dev tool, not part of the deployed Next.js runtime.
- The dump file itself is never committed; `.gitignore` gets a new entry for the local dump-storage convention (e.g. a `data/` directory).
- Idempotency keys: `book.game_id` (spec Decision #2), tightened to `not null` by the new migration so the unique index can actually dedupe; `book_location(book_id, location_name, location_type)` unique constraint (spec Decision #5, same migration).
- `location_type` stays free text, not normalized (spec Decision #6).

### Assumptions

- A human downloads the dump manually and periodically; the script never fetches it.
- `book.id` stays internally generated; `book.game_id` is the natural upsert key. **Confirmed against a real page** (`Skyrim:2920, Sun's Dusk, v11`): the template's `id` field is an 8-hex-digit Bethesda Form ID (e.g. `0001ACE3`) — a record identifier the game engine itself guarantees is unique within a single plugin's data (Bethesda's tooling won't allow two records in the same file to share a Form ID), not a display convention that could drift. This also confirms the `book`/`book_location` split matches the underlying game data model: one base object (one Form ID) can be placed at many world locations, mirroring one `book` row to many `book_location` rows. Worth spot-checking one or two more Skyrim pages in M0 to rule out a fluke, but this is a stronger basis for NFR-4/idempotency than assumed when this PRD was first drafted.
- Some books will have missing/ambiguous fields (no skill, no known location, unmapped category) — these still import, with nulls/`other` rather than failing the run.
- The `Skyrim:` prefix **and** a `{{Book Summary` invocation together identify Skyrim book pages as a set — neither alone is sufficient (FR-3). The `Skyrim:` space covers DLC books as well as base-game ones (confirmed: `Skyrim:Deathbrand (book)`).
- `wtf_wikipedia`'s generic MediaWiki template parsing is compatible with UESP's specific dialect — confirmed empirically in M0, not assumed here.
- UESP's dump is `.gz`-compressed; `.bz2` support is out of scope unless M1 finds otherwise.

## 7. Risks and Mitigations

| ID  | Risk                                                                                                                                                                        | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Category taxonomy's source field/values are unconfirmed (MI1).                                                                                                              | Med        | Med    | M0 inspects real sample pages before finalizing the mapping table; `other` catch-all means nothing blocks on an unmapped value.                                                                                                                                                                                                                                                                                                                                                                                                           |
| R2  | `wtf_wikipedia` doesn't perfectly parse UESP's specific `Book Summary` usage.                                                                                               | Med        | Med    | The real failure mode is **silent lossiness, not crashes** — `wtf_wikipedia` targets Wikipedia's infobox conventions, renders wikitext to plain text, and normalizes or drops params it doesn't recognize; `Book Summary` isn't in its infobox set. NFR-3's skip-and-continue does nothing about a wrong-but-plausible value. Mitigation is therefore a **value-level check**: hand-transcribe the expected params for every fixture page and assert exact equality in M0's tests, so lossiness fails a test rather than reaching the DB. |
| R3  | UESP's dump compression format (gz vs. bz2) is unverified.                                                                                                                  | Low–Med    | Low    | `.gz` auto-detected via `zlib`; `.bz2` produces a clear "decompress manually" error rather than adding an unverified dependency.                                                                                                                                                                                                                                                                                                                                                                                                          |
| R4  | Skill/category free-text phrasing varies across pages ("Smithing +1" vs. "Smithing").                                                                                       | High       | Med    | Lookup tables match on trimmed/lowercased substrings, not exact strings; unmapped values are logged for table updates — cheap to fix since re-runs are idempotent.                                                                                                                                                                                                                                                                                                                                                                        |
| R5  | The new `book_location` unique constraint conflicts with a future schema change.                                                                                            | Low        | Low    | Constraint is on natural business-key columns; compatible with a future dedicated location entity if that's ever needed.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R6  | The committed fixture doesn't cover a real edge case only present in the live dump.                                                                                         | Med        | Low    | M1's dry run against the real dump (not just the fixture) is a required exit gate before any DB write (M2).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R7  | A future change accidentally adds live UESP network calls.                                                                                                                  | Low        | High   | NFR-2 is explicit and testable — the script has no HTTP client dependency, so violating it requires actively adding one.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R8  | The exact `Book Summary` parameter names behind `description` and `is_unique` are unconfirmed (OQ-4 decides _whether_, and is closed; OQ-5 and the parameter names remain). | Med        | Low    | M0 inspects real template fields and names them; both are populated best-effort and a page lacking either still imports (nulls / `false`).                                                                                                                                                                                                                                                                                                                                                                                                |
| R9  | Locations removed upstream are never deleted, so `book_location` drifts over successive dumps.                                                                              | Med        | Low    | **Accepted, not mitigated.** Upsert never deletes (spec Decision #5), so if a newer dump drops a location from a page, the old row persists — and neither AC-3 nor AC-4 catches it, since both only assert presence and non-duplication. No reconciliation/delete pass is added: a parse regression in `parseLocations` (FR-9b) would then silently delete real rows, which is worse than stale ones. Revisit if drift is ever observed.                                                                                                  |
| R10 | A write chunk fails mid-run, leaving the tables partially updated.                                                                                                          | Low        | Med    | PostgREST chunks are separate statements, not one transaction, so a failed chunk leaves earlier chunks committed. The failure is logged with the chunk's `game_id`s and surfaced in the run summary as a non-zero error count; recovery is simply re-running, which is idempotent (NFR-4). No rollback is attempted.                                                                                                                                                                                                                      |

## 8. Milestones / Phased Rollout

> **Prerequisite for M0, not M1:** a human-downloaded dump file must be on disk before this work starts. M0's fixture is cut from real `<page>` elements and its exit gates (R1, R2, R8, OQ-1, OQ-4, OQ-5, OQ-6, OQ-7) all resolve _against real markup_ — none of them can be met without it. The dump is the sanctioned input to this task (G1/NG6); the constraint is on what the script does at runtime.

- **M0 — Fixture + pure parsing functions.** Build `scripts/__fixtures__/sample-dump.xml` (a handful of real `<page>` elements: a normal skill book, a multi-location lore book, a book with no skill, a non-book page that must be filtered out, and a non-`Skyrim:` book page that must be dropped by FR-3's prefix check). Implement and unit-test (`yarn test`) `extractBookSummaryTemplate`, `parseTemplateFields`, `normalizeSkill`, `normalizeCategory`, `cleanTitle`/`cleanWikitext`, `mapToBookRow`/`parseLocations`, `mapToLocationRows`, `attachBookIds`. No DB, no streaming yet. **Exit:** tests green; `wtf_wikipedia`'s extraction confirmed correct against real UESP markup by **value-level diff** — hand-transcribed expected params per fixture page, asserted exactly, nested links/templates included (R2); category/skill mapping tables confirmed against real sample pages (resolves R1/R8 empirically). **If that diff fails**, this milestone does not block: swap `extractBookSummaryTemplate`'s internals for a hand-rolled brace/link-aware param splitter (roughly 50 lines — track `{{}}` nesting and treat `|` inside `[[]]` as literal, ignore HTML comments), drop the `wtf_wikipedia` dependency, and keep the same tests as the contract.
- **M1 — Streaming + dry run.** Wire the `sax`-based streamer to the M0 functions; `--dry-run` logs mapped rows for the fixture and, once available, a real downloaded dump. **Exit:** dry run against the fixture produces exactly the expected rows; dry run against a real dump surfaces no unexpected crashes (R6 check).
- **M2 — Migration + DB writes.** Apply the new migration **first** (§12.1: `book.game_id set not null`, `book.category`/`book.skill` check constraints against M0's finalised taxonomies, `book_location` unique constraint, drop of the redundant `book_location_book_idx`) — neither upsert's `on conflict` target exists without it, so this cannot follow the write step. Then the Supabase upserts (`book` on `game_id`, `book_location` on the new constraint) plus the run-summary log (FR-11/FR-13). **Exit:** migration applied; re-running against the same input produces zero duplicate/changed rows (NFR-4).
- **M3 — Full-dump run.** Run against a real downloaded dump; add the README attribution section (FR-13a). **Exit:** success criteria in §9 met (large majority of ~800 books, resolved categories, normalized skills where applicable).

## 9. Acceptance Criteria

- AC-1. Running the script against a current dump populates `book` with the large majority of Skyrim's ~800 books.
- AC-2. Every imported book has a resolved `category` (including `other` where unmapped); skill books have a non-null, normalized `skill`. (FR-6, FR-7)
- AC-3. Books with known locations have corresponding `book_location` rows, one per location. (FR-9)
- AC-4. Re-running the script against the same or a newer dump produces no duplicate `book` or `book_location` rows. (NFR-4) — note this asserts non-duplication only; it does **not** assert that rows removed upstream disappear, which is accepted drift (R9).
- AC-5. The script makes no network requests to `en.uesp.net`/`dumps.uesp.net` during execution. (NFR-2) — scoped to script runtime; the prior human download of the dump is expected input.
- AC-6. The source dump's date and CC BY-SA 2.5 license are present in the run summary output, and in the README attribution section after a real import. (FR-13, FR-13a)
- AC-7. `yarn test` passes with no network or DB access required — all pure parsing/normalization/mapping functions covered against the fixture. (FR-14, NFR-7)
- AC-8. `--dry-run` against the fixture produces the exact expected mapped rows before any real DB write is attempted. (FR-10)
- AC-9. A malformed/unparseable page is logged as skipped/errored, and the run completes rather than aborting. (NFR-3)

## 10. Success Metrics

- **Coverage:** ≥ 90% of the pages matching FR-3's filter produce a `book` row. The denominator comes from the dump itself, not a hardcoded catalogue size — `prd-browse-and-track.md` MI1 explicitly refuses to canonize the "/820" figure, and this PRD shouldn't reintroduce it. (The familiar ~800 is a rough sanity check on the run, nothing more.)
- **Data completeness:** 100% of imported books have a resolved `category` (including `other`). Skill completeness is governed by AC-2 at 100%, not by a percentage target here: an unmapped skill value is a **lookup-table gap, not missing data** (R4 logs every unmapped value for exactly this), and re-runs are idempotent, so the loop is "run → read the unmapped log → extend the table → re-run" until AC-2 holds. A first-run figure below 100% is a diagnostic that the table needs extending, not an acceptable resting state.
- **Idempotency:** 0 duplicate rows across repeated runs — a hard requirement (AC-4), not a target.
- **Parse failure rate:** < 5% of pages matching the `{{Book Summary` filter fail to parse; anything above that is investigated before treating an import run as final.
- **Test coverage:** every pure function (`extractBookSummaryTemplate`, `parseTemplateFields`, `normalizeSkill`, `normalizeCategory`, `cleanTitle`, `cleanWikitext`, `mapToBookRow`, `parseLocations`, `mapToLocationRows`, `attachBookIds`) has at least one fixture-backed test case.

## 11. Open Questions

- **OQ-1 (MI1):** The `Book Summary` template's exact name/capitalisation (FR-3 matches loosely precisely because this is unconfirmed), plus the exact category taxonomy — source template field name and canonical value set. Resolved empirically in M0; the provisional list in §12.1's `book_category_valid` check constraint must be updated to M0's finding before that migration is applied in M2.
- **OQ-2 (MI3):** Is the UESP dump `.gz` or `.bz2`? Assumed `.gz`; confirmed (or `.bz2` support added) once a real dump is downloaded.
- **OQ-3:** Does `dumps.uesp.net` expose a discoverable per-dump date (filename convention, HTTP header) that could later replace the manual `--dump-date` flag? Not investigated here since it would require visiting the site.
- **OQ-4 (closed — M8):** `book.description` **is** populated by this import, best-effort, from the named `Book Summary` parameter carrying UESP's short editorial descriptor (the one-line subtitle on a book page, e.g. "The tale of a legendary pirate and his treasure"). Hard rule: a **named template parameter only, never the page's body prose** — the body is the book text NG2 excludes, and nothing may source `description` from it. M0 confirms the exact parameter name. Note that no current feature renders it: `prd-browse-and-track.md` FR-1's list row is title/category/skill/flags, and the detail page that would show a description is deferred (its NG1). It is imported anyway because it costs one field on ~800 rows and re-running is idempotent, so the alternative is a second pass later.
- **OQ-5:** Is `book.is_unique` derivable from a `Book Summary` parameter, or from category membership (e.g. a "Unique Books" wiki category)? Confirmed in M0.
- **OQ-6:** How is UESP's `Skyrim:` space represented in the dump — a numbered MediaWiki namespace exposed in `<page><ns>`, or a title prefix inside ns 0? Determines whether FR-3's hard filter reads `<ns>` or the title string. Confirmed in M0 against the real dump.
- **OQ-7 (M4):** What is the real shape of the `Book Summary` `loc` field — delimiter (`<br />`, `*` list, commas, something else), whether values arrive as `[[link|label]]` pairs needing unwrapping, and whether nested location templates appear? `parseLocations` (FR-9b) can't be written until this is known. Also: does any field carry `location_type` or per-location `notes` (FR-9c), or do both stay null? Resolved in M0.

---

## 12. Technical Design

### 12.1 New Migration

`supabase/migrations/<timestamp>_import_upsert_keys.sql` (timestamp-prefixed, matching the existing `20260819040000_user_book.sql` convention).

**Prerequisite: Postgres 15 or newer** — `unique nulls not distinct` is 15+ syntax and this migration will not parse on 14. Verify before M2 that the local Supabase CLI's Postgres image major version matches the hosted project's; the CLI's version comes from its own config, not from the hosted project, so the two can silently diverge.

```sql
-- Migration: import_upsert_keys
-- Feature: Import UESP Book Data (see docs/specs/prd-import-uesp-books.md §12, spec Decision #5)
--
-- Makes both upsert keys used by the import script actually enforceable.

-- book.game_id is `text unique` but NULLABLE, and Postgres treats NULLs as
-- distinct in a unique index -- so `on conflict (game_id)` cannot dedupe rows
-- whose game_id is null, and every re-run would insert a fresh duplicate for
-- any book page lacking a Creation Kit `id`. Free to tighten now: the table
-- is still empty. The script additionally skips such pages (FR-8/FR-11), so
-- this is defense in depth against any other writer.
alter table book
  alter column game_id set not null;

-- Replaces the placeholder free-text category/skill columns with the fixed
-- taxonomies this task defines (§3, G2; closes prd-browse-and-track.md OQ-8's
-- "fixed enum vs free-text" question in favour of a fixed set). Check
-- constraints rather than Postgres enum types: the value sets are still being
-- confirmed empirically in M0, and revising a check constraint later is a
-- drop-and-re-add in a new migration, where `alter type` on an enum is
-- materially harder to reverse.
--
-- The exact `category` values below are PROVISIONAL until M0 finalises the
-- taxonomy against real sample pages (OQ-1) -- this migration lands in M2,
-- after M0, so the list must be updated to M0's finding before it is applied.
-- The 18 skill values are known now and are not provisional.
alter table book
  add constraint book_category_valid
  check (category in ('skill_book', 'lore_book', 'quest_book', 'other'));

alter table book
  add constraint book_skill_valid
  check (
    skill is null
    or skill in (
      'One-Handed', 'Two-Handed', 'Archery', 'Block', 'Smithing',
      'Heavy Armor', 'Light Armor', 'Alteration', 'Conjuration',
      'Destruction', 'Illusion', 'Restoration', 'Enchanting',
      'Alchemy', 'Sneak', 'Lockpicking', 'Pickpocket', 'Speech'
    )
  );

-- Enables upserting book_location rows idempotently across re-runs of the
-- import script, mirroring book.game_id's role for the book table.
--
-- `nulls not distinct` matters here: location_type is nullable free text
-- (Decision #6, never normalized), and Postgres's default unique semantics
-- treat NULL as distinct from any other NULL. Without this clause, two rows
-- for the same book_id/location_name with a NULL location_type would NOT
-- collide on conflict -- re-running the import would insert a duplicate
-- instead of upserting, silently breaking the idempotency this constraint
-- exists for.
alter table book_location
  add constraint book_location_unique
  unique nulls not distinct (book_id, location_name, location_type);

-- Superseded by the unique index that the constraint above creates: book_id is
-- its leftmost column, so book_id-only lookups AND the book_id foreign key's
-- ON DELETE CASCADE are both still served by an index afterwards. Keeping this
-- separate single-column index would just duplicate storage/maintenance cost.
-- `if exists` so the migration is safe to apply to a database where an earlier
-- attempt already removed it.
drop index if exists book_location_book_idx;
```

### 12.2 Script Structure (`scripts/import-uesp.mts`)

Pure functions (unit-tested, no I/O):

```ts
type RawTemplateParams = Record<string, string>;

type ParsedBook = {
    gameId: string;
    title: string;
    rawSkill: string | null;
    rawCategory: string | null;
    rawLocations: string[];
    description: string | null;
    isUnique: boolean;
};

function extractBookSummaryTemplate(wikitext: string): RawTemplateParams | null;
function parseTemplateFields(
    params: RawTemplateParams,
    title: string,
): ParsedBook;

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
type Category = 'skill_book' | 'lore_book' | 'quest_book' | 'other'; // finalized in M0

function normalizeSkill(raw: string | null): Skill | null;
function normalizeCategory(raw: string | null): Category;

type BookRow = {
    game_id: string; // 8-hex-digit Bethesda Form ID, e.g. "0001ACE3" (confirmed §6)
    title: string;
    category: Category;
    skill: Skill | null;
    description: string | null;
    is_unique: boolean;
};
// book_id is unknown at mapping time (book.id is a server-generated uuid), so
// the pure mapper emits rows keyed by game_id and the I/O glue swaps in the
// real uuid once the book upsert returns it -- see FR-9a.
type MappedLocation = {
    gameId: string;
    location_name: string;
    location_type: string | null;
    notes: string | null;
};
type LocationRow = {
    book_id: string;
    location_name: string;
    location_type: string | null;
    notes: string | null;
};

function cleanTitle(pageTitle: string): string; // 'Skyrim:Deathbrand (book)' -> 'Deathbrand'
function cleanWikitext(value: string): string; // entities decoded, residual markup stripped
function mapToBookRow(parsed: ParsedBook): BookRow;
// Splitting rules unknown until M0 -- see FR-9b / OQ-7.
function parseLocations(rawLoc: string): string[];
function mapToLocationRows(parsed: ParsedBook): MappedLocation[];
function attachBookIds(
    rows: MappedLocation[],
    idsByGameId: Map<string, string>,
): LocationRow[];
```

I/O glue (not unit-tested directly — exercised via `--dry-run` against the fixture and, in M1, a real dump):

- Stream the dump file with `sax`, auto-gunzip on `.gz`.
- Per `<page>`: filter (FR-3) → `extractBookSummaryTemplate` → `parseTemplateFields` → normalize → map.
- `--dry-run`: log mapped rows. Otherwise: dedupe by conflict key (FR-8/FR-9), then batch-upsert `book` (chunks of ~500, `onConflict: 'game_id'`) with `.select('id, game_id')` chained so each chunk returns its uuids; fold those into a `game_id → id` map, `attachBookIds` the mapped locations, then upsert `book_location` (`onConflict: 'book_id,location_name,location_type'`).
- Track counters (found/imported/updated/skipped/errored) and print the run summary, including `--dump-date` and a CC BY-SA 2.5 note.

### 12.3 New Dependencies

> Versions below are illustrative, not verified against the live npm registry — resolve actual versions via `yarn add <pkg>` at build time rather than treating these as pinned.

`@supabase/supabase-js` is **already a dependency** (`^2.112.2`) — do not re-add it. Everything below is genuinely new.

```json
{
    "devDependencies": {
        "tsx": "^4",
        "sax": "^1",
        "wtf_wikipedia": "^10",
        "@types/sax": "^1"
    }
}
```

`package.json` scripts addition:

```json
{
    "scripts": {
        "test": "node --import tsx --test \"scripts/**/*.test.mts\"",
        "import:uesp": "node --env-file=.env.local --import tsx scripts/import-uesp.mts"
    }
}
```

Script and test files are `.mts`, not `.ts`. `package.json` has no `"type"` field, so a `.ts` under `scripts/` would resolve as CommonJS while `tsconfig.json` is set to `module: esnext` / `moduleResolution: bundler` — `.mts` is unambiguously ESM without making the whole repo (and Next 16's config resolution) ESM to get there. `tsconfig.json`'s `include` already covers `**/*.mts`.

### 12.4 Env

`.env.local` gains one new var (never committed — `.env*.local` is already gitignored):

```
SUPABASE_SERVICE_ROLE_KEY=
```

One canonical invocation, already wired into the `import:uesp` script above (§12.3):

```bash
yarn import:uesp data/uesp-dump.xml.gz --dump-date=2026-09-01 [--dry-run]
```

which expands to `node --env-file=.env.local --import tsx scripts/import-uesp.mts …`. Note `--import tsx`, not `-r tsx/cjs` — the require hook is CommonJS-only and would fail on an ESM-only dependency, and it must match the loader the `test` script uses.

### 12.5 Existing checks

`tsconfig.json`'s `include` is `**/*.ts` / `**/*.mts` with only `node_modules` excluded, so `scripts/**` is picked up by the project's existing checks from the first file. Per CLAUDE.md, that means `scripts/**` must pass `eslint`, `tsc --noEmit -p tsconfig.json`, and `prettier --check` like any other source — the ESLint config is flat and applies to `.`, so no new lint setup is needed, but Node-globals usage in the script should be verified against it once. CLAUDE.md's "No CI is wired up yet … that's the only check there is" list gains `yarn test` as part of this task.

### 12.6 `.gitignore` addition

```
/data/
```

— the conventional local-only location for the downloaded dump file.

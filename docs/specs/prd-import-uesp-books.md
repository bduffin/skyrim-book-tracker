# PRD: Import UESP Book Data

> Stage: PRD — derived from `docs/specs/spec-import-uesp-books.md`, grounded in `docs/architecture.md`.
> Status: Rewritten against a real dump (`uespwiki-2026-08-30-current.xml.bz2`, 177MB, bzip2, MediaWiki 1.31.16, export schema 0.10). Every count below is measured from that file, not assumed.

## Core Thesis (preserved from spec)

> The `book` and `book_location` tables exist but are empty — nothing populates them yet. The app can't browse or track anything until this data exists. UESP is the canonical source, but it must be accessed via their sanctioned bulk-download mechanism, not live scraping.

---

## 0. What inspecting the dump changed

The previous draft was written before a dump existed. Nearly every structural assumption in it was wrong. This table is the record, so the same guesses aren't made again.

| Previous assumption                             | Measured reality                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template is `{{Book Summary}}`                  | `{{Game Book}}`. `Book Summary` appears **once** in the entire wiki.                                                                                                                                                     |
| `Skyrim:` is a title prefix, namespace unknown  | Namespace **134**, a real MediaWiki namespace holding 17,515 pages.                                                                                                                                                      |
| Dump is `.gz`                                   | **`.bz2`** — the case the old FR-2 treated as an error.                                                                                                                                                                  |
| `--dump-date` must be supplied by hand          | The filename encodes it: `uespwiki-YYYY-MM-DD-current.xml.bz2`.                                                                                                                                                          |
| `book.game_id` is a unique natural key          | 1,206 pages carry a `\|id=` key and 1,198 a non-empty value; only **1,120 values are distinct**, so 78 pages collide. Counts are of non-empty values — an empty id cannot collide. Unusable as identity.                 |
| Category comes from a `type` field              | `type` is `List 0`–`List 4`, present on 259 of 1,207 books. Not a taxonomy.                                                                                                                                              |
| Category can come from wiki category membership | `{{Game Book}}` injects categories at render time; a dump holds only literally-written ones.                                                                                                                             |
| `book_location.notes` has no source             | Every `loc` bullet carries free-text notes after the location link.                                                                                                                                                      |
| `value`/`weight` are marginal                   | The two best-populated fields in the template — 1,206 of 1,207 books each.                                                                                                                                               |
| ~800 books                                      | **881** base + DLC (684 base, 136 Dragonborn, 51 Dawnguard, 10 Hearthfire), plus 326 Creation Club = 1,207. The old estimate was a fair guess at base+DLC; Creation Club is what it missed.                              |
| A `{{Game Book` substring identifies books      | It also matches **`{{Game Book Compilation}}`** — 38 series index pages (`The Song of Pelinal`, listing v1–v8), none obtainable and all with no `\|id=`. Found by M0's fixture; the name match must be delimited (FR-3). |

---

## 1. Problem Statement

The app has no book data to browse or track — `book` and `book_location` are empty, and every feature in `prd-browse-and-track.md` depends on them being populated. UESP is the only viable structured source, and its `robots.txt` disallows both the MediaWiki API and bot crawling, naming Anthropic crawlers specifically. The sanctioned mechanism is UESP's weekly full-wiki XML dump, downloaded by a human. This task builds a local, re-runnable import script that turns that dump into normalized rows, resolving the skill and category normalization that `prd-browse-and-track.md` FR-3 depends on.

## 2. Goals and Non-Goals

### Goals

- G1. Populate `book`/`book_location` from the downloaded dump. **The script makes no HTTP requests except its Supabase writes** — no UESP access at runtime, and no HTTP client dependency beyond `supabase-js`.
- G2. Resolve the skill and category normalization that `prd-browse-and-track.md` FR-3 depends on, with enumerated values enforced by Postgres check constraints and derived from the dump rather than invented.
- G3. Make re-running safe: no duplicate or lost rows, on the same dump or a newer one.
- G4. Import the template's full attribute set, not a minimal subset — the pages are richly populated and the UI will surface these fields.
- G5. Keep parsing verifiable in small increments (pure functions, fixture tests, `--dry-run`) rather than only checkable against a 177MB file and a live database.
- G6. Record dump provenance (date, CC BY-SA 2.5) durably.

### Non-Goals

- NG1. Cover art / image import. The `icon` **filename** is stored as metadata (it drives categorization); no image is fetched or hosted.
- NG2. Full book **body text** storage — a **scope** decision, not a licensing prohibition. CC BY-SA 2.5 permits redistribution with attribution and share-alike, and architecture.md §2.2 contemplates it. The body prose lives in namespace 130 (`Lore:`, 4,035 `{{Lore Book}}` pages) and is never stored. The task _does_ read that namespace for three short metadata fields (FR-4a) — a subtitle, an author and an errata note — which MediaWiki transcludes onto the book page at render time and which are therefore invisible to a book-page-only parse.
- NG3. Scheduled/automatic re-running — manual invocation only.
- NG4. Books from other TES games. Namespace 134 is Skyrim-only, so this falls out of the filter for free.
- NG5. Real-world novels — namespace 140 (`Books:`) holds published fiction (`{{Real Book Summary}}`), not in-game items. Excluded by the namespace filter.
- NG6. `location_type` **normalization** — it carries the FR-11 extraction tier (`place` / `carrier` / `nearby`) and is otherwise free text, never mapped to a curated taxonomy of place kinds. Nothing in `prd-browse-and-track.md` reads it.
- NG7. Spell tomes (93) and recipes (28) as tracked items — they are consumable item pages, not `{{Game Book}}` pages, and importing them would require parsing a second template (OQ-4).

## 3. Current State Analysis

- **Greenfield tooling.** No `scripts/` directory, no XML/wikitext dependencies, no test runner in `package.json`.
- **The schema is placeholder-quality and structurally wrong for this data.** `book` has `game_id text unique` as its natural key — which the dump disproves (§0) — and no column for the identifier that does work. `category`/`skill` are untyped `text`.
- **`.env.local`** has `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only — no secret key. `.env*.local` is gitignored.
- **`.gitignore`** now ignores `/data/`, where the dump lives.
- **Stack fit.** Node 24 (`.nvmrc`), TypeScript 6, Yarn 4.17.1 — supports `tsx` and Node's native `--env-file-if-exists`.

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
        │  1,207 pages
        ▼
parseGameBookTemplate(wikitext)   ──► flat { key: value } params
        │
        ├─ identity:   <page><id>            ──► uesp_page_id  (unique, stable)
        ├─ attributes: id/id2..id5, value, weight, author, description, icon, lorename
        ├─ classifyCategory(parsedPage)      ──► skill_book | book | journal | note
        │                                        | black_book
        ├─ classifySource(smod, categories)  ──► base | dawnguard | dragonborn
        │                                        | hearthfire | creation_club
        ├─ normalizeSkill(params.skill)      ──► one of 18 Skyrim skills | null
        └─ parseLocations(params.loc)        ──► [{ name, notes, locationType }]
        │
        ▼
  --dry-run ? report : write via supabase-js (secret key)
        │        book:          onConflict 'uesp_page_id'
        │        book_location: replace-per-book via transactional RPC
        ▼
  run report by category and source: found / new / updated / skipped / errored
```

**Key design tradeoffs**

- **MediaWiki page `<id>` as identity, not the Form ID.** Measured: 78 of 1,198 pages share a `|id=` value, because Creation Club items render as `fexxx8NN` placeholders (`fexxx819` alone is used by 11 pages) and DLC items as `xx……`. Upserting on that would silently merge ~44 distinct books while reporting zero duplicates. Page `<id>` is unique by MediaWiki construction, present on every page, and stable across renames. Tradeoff: a page deleted and recreated upstream gets a new id and imports as a new row — rare, and detectable via the stored title.
- **Classification from `icon`, not from wiki categories.** Categories are template-injected and absent from the dump; replicating them would mean parsing `Template:Game Book` and reimplementing its logic. `icon` is present on 1,164 pages and cleanly separates the types the UI needs.
- **`bzip2 -dc` subprocess over an npm bz2 library.** No new dependency, no 2–4GB intermediate file, and `bzip2` ships with macOS and every Linux distro. Tradeoff: a system dependency, checked for at startup with a clear error.
- **Hand-rolled template parser over `wtf_wikipedia`.** Not because the markup is simple — measured, it isn't: **95% of pages carry a piped `[[a|b]]` link inside the template and 16% nest another template inside it** (`{{Map Link}}` 185, plus `{{DB}}`/`{{DG}}`/`{{CC}}`/`{{HF}}`, `{{Lore Link}}`, `{{Showhide/Start}}`, `{{Bug}}`, `{{sic}}`). The parser must therefore be genuinely brace- and link-aware, and that is real work — roughly 80 lines — not a shortcut. It is chosen because (a) `wtf_wikipedia` ships fetch APIs, which would make NFR-2's "no HTTP client dependency" false and hollow out R7, and (b) its documented failure mode is silently normalizing or dropping params it doesn't recognize — wrong-but-plausible values reaching the database, which skip-and-continue cannot catch. The nesting is one level of simple inline templates, not arbitrary recursion, so a brace counter is bounded. M0's value-level diff against hand-transcribed expected params is the gate on it.
- **Replace-per-book locations over pure upsert.** Locations are the feature's point — a stale location sends a player somewhere the book isn't. Replacement happens only for books that parsed successfully, so a parse regression cannot wipe good rows.

## 5. Requirements

### Functional (FR)

- **FR-1 — CLI entry.** Takes the dump path as a required positional argument; errors clearly (no stack trace) if missing or unreadable.
- **FR-2 — Streaming parse.** `createReadStream` → compression detection by **magic bytes** (`BZh` → `bzip2 -dc` subprocess; `1f 8b` → `zlib.createGunzip()`; neither → treat as plain XML) → `sax.createStream()`. Never `zlib.gunzip`, which is the one-shot buffer API. Detection is by content, not extension: a truncated HTML error page named `.xml.bz2` must fail loudly rather than be parsed as XML.
- **FR-3 — Catalog filter.** A page qualifies only if `<ns>` is **134** _and_ its wikitext invokes `{{Game Book}}`. The match is case-insensitive and tolerant of whitespace/underscores (`{{Game Book`, `{{ game book`, `{{Game_Book`). HTML comments and `<nowiki>` blocks are stripped before the test, so a commented-out example doesn't qualify. Redirect pages are skipped. The name match must be **delimited** — followed by `|`, `}` or a newline — because `{{Game Book Compilation}}` is a _different_ template for series index pages and a loose substring test matches it. Those 38 pages list a series' volumes, carry no `id` and are not obtainable items; the individual volumes are separate book pages that qualify on their own. Expected yield: **1,207** pages, with 38 compilations excluded.
- **FR-4 — Template extraction.** `parseGameBookTemplate(wikitext)` returns the `{{Game Book}}` template's flat parameters, or `null` if the page has no parseable invocation. **A page may carry more than one template**, and one signal lives outside `{{Game Book}}`: the Oghma Infinium's `artifacttype=Daedric Artifact` is in a separate `{{Artifact Summary}}` block. `parseArtifactSummary(wikitext)` extracts it, and `[[Category:Skyrim-Items-Artifacts]]` is captured in `categoryLinks` as a cross-check — both appear on exactly that one page. Classification therefore consumes the whole `ParsedPage`, not `params` alone (FR-7).

    **Do not merge the two templates into one `params` map.** `{{Artifact Summary}}` defines `type`, `value` and `weight` under the same names as `{{Game Book}}`, and its `type` is `[[Skyrim:Books|Book]]` where Game Book's is `List 0`–`List 4` — merging would silently corrupt the field FR-7 once relied on. Each template gets its own named parser; only `artifactType` crosses over. This is the general pattern: `params` is Game Book only, other templates get named parsers, page-level links go to `categoryLinks` (which is already how Creation Club detection works). Brace- and link-aware: a `|` inside `[[…|…]]` or a nested `{{…}}` is not a parameter separator.

- **FR-4a — Lore-page lookup.** `description`, `author` and `textnote` may live on the book page **or** on its lore page, and MediaWiki transcludes the lore page's values at render time — so a book-page-only parse silently loses them. `Skyrim:Thief (book)` carries no `description`, yet the rendered page shows "The second chapter of the adventures of Eslaf Erol", which lives in `Lore:Thief`'s `{{Lore Book}}`.

    The ns-130 lore pages are collected in the **same streaming pass** as the books — a separate pass costs minutes and the buffered result is ~2.3 MB — building a `lorename → {description, author, textnote}` map from `{{Lore Book}}` templates; the book page's own value always wins, and the lore value fills the gap. Measured: 116 books carry a non-`none` `lorename`, all 115 distinct values resolve to `Lore:<lorename>` **by exact title match**, and all 115 have a description — so no book fails to resolve. This lifts description coverage from 462 to 573 books and author from 461 to 571. `SRName` on the lore page is a reverse link but exists on only 117 of 4,035 lore pages, so it is a cross-check, not the key.

    **Same fail-fast rule as FR-6c**: if the ns-130 pass resolves _no_ lorenames at all while book pages reference them, that is structural breakage — `{{Lore Book}}` renamed, or the namespace filter wrong — and aborts the run. Silently it would only look like description coverage dropping 573 → 462, which no acceptance criterion would catch. A partial shortfall is reported, not fatal.

    Only those three short fields are read. The page's body prose is never stored (NG2).

- **FR-5 — Identity.** `uesp_page_id` (the `<page><id>` integer) is the upsert key. `game_id` (the `|id=` Form ID) is stored as a **non-unique, nullable attribute**, alongside `game_id_extra` for `id2`–`id5` (6 pages). Placeholder prefixes (`xx`, `fexxx`) are preserved verbatim, never expanded.
- **FR-6a — Sentinel and field semantics.** `lorename` is `none` on **729 of the 845 books that set it** — a sentinel, not a value; it is stored as null, leaving 116 real lore links. `description` is the short subtitle UESP shows under the title ("A hint on how to solve Shalidor's Maze") and maps to `book.description`. `note` is a **boolean flag** — its only value across 488 pages is `1` — not prose. `textnote` and `comment` are different things and **never co-occur** (0 of 1,207 pages set both): `textnote` is italicised errata about the record (variants, duplicate ids, naming errors) and maps to `errata`; `comment` is plain-text gameplay significance (quest relevance, links to other books) and maps to `gameplay_note`.
- **FR-6 — Attribute mapping.** All populated template fields map to columns: `description` (462 on the book page, 573 after the FR-4a lore fallback), `author` (461, 571 after fallback), `value` (1,207, stored as text — 3 pages carry dual values like `65 (Skill Book)<br>6 (Normal)`), `weight` (1,207, all numeric), `icon` (1,164), `lorename` (852), `sumtitle` (233), `errata` (49, 152 after fallback), `gameplay_note` (48), `artifact_type` (1), `is_obtainable` (false on 1), and the series links `up`/`next`/`prev` (~165 each).
- **FR-6b — Faithful import, no editorial filtering.** Every ns-134 `{{Game Book}}` page becomes a row. The script never excludes or merges books: UESP has already collapsed in-game variants to one page (a page reading "there are five versions of this book" is one book), and unobtainable or cut content stays in with its `errata` intact. Prose-based exclusion was rejected as unreliable — matching phrases like "cannot be found" yields ~19 pages including false positives such as `Amaund Motierre's Sealed Letter`, a quest item players do receive. Filtering is a browse-time concern, consistent with how `source` handles Creation Club; a curated exclusion list, if ever wanted, belongs in a hand-maintained table, not parser output. 49 pages have no `loc` field at all, which the UI can render as "no known location" from zero `book_location` rows.
- **FR-6c — Obtainability.** `is_obtainable` marks books a player cannot actually acquire, so browse can exclude them from a completion denominator without every query carrying an id list.

    **Sourced from UESP, not inferred.** `Skyrim:Unobtainable Items` maintains a curated `Unobtainable Books & Notes` section as `{{Book Normal|Page Title}}` rows — 23 books, all 23 present in our catalog. That page is read in the same streaming pass as the books and the lore pages. Parsing must be **scoped to that section**: the same page also lists unobtainable weapons, armour, scrolls and spell tomes, none of which are `{{Game Book}}` pages. One local supplement is added — `Skyrim:Shalidor's Insights (unused pages)`, which UESP does not list — giving **24** flagged books.

    Prose matching was rejected for this: searching for phrases like "cannot be found" yields ~19 pages including false positives such as `Amaund Motierre's Sealed Letter`, a quest item players do receive. A title-suffix heuristic was also tried and caught only 1 of the 24.

    **Eight of the 24 fall inside the default scope**, so this is not a rounding error: `The Secrets of Ragnvald` and `Tolfdir's Book` (real books cut from the game), `Shalidor's Insights (unused pages)`, and five Bethesda typography test assets whose titles are strings of accented vowels (`À â é è ê ë ù û ü î ï ô ç`, `123 Abc Def Ghijklmnop Qrstu VWXYZ 123456789`). Without the flag those render in the catalogue as books no player can collect.

    **The run aborts if that page cannot be read.** Three things can break independently and two leave the page intact: the page is renamed or removed, the section heading changes, or the row template changes — and all three yield an empty set, which would silently mark every book obtainable and slide eight of them into the default scope while the run reported success. So the assertion is on the **parsed result**, not on page presence: zero entries is a hard error naming which stage failed. The count checked is what the **page** yielded, never an effective count including the local supplement — that one entry would turn a broken page's 0 into a 1 and disarm the guard, so the two sources are kept separate rather than merged into one set. A changed _count_ (23 → 21) is legitimate data drift and only reported (FR-17), never fatal.

    This fails at contributor time, when someone is running an import against a new dump and can fix it. It can never reach a user.

    `true` still means "nothing has marked this otherwise", not "verified obtainable" — but the curation is now UESP's and refreshes with each dump, rather than being a list I maintain.

- **FR-7 — Category classification.** `classifyCategory(page: ParsedPage)` → one of `skill_book`, `black_book`, `treasure_map`, `note`, `journal`, `book`, evaluated **in that order** — the order is load-bearing:
    1. `skill_book` — has `skill=` **or** a non-null `artifactType` (91). Note `artifactType` is **not** a `{{Game Book}}` parameter (FR-4) — reading it from `params` would silently leave Oghma as `book`. The artifact branch exists for the Oghma Infinium alone: it is the one book whose whole purpose is raising skills (+5 across a chosen path of six), so `skill=` cannot hold it, and UESP counts it as a skill book. Keyed on `artifacttype` / `[[Category:Skyrim-Items-Artifacts]]`, both of which appear on exactly one page — a data signal, not a title match. Must come first: `icon` is artwork and is reused, so the 25 magic-school skill books carry `SR-icon-book-SpellTome*.png` and would otherwise misclassify.
    2. `black_book` — icon `Black Book` (7, all Dragonborn).
    3. `treasure_map` — **title-derived**, unlike every other tier: treasure maps carry no icon, no `type` and `value=0`, so no template field distinguishes them. The title does — `\btreasure map\b` matches all 12 with zero false positives across 1,207 books. Needed because only 11 set `note=1`; `Velehk Sain's Treasure Map` sets neither flag nor icon and would otherwise fall through to `book`. They are collectible items that happen to add a map marker, and a separate category lets a player hunt all ten without enabling 539 notes. Yield 12.
    4. `note` — **`note=1` OR a Note-family icon** (`Note`/`TornNote`/`BloodstainedNote`), **unless** the icon is Journal-family _and_ the title contains "Journal" (see tier 4). Union, because measured, each signal misses what the other catches: 42 Treasure Maps carry the flag with **no icon at all**, and 64 obvious notes (`Mysterious Note (Delphine)`, `Amaund Motierre's Sealed Letter`, `Museum Pamphlet`) carry the icon with no flag. The disagreement is wiki data-entry inconsistency, not a semantic distinction. `note` is boolean — its only value across 488 pages is `1`. Yield 539.
    5. `journal` — icon `Journal*`. Ordered **after** `note`, with a title tiebreak. 8 pages carry journal artwork _and_ `note=1`: three Thalmor Dossiers (Ulfric, Delphine, Esbern), `Heddic's Volunruud Notes`, `Daynas Valen's Notes`, `Red Eagle's Rite`, `Sculptor Visthar's Journal` and `Urzog's Journal`. Note-before-journal is right for the first six; the tiebreak — Journal icon **and** "Journal" in the title wins over `note=1` — recovers the last two, which are journals by name. Measured: exactly 2 pages move, and all 8 land correctly. Yield 199.
    6. `book` — everything else (359). An unrecognized icon lands here and is logged.

- **FR-8 — Quest relation.** `is_quest_related` is a **boolean flag, not a category** — true when `quest` (312) or `questrel` (222) is present. A skill book can also be quest-related; a single-value taxonomy could not express that.
- **FR-9 — Source classification.** `classifySource()` → `dawnguard` | `dragonborn` | `hearthfire` from `smod` (DG, DB, HF); `creation_club` from a `[[Category:Skyrim-Creation Club-…]]` link; otherwise `base`. Measured yield with the `mod` fallback applied: base 684, creation_club 326, dragonborn 136, dawnguard 51, hearthfire 10. **`smod` alone is insufficient** — only 2 CC pages set `smod=CC` while 327 carry the category. **`mod` is the fallback when `smod` is absent** — measured, 4 pages carry `mod=[[Skyrim:Dawnguard|Dawnguard]]`, `mod=Hearthfire` or a Creation Club content name with no `smod` and no CC category link (e.g. `Skyrim:Discovering Ruunvald`, `Skyrim:Ransom Note`); classifying on `smod` alone files them as `base`. Resolution order: `smod` → CC category link → `mod` name → `base`.
- **FR-10 — Skill normalization.** `normalizeSkill(raw)` maps onto Skyrim's 18 skills by **exact match after trim/case-fold, plus a small alias table** (`One Handed` → `One-Handed`). Not substring scanning: a value naming two skills would otherwise silently pick one. Unmapped values → `null` + logged for table extension; never fail the run.
- **FR-11 — Location parsing.** `parseLocations(raw)` splits the `loc` field on `*` bullets. The split rule must be explicit rather than assumed — three different counting methods gave 2,343 / 2,495 / 3,537 bullets, which is itself evidence the format needs specifying. Within a bullet, templates (`{{Map Link|…}}`, `{{DB}}`) are stripped and link anchors dropped (`[[Skyrim:Bleak Falls Barrow (place)#Bleak Falls Temple|Bleak Falls Temple]]` → `Bleak Falls Temple`). Extraction runs in **tiers**, because a leading-link-else-plain-text rule misreads roughly a quarter of bullets:

    **Notes carry the whole bullet, with `[[Target|Label]]` links intact.** `location_name` is still the extracted place, in clean text, so filtering and grouping are unaffected; `notes` is the entire bullet run through `cleanKeepingLinks` — every cleaning step except `unwrapLinks`. Taking the whole bullet is what makes a mid-sentence place survive. The earlier rule kept only the text either side of the extracted link, which closed the gap and left wreckage: `Basement of , behind a master-locked door`, `The , on a bookshelf in Sybille Stentor's room`, `On ' skeleton in Twilight Sepulcher`. **322 of 2,327 rows had text on both sides of their link and 86 were visibly damaged.** Keeping the links rather than rendering them costs nothing at import — masking them keeps entity decoding, template stripping, HTML removal and quote markup at import time — and lets browse link out to UESP, which is also good CC BY-SA practice. The reader's whole obligation is `unwrapLinks`, which already exists and is exported. Sub-bullets (`**`, one place holding several copies) carry the parent bullet's text into each child, joined with `; ` — without it those were the only rows whose notes never named their place, and a parent like `Fort Dawnguard, on the ground floor` lost that detail entirely. `notes` is null when the bullet says nothing beyond the place itself, so "no further detail" stays distinguishable from "detail that merely repeats the name". Consequence to know: **`notes` is no longer directly displayable**, and text search over it would match link targets — search needs its own normalization pass regardless, so that is deferred rather than solved here.

    | Tier | Shape                         | Example                                                           | `location_name`         | `location_type` |
    | ---- | ----------------------------- | ----------------------------------------------------------------- | ----------------------- | --------------- |
    | 1    | Leading link                  | `*[[Skyrim:Bloodskal Barrow\|Bloodskal Barrow]], on a dresser`    | link label              | `place`         |
    | 2    | Held/carried by (81)          | `* Carried by [[Skyrim:Assassin\|Assassins]]`                     | the NPC label           | `carrier`       |
    | 3    | Distance from a landmark (68) | `* 630 ft WSW of [[Skyrim:Ivarstead\|Ivarstead]] {{Map Link\|…}}` | the landmark label      | `nearby`        |
    | 4    | Link present, not leading     | `* On Anders' skeleton in [[Skyrim:Twilight Sepulcher\|…]]`       | first place-like link   | `place`         |
    | 5    | Plain text                    | `* Haknir's Shoal, on a pirate boss`                              | text before first comma | `place`         |

    Notes are everything after the location, links unwrapped to their labels — a link inside the notes must never be taken for the location. **Tier 2 matters most**: without it, 81 bullets store an NPC as if it were a place. Rows are deduped on `(location_name, notes)` before the RPC call, since no DB constraint guards this any more (§12.1) — but the same place with _different_ notes is valid and must survive, as 15 books legitimately have (`Alduin is Real` lists College of Winterhold twice, for the Arcanaeum and the Arch-Mage's Quarters).

    **Presence:** 146 pages carry an empty `|loc=` and 11 omit the key entirely — usable location text exists on **1,050** of the 1,207 books, and **157** have no locations at all. A missing key and an empty value are treated **identically**: the book still goes to the RPC with `locations: []`, which is what clears stale rows (FR-13).

    `location_type` therefore carries the extraction tier rather than staying null. This **supersedes spec Decision #6's "stays null"** — the tier is already computed to parse the bullet correctly, and recording it is what keeps a carrier distinguishable from a place. The column remains free text, un-normalized beyond these three values, and nothing in `prd-browse-and-track.md` reads it yet.

- **FR-12 — `book` upsert.** Batched (chunks of ~500) on conflict `uesp_page_id`, deduped by conflict key before each chunk — Postgres raises `ON CONFLICT DO UPDATE command cannot affect row a second time` if a key repeats within one statement.
- **FR-13 — `book_location` replacement.** Locations are replaced, not upserted, so a location removed upstream disappears. One `replace_book_locations(p_books jsonb)` RPC call **per book chunk**, not per book: PostgREST cannot span statements transactionally so the delete-and-insert must live in the database, and one call per book would mean **1,207 round trips** (every parsed book is sent, including the 157 with no locations) for **2,327 location rows** across 1,050 books — pure round-trip waste. Batching alongside the FR-12 book chunks makes it ~3 calls for the whole catalog. Each call is one transaction. Only books in the payload are touched, so books that failed to parse keep their existing locations; a parsed book with **zero** locations is still included with an empty array, which is what clears stale rows for a book whose `loc` field was removed upstream. The function returns its inserted row count for the run report. It is `security invoker` with a pinned empty `search_path`, and `EXECUTE` is **revoked from `public` and granted only to `service_role`** — otherwise it would be callable by `anon`, whose writes are blocked only by the absence of an INSERT/DELETE policy on `book_location` rather than by an explicit grant.
- **FR-14 — Target-database guard.** The target is `--url=<supabase-url>`, falling back to `NEXT_PUBLIC_SUPABASE_URL`. The script refuses to write to a non-localhost one unless `--allow-remote` is passed, and prints the target host and row counts before the first write. The secret key bypasses RLS: an accidental run against production writes 1,207 rows into live data with no undo. The guard resolves the target **before** the dump is opened, so a mistargeted run fails in under a second rather than after the ~33s pass. "Localhost" is matched on the parsed `URL.hostname` — never a substring of the raw URL, which would accept `https://localhost.evil.com` — and covers `localhost`, `*.localhost`, all of `127.0.0.0/8`, and `[::1]` (note `URL.hostname` **keeps** the brackets on an IPv6 literal).
- **FR-15 — `--dry-run`.** Parses, classifies and maps as normal, writes nothing, constructs no Supabase client and reads no credentials — so it runs before the secret key exists. Emits the FR-17 report.
- **FR-16 — Credentials.** Reads `SUPABASE_SECRET_KEY`, and the target URL from `--url` or `NEXT_PUBLIC_SUPABASE_URL`, via `--env-file-if-exists=.env.local`; never logged, never committed. **`SUPABASE_SECRET_KEY`, not `SUPABASE_SERVICE_ROLE_KEY`**: this project uses Supabase's newer key format throughout (CLAUDE.md — the publishable key, not the legacy anon key), and `supabase start` prints the pair as `Publishable` / `Secret` (`sb_publishable_…` / `sb_secret_…`). The key is new; the Postgres role it maps to is still `service_role`, which is what §12.1's `grant` names. **When it is not in the environment the script prompts for it on the terminal with echo disabled** — nothing is drawn, not even asterisks, whose count would leak the length — so the key for a one-off run against the hosted project need never reach shell history, `ps` output or a file. `--prompt-key` forces that prompt even when the environment has a key, which is what makes a single `.env.local` workable: it holds one key while `--url` can point at either database, and the wrong pairing surfaces only as an opaque 401. Raw mode means the terminal's own line editing is gone, so Ctrl-C, Ctrl-D, backspace and bracketed-paste markers (`ESC[200~`, which CMD-V wraps around pasted text and which would otherwise land inside the key) are all handled by hand. **Both the prompt and the credential check happen before the dump is streamed:** a prompt that appears 34s in is one nobody is waiting at, and a rejected key should cost a second rather than a full pass. The check calls `replace_book_locations([])` — a verified no-op whose `EXECUTE` is granted to `service_role` alone — so one round trip establishes that the key is valid, that it carries the needed privilege, and that the migration is applied there. Failures are translated into a sentence about what to change: a pasted publishable key is caught by prefix, and a mistyped key reaches us as PostgREST's `Expected 3 parts in JWT; got 1`, which named neither the key nor the fix. **`--env-file-if-exists`, not `--env-file`**: the latter hard-errors when the file is absent, and `.env.local` is gitignored, so a fresh clone could not run even `--dry-run` — which FR-15 requires to work before any credential exists. The client is constructed inside the run function, not at module scope, so importing the module for tests needs no env.
- **FR-17 — Run report.** Broken down **by category and source**, not just totals: pages found, new, updated, skipped (with reason), errored, duplicate keys collapsed, unmapped skills, unrecognized icons. It must also report the numbers that catch an FR-11 regression, which a category-only breakdown cannot: **location rows by tier** (`place` / `carrier` / `nearby` — expect 81 carriers, 67 nearby), **books with zero locations** (expect ~157), and **pages whose `value` is non-numeric** (expect 3), and **`skill_book` rows with a null `skill`** (expect exactly 1 — the Oghma Infinium; any other is a parse failure the constraint no longer catches). A tier-2 regression that silently turns carriers back into places leaves every category count unchanged. It also reports the two **cross-page dependency counts**, so drift is visible without being fatal: unobtainable books parsed (expect ~23, FR-6c) and lorenames resolved against ns 130 (expect ~116 of 116, FR-4a). Plus the dump date and a CC BY-SA 2.5 note. The streaming pass itself prints a self-overwriting page counter to stderr while it runs, TTY-only so redirected output and CI logs stay clean: the pass takes ~34s and previously emitted nothing until it finished, which reads as a hang — most sharply right after the FR-16 credential prompt, where the user is watching the screen expecting a response.
- **FR-18 — Provenance.** The dump date is parsed from the filename (`uespwiki-YYYY-MM-DD-current.xml.bz2`), with `--dump-date=YYYY-MM-DD` as an override for a renamed file. Recorded in the run report and in a README attribution section (owned by M3).
- **FR-19 — Cleanup.** `cleanTitle(pageTitle)` strips the `Skyrim:` prefix and a trailing ` (book)` disambiguator — **only that exact suffix**, since stripping arbitrary parenthetical qualifiers would collapse many `Note`/`Journal`/`Letter` pages into identical titles. `display_title` prefers `sumtitle` where present. The full page title is stored separately as `uesp_title` for linking, debugging and attribution. `cleanWikitext(value)` decodes entities (`&nbsp;`, `&amp;`) and strips residual markup from every stored string, including closing the gap a removed inline template leaves before punctuation (`[[Fort Dawnguard]] {{DG}}, to the right` → `Fort Dawnguard, to the right`). `cleanKeepingLinks(value)` is the same pipeline with links left in place, used for location notes (FR-11). It also **renders Creation Kit alias placeholders rather than eating them**: `<Alias=QuestGiver>` is a runtime substitution, not HTML, but `sax` decodes `&lt;` before we see it, so the HTML-tag strip removed them — leaving 8 broken titles including `Fijeh's Letter to`, `Letter from Steward of`, and one book called simply `To`. They now render as `(Quest Giver)`, splitting CamelCase and keeping the alias's own casing; the results reproduce UESP's own page titles (`To (Player)`, `Writ of Execution: (player)`). Numeric character references are decoded first, because one sumtitle writes its `=` as `&#61;` and would otherwise go unrecognised.
- **FR-20 — Unit-testable parsing.** `parseGameBookTemplate`, `parseArtifactSummary`, `parseLocations`, `classifyCategory`, `classifySource`, `normalizeSkill`, `cleanTitle`, `cleanWikitext`, `mapToBookRow`, `mapToLocationRows`, `attachBookIds` are pure (no I/O), each covered by tests in `scripts/lib/*.test.mts` run via `yarn test`. `scripts/` holds only runnable entry points; everything that exports rather than runs lives in `scripts/lib/`, mirroring `src/lib/`'s meaning — so no module needs to detect whether it was run or imported. Note `tsconfig.json` sets `strict: false`, so `| null` unions are not compiler-enforced — these handle absent values explicitly and are tested for it.

### Non-Functional (NFR)

- **NFR-1 — Memory.** The decompressed stream is never buffered whole — pages are emitted one at a time and the ~2GB expansion never exists in memory. Parsed _results_ are buffered, which is unavoidable: a book's lore page can appear later in the dump than the book that references it. Measured at ~2.3 MB (1.1 MB of book wikitext, ~1.2 MB of lore fields).
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
- Writes use the secret key, which maps to the `service_role` Postgres role and bypasses RLS — never the app's Server Action path.
- Identity is `uesp_page_id`; `game_id` is an attribute (§0, FR-5).
- The dump is bzip2; `bzip2` must be on `PATH`.
- No special Postgres version requirement. The `nulls not distinct` dependency (15+) disappeared when the `book_location` unique constraint was dropped (§12.1). Still worth confirming the local Supabase CLI's Postgres major matches the hosted project before M2, since the CLI's version comes from its own config.

### Assumptions

- A human downloads the dump periodically; the script never fetches it.
- `book.id` (uuid) stays internally generated. `uesp_page_id` is the natural upsert key.
- Pages missing fields still import, with nulls — 9 books lack `|id=` entirely and must not be dropped (the other 38 no-id pages were compilations, now filtered).
- Namespace 134 plus `{{Game Book}}` identifies the catalog. DLC books are in ns 134 (verified: `Skyrim:Deathbrand (book)` carries `{{Mod Header|Dragonborn}}`), so no separate DLC namespace handling is needed.

## 7. Risks and Mitigations

| ID  | Risk                                                           | Likelihood | Impact | Mitigation                                                                                                                                                          |
| --- | -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | An accidental run against the production database.             | Med        | High   | FR-14's localhost guard plus printed target confirmation. This is the highest-severity operational risk in the task.                                                |
| R2  | `icon` classification mis-sorts a book type.                   | Med        | Med    | Fixture cases per icon family; unrecognized icons fall to `book` and are logged with counts, so drift is visible in every run report (FR-17).                       |
| R3  | `parseLocations` regresses and mangles location sets.          | Med        | High   | Replacement happens only for successfully parsed books (FR-13). Fixture cases for: no-link location, link-inside-notes, two copies in one location, label ≠ target. |
| R4  | Creation Club misclassified as base game.                      | Med        | Low    | FR-9 uses the category link, not `smod` (which marks only 2 of 327). Cross-checked against `mod` count; mismatch logged.                                            |
| R5  | Skill values vary in phrasing across pages.                    | Med        | Low    | Exact match plus alias table (FR-10); unmapped values logged, cheap to fix since re-runs are idempotent.                                                            |
| R6  | The fixture misses an edge case present in the full dump.      | Med        | Low    | M1's dry run over all 1,207 books is a required gate before any write, and reports by class so a whole missing class is visible.                                    |
| R7  | A future change adds UESP network calls.                       | Low        | High   | No parsing dependency with a fetch API (§4); `supabase-js` is the only HTTP client.                                                                                 |
| R8  | A page deleted and recreated upstream imports as a new row.    | Low        | Low    | Accepted. `uesp_title` is stored, so the duplicate is detectable.                                                                                                   |
| R9  | A write chunk fails mid-run, leaving tables partially updated. | Low        | Med    | Chunks are separate statements, not one transaction. Failures are logged with their keys and surfaced in the report; recovery is re-running, which is idempotent.   |
| R10 | `is_unique` has no source in the template.                     | High       | Low    | Column left **nullable and unpopulated** — "unknown" must not be stored as `false` (OQ-2).                                                                          |

## 8. Milestones

> **Prerequisite, satisfied:** `data/uespwiki-2026-08-30-current.xml.bz2` is on disk.

- **M0 — Fixture + pure functions.** ✅ **Done.** Cut `scripts/lib/fixtures/sample-dump.xml` from real `<page>` elements, attributed as CC BY-SA in the fixture header. Deathbrand alone does **not** represent the data — its 11 bullets are all well-formed leading links, which is the easy case. Required cases:

    | Case                                       | Why                                                                                                                                                                                      | Example                              |
    | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
    | Multi-location, leading links              | FR-11 tier 1                                                                                                                                                                             | `Deathbrand` (11 bullets)            |
    | Same place twice, different notes          | FR-11 dedupe must not collapse these; 15 such books exist                                                                                                                                | `Alduin is Real`                     |
    | `Carried by [[NPC]]`                       | FR-11 tier 2 — the NPC-as-place bug                                                                                                                                                      | any of the 81                        |
    | Distance + `{{Map Link}}`                  | FR-11 tier 3 and template stripping                                                                                                                                                      | `630 ft WSW of [[Ivarstead]]`        |
    | Link not at bullet start                   | FR-11 tier 4                                                                                                                                                                             | `On Anders' skeleton in [[…]]`       |
    | Empty `\|loc=`                             | must yield `locations: []`, not "no key"                                                                                                                                                 | one of the 146                       |
    | No `\|loc=` key at all                     | same handling as empty                                                                                                                                                                   | one of the 49                        |
    | Magic-school skill book                    | icon-vs-`skill=` precedence (FR-7 tier 1)                                                                                                                                                | any `SpellTome*` icon                |
    | `note=1` + Journal icon, non-journal title | FR-7 note-before-journal ordering                                                                                                                                                        | `Thalmor Dossier: Ulfric Stormcloak` |
    | Treasure map                               | `note=1` with no icon at all                                                                                                                                                             | `Treasure Map III`                   |
    | `note=1` + Journal icon + "Journal" title  | FR-7 title tiebreak — must land as `journal`                                                                                                                                             | `Urzog's Journal`                    |
    | Note icon, no flag                         | the other half of the union                                                                                                                                                              | `Mysterious Note (Delphine)`         |
    | Dual `\|value=`                            | must store verbatim, not fail the insert                                                                                                                                                 | `Vernaccus and Bourlor`              |
    | Nested template in the body                | parser brace-awareness (16% of pages)                                                                                                                                                    | any `{{Map Link}}` page              |
    | `lorename=none`                            | sentinel → null                                                                                                                                                                          | any of the 734                       |
    | Creation Club `fexxx` id                   | identity collision case                                                                                                                                                                  | any CC book                          |
    | `\|id=` empty or absent                    | must import, not skip — 9 books: 8 supply `\|id=` empty, 1 omits the key                                                                                                                 | `Letter from the Empire`             |
    | `black_book`                               | Whole category (7) had no fixture                                                                                                                                                        | `Black Book: Waking Dreams (book)`   |
    | `Black Book` in title, empty icon          | Must land as `book`, NOT `black_book`                                                                                                                                                    | `Skyrim:Black Book (book)`           |
    | Oghma Infinium                             | `artifacttype` lives in a **separate `{{Artifact Summary}}` block**, not in `{{Game Book}}` — a Game-Book-only parse leaves it as `book`. Must classify `skill_book` with a null `skill` | `Oghma Infinium`                     |
    | `\|id2=` present                           | FR-5 `game_id_extra`                                                                                                                                                                     | one of the 6                         |
    | `smod=DB` / `DG` / `HF`                    | FR-9 resolution step 1                                                                                                                                                                   | one each                             |
    | CC category link                           | FR-9 resolution step 2                                                                                                                                                                   | any of the 329                       |
    | `mod=` with no `smod`                      | FR-9 resolution step 3 — the 4 pages that would otherwise file as `base`                                                                                                                 | `Skyrim:Discovering Ruunvald`        |
    | Plain base game                            | FR-9 fallthrough                                                                                                                                                                         | any of the 712                       |
    | Semicolon-heavy `loc`                      | FR-11 splitting stress                                                                                                                                                                   | `The Legend of Red Eagle`            |
    | `{{Game Book Compilation}}` page           | A DIFFERENT template — 38 series index pages a loose `{{Game Book` match wrongly counts as books                                                                                         | `The Song of Pelinal`                |
    | `**` sub-bullets in `loc`                  | One place holding several copies; flattening invents a location called "interior"                                                                                                        | `The Legend of Red Eagle`            |
    | Lore-page transclusion                     | `description`/`author`/`textnote` live on the lore page, invisible to a book-page parse (FR-4a)                                                                                          | `Skyrim:Thief (book)` + `Lore:Thief` |
    | Malformed page                             | AC-9                                                                                                                                                                                     | hand-damaged                         |
    | Non-`{{Game Book}}` ns-134 page            | filter                                                                                                                                                                                   | any                                  |
    | ns-116 Oblivion book                       | namespace filter                                                                                                                                                                         | any                                  |

    Implement and test all FR-20 functions. **Exit:** tests green, including a value-level diff of hand-transcribed expected params for each case above.

- **M1 — Streaming + dry run.** ✅ **Done.** Wire the bzip2/sax streamer to M0's functions. Single pass, 33s over the 470,673-page dump. Every exit figure below was hit exactly. **Exit:** a dry run over the full dump reports ~1,207 books with the expected distribution (91 skill, 359 book, 199 journal, 539 note, 12 treasure map, 7 black book) across the five sources (684 base, 326 creation_club, 136 dragonborn, 51 dawnguard, 10 hearthfire); location tiers in range (81 carrier, 67 nearby, 2,179 place); ~157 books with zero locations; the 3 non-numeric `value` pages present with their strings intact; the unmapped-skill list empty or entirely known; both cross-page dependencies non-empty (23 unobtainable, 116 of 116 lorenames resolved); and no unexpected crashes.
- **M2 — Migration + writes.** ✅ **Done.** Applied the §12.1 migration, then the upserts, the `replace_book_locations` RPC, the target guard and the report — developed against the local stack (`supabase start`), so the RLS-bypassing secret key never pointed at live data. **Exit:** met. Two consecutive runs of the same dump against a local Postgres 17.6 produced 1,207 books / 2,327 location rows both times, the second reporting `new 0, updated 1,207`, and the `(uesp_page_id, location_name, notes, location_type)` multiset was **byte-identical** across them (AC-4). The remote project is untouched; pushing the migration there is M3.
- **M3 — Full run + attribution.** ✅ **Done.** Both migrations pushed to the linked project with `supabase db push --linked`; remote schema verified column-for-column identical to local (Postgres 17.6 both sides). The real dump imported into the hosted database: 1,207 books, 2,327 locations, every M1 exit figure reproduced exactly. README gained the attribution section. **Exit:** §9 met. **Re-opened once after the fact**: FR-11's notes rule was corrected so a mid-sentence place survives in the note (86 rows were visibly damaged), and both databases were re-imported — the catalog counts are unchanged at 1,207 / 2,327, and all four damage classes measure zero. AC-4 was re-verified against production, not just locally — the `(uesp_page_id, location_name, notes, location_type)` multiset hashes to `fc5bc508cce355130389aa745667fd9c` both before and after a second full run. AC-7 was checked with `data/` renamed away, giving 111 passed and 1 explicitly skipped rather than a silent pass.

## 9. Acceptance Criteria

- AC-1. A run against the dump imports ~1,207 books, with the distribution in M1's exit gate. (FR-3, FR-7)
- AC-2. Every book has a category and a source from the fixed sets. Every `skill_book` has a non-null normalized `skill` **except exactly one** — the Oghma Infinium, which raises six skills and is identified by `artifact_type` (FR-7). A second null-skill `skill_book` is a parse failure and is rejected by the partial unique index in §12.1. (FR-7, FR-9, FR-10)
- AC-3. Books with locations have one `book_location` row per location, with notes populated where the source provides them. Notes hold the whole bullet with links intact, so `unwrapLinks(notes)` reproduces the source sentence: no orphaned possessives, no space before punctuation, no dangling article where a place used to be. Measured on the real dump: zero occurrences of each across the 1,957 rows that carry notes. (FR-11, FR-19)
- AC-4. Re-running the same dump leaves `book_location` **identical, not merely non-larger** — equal row count and an equal multiset of `(uesp_page_id, location_name, notes)`. Non-growth alone would pass while a parser regression silently deleted half the locations, which is the failure mode replacement introduces. (NFR-4)
- AC-4a. A book whose `loc` was cleared upstream ends with zero `book_location` rows after a re-run. (FR-11, FR-13)
- AC-4b. A book listing the same place twice with different notes imports both rows. (FR-11)
- AC-5. The script makes no requests to UESP during execution. (NFR-2)
- AC-6. The dump date and CC BY-SA 2.5 licence appear in the run report and the README. (FR-18)
- AC-7. `yarn test` passes with no network, no database, and no 177MB file. (FR-20)
- AC-8. `--dry-run` runs to completion with no `SUPABASE_SECRET_KEY` set. (FR-15)
- AC-9. A malformed page is logged and the run completes. (NFR-3)
- AC-10. Pointing the script at a remote Supabase URL without `--allow-remote` refuses to write, and every run prints the target host before the first write. (FR-14)
- AC-11. The 3 dual-value pages import with their `value` string intact, not truncated or nulled. (FR-6)

## 10. Success Metrics

- **Coverage:** ≥ 98% of the 1,207 ns-134 `{{Game Book}}` pages produce a row. The denominator is the page count, not "pages that parsed" — a filter measured against itself proves nothing.
- **Class distribution** matches M1's dry run within a few pages; a whole class collapsing to zero is a parser regression.
- **Skill completeness:** every `skill_book` row has a non-null skill except the single `artifact_type` row (AC-2). An unmapped value is a lookup-table gap to fix and re-run, not an acceptable resting state.
- **Identity integrity:** `count(*) == count(distinct uesp_page_id)`, and no book loses locations across consecutive runs of the same dump.
- **Test coverage:** every FR-20 function has at least one fixture-backed case.

## 11. Open Questions

- **OQ-2:** `is_unique` has no `{{Game Book}}` parameter. Leave permanently null, drop the column, or derive it another way? Left nullable for now (R10).
- **OQ-3:** Model book **series** relationally (`up`/`next`/`prev`, ~165 pages each) or store the raw title strings? Currently stored as text; no feature reads them yet.
- **OQ-4:** UESP's own "820 readable items" breakdown (307 lore books, 192 letters/notes, 97 journals, 93 spell tomes, 91 skill books, 28 recipes, 7 Black Books, 5 quest books) does not reconcile with what `{{Game Book}}` yields: skill books agree (90 + Oghma Infinium = 91) and Black Books agree exactly (7), but notes measure 295 against 192, `book` 444 against 307, and journals 110 against 97. Spell tomes and recipes are **not** `{{Game Book}}` pages at all — they are consumable item pages under a different template, so tracking them would need a second source and is currently out of scope (NG7). Worth reconciling before the progress-bar denominator is finalized in `prd-browse-and-track.md`.

---

## 12. Technical Design

### 12.1 Migration

`supabase/migrations/20260914000000_book_import_schema.sql` — the block below is that file **verbatim**, so the two stay diffable; change both together or not at all.

> **One comment inside has since gone stale, and is deliberately left as written.** The `is_obtainable` comment says "Exactly one book is false today". That was accurate when the migration was authored, before FR-6c added parsing UESP's own `Skyrim:Unobtainable Items` list. The real figure is **24** — 23 from that page plus the one local supplement (`Skyrim:Shalidor's Insights (unused pages)`). The migration is applied to both the local stack and the linked project, so per CLAUDE.md it is a record of what ran rather than a draft; correcting it here keeps that record intact and the two copies diffable.

```sql
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
```

### 12.2 Script Structure

`scripts/` holds only runnable entry points; everything that exports rather than runs lives in `scripts/lib/`, mirroring `src/lib/` (FR-20) — so no module needs to detect whether it was run or imported.

| File                          | Holds                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `scripts/import-uesp.mts`     | the entry point: collect → resolve → report → write                                                 |
| `scripts/lib/uesp-parse.mts`  | the pure wikitext functions below, incl. `cleanKeepingLinks` / `unwrapLinks`                        |
| `scripts/lib/stream-dump.mts` | compression sniffing and the sax page loop                                                          |
| `scripts/lib/db.mts`          | `resolveTarget`, `dedupeByKey`, `chunk`, `groupLocations`, `resolveSecretKey`, `createImportClient` |
| `scripts/lib/cli-args.mts`    | `parseArgs`, so tests never import the entry point                                                  |
| `scripts/lib/fixtures/`       | the sample dump (31 UESP pages + 1 hand-damaged) and its loader                                     |

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
    params: RawParams; // {{Game Book}} params ONLY
    artifactType: string | null; // {{Artifact Summary}}'s |artifacttype -- a DIFFERENT template
    categoryLinks: string[]; // explicitly-written [[Category:...]] links
};

// Brace- and link-aware: '|' inside [[a|b]] or {{x|y}} is not a separator.
function parseGameBookTemplate(wikitext: string): RawParams | null;

// Takes the whole page, not params: the journal tiebreak needs uespTitle, and the
// skill_book artifact branch needs artifactType, which is not a Game Book param.
function classifyCategory(page: ParsedPage): Category;
function parseArtifactSummary(wikitext: string): string | null;
function classifySource(params: RawParams, categoryLinks: string[]): Source;
function normalizeSkill(raw: string | null): Skill | null;

// '*[[Skyrim:X|X]], on a shelf' -> [{ name: 'X', notes: 'on a shelf', locationType: 'place' }]
type LocationTier = 'place' | 'carrier' | 'nearby';
function parseLocations(
    rawLoc: string,
): { name: string; notes: string | null; locationType: LocationTier }[];

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
    value: string | null; // verbatim; 3 pages carry dual values
    weight: number | null;
    icon: string | null;
    lorename: string | null;
    errata: string | null;
    gameplay_note: string | null;
    series_up: string | null;
    series_prev: string | null;
    series_next: string | null;
    is_quest_related: boolean;
    artifact_type: string | null;
    is_obtainable: boolean;
    is_unique: boolean | null;
};

type LocationTier = 'place' | 'carrier' | 'nearby';
type MappedLocation = {
    uespPageId: number;
    location_name: string;
    location_type: LocationTier; // always set -- parseLocations assigns a tier
    notes: string | null;
};
type LocationRow = Omit<MappedLocation, 'uespPageId'>;

function mapToBookRow(page: ParsedPage): BookRow;
function mapToLocationRows(page: ParsedPage): MappedLocation[];
// Shapes the RPC payload for a whole chunk: one entry per parsed book,
// including books with an empty locations array (clears stale rows).
type LocationBatchEntry = { book_id: string; locations: LocationRow[] };

// Takes EVERY successfully parsed book in the chunk, not just flattened location
// rows -- a book with zero locations has no MappedLocation entries, so it could
// never be represented from that input, and omitting it would leave stale rows.
function attachBookIds(
    parsed: { uespPageId: number; locations: LocationRow[] }[],
    idsByPageId: Map<number, string>,
): LocationBatchEntry[];
```

The decisions inside the I/O glue are pure and unit-tested in `scripts/lib/db.mts` — the target guard (FR-14), conflict-key dedupe (FR-12), chunking, and the per-book location grouping that keeps zero-location books in the payload (FR-13). Only the round trips themselves are left to `--dry-run` and a real run:

- Detect compression by magic bytes; spawn `bzip2 -dc` or `zlib.createGunzip()`; pipe into `sax.createStream()`.
- Per `<page>`: filter (FR-3) → parse → classify → map.
- Pre-fetch existing `uesp_page_id`s into a Set so the report can distinguish new from updated — a PostgREST upsert does not reveal which rows it inserted.
- Dedupe by conflict key, batch-upsert `book` (chunks of ~500, `onConflict: 'uesp_page_id'`) with `.select('id, uesp_page_id')` so each chunk returns its uuids; build the id map, then make **one** `replace_book_locations` call for that whole chunk — including parsed books that have no locations, so their stale rows are cleared.
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
        "test": "tsx --test \"scripts/**/*.test.mts\"",
        "import:uesp": "node --env-file-if-exists=.env.local --import tsx scripts/import-uesp.mts"
    }
}
```

Script and test files are `.mts`, not `.ts`: `package.json` has no `"type"` field, so a `.ts` under `scripts/` resolves as CommonJS while `tsconfig.json` is set to `module: esnext` / `moduleResolution: bundler`. `.mts` is unambiguously ESM without making the whole repo ESM. `tsconfig.json`'s `include` already covers `**/*.mts`.

### 12.4 Running it

```bash
# Report only -- no credentials, no database (FR-15).
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --dry-run

# Write to the local stack. `supabase start` applies the migrations and prints
# the Secret key; `supabase db reset` returns to an empty schema. With no
# SUPABASE_SECRET_KEY in the environment this prompts for it, echo disabled.
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --url=http://127.0.0.1:54321

# Write to the hosted project. --prompt-key forces the hidden prompt even when
# .env.local holds a key, so the production key never lands in shell history or
# on disk -- and is not silently sent to the wrong database.
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 \
  --url=https://<project-ref>.supabase.co --allow-remote --prompt-key
```

which expands to `node --env-file-if-exists=.env.local --import tsx scripts/import-uesp.mts …`.

`.env.local` gains `SUPABASE_SECRET_KEY=` (never committed). Without `--url` the target falls back to `NEXT_PUBLIC_SUPABASE_URL`, which points at the hosted project — so a bare `yarn import:uesp <dump>` is refused by FR-14 rather than writing to it. The dump date is read from the filename; `--dump-date=YYYY-MM-DD` overrides.

A run over the real dump takes ~33s and reads 470,673 pages in a single streaming pass; the writes add ~3 upsert round trips and ~3 RPC calls on top.

### 12.5 Existing checks

`tsconfig.json`'s `include` is `**/*.ts` / `**/*.mts`, so `scripts/**` is covered by the project's existing checks from the first file. Per CLAUDE.md it must pass `eslint`, `tsc --noEmit -p tsconfig.json`, and `prettier --check`. That check list gains `yarn test` as part of this task.

### 12.6 `.gitignore`

`/data/` is already ignored — the dump lives there and is never committed.

---

## 13. Handoff to `prd-browse-and-track.md`

That PRD **has been patched** against this import: its skill and category normalization questions are closed into FR-3, MI2 and the old R1 deleted, FR-3 gained a required `source` filter with the real enum values, FR-5's total is tied to the default scope, and §12.1's reference DDL matches the schema this task builds. What follows is only what remains.

### Still open there

1. ~~The default catalog scope.~~ **Closed** — `prd-browse-and-track.md` FR-3 fixes it as two allowlists: category `skill_book`/`book`/`black_book`, source everything but `creation_club`, plus `is_obtainable`. **423 books.** Journals, notes, treasure maps and Creation Club are opt-in.

2. **The null-skill skill book.** Oghma Infinium is `skill_book` with `skill = null`, so it appears under no skill chip. Browse must decide whether it shows only under `category=skill_book`, gets an "artifact" affordance, or is otherwise surfaced — otherwise M2's skill filter silently loses the game's most notable book.

3. **The five font-test books.** `is_obtainable = false` on 24 books, and five of them are character-set samples Bethesda shipped as real game assets — `Skyrim:123 Abc Def Ghijklmnop Qrstu VWXYZ 123456789`, `Skyrim:Ä ö ü ß Ä Ö Ü`, and three more of accented vowels. They are faithfully imported and correctly excluded from the default scope (FR-3), so nothing is wrong. But they are the first odd thing anyone will see if browse builds a "show unobtainable too" toggle, and they are titles no player would recognise as books. Worth a deliberate decision there rather than a surprise.

4. **`book_location.notes` contains wikitext links** (`[[Skyrim:Frostmere Crypt|Frostmere Crypt]]`) and is not directly displayable. Render with `unwrapLinks` from `scripts/lib/uesp-parse.mts` for plain text, or build anchors to `https://en.uesp.net/wiki/<target>` — note the targets use three interchangeable prefixes (`Skyrim:` 2,983, `SR:` 189, `sr:` 167) which are UESP namespace aliases; **that they all resolve is inferred, not verified**, since UESP's robots.txt disallows our crawlers. Not every link is a place: some point at skills, quests and NPCs.

5. **Optional:** whether the list MVP shows any location teaser at all. Deferring is fine; it should just be explicit, given this import produces ~2,500 location rows with placement notes that nothing yet renders.

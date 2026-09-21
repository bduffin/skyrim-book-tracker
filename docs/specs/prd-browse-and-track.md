# PRD: Browse Books & Track Collection

> Stage: PRD — derived from `docs/specs/spec-browse-and-track.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved verbatim from spec)

> Players who want to collect every book in Skyrim have no lightweight, web-based way to see what they've found versus what remains. Spreadsheets are clunky; UESP has the data but no per-user tracking; mods are installation-heavy and don't persist across new playthroughs or platforms.

---

## 0. Contradictions & Missing Info (resolve before/during build)

| #   | Type      | Issue                                                            | Resolution in this PRD                                                                                                                                    |
| --- | --------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MI1 | Missing   | No canonical total book count (the "/820" denominator).          | Compute dynamically from `book`, never hardcoded, and over the default scope rather than the whole catalogue — see FR-3's default allowlists (423 books). |
| MI3 | Missing   | Spec has no title **search**; arch §8 references search inputs.  | In scope as a title substring filter — see FR-9. Ranked/full-text search stays out (NG5).                                                                 |
| MI4 | Missing   | No sort order specified.                                         | Default sort: title A→Z. OQ-4.                                                                                                                            |
| MI5 | Ambiguous | Success criterion 5: unauthenticated controls "disabled/hidden." | **Decision:** render controls **disabled** with a sign-in affordance (discoverability > hiding). OQ-5.                                                    |
| MI6 | Missing   | No defined behavior when a toggle Server Action fails.           | Optimistic state **rolls back** + non-blocking error toast. FR-4.                                                                                         |

---

## 1. Problem Statement

Skyrim completionists have no lightweight, persistent, web-based way to track which in-game books they have collected versus which remain. Today they cross items off a spreadsheet or rely on memory. Existing options each fail a key need: spreadsheets are clunky and have no structured metadata or filtering; UESP has authoritative structured data but no per-user tracking; mods are installation-heavy and don't persist across new characters or platforms. The result is lost progress on new playthroughs and no single answer to "what do I still need, filtered by what I care about right now?"

## 2. Goals and Non-Goals

### Goals

- G1. Let any visitor browse the Skyrim book catalog with its list-level metadata (title, category, source, skill). Location data exists and is rich — ~2,500 rows with placement notes — but rendering it is the deferred detail page (NG1), not this PRD.
- G2. Let an authenticated user mark a book as collected and have it persist across sessions and characters.
- G3. Let a user filter the catalog by category, source, skill, and collection status, with shareable URLs.
- G4. Show overall collection progress at a glance.
- G5. Enforce a strict server-first architecture: zero direct DB calls from Client Components; all `user_book` writes through a Server Action under RLS.

### Non-Goals (this PRD)

- NG1. Book **detail page** with full location list (nice-to-have; deferred).
- NG2. **Per-character / multi-character** tracking.
- NG3. Saved filter presets / named collections.
- NG4. _(Removed — `read` is now in scope; see FR-4 and the `is_read`/`is_collected` flags.)_
- NG5. **Full-text or ranked search** — `tsvector`, relevance ordering, fuzzy/trigram matching. Title search itself is in scope as a plain substring match (FR-9, MI3); nothing beyond that is planned. NG6 means there is no book text to index in any case.
- NG6. Storing or rendering full book text — a **scope** decision, not a licensing one. CC BY-SA 2.5 permits redistribution with attribution; see `prd-import-uesp-books.md` NG2.
- NG7. Auth/sign-up/sign-in flows (separate spec; assumed to exist).
- NG8. UESP data import/seeding (separate task; assumed done).
- NG9. AI features, real-time/collaboration, per-category progress charts beyond a single summary bar.
- NG10. **User profiles and first-time-login setup** — choosing a username, uploading a profile picture, the public/private toggle FR-10 depends on (defaulting to public), and the rest of account setup. A likely feature in its own right, and the thing two other items wait on: FR-8's `/collection/[user]` segment carries a user id until a username exists, and FR-10's public viewing cannot ship before the toggle that turns it off.

## 3. Current State Analysis

- **Greenfield.** No tracking exists in the app today.
- **Data source.** UESP (CC BY-SA) provides structured book data: titles, categories, skill effects, locations. Attribution required in UI and README.
- **Assumed-present dependencies:** (a) Supabase Auth with working sign-in; (b) `book` and `book_location` tables seeded from UESP; (c) Next.js App Router + Tailwind scaffolding per architecture — Tailwind is installed; shadcn/ui is not yet installed but will be added soon.
- **Data model (as built by the import task):** `book` (id, `uesp_page_id` identity, `uesp_title`, title, `category` — one of `skill_book`/`book`/`journal`/`note`/`black_book`/`treasure_map`, `source` — one of `base`/`dawnguard`/`dragonborn`/`hearthfire`/`creation_club`, nullable normalized `skill`, description, author, value, weight, icon, `is_quest_related`, `artifact_type`, `is_obtainable`, nullable `is_unique`), `book_location` (book_id, location_name, location_type, notes), `user_book`, `user_book_note`. Catalog size is **1,207** books: 881 base+DLC and 326 Creation Club; by category 539 notes, 359 books, 199 journals, 91 skill books, 12 treasure maps, 7 black books. One skill book (Oghma Infinium) has a null `skill` — it raises six at once — so grouping skill books _by_ skill must handle it.
- **Pain points (from spec):** no unified have-vs-left view; no filtering by category/skill/status; progress lost on new characters.
- **Architectural constraints already decided:** Server Components default; client interactivity opt-in; RLS on `user_*`; reference tables publicly readable but not user-writable.

## 4. Proposed Solution

Two **server-rendered** routes over one shared data layer and row component (FR-8), built server-first — `/books` is the catalogue you browse, filter and mark from, `/collection/[user]` is a user's own tracking view, and `/` redirects to one or the other depending on whether the visitor is signed in:

1. **Server Component (page)** reads filter/pagination state from URL query params, fetches the matching paginated `book` rows joined to the current user's `user_book` rows (left join → absent row = untouched, `is_read`/`is_collected` both `false`), and computes the progress totals. Unauthenticated requests skip the user join.
2. **Client Components (opt-in)** handle only interactivity: the filter controls and the per-row read/collected controls. Filter changes push new query params → Next.js soft navigation re-renders the Server Component (no full reload).
3. **Read/Collected controls** use `useOptimistic` for instant UI feedback and call a **Server Action** that validates the Supabase session server-side and upserts the changed flag(s), or deletes the `user_book` row once both flags are `false`, under RLS. On failure, the optimistic state rolls back and a toast surfaces the error.
4. **Progress bar** (on `/collection/[user]` only — FR-8) is a Server Component value reflecting true DB counts (collected, and read — counted independently, not combined); it re-derives on each server render (after any change's `revalidate`).
5. **Unauthenticated** users get the full `/books` list with the read/collected toggles rendered **disabled** plus a sign-in prompt; they are redirected off `/collection/[user]`, so no progress bar is rendered for them at all.

```
URL (?category=&source=&skill=&read=&collected=&page=)
        │  soft-nav
        ▼
[Server Component: /books | /collection/[user] page]
  ├─ getBooksPage(filters, page, userId?)  ──► Supabase (book ⟕ user_book)
  ├─ getProgress(userId?)                   ──► Supabase counts
  └─ renders:
       ├─ <ProgressBar/>            (server; /collection/[user] only)
       ├─ <Filters/>  "use client" (writes URL params; /books only)
       └─ <BookRow/>* with <ReadToggle/>/<CollectedToggle/> "use client"
                                   └─ Server Action: setBookFlags(bookId, { isRead?, isCollected? })
                                        ├─ assert auth.uid()
                                        └─ upsert changed flag(s) | delete once both flags false  user_book (RLS)
```

**Key design tradeoffs (explicit):**

- **`useOptimistic` + Server Action (chosen)** vs a client-side query/cache library. Chosen for fewer moving parts and native App Router fit. Tradeoff: cross-row cache coordination (e.g., progress bar consistency) leans on `revalidatePath`/server re-render rather than a client cache. If live refetch-on-filter or richer cache invalidation becomes painful, revisit this tradeoff for the list specifically.
- **Filter state in URL (per Decision #1)** vs client/server state. Chosen for shareability and back-button correctness. Tradeoff: every filter change is a server round-trip; mitigated by Next.js soft navigation + the `<1s` render budget.
- **Sparse rows (upsert/delete)** vs a row per (user, book). Per Decision #4, untouched = absent row, so setting either flag `true` = upsert and clearing both flags = delete. Tradeoff: storage stays proportional to actual progress (most users touch a fraction of the 1,207-book catalog) at the cost of a `LEFT JOIN ... COALESCE(is_read, false), COALESCE(is_collected, false)` on every read. The alternative (pre-seed a row per book per user) makes reads trivial but explodes write volume on signup and storage — rejected for a side-project scale.
- **Two independent flags (`is_read` / `is_collected`)** vs the original `collected` implies `read` monotonic enum — **revised from the initial design**. Reading and collecting are separate in-game actions (you can grab a book to read later, or read one you don't keep), so treating them as one ladder was wrong by domain, not just a simplification. Tradeoff: progress/filters now track two dimensions instead of one (no more single "read-or-better" figure), and each row needs two toggles instead of one segmented control — more UI surface, but each toggle's meaning is unambiguous.

## 5. Requirements

### Functional (FR)

- **FR-1 — Book list (Server Component).** Render a paginated list (50/page, Decision #3) of books. Each row shows: title, category, source, skill (if any), and the current user's `is_read`/`is_collected` flags (independent; absent row = both `false`). Renders fully server-side (no client data waterfall).
- **FR-2 — Public browse.** Unauthenticated users can view the full list and all metadata. Both flags render `false` for all rows; the read/collected controls render **disabled** with a sign-in affordance (MI5).
- **FR-3 — Filters (Client Component, URL-backed).** Controls for: **category**, **source**, skill, read status, and collected status — each filterable independently (e.g. `all | true | false` per flag), not a single combined status. Category values are the six the import enforces: `skill_book`, `book`, `journal`, `note`, `black_book`, `treasure_map`. Source values are `base`, `dawnguard`, `dragonborn`, `hearthfire`, `creation_club`. Both come from DB check constraints, so filter options are a fixed list, not derived from distinct values. Skill options are Skyrim's 18 canonical skills, likewise constrained. State persists in URL query params (e.g. `?category=skill_book&source=base&read=false&collected=true&page=1`) and is shareable/bookmarkable. Changing a filter resets to page 1 and updates the list via soft navigation (no full reload). **A `source` filter is required rather than optional**: Creation Club is 326 of 1,207 books and is mostly notes and journals, so without it the default list is dominated by paid add-on content.

    **Defaults.** Both are **allowlists**, so anything added later — a future DLC, a seventh category — defaults _off_ rather than silently widening every player's completion denominator:

    | Control    | Default                                         | Off by default                                     |
    | ---------- | ----------------------------------------------- | -------------------------------------------------- |
    | `category` | `skill_book`, `book`, `black_book`              | `journal` (199), `note` (539), `treasure_map` (12) |
    | `source`   | `base`, `dawnguard`, `dragonborn`, `hearthfire` | `creation_club` (326)                              |

    Together these give the **423**-book default catalogue. `is_obtainable` is **not a user control** — it is always `true` in the query and has no chip, because a book no player can acquire is never something to browse or track. Note `hearthfire` contributes only 10 items (9 notes, 1 book), so enabling it changes the default list by exactly one book; the source chips are not equally weighted.

- **FR-4 — Read/Collected controls (Client Component + Server Action).** Authenticated user toggles a book's `is_read` and `is_collected` flags independently — toggling one never changes or implies the other. UI updates optimistically per flag; a Server Action validates the Supabase session and writes `user_book` under RLS — **upsert** the changed flag(s), **delete** the row once both flags are `false`. On success, server state is revalidated so the progress bar stays truthful. On failure, the optimistic change rolls back and a non-blocking error toast appears (MI6). The write path never trusts a client-supplied `user_id`.
- **FR-5 — Progress summary.** A progress bar shows `<collected> collected · <read> read / <total>` (total computed dynamically, MI1; `collected` and `read` are independent counts, not combined). `<total>` is the count within the **default scope** (FR-3), not `count(book)` — the unscoped figure is 1,207 including 539 notes and 326 Creation Club books, which is a materially different product from the 423-book "real books" catalogue FR-3 defaults to. It reflects true DB state after any change. Unauthenticated visitors never see it — they are redirected off `/collection/[user]` (FR-8).
- **FR-6 — Pagination.** 50 books/page; page in URL. Stable ordering (default title A→Z, MI4) so pagination is deterministic.
- **FR-7 — Attribution.** UESP CC BY-SA attribution visible in the UI (and README per arch §2).
- **FR-8 — Routes and information architecture.** Two routes over the same data layer and row component:

    - **`/books`** — the catalogue, and the only route that lists the whole scoped catalogue: the list (FR-1), filters (FR-3), pagination (FR-6), and the per-row read/collected toggles (FR-4). Fully readable signed out (FR-2). It carries **no** progress summary: progress is a property of a user, not of the catalogue.
    - **`/collection/[user]`** — a user's own tracking view: the progress summary (FR-5), the books they have marked, and a **quick-add** control for marking a book without paging through the catalogue. Quick-add is a search (FR-9) over the catalogue, not a second full listing.
        - The segment holds the **user id** until user-chosen usernames exist (NG10); a readable username is what it is ultimately for. Swapping id for username changes every shared URL, which costs nothing today because there are no users, and will not be free later — so it is worth doing before launch rather than after.
    - **`/`** — redirects to the signed-in user's own `/collection/[user]`, or to `/books` when anonymous. It replaces the scaffold's leftover `instruments` page, which is deleted.
    - A signed-out visitor hitting **`/collection/[user]`** directly is redirected to `/books` — as is a signed-in user asking for somebody else's, until FR-10's setting exists to permit it. If a dedicated sign-in route is added later — likely once there is more than one auth provider — that becomes the better target for the signed-out case.

    The two routes land in different milestones — `/books` at M1, `/collection/[user]` at M3 — so until M3 `/` redirects to `/books` unconditionally rather than pointing at a route that does not exist yet.

- **FR-9 — Title search.** A `?q=` query param narrows the list to books whose `title` contains the term, case-insensitively — a plain `ilike '%term%'` substring match, **not** ranked or full-text (NG5). It is another filter, not a mode: it combines with the active category/source/skill/status filters and the default scope rather than replacing them, and it resets to page 1 like any other filter change (FR-3). It needs **no migration and no index** — at ~1,200 rows a sequential scan beats an index lookup, the same reasoning `20260914000000_book_import_schema.sql` records for `is_obtainable`. Two things the implementation must get right: the term's LIKE metacharacters (`%`, `_`) are escaped, so a user typing `%` matches a literal percent sign instead of every book; and an absent or empty `q` applies no predicate at all (R4). This is also what backs the quick-add on `/collection/[user]` (FR-8).
- **FR-10 — Collection visibility and privacy.** Whether a collection page is visible to anyone but its owner is an **account-level setting**, stored on the profile (NG10) and defaulting to **public**.

    - **Public** — `/collection/[user]` is readable by anyone, including signed-out visitors. The RLS policy must therefore admit the `anon` role, not only `authenticated`.
    - **Private** — every other visitor gets a **404, not a 403**. A 403 confirms the account exists, which leaks membership; a 404 refuses to distinguish "private" from "never existed". That only holds if the two are genuinely indistinguishable: a private account and a nonexistent one must return the same status, the same body, and take comparably long. A friendlier "this collection is private" page silently undoes the whole point.
    - **Notes are never public**, whatever the account setting. `user_book_note` holds free text the user wrote, which is categorically more sensitive than a read/collected flag, and nothing about "my account is public" implies "publish my notes". Sharing a note is a deliberate feature if it is ever wanted, never a side effect of this toggle.
    - **Public does not mean indexed.** Collection pages carry `noindex` (route metadata `robots: { index: false, follow: false }`), applied uniformly rather than per-user. Being viewable and being a search result are two different consents, and only one of them is reversible: making an account private is instant, while removing a page from a search index is slow and not wholly in this project's control. `/books` has no privacy dimension and stays indexable.
    - **Do not also `Disallow` the collection path in `robots.txt`.** `Disallow` blocks crawling, not indexing — a linked-to URL can still be indexed without a snippet — and a path that is never fetched is a path whose `noindex` is never read. The two directives cancel out; `noindex` alone is what works. `robots.txt` is a request to well-behaved crawlers in any case, never an access control, and sits alongside the RLS policy and the 404 rather than in place of them.

    **Sequencing constraint:** public viewing must not ship before the setting that turns it off. Defaulting to public is defensible because the choice is explicit at first login — but until that toggle exists, a public default is a default with no opt-out. Until then FR-8's behavior stands and every non-owner is bounced, which is the safe state.

### Non-Functional (NFR)

- **NFR-1 — Performance.** List page first render `< 1s` for an authenticated user (server render, no client waterfall) under expected catalog size.
- **NFR-2 — Toggle latency.** Optimistic update is visually instant; Server Action confirmation within 500ms p50 under normal conditions.
- **NFR-3 — Security / RLS.** RLS on `user_book`: a user can only read/write rows where `auth.uid() = user_id`. `book`/`book_location` publicly readable, not user-writable. **Zero** direct DB calls from any Client Component.
- **NFR-4 — Architecture conformance.** Server Components default; `"use client"` only for filters and toggle. Server-only DB logic lives in `src/features/*/data.ts`.
- **NFR-5 — Data scope.** Store structured metadata only; no full book text.
- **NFR-6 — Resilience.** A failed or slow toggle never corrupts displayed progress; UI converges to server truth on next render.
- **NFR-7 — Accessibility.** Filter controls and toggles are keyboard-operable and screen-reader labeled (shadcn/ui primitives); disabled state communicates "sign in to track."
- **NFR-8 — Output encoding for UESP-sourced free text.** `description`, `errata`, `gameplay_note`, and any other free-text `book` column sourced from UESP wikitext, are external content, not app-authored — they must never be rendered via `dangerouslySetInnerHTML` or any other raw-HTML injection path, in this feature or any other that ever displays them (including the deferred NG1 detail page). Render through normal JSX interpolation (`{book.description}`), which auto-escapes. `prd-import-uesp-books.md`'s `cleanWikitext` (§12.2) already strips markup at import time, but that's a best-effort pass over wikitext, not a hardened sanitizer — this NFR is the independent second layer that actually prevents any residual markup from executing.

## 6. Constraints and Assumptions

### Constraints (from spec + architecture)

- Server Components are the default; client interactivity is opt-in via `"use client"`.
- All `user_book` writes go through a Server Action — never a direct client DB call.
- RLS restricts `user_book` reads/writes to the owning user.
- Metadata only — no full book text stored.
- Stack fixed: Supabase (DB + Auth), Next.js App Router, Tailwind + shadcn/ui, TypeScript/Yarn.
- Filter state in URL query params (Decision #1). Two independent boolean flags `is_read`/`is_collected`, neither implies the other (Decision #2, revised). 50/page (Decision #3). Missing `user_book` row = untouched (both flags `false`), no pre-population; clearing both flags deletes the row (Decision #4).

### Assumptions (from spec)

- A1. UESP data is pre-seeded into `book` and `book_location` by `prd-import-uesp-books.md`, with normalized `skill`, `category` and `source` all enforced by DB check constraints. Satisfied — the data is ready and FR-3 fixes the default scope over it.
- A2. Auth (sign-up/sign-in) exists via a separate spec.
- A3. A book with no `user_book` row is untouched (neither read nor collected); no pre-population.
- A4. Performance targets (`<1s`, 500ms) are reasonable given a single-app Vercel + Supabase deployment and a catalog on the order of hundreds–low thousands of books.

## 7. Risks and Mitigations

| ID  | Risk                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Default scope makes "completion" feel unachievable or trivial.          | Med        | Med    | Defaults fixed in FR-3 as allowlists giving 423 books; notes (539), journals (199), treasure maps (12) and Creation Club (326) are opt-in. Revisit if players report the target feels wrong. |
| R2  | Progress bar drifts from DB after optimistic toggles (consistency).     | Med        | Med    | Server Action calls `revalidatePath` so the next server render recomputes counts; treat client optimistic value as transient only.                                                           |
| R3  | `<1s` render breached at scale (large catalog + joins per page).        | Med        | Med    | Paginate (50), index `book(title)`, `user_book(user_id, book_id)`; left-join only the 50 visible books, not the whole catalog; count via a cheap aggregate.                                  |
| R4  | URL param tampering / invalid filter values.                            | Med        | Low    | Validate & whitelist params server-side (zod); fall back to defaults on bad input.                                                                                                           |
| R5  | RLS misconfig leaks/allows cross-user writes.                           | Low        | High   | Explicit RLS policies + tests asserting a user cannot read/write another's `user_book`; Server Action derives `user_id` from session, never from input.                                      |
| R6  | Soft navigation on every filter change feels janky.                     | Med        | Low    | Pending UI (useTransition) on filters; debounce; keep payloads small.                                                                                                                        |
| R7  | Two independent toggles per row clutter mobile UI / unclear affordance. | Med        | Low    | Use two compact icon toggles (e.g. book icon for read, chest/star icon for collected) with clear labels; validate in a11y pass (NFR-7).                                                      |
| R8  | Optimistic status change + slow/failed action confuses users.           | Med        | Low    | Rollback + toast (FR-4/MI6); disable the specific control while in flight.                                                                                                                   |
| R9  | UESP attribution omitted → license non-compliance.                      | Low        | Med    | FR-7 attribution in UI + README; include in acceptance checklist.                                                                                                                            |

## 8. Milestones / Phased Rollout

- **M0 — Foundations (prereq verification).** Confirm assumed dependencies: auth works; **`prd-import-uesp-books.md` M3 has run**, so `book`/`book_location` are populated with normalized `skill`/`category`/`source` (~1,207 books, 423 in FR-3's default scope); RLS policies on `user_book` in place. This milestone gates the whole feature on that import — until it has run the `book` table is empty and every screen below renders nothing. Exit: a smoke query returns books and the session helper returns a user id.
- **M1 — Read-only browse (public).** Server Component list with title/category/source/skill at **`/books`**, scoped to FR-3's default allowlists, pagination (50/page), default sort, UESP attribution. `/` redirects there and the scaffold's `instruments` page is deleted (FR-8). No auth needed. Also wires the two standing guards rather than deferring them to M5 — `server-only` in `src/features/*/data.ts` (AC-6) and the `react/no-danger` lint rule (AC-11). Both are near-free now and both protect code that does not exist yet, which is the only moment they can be added without a retrofit. Exit: FR-1, FR-6, FR-7; AC-6 and AC-11 enforced; NFR-1 met for anonymous.
- **M2 — Filters and title search.** URL-backed category, source, skill and read/collected filters, plus the `?q=` title substring match (FR-9) — it is one more predicate on the same query and one more param on the same soft-nav plumbing, so it is cheapest built here rather than retrofitted. Soft-nav, page reset. Exit: FR-3, FR-9, shareable URLs.
- **M3 — Tracking.** Read/collected toggles via Server Action + `useOptimistic`, RLS-enforced writes, rollback-on-failure, progress bar. Adds **`/collection/[user]`** (progress summary plus the books that user has marked) and makes `/` conditional on auth state (FR-8). Exit: FR-4, FR-5, FR-8, NFR-2/3/6.
- **M4 — Unauthenticated polish.** Disabled controls + sign-in affordance. Exit: FR-2, MI5.
- **M5 — Hardening.** RLS tests, param validation (R4), perf pass against NFR-1, a11y pass (NFR-7). Exit: all acceptance criteria green.

## 9. Acceptance Criteria

- AC-1. List page renders server-side, 50 books/page, each row showing title, category, source, skill (when present), and the current user's `is_read`/`is_collected` flags. (FR-1)
- AC-2. An anonymous visitor sees the full list and metadata; every read/collected control is rendered **disabled** with a visible sign-in affordance. (FR-2, MI5)
- AC-3. Setting category/source/skill/read/collected filters updates the visible list **without a full page reload** and is reflected in the URL query params; copying the URL reproduces the filtered view. Changing a filter resets to page 1. (FR-3)
- AC-4. Toggling a book's `read` or `collected` flag updates the UI instantly, independently of the other flag; the `user_book` write goes through a Server Action that derives `user_id` from the session (upsert the changed flag(s), delete once both are `false`); on failure the UI rolls back and shows an error toast. Setting `collected` works regardless of the current `read` value, and vice versa. (FR-4)
- AC-5. The progress bar shows independent collected and read counts over a dynamically computed total, and matches the DB after any change (verified by reload). (FR-5, MI1)
- AC-6. **No** Client Component performs a direct DB call; all writes route through a Server Action. Enforced rather than reviewed: every `src/features/*/data.ts` imports `server-only`, so a Client Component that pulls in server data logic fails the build instead of shipping. Scoped to app data — `src/lib/supabase/client.ts` legitimately runs client-side for the auth handshake. (NFR-3/4)
- AC-7. RLS test: user B cannot read or write user A's `user_book` rows; `book`/`book_location` are publicly readable but not user-writable. (NFR-3)
- AC-8. NFR-1: authenticated list first render `< 1s`; NFR-2: toggle server confirmation `< 500ms` p50 — both measured in the target environment.
- AC-9. UESP CC BY-SA attribution is visible in the UI and present in the README. (FR-7)
- AC-10. Invalid/tampered query params fall back to defaults without error. (R4)
- AC-11. No `dangerouslySetInnerHTML` (or equivalent raw-HTML injection) renders `description`, `errata`, `gameplay_note`, or any other UESP-sourced free-text field, anywhere in the app. Enforced by the `react/no-danger` ESLint rule rather than by review; the rule bans the prop outright, which is broader than this AC strictly requires and is the right default. (NFR-8)
- AC-12. `/books` renders the catalogue with no progress summary, and `/collection/[user]` the tracking view for that user; `/` redirects to the signed-in user's own collection and to `/books` when anonymous (unconditionally `/books` before M3); a visitor asking for a collection that is not their own, signed out or in, lands on `/books`; and no route still serves the scaffold's `instruments` page. (FR-8)
- AC-13. A `?q=` term narrows the list to titles containing it case-insensitively, **combined with** the active filters rather than replacing them; it resets to page 1, reproduces the same view from a copied URL, and a term containing `%` or `_` matches those characters literally instead of acting as a wildcard. (FR-9)
- AC-14. A public account's `/collection/[user]` is readable by a signed-out visitor; a private one returns 404 — indistinguishable in status and body from a username that was never registered — and no public view exposes `user_book_note` content. Collection pages serve `noindex`, and the collection path is absent from any `robots.txt` `Disallow`. (FR-10)

## 10. Success Metrics

- **Adoption:** % of authenticated users who mark ≥1 book collected within their first session (target: ≥ 60%).
- **Engagement:** median books toggled per active user per week; return rate of users who toggled in week 1.
- **Filter usage:** % of sessions that apply ≥1 filter (validates the core "what's left, filtered" thesis; target: ≥ 40%).
- **Performance (field):** p75 list render `< 1s`; p50 toggle confirmation `< 500ms`.
- **Reliability:** toggle Server Action error rate `< 0.5%`; optimistic-rollback events `< 1%` of toggles.
- **Correctness:** zero reported progress-bar/DB mismatches.
- **Security:** zero RLS cross-user access incidents; zero Client-Component direct-DB-call regressions (CI guard).

## 11. Open Questions

- **OQ-4 (MI4):** Default sort and available sort options (title, category, collected-first)?
- **OQ-5 (MI5):** Unauthenticated track controls — disabled (recommended) vs hidden vs inline sign-in prompt?
- **OQ-7:** Empty-state copy when filters match zero books.
- **OQ-10 (from OQ-6):** Which progress bars does `/collection/[user]` show — collected vs read, base vs base+DLC, with or without notes — and can the user configure the set? More than one revises FR-5, which specifies a single bar, and relaxes NG9, which rules out progress charts beyond a single summary bar.

---

## 12. Technical Design — Schema, RLS, Server Action

> Design notes:
>
> - Untouched is represented by **row absence** in `user_book` (Decision #4); `is_read` and `is_collected` are independent booleans, neither implying the other. A `check` constraint blocks a persisted row where both are `false` (that state means "delete the row," not "store falsy flags").
> - `notes` lives in a separate `user_book_note` table, not on `user_book` — see §12.1.
> - `book` / `book_location` are seeded by the separate import task; their DDL is shown only to anchor the RLS and the read join, and to record the indexes this feature needs.
> - Targets Supabase Postgres. Shipped as `supabase/migrations/20260819040000_user_book.sql`; the `book`/`book_location` reshape lands in the import task's own migration.

### 12.1 Schema (DDL)

```sql
-- ── Reference tables (owned by the import task; shown for context) ─────────
-- Shape after the import task's migration (prd-import-uesp-books.md §12.1):
-- create table book (
--   id           uuid primary key default gen_random_uuid(),
--   uesp_page_id integer not null unique,     -- identity; MediaWiki page id
--   uesp_title   text not null,               -- 'Skyrim:Deathbrand (book)'
--   title        text not null,               -- display title
--   game_id      text,                        -- Creation Kit form id: NOT unique,
--                                             -- 78 pages collide via xx/fexxx placeholders
--   category     text not null,               -- check: skill_book|book|journal|note|black_book|treasure_map
--   source       text not null,               -- check: base|dawnguard|dragonborn|hearthfire|creation_club
--   skill        text,                        -- check: one of Skyrim's 18 skills. Non-null for every
--                                             -- skill_book EXCEPT Oghma Infinium, which raises six at
--                                             -- once and is identified by artifact_type instead
--   artifact_type text,                        -- 'Daedric Artifact'; set on exactly one book
--   is_obtainable boolean not null default true, -- CURATED, not derived: false on 24
--                                             -- books (23 from UESP's own Unobtainable
--                                             -- Items list, plus one cut-content page).
--                                             -- true means "nothing marked it otherwise",
--                                             -- not "verified obtainable".
--   description  text, author text, value text, weight numeric(6,2),
--   icon         text, lorename text, errata text, gameplay_note text,
--   is_quest_related boolean not null default false,
--   is_unique    boolean                      -- NULLABLE: no source field exists, so unknown
-- );
-- create table book_location ( ... book_id uuid references book(id) ... );

-- ── Per-user tracking ──────────────────────────────────────────────────────
-- is_read and is_collected are independent: collecting a book and reading it
-- are separate in-game actions, so neither implies the other.
create table user_book (
  user_id      uuid not null references auth.users (id) on delete cascade,
  book_id      uuid not null references book (id)       on delete cascade,
  is_read      boolean not null default false,
  is_collected boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, book_id),       -- one row per (user, book); natural PK
  -- A row must mean *something*; both-false is "delete the row", not a stored state.
  constraint user_book_touched check (is_read or is_collected)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Read path: fetch the current user's rows for the 50 visible books.
create index user_book_user_idx on user_book (user_id);
-- Progress counts per user, filtered by flag (partial: only true rows are
-- indexed, matching the "count collected"/"count read" queries).
create index user_book_user_read_idx      on user_book (user_id) where is_read;
create index user_book_user_collected_idx on user_book (user_id) where is_collected;
-- Catalog ordering / pagination (default title A→Z, MI4) -- on book:
-- create index book_title_idx on book (title);
-- Skill / category / source filters (FR-3) -- on book:
-- create index book_skill_idx    on book (skill);
-- create index book_category_idx on book (category);
-- create index book_source_idx   on book (source);

-- ── Per-user notes ─────────────────────────────────────────────────────────
-- Split from user_book: no FK to it, so a note can exist independent of
-- read/collected status. Also keeps user_book (frequently toggled) narrow --
-- Postgres rewrites the whole row (MVCC) on every update, so a large,
-- rarely-changed notes column there would copy note text on every toggle.
create table user_book_note (
  user_id    uuid not null references auth.users (id) on delete cascade,
  book_id    uuid not null references book (id)       on delete cascade,
  notes      text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- ── updated_at maintenance ─────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger user_book_set_updated_at
  before update on user_book
  for each row execute function set_updated_at();

create trigger user_book_note_set_updated_at
  before update on user_book_note
  for each row execute function set_updated_at();
```

### 12.2 Row-Level Security

```sql
-- ── user_book: owner-only, all verbs ───────────────────────────────────────
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

-- ── user_book_note: same owner-only pattern as user_book ────────────────────
alter table user_book_note enable row level security;

create policy user_book_note_select_own on user_book_note
  for select using ((select auth.uid()) = user_id);

create policy user_book_note_insert_own on user_book_note
  for insert with check ((select auth.uid()) = user_id);

create policy user_book_note_update_own on user_book_note
  for update using ((select auth.uid()) = user_id)
              with check ((select auth.uid()) = user_id);

create policy user_book_note_delete_own on user_book_note
  for delete using ((select auth.uid()) = user_id);

-- ── Reference tables: public read, no client write (NFR-3) ─────────────────
alter table book          enable row level security;
alter table book_location enable row level security;

create policy book_public_read          on book          for select using (true);
create policy book_location_public_read on book_location for select using (true);
-- No insert/update/delete policies → writes are denied to anon & authenticated.
-- The import task authenticates with the secret key, which resolves to the
-- service_role Postgres role and bypasses RLS.
```

Notes:

- The `with check` on insert/update is what actually blocks a client from writing another user's `user_id`; combined with the Server Action deriving `user_id` from the session, identity is enforced in two places (defense in depth — R5).
- Because untouched = no row, `delete` must be owner-scoped too, hence the delete policy.
- `auth.uid()` is wrapped in `(select ...)` in every policy — this lets Postgres cache it once per query (an `initPlan`) instead of re-evaluating it per row, per [Supabase's RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select-statement).

### 12.3 Server Action

`src/features/collection/actions.ts`

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const InputSchema = z.object({
    bookId: z.string().uuid(),
    isRead: z.boolean().optional(),
    isCollected: z.boolean().optional(),
});

export type SetBookFlagsInput = z.infer<typeof InputSchema>;

export type SetBookFlagsResult =
    | { ok: true; isRead: boolean; isCollected: boolean }
    | {
          ok: false;
          error: 'unauthenticated' | 'invalid_input' | 'write_failed';
      };

/**
 * Updates the current user's is_read/is_collected flags for a book,
 * independently — only the flags present in the input change; the other
 * keeps its current (or default false) value. Deletes the row once both
 * flags end up false, mirroring the `user_book_touched` check constraint,
 * rather than persisting an all-false row.
 * RLS guarantees a user can only affect their own rows; the explicit
 * user_id filter is belt-and-suspenders. Revalidates the list route so the
 * Server-Component progress bar and rows reflect true DB state (FR-5/NFR-6).
 */
export async function setBookFlags(
    input: SetBookFlagsInput,
): Promise<SetBookFlagsResult> {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid_input' };
    const { bookId, isRead, isCollected } = parsed.data;

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'unauthenticated' };

    const { data: existing } = await supabase
        .from('user_book')
        .select('is_read, is_collected')
        .eq('user_id', user.id)
        .eq('book_id', bookId)
        .maybeSingle();

    const nextIsRead = isRead ?? existing?.is_read ?? false;
    const nextIsCollected = isCollected ?? existing?.is_collected ?? false;

    if (!nextIsRead && !nextIsCollected) {
        const { error } = await supabase
            .from('user_book')
            .delete()
            .eq('user_id', user.id)
            .eq('book_id', bookId);
        if (error) return { ok: false, error: 'write_failed' };
    } else {
        const { error } = await supabase.from('user_book').upsert(
            {
                user_id: user.id,
                book_id: bookId,
                is_read: nextIsRead,
                is_collected: nextIsCollected,
            },
            { onConflict: 'user_id,book_id' },
        );
        if (error) return { ok: false, error: 'write_failed' };
    }

    // Both routes read user_book: /books renders the per-row flags, and
    // /collection/[user] the progress summary and which books appear there
    // at all (FR-8), so a toggle invalidates both. The collection path is
    // dynamic, so a literal '/collection' would match nothing -- build the
    // concrete path from the session's own id rather than revalidating
    // every user's page.
    revalidatePath('/books');
    revalidatePath(`/collection/${user.id}`);
    return { ok: true, isRead: nextIsRead, isCollected: nextIsCollected };
}
```

**Companion read shape** (`src/features/books/data.ts`, Server Component side) for FR-1/FR-5, so the join contract is explicit:

```ts
// One page of books with the current user's flags (absent row = both false).
export type BookCategory =
    'skill_book' | 'book' | 'journal' | 'note' | 'black_book' | 'treasure_map';
export type BookSource =
    'base' | 'dawnguard' | 'dragonborn' | 'hearthfire' | 'creation_club';

export type BookRow = {
    id: string;
    title: string;
    category: BookCategory;
    source: BookSource;
    skill: string | null;
    isRead: boolean; // coalesced: missing user_book -> false
    isCollected: boolean; // coalesced: missing user_book -> false
};

export type ProgressSummary = {
    total: number; // count(book) within FR-3's default scope — dynamic (MI1)
    collected: number; // count(user_book where is_collected)
    read: number; // count(user_book where is_read)
};
```

**Client usage sketch** (`ReadToggle`/`CollectedToggle`, `"use client"`): each toggle wraps its own call in `useTransition` + `useOptimistic`, passing only the flag it owns (e.g. `{ bookId, isCollected }`); on a non-`ok` result (or a thrown error), revert that toggle's optimistic value and show a toast (FR-4/MI6); disable the specific control while its transition is pending (R8) — the other toggle stays interactive since the two flags are independent.

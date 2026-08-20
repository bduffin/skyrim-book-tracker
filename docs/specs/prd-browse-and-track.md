# PRD: Browse Books & Track Collection

> Stage: PRD — derived from `docs/specs/spec-browse-and-track.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved verbatim from spec)

> Players who want to collect every book in Skyrim have no lightweight, web-based way to see what they've found versus what remains. Spreadsheets are clunky; UESP has the data but no per-user tracking; mods are installation-heavy and don't persist across new playthroughs or platforms.

---

## 0. Contradictions & Missing Info (resolve before/during build)

| #   | Type      | Issue                                                                           | Resolution in this PRD                                                                                                              |
| --- | --------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| MI1 | Missing   | No canonical total book count (the "/820" denominator).                         | Compute total dynamically from `book` table; do not hardcode. OQ-1.                                                                 |
| MI2 | Missing   | `skill` is nullable free-text ("Smithing +1") in arch §6 — no clean filter key. | Require a normalized `skill` value (enum or controlled string) populated by the data-import task. Skill filter depends on it. OQ-2. |
| MI3 | Missing   | Spec has no title **search**; arch §8 references search inputs.                 | Out of scope for this PRD; tracked as OQ-3.                                                                                         |
| MI4 | Missing   | No sort order specified.                                                        | Default sort: title A→Z. OQ-4.                                                                                                      |
| MI5 | Ambiguous | Success criterion 5: unauthenticated controls "disabled/hidden."                | **Decision:** render controls **disabled** with a sign-in affordance (discoverability > hiding). OQ-5.                              |
| MI6 | Missing   | No defined behavior when a toggle Server Action fails.                          | Optimistic state **rolls back** + non-blocking error toast. FR-4.                                                                   |

---

## 1. Problem Statement

Skyrim completionists have no lightweight, persistent, web-based way to track which in-game books they have collected versus which remain. Today they cross items off a spreadsheet or rely on memory. Existing options each fail a key need: spreadsheets are clunky and have no structured metadata or filtering; UESP has authoritative structured data but no per-user tracking; mods are installation-heavy and don't persist across new characters or platforms. The result is lost progress on new playthroughs and no single answer to "what do I still need, filtered by what I care about right now?"

## 2. Goals and Non-Goals

### Goals

- G1. Let any visitor browse the full Skyrim book catalog with rich metadata (title, category, skill, locations).
- G2. Let an authenticated user mark a book as collected and have it persist across sessions and characters.
- G3. Let a user filter the catalog by category, skill, and collection status, with shareable URLs.
- G4. Show overall collection progress at a glance.
- G5. Enforce a strict server-first architecture: zero direct DB calls from Client Components; all `user_book` writes through a Server Action under RLS.

### Non-Goals (this PRD)

- NG1. Book **detail page** with full location list (nice-to-have; deferred).
- NG2. **Per-character / multi-character** tracking.
- NG3. Saved filter presets / named collections.
- NG4. _(Removed — `read` is now in scope; see FR-4 and the `is_read`/`is_collected` flags.)_
- NG5. Full-text **title search** (MI3 / OQ-3).
- NG6. Storing or rendering full book text (metadata only — licensing constraint).
- NG7. Auth/sign-up/sign-in flows (separate spec; assumed to exist).
- NG8. UESP data import/seeding (separate task; assumed done).
- NG9. AI features, real-time/collaboration, per-category progress charts beyond a single summary bar.

## 3. Current State Analysis

- **Greenfield.** No tracking exists in the app today.
- **Data source.** UESP (CC BY-SA) provides structured book data: titles, categories, skill effects, locations. Attribution required in UI and README.
- **Assumed-present dependencies:** (a) Supabase Auth with working sign-in; (b) `book` and `book_location` tables seeded from UESP; (c) Next.js App Router + Tailwind scaffolding per architecture — Tailwind is installed; shadcn/ui is not yet installed but will be added soon.
- **Data model (arch §6):** `book` (id, uesp/game id, title, category, nullable skill, is_unique, metadata), `book_location` (book_id, location_name, type, notes), `user_book` (user_id, book_id, is_read, is_collected, updated_at), `user_book_note` (user_id, book_id, notes, updated_at).
- **Pain points (from spec):** no unified have-vs-left view; no filtering by category/skill/status; progress lost on new characters.
- **Architectural constraints already decided:** Server Components default; client interactivity opt-in; RLS on `user_*`; reference tables publicly readable but not user-writable.

## 4. Proposed Solution

A single **server-rendered book list page** at e.g. `/books` (route name OQ-6), built server-first:

1. **Server Component (page)** reads filter/pagination state from URL query params, fetches the matching paginated `book` rows joined to the current user's `user_book` rows (left join → absent row = untouched, `is_read`/`is_collected` both `false`), and computes the progress totals. Unauthenticated requests skip the user join.
2. **Client Components (opt-in)** handle only interactivity: the filter controls and the per-row read/collected controls. Filter changes push new query params → Next.js soft navigation re-renders the Server Component (no full reload).
3. **Read/Collected controls** use `useOptimistic` for instant UI feedback and call a **Server Action** that validates the Supabase session server-side and upserts the changed flag(s), or deletes the `user_book` row once both flags are `false`, under RLS. On failure, the optimistic state rolls back and a toast surfaces the error.
4. **Progress bar** is a Server Component value reflecting true DB counts (collected, and read — counted independently, not combined); it re-derives on each server render (after any change's `revalidate`).
5. **Unauthenticated** users get the full list with status controls rendered **disabled** plus a sign-in prompt; the progress bar shows catalog total only.

```
URL (?category=&skill=&read=&collected=&page=)
        │  soft-nav
        ▼
[Server Component: /books page]
  ├─ getBooksPage(filters, page, userId?)  ──► Supabase (book ⟕ user_book)
  ├─ getProgress(userId?)                   ──► Supabase counts
  └─ renders:
       ├─ <ProgressBar/>            (server)
       ├─ <Filters/>  "use client" (writes URL params)
       └─ <BookRow/>* with <ReadToggle/>/<CollectedToggle/> "use client"
                                   └─ Server Action: setBookFlags(bookId, { isRead?, isCollected? })
                                        ├─ assert auth.uid()
                                        └─ upsert changed flag(s) | delete once both flags false  user_book (RLS)
```

**Key design tradeoffs (explicit):**

- **`useOptimistic` + Server Action (chosen)** vs a client-side query/cache library. Chosen for fewer moving parts and native App Router fit. Tradeoff: cross-row cache coordination (e.g., progress bar consistency) leans on `revalidatePath`/server re-render rather than a client cache. If live refetch-on-filter or richer cache invalidation becomes painful, revisit this tradeoff for the list specifically.
- **Filter state in URL (per Decision #1)** vs client/server state. Chosen for shareability and back-button correctness. Tradeoff: every filter change is a server round-trip; mitigated by Next.js soft navigation + the <1s render budget.
- **Sparse rows (upsert/delete)** vs a row per (user, book). Per Decision #4, untouched = absent row, so setting either flag `true` = upsert and clearing both flags = delete. Tradeoff: storage stays proportional to actual progress (most users touch a fraction of 800+ books) at the cost of a `LEFT JOIN ... COALESCE(is_read, false), COALESCE(is_collected, false)` on every read. The alternative (pre-seed a row per book per user) makes reads trivial but explodes write volume on signup and storage — rejected for a side-project scale.
- **Two independent flags (`is_read` / `is_collected`)** vs the original `collected` implies `read` monotonic enum — **revised from the initial design**. Reading and collecting are separate in-game actions (you can grab a book to read later, or read one you don't keep), so treating them as one ladder was wrong by domain, not just a simplification. Tradeoff: progress/filters now track two dimensions instead of one (no more single "read-or-better" figure), and each row needs two toggles instead of one segmented control — more UI surface, but each toggle's meaning is unambiguous.

## 5. Requirements

### Functional (FR)

- **FR-1 — Book list (Server Component).** Render a paginated list (50/page, Decision #3) of books. Each row shows: title, category, skill (if any), and the current user's `is_read`/`is_collected` flags (independent; absent row = both `false`). Renders fully server-side (no client data waterfall).
- **FR-2 — Public browse.** Unauthenticated users can view the full list and all metadata. Both flags render `false` for all rows; the read/collected controls render **disabled** with a sign-in affordance (MI5).
- **FR-3 — Filters (Client Component, URL-backed).** Controls for: category, skill, read status, and collected status — each filterable independently (e.g. `all | true | false` per flag), not a single combined status. State persists in URL query params (e.g. `?category=skill&read=false&collected=true&page=1`) and is shareable/bookmarkable. Changing a filter resets to page 1 and updates the list via soft navigation (no full reload). Skill filter options derive from the normalized skill values (MI2).
- **FR-4 — Read/Collected controls (Client Component + Server Action).** Authenticated user toggles a book's `is_read` and `is_collected` flags independently — toggling one never changes or implies the other. UI updates optimistically per flag; a Server Action validates the Supabase session and writes `user_book` under RLS — **upsert** the changed flag(s), **delete** the row once both flags are `false`. On success, server state is revalidated so the progress bar stays truthful. On failure, the optimistic change rolls back and a non-blocking error toast appears (MI6). The write path never trusts a client-supplied `user_id`.
- **FR-5 — Progress summary.** A progress bar shows `<collected> collected · <read> read / <total>` (total computed dynamically, MI1; `collected` and `read` are independent counts, not combined). It reflects true DB state after any change. For unauthenticated users it shows `0 / <total>` or total only.
- **FR-6 — Pagination.** 50 books/page; page in URL. Stable ordering (default title A→Z, MI4) so pagination is deterministic.
- **FR-7 — Attribution.** UESP CC BY-SA attribution visible in the UI (and README per arch §2).

### Non-Functional (NFR)

- **NFR-1 — Performance.** List page first render < 1s for an authenticated user (server render, no client waterfall) under expected catalog size.
- **NFR-2 — Toggle latency.** Optimistic update is visually instant; Server Action confirmation within 500ms p50 under normal conditions.
- **NFR-3 — Security / RLS.** RLS on `user_book`: a user can only read/write rows where `auth.uid() = user_id`. `book`/`book_location` publicly readable, not user-writable. **Zero** direct DB calls from any Client Component.
- **NFR-4 — Architecture conformance.** Server Components default; `"use client"` only for filters and toggle. Server-only DB logic lives in `src/features/*/data.ts`.
- **NFR-5 — Data scope.** Store structured metadata only; no full book text.
- **NFR-6 — Resilience.** A failed or slow toggle never corrupts displayed progress; UI converges to server truth on next render.
- **NFR-7 — Accessibility.** Filter controls and toggles are keyboard-operable and screen-reader labeled (shadcn/ui primitives); disabled state communicates "sign in to track."

## 6. Constraints and Assumptions

### Constraints (from spec + architecture)

- Server Components are the default; client interactivity is opt-in via `"use client"`.
- All `user_book` writes go through a Server Action — never a direct client DB call.
- RLS restricts `user_book` reads/writes to the owning user.
- Metadata only — no full book text stored.
- Stack fixed: Supabase (DB + Auth), Next.js App Router, Tailwind + shadcn/ui, TypeScript/Yarn.
- Filter state in URL query params (Decision #1). Two independent boolean flags `is_read`/`is_collected`, neither implies the other (Decision #2, revised). 50/page (Decision #3). Missing `user_book` row = untouched (both flags `false`), no pre-population; clearing both flags deletes the row (Decision #4).

### Assumptions (from spec)

- A1. UESP data is pre-seeded into `book` and `book_location` (separate import task), **including a normalized `skill` value** (this PRD's added requirement, MI2).
- A2. Auth (sign-up/sign-in) exists via a separate spec.
- A3. A book with no `user_book` row is untouched (neither read nor collected); no pre-population.
- A4. Performance targets (<1s, 500ms) are reasonable given a single-app Vercel + Supabase deployment and a catalog on the order of hundreds–low thousands of books.

## 7. Risks and Mitigations

| ID  | Risk                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                  |
| --- | ----------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Skill filter unusable because `skill` is free-text (MI2).               | High       | High   | Make the import task populate a normalized `skill` key; derive filter options from distinct values; gate FR-3 skill filter on this.                         |
| R2  | Progress bar drifts from DB after optimistic toggles (consistency).     | Med        | Med    | Server Action calls `revalidatePath` so the next server render recomputes counts; treat client optimistic value as transient only.                          |
| R3  | <1s render breached at scale (large catalog + joins per page).          | Med        | Med    | Paginate (50), index `book(title)`, `user_book(user_id, book_id)`; left-join only the 50 visible books, not the whole catalog; count via a cheap aggregate. |
| R4  | URL param tampering / invalid filter values.                            | Med        | Low    | Validate & whitelist params server-side (zod); fall back to defaults on bad input.                                                                          |
| R5  | RLS misconfig leaks/allows cross-user writes.                           | Low        | High   | Explicit RLS policies + tests asserting a user cannot read/write another's `user_book`; Server Action derives `user_id` from session, never from input.     |
| R6  | Soft navigation on every filter change feels janky.                     | Med        | Low    | Pending UI (useTransition) on filters; debounce; keep payloads small.                                                                                       |
| R7  | Two independent toggles per row clutter mobile UI / unclear affordance. | Med        | Low    | Use two compact icon toggles (e.g. book icon for read, chest/star icon for collected) with clear labels; validate in a11y pass (NFR-7).                     |
| R8  | Optimistic status change + slow/failed action confuses users.           | Med        | Low    | Rollback + toast (FR-4/MI6); disable the specific control while in flight.                                                                                  |
| R9  | UESP attribution omitted → license non-compliance.                      | Low        | Med    | FR-7 attribution in UI + README; include in acceptance checklist.                                                                                           |

## 8. Milestones / Phased Rollout

- **M0 — Foundations (prereq verification).** Confirm assumed dependencies: auth works; `book`/`book_location` seeded with normalized `skill`; RLS policies on `user_book` in place. Exit: a smoke query returns books and the session helper returns a user id.
- **M1 — Read-only browse (public).** Server Component list with title/category/skill, pagination (50/page), default sort, UESP attribution. No auth needed. Exit: FR-1, FR-6, FR-7; NFR-1 met for anonymous.
- **M2 — Filters.** URL-backed category + read/collected filters (skill filter only if R1 resolved), soft-nav, page reset. Exit: FR-3 (category, read, collected), shareable URLs.
- **M3 — Tracking.** Read/collected toggles via Server Action + `useOptimistic`, RLS-enforced writes, rollback-on-failure, progress bar. Exit: FR-4, FR-5, NFR-2/3/6.
- **M4 — Unauthenticated polish + skill filter.** Disabled controls + sign-in affordance; enable skill filter once normalized data lands. Exit: FR-2, remaining FR-3, MI5.
- **M5 — Hardening.** RLS tests, param validation (R4), perf pass against NFR-1, a11y pass (NFR-7). Exit: all acceptance criteria green.

## 9. Acceptance Criteria

- AC-1. List page renders server-side, 50 books/page, each row showing title, category, skill (when present), and the current user's `is_read`/`is_collected` flags. (FR-1)
- AC-2. An anonymous visitor sees the full list and metadata; every read/collected control is rendered **disabled** with a visible sign-in affordance. (FR-2, MI5)
- AC-3. Setting category/skill/read/collected filters updates the visible list **without a full page reload** and is reflected in the URL query params; copying the URL reproduces the filtered view. Changing a filter resets to page 1. (FR-3)
- AC-4. Toggling a book's `read` or `collected` flag updates the UI instantly, independently of the other flag; the `user_book` write goes through a Server Action that derives `user_id` from the session (upsert the changed flag(s), delete once both are `false`); on failure the UI rolls back and shows an error toast. Setting `collected` works regardless of the current `read` value, and vice versa. (FR-4)
- AC-5. The progress bar shows independent collected and read counts over a dynamically computed total, and matches the DB after any change (verified by reload). (FR-5, MI1)
- AC-6. Static/audit check: **no** Client Component performs a direct DB call; all writes route through a Server Action. (NFR-3/4)
- AC-7. RLS test: user B cannot read or write user A's `user_book` rows; `book`/`book_location` are publicly readable but not user-writable. (NFR-3)
- AC-8. NFR-1: authenticated list first render < 1s; NFR-2: toggle server confirmation < 500ms p50 — both measured in the target environment.
- AC-9. UESP CC BY-SA attribution is visible in the UI and present in the README. (FR-7)
- AC-10. Invalid/tampered query params fall back to defaults without error. (R4)

## 10. Success Metrics

- **Adoption:** % of authenticated users who mark ≥1 book collected within their first session (target: ≥ 60%).
- **Engagement:** median books toggled per active user per week; return rate of users who toggled in week 1.
- **Filter usage:** % of sessions that apply ≥1 filter (validates the core "what's left, filtered" thesis; target: ≥ 40%).
- **Performance (field):** p75 list render < 1s; p50 toggle confirmation < 500ms.
- **Reliability:** toggle Server Action error rate < 0.5%; optimistic-rollback events < 1% of toggles.
- **Correctness:** zero reported progress-bar/DB mismatches.
- **Security:** zero RLS cross-user access incidents; zero Client-Component direct-DB-call regressions (CI guard).

## 11. Open Questions

- **OQ-1 (MI1):** Is "total" the full `book` count, or scoped to current filters? (Affects whether progress is global or per-filter.) _Recommendation: global total in the bar; optionally show filtered count separately._
- **OQ-2 (MI2):** What is the normalized `skill` representation, and is the import task already producing it? Filter UX (and R1) depends on this.
- **OQ-3 (MI3):** Is title search in or out for the first release? Spec omits it; architecture references it.
- **OQ-4 (MI4):** Default sort and available sort options (title, category, collected-first)?
- **OQ-5 (MI5):** Unauthenticated track controls — disabled (recommended) vs hidden vs inline sign-in prompt?
- **OQ-6:** Route/IA — `/books`, `/`, or `/collection`? Where does the progress bar live relative to filters?
- **OQ-7:** Empty-state copy when filters match zero books.
- **OQ-8:** Category taxonomy — fixed enum vs free-text from UESP (mirrors the skill concern for the category filter).

---

## 12. Technical Design — Schema, RLS, Server Action

> Design notes:
>
> - Untouched is represented by **row absence** in `user_book` (Decision #4); `is_read` and `is_collected` are independent booleans, neither implying the other. A `check` constraint blocks a persisted row where both are `false` (that state means "delete the row," not "store falsy flags").
> - `notes` lives in a separate `user_book_note` table, not on `user_book` — see §12.1.
> - `book` / `book_location` are seeded by the separate import task; their DDL is shown only to anchor the RLS and the read join, and to record the indexes this feature needs.
> - Targets Supabase Postgres. Run as a single migration (e.g. `supabase/migrations/0001_user_book.sql`).

### 12.1 Schema (DDL)

```sql
-- ── Reference tables (owned by the import task; shown for context) ─────────
-- create table book (
--   id          uuid primary key default gen_random_uuid(),
--   game_id     text unique,                 -- UESP/game identifier
--   title       text not null,
--   category    text not null,               -- TODO normalize (OQ-8)
--   skill       text,                         -- normalized key required for filter (MI2)
--   description text,
--   is_unique   boolean not null default false
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
-- Skill / category filters (MI2/OQ-8) -- on book:
-- create index book_skill_idx    on book (skill);
-- create index book_category_idx on book (category);

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
-- The import task uses the service-role key, which bypasses RLS.
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

    revalidatePath('/books'); // adjust to the final route (OQ-6)
    return { ok: true, isRead: nextIsRead, isCollected: nextIsCollected };
}
```

**Companion read shape** (`src/features/books/data.ts`, Server Component side) for FR-1/FR-5, so the join contract is explicit:

```ts
// One page of books with the current user's flags (absent row = both false).
export type BookRow = {
    id: string;
    title: string;
    category: string;
    skill: string | null;
    isRead: boolean; // coalesced: missing user_book -> false
    isCollected: boolean; // coalesced: missing user_book -> false
};

export type ProgressSummary = {
    total: number; // count(book) — dynamic (MI1)
    collected: number; // count(user_book where is_collected)
    read: number; // count(user_book where is_read)
};
```

**Client usage sketch** (`ReadToggle`/`CollectedToggle`, `"use client"`): each toggle wraps its own call in `useTransition` + `useOptimistic`, passing only the flag it owns (e.g. `{ bookId, isCollected }`); on a non-`ok` result (or a thrown error), revert that toggle's optimistic value and show a toast (FR-4/MI6); disable the specific control while its transition is pending (R8) — the other toggle stays interactive since the two flags are independent.

# PRD: Browse Books & Track Collection

> Stage: PRD — derived from `docs/specs/spec-browse-and-track.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved verbatim from spec)

> Players who want to collect every book in Skyrim have no lightweight, web-based way to see what they've found versus what remains. Spreadsheets are clunky; UESP has the data but no per-user tracking; mods are installation-heavy and don't persist across new playthroughs or platforms.

---

## 0. Contradictions & Missing Info (resolve before/during build)

| #   | Type    | Issue                                                           | Resolution in this PRD                                                                                                                                    |
| --- | ------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MI1 | Missing | No canonical total book count (the "/820" denominator).         | Compute dynamically from `book`, never hardcoded, and over the default scope rather than the whole catalogue — see FR-3's default allowlists (423 books). |
| MI3 | Missing | Spec has no title **search**; arch §8 references search inputs. | In scope as a title substring filter — see FR-9. Ranked/full-text search stays out (NG5).                                                                 |
| MI4 | Missing | No sort order specified.                                        | Title A→Z, and no sort controls — see FR-6.                                                                                                               |
| MI6 | Missing | No defined behavior when a toggle Server Action fails.          | Optimistic state **rolls back** + non-blocking error toast. FR-4.                                                                                         |

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
- NG9. AI features, real-time/collaboration, per-category progress charts beyond FR-5's summary. FR-5 records where user-configurable meters would go if they are ever wanted.
- NG10. **User profiles and first-time-login setup** — choosing a username (Profiles FR-6), the public/private toggle FR-10 depends on (defaulting to public, Profiles FR-3), and the rest of account setup. Specified by `prd-profiles.md`, which FR-10's public viewing waits on: it cannot ship before the toggle that turns it off.

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
3. **Read/Collected controls** are each a `<form>` posting to a **Server Action**, which takes the user from the session and writes through the `set_book_flags` database function: upsert the changed flag, or delete the `user_book` row once both flags are `false`, in one transaction under RLS. The UI updates optimistically through `useFormStatus`; on failure it rolls back and a toast surfaces the error (§12.3).
4. **Progress summary** (on `/collection/[user]` only — FR-8) is a Server Component value reflecting true DB counts (collected, and read — counted independently, not combined) over a named scope; it re-derives on each server render (after any change's `revalidate`).
5. **Unauthenticated** users get the full `/books` list. The read/collected filters stay usable and explain themselves (FR-2), and the toggles offer sign-in rather than tracking (FR-2). Unauthenticated users are redirected off `/collection/[user]`, so no progress summary is rendered for them at all.

```
URL (?category=&source=&skill=&read=&collected=&page=)
        │  soft-nav
        ▼
[Server Component: /books | /collection/[user] page]
  ├─ getBooksPage(filters, page, viewerId)  ──► Supabase (book ⟕ user_book)   /books
  ├─ getMarkedBooksPage(userId, page)       ──► Supabase (book ⋈ user_book)   /collection/[user]
  ├─ getProgress(userId, scope)             ──► Supabase counts                /collection/[user]
  └─ renders:
       ├─ <ProgressSummary/>        (server; /collection/[user] only)
       ├─ <BookFilters/> "use client" (writes URL params; /books only)
       └─ <BookRow/>* with <FlagToggles/> "use client" (signed in only)
                                   └─ <form action> → Server Action: setBookFlags(previous, form)
                                        ├─ user from getClaims(), never from the form
                                        └─ rpc set_book_flags(book, read?, collected?)  user_book (RLS, one transaction)
```

**Key design tradeoffs (explicit):**

- **Server Action through a `<form>`, optimistic via `useFormStatus` (chosen)** vs a client-side query/cache library. Chosen for fewer moving parts and native App Router fit — and `useFormStatus` rather than `useOptimistic` because only a Server Action handed to the form directly still submits without JavaScript; the client function `useOptimistic` needs is server-rendered as `javascript:throw`. Tradeoff: cross-row cache coordination (e.g., progress summary consistency) leans on `revalidatePath`/server re-render rather than a client cache. If live refetch-on-filter or richer cache invalidation becomes painful, revisit this tradeoff for the list specifically.
- **Filter state in URL (per Decision #1)** vs client/server state. Chosen for shareability and back-button correctness. Tradeoff: every filter change is a server round-trip; mitigated by Next.js soft navigation + the `<1s` render budget.
- **Sparse rows (upsert/delete)** vs a row per (user, book). Per Decision #4, untouched = absent row, so setting either flag `true` = upsert and clearing both flags = delete. Tradeoff: storage stays proportional to actual progress (most users touch a fraction of the 1,207-book catalog) at the cost of a `LEFT JOIN ... COALESCE(is_read, false), COALESCE(is_collected, false)` on every read. The alternative (pre-seed a row per book per user) makes reads trivial but explodes write volume on signup and storage — rejected for a side-project scale.
- **Two independent flags (`is_read` / `is_collected`)** vs the original `collected` implies `read` monotonic enum — **revised from the initial design**. Reading and collecting are separate in-game actions (you can grab a book to read later, or read one you don't keep), so treating them as one ladder was wrong by domain, not just a simplification. Tradeoff: progress/filters now track two dimensions instead of one (no more single "read-or-better" figure), and each row needs two toggles instead of one segmented control — more UI surface, but each toggle's meaning is unambiguous.

## 5. Requirements

### Functional (FR)

- **FR-1 — Book list (Server Component).** Render a paginated list (50/page, Decision #3) of books. Each row shows: title, category, source, skill (if any), and the current user's `is_read`/`is_collected` flags (independent; absent row = both `false`). Renders fully server-side (no client data waterfall).
- **FR-2 — Public browse.** Unauthenticated users can view the full list and all metadata. Both flags render `false` for all rows. The read/collected controls behave as follows when signed out:
    - **Filters stay enabled and are honored.** A signed-out visitor has read and collected nothing, so `read=true` matches no book and `read=false` matches every book — accurate answers, not errors. They are deliberately **not disabled**: a disabled control leaves the tab order and cannot carry its own explanation, so a keyboard or screen-reader user would never learn why it is unavailable, and without JavaScript a GET form has nothing to enforce it with anyway. The notice below is their explanation. A permanent hint under the Read and Collected group, attached with `aria-describedby`, was built and dropped: it was obtrusive on every signed-out visit, and said the same thing as the notice, which appears in the one situation where it matters.
    - **An active flag filter while signed out gets a notice** in the results bar, whether or not the list is empty. It says the read and collected filters use your tracking and you are signed out, and offers a sign-in button and a link to the same view with only those two filters removed. It sits in a polite live region that is always rendered, so it is announced when a filter change brings it in: focus stays on the radio just changed, so a description on the filter group would not be read again at that moment. The non-empty case needs it most: `read=false` signed out lists every book, including ones the visitor has read, and looks right. Ignoring the params for signed-out visitors was rejected for the same reason — a visitor whose session has expired opens a shared `read=true` link and silently gets a list that is not what the URL says. **Sign-in returns to the same URL**, filters included, or the visitor loses what they came for.
    - **Toggles render signed out too, and pressing one offers sign-in.** Both show unpressed. Pressing one opens a prompt under the row's toggles naming the book and the flag, with the sign-in form — which returns to the same URL — and a "Not now" that closes it. Hiding the toggles was rejected because a visitor who never sees them never learns the app can track anything; disabling them for the same reason as the filters; sending the press straight to GitHub because it leaves the site without saying why. With JavaScript the prompt opens without a round trip. Without it the toggle's form posts to `setBookFlags`, and the action's `unauthenticated` answer renders the same prompt in the response. That answer exists only in the pressed toggle's action state during the server render, which is why the prompt belongs to the toggle and floats as a callout rather than taking a line of the row. It also opens the prompt for a signed-in page whose session has expired, in place of the toast, which cannot hold a link. Without JavaScript, "Not now" is a link to the current URL, since a button would do nothing. A native `popover` would have given the callout without JavaScript but needs Chrome 114 and Safari 17, outside the browser floor (`architecture.md` §9).
- **FR-3 — Filters (Client Component, URL-backed).** Controls for: **category**, **source**, skill, read status, and collected status — each filterable independently (e.g. `all | true | false` per flag), not a single combined status. Category values are the six the import enforces: `skill_book`, `book`, `journal`, `note`, `black_book`, `treasure_map`. Source values are `base`, `dawnguard`, `dragonborn`, `hearthfire`, `creation_club`. Both come from DB check constraints, so filter options are a fixed list, not derived from distinct values. Skill options are Skyrim's 18 canonical skills, likewise constrained. State persists in URL query params (e.g. `?category=skill_book&source=base&read=false&collected=true&page=1`) and is shareable/bookmarkable. Changing a filter resets to page 1 and updates the list via soft navigation (no full reload). **A `source` filter is required rather than optional**: Creation Club is 326 of 1,207 books and is mostly notes and journals, so without it the default list is dominated by paid add-on content.

**Defaults.** Both are **allowlists**, so anything added later — a future DLC, a seventh category — defaults _off_ rather than silently widening every player's completion denominator:

| Control    | Default                                         | Off by default                                     |
| ---------- | ----------------------------------------------- | -------------------------------------------------- |
| `category` | `skill_book`, `book`, `black_book`              | `journal` (199), `note` (539), `treasure_map` (12) |
| `source`   | `base`, `dawnguard`, `dragonborn`, `hearthfire` | `creation_club` (326)                              |

Together these give the **423**-book default catalogue. `is_obtainable` is **not a user control** — it is always `true` in the query and has no chip, because a book no player can acquire is never something to browse or track. Note `hearthfire` contributes only 10 items (9 notes, 1 book), so enabling it changes the default list by exactly one book; the source chips are not equally weighted.

**Empty results.** Filters make a zero-result view reachable, so the list says so and offers a way back. The message names the search term when there is one, which is what catches a typo; it deliberately does not spell out the active filters, because the controls directly above it already show them and readable copy for every combination of six controls is a lot to get subtly wrong. It carries a **Reset filters** link to `/books` — "reset", not "clear", because `/books` is the default scope above rather than the absence of filtering, so "clear all filters" would name a view this app never renders. The link is suppressed when the active filters _are_ the defaults, since resetting would change nothing; that state is reachable only on a database where the import has not run.

- **FR-4 — Read/Collected controls (Client Component + Server Action).** Authenticated user toggles a book's `is_read` and `is_collected` flags independently — toggling one never changes or implies the other. UI updates optimistically per flag; a Server Action validates the Supabase session and writes `user_book` under RLS — **upsert** the changed flag(s), **delete** the row once both flags are `false`. On success, server state is revalidated so the progress summary stays truthful. On failure, the optimistic change rolls back and a non-blocking error toast appears (MI6). The write path never trusts a client-supplied `user_id`. Choosing between upsert and delete means reading the row first, which PostgREST cannot do in one transaction, so the decision lives in the `set_book_flags` database function (§12.3). Signed out, the same toggles render and offer sign-in instead of writing (FR-2).
- **FR-5 — Progress summary.** One summary with **two meters**, `<collected> / <total> collected` and `<read> / <total> read` — independent counts, never combined into one figure (total computed dynamically, MI1). `<total>` is the count within the **default scope** (FR-3), not `count(book)` — the unscoped figure is 1,207 including 539 notes and 326 Creation Club books, which is a materially different product from the 423-book "real books" catalogue FR-3 defaults to. **The counts are scoped the same way as the total**: a marked book outside the default scope — a collected Creation Club note, say — counts toward neither meter, because counting it in the numerator but not the denominator lets a meter pass 100%. It reflects true DB state after any change. Unauthenticated visitors never see it — they are redirected off `/collection/[user]` (FR-8). **The scope is shown, not assumed**: the summary is headed with the scope's name ("Progress · Default catalog"), and a native `<details>` ("What's included?") renders the scope as the filters it is — every category and source, the counted ones checked. The collection list holds every marked book while the meters count only this scope, so a reader who has marked only notes needs to see why both meters read zero. The scope is carried as data (`ProgressScope`: a name, categories and sources) that both the counts and the display read, which is what custom meters would each carry. **Possible later: custom meters.** Each meter could carry its own scope — base only, base plus DLC, with notes — and a user could add, remove and arrange them on the page like a dashboard. Not planned for any milestone; it would need a per-user store for the meter set (on the profile, NG10) and would relax NG9.
- **FR-6 — Pagination and ordering.** 50 books/page; page in URL. Books are ordered by **title A→Z** and then `uesp_page_id`; title alone is not deterministic, because two titles are duplicated inside the default scope, and a non-deterministic sort makes pagination drop or repeat rows between pages. **That is the only order, and there are no sort controls** (MI4). Every dimension worth sorting by — category, source, skill, read, collected — is one FR-3 already filters by, and filtering answers "show me just these" more precisely than sorting answers "group these together". The list is deliberately not rendered as a table for the same reason: column headers would imply a sortability the data does not benefit from.
- **FR-7 — Attribution.** UESP CC BY-SA attribution visible in the UI (and README per arch §2).
- **FR-8 — Routes and information architecture.** Two routes over the same data layer and row component:

- **`/books`** — the catalogue, and the only route that lists the whole scoped catalogue: the list (FR-1), filters (FR-3), pagination (FR-6), and the per-row read/collected toggles (FR-4). Fully readable signed out (FR-2). It carries **no** progress summary: progress is a property of a user, not of the catalogue.
- **`/collection/[user]`** — a user's own tracking view: the progress summary (FR-5) and every book they have marked, in any category or source rather than only the default scope — a marked book is the user's data whether or not it counts toward progress. A **quick-add** control for marking a book without paging through the catalogue is specified but **deferred**: `/books`'s search and filters already do that job, so the collection page links there until quick-add lands. Quick-add is a search (FR-9) over the catalogue, not a second full listing.
    - The segment holds the owner's **Supabase user id** (`auth.users.id`, the JWT's `sub`), and that form is **permanent**: a collection URL minted today keeps working after custom usernames exist (Profiles FR-6), which is what makes adding them later free rather than a URL migration. The id is not a secret — RLS and the owner check protect the data, not the id's obscurity. It is deliberately not a handle from the auth provider: those are editable by the user in `user_metadata`, can be renamed and re-registered on GitHub, and collide across providers once there is more than one.
- **Navigation** — a secondary nav under the header links **Books** and, when signed in, **My collection**, marking the current one with `aria-current`. Signed out it offers Books alone, since My collection would only bounce back to `/books`.
- **`/`** — redirects to the signed-in user's own `/collection/[user]`, or to `/books` when anonymous. It replaces the scaffold's leftover `instruments` page, which is deleted.
- A signed-out visitor hitting **`/collection/[user]`** directly is redirected to `/books` — as is a signed-in user asking for somebody else's, until FR-10's setting exists to permit it. If a dedicated sign-in route is added later — likely once there is more than one auth provider — that becomes the better target for the signed-out case.

The two routes land in different milestones — `/books` at M1, `/collection/[user]` at M3 — so until M3 `/` redirects to `/books` unconditionally rather than pointing at a route that does not exist yet.

- **FR-9 — Title search.** A `?q=` query param narrows the list to books whose `title` contains the term, case-insensitively — a plain `ilike '%term%'` substring match, **not** ranked or full-text (NG5). It is another filter, not a mode: it combines with the active category/source/skill/status filters and the default scope rather than replacing them, and it resets to page 1 like any other filter change (FR-3). It needs **no migration and no index** — at ~1,200 rows a sequential scan beats an index lookup, the same reasoning `20260914000000_book_import_schema.sql` records for `is_obtainable`. Two things the implementation must get right: the term's LIKE metacharacters (`%`, `_`) are escaped, so a user typing `%` matches a literal percent sign instead of every book; and an absent or empty `q` applies no predicate at all (R4). It is also what will back the quick-add on `/collection/[user]` once that lands (FR-8).
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
- **NFR-7 — Accessibility.** Filter controls and toggles are keyboard-operable and screen-reader labeled; a signed-out state is explained in text a screen reader reaches (FR-2), never by a disabled control alone. The filters use **native form controls**, not a component library's: a scripted listbox is an inert button without JavaScript, which would cost the JS-free filtering `architecture.md` §9 requires, and native controls bring their own keyboard and screen-reader behavior. shadcn/ui stays planned for work where that trade-off does not apply.
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

| ID  | Risk                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Default scope makes "completion" feel unachievable or trivial.          | Med        | Med    | Defaults fixed in FR-3 as allowlists giving 423 books; notes (539), journals (199), treasure maps (12) and Creation Club (326) are opt-in. Revisit if players report the target feels wrong.                                                                                                                    |
| R2  | Progress bar drifts from DB after optimistic toggles (consistency).     | Med        | Med    | Server Action calls `revalidatePath` so the next server render recomputes counts; treat client optimistic value as transient only.                                                                                                                                                                              |
| R3  | `<1s` render breached at scale (large catalog + joins per page).        | Med        | Med    | Paginate (50), index `book(title)`, `user_book(user_id, book_id)`; left-join only the 50 visible books, not the whole catalog; count via a cheap aggregate.                                                                                                                                                     |
| R4  | URL param tampering / invalid filter values.                            | Med        | Low    | Validate & whitelist params server-side; fall back to defaults on bad input. Implemented as pure, unit-tested parsers in `src/features/books/scope.ts` rather than with a schema library: every param is allowlist membership over a check-constraint-derived list. Revisit if one ever carries real structure. |
| R5  | RLS misconfig leaks/allows cross-user writes.                           | Low        | High   | Explicit RLS policies + tests asserting a user cannot read/write another's `user_book`; Server Action derives `user_id` from session, never from input.                                                                                                                                                         |
| R6  | Soft navigation on every filter change feels janky.                     | Med        | Low    | Pending UI (useTransition) on the results rather than the filters, so the control in use stays at full strength; debounce the search box; keep payloads small.                                                                                                                                                  |
| R7  | Two independent toggles per row clutter mobile UI / unclear affordance. | Med        | Low    | Use two compact icon toggles (e.g. book icon for read, chest/star icon for collected) with clear labels; validate in a11y pass (NFR-7).                                                                                                                                                                         |
| R8  | Optimistic status change + slow/failed action confuses users.           | Med        | Low    | Rollback + toast (FR-4/MI6); disable the specific control while in flight.                                                                                                                                                                                                                                      |
| R9  | UESP attribution omitted → license non-compliance.                      | Low        | Med    | FR-7 attribution in UI + README; include in acceptance checklist.                                                                                                                                                                                                                                               |

## 8. Milestones / Phased Rollout

- **M0 — Foundations (prereq verification).** Confirm assumed dependencies: auth works; **`prd-import-uesp-books.md` M3 has run**, so `book`/`book_location` are populated with normalized `skill`/`category`/`source` (~1,207 books, 423 in FR-3's default scope); RLS policies on `user_book` in place. This milestone gates the whole feature on that import — until it has run the `book` table is empty and every screen below renders nothing. Exit: a smoke query returns books and the session helper returns a user id.
- **M1 — Read-only browse (public).** ✅ **Done.** `/books` renders the catalogue server-side — 423 books in FR-3's default scope across 9 pages, title A→Z then `uesp_page_id`, verified against the linked project. `/` redirects there with a 307 and the scaffold's `instruments` page is gone (FR-8, AC-12); the UESP notice renders from the root layout rather than the list, so `/collection/[user]` cannot lose it later (FR-7). The two standing guards went in here rather than waiting for Browse M5, which was the only moment they were not a retrofit: `server-only` in `src/features/*/data.ts` makes AC-6 a build failure, and `react/no-danger` makes AC-11 a lint failure. Three things worth carrying forward. The list is **not** a table, because category, source and skill are filter facets (FR-3) rather than dimensions anyone compares down a column — which is also what closed OQ-4 into FR-6. Tags are shown only where they carry information, since `book` is 310 of 423 rows and `base` is 360, so labelling them puts the word "ordinary" on most of the page. And `getBooksPage` counts before it clamps: PostgREST answers a range starting past the last row with a 416 rather than an empty list, so fetching first and correcting afterwards made `?page=99` an error page instead of the fallback AC-10 requires. **Exit:** met. FR-1, FR-6 and FR-7 green; AC-6 and AC-11 enforced by the build and the linter rather than by review; AC-10's param handling covered by tests and checked in the browser (`?page=0`, `?page=abc` and a repeated `?page=2&page=3` all fall back to page 1, `?page=99` clamps to 9). Pagination is plain links, verified in the server-rendered HTML, so it works with JavaScript disabled. **NFR-1 is deliberately not claimed here.** Local dev measured a median of `705ms` over five requests with an outlier at `1141ms`, but that is a development build talking to the hosted database over the internet, which is not the target environment AC-8 asks for — it stays open for Browse M6, which measures it after deployment.
- **M2 — Filters and title search.** ✅ **Done.** URL-backed category, source, skill and read/collected filters plus FR-9's `?q=` substring match, all on one `<form method="get">` that `router.push`es for soft navigation when JavaScript runs and submits as an ordinary navigation when it does not. Four things worth carrying forward. **Native controls rather than a component library** — a scripted listbox is a dead button without JavaScript, so shadcn/ui would have cost the degraded path `architecture.md` §9 requires; NFR-7 is rewritten accordingly, and the submit button sits in a `<noscript>` because every control applies on change once hydrated. **Params are validated by pure parsers in `scope.ts`, not by a schema library** (R4): each one is allowlist membership over a check-constraint-derived list, and an absent allowlist param reads back as the default set, which is what lets the default view stay a bare `/books`. **PostgREST cannot express a `false` flag filter as an embedded predicate** — a filter on a left-joined embed narrows the embedded rows and leaves every parent in place, so `user_book.is_read=eq.false` returns the whole catalogue rather than the unread part of it. It is an anti-join instead, and `src/features/books/query.ts` exists so the database test drives the same code the app does rather than a copy of it. **`escapeLike` escapes `*` alongside `%` and `_`**, because PostgREST rewrites `*` to `%` before the pattern reaches Postgres: unescaped, a single asterisk matched all 1,207 books. **Exit:** met. FR-3 and FR-9 green; AC-3, AC-10 and AC-13 checked in the browser, and AC-15 added for the empty state that closed OQ-7. The read/collected filters are verified against real `user_book` rows under real RLS on the local stack (`yarn test:db`, the repo's first database test), which matters because nothing in the UI can create such a row until M3 — until then both filters are correct and inert.
- **M3 — Tracking.** ✅ **Done.** Signed-in viewers get read and collected toggles on every row, written through the `set_book_flags` database function by a form-based Server Action, optimistic and rolling back on failure with a toast. `/collection/[user]` shows the owner's progress — two meters over a named scope — and every book they have marked; `/` redirects signed-in visitors there, and a secondary nav links Books and My collection (FR-8). The write path is §12.3. Six things worth carrying forward. **`useFormStatus`, not `useOptimistic`** — only a Server Action handed straight to `<form action>` still submits without JavaScript, and `useOptimistic` needs a client function around it, which React server-renders as `javascript:throw`; showing the pending form's submitted value gives the same instant feedback, and rollback falls out of the submission settling. **Every `user_book` embed is aliased** — with the table embedded twice (once to filter, once to display), a bare `user_book.*` filter also matched the aliased embed ([PostgREST#4075](https://github.com/PostgREST/postgrest/issues/4075)) and `read=false` returned no books at all; addressing embeds only by alias is correct before and after PostgREST 16's deprecation of the old behavior. **Every query over `user_book` names its user explicitly** — filters, displayed flags, the marked list and the counts — because RLS is what confines them to one user today and FR-10's public-read policy will widen it; each has a database test that reads through the admin client, which sees every user's rows the way that policy will. Signed-out flag filters are answered without a query at all (FR-2): `true` matches nothing, `false` everything. **A thrown action needs an error boundary** — `useActionState` rethrows a dropped connection to the nearest boundary, so without one per toggle a single offline click replaced the page with `error.tsx`. **The progress scope is data** (`ProgressScope`), shown rather than explained: the meters count only the default catalog while the list holds every marked book, so a reader who has marked only notes sees them listed beside two zeros, and "What's included?" shows the scope as filters. **The collection lists only books with a `user_book` row**, so once notes have a UI, a book carrying only a note will not appear there; whether "marked" should include notes is a decision for that feature. Also: `yarn test:db` now runs files serially, because they share one database and a concurrent file's fixtures landed inside another's baseline count. Deferred: quick-add (FR-8), and what signed-out visitors see instead of toggles (FR-2, Browse M4). **Exit:** FR-4, FR-5, FR-8, NFR-3 and NFR-6 met. The write path, RLS (AC-7), the display and filter scoping, and the counts are covered by 53 database tests against the local stack, several checked by breaking the code they guard and watching them fail; toggles, rollback, the unreachable-server boundary and the JS-free form POST were exercised in the browser signed out, and the signed-out redirects confirmed as 307s. Signed in, checked by hand against the hosted project: the collection page, the toggles on `/books` including the offline rollback and its toast, and the owner-only redirect for another user's id. **NFR-2 is deliberately not claimed**, for the same reason as NFR-1 at Browse M1: AC-8 asks for the target environment, and a development build talking to the hosted database is not it — it stays open for Browse M6, which measures it after deployment.
- **M4 — Unauthenticated polish.** ✅ **Done.** Signed-out visitors get the same read and collected toggles as everyone else, and pressing one opens a sign-in prompt instead of writing; an active read/collected filter gets a notice in the results bar with sign-in and a link that drops just those two filters; and sign-in — from the header, the prompt or the notice — returns to the same URL, filters included. Sign-out still lands on the default `/books`, deliberately: it is the end of a session, not a detour. Four things worth carrying forward. **A no-JavaScript result lives only in the component whose form posted it** — the `unauthenticated` answer exists in the pressed toggle's `useActionState` during the server render and cannot be lifted to the row, so the prompt is a callout inside the toggle; anything rendered from a Server Action's result without JavaScript has to live below that form. **A JavaScript-only control needs a no-JavaScript stand-in, not an omission** — "Not now" first shipped as nothing before hydration, which left the prompt undismissable; it is now a link to the current URL until JavaScript runs. **A live region has to exist before its content** — the notice and each prompt render an empty `role="status"` so an insertion is announced, and the notice's was confirmed to survive a filter change's soft navigation as the same element. **Built and dropped: a permanent hint under the filters** — obtrusive on every signed-out visit, and it said what the notice says at the one moment it matters (FR-2). **Exit:** FR-2 met, with OQ-5 closed into it. AC-2 checked signed out against the hosted project: 423 books with no flag filter and with `read=false` or `collected=false`, none with either set to `true`; the notice exactly when a flag filter is set; both toggles on all 50 rows; the prompt with JavaScript (no request made; Escape, a click outside or "Not now" close it and return focus) and without (the POST's response renders it, and "Not now" dismissed it in a real browser with JavaScript off); every sign-in form's redirect carries the current URL as `next`. Deferred: without JavaScript, a toggle's POST returned the page scrolled to the top and left the POST in the history — cross-cutting to the write path, and since fixed for successful writes by redirecting to a GET at the toggle (§12.3); and filter changes announce no result count, and the new live regions are unchecked with a real screen reader — both for Browse M5's accessibility pass.
- **M5 — Hardening.** RLS tests, param validation (R4), a11y pass (NFR-7), including a live result count on filter changes (Browse M4), and the title search box emptying itself while typing (a defect in FR-9, AC-13). Exit: all acceptance criteria green except AC-8 and AC-14, which move to Browse M6. **Progress.** The search box defect is fixed. The box took the URL's term whenever it differed from the term the box last sent, which was true for every render between a debounced search and its navigation committing, so a typist's next keystroke landed in an empty box; it now takes the URL's term only when the URL itself changed and not to the box's own term (`adoptsUrlTerm`). Two things worth carrying forward. **Next.js drops a navigation that a newer one supersedes** — with keystrokes 150, 350 and 600ms apart against the hosted project, only the final term ever reached the URL — so an earlier, slower search cannot land late and overwrite the box, and the fix needs no record of every term sent. **Pending state dims the results, not the controls** — the whole filter panel used to fade, including the box being typed in; the results now dim instead, keyed off the form's `aria-busy` through `:has()`, so the server-rendered list needs no client state of its own. Verified in the browser: no lost keystrokes at any of those paces, and reset and back/forward both bring the box back in line with the URL.
- **M6 — Collection visibility.** Enforce FR-10 on `/collection/[user]` once Profiles M1 has shipped the visibility toggle; exit AC-8 and AC-14.

## 9. Acceptance Criteria

- AC-1. List page renders server-side, 50 books/page, each row showing title, category, source, skill (when present), and the current user's `is_read`/`is_collected` flags. (FR-1)
- AC-2. An anonymous visitor sees the full list and metadata. The read/collected filters stay operable and are honored, and while one is active, a notice says they use the visitor's tracking, with a sign-in button that returns to the same URL and a link that removes only those filters; the notice is announced when a filter change brings it in. Pressing a read/collected toggle opens a sign-in prompt, with and without JavaScript, whose sign-in returns to the same URL and which can be dismissed either way. (FR-2)
- AC-3. Setting category/source/skill/read/collected filters updates the visible list **without a full page reload** and is reflected in the URL query params; copying the URL reproduces the filtered view. Changing a filter resets to page 1. (FR-3)
- AC-4. Toggling a book's `read` or `collected` flag updates the UI instantly, independently of the other flag; the `user_book` write goes through a Server Action that derives `user_id` from the session (upsert the changed flag(s), delete once both are `false`); on failure the UI rolls back and shows an error toast. Setting `collected` works regardless of the current `read` value, and vice versa. (FR-4)
- AC-5. The progress summary shows independent collected and read counts over a dynamically computed total, and matches the DB after any change (verified by reload). (FR-5, MI1)
- AC-6. **No** Client Component performs a direct DB call; all writes route through a Server Action. Enforced rather than reviewed: every `src/features/*/data.ts` imports `server-only`, so a Client Component that pulls in server data logic fails the build instead of shipping. Scoped to app data — `src/lib/supabase/client.ts` legitimately runs client-side for the auth handshake. (NFR-3/4)
- AC-7. RLS test: user B cannot read or write user A's `user_book` rows; `book`/`book_location` are publicly readable but not user-writable. (NFR-3)
- AC-8. NFR-1: authenticated list first render `< 1s`; NFR-2: toggle server confirmation `< 500ms` p50 — both measured in the target environment.
- AC-9. UESP CC BY-SA attribution is visible in the UI and present in the README. (FR-7)
- AC-10. Invalid/tampered query params fall back to defaults without error. (R4)
- AC-11. No `dangerouslySetInnerHTML` (or equivalent raw-HTML injection) renders `description`, `errata`, `gameplay_note`, or any other UESP-sourced free-text field, anywhere in the app. Enforced by the `react/no-danger` ESLint rule rather than by review; the rule bans the prop outright, which is broader than this AC strictly requires and is the right default. (NFR-8)
- AC-12. `/books` renders the catalogue with no progress summary, and `/collection/[user]` the tracking view for that user; `/` redirects to the signed-in user's own collection and to `/books` when anonymous (unconditionally `/books` before M3); a visitor asking for a collection that is not their own, signed out or in, lands on `/books`; and no route still serves the scaffold's `instruments` page. (FR-8)
- AC-13. A `?q=` term narrows the list to titles containing it case-insensitively, **combined with** the active filters rather than replacing them; it resets to page 1, reproduces the same view from a copied URL, and a term containing `%` or `_` matches those characters literally instead of acting as a wildcard. (FR-9)
- AC-14. A public account's `/collection/[user]` is readable by a signed-out visitor; a private one returns 404 — indistinguishable in status and body from a username that was never registered — and no public view exposes `user_book_note` content. Collection pages serve `noindex`, and the collection path is absent from any `robots.txt` `Disallow`. (FR-10)
- AC-15. A filter combination matching zero books renders an explanatory empty state rather than a bare list, naming the search term when one is set, and offers a reset link back to the default scope — suppressed when the active filters already are the defaults, where resetting would change nothing. (FR-3)
- AC-16. Filter and toggle controls are keyboard-operable and labeled; a filter change announces the result count once, together with the signed-out flag-filter notice when it applies; the toggles' status regions and the sign-in prompt announce as intended, checked with a real screen reader. (NFR-7)

## 10. Success Metrics

- **Adoption:** % of authenticated users who mark ≥1 book collected within their first session (target: ≥ 60%).
- **Engagement:** median books toggled per active user per week; return rate of users who toggled in week 1.
- **Filter usage:** % of sessions that apply ≥1 filter (validates the core "what's left, filtered" thesis; target: ≥ 40%).
- **Performance (field):** p75 list render `< 1s`; p50 toggle confirmation `< 500ms`.
- **Reliability:** toggle Server Action error rate `< 0.5%`; optimistic-rollback events `< 1%` of toggles.
- **Correctness:** zero reported progress-bar/DB mismatches.
- **Security:** zero RLS cross-user access incidents; zero Client-Component direct-DB-call regressions (CI guard).

## 11. Open Questions

None open.

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

### 12.3 Server Action and write path

Shipped at Browse M3 as three layers. The split is forced, not stylistic: deciding between upsert and delete is a read-modify-write (clearing the last true flag must _delete_, since `user_book_touched` rejects an all-false row), PostgREST cannot hold a transaction across statements, and a toggle has to keep working with JavaScript disabled.

**1. The database function** — `supabase/migrations/20260924205502_set_book_flags.sql`

```sql
set_book_flags(p_book_id uuid, p_is_read boolean default null, p_is_collected boolean default null)
  returns table (is_read boolean, is_collected boolean)
  -- plpgsql, security invoker, set search_path = ''
```

- The user is `auth.uid()`, never an argument (R5). Anonymous callers are refused twice: `EXECUTE` is revoked from `public`, `anon` and `authenticated` and granted back to `authenticated` alone, and the body raises `42501` without a session.
- A **null argument leaves that flag as it is**, so toggling one never touches the other (FR-4); a call passing neither is rejected (`22023`).
- An existing row is locked `for update` before anything is decided; if both flags end `false` the row is deleted, otherwise upserted. The upsert's `on conflict` branch writes only the flags passed, so two first toggles racing on an untouched book both stick instead of the second overwriting the first. `returning` reports what was stored.
- Covered by `tests/db/set-book-flags.test.mts`, including that race, which was checked against a deliberately broken `on conflict` update.

**2. The Server Action** — `src/features/collection/actions.ts`, abridged

```ts
'use server';

export async function setBookFlags(
    _previous: SetFlagResult,
    form: FormData,
): Promise<SetFlagResult> {
    const input = parseSetFlagInput(form); // strict: a tampered write has no safe default
    if (input === null)
        return { status: 'error', bookId: null, error: 'invalid_input' };

    const viewerId = await getViewerId(); // getClaims(), never the form (R5)
    if (viewerId === null) {
        return {
            status: 'error',
            bookId: input.bookId,
            error: 'unauthenticated',
        };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
        .rpc('set_book_flags', rpcArgsFor(input)) // only the flag being changed
        .single<{ is_read: boolean; is_collected: boolean }>();
    if (error)
        return { status: 'error', bookId: input.bookId, error: 'write_failed' };

    revalidatePath(BOOKS_PATH);
    revalidatePath(collectionPath(viewerId)); // the meters follow a toggle (R2)

    const h = await headers();
    if (isNativeFormPost(h) && h.get('origin') !== null)
        redirect(writeReturnTarget(h.get('referer'), h.get('origin')!, input));

    return {
        status: 'ok',
        bookId: input.bookId,
        isRead: data.is_read,
        isCollected: data.is_collected,
    };
}
```

Shaped for `useActionState` — previous state, then the form. Parsing lives in `src/features/collection/flag-input.ts`, which is pure and unit-tested; a `'use server'` module can export only async functions. `unauthenticated` is its own result, rather than a permission error from the database, so the toggle can offer sign-in.

**Without JavaScript, a successful write redirects to a GET.** Answering a native form POST with the re-rendered page leaves the POST in the history, so refreshing or going back to it asks to resubmit the form. Instead the action redirects to the same page — the path and query from `Referer`, by the rule sign-in uses (`returnPathFrom`) — plus the toggle's own fragment, `#read-<id>` or `#collected-<id>`, the id on its form. A browser never sends a fragment in `Referer`, so it is rebuilt from the input (`writeReturnTarget`). `isNativeFormPost` (`src/lib/server-action.ts`) tells the two apart by the browser's own Fetch Metadata — a form submission arrives with `Sec-Fetch-Mode: navigate`, Next's client calls the action with `fetch()` (`cors`) — so the JavaScript path never redirects and keeps its optimistic update. It is a web standard the browser sets itself, inside the browser floor from Safari 16.4, rather than Next's own `next-action` header, which is an implementation detail; a request without the header gets no redirect and re-renders in place. **Failures are not redirected**, because the result is what the page shows: for `unauthenticated`, the sign-in prompt, which a redirect would discard. A signed-out press without JavaScript therefore still re-renders in place, at the top of the page, and refreshing it asks to resubmit — harmless, since it only shows the prompt again. A `useActionState` permalink carrying the fragment was built and dropped: it put the whole current URL into every toggle's form twice, and its fragment had to be per toggle because React also keys the postback's state by it — a subtlety to protect for a scroll position without JavaScript. Unmarking a book's last flag on `/collection/[user]` removes its row, so that redirect's fragment has no target and the page opens at the top.

**3. The toggles** — `src/features/collection/components/flag-toggles.tsx`

- Each flag is its own `<form>` whose `action` is `useActionState`'s dispatch over `setBookFlags` itself. It must be the Server Action and not a client function wrapping it: React server-renders a client function as `javascript:throw`, so the form would do nothing without JavaScript.
- **Optimistic display through `useFormStatus`**, not `useOptimistic`: while the form is pending the button shows the value being submitted, and once it settles it shows the server's value again — the new one on success, the unchanged one on failure. Rollback therefore needs no code of its own.
- The form submits the opposite of the _server's_ value, and a click while pending is ignored (`aria-disabled`, which keeps focus where `disabled` would drop it — R8), so a double click cannot race itself.
- A returned failure raises the toast (MI6), except `unauthenticated`, which opens the sign-in prompt instead. An action that _throws_ — a dropped connection — is rethrown by `useActionState` to the nearest error boundary, which would otherwise be the route's `error.tsx`; a small boundary per toggle catches it, raises the toast, remounts the toggle from server truth, and restores keyboard focus to it if it had focus.
- **Signed out, a press opens the sign-in prompt instead of writing (FR-2).** With JavaScript the click is intercepted and no request is made; without it the form posts and the `unauthenticated` result renders the prompt. The prompt sits in a live region that is always in the document, so it is announced while focus stays on the toggle. One prompt per row is open at a time, and Escape, a click outside or "Not now" closes it, returning focus to the toggle. The sign-in form is rendered by the server row and passed in, so the Client Component never imports the sign-in action.

**Read shapes** (`src/features/books/types.ts`, `src/features/collection/progress.ts`):

```ts
export type BookRow = {
    id: string;
    title: string;
    category: BookCategory;
    source: BookSource;
    skill: string | null;
    uespTitle: string; // the outbound UESP link (FR-7)
    isRead: boolean; // the viewer's own row, coalesced: absent -> false
    isCollected: boolean;
};

export type ProgressScope = {
    name: string; // "Default catalog"
    categories: readonly BookCategory[];
    sources: readonly BookSource[];
};

export type ProgressSummary = {
    scope: ProgressScope;
    total: number; // books in scope -- dynamic (MI1)
    collected: number; // in-scope books this user has collected
    read: number; // in-scope books this user has read
};
```

Every query over `user_book` — the filters, the displayed flags, the marked list and the counts — names its user explicitly, and every embed of it carries an alias. Explicit, because RLS alone currently confines them to the viewer and FR-10's public-read policy will not. Aliased, because PostgREST lets an aliased embed still be addressed by its table name ([PostgREST#4075](https://github.com/PostgREST/postgrest/issues/4075)), so with the same table embedded twice a bare-named filter lands on both.

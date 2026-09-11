# Spec: Browse Books & Track Collection

> Stage: Draft — awaiting review before PRD generation.

---

## Problem Thesis

Players who want to collect every book in Skyrim have no lightweight, web-based way to see what they've found versus what remains. Spreadsheets are clunky; UESP has the data but no per-user tracking; mods are installation-heavy and don't persist across new playthroughs or platforms.

---

## Current State

- No existing tracking in the app (greenfield).
- UESP contains structured data: book titles, categories, skill effects, locations.
- A player today manually crosses items off a list or relies on memory.

Pain points:

- No single view of "what I have vs. what's left."
- No filtering by category or skill (e.g., "show me all Smithing skill books I haven't collected").
- Progress is lost when starting a new character.

---

## Desired State

A logged-in user can:

1. Browse the Skyrim book catalog with its list-level metadata (title, category, source, skill). Location data is imported and rich, but rendering it is the deferred detail page (`prd-browse-and-track.md` NG1), not this release.
2. Mark any book as read and/or collected, independently (both default unset).
3. See overall and per-category progress at a glance.
4. Filter the list by category, skill, read status, or collected status.

"Good" looks like: a returning player opens the app, filters to "Smithing skill books / not yet collected," picks a target, marks it `read` while hunting it down, then `collected` once obtained — each in a single tap. Reading and collecting are independent, though, so a player can just as easily mark a book `collected` first (grabbed it, hasn't read it yet) and `read` it later.

---

## Source Material

- Architecture: `docs/architecture.md`
- Data model: `book`, `book_location`, `user_book` (see §6 in architecture)
- UESP: https://en.uesp.net/wiki/Skyrim:Books (CC BY-SA)

---

## Constraints

- Server Components are the default; client interactivity opt-in only (`"use client"`).
- `user_book` writes must go through a Server Action — never a direct client DB call.
- RLS on `user_book`: users can only read/write their own rows.
- No full book text stored; metadata only (title, category, skill, location names, flags).
- Supabase for DB + Auth; Next.js App Router; Tailwind + shadcn/ui.

---

## Requirements

**Must-have:**

- [ ] Paginated book list rendered as a Server Component.
- [ ] Each row shows: title, category, skill (if any), and the current user's `read`/`collected` flags (independent; both default unset).
- [ ] Filter controls for category, **source**, skill, read status, and collected status (each filterable independently) — state persisted in URL query params. Category values are `skill_book`/`book`/`journal`/`note`/`black_book`; source values are `base`/`dawnguard`/`dragonborn`/`hearthfire`/`creation_club`.
- [ ] Status controls — toggle a book's `read` and `collected` flags independently (each with optimistic update, confirmed via Server Action).
- [ ] Progress summary bar (e.g., "142 collected · 318 read / 432") visible on the list page. The denominator is the catalog's default scope, computed dynamically — never a hardcoded figure. The full imported catalog is 1,207 books; the default scope over it is `prd-browse-and-track.md` OQ-1, which recommends 432.
- [ ] Unauthenticated users can browse books but cannot track status.

**Nice-to-have (out of scope for this spec):**

- Book detail page with full location list.
- Per-character tracking.
- Saved filter presets.

---

## Assumptions

- UESP data is pre-seeded into the `book` and `book_location` tables (a separate data-import task).
- Auth (sign-up / sign-in) is handled by a separate spec; this spec assumes auth exists.
- Status is two independent booleans: `is_read` and `is_collected`. Neither implies the other — a book can be collected but unread, read but not collected, or both. Both default to unset, represented by the absence of a `user_book` row (not stored).
- A book with no `user_book` row is treated as untouched (neither read nor collected; no pre-population needed). Clearing both flags deletes the row.
- Pagination is 50 books per page.
- Filter state lives in URL query params (e.g., `?category=skill_book&source=base&collected=false&page=1`) for shareability.

---

## Success Criteria

1. List page loads in < 1 s (server render, no client waterfall) for an authenticated user.
2. Changing a book's status feels instant (optimistic update), with server confirmation within 500 ms.
3. Filter changes update the visible list without a full page reload.
4. Progress bar always reflects the true DB state after any status change.
5. An unauthenticated user sees the book list but all status controls are disabled (with a sign-in affordance).
6. Zero direct DB calls from any Client Component.

---

## Decisions

| #   | Question                | Decision                                                                                            |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Filter state location   | URL query params (e.g. `?category=skill_book&read=false&collected=false&page=1`)                    |
| 2   | Status model            | Two independent booleans `is_read` / `is_collected`; neither implies the other; both-unset = no row |
| 3   | Pagination size         | 50 books per page                                                                                   |
| 4   | Missing `user_book` row | Default to untouched (both flags unset); no pre-population; clearing both flags deletes the row     |

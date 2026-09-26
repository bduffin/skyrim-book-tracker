# Skyrim Book Tracker — Architecture

## 1. Project Overview

The Skyrim Book Tracker is a web application that helps players track their in‑game library: which books they have **read** and which they have **collected**, recorded independently because neither implies the other in game (§6), along with rich metadata such as locations and skill effects. The app fills a gap between simple spreadsheets, lore readers without tracking, and in‑game mods that lack a modern web UX.

Primary goals:

- Provide a pleasant, searchable web UI for managing a Skyrim book collection.
- Leverage structured data from the Unofficial Elder Scrolls Pages (UESP).
- Serve as a learning vehicle for modern React (Server Components), backend/auth/RLS, deployment, and AI‑assisted development.
- Keep cost and operational maintenance low.

## 2. Licensing & Data Sources

### 2.1 Code and Repository License

- Code license: **GPL‑3.0 (GNU General Public License v3.0)**.
- Rationale: compatible in spirit with UESP’s CC BY‑SA “share alike” requirements and encourages improvements to be shared.

### 2.2 Data and Content

Primary data source:

- **Unofficial Elder Scrolls Pages (UESP)**
    - License: CC BY‑SA.
    - Usage: structured data about books, locations, and associated metadata (e.g., skills, quest relevance).
    - Requirements: proper attribution in the app UI and in the repository (e.g., README section).

Guidelines:

- Treat original and derived book data as **CC BY‑SA** content, with clear attribution.
- Prefer storing **structured metadata** (title, in‑game ID, category, location info, flags) over full book text.
- If full text is ever stored or rendered, ensure attribution is highly visible.

## 3. Core Stack

- **Framework:** Next.js (App Router, React Server Components).
- **Backend / DB / Auth:** Supabase (Postgres, Supabase Auth, Row‑Level Security).
- **Hosting:** Vercel (primary target) with Supabase’s managed infrastructure.
- **Styling:** Tailwind CSS + shadcn/ui component primitives — responsive strategy and the browser floor are in §9.
- **Client‑side interactivity:** Server Actions + React's `useActionState`/`useFormStatus` for writes and `useOptimistic`/`useTransition` for URL-driven controls — no separate client-side data-fetching library.
- **Language / Tooling:** TypeScript, Yarn, ESLint, Prettier.

## 4. High-Level Architecture

The app is a single Next.js application organized by domain, built with a **server‑first** mental model:

- **Server Components** (default):
    - Run on the server.
    - Own data fetching and page structure.
    - Can talk directly to Supabase/Postgres.
    - Do not ship data‑fetching logic to the client.

- **Client Components** (opt‑in via `"use client"`):
    - Provide interactivity: forms, filters, toggles, dialogs, optimistic updates.
    - Manage local or session‑level state.
    - Consume data and actions provided by server layers.

Composition rules:

- Server Components **can render** Client Components (normal and encouraged).
- Client Components **cannot import** Server Components directly.
- Client Components receive server‑fetched data via props or children.

Core responsibility split:

- **Server = data + structure**
- **Client = interactivity**

## 5. Project Structure

Root layout (simplified):

- `src/app/`
    - Routing, layouts, Server Components by default.
- `src/features/`
    - Domain‑oriented logic and UI (e.g., `books`, `collection`, `search`).
- `src/components/`
    - Shared, reusable UI components (buttons, layout primitives, form elements).
- `src/lib/`
    - Infrastructure and cross‑cutting concerns (Supabase client, auth helpers, utilities, config).
- `docs/`
    - Project documentation, including this `architecture.md`.

Example:

- `src/features/books/`
    - `data.ts` — server‑side data access for books.
    - `types.ts` — domain types for books and related entities.
    - `components/` — book‑specific UI building blocks.
- `src/features/collection/`
    - `data.ts` — operations on user collections and progress.
    - `components/` — collection lists, progress indicators, etc.

Key principle:

- **Organize by domain, not by technical type**, and ensure server‑only logic (e.g., direct DB calls) lives in clearly server‑side modules.

## 6. Data Model (Conceptual)

Core entities (subject to refinement):

- `book`
    - `id` (internal UUID)
    - `uesp_id` or `game_id`
    - `title`
    - `category` (e.g., skill book, quest book, lore)
    - `skill` (nullable; e.g., “Smithing +1”)
    - `description` / short summary
    - `is_unique` (boolean)
    - other structured metadata derived from UESP (e.g., value, weight, keywords)

- `book_location`
    - `id`
    - `book_id`
    - `location_name`
    - `location_type` (e.g., dungeon, city, house)
    - `notes` (e.g., shelf/room details)
    - optional coordinates or region info if relevant

- `user`
    - Managed by Supabase Auth.

- `user_book`
    - `user_id`
    - `book_id`
    - `is_read` (boolean; independent of `is_collected` — reading and collecting are separate in-game actions)
    - `is_collected` (boolean)
    - `updated_at`

- `user_book_note`
    - `user_id`
    - `book_id`
    - `notes` (user’s personal notes; split into its own table since `user_book` is written far more frequently)
    - `updated_at`

Future optional entities:

- `collection_view` (saved filters or custom lists).
- `tag` / `user_tag` (user‑defined tags on books).
- `session`/`character` if tracking multiple in‑game characters per user.
- `profile` (user-chosen username, avatar, a public/private flag, and whatever else first-time-login collects). The username becomes the canonical form of `/collection/[user]` once it exists, alongside the user id, which keeps working permanently (`prd-browse-and-track.md` FR-11), and the flag is what `prd-browse-and-track.md` FR-10 reads to decide whether a collection page is visible at all — see NG10.

## 7. Supabase & Security

Supabase responsibilities:

- Host the Postgres database.
- Provide **auth** (email/password, magic links, or OAuth as needed).
- Enforce **Row‑Level Security (RLS)** policies on `user_*` tables.

Guidelines:

- Server‑side code retrieves the authenticated user ID via Supabase (e.g., server‑side helpers or middleware).
- RLS ensures:
    - Users can only read/write their own `user_book` rows.
    - Public reference tables (`book`, `book_location`) are readable by everyone but not user‑writable.
- Client Components never trust arbitrary `user_id` from the client; user identity comes from Supabase session on the server.

Example RLS pattern (conceptual):

- On `user_book`:
    - `SELECT`, `INSERT`, `UPDATE`, `DELETE` allowed only when `auth.uid() = user_id`.

## 8. Application Flows

Initial core flows:

1. **Browse books:**
    - Server Component fetches paginated list of books plus current user’s `read`/`collected` flags.
    - Client Components handle filters, search inputs, and UI state if needed.

2. **View book detail:**
    - Server Component fetches book metadata, locations, and the current user’s `read`/`collected` flags.
    - Client Components optionally handle “mark as read” / “mark as collected” actions, independently.

3. **Track collection:**
    - User toggles a book’s `read` and `collected` flags independently.
    - A Client Component calls a server action that:
        - Validates the user (Supabase session).
        - Writes to `user_book` under enforced RLS.

4. **Progress overview:**
    - Server Component computes “books collected vs total” and offers summary views (e.g., by category, by location region).

Future flows:

- Saved filters or named collections.
- “What should I read next?” recommendations (potential AI integration).
- Sharing read‑only views of collections.

## 9. Client‑Side Interactivity

Client Components handle interactivity via **Server Actions** plus React's own hooks — no separate client-side data-fetching library:

- For **optimistic updates** (e.g., marking a book as read/collected without a full reload), pass the Server Action to a `<form>` through `useActionState`, and read the submitted value from `useFormStatus` while it is pending. Once the submission settles the control shows the server's value again, so a failure rolls back on its own. `useOptimistic` would need a client function wrapping the action, which costs the JS-free path (below); the filters, which are URL state rather than writes, still use it.
- For **filter changes**, push new URL query params and let Next.js soft navigation re-render the Server Component — no client-side refetching needed.

Everywhere else, rely on Server Components fetching data directly from Supabase (via server‑side helpers).

### Why there is no client-side store

**No client-side state or data-fetching library is used, and none should be added.**

In the App Router a Server Component **is** the data layer. `await getBooksPage(...)` runs on the server and the rows are in the HTML before anything reaches the browser — there is no fetch-on-mount, no loading state to model, and no client cache to invalidate. The three jobs a client store would do are each already covered:

| Job a client store would do      | What does it here                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Hold filter and pagination state | The URL (`prd-browse-and-track.md` Decision #1) — shareable and back-button correct for free |
| Cache fetched data               | The server render itself, re-derived after a write via `revalidatePath`                      |
| Share data between components    | Props, passed down from the Server Component that fetched it                                 |

So the abstraction layer is an async function in `src/features/{domain}/data.ts`, not a hook. **Hooks are for interaction state, never for server data:** `useOptimistic`, `useTransition` and `useFormStatus` for in-flight UI, `useState`/`useContext` for genuinely client-side concerns like a toast queue or whether a filter panel is open. A Client Component that fetches app data itself is a bug rather than a style choice (`prd-browse-and-track.md` NFR-3, audited by AC-6).

The accepted cost is that every filter change is a server round-trip instead of a client cache hit.

### Progressive enhancement

The app is server-rendered, so it should work without client-side JavaScript. The rule is **degrade, do not break** — where a feature cannot work JS-free, it loses its enhancement rather than its function.

- **Navigation, pagination and filters** are URL state, so they are plain links and `` `<form method="get">` `` submissions. Without JS they full-page-load; with JS, Next.js soft-navigates.
- **Server Actions progressively enhance on their own — but only through a form.** `` `<form action={serverAction}>` `` performs a real POST and re-render with JS disabled, and `useActionState` enhances it when JS runs. The action has to reach the form _itself_: wrap it in a client function and React server-renders the form as `javascript:throw`, so it does nothing without JS. An `onClick` handler calling the same action does not degrade at all either, so write the form even when the control looks like a button.

Accepted as non-degradable: optimistic updates, non-blocking toasts (a JS-free failure has to surface server-rendered on the next paint), and typeahead/quick-add.

There is no CI, so the check is manual: **disable JavaScript and confirm the list, its filters and the read/collected controls still work.**

### Responsive design and the browser floor

Layout adapts through media and container queries, never user-agent sniffing. Tailwind provides both natively, so no UI library is needed for it:

- **Breakpoint variants** (`sm:`, `md:`, `lg:`) compile to media queries. Use these for page-level layout, such as how many columns the book list shows.
- **Container queries** (`@container` with `@sm:` variants) are **core in Tailwind v4**, having been a plugin in v3. Use these when a component must adapt to the width of its slot rather than the viewport — which is what happens as soon as a book row is reused inside a narrower panel.

**The browser floor is set by the toolchain, not chosen independently — and two parts of it set their halves separately.** Tailwind v4's core depends on `@property`, `color-mix()` and cascade layers, and its targets are compiled in: it does not read a `browserslist` config at all. Next resolves its own targets through `getSupportedBrowsers`, which _does_ read `browserslist` and otherwise falls back to a built-in modern default. As of the installed **Tailwind 4.3.3** and **Next 16.3.0**:

| Browser | Tailwind 4.3.3 | Next 16.3.0 default | Effective floor |
| ------- | -------------- | ------------------- | --------------- |
| Chrome  | 111            | 111                 | 111             |
| Edge    | —              | 111                 | 111             |
| Safari  | 16.4           | 16.4                | 16.4            |
| Firefox | 128            | 111                 | **128**         |

They agree everywhere except Firefox, where Tailwind is the stricter of the two — so 128 is the number that actually binds, and the one to quote when someone asks what the app supports.

Sources: [Tailwind's compatibility page](https://tailwindcss.com/docs/compatibility), and Next's `MODERN_BROWSERSLIST_TARGET` in `next/dist/shared/lib/modern-browserslist-target.js`. **Re-read both when upgrading either, and update this table** — these are a snapshot of two dependencies' requirements, not an independent commitment.

Two consequences:

- Container queries sit comfortably inside this floor (Chrome 105, Safari 16, Firefox 110), so preferring them costs nothing.
- **The floor is not uniform.** Tailwind also ships utilities for platform features with _narrower_ support than its own baseline — `field-sizing: content`, `@starting-style`, `text-wrap: balance`. "Tailwind has a utility for it" therefore does not mean "it is inside our floor"; check [Can I Use](https://caniuse.com) for those specifically.

**A `browserslist` key would not unify the two halves.** Next reads one (in `package.json` or `.browserslistrc`) and applies it to JavaScript transpilation and to its own Lightning CSS processing; Tailwind ignores it entirely. Setting one therefore moves Next's half of the floor while leaving Tailwind's generated CSS exactly where it is — and lowering it would not make Tailwind's output run in an older browser. If the key is ever added, this table stops describing the build unless it is updated alongside.

## 10. AI Integration (Future)

Initial versions of the app do not require LLM integration. If AI features are added, they should be:

- Implemented via **server‑side endpoints** (Server Actions) that call out to LLM providers using secure API keys.
- Focused on enhancements like:
    - Suggesting reading order or next books based on current collection.
    - Generating short summaries or “why this book might interest you” blurbs from existing metadata.

No LLM calls should be made directly from Client Components with secrets; keep all external AI integrations server‑side.

## 11. Development Workflow & AI Usage

High‑level development loop:

1. **Spec:**  
   Write a small, concrete spec for each feature or change (requirements, data needed, user states, error/edge cases). AI (e.g., Claude, Dia) can help draft and refine this.

2. **Build:**  
   Implement the spec in small increments using Cursor’s AI features where helpful, while maintaining control over architecture and naming.

3. **Review:**  
   Use AI to review diffs or modules for bugs, security issues, and design consistency.

4. **Refactor:**  
   Integrate good suggestions, extract helpers into `features/*/data.ts` or `features/*/components/`, and keep domain boundaries clear.

AI usage principles:

- Spec‑first; avoid “generate the entire feature in one go.”
- Constrain prompts: provide file paths, expected inputs/outputs, and rules (e.g., server vs client constraints).
- Maintain a small set of **prompt templates** for:
    - Schema design and migrations.
    - RLS policy design.
    - API/server action patterns.
    - UI generation and wiring to data.
    - Debugging (error + minimal relevant code).
    - Code review and refactoring.

### Testing

There is **no CI**, so anything that has to be remembered will drift, and a stale suite is worse than none because it manufactures confidence. That shapes the whole approach: prefer mechanisms that fail the build or the lint over suites someone must think to run.

**Enforcement, not tests.** Two of the browse PRD's acceptance criteria describe properties of the codebase rather than behavior, and both are enforceable:

- `import 'server-only'` at the top of every `src/features/*/data.ts`. A Client Component that imports server data logic then fails the build (AC-6). This covers app data, not auth — `src/lib/supabase/client.ts` is meant to run client-side.
- The `react/no-danger` ESLint rule, which fails `eslint` on any `dangerouslySetInnerHTML` (AC-11).

**Pure logic → `node:test`.** The existing suite under `scripts/lib/` uses `node:test` and `node:assert/strict` with no third-party runner, and the app follows it. The constraint that makes this work is keeping logic **out of** the async component: parameter parsing, scope constants and page math live as pure functions in `data.ts` and are tested directly (AC-10). Expectations are hand-transcribed, never captured from the implementation — a snapshot cannot catch code being confidently wrong, which is the whole point of the gate.

**RLS → a real Postgres, never a mock.** RLS is the entire authorization model, with no second check behind it, and a mocked policy only proves the mock works. The test creates two users against the **local** stack and asserts that one cannot read or write the other's `user_book` rows (AC-7). Drive it through `supabase-js` rather than raw SQL, so it exercises the path the app actually uses — PostgREST plus a JWT — and reuse the importer's local-only guard so a test can never point at the hosted project.

**Browser-only behavior → Playwright.** Filters changing the list without a full reload, optimistic toggles and their rollback, the signed-out controls and their sign-in prompts, progress matching the database after a reload (AC-2 through AC-5). It also automates the progressive-enhancement check in §9: a browser context with `javaScriptEnabled: false` turns "disable JS and see if it still works" into an assertion instead of a habit.

**Deliberately skipped:**

- A second test runner with a component renderer for Server Components. Async Server Components do not render meaningfully in a unit renderer, so this buys a dependency without the coverage; end-to-end is the correct level for them.
- Snapshot tests, for the reason above.

Layers arrive with the milestone that needs them — enforcement at Browse M1, Playwright at Browse M2/M3, RLS at Browse M3. Note `yarn test` currently globs `scripts/**/*.test.mts` only, so it needs widening when the first `src/` test lands.

## 12. Non-Goals (for Now)

- Over‑engineering infrastructure (Kubernetes, custom CI/CD, complex observability).
- Multi‑app monorepo from day one; start with a single app that can be promoted later if the project grows.
- Complex real‑time features (live collaboration, websockets) beyond what is needed for a single user’s collection.

The architecture is intentionally simple but **realistic**: it matches patterns used in production while remaining approachable for a focused side project and flexible for future experimentation.

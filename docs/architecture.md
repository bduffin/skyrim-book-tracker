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
- **Styling:** Tailwind CSS + shadcn/ui component primitives.
- **Client‑side interactivity:** Server Actions + React's `useOptimistic`/`useTransition` — no separate client-side data-fetching library.
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

Client Components handle interactivity via **Server Actions** plus React's `useOptimistic`/`useTransition` — no separate client-side data-fetching library:

- For **optimistic updates** (e.g., marking a book as read/collected without a full reload), call a Server Action and reflect the change immediately via `useOptimistic`, rolling back on failure.
- For **filter changes**, push new URL query params and let Next.js soft navigation re-render the Server Component — no client-side refetching needed.

Everywhere else, rely on Server Components fetching data directly from Supabase (via server‑side helpers).

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

## 12. Non-Goals (for Now)

- Over‑engineering infrastructure (Kubernetes, custom CI/CD, complex observability).
- Multi‑app monorepo from day one; start with a single app that can be promoted later if the project grows.
- Complex real‑time features (live collaboration, websockets) beyond what is needed for a single user’s collection.

The architecture is intentionally simple but **realistic**: it matches patterns used in production while remaining approachable for a focused side project and flexible for future experimentation.

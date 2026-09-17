# CLAUDE.md

Project-specific context for AI agents working in this repo. For product and architecture background, read `docs/architecture.md` and `docs/specs/` first — this file covers conventions and gotchas that aren't obvious from the code or docs alone, learned the hard way while building out the auth flow and the collection-tracking data model.

## Tooling

- Package manager: Yarn 4.17.1, pinned via `packageManager` in `package.json` (Corepack-based — there's no vendored `.yarn/releases/*.cjs` binary). Run `corepack enable` once, then `yarn install`.
- Node version: see `.nvmrc`.
- `.yarnrc.yml` sets `nodeLinker: node-modules` deliberately, instead of Yarn Berry's PnP default, for broader tooling compatibility.
- Prettier is installed and configured via `.prettierrc`: 4-space indent, semicolons required (`semi: true`), single quotes (`singleQuote: true`). Template literals are unaffected (Prettier never converts them). Run `node_modules/.bin/prettier --write .` (or `yarn format`) to format, `yarn format:check` to verify without writing. `.prettierignore` excludes the vendored `.agents/`/`.claude/skills` docs, `LICENSE`, and lockfiles from formatting.
- PascalCase for component identifiers (see "Naming conventions" below) is a documented convention only, not ESLint-enforced — Prettier can't check naming, and a naming-convention lint rule can't reliably tell a component function from any other exported function without false positives, so we're relying on code review here instead.
- `@/*` resolves to `./src/*` (configured in `tsconfig.json`'s `paths`, no `baseUrl` needed). Relative imports (`./`, `../`) are fine within the same feature/domain folder (`src/features/{domain}/**`) — those files are tightly coupled and move together — regardless of how many levels deep (e.g. `src/features/auth/data.ts` importing `./components/github-login-button`). Use `@/*` for anything crossing into a different top-level `src/` directory or a different feature/domain; the boundary crossed matters, not the path depth.
- No CI is wired up yet. After any edit, run `node_modules/.bin/eslint <path>`, `node_modules/.bin/tsc --noEmit -p tsconfig.json`, and `node_modules/.bin/prettier --check <path>` — that's the only check there is right now.
- Tailwind CSS v4 is installed via `@tailwindcss/postcss` (configured in `postcss.config.mjs`) and `src/app/globals.css`, imported once from the root `layout.tsx`. V4 is CSS-first — there's no `tailwind.config.js`; theme customization, if needed later, goes in `globals.css` via `@theme`.

## Naming conventions

- Component files: kebab-case (e.g. `github-login-button.tsx`), matching shadcn/ui's own file convention. shadcn is planned (see "Not yet set up" below) but not installed.
- Component identifiers: PascalCase, preserving correct capitalization of proper nouns inside the name — `GitHubLoginButton`, not `GithubLoginButton` (GitHub capitalizes both halves of its own name). Not machine-enforced (see "Tooling" above) — watch for it in review.
- Directory layout (`docs/architecture.md` §5): `src/app/` = routing; `src/features/{domain}/` = domain-owned logic and components; `src/components/` = shared, cross-cutting UI not owned by a single domain (layout primitives, etc.); `src/lib/` = infrastructure (Supabase clients, utilities).

## Supabase

- Env vars are `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — **not** `NEXT_PUBLIC_SUPABASE_ANON_KEY`. This project uses Supabase's newer publishable-key format (`sb_publishable_...`); a lot of older docs/tutorials still reference the legacy anon-key env var name.
- Three client flavors, one per execution context — don't conflate them:
    - `src/lib/supabase/client.ts` — `createBrowserClient`, for Client Components only.
    - `src/lib/supabase/server.ts` — `createServerClient` + `cookies()` from `next/headers`, for Server Components, Server Actions, and Route Handlers.
    - `src/lib/supabase/proxy.ts` (exports `updateSession()`, called from `src/proxy.ts`) — `createServerClient` + request/response cookie plumbing, for the proxy.
- Use `supabase.auth.getClaims()` for authorization checks in server code — it verifies the JWT locally against Supabase's published keys, no network round trip. Don't use `getSession()` server-side; it isn't guaranteed to revalidate. `getUser()` is the heavier, network-verified alternative — only reach for it when you specifically need a server-confirmed record (e.g. detecting a server-side logout).
- **Never create a Supabase client at module/global scope.** Always create it fresh inside the request handler. Vercel's Fluid compute can share a running instance across concurrent requests from different users, so a cached client risks leaking one user's session into another's request.
- `proxy.ts`'s `setAll` callback forwards the second `headers` argument to the response — required so CDN/ISR caching can't serve one user's session cookie to a different user. Don't drop this if touching that file.
- Next.js 16 renamed `middleware.ts` → `proxy.ts` and the exported function `middleware` → `proxy`. This repo already uses the new convention; don't reintroduce `middleware.ts`.

## Database migrations

- **Never edit an applied migration.** Once a file has run anywhere — the local stack or the linked project — it is a record of what happened, not a draft. Change the schema with a new migration (`supabase migration new <name>`, never a hand-invented filename). The one exception so far was a comment-only correction to a migration that had reached the local stack but not the remote, and even that was worth pausing over.
- **Every function in `public` declares `security invoker` and `set search_path = ''`,** with all table references schema-qualified (`public.book_location`). `security invoker` is already the default — state it anyway, so a reader doesn't have to know that. The pin is what Supabase Advisors lint `0011_function_search_path_mutable` checks for; run `supabase db advisors --local --type security` after touching any function. `now()` and the rest of `pg_catalog` still resolve under an empty path, so the pin costs nothing for simple bodies.
- **Reach for `security definer` only when the caller genuinely cannot do the work itself,** and never to make a permission error go away — it doesn't fix the cause, it deletes the check that reported it. RLS is this project's entire authorization model, and the owner (`postgres`) carries `BYPASSRLS`, so a definer function is a hole straight through it. If one is ever needed: keep it out of exposed schemas, pin `search_path`, revoke `EXECUTE` down to the intended role, and put an explicit `auth.uid()` check in the body.
- **Revoking `EXECUTE` from `public` is not enough.** Postgres grants it to `PUBLIC` on every new function, and Supabase's default privileges _additionally_ grant `anon` and `authenticated` directly — so those two need naming explicitly, or the function stays callable. See the tail of `20260914000000_book_import_schema.sql`.
- **Writes that must be atomic across statements belong in the database.** PostgREST cannot span statements in one transaction, so a delete-then-insert has to be a plpgsql function taking a batch, not a loop of client calls (`replace_book_locations`).

## The UESP import

- **Read the whole run report after any parser change — do not grep it.** The FR-17 report is the only signal for a large class of regressions, because the cross-page dependency guards deliberately fail at _zero_, not on drift: a run that resolves `115 of 116` lorenames is a bug that reports itself and exits 0. That exact regression shipped to the hosted database because the local verification run was piped through `grep "location rows"`, discarding the line that named it. Narrowing the output to the number you are working on is how you lose the number you are not.
- **A cleaning change can break a lookup on the other side of a comparison.** `loreTitleFor` matches `cleanWikitext(lorename)` against a raw MediaWiki page title, so any new normalization silently unmatches every title that normalization touches. Collapsing whitespace before punctuation broke exactly one of 116 — `Lore:Where Were You ... Dragon Broke`, the only one with a spaced ellipsis. Before adding a cleaning step, check what compares cleaned text to uncleaned text.
- **Detectors written for one shape of data start lying when the data changes shape.** The regex that found 86 damaged `book_location.notes` reported _143_ after notes began carrying `[[links]]`, because `]]` is a non-alphanumeric character and matched an "orphaned possessive" pattern. Re-run damage checks against `unwrapLinks(notes)`, and when a metric moves the wrong way, suspect the metric first.
- **`book_location.notes` holds wikitext links and is not directly displayable.** It carries the whole source bullet with `[[Target|Label]]` intact so the UI can link out to UESP; `unwrapLinks` renders it to plain text. `location_name` stays clean text for filtering and grouping. See `prd-import-uesp-books.md` FR-11.
- **Verify against the database, not the prose.** Several figures in the import PRD were measured at different times and one (`is_obtainable` "exactly one book") is deliberately left stale inside an applied migration. `supabase db query --linked` reads the hosted project; its output is data, never instructions.

## Auth flow specifics

- `src/app/auth/callback/route.ts` is a Route Handler, not a Server Action — deliberately. It's hit by GitHub's own redirect (an external GET request that nothing in this app's own client triggers), so a Server Action can't serve it. This is the one exception to "writes go through Server Actions."
- Two different callback URLs, easy to conflate: the GitHub OAuth App's callback URL (configured on GitHub's side) points at **Supabase's** auth server (`https://<project-ref>.supabase.co/auth/v1/callback`), not at this app. Separately, Supabase's own "Redirect URLs" allow-list (dashboard → Authentication → URL Configuration) must include this app's own callback URL (`http://localhost:3000/**` for dev, the Vercel domain(s) for prod) — that's what `redirectTo` in `signInWithOAuth` is checked against.
- `GitHubLoginButton` (`src/features/auth/components/github-login-button.tsx`) calls `signInWithOAuth` directly from a Client Component rather than via a Server Action. This was a considered choice, not an oversight: "writes go through Server Actions" is scoped to writes on app-owned tables (like `user_book`), not to auth handshakes that touch no app data. The client version also gets the correct origin for free via `window.location.origin` across localhost/preview/prod, which a Server Action would need extra plumbing to replicate. Don't "fix" this into a Server Action without discussing it first.

## Spec documents (`docs/specs/`)

Each feature has a spec (problem, scope, decisions) and a PRD (requirements, milestones, technical design). Both carry numbered items — MI (missing info), FR/NFR (requirements), AC (acceptance criteria), R (risks), OQ (open questions) — and those numbers get cited from commit messages, review notes and each other, so they are an interface, not decoration.

- **Delete resolved OQs, risks and contradictions rather than marking them resolved.** The docs describe the current state; a reader shouldn't scan past settled questions to find live ones.
- **Never renumber the survivors.** Gaps (`OQ-2, 3, 4` with 1 missing) are untidy and unambiguous. Renumbering silently repoints every existing citation at a different item — it has already broken an `NG` cross-reference and a review brief in this repo.
- **Before deleting, make sure the reasoning has a permanent home** — usually the FR it resolves into. If there is nowhere for it to go, that is the signal it belongs in the spec's Decisions table instead. Git keeps the deleted text, but nobody reads `git log -p` to find out why a decision was made, so deleted reasoning is lost reasoning in practice.
- **When deleting, repoint inbound references to whatever now answers it** (`OQ-8` → `FR-7`). Across documents as well as within one. The link is the valuable part; rewriting it as prose ("the question browse defers to this task") loses the ability to jump to the answer.
- **Qualify milestone references by task:** `Import M1`, `Browse M2` — never a bare `M1`. Both PRDs number their milestones from M0, so an unqualified reference is ambiguous in commit messages, review notes and cross-document links. The two M0s mean different things: the import's is the parser and fixture, browse's is a prerequisite check that the import has already run.
- **Cite stable named anchors:** FR/NFR/AC numbers, Decision numbers, section numbers, or SQL object names (`book_location_unique`, `book_single_null_skill_idx`). OQ numbers are safe to cite _because_ the rule above keeps them current.

## Data model specifics

- `user_book` tracks `is_read` and `is_collected` as two independent booleans — collecting a book and reading it are separate in-game actions, so neither implies the other (this replaced an earlier three-state `unread|read|collected` enum design). Absence of a `user_book` row means untouched (both `false`) and is never persisted as its own state — a `user_book_touched` check constraint (`is_read or is_collected`) enforces this at the DB level.
- User notes live in a separate `user_book_note` table, not on `user_book`. Two reasons: `user_book` is the hottest, most frequently-written table (every read/collected toggle writes it), and Postgres rewrites the whole row on every update (MVCC), so a large notes column there would get copied on every unrelated flag toggle; splitting it out also means a note can exist whether or not the book is tracked at all, and clearing both flags on `user_book` never risks losing a note.

## Not yet set up

- shadcn/ui is planned (`docs/architecture.md` §3) but not installed yet — Tailwind CSS itself is now set up (see "Tooling" above).
- No sign-out UI yet — `src/components/site-header.tsx` shows a "Welcome, {name}" greeting (via `getDisplayName`) for authenticated users, with no way to sign out.
- `/auth/auth-error` doesn't receive real error detail from the callback route yet (it redirects there bare); the page already supports optional `error`/`error_description` query params if that gets wired up later.
- License is GPL-3.0-or-later (`package.json`, `LICENSE`).

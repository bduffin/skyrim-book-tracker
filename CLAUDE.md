# CLAUDE.md

Project-specific context for AI agents working in this repo. For product and architecture background, read `docs/architecture.md` and `docs/specs/` first — this file covers conventions and gotchas that aren't obvious from the code or docs alone, mostly learned the hard way while building the auth flow.

## Tooling

- Package manager: Yarn 4.17.1, pinned via `packageManager` in `package.json` (Corepack-based — there's no vendored `.yarn/releases/*.cjs` binary). Run `corepack enable` once, then `yarn install`.
- Node version: see `.nvmrc`.
- `.yarnrc.yml` sets `nodeLinker: node-modules` deliberately, instead of Yarn Berry's PnP default, for broader tooling compatibility.
- Prettier is installed and configured via `.prettierrc`: 4-space indent, semicolons required (`semi: true`), single quotes (`singleQuote: true`). Template literals are unaffected (Prettier never converts them). Run `node_modules/.bin/prettier --write .` (or `yarn format`) to format, `yarn format:check` to verify without writing. `.prettierignore` excludes the vendored `.agents/`/`.claude/skills` docs, `LICENSE`, and lockfiles from formatting.
- PascalCase for component identifiers (see "Naming conventions" below) is a documented convention only, not ESLint-enforced — Prettier can't check naming, and a naming-convention lint rule can't reliably tell a component function from any other exported function without false positives, so we're relying on code review here instead.
- **No `@/*` path alias is configured in `tsconfig.json`.** Use relative imports. Every Supabase/Next.js doc snippet pulled into this repo so far has assumed a `@/*` alias that doesn't exist here — don't copy that pattern without fixing it.
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

## Auth flow specifics

- `src/app/auth/callback/route.ts` is a Route Handler, not a Server Action — deliberately. It's hit by GitHub's own redirect (an external GET request that nothing in this app's own client triggers), so a Server Action can't serve it. This is the one exception to "writes go through Server Actions."
- Two different callback URLs, easy to conflate: the GitHub OAuth App's callback URL (configured on GitHub's side) points at **Supabase's** auth server (`https://<project-ref>.supabase.co/auth/v1/callback`), not at this app. Separately, Supabase's own "Redirect URLs" allow-list (dashboard → Authentication → URL Configuration) must include this app's own callback URL (`http://localhost:3000/**` for dev, the Vercel domain(s) for prod) — that's what `redirectTo` in `signInWithOAuth` is checked against.
- `GitHubLoginButton` (`src/features/auth/components/github-login-button.tsx`) calls `signInWithOAuth` directly from a Client Component rather than via a Server Action. This was a considered choice, not an oversight: "writes go through Server Actions" is scoped to writes on app-owned tables (like `user_book`), not to auth handshakes that touch no app data. The client version also gets the correct origin for free via `window.location.origin` across localhost/preview/prod, which a Server Action would need extra plumbing to replicate. Don't "fix" this into a Server Action without discussing it first.
- `user_book_status` is a two-value enum: `'read'`, `'collected'`. Absence of a `user_book` row means unread and is never stored as its own enum value. There's an open question (`docs/specs/prd-browse-and-track.md`, OQ-8) about whether reverting to unread should preserve a non-empty `notes` field by adding a stored value later — check that before changing this.

## Not yet set up

- shadcn/ui is planned (`docs/architecture.md` §3) but not installed yet — Tailwind CSS itself is now set up (see "Tooling" above).
- No sign-out UI yet — `src/components/site-header.tsx` shows static "Signed in" text for authenticated users.
- `/auth/auth-error` doesn't receive real error detail from the callback route yet (it redirects there bare); the page already supports optional `error`/`error_description` query params if that gets wired up later.
- License is GPL-3.0-or-later (`package.json`, `LICENSE`).

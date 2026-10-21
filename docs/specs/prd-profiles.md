# PRD: User Profiles

> Stage: PRD — derived from `docs/specs/spec-profiles.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved from spec)

> The app knows who a user is — Supabase Auth and GitHub say so — but it has nowhere of its own to record anything a user chooses about themselves. Two features already specified are waiting on exactly that.

---

## 1. Problem Statement

Browse FR-10 makes a collection page public by default and forbids shipping that before the setting that turns it off exists, so `/collection/[user]` is owner-only today and will stay so until there is somewhere to store the choice. Browse NG10 deferred the table, the setting, and first-time-login setup to a feature of their own, and custom usernames were specified in the browse PRD with nowhere to put them; they now live here as FR-6. This PRD is that feature. It supplies the `profile` table, the public/private setting and where it is changed, the first-login moment where Browse FR-10 says the choice is made explicit, and usernames. What visibility _means_ on a collection page stays Browse FR-10, enforced by Browse M6.

## 2. Goals and Non-Goals

### Goals

- G1. Give every user who completes setup a `profile` row, keyed by their Supabase user id, created under RLS without a `security definer` function.
- G2. Make the public/private choice explicit at first sign-in, changeable afterwards, and impossible to hold implicitly: no user is public without having submitted the form.
- G3. Let anyone, including signed-out visitors, resolve a **public** user's profile, and nobody but its owner resolve a **private** one.
- G4. Custom usernames as the canonical form of `/collection/[user]`, with UUID links permanent.

### Non-Goals

- NG1. **Avatars for anyone but the viewer.** The header keeps showing the signed-in user's own GitHub avatar from their session, as today, and nothing else shows one. No avatar URL is stored on `profile` (Profiles Decision 7).
- NG2. **Uploaded profile pictures.** Storage that grows per user, plus image processing and moderation, for low value.
- NG3. **Display names** separate from the username. A collection page is headed by the username, or neutrally when there is none.
- NG4. **Account deletion UI.** Deleting the `auth.users` row already cascades to `profile`, as it does to `user_book`.
- NG5. **Per-user preferences beyond visibility and username**, including Browse FR-5's custom meters, which would live beside the profile when wanted.
- NG6. **Enforcing visibility on the collection page** — the public-read policy on `user_book`, the private 404, `noindex`. That is Browse FR-10, built at Browse M6 on top of this PRD's Profiles M1.
- NG7. **Reserved or moderated usernames.** No blocklist in v1 (R5).

## 3. Current State Analysis

- **No `profile` table**, locally or in the hosted project, whose `public` schema holds `book`, `book_location`, `user_book` and `user_book_note`. **No `loading.js`** anywhere under `src/app`, which bears on prefetching (NFR-2).
- **One user**, signed in with GitHub, who already has `user_book` rows. **No triggers on `auth.users`.**
- **Header** (`src/components/site-header.tsx`) reads the JWT claims with `getClaims()` and renders `UserBadge` from `claims.user_metadata`: the name via `getDisplayName`, the avatar via `avatarUrlFor`, which accepts only `https://avatars.githubusercontent.com/u/<id>` because `user_metadata` is user-editable. It degrades to signed out if `getClaims()` throws.
- **Collection page** (`src/app/collection/[user]/page.tsx`) is owner-only per Browse FR-8, reads cookies, and is therefore dynamically rendered on every request. Its links are built by `collectionPath(userId)` in `src/features/collection/route.ts`.
- **Sign-in** is `signInWithGitHub` (a form-invoked Server Action) → Supabase → GitHub → `/auth/callback`, which exchanges the code and redirects to a `next` path checked by `isSafeReturnPath`. There is no first-login branch.
- **Conventions this builds on:** `set_book_flags` shows the form-invoked Server Action pattern that works without JavaScript and returns typed results (Browse §12.3).

## 4. Proposed Solution

One table, one route, one Server Action, and two small changes to existing code:

1. **`profile`** — `user_id` (primary key, references `auth.users`), `is_public` (`not null`, no default), `username` (nullable, unique, constrained). RLS admits a row to readers when it is public or their own (§12.2).
2. **`/settings`** — a server-rendered form: public or private (radio, public preselected on first visit), and an optional username. Posts to `saveProfile`, which upserts the caller's own row under RLS, revalidates the layout, and redirects to a validated `next` when one is given, otherwise to `/settings?saved=1`.
3. **After sign-in** — once a sign-in succeeds, one helper checks whether the caller has a profile row, and sends them to `/settings?next=<next>` instead of `next` if not. `/auth/callback` calls it after its code exchange; any later sign-in path calls the same helper.
4. **The owner's collection page and the header** read the profile: the page to show a "finish setting up" notice when there is none, the header to show the username.

```
first sign-in:
GitHub → Supabase → /auth/callback?next=/books?source=base
                     ├─ exchangeCodeForSession
                     ├─ select user_id from profile where user_id = me   (RLS: own row)
                     ├─ failed → 307 /books?source=base   (as today; setting unchanged)
                     └─ none   → 307 /settings?next=/books?source=base
                                   │  <form action={saveProfile}>
                                   ▼
                          saveProfile(previous, form)
                            ├─ user from getClaims(), never the form
                            ├─ parse: is_public ∈ {true,false}, username → lowercase | null
                            ├─ upsert profile (user_id = me)          (RLS: insert/update own)
                            ├─ 23505 on username → { error: 'username_taken' }
                            ├─ revalidatePath('/', 'layout')
                            └─ redirect(next) | redirect('/settings?saved=1')

later, anyone:
/collection/lydia ── shape: username ──► select user_id from profile where username = 'lydia'
                                         (RLS: public rows, or the reader's own)
                                         ├─ row  → that user's collection (Browse FR-10 decides the rest)
                                         └─ none → "unknown user" (private and nonexistent alike)
/collection/<uuid> ─ shape: uuid ──────► same row by user_id; has a username? → 307 /collection/lydia
/collection/zzzz… ─ neither shape ─────► no query at all; "unknown user"
```

**Key design tradeoffs (explicit):**

- **Row created by a Server Action at setup (chosen)** vs a trigger on `auth.users` insert. The trigger is Supabase's usual pattern, but it runs as `supabase_auth_admin`, so its function needs `security definer` to write `public.profile` — exactly the last-resort case the project's migration rules warn about. It would also create a row for every sign-up whether or not setup finishes, forcing a default visibility into the database, and still need a backfill for the one existing user. The Server Action runs as the user under ordinary RLS, needs no backfill (the existing user simply meets setup on their next sign-in, or via the notice), and makes the row's existence mean "this user has chosen". Cost: every reader of `profile` must handle "no row", which FR-3 makes the private case by construction.
- **Row-level visibility (chosen)** vs column-level grants letting anon read `username` of every row. Column grants would let anon resolve a private user's username to a user id, which is the membership leak Browse FR-10's 404 exists to prevent. Hiding the whole row makes a private user's username indistinguishable from an unregistered one at the database. Column grants are still used, but to limit _which columns_ of a public row are published, never _which rows_ (§12.2). Cost: the table may never hold anything unsafe to publish for a public account (NFR-1).
- **One `/settings` route (chosen)** vs a separate `/welcome` for first login. The form, the action and the validation are identical; only the form's starting values and one introductory sentence depend on whether a row exists; the post-submit destination depends only on whether `next` was given.
- **Released usernames reclaimable at once (chosen)** vs a hold period. See FR-6; a hold needs either a readable table of released names or a `security definer` check.

## 5. Requirements

### Functional (FR)

- **FR-1 — Profile table.** One row per user who has completed setup, keyed by `auth.users.id` and deleted with it. It holds exactly what this PRD's features need — `is_public` and `username` — and nothing whose publication would harm a public account (NFR-1). **No timestamps:** no feature reads them, and on a row anyone can read they would publish when an account signed up and when it last changed its settings. Shape in §12.1.
- **FR-2 — Row creation at setup, under RLS.** A profile row is created only by `saveProfile` (FR-5), running as the signed-in user, whose RLS `insert` policy admits only their own `user_id`. There is no trigger on `auth.users` and no `security definer` function (Profiles Decision 1). The action takes the user id from `getClaims()`, never from the form.
- **FR-3 — Visibility setting.** `is_public` is a required boolean with **no column default**. It is set only by a submitted form, so no public profile exists that its owner did not choose.
    - **Public is the preselected option**, which is what Browse FR-10's "defaulting to public" means here: the default of a visible, explicit choice, not a value the database fills in.
    - **No row means owner-only.** Until setup completes, the user's collection behaves as private. Browse M6's public-read policy admits a user's `user_book` rows only when a profile row for that user exists with `is_public = true` (§12.2), so the absence of a row is private without any code path having to remember it.
    - **Where it is changed:** `/settings` (FR-5), at any time. Until Browse M6 ships, the setting is recorded but every collection stays owner-only regardless — Browse FR-10's sequencing constraint, satisfied in the safe direction. The setup copy must not promise that public is live before it is.
- **FR-4 — First-time setup.** The choice Browse FR-10 calls explicit happens here.
    - **After any successful sign-in, the caller's profile row is checked**, by one helper every sign-in path calls (§12.3). Today the only path is `/auth/callback`'s code exchange; email sign-in (`prd-email-sign-in.md`), planned after this milestone, adds a second that ends in its own Server Action rather than the callback, so the check cannot live inside the callback alone. If there is no row, the user is sent to `/settings?next=<next>`, carrying the `next` they would otherwise have been sent to, still validated by `isSafeReturnPath`; if there is one, they are sent to `next` as today. If the check itself fails, they are sent to `next` — a database hiccup must not block sign-in. The user's setting is unchanged by this: a public row stays public, and a user with no row stays owner-only (FR-3); only the setup prompt is skipped, until their next sign-in. **A failed check and a missing row are different results**, and `getProfile` returns them differently (§12.3); collapsing a failure into "no row" would force every sign-in during an outage through setup.
    - **Setup can be skipped** by navigating away. That leaves no row, so the user stays owner-only (FR-3), and the callback sends them to setup again on their next sign-in until they submit it. A user who never answers is never public.
    - **Existing sessions do not pass through sign-in**, so the owner's own `/collection/[user]` page shows a notice linking to `/settings` whenever the viewer has no profile row. This is how the one existing user, who signed in before profiles existed, meets setup.
- **FR-5 — `/settings` page and `saveProfile` action.** One route serves first-time setup and later changes (Profiles Decision 6).
    - **Signed out**, `/settings` redirects to `/books` with a 307, like Browse FR-8's collection bounce.
    - **One experience for setup and later changes.** The form starts from the stored values, or from the defaults (public preselected, no username) when there is no row, so an edit never resets an earlier choice. On success it redirects to `next` when one is given and passes `isSafeReturnPath` again, and otherwise to `/settings?saved=1`, which renders a fixed, app-written confirmation. Only the first-login redirect (FR-4) adds `next`, so the destination follows from how the user arrived rather than from whether a row exists. One heading serves both cases. When there is no row, a single sentence under it explains why a user who has just signed in has landed here, without promising that public is live before Browse M6 (FR-3). The confirmation has to live in the URL: a redirect discards the `useActionState` result, and the no-JavaScript path has nothing else the next GET can see. `saved` carries no text of its own — any value other than `1` is ignored — so the link cannot be used to make the page say anything.
    - **A `<form action={saveProfile}>`**, so it works without JavaScript (NFR-3). `saveProfile` validates input with a pure, unit-tested parser (`src/features/profile/profile-input.ts`), upserts the caller's row, and returns a typed result for `useActionState`: `invalid_input`, `username_taken` (from a `23505` on the username index), `unauthenticated`, `write_failed`. Failures re-render the form with its values and an error beside the field; they are not redirected.
    - **Cache invalidation lives here.** On success it calls `revalidatePath('/', 'layout')`, which covers the collection page under both its UUID and username paths, the previous username's path, and the header on every page. See NFR-2 for why nothing else can hold a copy.
- **FR-6 — Custom usernames.** A user can choose a username, stored on `profile` — never taken from an auth provider, whose handles are not unique across providers and not stable within one. Optional (Profiles Decision 4). `/collection/[user]` then accepts either form:
    - **Told apart by shape.** A check constraint limits usernames to `^[a-z0-9_-]{3,30}$`. "UUID" means the canonical form only — `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, after lowercasing — which is 36 characters, so no username can ever parse as one, and the route picks its lookup from the segment's shape alone, with no ambiguous case to resolve. **A segment that is neither shape resolves to no user without a query.** Length alone is not the test: Postgres rejects a 36-character non-hex segment with `22P02` rather than returning no row, which would make an ill-formed id distinguishable from a missing user, and it _accepts_ forms that are not canonical — 32 hex digits without hyphens, braces, hyphens in other places (all checked on the local stack) — which would give one user several URLs.
    - **UUID URLs stay permanent.** A link minted before the user chose a username, or before they changed it, keeps resolving.
    - **One canonical URL.** Once a username exists, the UUID form redirects to it with a **307**, never a 308: usernames can change, so the mapping is not permanent — the same reasoning as Browse FR-8's `/` redirect. A username segment with uppercase letters is lowercased and redirected the same way. `collectionPath` takes the username when known, so the app's own links go straight to the canonical form.
    - **Case-insensitive uniqueness.** The constraint above admits lowercase only, so input is lowercased before it is stored, and a unique index then makes `Ben` and `ben` the same name.
    - **The lookup belongs to the profile table.** Resolving a username is something other visitors need — it is what Browse FR-10's public viewing requires — and `auth.users` cannot serve it: it is not exposed through the API, and reaching into it would take a `security definer` function. The lookup runs under `profile`'s own RLS, which returns nothing for a private user (§12.2), so a private username resolves exactly as an unregistered one does.
    - **A released username can be claimed by someone else at once** (Profiles Decision 5). Changing or clearing a username frees it immediately. Old links to it then 404, or reach whoever claims it next; the settings form says so beside the field before the change is submitted. UUID links are unaffected either way.
- **FR-7 — Header identity.** The header shows the signed-in user's username when they have one, otherwise the name rule of Email FR-8 (`headerNameFor`: GitHub's `user_name` when the session's `app_metadata.providers` includes `github`, otherwise "Signed in", never another `user_metadata` key or the email address), next to their own GitHub avatar from the session (NG1). Reading it costs one primary-key lookup per signed-in render of the root layout. If that lookup fails, the header falls back to that rule rather than failing the page: the header renders outside every route's error boundary.

### Non-Functional (NFR)

- **NFR-1 — Nothing sensitive on `profile`.** Every column `anon` is granted is published for every public account (§12.2), and so is the list of public accounts itself (R8). `select` is granted column by column, so a column added later is unreadable to `anon` until a migration grants it — the grant is the point at which publication is decided. A future field that is not safe to publish for a public account — an email address, a private preference — goes in its own owner-only table, the `user_book_note` pattern, never on `profile`. Enforced by review of any migration that adds a column, and stated in the table's comment.
- **NFR-2 — Collection pages stay dynamic.** No `'use cache'`, no `export const revalidate`, no public or `s-maxage` `Cache-Control` on `/collection/[user]`, and no `prefetch={true}` on links to it. `revalidatePath` (FR-5) reaches only this app's own server cache; a CDN copy or a fully prefetched copy would keep serving a collection after its owner went private, with nothing erroring. **Nor is `saveProfile` the only writer:** `authenticated` holds `update` on `is_public` (§12.2), so a user can change their own visibility through PostgREST with their own token, and no `revalidatePath` runs at all. That is harmless only because nothing caches a collection, so a caching change cannot be justified by the invalidation in `saveProfile`. **Why the default prefetch is safe, so the reason can be rechecked:** without Cache Components, `<Link>`'s default, `auto`, skips a dynamic route entirely unless it has a `loading.js`, and with one prefetches the layouts down to that boundary but not the page inside it (Next's prefetching guide). There is no `loading.js` in the app today, so a collection link prefetches nothing. A `loading.js` is therefore safe wherever it sits relative to the page's own fetch; what must never happen is collection data fetched in a **layout above a `loading.js`**, which `auto` would then prefetch. `partialPrefetching`, which requires `cacheComponents`, switches `auto` to prefetching each route's App Shell. That shell carries content read from `cookies()` or `headers()` but not content that varies by `params`, and the collection's books vary by `[user]`, so even then the default link would not prefetch them — only `prefetch={true}` would, which is banned above. Both flags still change what is prefetched and what counts as dynamic, so either must be re-audited against this NFR before it lands. Next 16 caches dynamic pages in the browser for 0 seconds by default (`staleTimes.dynamic`, changed from 30s in Next 15), so another visitor's next navigation fetches afresh. **Limit, stated so nobody promises more:** going private stops future responses; it cannot recall a copy already delivered. Next restores back/forward navigations from its client cache regardless of `staleTimes`, and a tab left open keeps what it rendered.
- **NFR-3 — Works without JavaScript.** Setup and settings are a plain form posting to a Server Action; every error state renders in the response.
- **NFR-4 — Accessibility.** The visibility choice is a native radio group with a visible legend; username errors are attached with `aria-describedby` and announced; the first-login notice and the settings confirmation sit in live regions that exist before their content (Browse M4).
- **NFR-5 — Privacy parity.** For a private or nonexistent user, every lookup this PRD adds — by username or by id — takes the same query path and returns the same empty result, so the page built on it can meet Browse FR-10's "same status, same body, comparable timing".

## 6. Constraints and Assumptions

### Constraints

- RLS is the authorization model; no `security definer` function is introduced (Profiles Decision 1, FR-6).
- Every function in `public` declares `security invoker` and `set search_path = ''`; table references are schema-qualified.
- Writes go through form-invoked Server Actions; the user id always comes from `getClaims()`.
- Migrations are created with `supabase migration new`, never hand-named, and never edited once applied.
- Browse FR-10 remains the rule for collection visibility; this PRD must not restate it differently.

### Assumptions

- A1. GitHub is the only provider when Profiles M1 ships. Email sign-in (`prd-email-sign-in.md`) is planned as its own feature after it, and nothing here depends on the provider except FR-7's avatar, which is unchanged, and FR-4's check, which runs after every sign-in path.
- A2. Browse M3 has shipped: `/collection/[user]`, `collectionPath` and the owner-only check exist.
- A3. User count stays small enough that FR-7's per-render lookup is negligible.

## 7. Risks and Mitigations

| ID  | Risk                                                                                                                                                                                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Claiming a taken username reveals that _some_ account holds it, including a private one.                                                                                                                               | High       | Low    | Accepted: inherent in unique names, and it confirms a name, not a collection. The UUID URL and the collection's content stay protected, and a user who wants no discoverable trace simply sets no username (FR-6).                                                                                                                                                                                                                  |
| R2  | A released username is claimed by a stranger, and old links now show their collection.                                                                                                                                 | Low        | Low    | Stated beside the username field before a change is submitted (FR-6). UUID links are unaffected; a hold period was rejected for its cost (Profiles Decision 5).                                                                                                                                                                                                                                                                     |
| R3  | A later caching change — `'use cache'`, a CDN header, a full prefetch, collection data in a layout above a `loading.js`, `partialPrefetching` or `cacheComponents` — keeps serving a collection after it goes private. | Low        | High   | NFR-2 names each mechanism; AC-6 checks the response headers; `revalidatePath` in `saveProfile` covers the app's own cache.                                                                                                                                                                                                                                                                                                         |
| R4  | A column added to `profile` later is published for every public account.                                                                                                                                               | Med        | High   | NFR-1; the rule is written into the table's own comment, where the next migration's author will see it.                                                                                                                                                                                                                                                                                                                             |
| R5  | Offensive or impersonating usernames (`admin`, `uesp`).                                                                                                                                                                | Low        | Low    | Out of scope for v1 (NG7); revisit if the app grows real traffic. OQ-1.                                                                                                                                                                                                                                                                                                                                                             |
| R6  | The post-sign-in profile check adds latency or fails on every sign-in.                                                                                                                                                 | Low        | Low    | One primary-key lookup; a failure falls through to `next` with the user's setting unchanged, skipping only the setup prompt (FR-4).                                                                                                                                                                                                                                                                                                 |
| R7  | RLS misconfiguration exposes a private profile row, or lets a user write another's.                                                                                                                                    | Low        | High   | Database tests through supabase-js as `anon`, as a second user and as the owner (AC-1, AC-2), on the local stack; explicit column grants for every verb (§12.2).                                                                                                                                                                                                                                                                    |
| R8  | Anyone with the publishable key can list every public account's `user_id` and `username` (`GET /profile?select=user_id,username`), not only resolve one.                                                               | High       | Low    | Accepted (Profiles Decision 10). Browse M6's public-read policy on `user_book` already makes every public user's id and marked books listable the same way, so the list adds only usernames. Preventing it would mean revoking `select` and resolving usernames through a `security definer` function, which costs more than it protects. Only the three columns in §12.2 are granted, and no timestamps exist to publish activity. |

## 8. Milestones

- **M0 — Prerequisites.** Confirm Browse M3 has shipped (`/collection/[user]`, `collectionPath`, `isOwnCollection`) and that sign-in works through `/auth/callback`. Exit: both checked on the local stack.
- **M1 — Profile table, setup and visibility.** The `profile` migration — the whole table, including the `username` column, its format constraint and unique index — with RLS and grants (§12), `saveProfile`, `/settings` for first login and later changes, the callback redirect, and the owner's "finish setting up" notice. The username field is not yet offered, so every row's `username` is null until Profiles M2. **Browse M6 waits on this milestone.** Until Browse M6 ships, every collection stays owner-only whatever the setting says. Exit: FR-1 to FR-5 met; AC-1 to AC-5 and AC-8 green; the existing hosted user completes setup through the notice; and `/privacy` updated in the same change, before it ships (Privacy FR-5) — it must stop saying nothing is public, and say what a public profile shows, that public is the preselected choice, and where to change it. `profile` holds a user id, so it also joins the export query in `scripts/lib/privacy-sql.mts`.
- **M2 — Usernames.** No migration: the column and its constraint shipped at Profiles M1. The username field, FR-6's resolution by shape and 307s in `/collection/[user]`, `collectionPath` preferring the username, and FR-7's header. Exit: FR-6 and FR-7 met; AC-7 and AC-9 green; and `/privacy` updated in the same change, before it ships (Privacy FR-5) — it must say that a public profile shows its username, and that a username is optional. AC-6 is exited by whichever of Profiles M2 and Browse M6 lands second, since it needs both a username path and a page visible to other users.

## 9. Acceptance Criteria

- AC-1. RLS, tested through supabase-js on the local stack: `anon` and a second signed-in user read a public profile row and do not read a private one; the owner reads their own either way; a lookup by a private user's username returns the same empty result as an unregistered username. (FR-6, NFR-5)
- AC-2. A signed-in user cannot insert or update a profile row for another `user_id`, cannot move their own row to another `user_id`, and `anon` cannot write at all; `anon` can read `user_id`, `username` and `is_public` of public rows and nothing else. (FR-2, NFR-1, R7)
- AC-3. First sign-in with no profile row lands on `/settings` with public preselected; submitting returns to the URL sign-in started from, filters included. Navigating away leaves no row, and the next sign-in lands on `/settings` again. With a row, sign-in goes straight to `next`, and so does a sign-in whose profile check fails. (FR-4)
- AC-4. A user with no profile row, and a user with `is_public = false`, are both treated as private: their collection is owner-only. No row with `is_public` null can exist, and an insert omitting it fails. (FR-3)
- AC-5. `/settings` renders the stored values; changing visibility persists and shows a confirmation, with and without JavaScript, from `?saved=1`; a signed-out visitor is redirected to `/books` with a 307. (FR-5)
- AC-6. After an owner switches to private, the next request for their collection by another visitor — by UUID and by username — gets Browse AC-14's private response — a 404 with the same status and body as a user who never existed — with no stale copy; collection responses carry no public or `s-maxage` `Cache-Control`. The redirect to `/books` that every non-owner gets before Browse M6 does not count: it would pass whether or not the setting did anything, which is why this criterion cannot be exited before Browse M6. (FR-5, NFR-2)
- AC-7. Usernames: input outside `^[a-z0-9_-]{3,30}$` after lowercasing is rejected with an error beside the field; `Lydia` is stored as `lydia`; a name held by someone else returns `username_taken`; a name just released by one user can be claimed by another at once; `/collection/<uuid>` and `/collection/Lydia` both 307 to `/collection/lydia`, and the app's own links use the username; a 36-character non-hex segment and a non-canonical UUID (no hyphens, braces) get the same response as an unregistered username, with no database error. (FR-6, NFR-5)
- AC-8. Setup and settings work end to end with JavaScript disabled, including every error state. (NFR-3)
- AC-9. The header shows the username when set, otherwise the display name, beside the viewer's own GitHub avatar; a failing profile lookup degrades to the display name rather than an error. (FR-7)

## 10. Success Metrics

- **Setup completion:** % of new users who submit setup on their first sign-in (target: ≥ 80%).
- **Choice distribution:** share of profiles public vs private. Only a sanity check of the preselection, never a target to optimize — Browse FR-10's default is public because the choice is explicit, not to maximize public pages.
- **Username adoption:** % of profiles with a username.
- **Security:** zero incidents of a private profile, username or collection visible to anyone but its owner.

## 11. Open Questions

- **OQ-1:** Should any usernames be reserved (`admin`, `settings`, the project's own name), or offensive ones blocked? Out of scope for v1 (NG7, R5); a check against a small list in `profile-input.ts` would be enough if needed.

---

## 12. Technical Design — Schema, RLS, Server Action

> Design notes:
>
> - Sketches, not migrations. Profiles M1 creates the real file with `supabase migration new profile`, containing everything in §12.1 and §12.2; Profiles M2 needs no migration. Nothing here has been applied.
> - No timestamps, so no `set_updated_at` trigger (FR-1).

### 12.1 Schema (DDL)

```sql
create table public.profile (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- Required and deliberately without a default: a row exists only once the
  -- user has submitted the choice, so the database never picks it for them.
  is_public  boolean not null,
  -- Optional. Lowercase only, so the unique index below is case-insensitive
  -- without citext; never 36 characters, so never mistaken for a UUID.
  username   text
             constraint profile_username_format check (username ~ '^[a-z0-9_-]{3,30}$')
  -- No created_at/updated_at: nothing reads them, and anon could (FR-1).
);

comment on table public.profile is
  'Public rows are readable by anon: every granted column is published. '
  'Grant select per column; anything not safe to publish goes in its own '
  'owner-only table.';

-- Nulls are distinct by default, so any number of users can have no username.
create unique index profile_username_key on public.profile (username);
```

### 12.2 Row-Level Security and grants

```sql
alter table public.profile enable row level security;

-- Rows, not columns: a private user's row does not exist for anyone else, so
-- a username lookup cannot tell "private" from "never registered".
create policy profile_select_public_or_own on public.profile
  for select to anon, authenticated
  using (is_public or (select auth.uid()) = user_id);

create policy profile_insert_own on public.profile
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy profile_update_own on public.profile
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
-- No delete policy: the row goes when the auth user does (on delete cascade).

-- Stated explicitly rather than left to default privileges, and per column,
-- so a column added later is unpublished until a migration grants it.
-- user_id is updatable only so an upsert may name it in its update half; the
-- policy's with check pins it to auth.uid(), so the one value it can be set
-- to is the one it already holds.
revoke all on public.profile from anon, authenticated;
grant select (user_id, is_public, username) on public.profile to anon, authenticated;
grant insert (user_id, is_public, username) on public.profile to authenticated;
grant update (user_id, is_public, username) on public.profile to authenticated;
```

Notes:

- `saveProfile` upserts with `on conflict (user_id)`, which needs both the insert and the update policy — both scoped to the caller. **Keep `user_id` in the update grant.** Checked on the local stack in a rolled-back transaction: as `authenticated`, an `on conflict do update` that sets only `is_public` and `username` succeeds under the narrower grant, and one that also sets `user_id` fails with `permission denied for table profile`. Granting it costs nothing, for the reason in the comment above, and removes any dependence on exactly which columns supabase-js's upsert writes.
- `auth.uid()` is wrapped in `(select ...)` so Postgres evaluates it once per query, as in Browse §12.2.
- **Column grants behave as intended under RLS**, checked on the local stack in a rolled-back transaction: with `select` granted on only some columns, `anon` reads those columns of a public row, the policy's own reference to an ungranted column still evaluates, and a query that names an ungranted column is refused with `permission denied`. So any column a query or another table's policy names — Browse M6's subquery below reads `user_id` and `is_public` — must be in the grant.

**What Browse M6 builds on this.** Browse FR-10's public-read policy on `user_book` is the browse PRD's to write, but its shape depends on this one. It is a **second** policy, added beside `user_book_select_own`, never a replacement: permissive policies combine with OR, which is what keeps a private owner able to read their own books. It admits a row when a public profile exists for its owner,

```sql
create policy user_book_select_public on public.user_book
  for select to anon, authenticated
  using (exists (select 1 from public.profile p
                 where p.user_id = user_book.user_id and p.is_public));
```

and that subquery runs under `profile`'s own RLS and column grants as the caller — which works, without `security definer`, precisely because public rows and the two columns it names are readable by `anon`. A missing row fails the `exists`, which is how FR-3's "no row means owner-only" holds at the database. `user_book_note` gets no such policy (Browse FR-10: notes are never public).

### 12.3 Server Action and routes

- **`saveProfile(previous, form)`** — `src/features/profile/actions.ts`. `getViewerId()` → `parseProfileInput(form)` (pure: `is_public` must be exactly `'true'` or `'false'`; `username` trimmed, lowercased, empty → `null`, then the format check) → `upsert({ user_id, is_public, username })` → map `23505` on `profile_username_key` to `username_taken` → `revalidatePath('/', 'layout')` → `redirect(next | '/settings?saved=1')`. Shaped for `useActionState`, like `setBookFlags` (Browse §12.3).
- **`getProfile(userId)` and `getProfileByUsername(username)`** — `src/features/profile/data.ts`, opening with `import 'server-only'`. Each is one select returning `{ status: 'found', profile } | { status: 'none' } | { status: 'error' }` — never `null` for a failure, because the callers treat "no row" and "could not tell" differently (FR-4). RLS, not the caller, decides whether a private row is visible, so both return `none` for a private user viewed by anyone else (NFR-5).
- **`pathAfterSignIn(userId, next)`** — `src/features/profile/data.ts`, beside `getProfile`: `getProfile(userId)`; `none` → `/settings?next=<next>`; `found` or `error` → `next`. Returns the path rather than redirecting, so a Route Handler (`NextResponse.redirect`) and a Server Action (`redirect()`) can both use it. `/auth/callback` calls it after `exchangeCodeForSession`.
- **`/collection/[user]`** (Profiles M2) — a pure `parseCollectionSegment(segment)` in `route.ts` returns `{ kind: 'id' } | { kind: 'username' } | { kind: 'none' }` from shape alone, lowercasing first and flagging when it did, so the page knows to redirect. `id` requires the canonical UUID pattern (FR-6), not a length; `none` is answered without a query, by the same response an unregistered username gets (NFR-5). The resolved user id then goes through whatever Browse FR-8 and Browse FR-10 decide.
- **`collectionPath(userId, username?)`** — prefers the username when known, so nav links and the `/` redirect land on the canonical URL without a 307 hop.

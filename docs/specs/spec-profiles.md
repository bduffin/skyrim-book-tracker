# Spec: User Profiles

> Stage: Draft — awaiting review. See `docs/specs/prd-profiles.md` for the implementation plan; this file holds the problem, scope and decisions.

---

## Problem Thesis

The app knows who a user is — Supabase Auth and GitHub say so — but it has nowhere of its own to record anything a user chooses about themselves. Two features already specified are waiting on exactly that. Browse FR-10 makes collection pages public by default, and forbids shipping that before the setting that turns it off exists; Browse NG10 names that setting, and first-time-login setup, as a feature in its own right. Custom usernames need somewhere to live too, and cannot be borrowed from an auth provider whose handles are neither unique across providers nor stable within one.

---

## Current State

- No `profile` table, locally or in the hosted project. Every user-owned table today is keyed by `auth.users.id` directly: `user_book`, `user_book_note`.
- The hosted project has **one** user, signed in with GitHub. There are no triggers on `auth.users`.
- The header reads the signed-in user's name and avatar from the session's `user_metadata` (`getDisplayName`, `avatarUrlFor`), which GitHub populates and the user can edit, so the avatar URL is validated against GitHub's avatar host rather than passed through.
- `/collection/[user]` takes the Supabase user id and is **owner-only**: every other visitor is redirected to `/books` (Browse FR-8), which is the safe state Browse FR-10 requires until the setting exists.
- Sign-in returns through `/auth/callback`, a Route Handler that exchanges the code and redirects to a validated `next` path. Nothing happens on a user's first sign-in that does not happen on every one.

Pain points:

- Browse FR-10's public viewing cannot ship: there is no opt-out to ship it with.
- A collection URL is a 36-character UUID, which is unshareable in any sense but copy-and-paste.
- There is no moment at which a new user is asked anything, so Browse FR-10's "the choice is explicit at first login" has nowhere to happen.

---

## Desired State

A signed-in user can:

1. On first sign-in, be asked whether their collection is public or private — public preselected — and optionally choose a username, then continue to where they were going.
2. Change either later, from a settings page.
3. Share `/collection/<username>`; old `/collection/<uuid>` links keep working and redirect to it.
4. See their username, when they have one, next to their own GitHub avatar in the header.

And the app can answer "is this collection public?" under RLS, for a signed-out visitor, without ever revealing that a private account exists.

"Good" looks like: a new player signs in from a `/books` page, lands on a short setup form, leaves "public" selected and types `lydia`, and is back on the same `/books` page with the same filters. A week later they send a friend `/collection/lydia`. A different player chooses private and never thinks about it again; their collection URL is indistinguishable from one that was never registered.

---

## Source Material

- Browse PRD: `docs/specs/prd-browse-and-track.md` — Browse NG10 (this feature's scope), Browse FR-8 (the permanent user-id segment), Browse FR-10 (what visibility means on a collection page), Browse M6 (waits on this feature).
- Architecture: `docs/architecture.md` §6 (`profile`), §7 (RLS as the authorization model), §9 (progressive enhancement).
- Schema conventions: `CLAUDE.md` "Database migrations" and "Privacy".

---

## Constraints

- RLS is the authorization model. `security definer` only where the caller genuinely cannot do the work.
- Writes go through Server Actions invoked from forms, so setup and settings work without JavaScript.
- Browse FR-10 stays in the browse PRD and remains the rule for what a collection page shows. This feature supplies the setting it reads; enforcing it on the page is Browse M6.
- Nothing about a **private** account is revealed to anyone but its owner — not its collection, and not its username or its existence through any lookup or page (Decisions 2 and 3). **One accepted exception:** claiming a username that a private account holds is refused as taken, which confirms that some account has that name (Profiles R1). Unique names cannot avoid it, and a user who wants no trace at all can go without a username (Decision 4). What a public account publishes beyond its collection is Decision 10.
- No new storage cost that scales with users beyond a narrow row each: no uploaded images.

---

## Requirements

**Must-have:**

- [ ] A `profile` table keyed by the user id, holding the visibility setting and an optional username.
- [ ] First-time setup: after the first sign-in, the user is taken to a form that makes the public/private choice explicit, then returned to where they signed in from.
- [ ] A settings page where visibility and username can be changed later.
- [ ] Until setup is complete, a user's collection is owner-only.
- [ ] Anonymous visitors can resolve a public user's username; a private user's profile is invisible to everyone but its owner.
- [ ] Custom usernames (Profiles FR-6), with `/collection/[user]` accepting either form.
- [ ] Changing visibility invalidates any cached render of that user's collection page.

**Nice-to-have (out of scope for this spec):**

- Uploaded profile pictures, or any avatar shown to anyone but its owner.
- Display names separate from the username.
- Account deletion UI (deleting the auth user already cascades).
- Per-user settings beyond visibility and username, such as Browse FR-5's custom meters.

---

## Assumptions

- GitHub is the only auth provider when this ships; email sign-in follows as its own feature (`spec-email-sign-in.md`). Nothing here depends on the provider except the header's avatar.
- A username is optional. Visibility is the only choice setup requires.
- Users are few enough that a one-row primary-key lookup per signed-in page render is negligible.

---

## Success Criteria

1. A new user cannot reach a state where their collection is public without having seen and submitted the choice.
2. A signed-out visitor gets the same result — status, body and timing — for a private user's username or UUID as for one that never existed.
3. A user who sets a username can share `/collection/<username>`, and their old UUID link redirects there.
4. Flipping to private stops the collection being served to anyone else on their next request.
5. Setup and settings both work with JavaScript disabled.

---

## Decisions

| #   | Question                                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How a profile row comes to exist                   | Created by the setup form's **Server Action, under RLS**, not by a trigger on `auth.users`. A trigger runs as the auth admin and needs `security definer` in a function reachable from the `auth` schema; it would also create rows for sign-ups that never finish, and still need a backfill for the existing user. The Server Action needs none of that, and makes the row's existence mean something: the user has made the choice.                                                                                                  |
| 2   | State before setup                                 | **No row**, and no row means **owner-only**. `is_public` is `not null` with **no column default** — "public" is the form's preselected option, not the database's — so a public profile cannot exist that nobody chose. Browse FR-10's public-read policy (Browse M6) admits a collection only when a public profile row exists, so absence is private by construction rather than by the app remembering to check.                                                                                                                     |
| 3   | What anon may read on `profile`                    | **Rows, not columns**: `select` admits a row when it is public or the reader's own. A private user's row is invisible to everyone else, so a username lookup returns nothing — exactly what a name that never existed returns. The table therefore holds nothing that is not safe to publish for a public account; anything sensitive goes in its own owner-only table, the `user_book_note` pattern.                                                                                                                                   |
| 4   | Whether a username is required                     | **Optional.** Visibility is the only required choice. A user who wants no public handle at all can keep the UUID form indefinitely.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | Whether a released username can be claimed at once | **Yes, immediately** — the question left open when usernames were first specified in the browse PRD. Holding released names needs a table of them that every claim checks, and that table is either readable by other users, revealing which names were recently released and by whom, or checked by a `security definer` function. Old username links may then point at a stranger; the settings form says so at the moment of change, and UUID links are unaffected either way.                                                       |
| 6   | Setup and settings routes                          | **One route, `/settings`**, one form and one Server Action. Setup and later changes are one experience: the form starts from the stored values, or the defaults when there are none, with one introductory sentence for a user who has just been sent there after signing in, and returns them to where they were going when sign-in sent them (Profiles FR-5). Two routes rendering the same form was rejected as duplication.                                                                                                         |
| 7   | Avatars                                            | **Only your own, from GitHub**, in the header, as today. No avatar is stored on `profile` or shown to anyone else, and uploads are out of scope. Showing another user's avatar would mean publishing a URL that carries their GitHub account id, linking a collection back to the GitHub identity usernames deliberately stay apart from; uploads would add storage cost that scales with users. Low value against both.                                                                                                                |
| 8   | Where Browse FR-10 lives                           | **Stays in `prd-browse-and-track.md`.** It is the rule for what a collection page shows and is cited unqualified across the code and `CLAUDE.md`. This feature supplies the setting; Browse M6 enforces it. Usernames, which only this feature touches, were moved here from the browse PRD as Profiles FR-6.                                                                                                                                                                                                                           |
| 9   | Cache invalidation on going private                | In the **Server Action that saves the profile**, which revalidates the whole layout. Collection pages also stay dynamically rendered, so no server or CDN cache holds a copy the action cannot reach. **It cannot recall what is already delivered:** a tab left open keeps what it rendered, and Next restores back/forward navigations from the browser's own cache. Going private stops future responses only.                                                                                                                       |
| 10  | Whether public profiles may be listed              | **Accepted.** A public row is readable by `anon` through the API, so the list of public accounts' ids and usernames is readable too, not only a lookup of one. Browse M6's public-read policy on `user_book` already makes every public user's id and marked books listable the same way, so the list adds only usernames. Preventing it would take a `security definer` lookup function. What the list carries is kept minimal instead: `select` is granted per column, and the table has no timestamps to reveal sign-up or activity. |

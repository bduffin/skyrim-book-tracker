# Spec: Privacy Notice and Data Requests

> Stage: Draft — awaiting review. See `docs/specs/prd-privacy.md` for the implementation plan; this file holds the problem, scope and decisions.

---

## Problem Thesis

The site is live at `https://arcanaeum.app`, anyone can sign in with GitHub, and signing in stores personal data: an email address, a GitHub profile, and per-session network details. Nothing tells a visitor that, and nothing tells them how to get a copy of it or have it removed. `architecture.md` §13 deferred both until anyone besides the developer was invited; this feature is what lifts that deferral.

---

## Current State

What the app and its providers hold about a user, checked against the hosted project on 2026-10-02:

- **`auth.users` and `auth.identities`** (Supabase): the GitHub account's email address and profile — name, username, avatar URL, GitHub account id — with sign-up and last-sign-in times.
- **`auth.sessions`** (Supabase): per session, its timestamps, an IP address and a user-agent string. Every Auth call this app makes runs on the server — the code exchange in `/auth/callback`, the token refresh in the proxy — so under the current code the address and user agent are the server's, not the visitor's: 6 of the 7 hosted sessions have the user agent `node`, and the one browser session predates sign-in moving to a Server Action. That the addresses are Vercel's is confirmed when the notice is built (Privacy AC-4). A session lasts until the user signs out: Supabase's time-boxed sessions and inactivity timeout are Pro-plan settings, and the project is on Free. 7 sessions on the hosted project, the oldest from 2026-08-14, none with an end time set.
- **`auth.flow_state`** (Supabase): a record of each sign-in in progress. Nothing removes it afterwards: 6 rows, the oldest from 2026-08-14. One is linked to a user and holds that user's GitHub access token and refresh token; the others hold only the address the sign-in returns to.
- **`user_book`** (Supabase): which books the user marked read or collected. **`user_book_note`** exists but has no UI, so it is always empty.
- **Request logs:** Vercel keeps runtime logs for 1 hour on Hobby, and Supabase keeps API and database logs for 1 day on the Free plan. Either may carry IP addresses.
- **Backups:** none. Supabase does not back up Free-plan projects, so a deletion leaves no copy behind.
- **Cookies:** only Supabase's session cookies and the short-lived sign-in (PKCE) cookie. No analytics, advertising or tracking of any kind.
- **Contact:** `privacy@arcanaeum.app` and `contact@arcanaeum.app` forward through Cloudflare Email Routing to `arcanaeumapp@gmail.com`, which replies and forwards a copy of every incoming message on to the developer's personal Gmail (`architecture.md` §13). Correspondence therefore lives in two mailboxes.
- **Deletion cascades to most of a user's data, not all of it.** Deleting a row in `auth.users` cascades to the identity, sessions (and through them the refresh tokens), `user_book`, `user_book_note` and the other `auth` tables that reference users (foreign keys checked on the hosted project). **`auth.flow_state` has no foreign key**, so its sign-in records, GitHub tokens included, survive a deletion. What is also missing is a way for a user to ask.

Pain points:

- A visitor cannot learn what signing in shares, or with whom, before doing it.
- A user cannot find out how to get their data or have it deleted.
- Profiles (`prd-profiles.md`) will make profiles readable at Profiles M1 and collections public by default at Browse M6; a notice written today has to be updated before each, and nothing yet ties them together.
- Sign-in records accumulate indefinitely and outlive the accounts they belong to.
- A device that never signs out stays signed in indefinitely, so a forgotten or stolen device's cookie keeps working.

---

## Desired State

1. Every page links to a plain-language privacy notice at `/privacy`, which says what is collected, why, where it is kept and for how long, that nothing is sold or shared for marketing, who runs the site, and how to ask for a copy of one's data or for its deletion.
2. A deletion or copy request sent to `privacy@arcanaeum.app` is answered within a month by following a written procedure, with the requester confirmed as the account holder first.
3. The notice stays true: anything that changes what is collected or made public updates `/privacy` before it ships.

"Good" looks like: a player about to sign in follows the footer link, reads in a minute that the site stores their GitHub email and profile and their read/collected marks, and nothing else of note. Months later they email `privacy@arcanaeum.app` asking to be deleted; a message arrives at their GitHub email asking them to confirm, they reply, and within days they hear from the project's address that it is done, and their collection URL now answers like one that never existed.

---

## Source Material

- Architecture: `docs/architecture.md` §13 (the deferral this lifts, the email setup), §7 (RLS).
- Browse PRD: `docs/specs/prd-browse-and-track.md` Browse FR-10 (collection visibility, notes never public).
- Profiles PRD: `docs/specs/prd-profiles.md` (public collections and usernames, which change what the notice must say).
- `CLAUDE.md` "Privacy" and "Auth flow specifics".

---

## Constraints

- **Not legal advice.** The notice is written to describe this app accurately. Whether it meets a given law (GDPR, UK GDPR, CCPA) is for the developer to judge, or to check with someone qualified.
- **No self-service deletion in this feature** (Decision 1), so no `security definer` function and no secret key on Vercel.
- **The notice must be true when shipped** and verified against the database, not against this spec.
- **Server-rendered and readable without JavaScript.** Its content is the same for everyone, but it is rendered per request like every page under the root layout, whose header reads the session, and must never be forced static or cached (Privacy FR-1).

---

## Requirements

**Must-have:**

- [ ] A `/privacy` page, linked from the footer on every page.
- [ ] Contents covering the data inventory above, its purpose, where it is processed, retention, cookies, sharing, who runs the site, and how to request a copy or deletion.
- [ ] A written procedure for deletion requests, including how the requester is confirmed as the account holder before anything is deleted, and the records that do not cascade.
- [ ] A written procedure for copy (access) requests.
- [ ] Stale sign-in records removed automatically.
- [ ] A rule, recorded where the next change will meet it, that the notice is updated before anything changes what is collected or published — Profiles first among them.

**Nice-to-have (out of scope for this spec):**

- Self-service account deletion on `/settings`.
- Self-service export ("download my data").
- A notice shown at the moment of sign-in, beyond the footer link.

---

## Assumptions

- Requests will be rare: a handful a year at most while the user count is small.
- GitHub stays the only sign-in provider. A second provider would change what is collected and needs the notice updated first (Privacy FR-5).
- The developer can act on a request within a month.

---

## Success Criteria

1. The notice is reachable from every page that renders the site's footer, and works without JavaScript.
2. Everything it says the app stores is true of the hosted database on the day it ships, and nothing the app stores is missing from it.
3. A test deletion request, run end to end on a throwaway account, leaves no row for that user in any table that held their id.
4. A test copy request produces every stored item about that user and nothing about anyone else.

---

## Decisions

| #   | Question                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Self-service deletion or manual   | **Manual, on request.** The browser cannot delete from `auth.users`; self-service needs a `security definer` function scoped to `auth.uid()` (allowed by `CLAUDE.md`'s rule, with its safeguards) or the admin API from a Server Action (ruled out: it needs the secret key on Vercel). At a handful of requests a year, a written procedure costs less than either. A self-service button belongs on Profiles' `/settings` if it is ever wanted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | Contact address                   | **`privacy@arcanaeum.app`**, on the project's own domain so it survives a change of mail provider, and so the developer's personal address is never published. Replies come from `arcanaeumapp@gmail.com`: Cloudflare Email Routing only receives, and Gmail's "Send mail as" for outside addresses ends in January 2027 (`architecture.md` §13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | How the notice names the operator | **The GitHub handle `bduffin`, linked to `https://github.com/bduffin`.** A real, accountable person without publishing a full name on the site itself. The linked profile shows the developer's display name, which is the developer's choice to keep or clear.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Verifying a requester             | **Confirm control of the account before acting, never trust the `From:` header.** A forged `From:` costs nothing, so the request is answered by writing **to the address stored on the account**, with a one-time code, and nothing is done until a reply repeats that code. Being in the same thread proves nothing, since mail is threaded by subject; knowing the code proves the message was received. If that address cannot receive mail — a GitHub `noreply` address — the requester instead posts a one-time code from the GitHub account they signed in with, checked against the GitHub id stored on the identity. Signing in to prove ownership was rejected: it would need the self-service path Decision 1 defers.                                                                                                                                                                                                                                              |
| 5   | Where the procedures live         | **In the repository**, next to the code whose data they handle, so they change in the same commit as the schema. The notice states the commitments; the procedures say how to keep them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | Stale sign-in and session records | **Deleted by a daily scheduled job** (Privacy FR-7): sign-in records once a day old, as well as per request, and sessions once unused for 90 days. A sign-in record is needed only while its sign-in completes; Supabase does not remove them, and they can hold a user id and GitHub tokens. The session cleanup is hygiene rather than privacy: a session row holds timestamps and the server's address, not the visitor's, but on the Free plan Supabase never ends a session that is not signed out, and the session cookie lasts 400 days, so a forgotten or stolen device would stay signed in indefinitely. The job is the inactivity timeout Free does not offer; the cost is signing in again after 90 days away, long enough for gaps between playthroughs. Dropping it was considered once it was clear the rows hold no visitor IP address — little is at stake, since a session can only read and change one person's marks — and it was kept as cheap hygiene. |
| 7   | How long correspondence is kept   | **12 months in the project mailbox; the personal copy deleted when the request is answered** (Privacy FR-4 step 7). The thread in `arcanaeumapp@gmail.com` is the record that a request was received, confirmed and answered, and 12 months covers a follow-up question or a dispute about whether it was handled. The copy forwarded to the developer's personal inbox only duplicates it, so it is deleted at once. The Sent copy of an export carries IP addresses, so it is held to the same 12 months. Deleting everything at once was rejected: it would leave nothing to show a request was handled.                                                                                                                                                                                                                                                                                                                                                                  |

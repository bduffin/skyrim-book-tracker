# PRD: Privacy Notice and Data Requests

> Stage: PRD — derived from `docs/specs/spec-privacy.md` and grounded in `docs/architecture.md`.
> Status: Draft for review.

## Core Thesis (preserved from spec)

> The site is live at `https://arcanaeum.app`, anyone can sign in with GitHub, and signing in stores personal data: an email address, a GitHub profile, and per-session network details. Nothing tells a visitor that, and nothing tells them how to get a copy of it or have it removed.

---

## 1. Problem Statement

`architecture.md` §13 deferred a privacy notice and a way to delete one's data until anyone besides the developer was invited, because the site is publicly reachable and kept private only by not sharing the URL. This PRD lifts that deferral: a notice at `/privacy` linked from every page, written procedures for answering deletion and copy requests sent to `privacy@arcanaeum.app`, a scheduled cleanup of the sign-in records Supabase leaves behind, and a rule that keeps the notice true as features change what the app collects or publishes — Profiles first among them.

## 2. Goals and Non-Goals

### Goals

- G1. Tell any visitor, before they sign in, what the app stores about them, why, where, for how long, and how to ask for a copy or deletion.
- G2. Make deletion and copy requests answerable within a month, by a procedure that confirms the requester controls the account before acting and checks its own result.
- G3. Keep the notice accurate as the app changes, with the update ordered before the change ships.
- G4. Keep nothing about a sign-in longer than the sign-in needs it.

### Non-Goals

- NG1. **Self-service deletion.** Manual, on request (Privacy Decision 1). It would belong on Profiles' `/settings` (Profiles FR-5) if wanted later, through a `security definer` function scoped to `auth.uid()` — never the admin API, which needs the secret key on Vercel.
- NG2. **Self-service export.** Copy requests are answered by hand (FR-6).
- NG3. **A cookie banner.** The only cookies are the ones sign-in needs (FR-2); no consent is asked for strictly necessary cookies, and adding analytics or tracking would need this PRD revisited first (FR-5).
- NG4. **Legal review.** The notice describes this app accurately; whether it satisfies a particular law is the developer's judgment (spec, Constraints).
- NG5. **Terms of service.** Not needed to describe data handling, and no feature depends on them.

## 3. Current State Analysis

The data inventory, checked against the hosted project on 2026-10-02, is in the spec's Current State and is what FR-2 writes into the notice. In brief: Supabase holds the GitHub email and profile (`auth.users`, `auth.identities`), per-session IP and user agent (`auth.sessions`), sign-in records (`auth.flow_state`, below), and read/collected marks (`user_book`); `user_book_note` is always empty because notes have no UI. Vercel keeps runtime logs for 1 hour on Hobby and Supabase keeps API and database logs for 1 day on Free; Supabase takes no backups of Free-plan projects. The only cookies are Supabase's session cookies and the sign-in (PKCE) cookie.

**Deletion cascades from `auth.users` to most, not all, of what it should.** Every table holding a user id was checked on the hosted project:

- **Cascade on delete:** `auth.identities`, `auth.sessions`, `auth.mfa_factors`, `auth.mfa_recovery_code_sets`, `auth.one_time_tokens`, `auth.oauth_authorizations`, `auth.oauth_consents`, `auth.webauthn_challenges`, `auth.webauthn_credentials`, `user_book`, `user_book_note`. `auth.scim_users` sets null and is unused here.
- **`auth.refresh_tokens`** has a text `user_id` with no foreign key. Its rows go with their session, through `session_id`'s cascade, and every current row has one (15 rows, none without a session); the verification query counts them anyway.
- **`auth.flow_state` does not cascade at all.** It is Supabase's record of a sign-in in progress, and nothing removes it afterwards: 6 rows on the hosted project, the oldest from 2026-08-14; one is linked to a user and holds that user's GitHub access token and refresh token, and the others hold only the address the sign-in returns to. (Its `email_optional` column is a true/false flag, not an address.) A user deleted today would leave these behind. FR-4 deletes them per request and FR-7 stops them accumulating.

**The footer** is `UespAttribution` (`src/components/uesp-attribution.tsx`), rendered once from the root layout, so it is on every page except `global-error.tsx`, which replaces the layout. **The root layout reads the session** (`SiteHeader`), so every page under it is rendered per request; the production build lists every route as dynamic (`ƒ`).

## 4. Proposed Solution

1. **`/privacy`** — a Server Component rendering the notice (FR-1, FR-2), titled "Privacy · Arcanaeum" through the root layout's template, with a visible "Last updated" date.
2. **A footer link** to it, beside the existing attribution (FR-3).
3. **`docs/privacy-requests.md`** — the procedures for deletion (FR-4) and copy requests (FR-6) — and **`scripts/privacy-request.mjs`**, which runs their SQL for a user id it has validated, the only value that reaches a query (§12.2).
4. **A scheduled cleanup** of stale `auth.flow_state` rows (FR-7), one migration enabling `pg_cron` and scheduling a daily delete (§12.3).
5. **The keep-it-true rule** (FR-5), written into `CLAUDE.md`'s Privacy section and into the milestones it applies to in the profiles and browse PRDs.

No new dependency and no environment variable.

## 5. Requirements

### Functional (FR)

- **FR-1 — The `/privacy` page.** A Server Component at `src/app/privacy/page.tsx`. Its content is the same for everyone, but the page is **rendered per request**, because the root layout's header reads the session; it must never be forced static or cached (`export const dynamic = 'force-static'`, `'use cache'`, a `revalidate` export, or a public `Cache-Control`), since a cached copy would serve one reader's header to the next. It is indexable — unlike collection pages it has no privacy dimension of its own — and its `metadata` is typed as `Metadata` with the title "Privacy". It shows a **"Last updated"** date, set by hand in the page whenever the content changes, never computed at build time, because a build date would claim changes that did not happen.
- **FR-2 — What the notice says.** Plain language, in this order, each part true of the hosted project on the date shown:
    - **Who runs the site:** Arcanaeum is an unofficial fan project run by **bduffin** (linked to `https://github.com/bduffin`), reachable at `privacy@arcanaeum.app` (Privacy Decisions 2 and 3).
    - **What is collected, and only when someone signs in:** from GitHub, the account's email address, name, username, profile picture URL and GitHub account id; when the account was created and last signed in; for each session, an IP address and browser or device details; a short-lived record of each sign-in while it completes, which can hold the access GitHub grants for sign-in, removed within a day (FR-7); and the books marked read or collected. Browsing without signing in stores nothing about the visitor in the database. Notes are not mentioned until notes have a UI (FR-5).
    - **What is not:** no analytics, advertising or tracking; no payment details; nothing sold, rented or shared for marketing.
    - **Why:** to sign the user in and to keep their read and collected marks — nothing else.
    - **Who processes it, and where:** Supabase (database and sign-in, United States), Vercel (hosting, United States and its global network), GitHub (sign-in), Cloudflare (domain, and forwarding mail sent to the site's addresses), and Google, whose Gmail holds correspondence in two mailboxes: the project's own and the developer's personal inbox, which receives a forwarded copy of every message sent to the site. Data is stored in the United States.
    - **Cookies:** only the ones sign-in needs — the session cookies, and a short-lived cookie during sign-in itself.
    - **How long it is kept:** account data until the user asks for deletion, when it is removed from the database at once; session records until the session ends (OQ-1 fixes the wording); sign-in records for at most a day (FR-7); request logs for at most 1 day (Supabase) or 1 hour (Vercel), which expire on their own rather than being deleted with the account; no backups. Correspondence about a request is kept as OQ-2 settles, in both mailboxes.
    - **What is public:** nothing. A collection is visible only to its owner. (Profiles M1 and Browse M6 change this; FR-5.)
    - **The user's choices:** ask for a copy of their data, or for its deletion, by emailing `privacy@arcanaeum.app`; the reply goes to **the email address on their GitHub account**, to confirm the request came from them before anything is done, and the request is answered within one month (FR-4, FR-6). Sign out at any time; revoke the app's access to their GitHub account in GitHub's settings (Settings → Applications → Authorized OAuth Apps).
    - **Changes:** the notice is updated before any change to what is collected or published, and the date above says when it last changed.
- **FR-3 — Linked from every page.** A "Privacy" link in the site-wide footer, rendered from the root layout, so every page that has the footer has the link. **`global-error.tsx` is the one exception**: it replaces the whole layout when the layout itself has failed, and stays minimal. The link is a plain `Link`, so it works without JavaScript.
- **FR-4 — Deletion procedure** (`docs/privacy-requests.md`, run through `scripts/privacy-request.mjs`, §12.2). Nothing is deleted until step 2 succeeds.
    1. **Find the account in the Supabase dashboard** (Authentication → Users), searching for the email the requester names or writes from, and copy its **user id**. The address is typed only into the dashboard's search box, never into SQL (§12.2). Run `show` for that id to see the stored email and GitHub id the next step needs. **Go on only if the email `show` prints is exactly the address searched for**, ignoring letter case: the dashboard's search also returns partial matches, and the confirmation in step 2 goes to whatever `show` prints, so a near-miss would send the code to a stranger. If nothing matches exactly, or more than one account does, stop and ask the requester for the email on their GitHub account. The `From:` header proves nothing on its own: it is trivially forged, and a request is never acted on because of it.
    2. **Confirm control of the account** (Privacy Decision 4), by one of:
        - **Email confirmation, the default.** Write a new message from `arcanaeumapp@gmail.com` **to the stored address**, not to the `From:` of the request, with a **one-time code** — random, at least eight characters, generated for this request — and ask the account holder to reply with it. Act only on a reply that **contains that code**. Gmail groups messages into threads by subject, so a forged message with the same subject can land in the thread; being in the thread and matching `From:` prove nothing, but only someone who received the message at the stored address knows the code.
        - **GitHub confirmation, when the stored address cannot receive mail** — a GitHub `noreply` address, or a confirmation that bounces. Send the requester a one-time code and ask them to post it in a public gist, or briefly in their GitHub profile bio, from the account they signed in with; check that the GitHub account showing it has the numeric id `show` reports. Control of that GitHub account is control of the sign-in.
    3. **Delete the user** in the Supabase dashboard (Authentication → Users → the user → Delete user), which removes the row and cascades (§3).
    4. **Delete the sign-in records** that do not cascade: `auth.flow_state` rows for that user id (§12.2).
    5. **Check the result** with the verification query (§12.2): zero rows for that user id in every table that holds one. A non-zero count stops the procedure until it is explained.
    6. **Reply** in the confirmation thread that deletion is done, and that they can also revoke the app's GitHub authorization, which only they can do.
    7. **Clean up after the request** as OQ-2 settles: the correspondence in both mailboxes.
    8. **Within one month** of the request.
- **FR-5 — Keeping the notice true.** Before any change ships that alters what is collected, who processes it, what is public, or which cookies are set, `/privacy` and its "Last updated" date are updated in the same change. Known instances, recorded here so they are not missed:
    - **Profiles M1** — profile rows become readable to anyone for public accounts: user id, username and the public/private flag (Profiles §12.2). The notice must stop saying nothing is public, and say what a public profile shows, that public is the preselected choice, and where to change it.
    - **Browse M6** — public collections become readable to anyone, including signed-out visitors (Browse FR-10). The notice must say what a public collection shows and that notes never are.
    - **A notes UI** — notes join the inventory, stated as never public (Browse FR-10).
    - **A second sign-in provider** — what it supplies joins the inventory.
    - **Any analytics, error reporting or third-party script** — a new processor, and possibly a cookie (NG3).
    - **Where the rule is recorded:** at Privacy M1 the rule is written into `CLAUDE.md`'s Privacy section, and the notice update is added to the exit criteria of **Profiles M1** in `prd-profiles.md` and **Browse M6** in `prd-browse-and-track.md`, where the milestone that changes what is public will meet it.
- **FR-6 — Copy (access) procedure** (`docs/privacy-requests.md`, run through `scripts/privacy-request.mjs`, §12.2): find the account and confirm control exactly as FR-4 steps 1 and 2, run the export query for that user id, and send its output as a JSON attachment in the confirmation thread, within one month. The query returns every stored item in §3 for that user and nothing about any other; for sign-in records it gives dates and method only, never the GitHub tokens, which are credentials rather than information about the user. The export is written to a temporary file to attach it, and that file is deleted once the reply is sent.
- **FR-7 — Scheduled cleanup of sign-in records.** A daily `pg_cron` job deletes `auth.flow_state` rows created more than a day ago (§12.3). A row is needed only while its sign-in completes, minutes at most, so anything a day old belongs to a sign-in that finished or was abandoned. `auth.flow_state` is in Supabase's own `auth` schema and owned by its auth role; the job only deletes expired rows, never alters the table, and if Supabase adds a cleanup of its own the job simply finds nothing to delete. Created by a migration, so every environment built from `supabase/migrations/` has it.

### Non-Functional (NFR)

- **NFR-1 — Works without JavaScript.** The page and its footer link are plain server-rendered HTML and links.
- **NFR-2 — Readable.** One `h1` (through `PageTitle`), a section heading per FR-2 topic, short paragraphs, and the contact address as a `mailto:` link. Body text uses the page's normal text colours, already measured for contrast in `globals.css`.
- **NFR-3 — Accurate on the day it ships.** Every factual claim in FR-2 is re-checked against the hosted project when the page is built, not copied from this PRD (AC-4).

## 6. Constraints and Assumptions

### Constraints

- No secret key on Vercel, and no `security definer` function (NG1).
- `Metadata`-typed page metadata; American spelling; no `dangerouslySetInnerHTML` (`react/no-danger`).
- The notice states facts about this deployment; it does not claim compliance with any specific law (NG4).
- Migrations are created with `supabase migration new` and never edited once applied (`CLAUDE.md`).

### Assumptions

- A1. Requests are rare enough that a manual procedure is proportionate.
- A2. GitHub remains the only sign-in provider (FR-5 covers a change).
- A3. The project's Free-plan settings — no backups, 1-day log retention — stay as they are; a plan change is an FR-5 change.

## 7. Risks and Mitigations

| ID  | Risk                                                                                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The notice drifts from what the app actually collects.                                                                            | Med        | Med    | FR-5's rule, written where the changes will meet it; the inventory re-checked against the database when the page is built (NFR-3, AC-4).                                                                  |
| R2  | Profiles M1 or Browse M6 makes something public before the notice says so.                                                        | Med        | High   | FR-5 names each separately, and Privacy M1 adds the notice update to both milestones' exit criteria in their own PRDs.                                                                                    |
| R3  | Someone requests deletion of an account that is not theirs.                                                                       | Low        | High   | Nothing is acted on until the account holder confirms through the stored address or the GitHub account itself (FR-4 step 2); a forged `From:` gets no further than a question sent to someone else.       |
| R4  | A request is missed, or answered after the month.                                                                                 | Low        | Med    | The project mailbox forwards a copy to the developer's own inbox (`architecture.md` §13); a Gmail filter on `to:privacy@arcanaeum.app` labels and stars it.                                               |
| R5  | The notice falls short of a law that applies to some visitor.                                                                     | Low        | Med    | Accepted as NG4; the notice is accurate and offers the rights most laws require — access and deletion — so the gap, if any, is in wording rather than in what is offered.                                 |
| R6  | A Supabase upgrade changes `auth.flow_state` and the cleanup job fails, or an `auth` table gains a user id that does not cascade. | Low        | Low    | A failed run is recorded in `cron.job_run_details`; FR-4 step 5's verification query is the backstop for any single deletion. The `auth` user-id check in §3 is repeated when Privacy M1 is built (AC-4). |

## 8. Milestones

- **M1 — Notice, procedures and cleanup.** FR-1 to FR-7: the page, the footer link, `docs/privacy-requests.md` and `scripts/privacy-request.mjs` with its queries tested on the local stack, the `flow_state` cleanup migration, and the FR-5 rule recorded in `CLAUDE.md` and in the exit criteria of Profiles M1 and Browse M6. OQ-1 and OQ-2 settled first, since FR-2's retention wording depends on them. Exit: AC-1 to AC-9 green.

## 9. Acceptance Criteria

- AC-1. `/privacy` renders with JavaScript disabled, carries the title "Privacy · Arcanaeum" and a "Last updated" date, and contains every FR-2 section. (FR-1, FR-2, NFR-1)
- AC-2. Every page rendered inside the root layout — `/books`, `/collection/[user]`, `/auth/auth-error`, the 404 page and the `error.tsx` boundary — has a footer link to `/privacy`. (FR-3)
- AC-3. The contact address on the page is `privacy@arcanaeum.app` as a `mailto:` link, the operator is shown as "bduffin" linking to `https://github.com/bduffin`, and the page does not contain the developer's personal email address. (FR-2)
- AC-4. Each claim in FR-2's inventory is checked against the hosted project on the build date, including a fresh check of every `auth` and `public` table that holds a user id and whether it cascades, and nothing stored there about a user is missing from the notice. (NFR-3, §3)
- AC-5. On the local stack, a throwaway user with `user_book`, `user_book_note` and `auth.flow_state` rows is deleted by following FR-4 steps 3 to 5, and the verification query then reports zero rows for that id in every table it checks. (FR-4)
- AC-6. On the local stack, the export query for one of two throwaway users returns that user's account, identity, sessions, sign-in record dates, marks and notes, contains no GitHub token, and nothing belonging to the other. (FR-6)
- AC-7. The production build lists `/privacy` as dynamic (`ƒ`), and its response carries `Cache-Control: private, no-cache, no-store`. (FR-1)
- AC-8. On the local stack, the cleanup job exists in `cron.job`, and running its command deletes an `auth.flow_state` row created two days ago while keeping one created a minute ago. (FR-7)
- AC-9. `scripts/lib/privacy-sql.mjs`'s tests show that a canonical UUID, in either case, is accepted and lowercased, and that anything else is refused before any SQL is built — including an id with a quote, an appended SQL fragment, surrounding whitespace, braces, a missing hyphen, or an extra character. They also check the **statement the script builds**, not only the gate: for each command, every `{{user_id}}` becomes exactly `'<lowercased uuid>'::uuid`, quotes included, no placeholder is left, and the input appears nowhere else in the text. (§12.2)

## 10. Success Metrics

- Every privacy request answered within one month.
- Zero occasions on which the notice is found to describe the app incorrectly.
- No `auth.flow_state` row older than two days on the hosted project.

## 11. Open Questions

- OQ-1. **How long does a session record live on the hosted project?** It depends on Supabase's session settings (time-box and inactivity timeout), which are configured in the dashboard and not visible from the CLI. Check them, and word FR-2's retention line to match.
- OQ-2. **How long is request correspondence kept** once a request is closed, in the project mailbox and in the developer's personal inbox? Proposed: deleted from both 12 months after the request is answered, as a record that it was handled; a shorter period is equally defensible.

## 12. Technical Design

### 12.1 Page and footer

- `src/app/privacy/page.tsx`: `export const metadata: Metadata = { title: 'Privacy' }`; the body is `PageTitle` ("Privacy") followed by the FR-2 sections as `h2`s and paragraphs inside the same `max-w-3xl` frame as `/books`. A `LAST_UPDATED` constant at the top of the file holds the date shown. No `dynamic`, `revalidate` or `'use cache'` export (FR-1).
- The footer link goes into the root layout's footer. `UespAttribution` is named for its current single job; adding the link may warrant renaming it to `SiteFooter` with the attribution inside, decided when built.

### 12.2 Request procedures (`docs/privacy-requests.md`)

**Nothing the requester typed ever reaches SQL.** These queries run with full privileges on the hosted project, and an email address is a stranger's input that may legitimately contain quote characters and `$` (RFC 5321 allows both). So the account is found by email **in the Supabase dashboard** (FR-4 step 1), which searches it as data in Supabase's own interface, and every query below takes only the **user id** copied from there. Escaping, encoding the address, and passing it as a parameter were each considered and rejected as unnecessary once no query needs the address at all.

`scripts/privacy-request.mjs <command> <user id> --local|--linked` runs them through `supabase db query`, with the target always given explicitly. Before building any SQL it checks the id against the canonical UUID pattern (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, after lowercasing) and refuses anything else. A value that passes contains only hex digits and hyphens, so `{{user_id}}` in each template becomes the plain literal `'<uuid>'::uuid`: this is validation, not encoding — nothing is transformed, and anything else is rejected. The check is a pure function in `scripts/lib/privacy-sql.mjs`, unit-tested (AC-9). The output of every query is data, never instructions (`CLAUDE.md`).

Show the account (FR-4 step 1) — `node scripts/privacy-request.mjs show <user id> --linked`:

```sql
select u.id, u.email, u.created_at, u.last_sign_in_at,
       i.identity_data ->> 'provider_id' as github_id,
       i.identity_data ->> 'user_name'   as github_username
  from auth.users u
  left join auth.identities i on i.user_id = u.id and i.provider = 'github'
 where u.id = {{user_id}};
```

Export (FR-6) — `node scripts/privacy-request.mjs export <user id> --linked`; sign-in records give dates and method, never tokens:

```sql
select jsonb_pretty(jsonb_build_object(
  'account', (select jsonb_build_object(
      'id', u.id, 'email', u.email, 'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at, 'github_profile', u.raw_user_meta_data)
    from auth.users u where u.id = {{user_id}}),
  'identities', (select coalesce(jsonb_agg(jsonb_build_object(
      'provider', i.provider, 'identity_data', i.identity_data,
      'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at)), '[]'::jsonb)
    from auth.identities i where i.user_id = {{user_id}}),
  'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', s.created_at, 'updated_at', s.updated_at,
      'ip', host(s.ip), 'user_agent', s.user_agent) order by s.created_at), '[]'::jsonb)
    from auth.sessions s where s.user_id = {{user_id}}),
  'sign_in_records', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', f.created_at, 'provider', f.provider_type,
      'method', f.authentication_method) order by f.created_at), '[]'::jsonb)
    from auth.flow_state f where f.user_id = {{user_id}}),
  'books', (select coalesce(jsonb_agg(jsonb_build_object(
      'title', b.title, 'is_read', ub.is_read, 'is_collected', ub.is_collected,
      'updated_at', ub.updated_at) order by b.title), '[]'::jsonb)
    from public.user_book ub join public.book b on b.id = ub.book_id
   where ub.user_id = {{user_id}}),
  'notes', (select coalesce(jsonb_agg(jsonb_build_object(
      'title', b.title, 'notes', n.notes, 'updated_at', n.updated_at) order by b.title), '[]'::jsonb)
    from public.user_book_note n join public.book b on b.id = n.book_id
   where n.user_id = {{user_id}})
)) as export;
```

Delete the sign-in records that do not cascade (FR-4 step 4), after deleting the user — `node scripts/privacy-request.mjs delete-flow-state <user id> --linked`:

```sql
delete from auth.flow_state where user_id = {{user_id}};
```

Verify a deletion (FR-4 step 5) — `node scripts/privacy-request.mjs verify <user id> --linked`; every `remaining` must be 0. The query finds every table in `auth` and `public` with a `user_id` column (and `auth.users` itself) rather than listing them, because the set differs between Supabase versions — the local stack has no `auth.mfa_recovery_code_sets` — and grows as the app does:

```sql
select c.table_schema || '.' || c.table_name as table_name,
       (xpath('/row/n/text()', query_to_xml(
         format('select count(*) as n from %I.%I where %I::text = %L',
                c.table_schema, c.table_name, c.column_name, {{user_id}}::text),
         false, true, '')))[1]::text::int as remaining
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
 where c.table_schema in ('auth', 'public')
   and (c.column_name = 'user_id'
        or (c.table_schema = 'auth' and c.table_name = 'users' and c.column_name = 'id'))
 order by 1;
```

Any table added later that holds a user id — `profile` at Profiles M1 first — is picked up by the verification query on its own, provided the column is named `user_id`; it joins the export by hand, in the same change (FR-5).

### 12.3 Sign-in record cleanup (FR-7)

One migration, created with `supabase migration new`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'delete-expired-auth-flow-state',
  '17 3 * * *',  -- daily, 03:17 UTC
  $$delete from auth.flow_state where created_at < now() - interval '1 day'$$
);
```

To confirm at build time, so the migration is right rather than assumed: the schema Supabase expects `pg_cron` in, and that the job runs as `postgres`, which holds `DELETE` on `auth.flow_state` on both the local stack and the hosted project (checked 2026-10-02). `cron.schedule` with the same job name replaces the existing job, so the migration is safe to replay.

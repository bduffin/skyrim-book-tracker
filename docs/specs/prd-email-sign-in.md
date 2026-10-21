# PRD: Email Sign-in

> Stage: PRD — derived from `docs/specs/spec-email-sign-in.md` and grounded in `docs/architecture.md`.
> Status: Reviewed — two red-team rounds; ready for Email M0.

## Core Thesis (preserved from spec)

> GitHub is the only way to sign in, so the people most likely to be told about the site, friends sent its link by text, cannot use it unless they have a GitHub account and are willing to use it here. A player should be able to sign up with nothing but an email address they control, on their own, from the link.

---

## 1. Problem Statement

Sign-in needs a second way in that depends on no third party: an emailed one-time code (Email Decision 1). Turning on Supabase's Email provider as it stands would also turn on passwords, which Supabase cannot switch off, and with them a takeover of an account before its owner signs up, confirmed on the local stack (spec, Current State). It would also need outbound email the site cannot yet send, a rate limit Supabase applies to every visitor at once, and a privacy notice that today describes GitHub only. This PRD is the code, the database changes, the settings and the order of their rollout that turn email sign-in on safely.

## 2. Goals and Non-Goals

### Goals

- G1. Anyone can sign up and sign in with an email address and an emailed 8-digit code, with JavaScript disabled, from a `/login` page that also offers GitHub.
- G2. No account ever holds a password, so the pre-registration takeover and every other password path are closed.
- G3. No email from the site carries a link that signs someone in or changes their account.
- G4. Sign-in email is sent from `auth.arcanaeum.app`, aligned on SPF and DKIM, under a published DMARC policy.
- G5. No visitor can spend, through the site, the Auth rate limit every visitor shares.
- G6. The privacy notice and request procedure are true of email accounts on the day email sign-in is turned on.

### Non-Goals

- NG1. **Passwords, magic links, passkeys, other providers, CAPTCHA** (spec, Nice-to-have; Email Decision 1).
- NG2. **Stripping what a sign-up sends as `user_metadata`** (Email Decision 3). It is never displayed and is disclosed instead (FR-9).
- NG3. **Changing one's email address, or linking and unlinking sign-in methods, in the UI.**
- NG4. **Usernames.** The header's name rule (FR-8) leaves room for Profiles M2's username and does not build it.
- NG5. **The dev project** (`architecture.md` §13.3). It follows this rollout, before the next change to the database once real users exist; Email M2 runs its last checks on production while the developer is its only user.

## 3. Current State Analysis

The spec's Current State is the inventory, including what was verified in Supabase Auth's source and on the local stack. What this PRD builds on in the code:

- **Sign-in UI.** `GitHubLoginButton` (`src/features/auth/components/github-login-button.tsx`), a `<form action={signInWithGitHub}>`, is rendered in three places: the header (`src/components/site-header.tsx`) and, with `tone="inline"`, the signed-out prompts in `book-row.tsx` and `flag-filter-notice.tsx`. It returns the reader to the page they signed in from through the form's `Referer` (`returnPathFrom`, `src/features/auth/return-path.ts`).
- **`/auth/callback`** (`src/app/auth/callback/route.ts`) is a Route Handler that exchanges GitHub's code, sets the session cookies through the server client and redirects; its base URL comes from `x-forwarded-host` outside development. It is the precedent for FR-4 and FR-5's handlers.
- **Header name.** `getDisplayName` (`src/features/auth/get-display-name.ts`) reads `user_name`, `preferred_username`, `full_name` and `name` from `user_metadata`, then the email's local part. `UserBadge` shows `initialFor(displayName)` when there is no trusted avatar.
- **Error copy.** `src/features/auth/auth-error-message.ts` maps codes to fixed, app-written messages, and prefixes the app's own codes `app_`.
- **Sign-out.** `signOut` (`src/features/auth/actions.ts`) uses `scope: 'local'`; its comment anticipates a separate "sign out everywhere".
- **Database.** A `private` schema exists, not exposed by PostgREST, holding `private.rls_auto_enable()` with `EXECUTE` revoked from `public`, `anon` and `authenticated` (`20261001223138_enforce_rls_on_new_tables.sql`). `supabase_auth_admin` has no `USAGE` on it. The daily job `delete-expired-auth-records` (`20261003201942_schedule_auth_record_cleanup.sql`) deletes `auth.flow_state` rows over a day old and sessions unused for 90 days. On the local stack, `postgres` holds `DELETE` on `auth.users`, and `confirmation_sent_at` is a `timestamptz` (checked 2026-10-18). On the hosted project, checked the same day: `postgres` holds `TRIGGER` and `DELETE` on `auth.users`, which `supabase_auth_admin` owns, there are no triggers on it yet, and `supabase_auth_admin` has no `USAGE` on `private` there either. "Secure email change" (`double_confirm_changes`) is on in the hosted project, which Email Decision 12 relies on.
- **What a code sign-in leaves behind**, measured on the local stack on 2026-10-18 with the target settings (confirmation on, 8-digit codes for 10 minutes, a 60-second resend gap, code-only templates): every code sign-in, first or later, writes an `auth.flow_state` row linked to the user when the server's PKCE client sends the code, and verifying the code does not remove it. The row holds the user id, the method and a PKCE challenge, no provider tokens; the existing daily job deletes it within two days. A send refused by the email cap creates no user.
- **Local Auth settings** (`supabase/config.toml`): Email provider on, `enable_confirmations = false`, `otp_length = 6`, `otp_expiry = 3600`, `email_sent = 2` per hour, no custom templates; mail is caught by Mailpit at `http://127.0.0.1:54324`.
- **Prerequisite from Profiles.** Profiles M1 adds `pathAfterSignIn(userId, next)` in `src/features/profile/data.ts`, returning the path rather than redirecting, for every sign-in path to call (Profiles FR-4).

## 4. Proposed Solution

1. **`/login`** — a Server Component offering GitHub sign-in (the existing Server Action) and an email form, then a code form once a code is on its way (FR-1, FR-2).
2. **Two Route Handlers**, `POST /login/send-code` and `POST /login/verify-code`, posted by plain forms and answering with 303 redirects (FR-4, FR-5).
3. **A "Sign in" link** replacing `GitHubLoginButton` everywhere it appears outside `/login` (FR-3).
4. **Two migrations**: a trigger clearing every password (FR-6), and a daily job deleting abandoned email sign-ups (FR-7).
5. **Header name rule** (FR-8) and **Sign out everywhere** (FR-10).
6. **Local configuration** matching the hosted target: confirmation on, 8-digit codes for 10 minutes, code-only templates (FR-11).
7. **A server-side switch**, `EMAIL_SIGN_IN_ENABLED`, so the code can ship before the Email provider is on (FR-12).
8. **The hosted rollout** in Email Decision 15's order, each step confirmed on its own (§12.7).

```
GET /login  (Referer: /books?source=base)
  ├─ signed in?                 → 307 next
  ├─ pending-address cookie?    → code step   (+ "new code sent" status when sent=1)
  └─ otherwise                  → GitHub button + email form   (hidden next=/books?source=base)

Both handlers first:  Origin ≠ public origin → 403;  switch off → 404;  signed in → 303 next

POST /login/send-code  {email, next}        or, from the code step, {resend=1, next}
  ├─ address malformed          → 303 /login?error=app_email_invalid&next=…
  │    (a resend's address comes from the cookie; none left → app_code_step_expired)
  ├─ signInWithOtp(email, shouldCreateUser: true)
  │    └─ error                 → 303 /login?error=<fixed code>&next=…
  │         too soon: cookie set (code step);  address refused: cookie cleared;  else: unchanged
  └─ set pending cookie         → 303 /login?next=…                 (code step; &sent=1 on a resend)

POST /login/verify-code  {code, next}       or {reset=1, next}
  ├─ reset=1                    → clear pending cookie → 303 /login?next=…   (email step)
  ├─ no pending cookie          → 303 /login?error=app_code_step_expired&next=…
  ├─ code malformed             → 303 /login?error=app_code_invalid&next=…
  ├─ verifyOtp(email, code, type: 'email')     (session cookies set by the server client)
  │    └─ error                 → 303 /login?error=<fixed code>&next=…   (cookie kept)
  └─ clear pending cookie       → 303 pathAfterSignIn(user, next)   (Profiles FR-4)
```

**Key design tradeoffs (explicit):**

- **Route Handlers for the email steps (chosen)** vs Server Actions. A Server Action can be posted to any page and its id changes with every build, so Vercel's single Hobby rate-limit rule could not match the email steps without also matching the read and collected toggles (Email Decision 9). Fixed paths under `/login/` give the rule one stable condition. Cost: the handlers do their own origin check and their own redirects (FR-4), which a Server Action would have done for them.
- **A server-side switch (chosen)** vs holding the code back until rollout. `main` deploys to production, and the Email provider is turned on last (Email Decision 15), so code merged at Email M1 would otherwise show production visitors an email form that fails. The switch keeps the email form, the code step and the handlers off until the provider is on. The privacy notice is not behind it: it is published before the provider is turned on (§12.7), so it is true from the moment the public API can create an email account. Cost: one environment variable, removed once email sign-in has been live for a while.
- **One cookie for the pending address, `next` in the URL (chosen)** vs both in the cookie. `next` is a path on this site, not personal data, and validated wherever it is read; keeping it in the URL makes the redirect after a failure self-contained. The address never goes in a URL (Email Decision 13).

## 5. Requirements

### Functional (FR)

- **FR-1 — `/login`.** A Server Component at `src/app/login/page.tsx`, its `metadata` typed as `Metadata` with the title "Sign in" and `robots: { index: false }`.
    - **Return path.** `next` is the `next` query parameter when present, otherwise the page load's own `Referer` through `returnPathFrom`; either way it must pass `isSafeReturnPath` and must not be `/login` or under it, or it becomes `/` (Email Decision 11). It is rendered as a hidden field in every form on the page, the GitHub form included. Every redirect that carries `next` builds its query with `URLSearchParams`, so a `next` with its own query string (`/books?read=true&source=base`) arrives whole rather than as extra parameters. `next` in the query string is a link anyone can send, so FR-1's check depends on `isSafeReturnPath` refusing dot segments (Email M0).
    - **A signed-in visitor** is redirected to `next` (307), never shown the forms. Going back from the destination after signing in reaches `/login` and is redirected forward again: no POST is replayed, and the history before `/login` is still reachable through the browser's history menu, not the Back button.
    - **With no pending-address cookie**: the GitHub button (`GitHubLoginButton`, with the hidden `next`; FR-18) and an email form posting to `/login/send-code`, with one sentence saying that a different email address means a different account, and that someone who signs in with GitHub should use the address on their GitHub account to reach the same collection. With `EMAIL_SIGN_IN_ENABLED` off, the email form, the sentence and the code step are not rendered, and a leftover pending-address cookie is ignored, so the page never offers a form that posts to a handler answering 404.
    - **With the cookie**: the code form posting to `/login/verify-code`, naming the address the code went to, plus two small forms: **Send a new code** (posts the same address to `send-code`) and **Use a different address** (posts `reset=1` to `/login/verify-code`, which clears the cookie, FR-5).
    - **An `error` query parameter** is shown through FR-13's fixed messages, in a live region that exists before its content; any other value of `error` is ignored.
- **FR-2 — The code form.** One text input, `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength` long enough to allow spaces, never `type="number"`, which drops leading zeros. The handler strips spaces and requires exactly 8 digits.
- **FR-3 — "Sign in" link.** `SignInLink` (`src/features/auth/components/sign-in-link.tsx`), a plain `Link` to `/login` with the existing `header` and `inline` tones, replaces `GitHubLoginButton` in the header, `book-row.tsx` and `flag-filter-notice.tsx`. It carries no `next`: `/login` reads its own `Referer` (FR-1).
- **FR-4 — `POST /login/send-code`.** `src/app/login/send-code/route.ts`.
    1. **Origin check, failing closed.** The `Origin` header must equal the public origin, from `publicOrigin(request)` — `https://${x-forwarded-host}` outside development, `request.url`'s origin in development — moved out of `/auth/callback` into `src/features/auth/public-origin.ts` so both use one rule. A missing, `null` or different `Origin` gets a bare 403, no redirect.
    2. **Switch.** With `EMAIL_SIGN_IN_ENABLED` not `true`, 404.
    3. **Input.** `email` trimmed, at most 254 characters, one `@` with something either side; anything else redirects with `app_email_invalid`. `next` re-checked as in FR-1.
    4. **Send.** `signInWithOtp({ email, options: { shouldCreateUser: true } })` through the server client. Sign-up is open (Email Decision 2).
    5. **Answer.** On success, set the pending-address cookie (FR-5) and redirect **303** to `/login?next=…`. On error, redirect 303 to `/login?error=<code>&next=…` with the code from FR-13. Every redirect is **303**, never `NextResponse.redirect()`'s default 307, which would make the browser repeat the POST and send a second code (Email Decision 11).
- **FR-5 — `POST /login/verify-code` and the pending-address cookie.** `src/app/login/verify-code/route.ts`.
    - **Origin, switch and `next`** as FR-4.
    - **The address comes from the cookie, never the form.** No cookie redirects with `app_code_step_expired`, back to the email step. A form value naming an address is ignored.
    - **Verify.** `verifyOtp({ email, token, type: 'email' })`, which accepts the first sign-in's confirmation code and a later sign-in's code alike (spec, Current State). On success: clear the cookie, then redirect 303 to `pathAfterSignIn(userId, next)` (Profiles FR-4). The session cookies are written by the server client's `cookies().set()` before the redirect, as `/auth/callback` writes them; the response is never built in a way that drops them.
    - **On error**, redirect 303 to `/login?error=<code>&next=…`; the cookie stays, so the code step survives a wrong code.
    - **Use a different address**: `POST /login/verify-code` with `reset=1` clears the cookie and redirects 303 to `/login?next=…`, after the same Origin check.
    - **The cookie**: name `email-sign-in`, value the address, `HttpOnly`, `SameSite=Lax`, `Secure` outside development, `Path=/login`, `Max-Age=600` (the code's lifetime, FR-11). Strictly necessary for signing in, and named in the privacy notice (FR-14).
- **FR-6 — No passwords.** A migration creating `private.clear_password()` and a `before insert or update` trigger on `auth.users` that sets `new.encrypted_password := null` and does nothing else (Email Decision 3; §12.1). `security invoker`, `set search_path = ''`, `EXECUTE` revoked from `public`, `anon` and `authenticated` and granted to `supabase_auth_admin`, with `USAGE` on `private` granted to `supabase_auth_admin` for it — that role has none today (§3). No `security definer`. **It clears a password when Auth next writes the row, not before:** a row that already holds one keeps it until then — a sign-in or a confirmation is enough — and no migration clears existing rows. Accepted, because a stored password can only be used while the Email provider is on, and §12.7 step 1 counts production's rows that hold one before it is: any found are cleared by a sign-in or dealt with there, before step 6.
- **FR-7 — Abandoned email sign-ups.** A migration scheduling a daily job of its own, `delete-abandoned-email-sign-ups`, that deletes users that are unconfirmed, have an email identity, have no other identity, and whose latest code — the later of `confirmation_sent_at` and `recovery_sent_at` — went out more than a day ago (Email Decision 14; §12.2). `delete-expired-auth-records` and its applied migration are unchanged.
- **FR-8 — Header name.** A pure `headerNameFor(claims)` in `src/features/auth/header-name.ts` replaces `getDisplayName`: GitHub's `user_name` when `app_metadata.providers` includes `github` and the value is a non-empty string, otherwise `"Signed in"`. No other `user_metadata` key and never the email address (Email Decision 8). `UserBadge` shows a generic person icon rather than a letter for `"Signed in"`, since its initial would read as a name, and an empty circle as something that failed to load. The avatar follows the same rule, inside `avatarUrlFor` so that no caller can skip it, since a sign-up can plant an `avatar_url` in GitHub's exact shape as easily as a name. Profiles FR-7 puts the username ahead of both; this PRD amends it to this rule.
- **FR-9 — Leftover sign-up metadata, disclosed.** Nothing strips it (NG2). The privacy notice says an export can include profile data sent when an account was first registered (FR-14), and the export query is unchanged: it already returns `user_metadata` and every identity's `identity_data`, and never `auth.one_time_tokens`.
- **FR-10 — Sign out everywhere.** `signOutEverywhere`, a Server Action in `src/features/auth/actions.ts` calling `signOut({ scope: 'global' })`, posted from a form beside **Sign out** in the header. Failure handling and `revalidatePath('/', 'layout')` as `signOut`; a failure goes to `/auth/auth-error` with its own app code and wording (Email Decision 16).
- **FR-11 — Local configuration and templates.** `supabase/config.toml`: `enable_confirmations = true`, `otp_length = 8`, `otp_expiry = 600`, `max_frequency = "60s"` (the gap between two codes to one address, which AC-4 relies on; the local file has 1 second), and `[auth.email.template.*]` entries for `confirmation`, `magic_link`, `recovery` and `email_change` pointing at `supabase/templates/*.html` (§12.4). Each template shows `{{ .Token }}` and never `{{ .ConfirmationURL }}` or `{{ .TokenHash }}`; the subject and first line carry no code (Email Decision 12). The local stack ignores `email_sent` unless custom SMTP is configured — the CLI sets the cap to 360,000 with Mailpit — so the local cap needs no change; a test of the cap points `[auth.email.smtp]` at Mailpit (`supabase_inbucket_<project>`, port 1025), as the 2026-10-18 measurement did. The hosted value is FR-15's.
- **FR-12 — The switch.** `EMAIL_SIGN_IN_ENABLED`, a server-only environment variable read as the string `true`. Unset in production until rollout step 7 (§12.7); set in `.env.local` for development. Not `NEXT_PUBLIC_`: nothing in the browser needs it.
- **FR-13 — Error codes.** `src/features/auth/login-error-message.ts`, pure and unit-tested, in the shape of `auth-error-message.ts`: the handlers map Supabase's errors to the app's own `app_`-prefixed codes, and the page maps those codes to fixed copy. The page never renders Supabase's text or any free text from its URL.

| App code                | From                                        | Message                                                                                                                       |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app_email_invalid`     | input check; `email_address_invalid`        | That doesn't look like an email address.                                                                                      |
| `app_send_too_soon`     | `over_email_send_rate_limit`                | We couldn't send a new code just now. If one arrived in the last minute, enter it below; if not, wait a minute and try again. |
| `app_too_many`          | `over_request_rate_limit`, from either step | Too many attempts from here. Wait a few minutes, then try again.                                                              |
| `app_code_invalid`      | input check; `otp_expired`                  | That code didn't work. Check it, or send a new one — codes last 10 minutes.                                                   |
| `app_code_step_expired` | no pending-address cookie                   | Your sign-in timed out. Enter your email address again.                                                                       |
| `app_send_failed`       | any other error from `signInWithOtp`        | We couldn't send a code. Please try again.                                                                                    |
| `app_verify_failed`     | any other error from `verifyOtp`            | Something went wrong checking your code. Please try again.                                                                    |

Supabase reports a wrong code and an expired one with the same `otp_expired`, so one message covers both. Supabase reports the project-wide email cap and the per-address resend limit alike, as 429 with `over_email_send_rate_limit`, differing only in their message text ("email rate limit exceeded" against "you can only request this after 59 seconds", measured 2026-10-18). Telling them apart would mean parsing Supabase's wording, so `app_send_too_soon` covers both, worded to be true of either. A send refused this way still opens the code step: the usual cause is a second press of **Send code**, whose first press did send a code, and whose response the browser abandoned along with the cookie it set. **Send a new code** succeeding is not an error, so it is carried as `sent=1`, which, like `/settings`'s `saved=1`, carries no text of its own, and the page says a new code went out and that only the newest one works.

- **FR-14 — Privacy notice and procedure** (Privacy FR-5), published at rollout step 5 (§12.7), before the Email provider is turned on and not behind the switch, so it is already true when the public API can first create an email account:
    - `/privacy` and `LAST_UPDATED`: what email sign-in stores (the address, its confirmation and sign-in times); Resend as a processor, with where it processes data as Resend states it when the domain is set up, receiving the address and the code, keeping its logs 30 days, which deleting an account does not remove; open and click tracking off; an address typed into the form is stored before it is confirmed and deleted between one and two days after its last code if never confirmed; the `email-sign-in` cookie; sessions last until signed out, here or everywhere, or about 90 days unused; the existing "sign-in records, kept at most two days" covers email sign-ins too, each of which leaves one; an export can include profile data sent when the account was first registered; one-time codes are never exported.
    - `docs/privacy-requests.md`: an email-only account is confirmed through its mailbox alone, with no GitHub fallback, and a requester who has lost that mailbox cannot be confirmed, so nothing is deleted on an unconfirmed request; `show` prints no GitHub id for such an account.
    - Privacy spec A2 and Privacy PRD A2 repointed to this PRD.
- **FR-15 — Hosted configuration** (rollout step 3): Resend domain `auth.arcanaeum.app` verified; SPF and DKIM records for it and DMARC on the root domain published at Cloudflare (§12.6); SMTP set to Resend, sender `sign-in@auth.arcanaeum.app`; the four templates of FR-11; email OTP length 8 and expiry 600 seconds; the minimum interval between emails to one address 60 seconds; "Confirm email" on; Auth's email rate limit lowered (§12.6), with Resend's 100 a day as the daily backstop; Resend's open and click tracking off.
- **FR-16 — Firewall rule** (rollout step 4): Vercel Firewall, one rate-limit rule — method `POST` and path starting with `/login/`, keyed on IP, fixed window of 300 seconds, 10 requests, default 429 action. Ten per five minutes keeps one visitor, posting only to `send-code`, well under the 30 per five minutes Supabase allows the whole site, and is more than a real sign-in needs: a send, a few attempts at the code, a resend and a last attempt come to about six. It does not match the GitHub action, which posts to `/login` (Email Decision 9). **A request the rule blocks never reaches the app**, so the visitor sees Vercel's own 429 response, not FR-13's wording; only a visitor over the limit ever sees it, and FR-13's messages cover every refusal from Supabase.
- **FR-17 — Documentation**, in the change that does each: `CLAUDE.md`'s auth section records the second Route Handler exception, the 303 rule and the password trigger (Email M1); `architecture.md` §13 records email as a provider, the sending setup and DMARC (Email M2); Profiles FR-7 and A1 cite this PRD (this change).

- **FR-18 — GitHub sign-in from `/login`.** `GitHubLoginButton` gains the hidden `next` (FR-1), and `signInWithGitHub` takes `next` from the posted field through `loginNext`, falling back to `returnPathFrom` on the `Referer` only when the field is absent. From `/login` the `Referer` is `/login` itself, so without this every GitHub sign-in would return to the login page, from Email M1 on, while GitHub is still the only way in. `/auth/callback` still checks `next` as today.

### Non-Functional (NFR)

- **NFR-1 — Works without JavaScript.** Every step is a form posting and a redirect; every state renders on the following GET. No client component is added for sign-in.
- **NFR-2 — Accessibility.** Labeled inputs (`autocomplete="email"`, `autocomplete="one-time-code"`); errors tied to their field with `aria-describedby` and announced from a live region present before its content; the code step states where the code was sent.
- **NFR-3 — No free text from outside.** Neither the page nor a handler renders Supabase's messages or URL text (FR-13); handlers log Supabase's error object server-side, as the callback does, never the address.
- **NFR-4 — No new client exposure.** The browser Supabase client stays unused, so every Auth call keeps recording the server's address (Privacy FR-2). The CSP is unchanged: every form posts to the site itself.

## 6. Constraints and Assumptions

### Constraints

- The spec's constraints, all of them: no third-party provider as the answer, no JavaScript required, Auth on the server only, no `security definer`, the notice in the same change, hosted changes one at a time with the provider last, the Free plan.
- Migrations created with `supabase migration new`, never hand-named, never edited once applied.
- Every hosted action — a migration push, a dashboard setting, a DNS record, an environment variable — is its own confirmed step (§12.7).

### Assumptions

- A1. Profiles M1 has shipped, with `pathAfterSignIn`, and `isSafeReturnPath` refuses dot segments (Email M0).
- A2. Production has no users but the developer when Email M2 begins. If anyone else has signed up by then, the dev project of `architecture.md` §13.3 comes first, and §12.7's checks run there before production.
- A3. Few users: Resend's free plan and a low Auth email cap are ample.

## 7. Risks and Mitigations

| ID  | Risk                                                                                                          | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | The password trigger breaks GitHub sign-in, the only way in until the provider is on.                         | Low        | High   | `before` trigger assigning one column; proven on the local stack by AC-2; on production, while the developer is its only user, the developer's own GitHub sign-in and a throwaway first-time sign-up straight after the push (§12.7 step 2), with a drop migration ready, so the only account a failure could lock out is the developer's. |
| R2  | A Supabase upgrade renames `encrypted_password` or changes how a missing password is treated.                 | Low        | High   | AC-2's database tests sign up through Auth and attempt a password sign-in, so either change fails `yarn test:db`.                                                                                                                                                                                                                          |
| R3  | Sign-in mail lands in spam or is refused.                                                                     | Med        | Med    | Aligned SPF and DKIM on a dedicated subdomain, DMARC published, no tracking, plain transactional content; AC-9 checks at Gmail.                                                                                                                                                                                                            |
| R4  | Someone spends the project's email cap by calling Supabase directly, and codes stop arriving.                 | Low        | Med    | Accepted (Email Decision 9). The cap bounds the damage; FR-13's message says sending failed rather than pretending it worked.                                                                                                                                                                                                              |
| R5  | Someone learns whether an address has an account.                                                             | Med        | Low    | Accepted (Email Decision 9).                                                                                                                                                                                                                                                                                                               |
| R6  | A returning GitHub user signs in by email with a different address and finds an empty collection.             | Med        | Low    | `/login` says a different address is a different account (FR-1); merging accounts is out of scope (NG3).                                                                                                                                                                                                                                   |
| R7  | The firewall rule's counters are per region, so one visitor reaching several regions gets several allowances. | Low        | Low    | Vercel counts per region by design; 10 per five minutes per region; a visitor reaching two regions could post 20, still under Auth's 30, and reaching three would need a deliberate effort the accepted risks already cover (Email Decision 9).                                                                                            |
| R8  | The switch is turned on before the provider, or left off after it.                                            | Low        | Low    | It is its own step after the provider (§12.7 step 7); with it on and the provider off, sending fails with `app_send_failed`, nothing worse.                                                                                                                                                                                                |

## 8. Milestones

- **M0 — Prerequisites.** Profiles M1 has shipped, and `pathAfterSignIn` exists; `isSafeReturnPath` refuses a path whose dot segments resolve elsewhere (`/books/../auth/callback`), the separate fix this PRD's query-string `next` depends on. Exit: both checked on the local stack.
- **M1 — Email sign-in, local.** FR-1 to FR-13, FR-18 and the `CLAUDE.md` part of FR-17: `/login`, the two handlers, `SignInLink`, both migrations, the header rule, Sign out everywhere, local configuration and templates, the switch, the error codes. Nothing hosted changes; production runs the new `/login` with GitHub only, since the switch is unset. Exit: AC-1 to AC-8 green on the local stack; `yarn test`, `yarn test:db`, ESLint, `tsc` and Prettier clean.
- **M2 — Hosted rollout.** §12.7's steps, in order, each confirmed separately: production's readiness, the trigger and cleanup migrations on production with the GitHub checks, FR-15's settings and DNS, FR-16's rule, FR-14's notice and procedure, the provider, the switch; then the `architecture.md` part of FR-17. Exit: AC-9 to AC-13 green against production.

## 9. Acceptance Criteria

How each is checked: AC-2 and AC-3 by `yarn test:db` on the local stack; AC-4 to AC-7 by `yarn test` (`node:test`), with AC-4 and AC-5's handler cases through their pure functions and a request to the running dev server; AC-1 and AC-8 by hand in a browser with JavaScript disabled, reading codes from Mailpit; AC-9 to AC-13 by hand against production.

- AC-1. With JavaScript disabled, on the local stack: from a `/books` page with filters, **Sign in** → `/login` → email → code from Mailpit → profile setup on a first sign-in, or straight back to that `/books` URL on a later one. Refreshing or going back on the code step neither resends a code nor puts the address in the URL. The same from the GitHub button returns to that `/books` URL too, query string intact. (FR-1, FR-2, FR-4, FR-5, FR-18, NFR-1)
- AC-2. Database tests, signing up through Supabase Auth on the local stack: a sign-up with a password stores none; a password sign-in, with that password or a blank one, is refused, before the address is confirmed and after; a password set later through `PUT /auth/v1/user` is cleared; the takeover — sign-up with a chosen password, then the owner's code — leaves no password that works: the attacker's password sign-in after the owner's code fails with `invalid_credentials`. The test fails if `encrypted_password` is missing. (FR-6)
- AC-3. Database tests running the stored job command in a rolled-back transaction: it deletes an unconfirmed email-only user whose last code, sign-in or password reset, was sent over a day ago, along with its identity, sessions and one-time tokens; it keeps one whose last code went an hour ago, one whose reset code went a minute ago, one never sent a code, one with no identities, one with a `github` identity, and every confirmed user; `delete-expired-auth-records` deletes no account and still behaves as Privacy AC-8. (FR-7)
- AC-4. Each FR-13 code is produced by its condition — a malformed address, a malformed code, a wrong code, a second send within a minute, a missing cookie — and shows its fixed message; an unknown `error` value shows nothing. (FR-13, NFR-3)
- AC-5. A POST to either handler with no `Origin`, `Origin: null` or another site's origin gets 403 and changes nothing; with the switch off, both answer 404 and `/login` shows only GitHub. (FR-4, FR-12)
- AC-6. Unit tests: `headerNameFor` returns `user_name` only with `github` in `providers`, `"Signed in"` otherwise, including for a session whose `user_metadata` carries `full_name` or `name`; the email's local part never appears. (FR-8)
- AC-7. Each template in `supabase/templates/` contains `{{ .Token }}` and neither `{{ .ConfirmationURL }}` nor `{{ .TokenHash }}`, checked by a unit test reading the files. (FR-11)
- AC-8. Sign out everywhere in one browser ends the session in another. (FR-10)
- AC-9. On production, a sign-in email from the site passes SPF and DKIM aligned with `auth.arcanaeum.app` and DMARC, as shown in Gmail's "Show original", and an aggregate report has arrived at the report address. A first sign-in's email, a later sign-in's, and a recovery email requested through `/auth/v1/recover` for the developer's own address each contain the code and no URL, which is what catches a hosted template pasted wrong; the change-email template is compared with its file in the dashboard. (FR-11, FR-15)
- AC-10. On production, before the provider is turned on: an existing GitHub user signs in, refreshes and signs out, and a first-time GitHub sign-up completes with its GitHub profile intact. (FR-6, §12.7)
- AC-11. On production: no `auth.users` row has a password (every row has been written since the trigger, since its only user signs in at §12.7 step 2); the takeover of AC-2 fails; a person with no GitHub account signs up on a phone with JavaScript disabled. (FR-6, FR-1)
- AC-12. Linking on production, in every order: an existing GitHub user signing in with a code to their GitHub email reaches their collection; an email user then signing in with GitHub at the same address does too; an address pre-registered by someone else, confirmed by its owner with a code and then used with GitHub, reaches one account with no working password. (spec, Success Criterion 5)
- AC-13. `/privacy` states every FR-14 item on the day the switch is turned on, and `LAST_UPDATED` matches. (FR-14)

## 10. Success Metrics

- Sign-ups by email, from the first invitations texted after rollout.
- Zero accounts with a password in `auth.users`.
- No support message about a code that never arrived, or a sign-in that landed in the wrong place.

## 11. Open Questions

None open.

---

## 12. Technical Design

### 12.1 Password trigger (FR-6)

Created with `supabase migration new no_passwords`:

```sql
grant usage on schema private to supabase_auth_admin;

create function private.clear_password()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.encrypted_password := null;
  return new;
end;
$$;

revoke execute on function private.clear_password() from public, anon, authenticated;
grant execute on function private.clear_password() to supabase_auth_admin;

create trigger users_no_password
  before insert or update on auth.users
  for each row execute function private.clear_password();
```

`before`, assigning `new` only: it never writes the table, so it cannot fire itself, and it cannot fail on a row of any shape. Every update, not only `update of encrypted_password`, because Supabase writes whole rows as well as single columns. The local test of 2026-10-05 ran this body from `public`; the move to `private` is what needs the `USAGE` grant. It acts on rows as they are written, so an existing password is cleared by the row's next write rather than by the migration (FR-6). `postgres` can drop the trigger but not disable it, since disabling needs ownership of `auth.users` (checked on the local stack, 2026-10-21), so the ready fallback is a migration that drops it.

### 12.2 Cleanup job (FR-7)

Created with `supabase migration new delete_abandoned_email_sign_ups`, a job of its own beside `delete-expired-auth-records`:

```sql
select cron.schedule(
  'delete-abandoned-email-sign-ups',
  '27 3 * * *',
  $$
    delete from auth.users u
     where u.email_confirmed_at is null
       and greatest(u.confirmation_sent_at, u.recovery_sent_at)
           < now() - interval '1 day'
       and exists (select 1 from auth.identities i
                    where i.user_id = u.id and i.provider = 'email')
       and not exists (select 1 from auth.identities i
                        where i.user_id = u.id and i.provider <> 'email');
  $$
);
```

A separate job, not a third statement in `delete-expired-auth-records`: pg_cron runs a job's command as one transaction, so an error in this delete would roll that job's deletes back every night, and Privacy FR-7 depends on them. "The latest code" is the later of `confirmation_sent_at` and `recovery_sent_at`, since a password-reset email is a way to receive a sign-in code (Email Decision 12); `greatest` ignores nulls, and with neither set the account is kept. Deleting the user cascades to its identity, sessions and one-time tokens; its `auth.flow_state` rows, which do not cascade, go by `delete-expired-auth-records` within a day. The job runs once a day, so an account goes between one and two days after its last code.

### 12.3 Handlers and page (FR-1 to FR-5, FR-13)

- `src/features/auth/public-origin.ts`: `publicOrigin(request)`, the callback's existing base-URL logic, and `isSameOrigin(originHeader, publicOrigin)` — pure, so both are unit-tested; the callback switches to it with no change in behavior.
- `src/features/auth/email-sign-in.ts`: pure `parseEmail(value)`, `parseCode(value)` (strip whitespace, exactly 8 digits) and `loginNext(value)` (FR-1's rule: `isSafeReturnPath`, not `/login` or under it, else `/`).
- `src/features/auth/login-error-message.ts`: FR-13's table, as `Map`s like `auth-error-message.ts`.
- Handlers use `createClient()` from `src/lib/supabase/server.ts`, created inside the handler; redirects are `NextResponse.redirect(url, 303)` with `url` built on `publicOrigin`.
- `/login` reads `headers()` for `Referer` and `cookies()` for the pending address, and `getClaims()` for the signed-in check.

### 12.4 Templates (FR-11)

`supabase/templates/{confirmation,magic_link,recovery,email_change}.html`, referenced from `config.toml` as `[auth.email.template.confirmation]` etc. with `subject` and `content_path`, and pasted into the hosted dashboard at rollout step 3. Draft body, the same for all four apart from the change-email wording:

```html
<p>Here is the code you asked for to sign in to Arcanaeum.</p>
<p style="font-size: 24px; letter-spacing: 4px">{{ .Token }}</p>
<p>
    It works for 10 minutes. If you didn't ask for it, you can ignore this
    email.
</p>
```

Subject: "Your Arcanaeum sign-in code". The recovery template uses the same text and never mentions passwords.

### 12.5 Header and sign-out (FR-8, FR-10)

`SiteHeader` passes `headerNameFor(claims)` to `UserBadge` in place of `getDisplayName(claims)`; `getDisplayName` is deleted once nothing imports it. The header's signed-in group gains a second small form for `signOutEverywhere`. `SignInLink` replaces the signed-out branch.

### 12.6 Sending domain (FR-15)

At Cloudflare DNS, the records Resend's dashboard lists for `auth.arcanaeum.app` (its DKIM key and its return-path MX and SPF, all under the subdomain), copied from there rather than from this PRD; and at the root domain, `_dmarc.arcanaeum.app` `TXT` `v=DMARC1; p=none; rua=mailto:dmarc@arcanaeum.app`, with a Cloudflare Email Routing rule forwarding `dmarc@` like `privacy@`. The root domain's existing SPF and MX records, Email Routing's, are not touched. Thirty days of reports showing only Resend's aligned mail from the subdomain move it to `sp=quarantine` (Email Decision 7) — a later, separate change. Auth's email cap: 10 an hour, enough for several friends signing up at once. It bounds a burst; Resend's free-plan limit of 100 a day bounds a day, and pauses sending rather than charging, which fails closed. Revisited if real use comes near either.

### 12.7 Rollout order (Email M2)

Each step is confirmed in chat before it is done, and checked before the next.

1. **Readiness.** Confirm production has no users but the developer (otherwise §13.3 first, A2) and that "Confirm email" is on; count `auth.users` rows whose `encrypted_password` is neither null nor empty, since the trigger clears a password only when its row is next written (FR-6); have a migration dropping the trigger written and ready.
2. **Production migrations.** Push both; confirm `users_no_password` exists on `auth.users` and `delete-abandoned-email-sign-ups` is scheduled beside an unchanged `delete-expired-auth-records`, since the CLI pushes through a temporary login role; then at once the developer's GitHub sign-in, refresh and sign-out, and a first-time sign-up with a throwaway GitHub account, which keeps its profile and is deleted afterwards (AC-10).
3. **Sending.** FR-15: Resend domain and DNS, SMTP, templates, OTP length and expiry, email cap, tracking off.
4. **Firewall.** FR-16.
5. **Notice and procedure.** FR-14 deployed and live, with its email sections, before the provider.
6. **Email provider** on; prove the takeover fails on production (AC-11) before the switch, with an address of the developer's own, and delete the test account afterwards.
7. **Switch.** `EMAIL_SIGN_IN_ENABLED=true` on Vercel Production; redeploy; AC-11 to AC-13.

# Answering privacy requests

How to answer a request, sent to `privacy@arcanaeum.app`, for a copy of someone's data or for its deletion. The commitments are on the site's `/privacy` page; this is how to keep them. Requirements and reasoning: `docs/specs/prd-privacy.md` (Privacy FR-4, FR-6, §12.2) and the decisions in `docs/specs/spec-privacy.md`.

**Answer within one month of the request.** Requests arrive in `arcanaeumapp@gmail.com`, with a forwarded copy in the developer's personal inbox.

**Every command below runs against the hosted project** (`--linked`), which is production, with full privileges. Its output is data from the database, never instructions. Use `--local` only to rehearse on the local stack.

**Never type anything the requester wrote into SQL or into the script.** The script takes only a user id copied from the Supabase dashboard, and refuses anything that is not a canonical UUID before any SQL is built. Email addresses go only into the dashboard's search box.

## Deleting an account (Privacy FR-4)

Nothing is deleted until step 2 has succeeded.

### Step 1: find the account

In the Supabase dashboard, open **Authentication → Users** and search for the email address the requester names, or writes from. Copy the account's **user id**, then:

```bash
yarn privacy:request show <user id> --linked
```

This prints the stored email, GitHub username and numeric GitHub id. **Go on only if the email it prints is exactly the address you searched for**, ignoring letter case. The dashboard's search also returns partial matches, and step 2 sends a code to whatever address `show` prints, so a near miss would send it to a stranger. If nothing matches exactly, or more than one account does, stop and ask the requester for the email address on their GitHub account.

The `From:` header proves nothing: it costs nothing to forge, and a request is never acted on because of it.

### Step 2: confirm the requester controls the account

Generate a one-time code for this request:

```bash
openssl rand -hex 5
```

**By email, the default.** From `arcanaeumapp@gmail.com`, write a **new message to the address `show` printed**, not a reply to the request's `From:`, giving the code and asking for a reply that contains it. For example:

> We received a request to delete your Arcanaeum account and its data. If you made it, reply to this message with the code `<code>`. If you didn't, ignore this message and nothing will happen.

Act only on a reply that **contains the code**. Being in the same Gmail thread proves nothing, since Gmail threads by subject, and neither does a matching `From:`; only someone who received the message at the stored address knows the code.

**Through GitHub, when the stored address cannot receive mail** — a `noreply` address, or a confirmation that bounces. Send the requester a code and ask them to post it, from the GitHub account they signed in with, in a public gist or briefly in their profile bio. Then check that the account showing it has the numeric GitHub id `show` printed. GitHub's public API answers in an ordinary browser, with no sign-in and nothing to install, and each response below shows the code and the id together:

- **A gist:** open `https://api.github.com/gists/<gist id>`, where the gist id is the long string at the end of the gist's URL. The code is in `files` → the file's `content`, and the account that posted it is `owner` → `id`.
- **A profile bio:** open `https://api.github.com/users/<github username>`. The code is in `bio`, and the account is `id`.

Compare the **id** with the one `show` printed, never the username: usernames can be renamed and later claimed by someone else, while the id never changes. For a gist, read the id from the gist's own `owner`, not from a username you typed.

### Step 3: delete the user

In the dashboard: **Authentication → Users →** the user **→ Delete user**. This removes the account and cascades to its identity, sessions and refresh tokens, its marks and notes, and the other `auth` tables that reference users.

The user's browser can still look signed in for up to an hour, until its access token expires, since the app verifies tokens without asking Supabase. Nothing it tries to save will succeed.

### Step 4: delete the sign-in records

`auth.flow_state` has no foreign key to `auth.users`, so its rows survive step 3, and a row can hold the user's GitHub tokens:

```bash
yarn privacy:request delete-flow-state <user id> --linked
```

It prints how many it deleted, which may be none: the daily cleanup (Privacy FR-7) removes records over a day old anyway.

### Step 5: check the result

```bash
yarn privacy:request verify <user id> --linked
```

It counts the rows for that id in every table in `auth` and `public` that has a `user_id` column, and in `auth.users`, and ends with `Clean` only if every count is 0. **Anything else stops the procedure** until it is explained: a non-zero count means a table that does not cascade, which is a change to Privacy FR-4 as well as to this request.

### Step 6: reply

In the confirmation thread, say that the account and its data are deleted. Add that they can also revoke the app's access to their GitHub account under GitHub's **Settings → Applications → Authorized OAuth Apps**, which only they can do.

### Step 7: clean up the correspondence

Straight away, delete the forwarded copy in the developer's personal inbox: it only duplicates the project mailbox. In `arcanaeumapp@gmail.com`, keep the thread for **12 months** after the reply, as the record that the request was handled, then delete it (Privacy Decision 7).

## Sending a copy of someone's data (Privacy FR-6)

Find the account and confirm the requester controls it exactly as in steps 1 and 2 above. Then write the export to a temporary file, outside the repository:

```bash
yarn privacy:request export <user id> --linked > "$TMPDIR/arcanaeum-data.json"
```

It holds the account, the GitHub identity, sessions, the dates and method of each sign-in record (never the GitHub tokens, which are credentials rather than information about the user), marks and notes. Open it before sending, and check it names the right account.

Reply in the confirmation thread with the file attached, then delete the file. Clean up the correspondence as in step 7: the Sent copy carries the export, so it is held to the same 12 months.

## Keeping this current

A new table holding a user id is found by `verify` on its own if its column is named `user_id`, but must be added to the export in `scripts/lib/privacy-sql.mts` by hand, in the same change. `profile` (Profiles M1) is the first. Anything that changes what is collected also changes `/privacy` first (Privacy FR-5).

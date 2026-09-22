# Skyrim Book Tracker

A web app for tracking your library in _The Elder Scrolls V: Skyrim_ — which books you have **read** and which you have **collected**, tracked separately, since neither implies the other in game. Plus where to find each one and which skill it raises.

## Status

Early. Not yet usable as a book tracker — the catalog imports, but nothing renders it.

| Part                                        | State                                |
| ------------------------------------------- | ------------------------------------ |
| GitHub sign-in                              | Works                                |
| Database schema and row-level security      | Works                                |
| UESP catalog import                         | Works — 1,207 books, 2,327 locations |
| Browsing, searching, marking read/collected | Not built                            |

## Attribution and licensing

Two different licences cover two different things in this repository.

**The code** is licensed **GPL-3.0-or-later**. See [`LICENSE`](LICENSE).

**The book data** comes from the [Unofficial Elder Scrolls Pages](https://en.uesp.net) (UESP) and is licensed **[CC BY-SA 2.5](https://en.uesp.net/wiki/UESPWiki:Copyright_and_Ownership)**. It is derived from the `uespwiki-2026-08-30-current.xml.bz2` database dump published at [dumps.uesp.net](https://dumps.uesp.net), and covers book titles, categories, authors, in-game identifiers, skill effects, and locations. UESP is an independent community project and is not affiliated with Bethesda Softworks.

Share-alike applies to that data: redistributing it, or a derivative of it, requires the same attribution and licence. The dump itself is not committed to this repository — see [Importing the catalog](#importing-the-catalog).

_The Elder Scrolls_ and _Skyrim_ are trademarks of Bethesda Softworks LLC. This project is unofficial and unaffiliated.

## Getting started

Requires **Node 24** (see [`.nvmrc`](.nvmrc)), the **Supabase CLI**, and **Docker**, which the local Supabase stack runs in.

### Prerequisites on macOS with Homebrew

```bash
brew install node@24
brew install supabase
brew install --cask docker-desktop
```

`node@24` is keg-only, so Homebrew does not put it on your `PATH`. Either follow the `brew install` caveat it prints, or use [nvm](https://github.com/nvm-sh/nvm) and let [`.nvmrc`](.nvmrc) pick the version:

```bash
nvm use            # reads .nvmrc
node --version     # expect v24.x
```

Docker Desktop must be **running**, not merely installed — `supabase start` talks to its daemon. Launch it once from Applications (it asks for privileges on first run), or `open -a Docker`. Any other Docker daemon works too; [Colima](https://github.com/abiosoft/colima) is a lighter alternative.

Other platforms aren't written up yet. The only macOS-specific parts are the three installs above.

### Then, from a fresh checkout

```bash
corepack enable          # Yarn 4.17.1 is pinned via packageManager
yarn install
supabase start           # Postgres + Auth + PostgREST on localhost; applies migrations
yarn dev
```

`supabase start` prints the local API URL and keys. Put the publishable one in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

These are the newer Supabase key names, not the legacy `ANON_KEY`. GitHub sign-in additionally needs an OAuth app; see [`docs/architecture.md`](docs/architecture.md).

## Importing the catalog

The book data is built from a UESP XML dump, which is ~185 MB compressed and is **not** committed. Download `uespwiki-<date>-current.xml.bz2` from [dumps.uesp.net](https://dumps.uesp.net) into `data/` (gitignored), then:

```bash
# Parse and report, writing nothing. Needs no database and no credentials.
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --dry-run

# Write to the local stack. Prompts for the secret key with input hidden.
yarn import:uesp data/uespwiki-2026-08-30-current.xml.bz2 --url=http://127.0.0.1:54321
```

The importer refuses to write to a non-localhost database unless `--allow-remote` is passed, because the secret key bypasses row-level security. A full pass reads ~470,000 pages in about 35 seconds.

See [`docs/specs/prd-import-uesp-books.md`](docs/specs/prd-import-uesp-books.md) for what it extracts and why.

## Checks

There is no CI yet, so run these before committing:

```bash
yarn lint
node_modules/.bin/tsc --noEmit -p tsconfig.json
yarn format:check
yarn test
supabase db advisors --local --type security
```

`yarn test` is the unit suite — pure functions only, no Docker, no database, under a second.

### Database tests

```bash
supabase start     # if it isn't already running
yarn test:db
```

Separate from `yarn test` because these need the local stack up. They cover behaviour no unit test can reach: that PostgREST's join semantics mean what the queries assume, and that row-level security scopes a viewer to their own rows. A mocked client would only prove the mock agrees with the code.

Three things worth knowing:

- **No `.env.local` needed.** The tests read the stack's URL and keys from `supabase status`, deliberately, rather than from `.env.local` — which points wherever you last pointed it.
- **No catalog import needed.** They insert their own book fixtures and assert against a measured baseline, so they pass on a stack that has only had `supabase start` run against it. The ~185 MB UESP dump is not a prerequisite.
- **Local only.** They create a user and write rows using the secret key, which bypasses RLS, so they refuse to run against a non-localhost host — the same `isLocalHost` guard the importer uses. They clean up after themselves.

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — stack, data model, security model
- [`docs/specs/`](docs/specs) — per-feature specs and PRDs
- [`CLAUDE.md`](CLAUDE.md) — conventions and gotchas that aren't obvious from the code

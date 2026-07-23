# Deploying the SADKO comparer engine

> **Start with [LAUNCH.md](LAUNCH.md).** That is the current, researched,
> step-by-step guide to putting this online, with free-tier limits verified on
> 2026-07-22. This file is kept for the engine-specific background and the
> environment-variable reference.
>
> **Correction:** an earlier version of this file recommended Fly.io as the free
> starting point. **Fly.io no longer offers a free tier to new accounts** — the
> permanent allowance was withdrawn in October 2024, and only legacy
> organisations keep it. Fly is still a good *paid* option at roughly
> US$4–6/month using the `Dockerfile` and `fly.toml` in this repo. For a
> genuinely free host, LAUNCH.md recommends an Oracle Cloud Always Free ARM VM.

## Why not Vercel (or Netlify, or any serverless platform)

The engine is a **stateful, long-running server**, not a serverless function. It:

- reads and writes a SQLite catalog on disk (`site/data/catalog.db`),
- holds an in-memory offer index and running search jobs,
- continues background work (crawl + Tavily discovery waves) *after* the HTTP
  response is sent,
- runs a 15-minute refresher on a timer,
- optionally spawns headless Chrome.

Serverless platforms give you none of that: functions are stateless, their disk
is ephemeral and read-only, they are killed the moment the response returns
(so background waves never finish), and they cap execution at seconds. Deploying
this to Vercel would produce a server that appears to start and then loses its
catalog, kills every crawl mid-flight, and cannot hold the index. It is the
wrong tool, and no amount of configuration changes that.

You need a host that runs a **real container or VM as an always-on process**.

## What works (free or free-tier), best fit first

| Host | Fit | Free? | Caveat |
|---|---|---|---|
| **Fly.io** | ✅ real process + volumes | ❌ **paid** (~$4–6/mo) | free tier withdrawn for new accounts, Oct 2024 |
| **Oracle Cloud Always Free** | ✅ genuine always-on VM (2 OCPU / 12 GB ARM) | free forever | halved June 2026; manual VM + SSH; card check |
| **Railway** | ✅ real process + volumes | $5 credit/mo | trial credit, not unlimited |
| **Render** | ❌ not on free | free web service | sleeps after 15 min **and free services cannot attach a disk** |

See LAUNCH.md for the recommended path. This repo already contains a working
`Dockerfile` and `fly.toml`, which remain correct for the paid Fly option.

## Deploy to Fly.io (paid fallback)

Prerequisites: a Fly.io account (paid — a card is required; there is no free tier)
and the `flyctl` CLI (`https://fly.io/docs/flyctl/install/`).

```bash
# from the repo root
fly auth login
fly launch --no-deploy          # detects the Dockerfile + fly.toml; pick a unique app name

# set the API keys as SECRETS (never commit them):
fly secrets set NVIDIA_API_KEY=<your-nvidia-key>
fly secrets set TAVILY_API_KEY=<your-tavily-key>
# both are OPTIONAL — the engine runs fully without them, just with fewer
# smarts (no AI relevance, no Tavily discovery).

fly deploy
fly open                        # opens https://<app>.fly.dev — go to /compare.html
```

The 6,918-offer catalog is baked into the image, so search works the instant it
boots. See the persistence note in `fly.toml` before running the crawler in
production.

## Deploy to Oracle Cloud Always Free (genuinely free forever)

Best if you want to run the crawler continuously with no billing at all.

1. Create an Always Free **Ampere A1** VM (Ubuntu). As of June 2026 the free
   allowance is 2 OCPU / 12 GB RAM — still plenty for headless Chrome, which
   the container build here omits for leanness. See LAUNCH.md for the full walkthrough.
2. Install Node 24 (`https://github.com/nodesource/distributions`).
3. `git clone` this repo, `cd site`.
4. Create `site/.env` with `NVIDIA_API_KEY=` and `TAVILY_API_KEY=` (this file is
   gitignored — never commit it).
5. Run under a process manager so it restarts on reboot:
   ```bash
   npm i -g pm2   # pm2 is the only external tool; the engine itself has zero deps
   pm2 start compare-server.mjs --name sadko --update-env
   pm2 save && pm2 startup
   ```
6. Open port 8082 (or set `PORT=80`) in the VM's security list, point a domain
   at it, and put it behind a TLS terminator (Caddy or nginx) for HTTPS.

## Environment variables (all hosts)

| Variable | Required | Effect if unset |
|---|---|---|
| `PORT` | no | defaults to 8082 (hosts usually set 8080) |
| `NVIDIA_API_KEY` | no | AI query understanding + relevance disabled; rule-based path used |
| `TAVILY_API_KEY` | no | URL-discovery fallback disabled; registry + catalog only |
| `GOOGLE_CLIENT_ID` | no | "Continue with Google" is hidden; email + password sign-in still works |
| `MICROSOFT_CLIENT_ID` | no | Microsoft tokens are not accepted (see the note below) |
| `ADMIN_EMAILS` | no | the owner control room (`/admin.html`) has no administrators — nobody can get in |

## Admin control room (`/admin.html`)

The owner console lets you manage **every product** (price, title, image,
description, category — plus add, hide or delete), **orders** (see all of them
and change status), **customers**, the **buying-guide / finder content**, and
**site settings**. To turn it on:

1. Set `ADMIN_EMAILS` to your email (comma-separated for several owners), e.g.
   in `/etc/sadko.env`: `ADMIN_EMAILS=you@sadko-group.com` — then restart the
   service. This is the **only** thing that grants admin access: an account
   becomes an admin purely by signing in with a listed email, so a bug in the
   web layer can never mint one.
2. Register a normal account with that exact email (Account page → sign up).
3. Open **`/admin.html`** (or use the "Control room" banner that now appears on
   your Account page) and sign in.

Your edits are stored as a thin **overlay** on top of the scraped catalogue in
`site/data/catalog-admin.db`, never written back into `data/products.json`. So a
re-crawl refreshes the base catalogue without wiping your changes, and the
storefront reflects every edit instantly (the server merges the two when it
serves `/data/products.json`). That database — and any images you upload, which
land in `site/data/uploads/` — live **only on the server volume**, so:

- they need the same **persistent `site/data` volume** as `accounts.db`;
- they are in `.gitignore` (never committed); back them up with the rest — the
  nightly `deploy/backup.sh` already includes `catalog-admin.db`.

## Customer accounts

Accounts, sessions, home profiles and orders live in **SQLite** at
`site/data/accounts.db` (`site/engine/accounts-db.mjs`), migrated automatically
from any older `accounts.json` on first boot. Two things follow from that:

- **Give the container a persistent volume mounted at `site/data`**, or every
  deploy wipes customer accounts and order history along with the catalog.
- **That database is personal data.** `accounts.db` and its `-wal`/`-shm`
  siblings are in `.gitignore` — keep them there. It holds names, emails, phone
  numbers, delivery addresses and scrypt password hashes. It holds no card
  data, because the site never collects any. Back it up with
  `sqlite3 accounts.db ".backup accounts-backup.db"` (safe while running).

Passwords are scrypt-hashed with a per-user salt; the session cookie is
HttpOnly/SameSite=Lax (and Secure once you are behind HTTPS, which Fly's
`force_https` gives you). No email verification or password reset exists yet —
both need an outbound mail service, so the UI currently tells people to call
customer care instead of pretending a reset email was sent.

## Sign in with Google (free, optional)

The code is complete and verifies tokens server-side
(`site/engine/oidc.mjs`, 17 tests in `oidc.test.mjs`). It only needs a client
id, which costs nothing:

1. Open <https://console.cloud.google.com/apis/credentials> and create (or pick)
   a project.
2. **Create credentials → OAuth client ID → Web application.**
3. Under *Authorised JavaScript origins* add exactly the origin you serve from,
   e.g. `https://sadko-comparer.fly.dev` (and `http://localhost:8082` for local
   work). No redirect URI is needed — this uses the Google Identity Services
   button, which returns an ID token directly.
4. Copy the client id and set it on the host:

```bash
fly secrets set GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
```

There is **no client secret** in this flow, so nothing sensitive is stored in
the repo or the image. With the variable unset, the account page explains that
Google sign-in is not enabled rather than showing a button that cannot work.

What the server checks before trusting a Google token: RS256 signature against
Google's published JWKS, `iss`, `aud` equal to your client id, `exp`/`iat`
within a small skew, and the per-attempt `nonce`. An account is only linked to
an existing password account when Google reports `email_verified: true`.

**Microsoft** is defined and its verification is tested, but the browser side
still needs a redirect/MSAL flow, so no Microsoft button is rendered yet. Set
`MICROSOFT_CLIENT_ID` only once that front-end flow exists.

## Keeping the catalog fresh

The catalog is a snapshot. To refresh or extend it, run the crawler on the host:

```bash
cd site && node ../scripts/crawl-m1.mjs --max 800
```

On a host with a persistent volume this accumulates; without one it is lost on
the next redeploy (the baked snapshot returns). See `fly.toml` for the volume
upgrade path.

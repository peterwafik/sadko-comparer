# Deploying the SADKO comparer engine

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
| **Fly.io** | ✅ real process + volumes | free allowance | needs a card on file even for free |
| **Oracle Cloud Always Free** | ✅ genuine always-on VM (24 GB ARM) | free forever | manual VM + SSH setup |
| **Railway** | ✅ real process + volumes | $5 credit/mo | trial credit, not unlimited |
| **Render** | ⚠️ works but | free web service | spins down when idle; ephemeral disk loses the catalog on restart |

Fly.io is the recommended starting point: this repo already contains a working
`Dockerfile` and `fly.toml`.

## Deploy to Fly.io (recommended)

Prerequisites: a Fly.io account (a card is required even on the free allowance)
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

1. Create an Always Free **Ampere A1** VM (Ubuntu). It has 24 GB RAM — plenty
   for headless Chrome, which the container build here omits for leanness.
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

## Keeping the catalog fresh

The catalog is a snapshot. To refresh or extend it, run the crawler on the host:

```bash
cd site && node ../scripts/crawl-m1.mjs --max 800
```

On a host with a persistent volume this accumulates; without one it is lost on
the next redeploy (the baked snapshot returns). See `fly.toml` for the volume
upgrade path.

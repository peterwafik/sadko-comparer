# SADKO — Launch Guide

**How to put this site on the internet, for as close to zero cost as is honestly possible.**

Every free-tier figure in this document was checked with a web search on
**2026‑07‑22**. Free tiers change without notice — Oracle halved theirs in June
2026 with no announcement at all — so treat every number as *verified on that
date*, not as a permanent truth. Anything I could not confirm is marked
**⚠️ verify**.

---

## 1. The verdict

> **Decision taken (2026-07-22): Google Cloud `e2-medium`, on the $300 / 90-day
> trial credit.** Go straight to **§5G** for that walkthrough. The reasoning
> below still stands for what happens after the credit runs out — §5G.11 covers
> that fork. §3.1 explains why `e2-medium` and not Cloud Run or the free
> `e2-micro`.

**Run the whole thing as one Node process on one Oracle Cloud "Always Free"
Ampere A1 ARM VM, with Cloudflare (free plan) in front of it for DNS, TLS and
caching, and Google sign-in enabled by a free `GOOGLE_CLIENT_ID`.** That is the
only combination I found that is *genuinely* free with no expiry and still does
everything SADKO actually needs: a long-lived process, arbitrary outbound HTTPS
to Egyptian retailer sites, a real headless Chromium, an on-disk SQLite file
that survives restarts, and background jobs on a timer. Oracle's Always Free
allowance — 2 OCPU / 12 GB RAM ARM, 200 GB block storage, 10 TB egress per month
— is more machine than this project will need for a long time, and it costs
nothing forever rather than for 7 days. The honest price of that is friction:
Oracle wants a real (non-prepaid) card for identity checks, ARM capacity in
popular regions is often exhausted, and Oracle reclaims genuinely idle
instances. If any of that blocks you, the **paid fallback is Fly.io at roughly
US$4–6/month** using the `Dockerfile` and `fly.toml` already in this repo — but
be clear that **Fly.io no longer has a free tier for new accounts**, so the old
advice in `DEPLOY.md` is out of date.

---

## 2. What SADKO is, architecturally — and why that rules things out

`site/compare-server.mjs` is **one Node 24 process, with zero npm
dependencies**, that does two very different jobs at once:

| Job | What it needs |
|---|---|
| Serve the static site (`index.html`, `compare.html`, `assets/`, …) | Nothing special. A CDN would do it better. |
| Run the price-comparison engine | A real always-on server. Nothing else works. |

The comparer's requirements, concretely:

- **Arbitrary outbound HTTPS** to whatever Egyptian retailer domain is in
  `site/data/stores.json` (B.TECH, 2B, Raya, …). Not a fixed allow-list.
- **A real headless Chromium**, spawned as a child process and driven over the
  CDP *pipe* transport (`site/headless.mjs`). It is pre-warmed at boot and kept
  alive between requests. B.TECH's search API is bearer-gated, so the only way
  to read it is to let the store's own page fire its own authorized `fetch`.
- **An on-disk SQLite database** (`node:sqlite`, `DatabaseSync`, WAL mode, FTS5)
  at `site/data/`. Writes happen continuously as crawls land.
- **Background work that outlives the HTTP response** — crawl waves and Tavily
  discovery keep running after the response is sent — plus a `setInterval`
  refresher (`REFRESH_AFTER = 3h`) and a debounced index writer.
- **In-memory state**: the offer index and running search jobs.

### What this eliminates, and why

- **Vercel / Netlify / Cloudflare Workers / Firebase Functions / any FaaS.**
  Functions are stateless, their disk is ephemeral, they are frozen or killed
  the moment the response returns (so a background crawl wave never finishes),
  and they cap CPU in milliseconds. Cloudflare Workers give you **10 ms of CPU
  per invocation on the free plan** — the comparer spends longer than that
  parsing one page. This is not a configuration problem.
- **Anything that sleeps.** Render's free web services **spin down after 15
  minutes of inactivity** and take about a minute to come back. A sleeping
  process cannot run a 3-hour refresher, and the headless Chrome cold start gets
  paid by a real customer.
- **Anything with an ephemeral disk.** Render free instances **cannot attach a
  persistent disk at all**. The SQLite catalog would reset to the baked snapshot
  on every restart, and — once accounts move into SQLite — customer accounts and
  orders would vanish with it.

### The split-vs-single decision

You *could* split it:

- **Static pages** → Cloudflare Pages (free, unlimited bandwidth, free TLS,
  custom domain).
- **Auth + customer data** → Supabase or Firebase (free, managed).
- **The comparer** → still a VM. There is no way around this one.

**Recommendation for v1: do not split.** You would still be operating a VM, so
you'd have gone from one thing to three, added a cross-origin cookie/CORS
problem you don't currently have, and — critically — broken the **zero
dependencies, zero build step** property that makes this repo deployable by
copying a folder. `supabase-js` or the Firebase SDK means a package manager, a
bundler, and a build pipeline that does not exist today.

**Split later, and split only the static half.** Once traffic is real, putting
Cloudflare in front (§5.7) gives you most of the CDN benefit with none of the
architectural cost, because Cloudflare caches your static assets at the edge
while the same origin still serves `/api/*`. That is the sequencing I'd
actually follow.

---

## 3. The options, compared

All figures **checked 2026‑07‑22**. "Headless Chrome" means: can you spawn and
keep a real Chromium process.

| Option | Free allowance | Headless Chrome? | Persistent disk? | Sleeps? | Custom domain | Good for |
|---|---|---|---|---|---|---|
| **Oracle Cloud Always Free** | 2 OCPU + 12 GB RAM ARM (1,500 OCPU-hrs + 9,000 GB-hrs/mo), 200 GB block storage, **10 TB egress/mo**, forever | ✅ yes, it's a full VM | ✅ 200 GB | ❌ never — but **idle instances can be reclaimed** (see below) | via your own DNS + Caddy/Cloudflare | **← recommended.** The whole of SADKO |
| **Fly.io** | ❌ **no free tier for new customers.** Trial only. Legacy orgs keep 3×256 MB VMs + 3 GB volume | ✅ (add Chromium to the Dockerfile) | ✅ volumes, $0.15/GB/mo | optional (`auto_stop_machines`) | ✅ free `*.fly.dev` + custom | Easiest paid path; ~$3.32/mo for a 512 MB machine |
| **Google Compute Engine (Always Free)** | 1 × `e2-micro` — 2 shared vCPU, **1 GB RAM**, 30 GB disk, **1 GB egress/mo**, `us-west1`/`us-central1`/`us-east1` only | ⚠️ technically, but 1 GB RAM is very tight for Node + Chromium | ✅ 30 GB | ❌ never | ✅ via your own DNS | Works, but see §3.1 — the RAM and egress are ~1/12 and ~1/10,000 of Oracle's |
| **Google Cloud Run** | 2 M requests, 180 K vCPU-s, 360 K GB-s, 1 GB egress/mo | ⚠️ possible per-instance | ❌ **no POSIX disk** — GCS FUSE has *no file locking* | ✅ (that is the problem) | ✅ | ❌ **Not for this app as written** — see §3.1 |
| **Northflank (Sandbox)** | 2 services, 1 database, 2 cron jobs, **always-on, no sleeping**; exact vCPU/RAM/volume **⚠️ verify** | probably (containers) | claimed yes — **⚠️ verify size** | ❌ no | ✅ | Strongest of the PaaS free tiers; verify the numbers before committing |
| **Render (Free)** | 750 instance-hrs/mo, 512 MB / 0.1 CPU, 100 GB bandwidth | ⚠️ 512 MB is very tight for Chromium | ❌ **free services cannot attach a disk** | ✅ **after 15 min idle** | ✅ + free TLS | Static sites, demos. **Not** the comparer |
| **Railway** | Hobby $5/mo with $5 usage included; usage-based, no hard cap | ✅ | ✅ | no | ✅ | Fine if you accept a bill |
| **Koyeb** | Free tier exists but the Starter plan is reported **closed to new users** after the Mistral AI acquisition — **⚠️ verify**; the listed free Postgres is 0.25 vCPU / 1 GB / 1 GB storage | ⚠️ | small | ⚠️ | ✅ | Uncertain roadmap — I'd skip it |
| **Cloudflare Pages** | Unlimited bandwidth & requests, 500 builds/mo, free TLS, custom domain, no card | ❌ static only | ❌ | ❌ | ✅ | **The static half of SADKO** |
| **Cloudflare Workers** | 100,000 req/day, **10 ms CPU per invocation** | ❌ | ❌ (D1/R2 instead) | n/a | ✅ | Small edge APIs. Not this engine |
| **Cloudflare Browser Rendering** | Free plan: **10 browser-minutes/day**, 3 concurrent browsers, 60 s timeout | ✅ but 10 min/day | ❌ | n/a | n/a | A toy budget. Real use is the paid plan |
| **Firebase (Spark)** | Hosting 10 GB storage + **360 MB/day** transfer; Auth **50 K MAU**; Firestore 1 GiB, 50 K reads / 20 K writes / 20 K deletes per day, 10 GiB egress/mo | ❌ | Firestore only | n/a | ✅ + free SSL | Auth + static, **if** you accept the catch below |
| **Supabase (Free)** | 500 MB Postgres (shared CPU, 500 MB RAM), 1 GB file storage, 5 GB egress, **50,000 MAU**, 2 projects, 500 K Edge Function invocations | ❌ | Postgres only | **projects pause after 1 week of inactivity** | ❌ **not on Free** | Managed auth + DB, if you go the split route |
| **Appwrite Cloud (Free)** | 1 org, 2 projects, 1 database, 3 buckets, **5 functions** (reduced to 2 in a Jan 2026 changelog — **⚠️ verify**), ~2 TB bandwidth, 2 M realtime msgs/mo | ❌ | ✅ (managed) | ⚠️ | ✅ | An alternative BaaS; less mature Postgres story |
| **PocketBase (self-host)** | free software, you supply the host | n/a — you'd still need the VM | ✅ (its own SQLite) | no | via your host | Nothing: SADKO already *has* auth + SQLite. Adding PocketBase is a second Go binary doing what `accounts.mjs` already does |
| **Neon (Free)** | 0.5 GB storage/project, 100 CU-hrs/project/mo, 5 GB transfer, scales to zero after 5 min | ❌ | Postgres only | compute scales to zero | ✅ | If you ever outgrow SQLite for accounts |
| **Turso (Free)** | 5 GB storage, 500 M rows read/mo, 10 M rows written/mo, 100 databases | ❌ | SQLite-compatible | ⚠️ | ✅ | Interesting *only* if you later want the catalog replicated near users |

### The two things you must not miss

**Firebase's catch.** The Spark (free) plan **blocks all outbound network
requests except to Google-owned services**, and **deploying Cloud Functions
requires the Blaze pay-as-you-go plan** — the docs are explicit: *"to deploy
functions, your project must be on the Blaze pricing plan."* That means the one
thing you'd want server-side code for — reaching a retailer's website — is
impossible on Firebase's free plan by design. Blaze does keep a generous no-cost
allowance (first 2 M invocations, 400,000 GB-sec, 200,000 CPU-sec, 5 GB egress
per month), but it requires a card and an uncapped billing account.

**Oracle's catch.** Idle Always Free instances may be reclaimed. Oracle's exact
rule: an instance is deemed idle if, **over a 7-day period**, 95th-percentile
CPU utilisation is < 20% **and** network utilisation is < 20% **and** (for A1
shapes) memory utilisation is < 20%. All three must hold. SADKO's 3-hour
refresher, crawl waves and a resident Chromium make the memory and network
conditions unlikely to be met simultaneously — but on a site with no visitors
this is a real risk. Mitigations in §5.9.

---

### 3.1 What about Google Cloud? (asked often — worth its own answer)

GCP is a serious platform and if you already have an account the signup friction
that makes Oracle annoying disappears. But the two obvious GCP products fail this
*particular* app for different reasons.

**Cloud Run — no, not without rewriting the storage layer.** Cloud Run instances
have no persistent POSIX disk. The only way to keep a file across restarts is a
Cloud Storage volume mount, and Google's own documentation is explicit that
Cloud Storage FUSE *"does not provide concurrency control for multiple writes
(file locking) to the same file… the last write wins and all previous writes are
lost."* SQLite depends on exactly that locking. Putting `accounts.db` there means
silently losing customer orders under concurrent writes — the precise failure
this project just moved **away** from when it left the JSON file. On top of that,
Cloud Run throttles CPU the moment a response is sent, so the background refresher
would never run unless you enable instance-based billing **and** `min-instances=1`,
which bills the instance's whole lifecycle and leaves the free allowance behind.
Cloud Run becomes viable only if you move accounts to Cloud SQL or Firestore and
move the refresher to Cloud Scheduler — a real re-architecture, not a config flag.

**Compute Engine `e2-micro` Always Free — it will run, but it is a much smaller
machine than Oracle's, in the wrong hemisphere.** Three specific problems:

1. **1 GB RAM.** Node plus a headless Chromium plus SQLite page cache on 1 GB is
   fragile; Chromium alone routinely wants 0.5–1 GB. Oracle Always Free gives
   **12 GB**. You would be tuning `--max-old-space-size` and swap instead of
   shipping. (`e2-small`/`e2-medium` fix this, but they are not free.)
2. **1 GB egress per month.** Oracle gives **10 TB**. Cloudflare in front absorbs
   most static traffic, but every `/api/compare` response still leaves the VM.
   This is the limit you would blow through first, and it bills silently.
3. **US regions only** for the free instance. That is ~150–250 ms round-trip to
   Egyptian users on every API call, on top of the comparer's own latency.

**Where GCP is genuinely the better choice:**

- **You have the $300 / 90-day trial credit.** Then take an `e2-medium`
  (2 vCPU / 4 GB) in a *near* region — `me-central1` (Doha) or `europe-west*` —
  and you get a comfortably-sized, low-latency box for the whole launch period at
  no cost. Decide where to live permanently before day 90. This is the fastest
  path to being online **today**.
- **You already pay for GCP.** An `e2-small`/`e2-medium` at roughly US$13–25/month
  is a perfectly good home for this, and the console, IAM, snapshots and logging
  are nicer to operate than Oracle's. If the team already knows GCP, that
  familiarity is worth more than Oracle's free tier.

**Rule of thumb:** free-forever → Oracle. Fastest good launch on credit you already
have → GCP `e2-medium` near Egypt. Cheapest predictable paid bill → Fly or Hetzner.
Whichever you pick, the deployment steps in §5 are identical from "install Node"
onward — only the VM-creation step changes.

---

## 4. Before you start

You need:

- A **credit or debit card** (Oracle rejects prepaid and virtual cards). It is
  used for identity verification with a small temporary authorisation hold that
  is released in 3–5 days; Always Free resources are not charged.
- A **domain**. Options, cheapest first:
  - Any `.com` / `.shop` / `.store` from a registrar you like (~US$10–15/yr).
  - `.com.eg` — around **900–999 EGP/yr** from Egyptian hosts, or ~US$99/yr
    internationally. **Registration is restricted to Egyptian companies or
    companies with an Egyptian branch**, and foreign registrars charge for a
    trustee. Given SADKO is an Egyptian company this is the "right" domain, but
    it needs the commercial register — so it is a §8 checklist item, not a
    blocker. Launch on a cheap `.com` and move later if needed.
  - Free-but-ugly: a DuckDNS / nip.io hostname will work with Caddy for TLS.
    Fine for a staging URL, wrong for a customer-facing store.
- A Google account (for the free `GOOGLE_CLIENT_ID`).
- Optionally: `NVIDIA_API_KEY` and `TAVILY_API_KEY`. **The engine runs fully
  without both** — it just falls back to the rule-based path and the registry.
  Tavily's free plan is **1,000 API credits/month, no card required** (1 credit
  per basic search, 2 per advanced).

---

## 5. The launch, step by step

Target: **Oracle Cloud Always Free, Ampere A1 (ARM64), Ubuntu 24.04 or Debian
13, running `compare-server.mjs` under systemd, behind Caddy for TLS, with
Cloudflare in front.**

### 5.1 Create the Oracle account and pick the home region

1. Go to <https://www.oracle.com/cloud/free/> → **Start for free**.
2. **Choose your home region carefully — you cannot change it, and Always Free
   compute can only be created in it.** Oracle has no Egypt region. For Cairo
   latency the sensible choices are **Saudi Arabia (Jeddah)**, **UAE (Dubai or
   Abu Dhabi)**, or a European region like **Germany Central (Frankfurt)** /
   **Netherlands Northwest (Amsterdam)**. Frankfurt/Amsterdam are the busiest
   and most likely to be "out of host capacity" for ARM; the Gulf regions are
   usually easier and are closer to Egypt anyway. **⚠️ verify which regions
   currently have A1 capacity** — it changes weekly.
3. Enter the card. Expect the hold. Do **not** upgrade to Pay As You Go yet.

### 5.2 Create the instance

Console → **Compute → Instances → Create instance**.

- **Image**: Canonical Ubuntu 24.04 (**aarch64** build) or Debian 13 aarch64.
- **Shape**: change shape → **Ampere** → `VM.Standard.A1.Flex` →
  **2 OCPUs, 12 GB memory** (the full current Always Free allowance).
- **Boot volume**: raise it to **100 GB** (you have 200 GB total to play with,
  and the catalog + Chromium want room). Confirm the "Always Free eligible"
  badge stays on.
- **SSH keys**: paste your public key. On Windows:
  ```powershell
  ssh-keygen -t ed25519 -C "sadko-deploy"
  Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
  ```
- **Networking**: default VCN, **assign a public IPv4 address**.

If you get **"Out of host capacity"**, retry in another availability domain
(AD-1/AD-2/AD-3) or another day. It is common and it is not your fault.

### 5.3 Open the ports

Two firewalls have to agree — this is the single most common Oracle mistake.

**a) The VCN security list** (Console → Networking → Virtual Cloud Networks →
your VCN → Security Lists → Default): add ingress rules,
Source `0.0.0.0/0`, IP protocol TCP, destination port **80** and **443**.

**b) The OS firewall**, on the VM:

```bash
ssh ubuntu@<PUBLIC_IP>            # 'opc@' on Oracle Linux, 'debian@' on Debian

# Ubuntu images ship iptables rules that block everything but 22:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 5.4 Install Node 24 and Chromium

```bash
sudo apt update && sudo apt -y upgrade

# Node 24 (arm64) from NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

node -v          # must print v24.x — node:sqlite and FTS5 are built in
```

Now the browser. `site/headless.mjs` probes, in order:
`$CHROME_PATH`, the Windows paths, `/usr/bin/google-chrome`, `/usr/bin/chromium`.

```bash
# Debian: a real .deb, cleanest option
sudo apt install -y chromium
ls -l /usr/bin/chromium

# Ubuntu: `chromium-browser` is a snap wrapper whose confinement fights the
# --user-data-dir under /tmp and the fd3/fd4 CDP pipe. Prefer either:
#   (a) Google Chrome for arm64 Linux, which Google shipped in Q2 2026:
#         https://chrome.com/download  → arm64 .deb → installs /usr/bin/google-chrome
#   (b) or use a Debian image instead of Ubuntu.
```

Verify the pipe transport actually works before you trust it:

```bash
CHROME_PATH=/usr/bin/chromium node -e "
  import('./site/headless.mjs').then(async m => {
    console.log('available:', m.headlessAvailable());
    const r = await m.renderPage('https://example.com', { waitMs: 1500 });
    console.log('html bytes:', r.html.length);
    await m.shutdown();
  })"
```

If `html bytes` is a few hundred and not `0`, the headless tier is live. **⚠️
verify** this on your chosen image — the snap-confinement issue above is the one
thing most likely to bite you, and it is easier to switch image than to fight
it.

### 5.5 Get the code and the data onto the box

```bash
sudo mkdir -p /opt/sadko && sudo chown $USER:$USER /opt/sadko
git clone <your-repo-url> /opt/sadko
cd /opt/sadko/site
node --test engine/*.test.mjs        # zero deps: the tests just run
```

`site/data/catalog.db` is committed to the repo, so the ~6,900-offer catalog is
there the moment you clone and search works immediately.

**Important, and true of the working tree right now:** the SQLite migration
writes `site/data/accounts.db`, and **that file is not gitignored yet**
(`git check-ignore -v site/data/accounts.db` matches no rule; `git status` shows
it as untracked). `site/data/catalog.db` *is* tracked, so the habit of
`git add -A` is already established in this repo. Before the next commit, add:

```
site/data/accounts.db
site/data/accounts.db-*
```

Keeping accounts in their own file — rather than inside the tracked
`catalog.db` — is what makes this a one-line `.gitignore` fix instead of a
history rewrite. See §8.

### 5.6 Environment variables, and running as a service

Secrets go in a root-owned file, never in git:

```bash
sudo tee /etc/sadko.env >/dev/null <<'EOF'
PORT=8082
GOOGLE_CLIENT_ID=
NVIDIA_API_KEY=
TAVILY_API_KEY=
CHROME_PATH=/usr/bin/chromium
EOF
sudo chmod 600 /etc/sadko.env
```

| Variable | Required | Effect if unset |
|---|---|---|
| `PORT` | no | defaults to 8082 |
| `GOOGLE_CLIENT_ID` | no | "Continue with Google" is hidden; email + password still works |
| `NVIDIA_API_KEY` | no | AI query understanding + relevance off; rule-based path used |
| `TAVILY_API_KEY` | no | URL discovery fallback off; registry + catalog only |
| `CHROME_PATH` | no | falls back to `/usr/bin/chromium` etc. |
| `MICROSOFT_CLIENT_ID` | no | leave unset — the browser-side flow does not exist yet |

systemd unit:

```bash
sudo tee /etc/systemd/system/sadko.service >/dev/null <<'EOF'
[Unit]
Description=SADKO comparer engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/sadko/site
EnvironmentFile=/etc/sadko.env
ExecStart=/usr/bin/node compare-server.mjs
Restart=always
RestartSec=5
StandardOutput=append:/var/log/sadko.log
StandardError=append:/var/log/sadko.err.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now sadko
sudo systemctl status sadko --no-pager
curl -s localhost:8082/api/stores | head -c 300
```

No `pm2`, no npm install, nothing outside the Node runtime. That is deliberate —
it keeps the zero-dependency property intact.

### 5.7 Domain, TLS and Cloudflare

Point the domain at the VM, then let Caddy get a free Let's Encrypt certificate.

1. Add your domain to Cloudflare (free plan), change the nameservers at your
   registrar to the two Cloudflare gives you.
2. In Cloudflare DNS create an **A record** `sadko.com.eg` → `<PUBLIC_IP>`.
   Set the proxy to **DNS only (grey cloud)** for now — Caddy needs to reach
   Let's Encrypt directly for the HTTP-01 challenge.
3. On the VM:

```bash
# Caddy from the official repo (arm64 packages are published).
# Canonical instructions: https://caddyserver.com/docs/install#debian-ubuntu-raspbian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
sadko.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8082
}
EOF
sudo systemctl restart caddy
```

4. Open `https://sadko.example.com`. Once the certificate is issued, flip the
   Cloudflare record to **Proxied (orange cloud)** and set SSL/TLS mode to
   **Full (strict)**. You now get Cloudflare's CDN, DDoS protection and edge
   caching of the static assets for free, and the origin still serves `/api/*`.

Once you are behind HTTPS, the session cookie set by `engine/accounts.mjs`
becomes `Secure` as well as `HttpOnly` + `SameSite=Lax`, which is the state you
want before a single real customer registers.

**If you have no public IPv4 or want to skip Caddy:** Cloudflare Tunnel is free,
needs no open inbound ports and no static IP, and terminates TLS at Cloudflare.
Install `cloudflared` on the VM and point the tunnel at `127.0.0.1:8082`. This
also works if you ever run the engine from an office machine.

### 5.8 Enable "Sign in with Google" (free, no secret)

The server-side verification is already written and tested
(`site/engine/oidc.mjs`, 17 tests in `oidc.test.mjs`): it checks the RS256
signature against Google's published JWKS, `iss`, `aud` equal to your client id,
`exp`/`iat` within a small skew, the per-attempt `nonce`, and it refuses to link
a Google identity to an existing password account unless Google reports
`email_verified: true`. It needs **only a public client id — there is no client
secret in this flow**, so nothing sensitive ever enters the repo or the image.

1. <https://console.cloud.google.com/apis/credentials> → create or pick a
   project.
2. **Create credentials → OAuth client ID → Web application.**
3. **Authorised JavaScript origins**: add exactly the origins you serve from —
   `https://sadko.example.com` and `http://localhost:8082` for local work. No
   redirect URI is needed; this is the Google Identity Services button, which
   returns an ID token directly.
4. Put the id in `/etc/sadko.env` and restart:

```bash
sudo sed -i 's|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com|' /etc/sadko.env
sudo systemctl restart sadko
curl -s https://sadko.example.com/api/auth/config
```

Google Identity Services / Firebase Auth are free at this volume — Firebase's
own Auth free tier is **50,000 MAU** — and you are not even using Firebase here,
just Google's public JWKS.

### 5.9 Verify the launch

```bash
# the site
curl -sI https://sadko.example.com/ | head -3
curl -sI https://sadko.example.com/compare.html | head -3

# the engine (this is your health check — it is cheap and hits the registry)
curl -s https://sadko.example.com/api/stores | head -c 300

# a real comparison, with discovery off so it is fast and deterministic
curl -s "https://sadko.example.com/api/compare?q=%D8%AB%D9%84%D8%A7%D8%AC%D8%A9%20%D9%83%D8%B1%D9%8A%D8%A7%D8%B2%D9%89&discover=0&lang=ar" | head -c 600

# auth surface
curl -s https://sadko.example.com/api/auth/config
curl -s https://sadko.example.com/api/auth/me      # expect a logged-out shape
```

Then **register a throwaway account through the UI**, place a test order with
"cash on delivery", `sudo systemctl restart sadko`, and confirm the account and
the order are still there. That single test proves persistence, sessions and the
data path in one go — and it is the test people skip.

### 5.10 Keep Oracle from reclaiming the box

Recall the rule: reclaimed only if, over 7 days, 95th-percentile CPU < 20%
**and** network < 20% **and** memory < 20%. Three practical defences:

1. **Let the engine do its job.** A resident Chromium plus the 12 GB shape means
   memory utilisation rarely stays under 20% once Chrome is warm; the 3-hour
   refresher and crawl waves keep network moving.
2. **Run the crawler on a schedule** — this is useful anyway, since the catalog
   is a snapshot:
   ```bash
   crontab -e
   # every 6 hours, extend the catalog a little
   0 */6 * * * cd /opt/sadko/site && /usr/bin/node ../scripts/crawl-m1.mjs --max 400 >> /var/log/sadko-crawl.log 2>&1
   ```
3. **If it still gets reclaimed, upgrade to Pay As You Go.** PAYG accounts keep
   the Always Free resources, are exempt from idle reclamation, and get priority
   on ARM capacity. You are billed only for what exceeds Always Free — which,
   for one A1 VM within the allowance, should be nothing. **⚠️ verify before
   relying on it:** Oracle support has given contradictory answers in 2026 about
   whether PAYG tenancies were also cut to 2 OCPU / 12 GB, and an uncapped
   billing account is a real risk if you misconfigure something. Set a **budget
   alert at $1** the same day you upgrade.

### 5.11 Afterwards: logs, health, backups

```bash
# logs
sudo tail -f /var/log/sadko.log /var/log/sadko.err.log
sudo journalctl -u sadko -f
sudo journalctl -u caddy -f

# nightly backup of the SQLite files to the boot volume + off-box
sudo tee /usr/local/bin/sadko-backup.sh >/dev/null <<'EOF'
#!/bin/bash
set -e
D=/opt/sadko/backups; mkdir -p "$D"
S=$(date +%F-%H%M)
# .backup is online-safe: it will not tear a WAL-mode database
sqlite3 /opt/sadko/site/data/catalog.db  ".backup '$D/catalog-$S.db'"
[ -f /opt/sadko/site/data/accounts.db ] && \
  sqlite3 /opt/sadko/site/data/accounts.db ".backup '$D/accounts-$S.db'"
find "$D" -name '*.db' -mtime +14 -delete
EOF
sudo chmod +x /usr/local/bin/sadko-backup.sh
sudo apt install -y sqlite3
sudo crontab -e
# 03:15 every night
15 3 * * * /usr/local/bin/sadko-backup.sh
```

**A backup that never leaves the machine is not a backup.** Copy
`accounts-*.db` off the box — `rsync` over SSH to a laptop, or an Oracle Object
Storage bucket (Always Free includes 20 GB of object storage — **⚠️ verify**).
Because that file is personal data, encrypt it before it leaves:
`age -p` or `gpg -c` is enough.

Uptime monitoring: point a free monitor (UptimeRobot's free plan, or a
Cloudflare health check) at `https://sadko.example.com/api/stores` every 5
minutes. It doubles as anti-idle traffic.

---

## 5G. The launch on Google Cloud (`e2-medium`) — chosen path

This is the walkthrough if you are using GCP with the $300 / 90-day trial
credit. It replaces §5.1–5.3 (creating the machine); everything from §5G.5
onward is the same work the Oracle path does, just automated by the scripts in
`deploy/`.

**What you end up with:** one `e2-medium` VM running `compare-server.mjs` under
systemd, Google Chrome installed for the comparer's headless tier, Caddy
terminating TLS with an automatic Let's Encrypt certificate, nightly SQLite
backups on a timer, and a firewall that exposes only 80/443/22.

> **Set a budget alert before anything else.** Unlike Oracle's Always Free,
> GCP bills you automatically once the trial credit is gone. Billing →
> **Budgets & alerts** → create a budget of e.g. $10 with alerts at 50/90/100%.
> Do this on day one, not day 89.

### 5G.1 Create the project

```bash
# In Cloud Shell (top-right >_ icon in the console) or with gcloud installed locally
gcloud auth login
gcloud projects create sadko-prod --name="SADKO"
gcloud config set project sadko-prod
# then link billing in the console: Billing → Link a billing account
gcloud services enable compute.googleapis.com
```

### 5G.2 Pick a region close to Egypt

GCP has no Egypt region. Closest, best first:

| Region | Location | Note |
|---|---|---|
| `me-central1` | Doha, Qatar | usually the lowest RTT to Cairo |
| `me-central2` | Dammam, Saudi Arabia | similar |
| `me-west1` | Tel Aviv | close, check policy fit |
| `europe-west4` | Netherlands | cheapest of the four, ~60–80 ms further |

Middle East regions price a little above European ones. On trial credit that is
irrelevant; after day 90 it is roughly the difference between ~$25 and ~$18 a
month for this machine, so decide with real numbers from the pricing calculator
before you commit. **⚠️ verify `e2-medium` availability in your chosen region** —
the console greys out machine types a zone cannot currently provide.

### 5G.3 Reserve a static IP, then create the VM

Reserve the address **first**. An ephemeral IP changes whenever the VM stops,
which would silently break your DNS and your Google OAuth origin.

```bash
REGION=me-central1
ZONE=$REGION-a

gcloud compute addresses create sadko-ip --region=$REGION
gcloud compute addresses describe sadko-ip --region=$REGION --format="value(address)"   # note this down

gcloud compute instances create sadko \
  --zone=$ZONE \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --address=sadko-ip \
  --tags=http-server,https-server \
  --metadata=enable-oslogin=TRUE
```

30 GB is comfortable: the catalog database, Chrome, and a fortnight of
compressed backups together sit well under 10 GB.

### 5G.4 Open the firewall

The `http-server` / `https-server` tags map to built-in rules in most projects.
If they are missing, create them once:

```bash
gcloud compute firewall-rules create allow-http  --allow=tcp:80  --target-tags=http-server
gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server
```

Port 8082 stays closed to the internet on purpose — Caddy reaches the app on
`127.0.0.1`, and nothing else should.

### 5G.5 Point your domain at it

Create an **A record** for `sadko.example.com` → the static IP from 5G.3.

If you use Cloudflare, set the record to **DNS only (grey cloud)** for now, so
Caddy can complete the HTTP-01 challenge and issue a certificate. Once the site
is live over HTTPS you may switch it to **Proxied (orange cloud)** — but then
you must set Cloudflare SSL/TLS mode to **Full (strict)**, or you will get a
redirect loop.

Verify before continuing, or Let's Encrypt will rate-limit your failures:

```bash
dig +short sadko.example.com     # must print your static IP
```

### 5G.6 Provision the machine (one command)

```bash
gcloud compute ssh sadko --zone=$ZONE

# on the VM:
sudo apt-get update && sudo apt-get install -y git
git clone <your-repo-url> /tmp/sadko && cd /tmp/sadko
sudo bash deploy/setup-vm.sh sadko.example.com you@example.com
```

`deploy/setup-vm.sh` installs Node 24, Google Chrome, Caddy and `sqlite3`,
creates the `sadko` service user, writes `/etc/sadko.env` (mode 600), installs
the systemd unit and the nightly backup timer, and configures ufw. It is
idempotent — safe to re-run — and never overwrites secrets you have already put
in `/etc/sadko.env`.

### 5G.7 Put the code in place and start

```bash
sudo -u sadko git clone <your-repo-url> /opt/sadko/repo
sudo systemctl start sadko caddy

curl -s localhost:8082/healthz          # {"ok":true,...}
sudo journalctl -u sadko -f             # watch the first boot
```

Then open `https://sadko.example.com` — Caddy will have obtained the
certificate on first request. If it has not, `sudo journalctl -u caddy -n 50`
almost always says exactly why (usually DNS not yet propagated, or port 80
blocked).

### 5G.8 Turn on Sign in with Google

Follow `DEPLOY.md` → *Sign in with Google* to create the client id, using
`https://sadko.example.com` as the authorised JavaScript origin. Then:

```bash
sudo nano /etc/sadko.env        # set GOOGLE_CLIENT_ID=...
sudo systemctl restart sadko
curl -s localhost:8082/api/auth/config    # should now list the google provider
```

Until you do this the site works completely — it just shows an explanation
where the Google button would be, instead of a button that cannot work.

### 5G.9 Check it actually works, end to end

```bash
# the site itself
curl -sI https://sadko.example.com | head -1

# the session cookie must be marked Secure once behind Caddy
curl -sD- -o /dev/null https://sadko.example.com/api/auth/me | grep -i strict-transport

# the headless tier — this is the one that silently fails on a bad Chrome install
sudo -u sadko google-chrome --headless=new --dump-dom https://example.com | head -3
```

If that last command prints HTML, the comparer's JS-rendered stores (B.TECH,
Carrefour, Amazon) will work. If it hangs or errors, Chrome is the problem, not
the app — check you installed the `.deb` and not the snap.

### 5G.9a Give the VM its own pull access (private repo)

`setup-vm.sh` clones over HTTPS, which works once — interactively, with a
credential you type. Nothing persists, so the *next* `deploy/update.sh` dies on
`fatal: could not read Username for 'https://github.com'` and the live site
quietly stays on the build it launched with. Fix it once, with a **read-only
deploy key** rather than a personal token: it is scoped to this one repository,
cannot push, and is revoked from the repo's own settings page.

```bash
# on the VM — a key the app user owns, no passphrase (systemd cannot type one)
sudo -u sadko mkdir -p /opt/sadko/.ssh
sudo -u sadko ssh-keygen -t ed25519 -N "" -f /opt/sadko/.ssh/id_ed25519 -q
sudo cat /opt/sadko/.ssh/id_ed25519.pub
```

Register that public key on GitHub — *Settings → Deploy keys → Add*, **leave
"Allow write access" unchecked** — or from a machine with `gh` logged in:

```bash
gh repo deploy-key add key.pub --repo <owner>/<repo> --title "sadko-vm (read-only)"
```

Then point the checkout at SSH and tell it which key to use. `core.sshCommand`
is set on the repository, so it applies no matter who runs `git` there, and
`UserKnownHostsFile` is spelled out because `sudo -u` does not reliably move
`HOME`:

```bash
sudo -u sadko git -C /opt/sadko/repo remote set-url origin git@github.com:<owner>/<repo>.git
sudo -u sadko git -C /opt/sadko/repo config core.sshCommand \
  'ssh -i /opt/sadko/.ssh/id_ed25519 -o UserKnownHostsFile=/opt/sadko/.ssh/known_hosts -o StrictHostKeyChecking=accept-new'
sudo -u sadko git -C /opt/sadko/repo fetch --prune     # should print a ref update
```

**`site/data/stores.json` will block the pull.** The engine rewrites it as
stores are discovered and health-checked, so the working tree is always dirty
there and `git pull --ff-only` aborts rather than overwrite it. Stash it — do
not `checkout --` it, which throws the live registry away with no copy:

```bash
sudo -u sadko git -C /opt/sadko/repo stash push -m vm-local-stores -- site/data/stores.json
sudo bash /opt/sadko/repo/deploy/update.sh
```

The committed file is normally the newer of the two (it carries whatever the
last development run discovered), but check before dropping the stash:

```bash
sudo -u sadko sh -c "cd /opt/sadko/repo
  git show 'stash@{0}:site/data/stores.json' | grep -o '\"domain\": *\"[^\"]*\"' | cut -d'\"' -f4 | sort -u > /tmp/sv.txt
  grep -o '\"domain\": *\"[^\"]*\"' site/data/stores.json | cut -d'\"' -f4 | sort -u > /tmp/sn.txt
  comm -23 /tmp/sv.txt /tmp/sn.txt"      # prints stores the VM had and the new build does not
```

### 5G.10 Day-two operations

```bash
sudo bash deploy/update.sh        # backup, pull, restart, health check, rollback hint
sudo /usr/local/bin/sadko-backup  # manual backup (also runs nightly at 03:20)
ls -la /var/backups/sadko         # 14 days of compressed copies, mode 600
sudo systemctl status sadko caddy
```

**Back up off the VM as well.** A backup that only exists on the machine it is
protecting is not a backup. `gcloud compute scp` the nightly `accounts-*.db.gz`
somewhere else, or snapshot the disk on a schedule:

```bash
gcloud compute resource-policies create snapshot-schedule sadko-daily \
  --region=$REGION --max-retention-days=14 --start-time=02:00 --daily-schedule
gcloud compute disks add-resource-policies sadko --zone=$ZONE --resource-policies=sadko-daily
```

### 5G.11 Before day 90

The trial credit expires. Decide then whether to keep paying (~$18–25/month for
this machine plus egress, no code changes), or move to Oracle Always Free
(§5, free forever, but 12 GB RAM ARM and a region hop). Because everything the
app needs lives in `/opt/sadko/repo` and `/etc/sadko.env`, moving hosts is a
`git clone`, a copy of `site/data/*.db`, and re-running `deploy/setup-vm.sh`.

---

## 6. Alternative B — managed auth and database (Supabase)

**If you would rather not run a database yourself, use Supabase, not Firebase.**

Why Supabase wins here:

- **Postgres and SQL.** You are mid-migration to `node:sqlite` right now; moving
  those same tables to Postgres is a schema translation, not a rewrite. Firestore
  is a document store — every query in `accounts.mjs` would have to be rethought.
- **Google OAuth is on the free plan**, along with **50,000 monthly active
  users** — the same ceiling Firebase Auth offers.
- **Firebase's free plan cannot do the one thing you'd want it for.** Spark
  blocks outbound network requests to anything that isn't a Google service, and
  Cloud Functions require the Blaze plan to deploy at all. So Firebase's free
  tier gives you Auth + Hosting and nothing else useful to SADKO.

Supabase's honest downsides: **500 MB database**, **5 GB egress**, **no custom
domain on the Free plan**, and **projects pause after one week of inactivity**
(fine for a live store, fatal for a staging project you forget about).

### The resulting architecture

```
Cloudflare Pages  ──►  static site (index.html, compare.html, assets)   [free]
Supabase          ──►  auth, accounts, orders, home profiles            [free]
Oracle / Fly VM   ──►  the comparer only: /api/compare, /api/stores     [still required]
```

Note what did **not** go away: the VM. Supabase removes the account database,
not the engine.

### What would have to change in the code — **none of this is done yet**

| Change | Where | Rough size |
|---|---|---|
| Replace the storage layer of `accounts.mjs` (scrypt hashing, session table, rate-limit table) with Supabase Auth calls | `site/engine/accounts.mjs` (448 lines) — most of it becomes dead code | ~1 day |
| Swap the server's own HttpOnly session cookie for Supabase JWT verification on every `/api/auth/*` and `/api/orders` route | `site/compare-server.mjs` around lines 1541–1673 | ~0.5 day |
| Move orders + home profiles to Postgres tables and write **Row Level Security** policies (without RLS, `anon` key access means any customer can read every order) | new SQL migrations | ~0.5–1 day |
| Front-end: `account.html`, `checkout.html`, `orders.html` move to `supabase-js` | **introduces npm + a bundler + a build step where there is currently none** | ~1 day, plus permanent build tooling |
| `site/engine/oidc.mjs` (161 lines) and its 17 tests become obsolete — Supabase handles Google | delete | — |
| Re-write `accounts.test.mjs` against a live/local Supabase | tests | ~0.5 day |

**Realistically 3–4 days of focused work, plus the permanent cost of a build
pipeline and a second vendor.** In exchange you get: password reset and email
verification for free (which SADKO genuinely lacks today), and someone else on
call for the auth database.

**My recommendation: not now.** The auth you already have is real server-side
auth — scrypt with per-user salt, timing-safe comparison, sessions stored as
SHA-256 of the token so a leaked file cannot be replayed, vague failure
messages, per-email+IP rate limiting. It is not a shortcut that needs replacing.
Revisit this when password reset emails become the thing blocking customers, and
solve *that* with a transactional email provider first — it is a much smaller
change than moving the whole identity system.

---

## 7. Cost at scale — what breaks first

Assuming the recommended Oracle stack, in the order you will actually hit them:

1. **Oracle's ARM ceiling / reclamation — the first real wall.** 2 OCPUs is fine
   for the site and for search, but concurrent headless-Chromium renders are
   expensive. When several people search a JS-rendered store at once, the
   comparer will queue. **Fix:** upgrade to Pay As You Go and add OCPUs
   (billed per OCPU-hour), or move to a predictable VPS — **Hetzner CAX11, 2
   vCPU ARM / 4 GB / 40 GB, €4.49/mo plus €0.50 for the IPv4 address**
   (Hetzner raised prices in June 2026). Call it **€5/month**.
   *If you were on Fly.io instead, this is where you'd already be paying: a
   shared-cpu-1x/512 MB machine is about **$3.32/month**, plus **$0.15/GB/month**
   for the volume and **$0.02/GB** egress in NA/EU.*

2. **The paid APIs.** `TAVILY_API_KEY` free plan is **1,000 credits/month**
   (1 credit per basic search). Discovery fires when a store cannot be reached
   from the registry, so at a few hundred searches a day you will cross it.
   Then it is **$30/month for 4,000 credits, or $0.008/credit pay-as-you-go**.
   The NVIDIA API key pricing depends on your account — **⚠️ verify**; note the
   engine degrades gracefully to the rule-based path if you simply stop paying.

3. **Transactional email.** Not a scaling failure — a missing feature that
   becomes urgent. There is no password reset and no order-confirmation email
   today, because there is no mail sender. Expect **$0–20/month** for a free or
   entry tier at Resend / Brevo / Amazon SES — **⚠️ verify current free tiers**,
   and note that a `.com.eg` sending domain needs SPF/DKIM/DMARC records before
   anything you send reaches an inbox.

Then, further out: bandwidth (Oracle gives **10 TB/month** free, which is
enormous, and Cloudflare in front makes it larger still — this will not be your
problem), and storage (200 GB block storage against a 4.7 MB catalog — also not
your problem).

**Payment gateway — explicitly future work.** There is no card processing
anywhere in this codebase. `compare-server.mjs` accepts exactly three payment
methods — `cod`, `bank`, `showroom` — and the code comments say why: taking card
payments requires a PCI-compliant gateway redirecting to the provider's own
hosted page, not a form on this site. When SADKO wants that, the Egyptian
options are **Paymob** (advertised around **2.75% + 3 EGP** per local
transaction) and **Fawry**; both need a merchant account, commercial register
and tax card, and both are quoted per-merchant, so **⚠️ verify the actual terms
with the provider — do not budget from a blog post.** Wiring one in is a real
project (checkout redirect, webhook handling, order-state machine, refunds,
reconciliation), not a config flag.

---

## 8. Pre-launch checklist

**Data and privacy**

- [ ] **🔴 DO THIS FIRST.** `site/data/accounts.db` now exists on disk from the
      SQLite migration and **is not gitignored** — verified with
      `git check-ignore -v site/data/accounts.db`, which matches no rule, and
      `git status` lists it as an untracked file. One `git add -A` commits
      customer names, emails, phones, addresses and password hashes into the
      repository history. Add to `.gitignore`, before the next commit:
      ```
      site/data/accounts.db
      site/data/accounts.db-*
      ```
      Then confirm: `git check-ignore -v site/data/accounts.db` should print the
      matching rule instead of exiting 1.
- [ ] Separately, `site/data/catalog.db` **is tracked in git** (by design — it
      ships the offer snapshot). Keep accounts out of that file for the same
      reason.
- [ ] Confirm `site/data/accounts.json` is still gitignored and that no earlier
      commit contains it: `git log --all --oneline -- site/data/accounts.json`
      must be empty. If it is not, that history has to be rewritten before the
      repo goes anywhere public.
- [ ] The accounts store holds **names, emails, phone numbers, delivery
      addresses and scrypt password hashes** — that is personal data under
      Egypt's Personal Data Protection Law (Law 151/2018). It holds **no card
      data**, because the site never collects any.
- [ ] Nightly encrypted backups of the accounts database, stored off the VM, and
      **a restore actually tested once**.

**Secrets**

- [ ] `NVIDIA_API_KEY`, `TAVILY_API_KEY` and `GOOGLE_CLIENT_ID` live only in
      `/etc/sadko.env` (mode 600, root-owned) or the host's secret store — never
      in the repo, never in the image.
- [ ] `.env` and `*.env` are gitignored (they are). Verify nothing leaked:
      `git log -p --all -S 'NVIDIA_API_KEY=' | head`.
- [ ] The Google client id is public by design — there is no client secret in
      this flow. Do not go looking for one to set.

**Security posture**

- [ ] HTTPS is live, so the session cookie is `Secure` + `HttpOnly` +
      `SameSite=Lax`.
- [ ] Only ports 80, 443 and 22 are reachable; 8082 is bound behind Caddy.
- [ ] SSH is key-only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).
- [ ] `sudo unattended-upgrades` enabled, or a monthly patch reminder.
- [ ] Known gaps, on the record: **no email verification, no password reset, no
      2FA.** The UI already tells people to call customer care instead of
      pretending a reset email was sent — keep it that way until mail exists.

**Legal — the nine flags that need SADKO's own sign-off**

`site/assets/js/info.js` deliberately renders an amber
**«محتاج اعتماد صادكو / Needs SADKO sign-off»** badge instead of inventing
policy. There are **nine** of them, and every one is a live commercial or legal
commitment that only the company can make:

1. **Warranty durations** per brand/model (the catalog is machine-read and does
   not reliably state them).
2. **Statutory obligations + formal warranty wording** — needs legal review
   before it can be published as binding text.
3. **Return window and conditions.**
4. **The official fee schedule** — coastal delivery, installation, haul-away.
5. **Delivery / installation SLA** — no approved turnaround time is published.
6. **Data retention period, SADKO's data-protection contact, and the procedure
   for requesting a copy of your data.**
7. **Deletion-request turnaround and identity verification** for it.
8. **Cancellation and return terms and any fees** attached to them.
9. **Company legal identity** — commercial register number, tax card, registered
   address, and the final legal wording of the Terms.

Items 6, 7 and 9 are the ones I would not launch a transacting store without:
they are the minimum a customer needs to exercise their rights, and (9) is what
makes the Terms an actual contract rather than text.

**Commercial**

- [ ] **No payment gateway is wired.** Checkout offers cash on delivery, bank
      transfer, and pay-at-showroom only. Nobody should describe the site as
      "accepting online payments".
- [ ] The customer-care phone number rendered across the site is correct and
      someone answers it — several policy pages route unanswered questions there
      by design.
- [ ] Prices shown by the comparer come from other retailers' public pages and
      are timestamped snapshots. Make sure the UI says so, and that SADKO is
      comfortable displaying competitor pricing.
- [ ] Showroom addresses and opening hours are current.

---

## 9. If Oracle does not work out — the fallback, in five commands

The repo already contains a working `Dockerfile` and `fly.toml`. Fly costs money
now (no free tier for new customers, card required, or a $25 minimum credit
purchase), but it is the fastest path from zero to a URL:

```bash
fly auth login
fly launch --no-deploy                    # picks up Dockerfile + fly.toml
fly volumes create sadko_data --size 1    # $0.15/GB/month
# then uncomment the [[mounts]] block in fly.toml (source = "sadko_data",
# destination = "/app/site/data") and seed it once, per the note in that file
fly secrets set GOOGLE_CLIENT_ID=... NVIDIA_API_KEY=... TAVILY_API_KEY=...
fly deploy && fly open
```

Two things to fix in the image before this is equivalent to the Oracle setup:

- The `Dockerfile` **does not install Chromium** — it says so in its own
  comments. Add `RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*`
  and set `ENV CHROME_PATH=/usr/bin/chromium`, and raise `memory` in `fly.toml`
  above 512 MB, or the headless tier silently stays off.
- `auto_stop_machines = "stop"` with `min_machines_running = 0` saves money but
  kills the 3-hour refresher and pays a cold start on the first search. If you
  want the comparer to behave, set `min_machines_running = 1` and accept the
  ~$3.32/month.

---

## Sources (all checked 2026‑07‑22)

- Fly.io — [Resource pricing](https://fly.io/docs/about/pricing/) ("no longer offers plans to new customers"; legacy allowances; $0.15/GB volumes; card required), [Billing](https://fly.io/docs/about/billing/), [Free tier analysis](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
- Oracle — [Always Free Resources](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) (2 OCPU / 12 GB A1, 200 GB storage, 10 TB egress, idle-reclamation rule), [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/) (card requirement, home region), [InfoQ: Oracle quietly halves A1 limits](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Linuxiac](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/)
- Render — [Free tier docs](https://render.com/docs/free) (750 hrs, 15-min spin-down, **no disks on free**), [FAQ](https://render.com/docs/faq)
- Northflank — [Pricing](https://northflank.com/pricing) (Sandbox: 2 services, 1 DB, 2 cron, "always-on-compute – no sleeping")
- Koyeb — [Pricing](https://www.koyeb.com/pricing) (Mistral AI acquisition banner)
- Cloudflare — [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (100k req/day, 10 ms CPU), [Browser Rendering limits](https://developers.cloudflare.com/browser-rendering/platform/limits/) (10 min/day free), Pages free tier
- Firebase — [Pricing](https://firebase.google.com/pricing) (Spark: 10 GB hosting / 360 MB per day, 50 K Auth MAU, Firestore 1 GiB + 50 K reads/day), [Functions get-started](https://firebase.google.com/docs/functions/get-started) ("to deploy functions, your project must be on the Blaze pricing plan")
- Supabase — [Pricing](https://supabase.com/pricing) (500 MB DB, 5 GB egress, 50 K MAU, 2 projects, pause after 1 week, no custom domain on Free)
- Appwrite — [Free plan docs](https://appwrite.io/docs/advanced/platform/free), [Changelog 2026-01-08](https://appwrite.io/changelog/entry/2026-01-08)
- Neon — [Free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas); Turso — [Pricing](https://turso.tech/pricing)
- Tavily — [Credits & pricing](https://docs.tavily.com/documentation/api-credits) (1,000 free credits/month)
- Hetzner — [June 2026 price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) (CAX11 €4.49 + €0.50 IPv4)
- Chrome on ARM64 Linux — [Google blog](https://blog.google/chromium/bringing-chrome-to-arm64-linux-devices/) (shipped Q2 2026; before that, Chromium only)
- `.com.eg` — [Network Egypt](https://www.ne.com.eg/domain-names/com-eg-domain-registeration/) (~999 EGP/yr, Egyptian-company restriction)
- Payments — [Paymob/Fawry overview](https://payatlas.com/countries/egypt-eg) (~2.75% + 3 EGP quoted for Paymob local; **verify with the provider**)

A longer side-by-side appendix, including the options I rejected and why, is in
[`docs/hosting-options.md`](docs/hosting-options.md).

---

## Ecwid integration

The catalogue, the shop rails, the advertisement banners and (once its scopes
are granted) order fulfilment are driven by the Ecwid store that also backs
sadko-group.com.

Design: `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`, amended
by `docs/superpowers/specs/2026-09-21-ecwid-integration-revision-2.md` — read
revision 2 first, it corrects five assumptions the original got wrong.

### Two stores, and they do NOT share ids

| | Store | Note |
|---|---|---|
| Development | `142682751` | SADKO's test store, on `my.shopsettings.com` |
| Production | `18028328` | The store behind sadko-group.com |

**Their product and category ids are completely different.** The test store's
products are `865…` and its offers category is `206629522`; production's are
`676…` and `173607281`. Nothing in the site that is keyed to an id will match
the test store — the 30 generated `site/category/*.html` pages, the home-page
hotspot links, and the curated ids in the old `collections.json`.

So: verify the **mechanism** against the test store, and verify the
**storefront** against production. The rails resolve by Arabic name precisely so
the same code works on both.

### Configuration

Seven values, all optional except the first three, in `/etc/sadko.env` read by
`sadko.service`. **Put the token in that file yourself and never paste it into a
terminal, a commit, a chat message or this document.**

```
SADKO_ECWID=1
SADKO_ECWID_STORE_ID=142682751
SADKO_ECWID_TOKEN=<from Ecwid: Apps then Custom Apps then your app>
SADKO_ECWID_WEBHOOK_SECRET=<that app's client secret>
SADKO_ECWID_BANNER_CATEGORY=206811031
SADKO_ECWID_OFFERS_CATEGORY=<optional: overrides the name match>
SADKO_ECWID_BESTSELLERS_CATEGORY=<optional: overrides the name match>
```

**Use `KEY=value` with NO SPACES around the equals sign.** systemd's
`EnvironmentFile` does not parse `KEY = value` reliably, and the failure is
silent — the site simply keeps serving the July seed catalogue and nothing looks
broken.

**The variable name matters too.** `compare-server.mjs` reads
`SADKO_ECWID_TOKEN` and nothing else. A token placed as `ECWID_TOKEN` will be
accepted by the local tools (which tolerate it and warn) and ignored by the
server.

**Use the SECRET token, not the public one.** Ecwid issues TWO tokens per
custom app. The `public_…` one is read-only and limited to catalogue data — it
is meant to be embedded in a storefront. The `secret_…` one carries the app's
actual access scopes.

With a public token the catalogue syncs perfectly — products, categories and
the store profile all return 200 — and then `/orders` returns 403 and every
write returns 403. **That looks exactly like a missing scope and is not.** This
cost real diagnosis time once: the app already had "Read orders, Update orders"
granted, and the token simply could not use them. `--check` now detects a
public token and says so.

Find the secret one at Ecwid > Apps > Custom Apps > Edit > "Show secret token".

Then restart and check the connection, which reports the token as
present-with-a-length and never its value:

```
systemctl restart sadko
cd /srv/sadko/site && node tools/ecwid-capture.mjs --check
```

A `403` means the token is wrong, was revoked, or the custom app was not granted
that area. There is deliberately no separate preflight script: `--check` is it.

### Turning it on, in this order

1. Set the values with `SADKO_ECWID` still **unset**. Nothing changes.
2. Set `SADKO_ECWID=1`, restart, and let the first sync finish (about 10s for
   1,453 products). The mirror fills while the seed is still being served.
3. **Review the diff before customers see it:**
   `node tools/ecwid-diff.mjs`
   It reports additions, removals, reprices, real discounts and out-of-stock
   counts — and shouts if the two sides share no product ids at all, which means
   you are pointed at a different store rather than a drifted one.
   If the numbers look wrong, stop. Do not proceed.
4. Confirm the switch: the control-room dashboard's Ecwid panel should say
   **Connected to Ecwid**, and `GET /data/products.json` should report
   `"source": "ecwid"`.
5. Register the webhooks (below), then change a price in Ecwid and confirm it
   appears within seconds.
6. Order push: blocked until the app has order scopes (below).
7. Decide the customer email (below).

**Rolling back is unsetting the flag.** `SADKO_ECWID=` then restart; the seed
file is untouched and still there. `site/data/ecwid.db` is a cache — deleting it
and re-syncing is always safe.

### Webhooks

Register `https://<live-host>/api/ecwid/webhook` in the custom app's settings
and subscribe to `product.created`, `product.updated`, `product.deleted`,
`category.*` and `order.updated`.

**The signature scheme is unusual and easy to misdiagnose.** Ecwid does **not**
sign the request body. It signs the string `{eventCreated}.{eventId}` with
HMAC-SHA256 keyed on the app's **client secret**, base64, delivered in the
`X-Ecwid-Webhook-Signature` header. To reproduce one by hand when diagnosing a
401, use `signatureFor()` in `site/engine/ecwid-webhook.mjs`.

A missing `SADKO_ECWID_WEBHOOK_SECRET` rejects every delivery, deliberately — a
misconfigured server must be closed, not open. Because the signature covers only
those two fields, the route also checks the event's `storeId` against ours and
answers `202` to anything for another store.

Missed events are not a problem: an incremental pull runs every 15 minutes and a
full reconcile daily. The reconcile is the only thing that finds deletions.

### Advertisement banners

Ecwid has no banner entity, so a banner is a PRODUCT that the site recognises
and keeps out of the catalogue. It is recognised by **either** of two signals,
and neither is load-bearing on its own:

1. **Its SKU begins `banner-`** — `banner-hero`, `banner-wide`,
   `banner-square`. This is the recommended way: it needs no category at all,
   so nothing extra can ever appear in Ecwid's own storefront menu.
2. **It is in the category named by `SADKO_ECWID_BANNER_CATEGORY`** — which
   only works if that category is **enabled**, for the reason below.

**Do not rely on a disabled category.** The original design used a disabled
category so banners would be hidden from Ecwid's own shoppers. Testing the live
store showed that **Ecwid omits a disabled category from a product's
`categoryIds`** — a real product assigned to the disabled banner category kept
reporting only its enabled category, and the panel's own count went to (1)
while the API said nothing. A banner category hidden from shoppers is therefore
hidden from us too. Category `206811031` exists on the test store and is
disabled; it is kept as documentation, but the SKU signal is what works.

Keep each banner entry itself **disabled** — a disabled product never appears
in Ecwid's storefront, and the site reads it regardless.

Each entry is a banner, not a product:

| Ecwid field | Becomes |
|---|---|
| product image | the artwork |
| name | the headline |
| description | the subtitle |
| **SKU** | `banner-hero`, `banner-wide` or `banner-square` — identifies it AND sets the slot |
| product URL | the click-through target |

Keep each banner entry **disabled** and keep the category **disabled**, so they
never appear in Ecwid's own storefront. The new site reads them separately and
excludes them from the catalogue, search, rails and sitemap — a banner can never
be bought.

A banner with no artwork or no headline is skipped rather than rendered as an
empty strip. If the category is empty, `data/promos.json` is served instead.

**Derived banners carry no English.** This store holds no usable translations —
every `nameTranslated.en` contains the Arabic text — so `data/promos.json`
remains the bilingual source, editable in the control room under Content.

### Known blockers, recorded so they are not rediscovered

**Order push needs the SECRET token.** `/orders` returns **403** with the
public token. The app's scopes are already correct — this is the token-type
trap described under Configuration above, not a permissions problem. The order
mapper, the idempotent push queue and the status-flow-back are all BUILT and
unit-tested; swap the token and the path completes. Until then a placed order
is still recorded locally and simply parks in the push queue for retry, which
is verified live: the 403 parks it with backoff and nothing is lost.

**Delivery totals are blocked — by TWO things, and the first one is not what
this section used to say.**

An earlier version of this runbook claimed `POST /order/calculate` returns zero
shipping options for a Cairo address, and blamed the missing weights alone.
Both were wrong, and the correction matters: entering weights would **not** have
been enough.

Ecwid does return a figure, and it needs no weight to do it:

```
POST /order/calculate   one 65" TV, Cairo address
  → shippingOption: { shippingMethodName: "القاهرة الكبرى", shippingRate: 250 }
```

Note the field is `shippingOption` — **singular**, an object. The earlier "zero
options" reading came from looking for a plural `availableShippings` array,
which this response does not have.

Then the same call, against every governorate:

| Destination | Method Ecwid chose | Rate |
|---|---|---|
| Cairo | القاهرة الكبرى | 250 |
| Giza | القاهرة الكبرى | 250 |
| Alexandria | القاهرة الكبرى | 250 |
| Qalyubia | القاهرة الكبرى | 250 |
| Dakahlia | القاهرة الكبرى | 250 |
| Sohag | القاهرة الكبرى | 250 |
| Aswan | القاهرة الكبرى | 250 |
| Marsa Matrouh | القاهرة الكبرى | 250 |
| Red Sea | القاهرة الكبرى | 250 |

**Every address in Egypt gets the Greater Cairo method.** It should not — the
store defines twelve methods precisely because the Delta and Upper Egypt cost
more than Cairo. The cause is in the profile: `destinationZone` is `{}` on all
twelve methods, so none is bound to a region and Ecwid matches the first enabled
one for everything. `ratesTable` is `{}` on all twelve too, and only one method
(handicrafts, flat 50) carries a rate of any kind.

So there are two independent blockers, and **both** must be cleared:

1. **No destination zones.** Ecwid → Shipping & Pickup → open each of the twelve
   methods → set the governorates it covers. Until then any rate Ecwid returns
   is the Cairo rate, and showing it would undercharge every customer outside
   Cairo and Giza.
2. **No product weights.** 0 of 1,453. Eight of the twelve methods are size
   bands ("منتجات صغيرة" … "منتجات كبيرة جدا"), so even with the zones bound
   there is nothing to choose the band with. Ecwid → Products → set a weight
   per product, **or** replace the size bands with one rate per region.

The rate does scale with quantity today (250 / 300 / 350 / 450 for 1 / 2 / 3 / 5
pieces), so the per-piece part of the policy is configured; it is the region and
the size band that are not.

You do not have to tell the site when this is fixed. `engine/ecwid-shipping.mjs`
reports `quotable: false` with both reasons and their fixes, computed from the
live profile and a SQL count of weights — `GET /api/shipping-methods` shows the
current state. Clear both and `quotable` flips to true on its own.

Meanwhile checkout shows the store's own delivery policy, quoted from Ecwid and
attributed to the method that states it (the 350 cap, the 7-day and 14-day
windows, the holiday exclusions), and keeps delivery and installation as
confirmed by customer care on 19140.

Do not work around this by letting the customer pick the band. They can select
the LE 275 small-appliance rate for a refrigerator, and a displayed total that
is too low is a price SADKO would have to honour or retract.

**Customer and order reads need the SECRET token too.** `/customers` and
`/orders` both return **403** with the public token, which is why the account
page shows `ecwidLinked: false` today. The customer link and the merged order
list are BUILT and unit-tested (`engine/ecwid-customers.mjs`, 28 tests) but are
**unverified against a real payload** — this project has already guessed four
Ecwid field names wrong, so every reader there accepts the plausible spellings.
Check the real shapes once the secret token is in: place a phone order in Ecwid
against a registered customer's email and confirm it appears in their account
page marked "via customer care".

**Sign-in cannot move to Ecwid, and no amount of work will change that.** Ecwid
has no API that verifies a customer's password, and its SSO runs the other way
round — the merchant's site is the identity provider and signs a token *for*
Ecwid. The site therefore keeps its own accounts (scrypt, HttpOnly sessions) and
the two are linked by **email**, which is the key Ecwid itself files orders
under. If anyone asks for "log in with Ecwid", this is the answer.

### The customer confirmation email

The site sends **no email at all** today: confirmation is the on-screen receipt,
which deliberately refuses to show delivery as zero, plus a call on 19140.
Ecwid can email the customer, and that email may render unset shipping as free.

So Ecwid's **staff** notification is on and the **customer** email stays off
until this is checked: place a test order, read the email Ecwid actually sends,
and enable it only if the fees-to-be-confirmed line survives in the template. An
email implying free delivery is a false statement to a customer — leave it off
and report back rather than shipping it.

### How fast an Ecwid change reaches the site

The point of this integration is that staff edit Ecwid and the site follows,
with no developer involved. Three mechanisms do that, in order of speed.

**1. On page load (immediate).** A request for `/data/promos.json` or
`/data/products.json` asks Ecwid what changed first, if the last check is older
than the poll interval. So: edit in Ecwid, reload the page, see it. This is
what makes the site feel live without waiting for a timer.

**2. The poll (within a minute).** Every `SADKO_ECWID_POLL_SECONDS` (default
**60**) the server asks Ecwid for products changed since the last check, and
re-reads the advert folders. Cheap: the product call is incremental and almost
always returns nothing.

```
SADKO_ECWID_POLL_SECONDS=60     default
SADKO_ECWID_POLL_SECONDS=15     the floor; anything lower is clamped
SADKO_ECWID_POLL_SECONDS=0      polling off — webhooks only
```

It used to be **15 minutes**, which is why an uploaded banner appeared to do
nothing. An image upload *does* bump Ecwid's `updateTimestamp`, so the
incremental sync always saw it — the delay was the only problem.

**3. Webhooks (instant) — production only.** Ecwid pushes an event the moment
something changes. It cannot work against `localhost`: Ecwid has to reach the
server from the internet, so this only applies once the site is on its public
URL.

To turn it on:

1. Ecwid control panel → **Apps → your custom app → Webhooks**.
2. Endpoint: `https://<your public host>/api/ecwid/webhook`
3. Events: `product.updated`, `product.created`, `product.deleted`,
   `category.updated`, `order.updated`, `profile.updated`.
4. Put the app's webhook secret in `SADKO_ECWID_WEBHOOK_SECRET` and restart.

The endpoint verifies Ecwid's HMAC signature over `{eventCreated}.{eventId}`
(**not** the body — signing the body was the first implementation and would
have rejected every delivery), checks the store id, acknowledges immediately,
and only then does the work. An unsigned or wrongly-signed POST is refused.

A **product** event also re-reads the advert folders, because folder membership
cannot be read off the product — Ecwid omits a disabled category from
`categoryIds`. Without that, a banner created in the panel would arrive as an
ordinary product and keep its old slot until the next poll, leaving the instant
path slower than the timer for exactly the change adverts are edited for.

**4. "Sync now".** The SADKO admin panel has a button, and there is
`POST /api/admin/ecwid/sync` behind an admin session, for when someone wants to
force it.

#### What is NOT instant

A page already open in a visitor's browser does not change under them; they see
the update on their next navigation. That is ordinary web behaviour, not a
sync problem.

The **daily** full reconcile is separate and stays daily: it exists to find
products DELETED in Ecwid, which `updatedFrom` can never report.

### Advertisement folders — one Ecwid category per banner slot

The site reads adverts from Ecwid categories, one per slot, configured by **id**:

```
SADKO_ECWID_ADS_HERO=206876252     the strap atop the shop AND every category page
SADKO_ECWID_ADS_WIDE=206876253     the wide banner mid-page, and category-page tops
SADKO_ECWID_ADS_SQUARE=206866501   the square tile grid on the shop page
SADKO_ECWID_POLL_SECONDS=60        how often the site asks Ecwid what changed
```

Everything in a folder is an advert of that slot. Created in this store:

| Folder | Id | State |
|---|---|---|
| `Ads — إعلانات الموقع (لا تُعرض للعملاء)` | 206866002 | Disabled |
| `banner-square — الإعلانات المربعة` | 206866501 | Disabled |
| `banner-hero — اللافتة الرئيسية (أعلى الصفحة)` | 206876252 | Disabled |
| `banner-wide — اللافتة العريضة (وسط الصفحة)` | 206876253 | Disabled |

Each advert is an ordinary product inside the folder:

| Ecwid field | Becomes |
|---|---|
| **Name** | the headline (required) |
| **Image** | the artwork (required) |
| **Description** | the subtitle |
| **SKU** | where it points — see below |
| Uncheck **Requires shipping or pickup** | an advert is not a parcel |

**Addressed BY ID, NOT BY NAME, and that is forced on us.** A folder must be
disabled, or Ecwid shows it to its own shoppers and it turns up in this site's
category rail. But over the API a disabled category is nearly invisible:
omitted from `GET /categories`, an id-only stub under `hidden_categories=true`
with **no name**, and absent from the `categoryIds` of the products inside it.
What does work, measured against the live store: `GET /products?category=<id>`
returns its contents. Hence ids. Renaming the folders in the panel is therefore
free — the site never reads their names.

#### Where an advert points

The folder sets the slot, which leaves the SKU field free to carry the
destination. Only three shapes are accepted; this is staff-typed text going
into an href on our own pages, so the allow-list is a security boundary rather
than a convenience:

| SKU | Destination |
|---|---|
| `contact` | `contact.html` (any page on the SITE_PAGES list) |
| `product:837495061` | that product's page |
| `cat:206629766` | that category — and the advert is also targeted to that aisle |
| *(empty)* | the category the advert is assigned to, else the shop |

Absolute URLs, `javascript:`, `../` paths, non-numeric ids and any page not on
the list are all refused and fall back to the category. `admin` is deliberately
not on the list.

#### It merges with promos.json PER SLOT

A slot Ecwid has usable adverts for is Ecwid's; every other slot keeps its
`data/promos.json` entries **and their English copy**, which matters because a
derived advert carries none. So taking over the squares leaves the hero strap
alone. `GET /data/promos.json` reports `slotsFromEcwid` and `slotsFromLocal`.

An advert with no artwork or no headline is dropped, so until the images are
uploaded the local tiles simply stay in place. The reason is named per advert in
the startup log and in the admin panel rather than left to be guessed:

```
[ecwid] ads by slot: hero=0, wide=0, square=3
[ecwid] ad 866574542 (square) cannot render: no-image
```

#### All three slots, and where each one lands

| Folder | Id | Where the artwork appears |
|---|---|---|
| `banner-hero` | 206876252 | the rotating strap at the **top of the shop page and of every category page** — up to 3 rotate |
| `banner-wide` | 206876253 | the wide banner **mid-way down the shop page**, and eligible for the top of a category page |
| `banner-square` | 206866501 | the **grid of square tiles** on the shop page, between «مختارات صادكو» and «الأكثر مبيعاً» |

Square tiles never appear on a category page: the frame there is 1600×608 and a
1:1 tile would lose two-thirds of its own printed message.

**Each block is dealt artwork of its own shape.** On the shop page the wide
block takes `wide` artwork and the tile grid takes `square` artwork; a block with
none of its shape renders nothing rather than borrowing the wrong one. Before
this, adverts were dealt in list order, which was invisible while only one wide
advert existed — the second landed in the 1:1 grid and was stretched 2.6× tall.
So a wide advert beyond the first appears only where a wide frame exists: the
shop page has one, and every category page has one.

#### The banner at the top of a CATEGORY page

A category page shows hero and wide artwork only, chosen in this order:

1. adverts aimed at **that category** (or any of its subcategories),
2. then **brand-wide** adverts,
3. capped at three, and **never** an advert aimed at a different category —
   advertising fridges on the washing-machine page is worse than no banner.

Aim an advert with its SKU: `cat:206629766` sends it to the air-conditioners
page *and* makes that page its click-through. Leave the SKU as a plain page
name (`shop`, `contact`) and the advert is brand-wide — it appears on the shop
page and on every category page.

**Subcategories count.** A category page lists its descendants' products, so an
advert aimed at «نو فروست» also shows on the «ثلاجات» page. It still never
crosses to an unrelated category.

To give one aisle its own banner: add an advert to `banner-wide`, set the SKU to
`cat:<that category's live id>`, upload 1600×608 artwork. The live ids are in
`GET /data/categories.json`.

#### Ecwid rejects duplicate SKUs

Two adverts cannot both carry `contact` — the second is refused at save time
with *"This SKU is already in use"*. Since the SKU is the destination, and two
banners pointing at the same page is normal, add a uniquifier that the site
ignores:

| SKU | Destination |
|---|---|
| `contact` | contact.html |
| `contact2` | contact.html |
| `contact#2` | contact.html |
| `product:837495061#b` | product.html?id=837495061 |

A trailing number is stripped only from a **bare page name** — `product:837495061`
keeps every digit, because there they are the payload.

#### An ad folder is never a destination

An advert with no destination of its own falls back to the ordinary category it
is assigned to, then to the shop. The ad folders themselves are excluded: they
are disabled containers, so «the page for banner-wide» would be an empty
category page.

#### Artwork fills its frame — nothing is cropped

Both advert frames used `object-fit: cover`, which fills by trimming whatever
does not fit. That is wrong for an advert: the artwork is a composed image with
its headline, logo, phone number and web address baked in, and cover was
silently cutting the edges off — a 1284×1437 upload in a 1:1 tile lost about
11% of its height, which is exactly where the `www.sadko-group.com | 19140`
footer bar sits.

Both are now `object-fit: fill`: the whole image is shown, stretched to the
frame's boundaries. The trade is named rather than hidden — where the upload's
ratio differs from the frame's, the image is **stretched** instead of trimmed.
Upload at the frame ratio and there is no distortion at all:

| Slot | Frame ratio | Upload at |
|---|---|---|
| square tiles | 1 : 1 | 1000×1000 |
| solo wide tile | 1600 : 608 | 1600×608 |
| hero strap | 1600 : 608 | 1600×608 |

Product photos stay `object-fit: contain` — the opposite trade, because a
stretched appliance misrepresents the goods and a product photo carries no
baked-in text to lose.

#### Advert names are POSITIONAL, and the number sets the order

The artwork is replaced every couple of weeks; the slot it fills is not. A name
describing the picture would be a lie within a fortnight, so the names describe
the position instead:

| Name | Where it lands |
|---|---|
| `إعلان مربع ١ — شبكة صفحة المتجر` | shop page, advert grid, first (rightmost) |
| `إعلان مربع ٢ — شبكة صفحة المتجر` | shop page, advert grid, second |
| `إعلان مربع ٣ — شبكة صفحة المتجر` | shop page, advert grid, third |

The grid sits on the shop page between the «مختارات صادكو» rail and
«الأكثر مبيعاً». The page is right-to-left, so **١ is the rightmost tile**.

**The number in the name is the order control.** Rename ٢ to ٣ and the advert
moves — no need to touch the artwork. Arabic-Indic and Latin digits both work.
An advert with no number keeps its place, after the numbered ones, so a store
that never adopts the convention is unaffected.

#### The DESCRIPTION is the alt text

Because the name is positional it is useless as alt text — a screen reader would
announce the shelf instead of the offer, and so would the fallback text if the
artwork failed to load. So the advert's message lives in the **Description**,
and that is what becomes `alt`. The name is only the last resort, so alt is
never empty.

Whoever swaps the artwork should update that one line too. In this store:

| Name | Description (= alt) |
|---|---|
| `إعلان مربع ١` | صادكو بالتقسيط — ٦ شهور بدون فوائد |
| `إعلان مربع ٢` | توصيل صادكو — مهما كان مكانك هانوصل لك |
| `إعلان مربع ٣` | ثلاجة كريازى سوليتير إليجنت ٣٧٠ لتر — جديد بمقبض جانبي |

Nothing in an advert is rendered as visible text — the frames draw the image
only — so the name and description are never shown to a shopper. They are the
admin label and the accessible description respectively.

#### THE BLOCKER: adverts must be ENABLED until the secret token is in place

With the `public_` token, **every disabled PRODUCT comes back as
`{id, enabled:false}`** — no name, no image, no SKU, the same restriction as
disabled categories. So the rule written into the old SITE BANNERS category
description, "keep each banner DISABLED", cannot work on this token: a disabled
advert has nothing readable and is dropped every time.

The three square adverts are therefore **enabled**, and the cost is real. An
enabled product is reachable in Ecwid's own storefront by direct URL —
`https://sadko-test.company.site/products/sdkw-bltqsyt` answers 200 — as a
0.00 EGP item. It sits in no visible category and is not featured, so it does
not appear in browsing, but it is not hidden either.

Harmless on the test store. **Before doing this in production, get the secret
token**, then switch every advert back to Disabled: they stay fully readable to
the site and become invisible to Ecwid shoppers. It is the same token already
needed for orders and customers.

This also corrects an earlier reading of the catalogue recorded elsewhere in
this runbook: the ~463 products described as "empty shells with no name" are in
fact **disabled products** that the public token cannot see into.

### Category pages work against either store — read this before "fixing" one

The 30 pages in `site/category/` and the Shop dropdown in `site/assets/js/nav.js`
are keyed to **production** category ids. The test store shares **none** of them.
That used to mean two separate empty-page bugs:

* Picking a category from the Shop menu loaded, say, `category/38022381.html`,
  found no product in category `38022381`, and rendered "لا يوجد منتجات فى هذا
  القسم حاليًا". The page existed and was empty.
* Any link built from a **live** id — `appshell.js`'s `catHref` does exactly
  that — asked for `category/206642016.html`, which no file matches. A 404.

Both are now resolved **when the page is served**, by the one thing the two
stores share: the category name, which every static page already carries in
`data-cat-name`. See `site/engine/category-alias.mjs`.

Name matching is not equality, because staff typed the names by hand in Ecwid:

| The static page says | Ecwid says |
|---|---|
| خلاطات ومحضرات طعام | خلاطات و محضرات طعام |
| أجهزة صغيرة | اجهزة صغيرة |
| كاتيل وماكينات قهوة | كاتيل و ماكينات قهوة |
| أفران وبوتاجازات | أفران |
| الأكثر مبيعاً | المنتجات الاكثر مبيعاً |

So it tries exact, then space-insensitive, then containment, stopping at the
first tier with exactly **one** candidate. An ambiguous name resolves to
**nothing** on purpose — sending a shopper who asked for washing machines to the
dishwashers is worse than the empty page. In production, where the ids already
agree, the file is served byte-for-byte from disk.

**A parent category browses its whole subtree.** Ecwid files a product under the
child only: 0 of the 144 products in "نو فروست" mention their parent "ثلاجات".
Matching the parent id alone found nothing, so the fridges page was empty with
217 fridges one level down. `shop.js` loads `data/categories.json` for `parentId`
and `shop-core.js` expands the subtree. It also reads `categoryIds` rather than
just the single default `categoryId`, so the 70 products that sit in more than
one category appear in each of them.

**A product with no category gets no facet.** Ecwid uses 0 for "no category" and
the mapper nulls it; 7 products (gym equipment) are in that state. They used to
be counted under `String(null)` and rendered a nameless "فئة"/"Category" facet
that led to another empty page. They stay in the listing and in search.

#### When staff add a category in Ecwid

**Nothing is required for it to work.** A live category with no file of its own
gets a page generated from one of the hand-built shells, so `catHref` and the
facet rail both reach it. That is a change from the old behaviour, where a new
category had no page at all.

You only need a **static** page for a category that should have a stable URL in
the Shop dropdown and in sitemaps. For that: get the English name from the owner,
add the id to `NAMES` and the pair to `CAT_EN` in **both**
`site/mkcategories.mjs` and `site/assets/js/nav.js` (they must stay in sync), run
`node site/mkcategories.mjs`, and deploy. The build asserts on a missing English
name on purpose — a category name cannot be invented.

Note also that Ecwid hides disabled categories from `GET /categories` unless you
pass `hidden_categories=true`, and even then returns them as id-only stubs with
no name — which is why the banner category does not appear in the taxonomy.

### The product page is the site's own, not Ecwid's

Until this change, clicking any product left the site: cards hrefed `p.url`
(the Ecwid storefront, `sadko-test.company.site/products/…`) and the product
page's one primary button did the same in a new tab. The page that exists to
give buying guidance ended by handing the buyer to a different shop.

Everything now stays on the site and renders Ecwid's data:

| On the page | Where it comes from |
|---|---|
| Image gallery | `images[]` — 427 products carry 2–7, and only the first used to show |
| Rich description | `descriptionHtml`, sanitised — see below |
| In stock / "only N left" | `inStock`, and `quantity` **only when `stockTracked`** |
| Product code | `sku` |
| Weight | `weight`, only when staff entered one (0 is Ecwid's "unset") |
| Payment and instalment plans | `/api/payment-methods`, live from Ecwid |
| Was-price and discount % | `compareToPrice`, only when genuinely above the price |

Two things worth knowing before editing it:

**The rich description is sanitised, and that is not optional.** Ecwid stores
descriptions as rich-text HTML (all 981 of them carry tags, including `img` and
`a`). `safeHtml()` in `engine/ecwid-map.mjs` keeps an allow-list of structural
tags and drops **every attribute** — no `href`, `src`, `style` or `on*` survives
— and removes `script`/`style`/`iframe` with their contents. It is written into
`innerHTML` on the site's own origin, so anything that survived would run or
beacon with the shopper's session. Staff-authored is not the same as trusted.
Verified in the browser: the rendered description carries 0 attributes.

**It rides `/api/product/:id`, not `products.json`.** The catalogue list is
fetched by `nav.js` on *every page of the site* and is already ~1.8 MB for 990
products; carrying the rich description in it would add roughly another megabyte
to every page load to serve something one page reads. `listShape()` in
`engine/ecwid-source.mjs` strips it from the list, and the detail endpoint is
scoped to what the storefront actually serves — a disabled product, an empty
shell or a banner entry 404s rather than opening as a product.

With `SADKO_ECWID` off the page falls back to the list entry and behaves exactly
as it did before, so the flag is still a clean rollback.

### Who owns what

| Concern | Owner |
|---|---|
| Products, prices, stock, categories, was-prices | **Ecwid** |
| Payment and shipping method lists | **Ecwid** |
| Order fulfilment and status | **Ecwid**, once scopes are granted |
| The offers / best-sellers / picks rails | **Derived** from Ecwid — not editable |
| Banner artwork | **Ecwid** banner category, with `promos.json` as fallback |
| Bilingual banner copy (`promos.json`) | SADKO control room — Ecwid has no usable translations |
| Buying guides, finder questions | SADKO control room |
| Product `badge` | SADKO control room — this store sets no Ecwid ribbons |
| Product page content: images, description, SKU, availability | **Ecwid** — the site renders it, Ecwid holds it |
| Customer accounts, sessions, saved homes | **SADKO** — Ecwid has no API that verifies a customer's password |
| Customer identity across the two | **Email**, the key Ecwid files orders under |
| A customer's order history | **Both**, merged — site orders plus the ones staff type into Ecwid |
| Delivery charge | **Nobody yet** — blocked on zones + weights, see above |
| The price comparer | SADKO — unaffected by Ecwid |

### Diagnosing

```
node tools/ecwid-capture.mjs --check     credentials and which endpoints answer
node tools/ecwid-capture.mjs --survey    catalogue health: weights, options,
                                         was-prices, images, missing names
node tools/ecwid-diff.mjs                what a cutover would change
node tools/ecwid-diff.mjs --sync         refresh the mirror first, then diff
```

The control room's Ecwid panel shows counts, the last sync, the last error, and
which categories the rails resolved to. A rail that resolved to nothing is
otherwise invisible until someone notices an empty row on the shop page.

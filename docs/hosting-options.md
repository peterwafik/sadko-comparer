# Hosting options for SADKO — the long version

Appendix to [`../LAUNCH.md`](../LAUNCH.md). Everything here was checked with web
searches on **2026‑07‑22**. Free tiers move; re-check before you commit.

The point of this document is to record **why** each option was accepted or
rejected, so that when a free tier changes (and one will) the next person does
not have to redo the research from zero.

---

## The test every option has to pass

SADKO's comparer is one Node 24 process that must simultaneously:

1. hold an **always-on process** — background crawl waves keep running after the
   HTTP response is sent, and a `setInterval` refresher fires every 3 hours;
2. make **arbitrary outbound HTTPS** calls to whatever retailer domain is in
   `site/data/stores.json` — not a fixed allow-list;
3. **spawn and keep a headless Chromium**, driven over the CDP *pipe* transport
   (fd3/fd4), because B.TECH's search API is bearer-gated and only the store's
   own page can call it with its own token;
4. **write an on-disk SQLite database** (`node:sqlite`, WAL, FTS5) that survives
   restarts and redeploys;
5. run with **zero npm dependencies and no build step**.

An option fails if it misses any one of these. Most fail on (1) or (3).

---

## Rejected, and precisely why

### Vercel / Netlify

Fails 1, 3, 4. Functions are stateless and short-lived; the filesystem is
ephemeral; a background crawl wave is killed when the response returns. The
existing `DEPLOY.md` already makes this argument and it remains correct.

### Cloudflare Workers

Fails 1, 3, 4, and hard. The free plan gives **100,000 requests/day and 10
milliseconds of CPU time per invocation**. Ten milliseconds does not cover
parsing a single retailer product page. Workers also cannot spawn processes at
all — there is no Chromium to spawn. D1 (SQLite-flavoured) and R2 exist and are
good, but they are a *different* database, not a mount for `catalog.db`, so
`node:sqlite` would have to be replaced.

**Cloudflare Browser Rendering** is the sanctioned way to get a browser at the
edge. Free plan: **10 browser-minutes per day, 3 concurrent browsers, 1 new
instance every 20 seconds, 60-second browser timeout**, and the crawl endpoint
is limited to 5 jobs/day of at most 100 pages. Ten minutes a day is a demo
budget. The paid plan lifts the daily limit and raises concurrency to 120.

**Cloudflare Pages, however, is accepted for the static half** — unlimited
bandwidth and requests, 500 builds/month, free TLS, custom domain, no card. If
SADKO ever splits, this is where the HTML goes.

### Render (free)

Fails 1 and 4. Free web services **spin down after 15 minutes without inbound
traffic** and take about a minute to spin back up, and free instances **cannot
attach a persistent disk**. The catalog would revert to the committed snapshot
on every restart, and once accounts live in SQLite, customer data would go with
it. The free allowance is otherwise reasonable — 750 instance-hours/month per
workspace, 512 MB RAM / 0.1 CPU, 100 GB outbound bandwidth, 500 build minutes,
custom domains and managed TLS included — which makes it a fine host for a
static marketing site and a bad host for this engine.

Render's paid tier with a disk works fine; it just is not free.

### Firebase

Fails 2 outright on the free plan. **Spark blocks all outbound network requests
except to Google-owned services**, and separately, **deploying Cloud Functions
requires the Blaze (pay-as-you-go) plan** — the docs say so plainly: *"You can
emulate functions in any Firebase project, but to deploy functions, your project
must be on the Blaze pricing plan."* So the single capability SADKO would want
from Firebase server-side — fetching a retailer's page — is unavailable for free
by design.

What Firebase *is* good at, and what its Spark limits are:

| Product | Spark (free) limit |
|---|---|
| Hosting | 10 GB storage, **360 MB/day** transfer (~10 GB/month), custom domain + SSL included |
| Authentication | **50,000 MAU**, Google sign-in included |
| Cloud Firestore | 1 GiB stored, **50 K reads / 20 K writes / 20 K deletes per day**, 10 GiB egress/month |
| Cloud Functions | **Blaze required to deploy.** Blaze's own no-cost tier: first 2 M invocations, 400,000 GB-sec, 200,000 CPU-sec, 5 GB egress per month |

360 MB/day of hosting transfer is the number people miss — SADKO ships video
assets (`site/assets/vid`), and a handful of visitors would exhaust it.

### Koyeb

Uncertain rather than disqualified. Koyeb's pricing page currently carries the
banner *"Koyeb is joining Mistral AI to Build The Future of AI Infrastructure"*,
and secondary sources report the free Starter tier was **closed to new users**
after the acquisition, with the roadmap moving toward GPU/AI inference. The free
Postgres shown on the pricing page is 0.25 vCPU / 1 GB RAM / 1 GB storage.
**⚠️ verify directly if you want to use it** — but betting a launch on a
platform mid-pivot is a poor trade when Oracle exists.

### Railway

Not free, and honest about it: Hobby is $5/month with $5 of usage included, and
billing is usage-based **with no hard spending cap**. Technically it does
everything SADKO needs (real process, volumes, no sleeping). If you are going to
pay ~$5/month anyway, a Hetzner VPS at €4.99 gives you more machine and a
predictable bill; Railway gives you a much nicer developer experience.

### PocketBase

Rejected on redundancy, not capability. PocketBase is an excellent single-binary
Go backend with its own SQLite, auth and admin UI — but SADKO **already has**
server-side auth (`site/engine/accounts.mjs`: scrypt with per-user salt,
timing-safe verification, SHA-256-stored session tokens, per-email+IP rate
limiting) and **already uses SQLite** via `node:sqlite`. Adopting PocketBase
means running a second process that duplicates what you have, and you would
*still* need a host for it — the same host that could just run the Node process.
It solves nothing here.

### Neon / Turso

Both are good products aimed at a problem SADKO does not yet have.

- **Neon (free):** 0.5 GB storage per project, 100 CU-hours per project per
  month, 5 GB transfer, 100 projects, 10 branches per project; compute **scales
  to zero after 5 minutes** and can scale to 2 CU (~8 GB RAM) when active.
- **Turso (free):** 5 GB total storage, **500 M rows read/month**, 10 M rows
  written/month, 100 databases.

The catalog is a **4.7 MB local file** that the engine reads on every search
with FTS5. Moving it to a network database adds a round trip to the hottest path
in the product for no benefit. The one future scenario where Turso becomes
interesting is edge-replicating the catalog close to users — that is a
performance project for a much later date.

### Appwrite Cloud

A credible Firebase alternative with a self-hostable core, but its free plan is
tightening: a **2026‑01‑08 changelog entry reduced the free function limit to
2**, and a **2026‑03‑19 entry** added realtime usage enforcement. Documented
free-plan structure: 1 organisation, 2 projects, 1 database, 3 buckets, 5
functions (per the docs page — which contradicts the changelog, so **⚠️
verify**), ~2 TB bandwidth, 2 M realtime messages/month, 250 concurrent
connections. Its functions are containers and could in principle reach external
sites, but you would still be re-platforming auth and data onto a vendor whose
free tier is visibly shrinking, to solve a problem the repo has already solved.

---

## Accepted

### Oracle Cloud Always Free — the recommendation

| | |
|---|---|
| Compute | **1,500 OCPU-hours + 9,000 GB-hours per month** on Ampere A1 = **2 OCPU / 12 GB RAM** running continuously |
| Also included | 2 × `VM.Standard.E2.1.Micro` (1/8 OCPU, 1 GB) AMD instances |
| Storage | **200 GB** total boot + block volume, 5 volume backups; boot volume default 50 GB, min 47 GB |
| Egress | **10 TB per month** |
| Duration | Always Free — no expiry — plus a separate US$300 / 30-day trial |
| Card | Credit or debit required for identity verification. **Prepaid and virtual cards are rejected.** Temporary authorisation hold, released in 3–5 days |
| Region | **Home region is chosen at signup and cannot be changed**; Always Free compute exists only there. No Egypt region — nearest useful are Jeddah, Dubai, Abu Dhabi; Frankfurt/Amsterdam are common but capacity-constrained |

**The June 2026 cut.** Oracle halved the A1 allowance from 4 OCPU / 24 GB
(3,000 OCPU-hrs + 18,000 GB-hrs) to 2 OCPU / 12 GB (1,500 + 9,000), effective
**15 June 2026**, **with no blog post, no email and no announcement** — the docs
were simply edited, and users found out when instances stopped. Whether Pay As
You Go tenancies were also cut is genuinely unclear: Oracle support has given
contradictory answers, with documentation saying the new limits apply to "all
tenancies" and support emails saying free-tier only. **⚠️ unresolved.** Plan as
if it applies to you.

**Idle reclamation, verbatim from the docs:** *"Idle Always Free compute
instances may be reclaimed by Oracle. Oracle will deem virtual machine and bare
metal compute instances as idle if, during a 7-day period, the following are
true: CPU utilization for the 95th percentile is less than 20%; Network
utilization is less than 20%; Memory utilization is less than 20% (applies to A1
shapes only)."* All three conditions must hold. See `LAUNCH.md` §5.10 for
mitigations.

**"Out of host capacity"** on A1 shapes is routine in busy regions. Retry across
availability domains, retry on another day, or upgrade to PAYG for priority
access.

**Why it still wins:** 12 GB of RAM is luxurious for a resident Chromium; 200 GB
of disk makes the SQLite question trivial; 10 TB of egress is more than SADKO
will use in years; nothing sleeps; you control the whole box, so `node:sqlite`,
child processes and timers all just work; and the zero-dependency property
survives because you install nothing but Node and Chromium.

### Fly.io — the paid fallback, and a correction to `DEPLOY.md`

**Fly.io no longer has a free tier for new customers.** The pricing page states
plainly that *"Fly.io no longer offers plans to new customers"*; the permanent
free resource allowance was removed in October 2024. What remains:

- **Legacy allowance**, honoured only for eligible older Hobby/Launch/Scale
  organisations: up to 3 × `shared-cpu-1x` 256 MB VMs, 3 GB total persistent
  volume, 100 GB outbound (NA/EU) or 30 GB (APAC).
- **New signups** get a short trial (widely reported as ~$5 credit / 2 VM-hours
  / 7 days, whichever ends first) and then pay.
- **A credit card is required** on all organisations except Linked Orgs; if you
  have no card you must pre-purchase **$25** of credits.
- Real prices: `shared-cpu-1x` 512 MB ≈ **$3.32/month** (Amsterdam; varies by
  region), volumes **$0.15/GB/month**, egress **$0.02/GB** in NA/EU (more in
  APAC).

Fly is still the *fastest* path from this repo to a URL, because `Dockerfile`
and `fly.toml` are already written and correct. It is simply not free. Two gaps
to close before it matches the Oracle setup: the Dockerfile **does not install
Chromium**, and `auto_stop_machines = "stop"` with `min_machines_running = 0`
defeats the 3-hour refresher.

The line in `DEPLOY.md` that says Fly.io has a "free allowance" should be read
as historical.

### Northflank Sandbox — the most promising PaaS free tier, unverified

The pricing page advertises the Sandbox tier as **2 free services, 1 free
database, 2 free cron jobs**, with *"Always-on-compute – no sleeping :)"* stated
explicitly — which is exactly the property Render's free tier lacks. Secondary
sources add persistent volumes and no cold starts. A card is required, but only
for verification: *"when you enter a card we only verify the card. Your card is
only charged at the end of the billing cycle."*

**What I could not confirm:** the vCPU, RAM and volume-size numbers for the
Sandbox tier. They are not on the pricing page and I could not find them in the
docs. Paid compute is quoted at $0.01667/vCPU-hour and $0.00833/GB-hour, which
tells you nothing about the free allocation. **⚠️ verify by signing up and
reading the dashboard before choosing this.** If the free volume turns out to be
1 GB or more and RAM is ≥1 GB, Northflank is a serious alternative to Oracle
with far less operational work — the container would run the same `Dockerfile`
in this repo, plus a Chromium install.

### Supporting free services worth using regardless of host

| Service | Free allowance | Use for |
|---|---|---|
| **Cloudflare DNS + CDN + Universal SSL** | free plan, no card | DNS, TLS at the edge, caching static assets, DDoS |
| **Cloudflare Tunnel** | free, unlimited tunnels, Zero Trust free up to 50 users | Exposing the origin with **no open inbound ports and no static IP** — useful if the VM has no public IPv4, or to run from an office machine |
| **Caddy + Let's Encrypt** | free | Origin TLS, automatic renewal, one-line config |
| **Google Identity Services** | free; Firebase Auth's own free tier is 50 K MAU | "Sign in with Google" — needs only a public `GOOGLE_CLIENT_ID`, no secret |
| **Tavily** | **1,000 API credits/month, no card** (1 credit basic, 2 advanced) | `TAVILY_API_KEY` — URL discovery for unreachable stores |
| **UptimeRobot free / Cloudflare health checks** | free tier | Monitoring `/api/stores`, and incidentally generating anti-idle traffic |

---

## If you end up paying

Ranked by cost-per-usefulness for this specific workload:

1. **Hetzner CAX11** — 2 vCPU ARM, 4 GB RAM, 40 GB SSD: **€4.49/month + €0.50
   for the IPv4 address**. Note Hetzner raised cloud prices in June 2026. Least
   RAM of the options here, so watch Chromium's footprint.
2. **Oracle Pay As You Go** — keeps the Always Free resources, removes idle
   reclamation, gives capacity priority; you pay only for overage. **Set a
   budget alert immediately**, because the account becomes uncapped.
3. **Fly.io** — ~$3.32/month for a 512 MB machine plus $0.15/GB/month of volume;
   more per unit of compute, but the deploy story is already written in this
   repo and `fly secrets` is a better secret store than a file on a VM.
4. **Railway** — nicest DX, usage-based, no spending cap. Fine if someone is
   watching the bill.

---

## Things this document could not confirm

- Northflank Sandbox: exact vCPU / RAM / volume size.
- Whether Oracle's June 2026 halving applies to Pay As You Go tenancies.
- Which Oracle regions currently have Ampere A1 capacity available (changes
  constantly).
- Whether Koyeb's free tier is still open to new signups post-acquisition.
- Appwrite's current free function count (docs say 5, a January 2026 changelog
  says 2).
- Whether Ubuntu's snap-packaged `chromium-browser` works with
  `site/headless.mjs`'s `--remote-debugging-pipe` + `--user-data-dir` under
  `/tmp`. Snap confinement is the suspected problem; a Debian `.deb` Chromium or
  the arm64 Google Chrome build (shipped Q2 2026) avoids the question.
- Real Paymob / Fawry merchant terms — the ~2.75% + 3 EGP figure is from a
  third-party comparison, not from Paymob.
- Current free tiers for transactional email (Resend / Brevo / SES) — needed
  before password reset can exist.

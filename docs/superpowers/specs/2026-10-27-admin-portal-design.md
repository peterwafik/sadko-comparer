# Admin portal: design

Date: 2026-10-27. Approved by the owner from the mockup ("continue with the full work").

## Intent

Replace today's admin page (`site/admin.html` + `assets/js/admin.js`) with a portal that:

1. has its **own login**, separate from customer accounts. The owner provides admin emails; each gets a
   temporary password, must set a new password on first sign-in, and must enrol an authenticator app (TOTP).
2. **stores nothing that Ecwid already holds.** Products, prices, stock, badges, categories, ads, coupons,
   orders, customers, payment and delivery methods are read from and written to Ecwid through its API.
   The site's local Ecwid mirror stays: it is a cache that keeps the storefront fast and alive through an
   Ecwid outage, not an admin store.
3. gives **real forms** for what only the website has: the home-page scenes and their clickable points,
   buying guides, finder questions, the announcement bar and hotline. No raw JSON.

## Non-goals

- No new hosting, no separate app: same Node handler, same Vercel function, same Turso database.
- The scene videos, stills and camera flight are not editable. Text and points are.
- No card payments, no rate-table editing for delivery (the size-band rate card parses method titles; editing
  amounts belongs in Ecwid until that is redesigned). Delivery methods can be switched on/off.

## Anti-goals

- An admin portal that keeps its own copy of an Ecwid fact (a price, a hidden flag, a badge, an ad).
- A login weaker than the customer one, or any path back in through `ADMIN_EMAILS`.
- A raw JSON textarea anywhere in the portal.

## Login

- Table `admin_users` (email, salt, hash, must_reset, temp_expires, totp_secret encrypted, totp_pending,
  totp_on, last_totp_step, failed, locked_until, created_at, created_by, last_login_at) and
  `admin_sessions` (token digest, email, stage, expires_at). Own store, `engine/admin-auth.mjs`.
- Passwords: scrypt, as customer accounts. New passwords ≥ 12 characters, not containing the email name,
  not on a short common-password list.
- Temporary password: 16 characters from an unambiguous alphabet, valid 48 hours, generated server-side and
  returned exactly once.
- Stages: `reset` (temporary password used) → `enroll` (QR + key shown, code confirms) → `full`.
  A returning admin goes password → `totp` → `full`.
- TOTP: RFC 6238, SHA-1, 30 s, 6 digits, ±1 step, a step is never accepted twice. The secret is encrypted
  at rest with AES-256-GCM under a key derived from `SADKO_ADMIN_SECRET`.
- 5 failed attempts (password or code) lock the account for 15 minutes.
- Cookie `sadko_admin`: HttpOnly, SameSite=Strict, Secure on https. Full sessions last 8 hours; setup stages
  15 minutes. Every mutating admin request must also carry `x-sadko-admin: 1` (CSRF belt and braces).
- Invites: `POST /api/admin-auth/invite` from a signed-in admin (Admins page) or with
  `Authorization: Bearer $SADKO_ADMIN_SECRET` (the CLI `tools/admin-invite.mjs`, for the first admin).
  Inviting an existing email resets it completely (new temporary password, authenticator cleared).
- `ADMIN_EMAILS` and the customer-side `isAdmin` link are removed.

## What the portal reads and writes

| Page | Lives in | Notes |
|---|---|---|
| Dashboard | both | counts from Ecwid + site funnel |
| Home scenes | site (`scenes` content) | per scene: label/eyebrow/title AR+EN; per point: AR+EN name, link, desktop and phone position. Editor shows the actual frame (video seeked to the showcase moment) and the phone still. |
| Ads by page | Ecwid | ad = product in a disabled Ecwid ad folder; folder ids in site settings (env still overrides); "set up folders" creates them. Destination in SKU, Arabic + `EN:` message in description, position number in name. Shop page (hero / wide / square) and Category pages (preview what shows there, add one aimed at it). |
| Buying guides, Finder | site (content) | generic structured form editor |
| Site bar & hotline | site (settings) | served at `/data/site.json`, rendered by nav.js |
| Orders | Ecwid | list/search/status/tracking straight from Ecwid; site queue (not yet in Ecwid) shown separately |
| Products | Ecwid | name, price, was-price, description, category, stock, on/off, badge (= Ecwid ribbon), main image |
| Coupons | Ecwid | list/create/edit/pause/delete |
| Delivery fees | Ecwid | methods on/off, size-band report |
| Payment methods | Ecwid | on/off, title, customer instructions |
| Customers | Ecwid | Ecwid customer list, flag for a website login |
| Admins | site | invite / reset / remove |
| Activity log | site | audit of every admin action |

## Removal of duplicated storage

- The product overlay (`overrides`, `custom`, `hidden`) stops being read or written; the storefront serves the
  Ecwid catalogue as is. Badges come from the Ecwid ribbon.
- `promos` leaves the editable content list; the Ecwid ad folders plus the bundled `promos.json` fallback serve ads.
- Existing leftovers in the database are listed on the Products page with a "discard" action, so nothing
  disappears silently.

## Left to the builder

Visual design (follow the site's teal/ink palette and Cairo font), module split, exact copy.

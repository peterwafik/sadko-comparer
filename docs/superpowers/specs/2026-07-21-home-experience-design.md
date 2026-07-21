# Home Experience — Design Decisions

**Date:** 2026-07-21
**Status:** built autonomously while the owner is away; decisions documented for review.

## What it is

A new page, **`/experience.html`** ("تجربة البيت" / "Home Experience"), where a
customer composes a set of appliances they want to physically try — turned on,
in a simulated home room inside a SADKO showroom, with a guide and even a meal
demo (a dish from the fridge, heated in the microwave) — then picks a branch,
schedules a visit, and books. The website's job is to let the customer **compose
the experience and book it**; the physical simulation happens in the branch.

## The flow (a single-page guided stepper)

A 5-step stepper with a progress rail, all state held client-side until submit:

1. **Build your room** — browse the catalog (category → subcategory → products
   from `products.json`) and add devices to an "experience list" (separate from
   the shopping cart — this is a *try* list, not a *buy* list). Multiple devices
   across categories are encouraged; picking 2+ of one category surfaces a
   "compare these on your visit" hint linking to the comparer.
2. **Choose a branch** — the 7 real showrooms (from `showrooms.html`), with
   region + address. The summer-only Marina branch is flagged.
3. **Pick date & time** — a calendar (future dates, ≤60 days) + time slots.
   Slots come from the server (`/api/experience/slots`) with simple capacity so
   a full slot shows as taken.
4. **Your details** — name + Egyptian phone (for the confirmation call). Minimal
   PII, validated client- and server-side.
5. **Review & confirm** — full summary → `POST /api/experience/book` → a booking
   reference and a "we'll call you to confirm" confirmation screen.

## Key decisions (made autonomously)

- **Separate "experience list" from the cart.** Own localStorage key
  `sadko-experience-v1`. Buying and trying are different mental models.
- **Guided single-page stepper**, not multi-page — keeps composed state, feels
  modern, and matches "compose then book".
- **A tasteful "your room" tray**, not heavy 3D. Selected devices render as a
  composed set with images and the included perks (guided tour, meal demo,
  side-by-side comparison). Honors the vision without fragile 3D.
- **Backend = a small `engine/bookings.mjs` module + two routes**, JSON-file
  backed (`data/bookings.json`), zero dependencies, matching the codebase.
  Unit-tested with `node:test`.
- **Full Arabic-first (RTL) + English**, using the existing per-page `T` table +
  `data-i18n` pattern and `catalog-i18n.js` for product titles.
- **Design language is the existing SADKO system** — Cairo, teal `#2e7e88` +
  amber `#fe9800`, `category.css` tokens, `nav.js`-injected header, the footer
  block, glass panels, pill buttons, product `.card`s. New components (stepper,
  room tray, calendar, slots) are built in that same language.
- **Nav gets a new link** "تجربة البيت / Home Experience", with active-state
  detection, and the showrooms page links across to it.

## API contract

```
GET  /api/experience/slots?branch=<id>&date=YYYY-MM-DD
       -> { date, slots: [{ time, taken:boolean }] }
POST /api/experience/book
       body { branch, date, time, name, phone, notes?, devices:[{id,title,image,price,category}] }
       -> { ok:true, ref } | { error }
```

Booking record (`data/bookings.json`):
`{ ref, createdAt, branch, date, time, name, phone, notes, devices[], status:'pending' }`

Validation (both sides): ≥1 device; branch must exist; date future & ≤60 days;
time must be an offered, non-full slot; name ≥2 chars; phone matches Egyptian
mobile/landline. A full slot or a taken booking is rejected server-side even if
the client raced it.

## Out of scope (deliberately)

- Real 3D room rendering, payment (the visit is free), SMS/email sending (the
  confirmation is a phone call SADKO staff make — the booking just records it),
  and a staff admin UI (bookings are stored; a viewer can come later).

# Ecwid integration — revision 3

**Date:** 2026-09-22
**Status:** implemented
**Amends:** revision 2 (`2026-09-21-ecwid-integration-revision-2.md`), which amends
the original design (`2026-09-15-ecwid-integration-design.md`).

Revision 2 was written with control-panel access but only a read-only token.
Implementation then tested every assumption against the live store, and four of
them were wrong. This records what changed and why, so the next person does not
re-derive it.

---

## 1. The 403 on `/orders` was never a missing scope

Revision 2 §8 recorded the blocker as "the custom app was not granted order
access". The app's access scopes actually read *"Read store profile, Update
orders, Read orders, Create catalog, Update catalog, and 2 more"* — they were
correct all along.

**The real cause: the token in use is a `public_` token.** Ecwid issues two per
custom app. The public one is read-only and limited to catalogue data (it is
designed to be embedded in a storefront); the secret one carries the app's
scopes. With a public token the catalogue syncs perfectly and `/orders` plus
every write return 403 — a symptom indistinguishable from a missing scope.

`tools/ecwid-env.mjs` now detects a public token and says exactly this, because
it cost real diagnosis time once.

**Consequence:** the order half (Tasks 11–13) is built and unit-tested, and
completes the moment the secret token replaces the public one. Nothing else
needs to change.

## 2. Banners cannot be found by a disabled category

Revision 2 §3 specified banners as entries in a **disabled** Ecwid category, so
they would be invisible to Ecwid's own shoppers.

**Ecwid omits a disabled category from a product's `categoryIds`.** Proved by
assigning a real product to the disabled banner category (`206811031`): the
panel's own count went to (1), and `GET /products/<id>` kept reporting only
`[206629520]`, its enabled category. A banner category hidden from shoppers is
hidden from the integration too, so that design could never have worked. (The
test assignment was reverted; the store is back to 1,453 products with the
category empty.)

**Replacement — a banner is recognised by EITHER signal, neither load-bearing:**

1. **SKU begins `banner-`** (`banner-hero`, `banner-wide`, `banner-square`).
   Recommended: needs no category at all, so nothing extra can appear in
   Ecwid's storefront menu, and it does not depend on category-visibility
   semantics that already surprised us once.
2. **Membership of `SADKO_ECWID_BANNER_CATEGORY`**, which works when that
   category is **enabled**.

Banner entries stay **disabled as products** — a disabled product never renders
in Ecwid's storefront, and the API returns it regardless (the 463 empty shells
prove disabled products are returned).

**One question deliberately left open:** whether Ecwid returns a SKU on a
*disabled* product. All 463 disabled products in this store are entirely blank —
no name, price or image — so the data cannot settle it, and creating a banner to
test it needs uploaded artwork. If Ecwid does blank the SKU, signal 2 with an
enabled category is the fallback. That is precisely why both exist.

## 3. Delivery totals: decision reverted, with evidence

Revision 2 §2.2 decided checkout would call Ecwid and show a real delivery
total. Implementation found this is not deliverable:

- **0 of 1,453 products carry a weight** or any dimension.
- `POST /order/calculate` returns **zero shipping options** for a Cairo address.
- 11 of the 12 shipping methods the API returns use `table` rate calculation,
  which needs a number to look up.

So checkout keeps revision 1's behaviour: items subtotal only, delivery and
installation confirmed by customer care on 19140. **This must not be worked
around by letting the customer choose the shipping band** — they could select
the LE 275 small-appliance rate for a refrigerator, and a displayed total that
is too low is a price SADKO would have to honour or retract.

Also corrected: the endpoint is `POST /order/calculate` (singular). The plural
form answers 405.

## 4. The webhook signature covers almost nothing

Revision 1 §5.2 said the signature is an HMAC over the request body. **Ecwid
signs only the string `{eventCreated}.{eventId}`**, HMAC-SHA256 with the app's
client secret, base64, in `X-Ecwid-Webhook-Signature`. Implementing the design
as written would have rejected every delivery, silently.

Because the signature covers neither `storeId`, `entityId` nor `eventType`, a
valid signature proves only that Ecwid sent *something*. Two things contain it:
the route checks `storeId` against ours, and the sync re-fetches the entity
rather than trusting the payload, so a forged `entityId` can only make us
re-read our own data.

## 5. Ribbons and brands are not available

Revision 2 §2.4 said `badge` would sync from Ecwid's ribbon, and §2.5 listed
brand as newly available. Measured across all 1,453 products: **0 ribbons set,
0 attributes of any kind, so no brand data at all.** `badge` therefore remains
the one product field the local overlay usefully owns, and brand maps to empty.

Also: **no product has a translated name or description** — every
`nameTranslated.en` that exists contains the *Arabic* text. So Ecwid is not a
source of English copy, and `data/promos.json` stays the bilingual source for
banners. The category mapper refuses such a "translation" outright.

## 6. Work added beyond the original plan

Turning Ecwid on exposed gaps the plan had not anticipated, all now closed:

- **Stock was not honoured anywhere.** The storefront had never had stock data,
  so it offered "add to cart" on all 470 out-of-stock products. Fixed on the
  card, the category grid, the product page, the cart itself and in every sort
  order. Out-of-stock is shown and ranked last, never hidden.
- **Real was-prices now render** — 72 products carry one — on cards and the
  product page, with the provenance rule re-checked at the render layer.
- **Payment methods come from Ecwid**: ten instead of three hard-coded,
  including the instalment services that sell appliances. The two
  product-restricted plans are detected from their Arabic labels, because Ecwid
  cannot enforce a product restriction on a manual method.
- **`featured` excludes anything already in `offers`** — 65 of the 69 offers
  products also carry a was-price, so without it the two rails showed nearly
  identical content.

## 7. Two recurring traps, recorded

- **Values set as a side effect of another call.** `activeSource()` and
  `describe().served` were both captured during a catalogue build, so any route
  reading them first saw stale data — the rails route served July's curated ids
  while the products route served Ecwid. Both now compute fresh. A gate must
  never depend on something else having run.
- **Tests that cannot fail.** Three assertions in this work were vacuous or
  wrong: a regex with a stripped escape, a card-details guard that matched the
  file's own honesty comment, and an expectation containing an invisible
  U+00A0. Each was proved able to fail before being trusted.

## 8. Status

All 15 planned tasks are implemented, plus the storefront work in §6. The suite
stands at **813 tests, all passing** (483 before this work).

Outstanding, and none of it is code:

1. **Swap the public token for the secret token** — completes the order half.
2. **Product weights** — blocks delivery totals. Deliberately not invented:
   a weight decides what a customer is charged.
3. **The payment eligibility rule** for the two restricted instalment plans.
   Interim behaviour states the restriction and lets customer care confirm.
4. **The customer confirmation email** stays off until someone reads what Ecwid
   actually sends (revision 2 §7.6).
5. **Production cutover** needs its own token for store `18028328`, and must be
   verified there: the test store shares no ids with production, so the 30
   category pages, hotspot links and curated ids only match production.

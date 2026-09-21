# Ecwid integration — revision 2

**Date:** 2026-09-21
**Status:** approved for planning
**Amends:** `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`
**Basis:** direct inspection of the SADKO **test** store `142682751` in the Ecwid
control panel (`my.shopsettings.com`) on 2026-09-21, logged in as the store owner.

The original spec was written against the **production** store `18028328`, which
could only be observed from outside — every API call returned HTTP 403. With
control-panel access to a test store, five of its assumptions turn out to be
wrong. This document records the corrections, the owner's decisions on them, and
the scope change that prompted the inspection.

---

## 1. The scope change

Revision 1 kept customer accounts, payment methods, order status and banner
artwork on the SADKO side. The owner's instruction of 2026-09-21 is broader: the
new site becomes **a frontend interface only**, with data, admin, payment and
"all backend related features" managed in Ecwid and reflected in the frontend in
near-real time.

That is achievable for everything below **except one item**, which is a platform
limitation rather than a choice — see §7.

## 2. Corrections to revision 1

### 2.1 Payment — no gateway, so checkout stays ours

Revision 1 treated "payment through Ecwid" as a fork that might force the
customer into Ecwid's hosted checkout. **It does not.** All ten configured
methods in the store are Ecwid **manual payment methods**, meaning Ecwid records
the customer's *choice* and money is collected outside the online checkout:

| Method | Note |
|---|---|
| Cash on Delivery / الدفع عند الاستلام | |
| تقسيط البنك الاهلي (٦ اشهر بدون فوائد) | NBE, 6 months, interest-free |
| تقسيط البنك الاهلي (١٨ شهر بدون فوائد) على جميع منتجات كريازى | NBE, 18 months — **Kiriazi products only** |
| مبادرة العربى تقسيط (منتجات العربى فقط) | **El Araby products only** |
| ValU · Souhoola · Fawry · Mogo · SEVEN · Forsa | Egyptian instalment / payment providers |

**Consequences.** No card data is transmitted, processed or stored by Ecwid or by
us, so **PCI-DSS remains out of scope** (as stated in the E-Store Policy 015
response). The custom frontend keeps checkout end to end. The hard-coded list
`['cod','bank','showroom']` in `compare-server.mjs:1651` is **replaced by the
live list synced from Ecwid**, which is a material feature gain: instalment
options are a primary purchase driver for appliances and the new site currently
offers none.

**New requirement — payment eligibility.** Two methods are restricted by their
*names only*; Ecwid cannot enforce a product restriction on a manual method. A
frontend that lists all ten on every product would let a customer select
18-month Kiriazi instalments on a Samsung television. Until SADKO supplies the
eligibility rule, the frontend **must not** present a restricted method as
available on an arbitrary product. Interim behaviour: show only the
unrestricted methods, and render the two restricted ones as requiring
confirmation by customer care. Offering a payment plan the customer is not
entitled to is a false statement of the same class as a fabricated delivery fee.

### 2.2 Shipping — a real rate card exists

Revision 1 asserted that delivery cannot be quoted, and the storefront
deliberately stores `deliveryFee: null`, `installFee: null`, `grandTotal: null`.
**The premise was wrong.** The store carries **18 configured shipping methods**
with real EGP rates, keyed on exactly the two variables the original reasoning
called unknowable — governorate and appliance size:

| Zone | Rate (EGP) |
|---|---|
| القاهرة الكبرى · الجيزة · الاسكندرية | 250 each |
| القليوبية / الدلتا / القناة — صغيرة · متوسطة · كبيرة · كبيرة جدا | 275 · 525 · 630 · 1,140 |
| الصعيد / مرسى مطروح / البحر الاحمر — صغيرة · متوسطة · كبيرة · كبيرة جدا | 330 · 605 · 845 · 1,320 |
| الوجه البحرى · القناة (oversized) | 475 (1,465) |
| الوجه القبلي / مرسى مطروح (oversized) | 640 (1,830) |
| القاهرة والجيزة — حرف يدوية ومنتجات عضوية | 50 (flat) |

A per-order **handling fee** facility exists and is not configured.

**Decision (owner, 2026-09-21): ask Ecwid and show the real total.** Checkout
calls Ecwid's order-calculate endpoint with the cart and the customer's address,
and displays the returned delivery charge and a true grand total.

**The honesty rule is unchanged in substance and must not be relaxed:** the site
still never *computes* or *invents* a delivery figure. It displays a figure
**retrieved from Ecwid**, or it displays none. `grandTotal` is populated only
from a successful calculate response; if the call fails or returns no method for
the address, the order falls back to revision 1's behaviour — subtotal only,
fees confirmed by customer care — rather than guessing.

**Blocking question for SADKO.** How does Ecwid select the size band? If it is
derived from product weight, weights must be present on products for the
selection to be correct. If the customer selects the method themselves, a
customer can under-pay by choosing the small-appliance rate for a refrigerator.
The calculate integration must not ship until this is answered, because a
displayed total that is too low is a price commitment SADKO would have to honour
or retract.

### 2.3 Catalogue scale, and out-of-stock presentation

| | Revision 1 assumed | Test store actually holds |
|---|---|---|
| Products | 471 (site) / 510 (production Ecwid) | **1,453** |
| Enabled / displayed | — | 990 |
| Out of stock | not measured | **865** |
| Disabled | — | 463 |

Revision 1 §5.4 decided out-of-stock products are "shown, marked unavailable,
never hidden" — reasoning that hiding them would understate the range. At roughly
**60% of the catalogue out of stock**, that decision produces a storefront where
three in five visible products cannot be bought.

**Decision (owner, 2026-09-21): follow Ecwid's own visibility, and sort
out-of-stock last.** Products Ecwid marks visible are shown; out-of-stock items
remain browsable and discoverable but are ordered last in every list and rail,
marked unavailable with add-to-cart disabled. This keeps the range honest without
presenting an unbuyable storefront. §5.4 of revision 1 is superseded.

Rails already exclude out-of-stock items (revision 1 §6.1) — unchanged.

### 2.4 `badge` is not site-only — Ecwid has Ribbons

Revision 1 §5.3 kept `badge` as the one field the local overlay owns, on the
stated grounds that "Ecwid has no equivalent". **It does:** the catalogue filters
expose **Ribbons** (with ribbon text), which is precisely a product badge.

`badge` therefore syncs from Ecwid's ribbon like every other field, and **the
`catalog-admin.db` overlay may end up owning no product fields at all.** That is
an acceptable and even desirable outcome — it means exactly one system writes
product data. The overlay tables stay in place (they cost nothing, and the audit
log is still used), but the merge step may reduce to a pass-through.

### 2.5 More Ecwid capability than revision 1 credited

Confirmed present in the store and currently unused by the new site: **Brands**
(filterable), **real stock quantities** (not merely in/out — e.g. "In stock: 5"),
**"Compare to" price** as a first-class filterable field, **Product Types**, **tax
categories**, **Product Reviews**, **Gift Cards**, **Subscriptions**, **Size
Charts**, **Shared Product Content**, **Abandoned Carts**, **Discount Coupons**
and **Promotions**.

None of these are in scope for this revision. They are recorded because revision
1 described the new site as strictly richer than Ecwid in places where it is not,
and because several are obvious later projects.

## 3. Advertisement banners

Re-confirmed against the live control panel: **Ecwid has no banner or
advertisement entity.** Marketing contains Promotions (automatic discount rules)
and Discount Coupons (promo codes); neither carries artwork. Catalog has no
banner product type.

**Decision (owner, 2026-09-21): a hidden Ecwid category of banners.** Revision 1
§6.2 kept banner artwork in the SADKO admin; that is superseded.

Design:

- One dedicated Ecwid category, **disabled on Ecwid's own storefront** so these
  entries never appear to a shopper of the WordPress shop.
- Each banner is one entry in it: **product image → artwork**, **name →
  headline**, **description → subtitle/body**, **SKU → the slot** (`hero`,
  `wide`, `square`), and the product **URL field → the banner's click-through
  target**.
- The sync reads that category and produces the existing `promos.json` shape, so
  `shop.js` and `storefront.js` need no change.
- The banner category and its entries are **excluded from every product path** —
  the catalogue served at `/data/products.json`, all search and browse, the
  rails, and the sitemap. A banner must never be purchasable or appear as a
  product. Tests enforce this exclusion.

**Accepted cost, stated plainly:** these entries are not products, and they will
appear in Ecwid's own product count, CSV exports, and reports — a handful of
non-products inside a 1,453-product catalogue. The owner accepted this in
exchange for controlling banners from Ecwid. `promos.json` remains as the seed
and the fallback when the category is empty or unreachable.

**Unchanged honesty rule:** a banner still makes no commercial claim the
catalogue cannot support. The banner's text is whatever staff typed in Ecwid, and
no discount percentage, rating or stock claim is derived for it.

## 4. Payment method sync

New, replacing the hard-coded list:

- Sync Ecwid's enabled payment methods into the mirror (id, display name, and
  whether the name encodes a product restriction).
- `POST /api/orders` validates the chosen method against the **synced** list
  rather than `PAYMENT_METHODS`.
- `toEcwidOrder` maps the chosen method by its Ecwid identity. Revision 1 §7.4's
  rule stands and now matters more: **an unrecognised method throws** rather than
  guessing a payment status.
- All methods push as `AWAITING_PAYMENT`. Nothing is ever pushed as paid, because
  no money is taken at ordering time.

## 5. Realtime

Unchanged from revision 1 §5.2 — webhooks for near-instant updates, re-fetching
the entity rather than trusting the event payload; a 15-minute incremental pull
as the safety net; a daily full reconcile to catch deletions. The webhook
subscription list gains payment- and shipping-settings events if Ecwid exposes
them; otherwise those two are refreshed on the timer, which is sufficient because
they change rarely.

## 6. Test-store conditions to be aware of

The test store currently reports **"Storefront is closed"**, **"Your shipping
methods are not available to customers"** and **"Your payment methods are not
available to customers"**. These are expected on a store that is not trading, but
they mean the order-calculate endpoint may return **no shipping options** until
the storefront is opened. A calculate integration must therefore treat "no
options returned" as a normal condition with the §2.2 fallback, and this must be
retested against an open storefront before it is trusted.

The store also reports 0 orders in the last 30 days, so order-push testing starts
from a clean slate.

## 7. The one thing that cannot move to Ecwid

**Customer login.** Ecwid authenticates shoppers inside its own storefront; it
exposes no customer-login API for a third-party headless frontend. Customer
accounts, sessions, saved homes and the customer-facing order history therefore
**stay in `accounts.db`** exactly as today.

This is a platform limitation, not a design preference, and it is the single
exception to "all backend features managed through Ecwid". Everything else in
this revision moves.

Consequence for orders: a new-site order is placed by a customer Ecwid does not
know. The push carries the customer's email, name, phone and address on the order
itself (revision 1 §7.1), which is how Ecwid records a guest order — so staff see
a complete order without a matching Ecwid customer account. If linking the two is
wanted later, Ecwid's customer API could create a matching customer record; that
is a separate project.

## 8. API access — confirmed available

The test store's **Apps → Custom Apps** page offers **Create App**, so REST API
access is available on this store's plan. Revision 1's §13 open item and the
blocking dependency in the implementation plan's Task 1 are therefore resolvable
by the owner without an Ecwid plan change.

The token and the app's client secret are placed in `/etc/sadko.env` by the owner.
Unchanged from revision 1 §9.1: the assistant never handles either value, and
`tools/ecwid-preflight.mjs` reports the token as present-with-a-length, never its
content.

Test-store configuration for development:

```
SADKO_ECWID=1
SADKO_ECWID_STORE_ID=142682751
SADKO_ECWID_TOKEN=<owner supplies>
SADKO_ECWID_WEBHOOK_SECRET=<owner supplies>
```

Production later swaps the store id to `18028328` with its own token.

## 9. Impact on the implementation plan

The 15-task plan
(`docs/superpowers/plans/2026-09-15-ecwid-integration{,-part2,-part3}.md`) stands,
with these amendments:

| Task | Amendment |
|---|---|
| 1 | Capture fixtures from store `142682751`. Additionally capture a payment-methods, shipping-methods and order-calculate payload |
| 3 | `toSadkoProduct` maps Ecwid's **ribbon** to `badge`; `inStock` gains the sort-last rule of §2.3 |
| 5 | Mirror gains `payment_methods` and `shipping_methods` tables |
| 6 | Sync gains `syncPaymentMethods()` and `syncShippingMethods()` |
| 7 | `mergedCatalog()` **excludes the banner category** (§3) and orders out-of-stock last |
| 9 | Banner derivation added alongside the rails, reading the hidden category into the `promos.json` shape |
| 10 | Superseded in part: `promos.json` becomes seed and fallback rather than the owner-edited source. It stays in `ADMIN_CONTENT` for that purpose |
| 11 | `toEcwidOrder` maps synced payment methods; adds the calculate call and the §2.2 fallback |
| 13 | Checkout calls calculate before writing the order, and stores the returned delivery figure |
| New | A task for payment-method eligibility (§2.1) once SADKO supplies the rule |

## 10. Outstanding questions for SADKO

1. **How does Ecwid select the shipping size band** — product weight, or customer
   choice? Blocks §2.2. (Highest priority: it can cause an under-quoted total.)
2. **The payment eligibility rule** for the two product-restricted instalment
   methods. Blocks the full payment list in §2.1.
3. **Are product weights set** on the catalogue, if the answer to 1 is weight?
4. **Does anything else write into this store** — a POS or ERP? If so, Ecwid is a
   relay rather than the source of truth, which changes conflict handling.
5. **When will the test storefront be opened**, so calculate can be tested
   against real shipping options (§6)?

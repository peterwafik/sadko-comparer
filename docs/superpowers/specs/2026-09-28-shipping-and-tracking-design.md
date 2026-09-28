# Automatic delivery fees and shipment tracking

**Date:** 2026-09-28
**Status:** Design approved in conversation, awaiting spec review
**Owner decisions:** approach A (the site calculates from Ecwid's rates); size classes derived
automatically; no carrier field (one delivery company, Movex); no cap on the Greater Cairo fee;
Sinai falls back to customer service; North Coast is charged as Matrouh.

## 1. Goal

A customer anywhere in Egypt sees the exact delivery fee and grand total before confirming. The
Ecwid order carries the same fee and total. When staff add a tracking number in Ecwid, the
customer sees it, with the order's status, on the site.

**Out of scope:** installation fees; a carrier API integration; per-product class overrides
(misclassification is fixed by correcting the product's title or category in Ecwid).

## 2. What this supersedes

Two deliberate refusals in the current code are replaced, by owner decision:

- `engine/ecwid-shipping.mjs` reports `quotable: false` because no method has a destination zone
  and no product has a weight. Both blockers are resolved here without touching Ecwid's data: the
  region comes from our governorate map (§4.1), and the size band comes from the derived class
  (§4.2). Weights were never needed: every banded table starts at `weightFrom: 0`, so the rate is
  per item.
- `engine/ecwid-map.mjs` states "never add a shippingRate or a computed total". That rule was
  right while no fee could be trusted. It now applies only to orders whose quote is not
  `quotable` (§4.4). A quotable order carries the server-computed fee.

The underlying principle is unchanged: **the site never invents a number.** Every fee is Ecwid's
own rate, chosen by rules that either apply cleanly or refuse.

## 3. Verified facts (live test store 142682751, 2026-09-28)

`GET /profile/shippingOptions` returns 18 options, 12 enabled. Every `destinationZone` is `WORLD`,
so Ecwid cannot choose by address. The enabled rates:

| Method (as titled in Ecwid) | Calculation | Rate |
|---|---|---|
| القاهرة الكبرى · الجيزة · الاسكندرية (three methods) | table on `discountedSubtotal` from 0 | `perOrder` 200 + `perItem` 50 |
| القليوبية - الدلتا - القناة منتجات صغيرة / متوسطة / كبيرة / كبيرة جدا | table on `weight` from 0 | `perItem` 275 / 525 / 630 / 1140 |
| الصعيد - مرسى مطروح - البحر الاحمر منتجات صغيرة / متوسطة / كبيرة / كبيرة جدا | table on `weight` from 0 | `perItem` 330 / 605 / 845 / 1320 |
| القاهرة والجيزة شحن حرف يدوية ومنتجات عضوية | flat | 50 per order |

Staff delivery-time sentences live in `deliveryTimeDays` / `description` (e.g. delivery within
7 working days for the Delta, 14 for Upper Egypt). Ecwid orders have `shipments` and omit empty
tracking fields.

**Test and production stores share no ids**, so nothing below may key on a category or product
id. Category **names** are the same in both stores and are what the classifier uses.

## 4. Design

### 4.1 Governorate → region — `engine/shipping-regions.mjs` (new, pure)

Exports the governorate list checkout renders (Arabic value, English label) and
`regionOf(governorate)` → `'metro' | 'delta' | 'upper' | null`.

| Region | Governorates |
|---|---|
| `metro` (Greater Cairo / Giza / Alexandria) | القاهرة، الجيزة، الإسكندرية |
| `delta` (Qalyubia / Delta / Canal) | القليوبية، الشرقية، الدقهلية، الغربية، المنوفية، كفر الشيخ، دمياط، البحيرة، بورسعيد، الإسماعيلية، السويس |
| `upper` (Upper Egypt / Matrouh / Red Sea) | الفيوم، بنى سويف، المنيا، أسيوط، سوهاج، قنا، الأقصر، أسوان، الوادى الجديد، مطروح، البحر الأحمر، الساحل الشمالى |
| `null` (customer service) | شمال سيناء، جنوب سيناء، and any unknown or legacy value such as «أخرى» |

Spelling variants (ى/ي, ة/ه, أ/إ/ا) are normalised before lookup, so a saved profile value still
resolves.

### 4.2 Product → size class — `engine/size-class.mjs` (new, pure)

`sizeClassOf(product, categoryName)` → `{ cls: 'small'|'medium'|'large'|'xl'|'craft'|null, why }`.
`why` is a short bilingual reason, shown in the admin panel.

Rules, by normalised category name:

| Category name | Class |
|---|---|
| خلاطات و محضرات طعام، مكاوى، كاتيل و ماكينات قهوة، ميكروييف، مكانس، قلايات، أفران كهربائية | small |
| مبردات هواء ومراوح | small if the title says مروحة/مراوح/fan; medium if مبرد/cooler; otherwise null |
| غسالات ملابس | medium; **xl** if the title says واش تاور / وتش تور / wash tower |
| تكييفات هواء، سخانات كهرباء، سخانات غاز، 5 شعلة، 4 شعلة، غسالات أطباق، مبردات مياه | medium |
| فريزر رأسى، فريزر أفقى | large |
| نو فروست، ديفروست (refrigerators) | litres ≤ 450 → large; > 450 or «4 باب» → xl; no litres in the title → null |
| تليفزيونات | inches < 50 → medium; 50–75 → large; > 75 → xl; no inches → null |
| حرف يدوية ومنتجات عضوية | craft |
| anything else (offers, unnamed categories) | null, unless the title alone matches one rule above unambiguously |

Litres and inches come from the existing `skSpecs` parser the storefront already uses, so the
classifier and the product page never disagree about a size.

### 4.3 Rate card — extension of `engine/ecwid-shipping.mjs`

- The sync stores each method's `ratesCalculationType`, `ratesTable` and `flatRate` alongside the
  fields it keeps today.
- `rateCard(methods)` turns enabled methods into
  `{ metro: { perOrder, perItem, title }, delta: { small, medium, large, xl }, upper: {…}, craft: { flat, title } }`
  by parsing the region and size words in each title. A method whose title cannot be parsed is
  ignored and reported in the admin panel.
- Only rate rows starting from zero (`weightFrom: 0` / `discountedSubtotalFrom: 0`) are
  accepted. A table with real tiers is reported as unsupported, rather than half-applied.
- The last good rate card is kept, so an Ecwid outage does not stop quoting.

### 4.4 Quote — `quoteDelivery({ lines, governorate, card })`, pure

- **Returns** either `{ quotable: true, fee, lines: [{ id, cls, fee }], methodName, deliveryNote }`
  or `{ quotable: false, reason }`.
- **metro:** `perOrder + perItem × (total quantity)`, with no cap. Size class is irrelevant here, but
  every line must still have a class (non-null), so an unrecognised product still falls back.
- **delta / upper:** Σ `perItem[cls] × qty`.
- **craft lines:** flat 50 per order, in القاهرة/الجيزة only. Craft lines elsewhere → not quotable.
  A cart mixing craft and appliances in Cairo/Giza pays the metro fee plus the craft flat.
- **Not quotable** when the region is null, any line has no class, or a needed rate is missing
  (e.g. staff disabled a method). The customer never sees a partial fee.
- **Worked examples:**
  - A 480 L fridge plus a fan to سوهاج: 1320 + 330 = **1,650**.
  - The same cart to القاهرة: 200 + 2 × 50 = **300**.

### 4.5 Server wiring — `compare-server.mjs`

- **`POST /api/delivery/quote`** takes `{ items: [{ id, qty }], governorate }` and returns the quote.
  Items are resolved against the served catalogue, as prices are. It is rate-limited like other
  public routes.
- **Both order routes** (signed-in and guest):
  - They re-run `repriceLines`, then `quoteDelivery`, on the server. Any fee sent by the browser is
    ignored.
  - The browser sends the fee it displayed (`quotedFee`). If the server's fee differs, the order is
    refused with `409 delivery-fee-changed` and the new quote. The customer confirms again, so a
    mid-checkout rate change never charges silently.
  - A quotable order stores `totals: { subtotal, deliveryFee, grandTotal, currency }`. A
    non-quotable one stores `deliveryFee: null, grandTotal: null`, as today.
- **`toEcwidOrder`:**
  - A quotable order gets `shippingOption: { shippingMethodName, shippingRate }` and
    `total = subtotal + fee`. The per-line breakdown goes into `orderComments`.
  - A non-quotable order is pushed exactly as today.
  - The `FEES_NOTE_AR` sentence changes to name installation only, when the delivery fee is known.

### 4.6 Checkout, cart and admin UI

- **Checkout** (`assets/js/checkout.js`):
  - The governorate select lists the §4.1 governorates. A saved value that is not in the list
    (e.g. «أخرى») leaves the select unselected and asks the customer to choose.
  - A change of governorate requests a quote. The summary shows each line's class and fee, the
    delivery total, the grand total, and the store's delivery-time sentence.
  - A non-quotable quote or a failed request shows the existing customer-service sentence, and
    the order can still be placed.
  - A `409 delivery-fee-changed` reply re-renders the summary with the new fee and asks for
    confirmation.
- **Cart:** signed-in customers with a saved governorate see an estimated fee. Everyone else sees
  "delivery calculated at checkout".
- **Admin → "Delivery classes"** (read-only):
  - The number of products per class.
  - Every unclassified product with its `why`.
  - A search showing any product's class and reason.
  - Rate-card problems: unparsed titles and unsupported tiers.

### 4.7 Tracking

- **Reading:** `applyEcwidOrderEvent` and the reconcile read the tracking number from the Ecwid
  order, then store `tracking: { number, url }` on the local order.
  - The field names are **confirmed on the first live read** (set a tracking number on test order
    7519, then read the payload) before the reader is written, per this project's rule after four
    guessed-field-name bugs.
  - The reader accepts `trackingNumber`/`trackingUrl` and the same fields inside `shipments[]`.
- **Customer, signed in** (orders page): each order shows a status timeline
  (received → confirmed → preparing → shipped → delivered, from the existing status mapping).
  Once a number exists, it also shows the number with a copy button, and a "Track on Movex" link.
  The link goes to Ecwid's `trackingUrl` if present, otherwise to Movex's tracking page.
- **Customer, guest:** a "Track an order" form (order number + phone).
  - `POST /api/orders/track` returns status and tracking **only**. It never returns the name,
    address or items.
  - Both values must match; a mismatch gets the same "not found" reply as an unknown number.
  - It is rate-limited per IP.
- **Staff:** add the tracking number and move the status in Ecwid, as they work today. No SADKO
  admin editing is added.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Ecwid unreachable | The last good rate card is used. With none ever loaded: not quotable, customer-service message. |
| Quote request fails in the browser | Customer-service message; checkout proceeds. |
| Fee changed between quote and order | `409` + new quote; the customer re-confirms. |
| Method disabled or retitled by staff | The affected region or class stops quoting; the admin panel names the method. |
| Push to Ecwid fails | Queued and retried, as today, with the fee included. |
| Tracking lookup mismatch | Generic "not found", rate-limited. |

## 6. Testing

- **Unit:**
  - **Regions:** all governorates map to the right region; Sinai and «أخرى» → null; spelling
    variants resolve.
  - **Size classes:** every category name; boundaries 450/451 L and 49/50/75/76″; missing size →
    null; wash-tower → xl; fan vs cooler split.
  - **Rate card:** built from a saved fixture of the real `shippingOptions` response; unparsed
    titles and tiered tables are reported.
  - **Quote:** the worked examples; metro without a cap; craft rules; each non-quotable reason.
- **Wiring:**
  - **Orders:** both order routes ignore a browser fee and return 409 on a mismatch.
  - **Ecwid push:** the pushed order carries `shippingOption` and the total; a non-quotable order
    is pushed unchanged.
  - **Tracking:** a webhook with tracking updates the stored order.
  - **Guest lookup:** it refuses a wrong phone number, and its reply contains no personal fields.
- **Live** (test store):
  1. An order to سوهاج with a fridge and a fan shows 1,650 delivery and the matching total in
     Ecwid.
  2. A tracking number added in Ecwid appears on the order page and in the guest lookup within a
     minute.

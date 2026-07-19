---
routes:
  - /shop/            # WordPress shell
  - /cart/            # WordPress shell
  - /checkout/        # WordPress shell
  - /shop/{slug}-c{id}  # 30 virtual category routes
  - /shop/{slug}-p{id}  # 471 virtual product routes
type: ecwid-templates
editable: "Ecwid Design settings + CSS overrides only"
rebrandPriority: 3
---

# Shop & store templates

> **Read this first.** `/shop/`, `/cart/`, and `/checkout/` are thin Divi shells. Everything inside them — and all 501 category/product routes — is rendered client-side by the **Ecwid widget (store ID `18028328`)**. There are no per-page files. Restyling the **two templates below re-skins all 501 routes at once.**

---

## `/shop/` — store landing shell

- WordPress page title: `Shop | SADKO Group`
- Ecwid document title: `Sadko Groups`  ← **inconsistent store name, fix during rebrand**
- Contains the global Divi header/footer plus the Ecwid root container
- Renders the 12-tile category grid and a "Featured Products" grid (same modules as the homepage)

## `/cart/` and `/checkout/`
Fully Ecwid-rendered. Branding is controlled through Ecwid's design settings; layout and copy are not editable as WordPress content. Checkout supports **COD and credit card** only.

---

## Template A — Category page
**Route:** `/shop/{arabic-slug}-c{categoryId}` · **Instances:** 30

### Components
| Component | Detail |
|---|---|
| Breadcrumb | `Store / ثلاجات` |
| Category title | Arabic category name |
| Subcategory tiles | Image + label cards (e.g. `نو فروست`, `ديفروست`) |
| Sort dropdown | We recommend · Newest arrivals · Price low→high · Price high→low · Name A→Z · Name Z→A |
| Currency selector | `Display prices in: EGP` |
| Product grid | Card = image · Arabic name · SKU · price (LE) · compare-at price · save badge · **Buy Now** |
| Filters | Sort + clear-filter only; **no faceted filtering** (no brand, capacity, price-range, or energy-rating facets) |

### Observations
- **Parent categories render only subcategory tiles — no products, no description, no hero.** A user landing on `ثلاجات` sees two tiles and nothing else. Weak experience, zero SEO value.
- No category-level intro copy, buying guidance, or imagery.
- No pagination controls surfaced in the extract (infinite/lazy loading).

---

## Template B — Product page
**Route:** `/shop/{arabic-slug}-p{productId}` · **Instances:** 471

### Components (exact labels)
| Component | Detail / label |
|---|---|
| Breadcrumb | `Store / تليفزيونات` |
| Gallery | Main image + thumbnail strip, prev/next arrows |
| Title | e.g. `تليفزيون بلوتو 65 بوصة سمارت مقاومة للصدمات ريسيفرداخلى LED (810223)` |
| SKU | `SKU 80430601` |
| Price | `LE 21,499.00` (sale state) |
| Compare-at price | `LE 23,990.00` |
| Discount badge | `Save LE 2,491.00` |
| Quantity | increment / decrement / `Add More` |
| Primary actions | **`Add to Cart`** · **`Go to Checkout`** |
| Wishlist | `Save this product for later` · `Favorite` · view wishlist |
| Support prompt | `Have questions?` |
| Social share | Facebook · X/Twitter · Pinterest |
| Description tab | Free-text HTML: full technical specifications |
| Warranty note | e.g. 3-year warranty — `الهيئة العربية للتصنيع` (Arab Organization for Industrialization) |

### Missing from the product template
- **Installment / financing calculator** — the company's founding business model, absent from every product page. *Largest commercial gap on the site.*
- Customer **reviews and ratings**
- **Structured spec table** — specs are unstructured prose, so nothing is filterable or comparable
- **Related / recommended products** — no cross-sell or upsell anywhere
- **Stock / availability** indicator
- Delivery estimate or "free delivery in Cairo/Giza/Alex" reassurance at point of sale
- Warranty presented as a consistent structured field (currently ad-hoc inside description text)
- WhatsApp / call-to-order CTA (`Have questions?` has no visible channel)

---

## Rebranding guidance for the store layer

1. **Two visual systems currently collide.** Divi chrome (Cairo font, teal `#7ebec5`) vs. Ecwid storefront defaults (own button styles, spacing, `--ec-*` CSS variables). Unifying these is the core store rebranding task.
2. **Ecwid exposes CSS custom properties** (`--ec-btn-primary-color`, `--ec-color-background`, `--ec-color-border`, etc.). Override these to apply brand tokens globally rather than fighting individual selectors.
3. **RTL correctness** — verify the Ecwid storefront respects RTL for breadcrumbs, gallery arrows, price/compare-at ordering, and the quantity stepper.
4. **Copy language** — many store controls render in English (`Add to Cart`, `Go to Checkout`, `We recommend`, `Have questions?`, `Featured Products`) on an Arabic site. Ecwid supports Arabic storefront translation; enabling and reviewing it is a rebrand deliverable.
5. Reconcile the store name: `SADKO Group` vs. `Sadko Groups`.

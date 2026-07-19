---
route: /
title: Home
type: wordpress-page
editable: true
builder: Divi
language: ar (RTL) with English store chrome
rebrandPriority: 1
---

# Home — https://www.sadko-group.com/

## Purpose
Primary entry point. Functions as a storefront landing page: brand banner, category shortcuts, and a large featured-product grid rendered by Ecwid.

## Page structure (top → bottom)

### 1. Global header (Divi template tb-5493)
- SADKO Group logo (white variant), links to `/`
- Hotline banner: **"call 19140"** — rendered as an **image asset**, not live text
- Primary nav (Arabic):
  - `عن صادكو جروب` — About SADKO Group → `/about-sadko/`
  - `تابع طلبك` — Track Your Order → `/track-your-order/`
  - `مواقع المعارض` — Store Locations → `/stores-location/`
- Ecwid store controls: Search Products · My Account · Track Orders · Favorites · Shopping Bag

### 2. Promotional banners
Multiple banner images showing product categories and seasonal promotions. All banner copy is baked into images — no live text, no alt strategy.

### 3. Category grid — 12 tiles
Icon/image cards linking into Ecwid category routes:

| # | Arabic | English |
|---|--------|---------|
| 1 | ثلاجات | Refrigerators |
| 2 | فريزرات | Freezers |
| 3 | عروض صادكو | SADKO Offers |
| 4 | المنتجات الاكثر مبيعاً | Best Sellers |
| 5 | أفران | Ovens |
| 6 | غسالات | Washing Machines |
| 7 | تكييفات هواء | Air Conditioners |
| 8 | سخانات مياه | Water Heaters |
| 9 | تليفزيونات | Televisions |
| 10 | مبردات هواء ومراوح | Air Coolers & Fans |
| 11 | مبردات مياه | Water Coolers |
| 12 | اجهزة صغيرة | Small Appliances |

### 4. "Featured Products" grid
- Heading is in **English** ("Featured Products") on an otherwise Arabic page — inconsistency to fix
- 24+ product cards, each with: image · Arabic name · SKU · price in `LE` · discount tag when applicable · **Buy Now** button
- Sort dropdown: We recommend · Newest arrivals · Price low→high · Price high→low · Name A→Z · Name Z→A

Sample products and pricing observed:
- `تليفزيون 50 بوصة ال جى بالريسيفر` — LG 50" UHD Smart 4K TV — **LE 19,549.00**
- `تكييف كريازى حائطى 3 ح ديجيتال` — Kiriazi 3HP Wall AC — **LE 38,252.00**
- `ثلاجة كريازى زمرده تربو 450 لتر` — Kiriazi Zomorroda Turbo 450L Fridge — **LE 32,345.00**
- Carrier 1.5HP Wall AC — **LE 33,105.00**
- `فرن كهرباء فريش 36 لتر` — Fresh 36L Electric Oven — **LE 2,849.00**
- NOVA 18" Stand Fan — **LE 1,949.00**

### 5. Global footer (Divi template tb-5486)
- Email: `csupport@sadko-group.com` · Hotline: `19140`
- Social: Facebook · YouTube · X/Twitter
- Payment method badge strip
- Account · Order tracking · Favorites links
- `Copyright © sadko-group.com 2024 | Powered by: The Wizards`

## Rebranding notes
- **No hero section with a value proposition.** The page opens straight into commerce with no positioning statement, no mention of 1986 heritage, Kiriazi exclusivity, or installment financing.
- **No trust signals above the fold** — no "40,000+ customers/year", no warranty, no delivery promise.
- Mixed-language headings ("Featured Products" in an Arabic RTL layout).
- All promotional messaging is locked inside images — untranslatable, unindexable, unmaintainable.
- Divi default blue `#2ea3f2` appears in links, fighting the `#7ebec5` brand teal.

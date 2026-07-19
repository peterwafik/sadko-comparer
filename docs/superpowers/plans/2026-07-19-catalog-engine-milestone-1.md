# SADKO Catalog Engine — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace live per-query fan-out with a crawled product catalog that serves comprehensive, identity-matched, price-verified results for any electronic appliance.

**Architecture:** A background crawler ingests store sitemaps into a SQLite FTS5 catalog. A pure `matcher` module decides product identity from brand + model number + category-declared spec attributes. The server searches the catalog for breadth, groups by identity, then live-verifies only the cheapest candidates before display. Existing adapters are retained for sitemap-less stores and live verification.

**Tech Stack:** Node.js 24 ESM, `node:sqlite` (built-in, FTS5), `node:test` (built-in). **Zero npm dependencies.**

## Global Constraints

- **Zero runtime dependencies.** No npm packages. `node:sqlite`, `node:test`, `node:fs`, `node:http` only. This is an existing, deliberate property of the codebase (see the no-deps note in `site/headless.mjs`).
- **Node ≥ 22.5** for `node:sqlite`. Verified working on v24.16.0.
- **All new engine modules live in `site/engine/`.** Tests in `site/engine/*.test.mjs` beside their module.
- **Run tests with:** `node --test site/engine/*.test.mjs` from repo root `D:\SADKO`.
  Note the glob — on this Node 24 / Windows setup, passing the *directory*
  (`node --test site/engine/*.test.mjs`) fails with `Cannot find module 'D:\SADKO\site\engine'`.
  Single file: `node --test site/engine/<name>.test.mjs`.
- **Never commit `site/.env`.** It holds a live NVIDIA API key and is gitignored by `*.env`.
- **Crawler must honour `robots.txt`**, including `Crawl-delay`, and send UA `Mozilla/5.0 (compatible; SADKO-price-comparer/1.0; +https://sadko-group.com/bot)`.
- **Arabic text is first-class.** Every normalization must handle Arabic-Indic digits (`٠-٩`), alef/ya/ta-marbuta variants, and tatweel.
- **Commit after every task** using the exact commands given.
- **Catalog verification is mandatory before declaring any task done.** Unit
  tests passing is necessary but has proven insufficient: in Tasks 1-3 every
  module passed its own tests and then failed against real data (a model
  extractor that fused SKU+model on 30 titles; a unit guard that silently
  blocked Arabic after Latin; category names that matched a food dish, a sports
  racket, and a headset). After the unit tests pass, run your module across all
  471 real products in `site/data/products.json`, report the output
  distribution, and eyeball it for absurdities. Each task below names the
  specific command. **Report the numbers honestly — never tune code to hit a
  target number, and never weaken an assertion to make a test green.**

  The generic form, when a task does not specify its own:

  ```bash
  node --input-type=module -e "
  const M = await import('./site/engine/<module>.mjs');
  const { createRequire } = await import('node:module');
  const p = createRequire(import.meta.url)('./site/data/products.json').products;
  const dec = s => s.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  const tally = {}; let none = 0;
  for (const x of p) { const r = M.<fn>(dec(x.title));
    if (r == null || (typeof r === 'object' && !Object.keys(r).length)) none++;
    else tally[JSON.stringify(r).slice(0,40)] = (tally[JSON.stringify(r).slice(0,40)]||0)+1; }
  console.log('produced a result:', p.length - none, 'of', p.length);
  console.log(Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,15));
  "
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `site/engine/normalize.mjs` | text/digit/model-number normalization primitives — pure |
| `site/engine/units.mjs` | extract `{unit: value}` pairs from bilingual titles — pure |
| `site/engine/categories.mjs` | `CATEGORIES` table + leading-noun category detection — pure |
| `site/engine/matcher.mjs` | identity key, sameness rule, confidence tiers — pure |
| `site/engine/catalog.mjs` | SQLite schema, upsert, FTS search, price history |
| `site/engine/robots.mjs` | robots.txt fetch + parse — `Disallow`, `Crawl-delay`, `Sitemap` |
| `site/engine/sitemap.mjs` | sitemap/sitemap-index parsing → product URLs |
| `site/engine/offer-gate.mjs` | shared offer-sanity gate — imported by extract.mjs AND compare-server.mjs |
| `site/engine/extract.mjs` | product page → `{title, price, currency, inStock}` via JSON-LD |
| `site/engine/crawler.mjs` | orchestration: robots → sitemap → pages → catalog, resumable |
| `site/engine/stores-m1.mjs` | the 13 Milestone-1 stores |
| `site/compare-server.mjs` | MODIFIED: catalog-first search path + live top-10 verification |
| `scripts/bench-catalog.mjs` | measures catalog path vs live-fanout baseline |

Pure modules (`normalize`, `units`, `categories`, `matcher`, `sitemap`, `extract`) are unit-testable with no network.

---

## Task 1: Normalization primitives

**Files:**
- Create: `site/engine/normalize.mjs`
- Test: `site/engine/normalize.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normDigits(s: string) => string` — Arabic-Indic/Persian digits → ASCII
  - `normText(s: string) => string` — lowercase, unify alef/ya/ta-marbuta, strip tatweel+diacritics, collapse whitespace, decode `&amp;`/`&nbsp;`
  - `normModel(s: string) => string` — uppercase, strip ALL non-alphanumerics
  - `extractModel(title: string) => string | null` — find the model token in a real title

**Context:** Real SADKO titles contain model numbers written as `RF – 51 FTV – DST`, `TC4 -ZWF7240SS5`, `SK- 5119`, `AWE-E1050SUP`, `9C10GRB1X4AWW`. Spaces and en-dashes appear *inside* the model. Titles also mix scripts with no separator: `"10 Feetثلاجة كريازى"`.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/normalize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDigits, normText, normModel, extractModel } from './normalize.mjs';

test('normDigits converts Arabic-Indic digits', () => {
  assert.equal(normDigits('٧٥ بوصة'), '75 بوصة');
  assert.equal(normDigits('۱۲۸'), '128');
  assert.equal(normDigits('75'), '75');
});

test('normText unifies Arabic letter variants and decodes entities', () => {
  assert.equal(normText('غسالة'), normText('غساله'));      // ta-marbuta vs ha
  assert.equal(normText('كريازى'), normText('كريازي'));    // alef-maqsura vs ya
  assert.equal(normText('أمازون'), normText('امازون'));    // hamza forms
  assert.equal(normText('Cooling &amp; Heating'), 'cooling & heating');
  assert.equal(normText('a&nbsp;&nbsp;b'), 'a b');
});

test('normModel strips separators so spaced models compare equal', () => {
  assert.equal(normModel('RF – 51 FTV – DST'), 'RF51FTVDST');
  assert.equal(normModel('RF-51FTV-DST'), 'RF51FTVDST');
  assert.equal(normModel('TC4 -ZWF7240SS5'), 'TC4ZWF7240SS5');
  assert.equal(normModel('sk- 5119'), 'SK5119');
});

test('extractModel finds the model token in real titles', () => {
  assert.equal(extractModel('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK'), 'RF40FTVBK');
  assert.equal(extractModel('غسالة توشيبا فتحة علوية اتوماتيك 10 كيلو بالطلمبة - باب كروم - ابيض AWE-E1050SUP'), 'AWEE1050SUP');
  assert.equal(extractModel('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر ديجيتال لون سيلفر AY-XP18UHE'), 'AYXP18UHE');
  assert.equal(extractModel('ميكروويف تورنيدو 28 لتر سولو TMD- 28S-BK'), 'TMD28SBK');
});

test('extractModel rejects pure spec tokens', () => {
  assert.equal(extractModel('تلفزيون سامسونج 55 بوصة 4K سمارت'), null);
  assert.equal(extractModel('لاب توب 16GB RAM 512GB SSD'), null);
  assert.equal(extractModel('غسالة 7 كيلو 1200 لفة'), null);
  assert.equal(extractModel('Sharp 75 inch 4K Smart TV'), null);
});

/* REGRESSION: an earlier implementation joined model fragments only across
   dashes, so a model written with internal SPACES came back null and the same
   fridge in two languages failed to match. */
test('extractModel joins fragments split by spaces as well as dashes', () => {
  assert.equal(extractModel('Tornado Refrigerator No Frost 355L Black RF – 40 FTV – BK'), 'RF40FTVBK');
  assert.equal(extractModel('غسالة ملابس زانوسى اتوماتيك 7 ك ديجيتال 1200 لفة TC4 -ZWF7240SS5'), 'TC4ZWF7240SS5');
});

/* REGRESSION: Titlecase prose words must terminate a model run, or
   "No Frost ... Black" would be swallowed into the model. */
test('extractModel does not absorb Titlecase prose', () => {
  assert.equal(extractModel('Tornado No Frost Black RF-40FTV-BK'), 'RF40FTVBK');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/normalize.test.mjs`
Expected: FAIL — `Cannot find module './normalize.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/normalize.mjs
/* Text normalization primitives. Pure — no I/O, no state.
   Arabic titles vary freely in alef/ya/ta-marbuta spelling and digit script;
   every comparison in the engine runs through here first. */

export function normDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٬٫]/g, ',');
}

export function normText(s) {
  return normDigits(s)
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '')   // diacritics + tatweel
    .replace(/\s+/g, ' ')
    .trim();
}

export function normModel(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* A model number is a letters+digits run of >=5 normalized chars that is not a
   pure spec value. Real titles split models across BOTH spaces and en-dashes
   ("RF – 51 FTV – DST", "TC4 -ZWF7240SS5"), so consecutive ALL-CAPS/digit
   fragments are joined. Casing is the signal that separates a model fragment
   from prose: "RF"/"FTV"/"BK" are fragments, "Black"/"Frost"/"Tornado" are not.
   Spec tokens (16GB, RAM, SSD, 4K) are dropped so a spec list never reads as a
   model. */
const SPEC_ONLY = /^\d+(GB|TB|MB|KG|ML|MM|CM|HZ|HP|W|K|L|INCH|INCHES|LPM|RPM)$/;
const SPEC_WORDS = new Set(['RAM', 'SSD', 'HDD', 'LED', 'LCD', 'OLED', 'QLED', 'UHD', 'FHD',
  'HD', 'TV', 'PC', 'USB', 'WIFI', 'AC', 'DC', 'CPU', 'GPU', 'NFC', 'GPS', 'LTE']);

export function extractModel(title) {
  const t = normDigits(String(title ?? ''));
  const runs = [];
  let cur = [];
  const flush = () => { if (cur.length) runs.push(cur.join('')); cur = []; };

  for (const tok of t.split(/\s+/)) {
    if (/^[-–—]+$/.test(tok)) continue;          // a lone dash connects, never breaks
    const core = normModel(tok);
    const stripped = tok.replace(/[-–—]/g, '');
    const isFragment = core.length > 0 && core.length <= 12 &&
      stripped === stripped.toUpperCase() && /^[A-Z0-9]+$/.test(core);
    if (!isFragment) { flush(); continue; }
    if (SPEC_ONLY.test(core) || SPEC_WORDS.has(core)) { flush(); continue; }
    cur.push(core);
  }
  flush();

  let best = null;
  for (const r of runs) {
    if (r.length < 5) continue;
    if (!/\d/.test(r) || !/[A-Z]/.test(r)) continue;
    if (SPEC_ONLY.test(r)) continue;
    if (!best || r.length > best.length) best = r;
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/normalize.test.mjs`
Expected: PASS — 5 tests

If `extractModel` returns a wrong token for a title, adjust the candidate scoring — do **not** weaken the assertions. These titles are real production data from `site/data/products.json`.

- [ ] **Step 5: Commit**

```bash
git add site/engine/normalize.mjs site/engine/normalize.test.mjs
git commit -m "feat(engine): text/model normalization primitives"
```

---

## Task 2: Unit extraction

**Files:**
- Create: `site/engine/units.mjs`
- Test: `site/engine/units.test.mjs`

**Interfaces:**
- Consumes: `normDigits`, `normText` from `./normalize.mjs`
- Produces: `extractUnits(title: string) => Record<string, number>` — canonical unit keys: `inch`, `liter`, `kg`, `feet`, `hp`, `rpm`, `watt`, `gb`, `tb`, `cm`

**Context:** Real titles write units with **no space** (`4.7لتر`, `1500وات`), abbreviated (`7 ك` = 7 kilo), bilingual (`10 Feet` and `10 قدم`), and decimal (`2.25 حصان`). Dimension pairs (`90 × 60 سم`) must not be read as a single value.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/units.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUnits } from './units.mjs';

test('extracts Arabic units with and without spaces', () => {
  assert.equal(extractUnits('ثلاجة تورنيدو 395 لتر').liter, 395);
  assert.equal(extractUnits('قلاية هوائية بيكو اسود4.7لتر سعة سلة3.9لتر1500وات').liter, 4.7);
  assert.equal(extractUnits('قلاية هوائية بيكو اسود4.7لتر 1500وات').watt, 1500);
  assert.equal(extractUnits('غسالة توشيبا 8 كيلو اتوماتيك').kg, 8);
  assert.equal(extractUnits('غسالة زانوسى 7 ك ديجيتال 1200 لفة').kg, 7);
  assert.equal(extractUnits('غسالة زانوسى 7 ك ديجيتال 1200 لفة').rpm, 1200);
});

test('extracts English units and bilingual run-together titles', () => {
  assert.equal(extractUnits('Sharp 75 inch 4K Smart TV').inch, 75);
  assert.equal(extractUnits('Kiriazi Refrigerator E280 - 2 Doors 10 Feetثلاجة كريازى 10 قدم').feet, 10);
  assert.equal(extractUnits('Kiriazi KAC 18 CH Split Air Conditioner – 2.25 HP').hp, 2.25);
  assert.equal(extractUnits('تكييف شارب اسبليت 2.25 حصان بارد').hp, 2.25);
});

test('handles Arabic-Indic digits', () => {
  assert.equal(extractUnits('شاشة شارب ٧٥ بوصة').inch, 75);
});

test('does not invent units that are absent', () => {
  const u = extractUnits('تلفزيون سامسونج سمارت');
  assert.equal(Object.keys(u).length, 0);
});

test('dimension pairs do not produce a bogus single value', () => {
  // "90 × 60 سم" is a size pair, not one cm measurement
  assert.equal(extractUnits('بوتاجاز فري ستاند 90 × 60 سم 5 شعلة').cm, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/units.test.mjs`
Expected: FAIL — `Cannot find module './units.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/units.mjs
/* Extract {canonicalUnit: number} from a bilingual product title.
   Real titles omit the space ("4.7لتر", "1500وات") and abbreviate ("7 ك"),
   so the number and unit are matched as one pattern with optional separator. */
import { normDigits, normText } from './normalize.mjs';

/* Order matters: longer/more specific spellings first, so "لتر" does not
   shadow nothing and "كيلو" is preferred over the bare "ك". */
const UNITS = [
  ['inch',  ['بوصه', 'بوصة', 'انش', 'inches', 'inch', '"']],
  ['liter', ['لتر', 'liters', 'litres', 'liter', 'litre', 'ltr', 'l']],
  ['kg',    ['كيلو', 'كجم', 'kilogram', 'kilo', 'kgs', 'kg', 'ك']],
  ['feet',  ['قدم', 'feet', 'foot', 'ft']],
  ['hp',    ['حصان', 'horsepower', 'hp']],
  ['rpm',   ['لفه', 'لفة', 'دورة', 'rpm']],
  ['watt',  ['وات', 'watts', 'watt', 'w']],
  ['tb',    ['تيرا', 'tb']],
  ['gb',    ['جيجا', 'gb']],
  ['cm',    ['سم', 'cm']],
];

/* A dimension pair like "90 × 60 سم" describes width×depth, not one value —
   detect and skip rather than record a misleading cm. */
const DIMENSION = /\d+\s*[x×*]\s*\d+/;

export function extractUnits(title) {
  const t = normText(normDigits(title));
  const out = {};
  for (const [canon, spellings] of UNITS) {
    for (const sp of spellings) {
      // bare single-letter units (l, w, k) require a word boundary before them
      const needsBoundary = /^[a-z]$/.test(sp) || sp === 'ك';
      const unitPat = sp.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
      const re = new RegExp(
        '(\\d+(?:\\.\\d+)?)\\s*' + unitPat + (needsBoundary ? '(?![a-z\\u0600-\\u06FF])' : ''),
        'i');
      const m = t.match(re);
      if (!m) continue;
      if (canon === 'cm' && DIMENSION.test(t)) break;   // size pair, not a spec
      out[canon] = parseFloat(m[1]);
      break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/units.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/units.mjs site/engine/units.test.mjs
git commit -m "feat(engine): bilingual unit extraction"
```

---

## Task 3: Category detection

**Files:**
- Create: `site/engine/categories.mjs`
- Test: `site/engine/categories.test.mjs`

**Interfaces:**
- Consumes: `normText` from `./normalize.mjs`
- Produces:
  - `CATEGORIES: Record<string, {units: string[], specs: string[], names: string[]}>`
  - `detectCategory(title: string) => string | null`
  - `extractSpecs(title: string, category: string) => Record<string, string|boolean>`

**Context — this is the trap.** A naive "does the title contain «شاشة»" test classifies the real product
`"مبرد مياه كولدير 2 حنفية بارد / ساخن بالثلاجة شاشة ديجيتال اسود"` (a **water cooler**) as both a TV and a fridge. Category must be decided by the **earliest-occurring** category noun, since Arabic product titles lead with the product type.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/categories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCategory, extractSpecs, CATEGORIES } from './categories.mjs';

test('detects category from the LEADING noun, not any substring', () => {
  // real title: a water cooler that mentions both شاشة (screen) and ثلاجة (fridge)
  const cooler = 'مبرد مياه كولدير 2 حنفية بارد / ساخن بالثلاجة شاشة ديجيتال اسود';
  assert.equal(detectCategory(cooler), 'cooler');

  assert.equal(detectCategory('ثلاجة تورنيدو انفرتر نوفروست 2 باب - 395 لتر'), 'fridge');
  assert.equal(detectCategory('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية'), 'washer');
  assert.equal(detectCategory('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر'), 'ac');
  assert.equal(detectCategory('ميكروويف فريش 36 لتر ديجيتال بالجريل'), 'microwave');
  assert.equal(detectCategory('بوتاجاز لاجيرمانيا فري ستاند 90 × 60 سم 5 شعلة'), 'cooker');
  assert.equal(detectCategory('قلاية هوائية بيكو 4.7لتر'), 'fryer');
  assert.equal(detectCategory('سخان بلاطه سوكانى 500 وات'), 'heater');
  assert.equal(detectCategory('Sharp 75 inch 4K Smart TV'), 'tv');
  assert.equal(detectCategory('شاشة شارب 75 بوصة سمارت'), 'tv');
});

test('returns null for an unrecognised category', () => {
  assert.equal(detectCategory('كرسي مكتب جلد اسود'), null);
});

test('every category declares units and specs', () => {
  for (const [name, def] of Object.entries(CATEGORIES)) {
    assert.ok(Array.isArray(def.units), `${name}.units`);
    assert.ok(Array.isArray(def.specs), `${name}.specs`);
    assert.ok(def.names.length > 0, `${name}.names`);
  }
});

test('extractSpecs reads declared boolean specs', () => {
  const s = extractSpecs('ثلاجة تورنيدو انفرتر نوفروست 2 باب - 395 لتر', 'fridge');
  assert.equal(s.nofrost, true);
  assert.equal(s.doors, '2');

  const ac = extractSpecs('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر', 'ac');
  assert.equal(ac.inverter, true);

  const tv = extractSpecs('Sharp 75 inch 4K Smart TV', 'tv');
  assert.equal(tv.resolution, '4k');
  assert.equal(tv.smart, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/categories.test.mjs`
Expected: FAIL — `Cannot find module './categories.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/categories.mjs
/* Category table — the extension point. Adding an appliance type is one entry
   here; no matcher code changes. `units` and `specs` are the DEFINING
   attributes: if two listings disagree on any of them, they are different
   products. */
import { normText } from './normalize.mjs';

export const CATEGORIES = {
  tv:        { units: ['inch'],           specs: ['resolution', 'smart'],
               names: ['تلفزيون', 'تليفزيون', 'تلفاز', 'شاشه', 'television', 'tv'] },
  fridge:    { units: ['liter', 'feet'],  specs: ['doors', 'nofrost'],
               names: ['ثلاجه', 'تلاجه', 'refrigerator', 'fridge'] },
  freezer:   { units: ['liter', 'feet'],  specs: ['drawers'],
               names: ['فريزر', 'ديب فريزر', 'freezer'] },
  washer:    { units: ['kg', 'rpm'],      specs: ['loading'],
               names: ['غساله', 'washing machine', 'washer'] },
  dishwasher:{ units: [],                 specs: ['sets'],
               names: ['غساله اطباق', 'dishwasher'] },
  dryer:     { units: ['kg'],             specs: [],
               names: ['مجفف', 'دراير', 'dryer'] },
  ac:        { units: ['hp'],             specs: ['inverter', 'mode'],
               names: ['تكييف', 'مكيف', 'air conditioner', 'conditioner'] },
  microwave: { units: ['liter', 'watt'],  specs: ['grill'],
               names: ['ميكروويف', 'مايكروويف', 'microwave'] },
  oven:      { units: ['liter'],          specs: ['fuel'],
               names: ['فرن', 'oven'] },
  cooker:    { units: ['cm'],             specs: ['burners', 'fuel'],
               names: ['بوتاجاز', 'بوتجاز', 'cooker', 'stove'] },
  fryer:     { units: ['liter', 'watt'],  specs: ['digital'],
               names: ['قلايه', 'مقلاه', 'air fryer', 'fryer', 'airfryer'] },
  heater:    { units: ['liter', 'watt'],  specs: ['fuel'],
               names: ['سخان', 'heater'] },
  cooler:    { units: [],                 specs: ['taps'],
               names: ['مبرد مياه', 'مبرد ميه', 'water dispenser', 'dispenser'] },
  vacuum:    { units: ['watt'],           specs: [],
               names: ['مكنسه', 'vacuum', 'hoover'] },
  blender:   { units: ['watt'],           specs: [],
               names: ['خلاط', 'blender', 'mixer'] },
  kettle:    { units: ['liter', 'watt'],  specs: [],
               names: ['غلايه', 'kettle'] },
  fan:       { units: [],                 specs: ['type'],
               names: ['مروحه', 'fan'] },
  laptop:    { units: ['inch', 'gb', 'tb'], specs: ['cpu', 'ram'],
               names: ['لاب توب', 'لابتوب', 'laptop', 'notebook'] },
  phone:     { units: ['gb'],             specs: ['ram', 'network'],
               names: ['موبايل', 'هاتف', 'smartphone', 'mobile phone'] },
};

/* Decide by EARLIEST occurrence, not mere presence. Arabic product titles lead
   with the product type; a water cooler that mentions "بالثلاجة شاشة" later in
   the description must not be classified as a fridge or a TV. Longer names win
   ties so "مبرد مياه" beats a shorter accidental match. */
export function detectCategory(title) {
  const t = normText(title);
  let bestCat = null, bestPos = Infinity, bestLen = 0;
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    for (const name of def.names) {
      const n = normText(name);
      const pos = t.indexOf(n);
      if (pos === -1) continue;
      if (pos < bestPos || (pos === bestPos && n.length > bestLen)) {
        bestCat = cat; bestPos = pos; bestLen = n.length;
      }
    }
  }
  return bestCat;
}

/* Spec readers, keyed by spec name. Each returns a value or undefined. */
const SPEC_READERS = {
  nofrost:  t => /نوفروست|نو فروست|no ?frost/.test(t) || undefined,
  inverter: t => /انفرتر|inverter/.test(t) || undefined,
  smart:    t => /سمارت|ذكيه|smart/.test(t) || undefined,
  digital:  t => /ديجيتال|digital/.test(t) || undefined,
  grill:    t => /جريل|grill/.test(t) || undefined,
  doors:    t => (t.match(/(\d+)\s*باب/) || t.match(/(\d+)\s*doors?/) || [])[1],
  burners:  t => (t.match(/(\d+)\s*شعله/) || t.match(/(\d+)\s*burners?/) || [])[1],
  taps:     t => (t.match(/(\d+)\s*حنفيه/) || t.match(/(\d+)\s*taps?/) || [])[1],
  drawers:  t => (t.match(/(\d+)\s*درج/) || [])[1],
  sets:     t => (t.match(/(\d+)\s*فرد/) || [])[1],
  ram:      t => (t.match(/(\d+)\s*(?:جيجا)?\s*ram/) || [])[1],
  cpu:      t => (t.match(/\b(i[3579]|ryzen\s*\d|celeron|athlon)\b/) || [])[1],
  resolution: t => (t.match(/\b(4k|8k|uhd|fhd|hd)\b/) || [])[1],
  loading:  t => /فتحه علويه|top ?load/.test(t) ? 'top'
              : /فتحه اماميه|front ?load/.test(t) ? 'front' : undefined,
  fuel:     t => /غاز|gas/.test(t) ? 'gas'
              : /كهرب|electric/.test(t) ? 'electric' : undefined,
  mode:     t => /بارد\s*[-\/ ]?\s*ساخن|cooling ?& ?heating|heat/.test(t) ? 'cool-heat'
              : /بارد|cooling/.test(t) ? 'cool' : undefined,
  network:  t => /\b5g\b/.test(t) ? '5g' : /\b4g\b/.test(t) ? '4g' : undefined,
  type:     t => (t.match(/\b(stand|desk|wall|ceiling)\b/) || [])[1],
};

export function extractSpecs(title, category) {
  const def = CATEGORIES[category];
  if (!def) return {};
  const t = normText(title);
  const out = {};
  for (const spec of def.specs) {
    const read = SPEC_READERS[spec];
    if (!read) continue;
    const v = read(t);
    if (v !== undefined) out[spec] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/categories.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/categories.mjs site/engine/categories.test.mjs
git commit -m "feat(engine): data-driven category table with leading-noun detection"
```

---

## Task 4: Product identity matcher

**Files:**
- Create: `site/engine/matcher.mjs`
- Test: `site/engine/matcher.test.mjs`

**Interfaces:**
- Consumes: `normText`, `normModel`, `extractModel` from `./normalize.mjs`; `extractUnits` from `./units.mjs`; `detectCategory`, `extractSpecs`, `CATEGORIES` from `./categories.mjs`
- Produces:
  - `identify(title: string) => {brand, category, model, units, specs, key}`
  - `sameProduct(a: Identity, b: Identity) => {same: boolean, confidence: 'exact'|'strong'|'weak'|'none', reason: string}`
  - `BRANDS: Record<string, string[]>`

**The rule (from the spec):** a defining attribute present in **both** and **different** ⇒ different products. Present in **one only** ⇒ unknown, allowed at lower confidence. All present attributes equal + same brand + same category ⇒ same product.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/matcher.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, sameProduct } from './matcher.mjs';

const id = t => identify(t);

test('identical model numbers are exact matches across languages', () => {
  const a = id('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK');
  const b = id('Tornado Refrigerator No Frost 355L Black RF – 40 FTV – BK');
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'exact');
});

test('different capacity means different product — washers', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');
  const b = id('غسالة توشيبا 10 كيلو اتوماتيك فتحة علوية');
  assert.equal(sameProduct(a, b).same, false);
});

test('different size means different product — TVs', () => {
  const a = id('شاشة شارب 75 بوصة 4K سمارت');
  const b = id('شاشة شارب 65 بوصة 4K سمارت');
  assert.equal(sameProduct(a, b).same, false);
});

test('different horsepower means different product — AC', () => {
  const a = id('تكييف شارب اسبليت 2.25 حصان بارد ساخن انفرتر');
  const b = id('تكييف شارب اسبليت 3 حصان بارد ساخن انفرتر');
  assert.equal(sameProduct(a, b).same, false);
});

test('different storage means different product — phones', () => {
  const a = id('موبايل سامسونج 128 جيجا');
  const b = id('موبايل سامسونج 256 جيجا');
  assert.equal(sameProduct(a, b).same, false);
});

test('different brand is never the same product', () => {
  const a = id('غسالة توشيبا 8 كيلو');
  const b = id('غسالة زانوسي 8 كيلو');
  assert.equal(sameProduct(a, b).same, false);
});

test('different category is never the same product', () => {
  const a = id('ثلاجة تورنيدو 395 لتر');
  const b = id('فريزر تورنيدو 395 لتر');
  assert.equal(sameProduct(a, b).same, false);
});

test('same brand+category+specs with no model is a strong match', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');
  const b = id('Toshiba washing machine 8 kg automatic top load');
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'strong');
});

/* REGRESSION: an attribute absent from BOTH listings was once counted as
   "missing", demoting every otherwise-perfect match to 'weak'. Neither of these
   washer titles states RPM — that is agreement, not a gap. */
test('an attribute absent from both listings still allows a strong match', () => {
  const a = id('غسالة توشيبا 8 كيلو اتوماتيك فتحة علوية');       // no RPM stated
  const b = id('Toshiba washing machine 8 kg automatic top load'); // no RPM stated
  assert.equal(sameProduct(a, b).confidence, 'strong');
});

test('a spec present in only one listing does not block the match, but weakens it', () => {
  const a = id('شاشة شارب 75 بوصة 4K سمارت');
  const b = id('شاشة شارب 75 بوصة');   // resolution + smart absent
  const r = sameProduct(a, b);
  assert.equal(r.same, true);
  assert.equal(r.confidence, 'weak');
});

test('the water-cooler trap does not match a fridge', () => {
  const cooler = id('مبرد مياه كولدير 2 حنفية بارد / ساخن بالثلاجة شاشة ديجيتال اسود');
  const fridge = id('ثلاجة كولدير 2 باب 395 لتر');
  assert.equal(sameProduct(cooler, fridge).same, false);
});

test('identity key is stable and equal for the same product', () => {
  const a = id('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK');
  const b = id('Tornado Refrigerator 355L RF-40FTV-BK');
  assert.equal(a.key, b.key);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/matcher.test.mjs`
Expected: FAIL — `Cannot find module './matcher.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/matcher.mjs
/* Product identity. Pure — the whole accuracy claim of the comparer rests on
   sameProduct(). See docs/superpowers/specs/2026-07-19-price-comparer-catalog-design.md */
import { normText, extractModel } from './normalize.mjs';
import { extractUnits } from './units.mjs';
import { detectCategory, extractSpecs, CATEGORIES } from './categories.mjs';

export const BRANDS = {
  kiriazi: ['كريازي', 'kiriazi'], sharp: ['شارب', 'sharp'], tornado: ['تورنيدو', 'tornado'],
  fresh: ['فريش', 'fresh'], olympic: ['اوليمبك', 'olympic'], coldair: ['كولدير', 'coldair'],
  toshiba: ['توشيبا', 'toshiba'], zanussi: ['زانوسي', 'zanussi'], beko: ['بيكو', 'beko'],
  lg: ['ال جي', 'lg'], samsung: ['سامسونج', 'samsung'], midea: ['ميديا', 'midea'],
  carrier: ['كاريير', 'carrier'], unionaire: ['يونيون اير', 'unionaire'],
  passap: ['باساب', 'passap'], philips: ['فيليبس', 'philips'], kenwood: ['كينوود', 'kenwood'],
  braun: ['براون', 'braun'], hisense: ['هايسنس', 'hisense'], haier: ['هاير', 'haier'],
  bosch: ['بوش', 'bosch'], panasonic: ['باناسونيك', 'panasonic'],
  lagermania: ['لاجيرمانيا', 'lagermania', 'la germania'],
  sokany: ['سوكاني', 'sokany'], white_whale: ['وايت ويل', 'white whale'],
};

function detectBrand(title) {
  const t = normText(title);
  let best = null, pos = Infinity;
  for (const [brand, names] of Object.entries(BRANDS))
    for (const n of names) {
      const i = t.indexOf(normText(n));
      if (i !== -1 && i < pos) { best = brand; pos = i; }
    }
  return best;
}

export function identify(title) {
  const category = detectCategory(title);
  const brand = detectBrand(title);
  const model = extractModel(title);
  const allUnits = extractUnits(title);
  // keep only the units this category treats as DEFINING
  const defining = category ? CATEGORIES[category].units : [];
  const units = {};
  for (const u of defining) if (allUnits[u] !== undefined) units[u] = allUnits[u];
  const specs = category ? extractSpecs(title, category) : {};

  const key = model
    ? `m:${model}`
    : `b:${brand || '?'}|c:${category || '?'}|` +
      Object.entries(units).sort().map(([k, v]) => `${k}=${v}`).join(',') + '|' +
      Object.entries(specs).sort().map(([k, v]) => `${k}=${v}`).join(',');

  return { brand, category, model, units, specs, key, title };
}

/* The rule: present in both and different => different product.
   Present in one only => unknown, allowed, lower confidence. */
export function sameProduct(a, b) {
  if (a.model && b.model)
    return a.model === b.model
      ? { same: true, confidence: 'exact', reason: 'model match' }
      : { same: false, confidence: 'none', reason: 'model mismatch' };

  if (a.category && b.category && a.category !== b.category)
    return { same: false, confidence: 'none', reason: 'category mismatch' };
  if (a.brand && b.brand && a.brand !== b.brand)
    return { same: false, confidence: 'none', reason: 'brand mismatch' };

  let bothKnown = 0, oneMissing = 0;
  const compare = (av, bv) => {
    const aHas = av !== undefined, bHas = bv !== undefined;
    // absent from BOTH listings is agreement, not missing information — a washer
    // pair that neither states RPM still deserves a 'strong' match
    if (!aHas && !bHas) return true;
    if (!aHas || !bHas) { oneMissing++; return true; }
    bothKnown++;
    return String(av) === String(bv);
  };

  const cat = a.category || b.category;
  const def = cat ? CATEGORIES[cat] : null;
  if (def) {
    for (const u of def.units)
      if (!compare(a.units[u], b.units[u]))
        return { same: false, confidence: 'none', reason: `unit ${u} differs` };
    for (const s of def.specs)
      if (!compare(a.specs[s], b.specs[s]))
        return { same: false, confidence: 'none', reason: `spec ${s} differs` };
  }

  if (!a.brand || !b.brand || !cat)
    return { same: false, confidence: 'none', reason: 'insufficient identity' };

  // every defining attribute known to both agreed
  return bothKnown > 0 && oneMissing === 0
    ? { same: true, confidence: 'strong', reason: 'all specs agree' }
    : { same: true, confidence: 'weak', reason: 'partial spec overlap' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/matcher.test.mjs`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/matcher.mjs site/engine/matcher.test.mjs
git commit -m "feat(engine): category-generic product identity matcher"
```

---

## Task 5: SQLite catalog

**Files:**
- Create: `site/engine/catalog.mjs`
- Test: `site/engine/catalog.test.mjs`

**Interfaces:**
- Consumes: `identify` from `./matcher.mjs`
- Produces:
  - `openCatalog(path?: string) => Catalog` (`':memory:'` default)
  - `Catalog.upsertOffer({domain, url, title, price, currency, inStock}) => {offerId, productId}`
  - `Catalog.search(query: string, limit?: number) => Offer[]`
  - `Catalog.priceHistory(offerId: number) => {price, seen_at}[]`
  - `Catalog.getCursor(domain: string) => number`
  - `Catalog.setCursor(domain: string, cursor: number, status?: string) => void`
  - `Catalog.close() => void`
  - Offer shape: `{offer_id, product_id, domain, url, price, currency, in_stock, title_raw, last_checked, brand, category, model_norm}`

**Context:** FTS5 with `unicode61` is verified to tokenize Arabic and match model numbers when terms are quoted. Unquoted terms containing `-` are parsed as FTS column syntax and throw — always quote.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';

const seed = c => {
  c.upsertOffer({ domain: '2b.com.eg', url: 'https://2b.com.eg/p/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 41000, inStock: true });
  c.upsertOffer({ domain: 'elarabygroup.com', url: 'https://elarabygroup.com/p/2',
    title: 'شاشة شارب 4K سمارت بدون فريم 75 بوصة 4T-C75FN6EX', price: 39699, inStock: true });
  c.upsertOffer({ domain: 'btech.com', url: 'https://btech.com/p/3',
    title: 'غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', price: 12079, inStock: true });
};

test('upsert then search finds Arabic titles', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('شارب 75');
  assert.ok(r.length >= 2, `expected >=2 got ${r.length}`);
  c.close();
});

test('search matches an exact model number', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('4T-C75FN6EX');
  assert.equal(r.length, 2);
  c.close();
});

test('offers sharing a model number share one product_id', () => {
  const c = openCatalog();
  seed(c);
  const r = c.search('4T-C75FN6EX');
  assert.equal(r[0].product_id, r[1].product_id);
  c.close();
});

test('re-upserting the same URL updates price and records history', () => {
  const c = openCatalog();
  const { offerId } = c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p',
    title: 'ثلاجة تورنيدو 395 لتر RF-51FTV', price: 29179, inStock: true });
  c.upsertOffer({ domain: 'x.com', url: 'https://x.com/p',
    title: 'ثلاجة تورنيدو 395 لتر RF-51FTV', price: 27999, inStock: true });
  const hist = c.priceHistory(offerId);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].price, 29179);
  assert.equal(hist[1].price, 27999);
  const rows = c.search('تورنيدو');
  assert.equal(rows.length, 1, 'URL is unique — no duplicate offer row');
  assert.equal(rows[0].price, 27999);
  c.close();
});

test('search does not throw on hyphenated or quote-bearing input', () => {
  const c = openCatalog();
  seed(c);
  assert.doesNotThrow(() => c.search('RF-40FTV-BK'));
  assert.doesNotThrow(() => c.search('75" شاشة'));
  assert.doesNotThrow(() => c.search(''));
  c.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/catalog.test.mjs`
Expected: FAIL — `Cannot find module './catalog.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/catalog.mjs
/* SQLite product catalog. `products` are identities, `offers` are per-store
   listings keyed by URL, `price_history` tracks changes over time. */
import { DatabaseSync } from 'node:sqlite';
import { identify } from './matcher.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  identity_key TEXT UNIQUE NOT NULL,
  brand TEXT, category TEXT, model_norm TEXT,
  attrs_json TEXT, title_canonical TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  domain TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  price INTEGER, currency TEXT DEFAULT 'EGP',
  in_stock INTEGER DEFAULT 1,
  title_raw TEXT,
  first_seen INTEGER, last_checked INTEGER
);
CREATE INDEX IF NOT EXISTS offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS offers_domain  ON offers(domain);
CREATE TABLE IF NOT EXISTS price_history (
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  price INTEGER NOT NULL, seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hist_offer ON price_history(offer_id);
CREATE TABLE IF NOT EXISTS crawl_state (
  domain TEXT PRIMARY KEY,
  last_sitemap_etag TEXT, cursor INTEGER DEFAULT 0,
  last_run INTEGER, status TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS offers_fts USING fts5(
  title_raw, brand, model_norm, content='', tokenize='unicode61'
);
`;

/* FTS5 treats bare '-' and '"' as syntax. Quote every term so hyphenated model
   numbers and stray quotes are literals, and OR them for recall. */
function ftsQuery(q) {
  const terms = String(q || '').split(/\s+/)
    .map(t => t.replace(/"/g, '').trim())
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map(t => `"${t}"`).join(' OR ');
}

export function openCatalog(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const findProduct = db.prepare('SELECT id FROM products WHERE identity_key = ?');
  const insProduct = db.prepare(
    'INSERT INTO products (identity_key, brand, category, model_norm, attrs_json, title_canonical) VALUES (?,?,?,?,?,?)');
  const findOffer = db.prepare('SELECT id, price FROM offers WHERE url = ?');
  const insOffer = db.prepare(
    'INSERT INTO offers (product_id, domain, url, price, currency, in_stock, title_raw, first_seen, last_checked) VALUES (?,?,?,?,?,?,?,?,?)');
  const updOffer = db.prepare(
    'UPDATE offers SET price=?, in_stock=?, title_raw=?, last_checked=?, product_id=? WHERE id=?');
  const insHist = db.prepare('INSERT INTO price_history (offer_id, price, seen_at) VALUES (?,?,?)');
  const insFts = db.prepare('INSERT INTO offers_fts (rowid, title_raw, brand, model_norm) VALUES (?,?,?,?)');
  const delFts = db.prepare("INSERT INTO offers_fts (offers_fts, rowid, title_raw, brand, model_norm) VALUES ('delete', ?, ?, ?, ?)");

  return {
    db,

    upsertOffer({ domain, url, title, price, currency = 'EGP', inStock = true, now = Date.now() }) {
      const idy = identify(title);
      let row = findProduct.get(idy.key);
      if (!row) {
        insProduct.run(idy.key, idy.brand, idy.category, idy.model,
          JSON.stringify({ units: idy.units, specs: idy.specs }), title);
        row = findProduct.get(idy.key);
      }
      const productId = row.id;
      const existing = findOffer.get(url);
      let offerId;
      if (existing) {
        offerId = existing.id;
        // CRITICAL: a contentless FTS5 table needs the row's ORIGINAL indexed values

        // to locate and remove its postings. Passing null deletes NOTHING and leaks

        // stale tokens permanently — search then matches text no listing contains.

        const prev = db.prepare(`SELECT o.title_raw, p.brand, p.model_norm FROM offers o

          JOIN products p ON p.id = o.product_id WHERE o.id = ?`).get(offerId);

        if (prev) delFts.run(offerId, prev.title_raw, prev.brand, prev.model_norm);
        updOffer.run(price, inStock ? 1 : 0, title, now, productId, offerId);
        if (existing.price !== price) insHist.run(offerId, price, now);
      } else {
        insOffer.run(productId, domain, url, price, currency, inStock ? 1 : 0, title, now, now);
        offerId = findOffer.get(url).id;
        insHist.run(offerId, price, now);
      }
      insFts.run(offerId, title, idy.brand, idy.model);
      return { offerId, productId };
    },

    search(query, limit = 200) {
      const fq = ftsQuery(query);
      if (!fq) return [];
      return db.prepare(`
        SELECT o.id AS offer_id, o.product_id, o.domain, o.url, o.price, o.currency,
               o.in_stock, o.title_raw, o.last_checked,
               p.brand, p.category, p.model_norm
        FROM offers_fts f
        JOIN offers o ON o.id = f.rowid
        JOIN products p ON p.id = o.product_id
        WHERE offers_fts MATCH ?
        ORDER BY rank LIMIT ?`).all(fq, limit);
    },

    priceHistory(offerId) {
      return db.prepare('SELECT price, seen_at FROM price_history WHERE offer_id=? ORDER BY seen_at').all(offerId);
    },

    /* Resumability: how far into a store's product-URL list the last run got.
       An interrupted crawl continues rather than refetching from zero. */
    getCursor(domain) {
      const r = db.prepare('SELECT cursor FROM crawl_state WHERE domain=?').get(domain);
      return r ? r.cursor : 0;
    },
    setCursor(domain, cursor, status = 'ok') {
      db.prepare(`INSERT INTO crawl_state (domain, cursor, last_run, status) VALUES (?,?,?,?)
                  ON CONFLICT(domain) DO UPDATE SET cursor=excluded.cursor,
                    last_run=excluded.last_run, status=excluded.status`)
        .run(domain, cursor, Date.now(), status);
    },

    close() { db.close(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/catalog.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/catalog.mjs site/engine/catalog.test.mjs
git commit -m "feat(engine): SQLite FTS5 product catalog"
```

---

## Task 6: robots.txt compliance

**Files:**
- Create: `site/engine/robots.mjs`
- Test: `site/engine/robots.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseRobots(text: string, ua?: string) => {allowed: (path)=>boolean, crawlDelay: number|null, sitemaps: string[]}`
  - `CRAWLER_UA: string`

Parsing is separated from fetching deliberately: `crawler.mjs` takes an injectable `fetchImpl`, so all crawl tests run with no network.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/robots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots } from './robots.mjs';

test('empty Disallow means allow everything (labeb.com style)', () => {
  const r = parseRobots('User-agent: *\nDisallow:\nSitemap: https://eg.labeb.com/sitemap.xml');
  assert.equal(r.allowed('/anything'), true);
  assert.deepEqual(r.sitemaps, ['https://eg.labeb.com/sitemap.xml']);
});

test('honours Disallow paths', () => {
  const r = parseRobots('User-agent: *\nDisallow: /Checkout\nDisallow: /Account/');
  assert.equal(r.allowed('/Checkout'), false);
  assert.equal(r.allowed('/Account/me'), false);
  assert.equal(r.allowed('/product/123'), true);
});

test('reads Crawl-delay', () => {
  const r = parseRobots('User-agent: *\nCrawl-delay: 5\nDisallow:');
  assert.equal(r.crawlDelay, 5);
});

test('applies the wildcard group, not another bot group', () => {
  const txt = 'User-agent: AhrefsBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n';
  const r = parseRobots(txt);
  assert.equal(r.allowed('/product/1'), true);
  assert.equal(r.allowed('/admin'), false);
});

test('collects multiple sitemaps regardless of group', () => {
  const r = parseRobots('Sitemap: https://a/s1.xml\nUser-agent: *\nDisallow:\nSitemap: https://a/s2.xml');
  assert.equal(r.sitemaps.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/robots.test.mjs`
Expected: FAIL — `Cannot find module './robots.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/robots.mjs
/* robots.txt parsing and fetching. The crawler MUST route every URL through
   allowed() and MUST wait crawlDelay between requests to the same host. */
export const CRAWLER_UA =
  'Mozilla/5.0 (compatible; SADKO-price-comparer/1.0; +https://sadko-group.com/bot)';

export function parseRobots(text, ua = '*') {
  const lines = String(text || '').split(/\r?\n/);
  const sitemaps = [];
  const groups = new Map();       // ua -> {disallow:[], allow:[], delay:null}
  let current = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();

    if (key === 'sitemap') { sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      const name = val.toLowerCase();
      if (!groups.has(name)) groups.set(name, { disallow: [], allow: [], delay: null });
      current = [groups.get(name)];
      continue;
    }
    for (const g of current) {
      if (key === 'disallow' && val) g.disallow.push(val);
      else if (key === 'allow' && val) g.allow.push(val);
      else if (key === 'crawl-delay') g.delay = parseFloat(val) || null;
    }
  }

  const g = groups.get(ua.toLowerCase()) || groups.get('*') || { disallow: [], allow: [], delay: null };
  const match = (rules, path) => rules.some(r => {
    const pat = r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pat).test(path);
  });

  return {
    crawlDelay: g.delay,
    sitemaps,
    allowed: path => match(g.allow, path) ? true : !match(g.disallow, path),
  };
}

```

Note: there is no `fetchRobots` here. Fetching lives in `crawler.mjs` so it can
use the injectable `fetchImpl` and stay testable offline. A missing robots.txt is
handled there by calling `parseRobots('')` — allow all, no declared delay.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/robots.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/robots.mjs site/engine/robots.test.mjs
git commit -m "feat(engine): robots.txt parsing and compliance"
```

---

## Task 7: Sitemap parsing

**Files:**
- Create: `site/engine/sitemap.mjs`
- Test: `site/engine/sitemap.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseSitemap(xml: string) => {isIndex: boolean, urls: string[]}`
  - `isProductUrl(url: string) => boolean`

- [ ] **Step 1: Write the failing test**

```js
// site/engine/sitemap.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitemap, isProductUrl } from './sitemap.mjs';

test('parses a urlset', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://s.com/product/a</loc></url>
    <url><loc>  https://s.com/product/b  </loc></url>
  </urlset>`;
  const r = parseSitemap(xml);
  assert.equal(r.isIndex, false);
  assert.deepEqual(r.urls, ['https://s.com/product/a', 'https://s.com/product/b']);
});

test('detects a sitemap index', () => {
  const xml = `<sitemapindex><sitemap><loc>https://s.com/product-sitemap.xml</loc></sitemap></sitemapindex>`;
  const r = parseSitemap(xml);
  assert.equal(r.isIndex, true);
  assert.equal(r.urls[0], 'https://s.com/product-sitemap.xml');
});

test('isProductUrl recognises common product paths', () => {
  assert.equal(isProductUrl('https://s.com/product/x'), true);
  assert.equal(isProductUrl('https://s.com/products/x'), true);
  assert.equal(isProductUrl('https://s.com/shop/thing-p12345'), true);
  assert.equal(isProductUrl('https://s.com/blog/post'), false);
  assert.equal(isProductUrl('https://s.com/about'), false);
});

test('tolerates malformed xml without throwing', () => {
  assert.doesNotThrow(() => parseSitemap('<urlset><url><loc>broken'));
  assert.deepEqual(parseSitemap('not xml at all').urls, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/sitemap.test.mjs`
Expected: FAIL — `Cannot find module './sitemap.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/sitemap.mjs
/* Sitemap and sitemap-index parsing. Regex rather than an XML parser keeps the
   zero-dependency rule; sitemaps are a fixed, simple shape.
   Pure — fetching and walking live in crawler.mjs. */

export function parseSitemap(xml) {
  const text = String(xml || '');
  const urls = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  return { isIndex: /<sitemapindex/i.test(text), urls };
}

export function isProductUrl(u) {
  return /\/(product|products|item)\//i.test(u) || /-p-?\d{3,}/i.test(u) || /\/p\/[\w-]+/i.test(u);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/sitemap.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/sitemap.mjs site/engine/sitemap.test.mjs
git commit -m "feat(engine): sitemap and sitemap-index parsing"
```

---

## Task 8a: Shared offer-sanity gate

**Files:**
- Create: `site/engine/offer-gate.mjs`
- Modify: `site/compare-server.mjs` — delete its private copies, import from the new module
- Test: `site/engine/offer-gate.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `UI_TITLE: RegExp`, `BAD_URL: RegExp`
  - `parsePrice(x: string|number) => number` — 0 when outside 100..2,000,000
  - `decodeEntities(s: string) => string`
  - `isProductOffer({title, price, url}) => boolean`

**Why this task exists:** these regexes were fixed earlier in this project after
they let "add to cart" anchors and `href="#"` nav links be priced and ranked as
products. Two copies would drift and silently reintroduce that bug. The
dependency points one way only — `compare-server.mjs` → `engine/` — so there is
no cycle. Do **not** import from `compare-server.mjs`: it starts an HTTP server
at module load unless `SADKO_NO_SERVE` is set.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/offer-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, decodeEntities, isProductOffer } from './offer-gate.mjs';

test('parsePrice accepts plausible EGP and rejects the rest', () => {
  assert.equal(parsePrice('39,699'), 39699);
  assert.equal(parsePrice('٣٩٦٩٩'), 39699);
  assert.equal(parsePrice(41000), 41000);
  assert.equal(parsePrice('99'), 0);          // below floor
  assert.equal(parsePrice('9999999'), 0);     // above ceiling
  assert.equal(parsePrice('abc'), 0);
});

test('decodeEntities unwraps html entities and strips tags', () => {
  assert.equal(decodeEntities('Cooling&nbsp;&amp;&nbsp;Heating'), 'Cooling & Heating');
  assert.equal(decodeEntities('<b>شارب</b> 75'), 'شارب 75');
});

test('isProductOffer rejects UI chrome and non-product URLs', () => {
  const ok = { title: 'شاشة شارب 75 بوصة 4K', price: 39699, url: 'https://s.com/product/1' };
  assert.equal(isProductOffer(ok), true);
  assert.equal(isProductOffer({ ...ok, title: 'إضافة إلى السلة' }), false);
  assert.equal(isProductOffer({ ...ok, title: 'Add to cart' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/?add-to-cart=3991' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/cart' }), false);
  assert.equal(isProductOffer({ ...ok, url: 'https://s.com/' }), false);   // bare root = nav
  assert.equal(isProductOffer({ ...ok, price: 0 }), false);
  assert.equal(isProductOffer({ ...ok, title: 'short' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/offer-gate.test.mjs`
Expected: FAIL — `Cannot find module './offer-gate.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/offer-gate.mjs
/* Offer-sanity gate, shared by the crawler's extractor and the live adapters in
   compare-server.mjs. A harvested "item" is only an OFFER if it points at a real
   product page and is not storefront chrome. */

export const UI_TITLE = /^(?:إضافة إلى السلة|أضف إلى السلة|اضف للسلة|أضف للسلة|اضف الى السلة|اشتر(?:ى|ي) الآن|عرض المنتج|عرض التفاصيل|اقرأ المزيد|اقرا المزيد|التفاصيل|قارن|المفضلة|السلة|add to cart|add to basket|buy now|read more|view (?:product|details|more)|compare|wishlist|quick view|select options|show details)\s*$/i;

export const BAD_URL = /[?&](?:add-to-cart|add_to_cart|remove_item|s)=|\/(?:cart|checkout|wishlist|compare|my-account|account|login|register)(?:\/|$|\?)/i;

export function parsePrice(x) {
  if (typeof x === 'number') return x >= 100 && x <= 2e6 ? Math.round(x) : 0;
  const t = String(x ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\s,]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '');
  const v = parseFloat(t.replace(/[^\d.]/g, ''));
  return v >= 100 && v <= 2e6 ? Math.round(v) : 0;
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isProductOffer(o) {
  if (!o || !o.price || !o.url) return false;
  const title = String(o.title || '').trim();
  if (title.length < 8 || UI_TITLE.test(title)) return false;
  let u; try { u = new URL(o.url); } catch { return false; }
  // href="#" and bare-domain links resolve to the site root — navigation, not a
  // product; an offer the customer cannot click is worse than no offer
  if (!u.pathname || u.pathname === '/') return false;
  if (BAD_URL.test(u.href)) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/offer-gate.test.mjs`
Expected: PASS — 3 tests

- [ ] **Step 5: Rewire `compare-server.mjs` to the shared module**

Add to the imports in `site/compare-server.mjs`:

```js
import { parsePrice, decodeEntities, isProductOffer, UI_TITLE, BAD_URL } from './engine/offer-gate.mjs';
```

Then **delete** these now-duplicated definitions from `compare-server.mjs`:
`const UI_TITLE = …`, `const BAD_URL = …`, `function parsePrice(x) {…}`,
`function decodeEntities(s) {…}`, and `function isProductOffer(o) {…}`.

Leave every *call site* unchanged — the imported names are identical.

Note `compare-server.mjs` also has a `normDigits` used by `parsePrice`; keep
`normDigits` where it is, since other code in that file still calls it.

- [ ] **Step 6: Verify the rewire did not break the server**

```bash
node --test site/engine/*.test.mjs
SADKO_NO_SERVE=1 node -e "import('./site/compare-server.mjs').then(()=>console.log('compare-server parses OK')).catch(e=>{console.error('BROKEN:',e.message);process.exit(1)})"
```

Expected: all engine tests pass, and `compare-server parses OK`.

- [ ] **Step 7: Commit**

```bash
git add site/engine/offer-gate.mjs site/engine/offer-gate.test.mjs site/compare-server.mjs
git commit -m "refactor(engine): extract shared offer-sanity gate"
```

---

## Task 8: Product page extraction

**Files:**
- Create: `site/engine/extract.mjs`
- Test: `site/engine/extract.test.mjs`

**Interfaces:**
- Consumes: `parsePrice`, `decodeEntities`, `UI_TITLE`, `BAD_URL` from `./offer-gate.mjs` (Task 8a)
- Produces: `extractProduct(html: string, url: string) => {title, price, currency, inStock} | null`

**Context:** Reuse the JSON-LD walking approach already proven in `compare-server.mjs`. The sanity-gate rules live in `offer-gate.mjs` — import them, do **not** redefine them here.

- [ ] **Step 1: Write the failing test**

```js
// site/engine/extract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProduct } from './extract.mjs';

const LD = obj => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

test('reads schema.org Product JSON-LD', () => {
  const html = LD({ '@type': 'Product', name: 'شاشة شارب 75 بوصة 4K',
    offers: { '@type': 'Offer', price: '39699', priceCurrency: 'EGP', availability: 'https://schema.org/InStock' } });
  const p = extractProduct(html, 'https://s.com/product/1');
  assert.equal(p.title, 'شاشة شارب 75 بوصة 4K');
  assert.equal(p.price, 39699);
  assert.equal(p.inStock, true);
});

test('finds Product nested inside @graph', () => {
  const html = LD({ '@graph': [{ '@type': 'WebPage' },
    { '@type': 'Product', name: 'غسالة توشيبا 8 كيلو', offers: { price: 12079 } }] });
  assert.equal(extractProduct(html, 'https://s.com/product/2').price, 12079);
});

test('marks out-of-stock rather than dropping the product', () => {
  const html = LD({ '@type': 'Product', name: 'ثلاجة تورنيدو 395 لتر',
    offers: { price: 29179, availability: 'https://schema.org/OutOfStock' } });
  const p = extractProduct(html, 'https://s.com/product/3');
  assert.equal(p.inStock, false);
});

test('uses lowPrice when an AggregateOffer has no price', () => {
  const html = LD({ '@type': 'Product', name: 'ميكروويف فريش 36 لتر',
    offers: { '@type': 'AggregateOffer', lowPrice: 7549, highPrice: 7899 } });
  assert.equal(extractProduct(html, 'https://s.com/product/4').price, 7549);
});

test('returns null when no product data is present', () => {
  assert.equal(extractProduct('<html><body>nothing</body></html>', 'https://s.com/x'), null);
});

test('rejects UI chrome masquerading as a product title', () => {
  const html = LD({ '@type': 'Product', name: 'إضافة إلى السلة', offers: { price: 52405 } });
  assert.equal(extractProduct(html, 'https://s.com/?add-to-cart=3991'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/extract.test.mjs`
Expected: FAIL — `Cannot find module './extract.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/extract.mjs
/* Product page -> normalized record, via schema.org JSON-LD.
   The sanity gate is shared with the live adapters — see ./offer-gate.mjs.
   Without it, "add to cart" anchors and cart URLs get priced as products. */
import { UI_TITLE, BAD_URL, parsePrice, decodeEntities as decode } from './offer-gate.mjs';

export function extractProduct(html, url) {
  if (BAD_URL.test(url)) return null;
  let found = null;
  const walk = node => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (String(node['@type'] || '').toLowerCase() === 'product') {
      const offer = [].concat(node.offers || [])[0] || {};
      const price = parsePrice(offer.price ?? offer.lowPrice ?? node.price);
      if (price) {
        found = {
          title: decode(node.name),
          price,
          currency: offer.priceCurrency || 'EGP',
          inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(offer.availability || '')),
        };
        return;
      }
    }
    for (const k of ['@graph', 'itemListElement', 'mainEntity', 'item'])
      if (node[k]) walk(node[k]);
  };

  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch {}
    if (found) break;
  }
  if (!found) return null;
  if (!found.title || found.title.length < 8 || UI_TITLE.test(found.title)) return null;
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/extract.test.mjs`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add site/engine/extract.mjs site/engine/extract.test.mjs
git commit -m "feat(engine): JSON-LD product page extraction"
```

---

## Task 9: Crawler orchestration + Milestone-1 store list

**Files:**
- Create: `site/engine/stores-m1.mjs`
- Create: `site/engine/crawler.mjs`
- Test: `site/engine/crawler.test.mjs`

**Interfaces:**
- Consumes: `parseRobots`, `CRAWLER_UA` from `./robots.mjs`; `parseSitemap`, `isProductUrl` from `./sitemap.mjs`; `extractProduct` from `./extract.mjs`; `Catalog.upsertOffer`/`getCursor`/`setCursor` from `./catalog.mjs`
- Produces:
  - `M1_STORES: {domain, name, nameEn, tier, sitemapHint?}[]`
  - `crawlStore(catalog, store, {maxPages, fetchImpl}) => Promise<{domain, found, stored, skipped, errors}>`

- [ ] **Step 1: Write the failing test**

```js
// site/engine/crawler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { crawlStore } from './crawler.mjs';
import { M1_STORES } from './stores-m1.mjs';

const LD = (name, price) => `<html><script type="application/ld+json">${
  JSON.stringify({ '@type': 'Product', name, offers: { price } })}</script></html>`;

/* fake fetch: robots -> sitemap -> two product pages */
function fakeFetch(map) {
  return async url => {
    const key = Object.keys(map).find(k => url.includes(k));
    if (!key) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => map[key] };
  };
}

test('crawls robots -> sitemap -> product pages into the catalog', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url><url><loc>https://t.com/product/b</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/product/b': LD('غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', 12079),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 2);
  assert.equal(c.search('شارب').length, 1);
  assert.equal(c.search('توشيبا').length, 1);
  c.close();
});

test('respects robots Disallow', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow: /product/\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة', 39699),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 0);
  assert.ok(r.skipped >= 1);
  c.close();
});

test('a page that fails to parse does not abort the crawl', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset><url><loc>https://t.com/product/a</loc></url><url><loc>https://t.com/product/b</loc></url></urlset>',
    '/product/a': '<html>no json-ld here</html>',
    '/product/b': LD('غسالة توشيبا 8 كيلو AEW-8460SUP', 12079),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.stored, 1);
  c.close();
});

test('M1_STORES holds the 13 planned stores including SADKO', () => {
  assert.equal(M1_STORES.length, 13);
  assert.ok(M1_STORES.some(s => s.domain === 'sadko-group.com'));
  assert.ok(M1_STORES.some(s => s.domain === 'rayashop.com'));
});

/* Several real stores publish product URLs with no /product/ marker
   (elarabygroup uses a bare slug, egyptlaptop a category path). Filtering on
   URL shape alone would silently crawl NOTHING from them, so the crawler must
   fall back to plain sitemap URLs and let extractProduct arbitrate. */
test('a sitemap with no product-shaped URLs falls back instead of crawling nothing', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    // bare-slug product URLs, exactly like elarabygroup's real sitemap
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/ar/tornado-electric-water-heater-30-l-teee-30d1w</loc></url>' +
      '<url><loc>https://t.com/ar/tornado-electric-water-heater-40-l-teee-40d1w</loc></url></urlset>',
    '/ar/tornado-electric-water-heater-30-l': LD('سخان تورنيدو 30 لتر ديجيتال TEEE-30D1W', 4999),
    '/ar/tornado-electric-water-heater-40-l': LD('سخان تورنيدو 40 لتر ديجيتال TEEE-40D1W', 5499),
  });
  const r = await crawlStore(c, { domain: 't.com', name: 'T' }, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.usedFallback, true, 'must report that it fell back');
  assert.equal(r.stored, 2, 'both bare-slug products must be stored');
  c.close();
});

test('store.productUrl overrides the generic URL heuristic', async () => {
  const c = openCatalog();
  const fetchImpl = fakeFetch({
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/catalog/sku-123</loc></url>' +
      '<url><loc>https://t.com/about</loc></url></urlset>',
    '/catalog/sku-123': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/about': '<html>no product</html>',
  });
  const store = { domain: 't.com', name: 'T', productUrl: /\/catalog\/sku-/ };
  const r = await crawlStore(c, store, { maxPages: 10, fetchImpl, delayMs: 0 });
  assert.equal(r.shapedUrls, 1, 'only the catalog URL matches the override');
  assert.equal(r.stored, 1);
  c.close();
});

test('an interrupted crawl resumes from its cursor instead of restarting', async () => {
  const c = openCatalog();
  const pages = {
    'robots.txt': 'User-agent: *\nDisallow:\nSitemap: https://t.com/sitemap.xml',
    'sitemap.xml': '<urlset>' +
      '<url><loc>https://t.com/product/a</loc></url>' +
      '<url><loc>https://t.com/product/b</loc></url>' +
      '<url><loc>https://t.com/product/c</loc></url></urlset>',
    '/product/a': LD('شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', 39699),
    '/product/b': LD('غسالة توشيبا 8 كيلو اتوماتيك AEW-8460SUP', 12079),
    '/product/c': LD('ثلاجة تورنيدو 355 لتر RF-40FTV-BK', 22269),
  };
  const store = { domain: 't.com', name: 'T' };
  // first run stops after 2 product pages
  const r1 = await crawlStore(c, store, { maxPages: 2, fetchImpl: fakeFetch(pages), delayMs: 0 });
  assert.equal(r1.stored, 2);
  assert.equal(c.getCursor('t.com'), 2);

  // second run picks up at index 2 and fetches only the remaining page
  const fetched = [];
  const spy = async (url, o) => { fetched.push(url); return fakeFetch(pages)(url, o); };
  const r2 = await crawlStore(c, store, { maxPages: 10, fetchImpl: spy, delayMs: 0 });
  assert.equal(r2.stored, 1, 'only the unvisited page should be stored');
  assert.ok(!fetched.some(u => u.includes('/product/a')), 'must not refetch page a');
  c.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/crawler.test.mjs`
Expected: FAIL — `Cannot find module './stores-m1.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/stores-m1.mjs
/* Milestone-1 stores: SADKO's own catalog plus the 12 highest-value sitemap
   stores measured by scripts/probe-sitemaps.mjs (94,482 product URLs total).
   rayashop / amanstores / egyptlaptop / awadserag are included DELIBERATELY —
   their live search is broken, so indexing rescuing them is the proof the
   architecture works. */
/* The URL counts below come from scripts/probe-sitemaps.mjs, which counted ALL
   <loc> entries. Spot-checking the real sitemaps showed some of those are
   navigation, not products — rayashop's sitemap.xml is a CATEGORY sitemap
   (/en/electronics, /en/laptops/laptops-pcs), so its 22,076 is not 22,076
   products. Treat these as an upper bound on reachable URLs, not a product
   count. Task 10 measures the real yield per store.

   sitemapHint  — substring selecting the right child of a sitemap index
   productUrl   — RegExp replacing the generic isProductUrl heuristic         */
export const M1_STORES = [
  { domain: 'sadko-group.com', name: 'صادكو جروب', nameEn: 'SADKO Group', tier: 1, local: true },
  { domain: 'hyper-techno.com',name: 'هايبر تكنو', nameEn: 'Hyper Techno',tier: 3 },  // 17,333 · /product/ ✓
  { domain: 'jumia.com.eg',    name: 'جوميا',      nameEn: 'Jumia',       tier: 1 },  // 10,000
  { domain: '2b.com.eg',       name: '2B مصر',     nameEn: '2B Egypt',    tier: 1 },  //  7,611
  { domain: 'btech.com',       name: 'بى تك',      nameEn: 'B.TECH',      tier: 1 },  //  7,205 · /ar/p/ ✓
  // bare-slug product URLs — no marker; relies on the fallback path
  { domain: 'elarabygroup.com',name: 'العربى جروب',nameEn: 'ElAraby',     tier: 1 },  //  6,369
  // sitemap index exposes products1.xml; URLs are category-path style
  { domain: 'egyptlaptop.com', name: 'إيجيبت لابتوب', nameEn: 'Egypt Laptop', tier: 2,
    sitemapHint: 'products' },                                                        //  6,193
  { domain: 'elghazawy.com',   name: 'الغزاوى',    nameEn: 'ElGhazawy',   tier: 2 },  //  6,179 · /ar/product/ ✓
  { domain: 'amanstores.com',  name: 'أمان',       nameEn: 'Aman Stores', tier: 1 },  //  4,885 · /product/view/ ✓
  { domain: 'awadserag.com',   name: 'عوض سراج',   nameEn: 'Awad Serag',  tier: 3 },  //  2,675
  { domain: 'kenzz.com',       name: 'كنز',        nameEn: 'Kenzz',       tier: 2 },  //  2,064
  { domain: 'egypt.sharafdg.com', name: 'شرف دى جى', nameEn: 'Sharaf DG', tier: 1 },  //  1,892 · /product/ ✓
  // sitemap.xml here lists CATEGORIES, not products. Kept in the set so Task 10
  // measures it honestly; if it yields no products, it needs category-pagination
  // crawling, which is Milestone 2.
  { domain: 'rayashop.com',    name: 'راية شوب',   nameEn: 'Raya Shop',   tier: 1 },
];
```

```js
// site/engine/crawler.mjs
/* Crawl one store: robots -> sitemap -> product pages -> catalog.
   fetchImpl is injectable so tests run with no network. */
import { parseRobots, CRAWLER_UA } from './robots.mjs';
import { parseSitemap, isProductUrl } from './sitemap.mjs';
import { extractProduct } from './extract.mjs';

const DEFAULT_DELAY = 1000;   // polite floor when robots declares none

export async function crawlStore(catalog, store, opts = {}) {
  const {
    maxPages = 500,        // product pages FETCHED this run
    sitemapMax = 20000,    // product URLs COLLECTED from sitemaps (independent —
                           // the full list must be known for the cursor to mean
                           // anything across runs)
    fetchImpl = fetch,
    delayMs = null,
    onProgress = () => {},
  } = opts;

  const domain = store.domain;
  const res = { domain, found: 0, stored: 0, skipped: 0, errors: 0 };
  const get = async url => {
    const r = await fetchImpl(url, { headers: { 'user-agent': CRAWLER_UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  };

  // 1. robots
  let robots;
  try { robots = parseRobots(await get(`https://${domain}/robots.txt`)); }
  catch { robots = parseRobots(''); }
  const wait = delayMs !== null ? delayMs
    : Math.max((robots.crawlDelay || 0) * 1000, DEFAULT_DELAY);

  // 2. sitemaps
  //
  // URL SHAPE IS A HINT, NOT A GATE. Measured against the real Milestone-1
  // stores, several publish product URLs with no conventional marker:
  //   elarabygroup  /ar/tornado-electric-water-heater-30-l-...-teee-30d1w
  //   egyptlaptop   /point-of-sale/barcode-scanners/datalogic-qw2100-...
  // Filtering on `isProductUrl` alone would discard those stores entirely.
  // So: prefer product-shaped URLs when a sitemap has them, but when a sitemap
  // yields NONE, fall back to its plain URLs and let extractProduct decide —
  // JSON-LD presence is a far better product signal than URL shape.
  //
  // A store may override discovery via `store.sitemapHint` (a substring that
  // selects the right child of a sitemap index, e.g. 'products') and
  // `store.productUrl` (a RegExp replacing the generic heuristic).
  const smUrls = robots.sitemaps.length ? robots.sitemaps
    : [`https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap.xml`];
  const isProduct = store.productUrl ? (u => store.productUrl.test(u)) : isProductUrl;
  const shaped = [], plain = [];
  const queue = [...smUrls];
  const seenSm = new Set();
  while (queue.length && shaped.length < sitemapMax) {
    const sm = queue.shift();
    if (seenSm.has(sm)) continue;
    seenSm.add(sm);
    let parsed;
    try { parsed = parseSitemap(await get(sm)); } catch { res.errors++; continue; }
    if (parsed.isIndex) {
      // follow product-looking children first; store.sitemapHint wins if set
      const hint = store.sitemapHint;
      const children = parsed.urls.slice().sort((a, b) => {
        const score = u => (hint && u.includes(hint) ? 2 : /product|item|shop/i.test(u) ? 1 : 0);
        return score(b) - score(a);
      });
      queue.push(...children.slice(0, 20));
    } else {
      for (const u of parsed.urls) {
        if (shaped.length >= sitemapMax) break;
        if (isProduct(u)) shaped.push(u);
        else if (plain.length < sitemapMax) plain.push(u);
      }
    }
  }
  // fall back to unshaped URLs rather than crawling nothing
  const productUrls = shaped.length ? shaped : plain;
  res.found = productUrls.length;
  res.shapedUrls = shaped.length;
  res.usedFallback = !shaped.length && plain.length > 0;
  if (res.usedFallback)
    onProgress({ ...res, note: `${domain}: no product-shaped URLs; falling back to ${plain.length} plain URLs` });

  // 3. product pages — resume from the stored cursor so an interrupted run
  //    continues instead of refetching everything. Sitemap order is stable.
  const start = catalog.getCursor(domain);
  let i = start;
  const end = Math.min(productUrls.length, start + maxPages);
  for (; i < end; i++) {
    const url = productUrls[i];
    let path;
    try { path = new URL(url).pathname; } catch { res.skipped++; continue; }
    if (!robots.allowed(path)) { res.skipped++; continue; }
    try {
      const html = await get(url);
      const p = extractProduct(html, url);
      if (!p) { res.skipped++; }
      else {
        catalog.upsertOffer({ domain, url, title: p.title, price: p.price,
          currency: p.currency, inStock: p.inStock });
        res.stored++;
      }
    } catch { res.errors++; }
    onProgress(res);
    if (wait) await new Promise(r => setTimeout(r, wait));
  }
  // a completed pass resets to 0 so the next run re-checks prices from the top
  catalog.setCursor(domain, i >= productUrls.length ? 0 : i);
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/crawler.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Run the whole engine suite**

Run: `node --test site/engine/*.test.mjs`
Expected: PASS — all tests from Tasks 1-9

- [ ] **Step 6: Commit**

```bash
git add site/engine/crawler.mjs site/engine/stores-m1.mjs site/engine/crawler.test.mjs
git commit -m "feat(engine): robots-aware crawler and Milestone-1 store list"
```

---

## Task 10: Live crawl smoke test against 2 real stores

**Files:**
- Create: `scripts/crawl-m1.mjs`

**Interfaces:**
- Consumes: `M1_STORES`, `crawlStore`, `openCatalog`
- Produces: CLI — `node scripts/crawl-m1.mjs [--only domain] [--max N]`, writes `site/data/catalog.db`

This is the first task that touches the network. It is deliberately capped.

- [ ] **Step 1: Write the crawl runner**

```js
// scripts/crawl-m1.mjs
/* Crawl Milestone-1 stores into site/data/catalog.db.
   Politeness is non-negotiable: robots.txt is honoured inside crawlStore and
   --max caps pages per store. Start small; raise --max only once a store's
   extraction rate looks correct. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalog } from '../site/engine/catalog.mjs';
import { crawlStore } from '../site/engine/crawler.mjs';
import { M1_STORES } from '../site/engine/stores-m1.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const only = arg('--only');
const max = +(arg('--max') || 50);

const catalog = openCatalog(path.join(ROOT, 'site', 'data', 'catalog.db'));
const stores = M1_STORES.filter(s => !s.local && (!only || s.domain === only));

console.log(`crawling ${stores.length} store(s), max ${max} pages each\n`);
for (const s of stores) {
  const t0 = Date.now();
  const r = await crawlStore(catalog, s, { maxPages: max });
  console.log(`${r.domain.padEnd(24)} found=${String(r.found).padEnd(6)} stored=${String(r.stored).padEnd(6)}` +
    ` skipped=${String(r.skipped).padEnd(6)} errors=${r.errors}  ${Math.round((Date.now() - t0) / 1000)}s`);
}
const total = catalog.db.prepare('SELECT COUNT(*) n FROM offers').get().n;
const prods = catalog.db.prepare('SELECT COUNT(*) n FROM products').get().n;
console.log(`\ncatalog: ${total} offers across ${prods} distinct products`);
catalog.close();
```

- [ ] **Step 2: Crawl one store, small cap**

Run: `node scripts/crawl-m1.mjs --only 2b.com.eg --max 30`
Expected: `stored` > 0. If `stored` is 0 but `found` > 0, the store's product pages lack JSON-LD — record which store, and note it for a Milestone-2 fallback extractor. **Do not** loosen `extractProduct`'s sanity gate to force a number up.

- [ ] **Step 3: Crawl a second store to confirm generality**

Run: `node scripts/crawl-m1.mjs --only elarabygroup.com --max 30`
Expected: `stored` > 0.

- [ ] **Step 4: Inspect what landed**

```bash
node -e "
const {openCatalog}=await import('./site/engine/catalog.mjs');
const c=openCatalog('./site/data/catalog.db');
for(const r of c.db.prepare('SELECT domain,price,title_raw FROM offers LIMIT 10').all())
  console.log(r.domain, r.price, r.title_raw.slice(0,60));
c.close();
" --input-type=module
```

Expected: real product titles with plausible EGP prices — not nav labels, not "add to cart".

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl-m1.mjs
git commit -m "feat(scripts): Milestone-1 crawl runner"
```

---

## Task 11: Serve from catalog with live top-10 verification

**Files:**
- Create: `site/engine/serve.mjs`
- Modify: `site/compare-server.mjs` — add a catalog-backed branch in `compare()`
- Test: `site/engine/serve.test.mjs`

**Interfaces:**
- Consumes: `openCatalog`, `identify`, `sameProduct`
- Produces: `rankOffers(catalog, query, {verify}) => Promise<{results, cheapest, stats}>`
  - `results[]`: `{domain, url, title, price, confidence, verified, checkedAt, rank?}`
  - `verify(offer) => Promise<number|null>` — injectable live price re-check

- [ ] **Step 1: Write the failing test**

```js
// site/engine/serve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCatalog } from './catalog.mjs';
import { rankOffers } from './serve.mjs';

function seeded() {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 41000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2',
    title: 'شاشة شارب 4K سمارت 75 بوصة 4T-C75FN6EX', price: 39699 });
  c.upsertOffer({ domain: 'c.com', url: 'https://c.com/3',
    title: 'شاشة شارب 65 بوصة 4K سمارت 4T-C65FN6EX', price: 28000 });
  return c;
}

test('ranks cheapest first and never crowns a different-size TV', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K', { verify: async () => null });
  assert.equal(r.cheapest.price, 39699, 'the 65-inch at 28000 must not win');
  assert.equal(r.cheapest.domain, 'b.com');
  c.close();
});

test('live verification overrides the indexed price', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شاشة شارب 75 بوصة 4K',
    { verify: async o => (o.domain === 'b.com' ? 45000 : null) });
  const b = r.results.find(x => x.domain === 'b.com');
  assert.equal(b.price, 45000);
  assert.equal(b.verified, true);
  assert.equal(r.cheapest.domain, 'a.com', 're-verification must re-order the ranking');
  c.close();
});

test('unverified offers are still returned, marked unverified', async () => {
  const c = seeded();
  const r = await rankOffers(c, 'شارب', { verify: async () => null, verifyTop: 0 });
  assert.ok(r.results.length >= 3);
  assert.ok(r.results.every(x => x.verified === false));
  c.close();
});

test('an empty query returns no results rather than throwing', async () => {
  const c = seeded();
  const r = await rankOffers(c, '', { verify: async () => null });
  assert.deepEqual(r.results, []);
  assert.equal(r.cheapest, null);
  c.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/serve.test.mjs`
Expected: FAIL — `Cannot find module './serve.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// site/engine/serve.mjs
/* Catalog search -> identity grouping -> live verification -> ranking.
   Ranking is DETERMINISTIC: price decides, identity confidence gates who may be
   crowned. Only 'exact'/'strong' offers can take rank 1. */
import { identify, sameProduct } from './matcher.mjs';

export async function rankOffers(catalog, query, opts = {}) {
  const { verify = async () => null, verifyTop = 10, limit = 200 } = opts;
  const rows = catalog.search(query, limit);
  if (!rows.length) return { results: [], cheapest: null, stats: { candidates: 0, verified: 0 } };

  // keep only offers whose identity is compatible with the query's identity
  const want = identify(query);
  const scored = [];
  for (const r of rows) {
    const got = identify(r.title_raw);
    const m = sameProduct(want, got);
    // when the query itself is under-specified (no brand/category), fall back to
    // FTS relevance and mark the offer weak rather than discarding everything
    const confidence = m.same ? m.confidence : (want.brand || want.category ? null : 'weak');
    if (!confidence) continue;
    scored.push({ ...r, confidence });
  }

  scored.sort((a, b) => a.price - b.price);

  // live re-verify only the cheapest N
  let verified = 0;
  await Promise.all(scored.slice(0, verifyTop).map(async o => {
    try {
      const fresh = await verify(o);
      if (typeof fresh === 'number' && fresh > 0) { o.price = fresh; o.verifiedFlag = true; verified++; }
    } catch {}
  }));
  scored.sort((a, b) => a.price - b.price);

  const results = scored.map(o => ({
    domain: o.domain, url: o.url, title: o.title_raw, price: o.price,
    currency: o.currency || 'EGP', confidence: o.confidence,
    verified: !!o.verifiedFlag, checkedAt: o.last_checked,
  }));

  let rank = 0;
  for (const r of results)
    if ((r.confidence === 'exact' || r.confidence === 'strong') && rank < 5) r.rank = ++rank;

  return {
    results,
    cheapest: results.find(r => r.rank === 1) || null,
    stats: { candidates: rows.length, matched: results.length, verified },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/serve.test.mjs`
Expected: PASS — 4 tests

- [ ] **Step 5: Wire into the server**

In `site/compare-server.mjs`, add near the other imports:

```js
import { openCatalog } from './engine/catalog.mjs';
import { rankOffers } from './engine/serve.mjs';
```

Add after the `INDEX_FILE` declaration:

```js
/* Catalog path: when site/data/catalog.db exists we answer from the crawled
   catalog and fall back to live fan-out only when it returns nothing. */
const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.db');
let CATALOG = null;
function catalog() {
  if (CATALOG === null) CATALOG = existsSync(CATALOG_FILE) ? openCatalog(CATALOG_FILE) : false;
  return CATALOG;
}
/* live re-check of one offer: refetch its product page and lift JSON-LD */
async function verifyOffer(o) {
  try {
    const html = await fetchPage(o.url, 'text/html', 8000);
    const items = jsonLdProducts(html, o.domain);
    return items[0]?.price || null;
  } catch { return null; }
}
```

Then at the top of `compare()`, before the existing index lookup:

```js
  const cat = catalog();
  if (cat) {
    const r = await rankOffers(cat, q, { verify: verifyOffer, verifyTop: 10 });
    if (r.results.length) {
      const filtered = r.results.filter(x => (!min || x.price >= min) && (!max || x.price <= max));
      return {
        mode: 'catalog', query: q,
        results: filtered.map(x => ({
          store: x.domain, domain: x.domain, type: 'local', title: x.title,
          price: x.price, effectivePrice: x.price, currency: x.currency, url: x.url,
          checkedAt: x.checkedAt, flags: x.confidence === 'weak' ? ['variant'] : [],
          rank: x.rank, verified: x.verified,
        })),
        cheapest: r.cheapest, concierge: null, refreshing: false,
        stats: { ...r.stats, src: 'catalog', headless: headlessAvailable(), ai: !!NVIDIA_KEY },
        links: storeLinks(q, lang),
      };
    }
  }
```

- [ ] **Step 6: Verify the server still starts and the catalog path answers**

```bash
PORT=8096 node --env-file-if-exists=site/.env site/compare-server.mjs &
sleep 8
curl -s "http://localhost:8096/api/compare?q=$(node -e "process.stdout.write(encodeURIComponent('شارب'))")&discover=0" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('mode:',j.mode,'| results:',j.results.length,'| cheapest:',j.cheapest&&j.cheapest.price)})"
```

Expected: `mode: catalog` with a non-zero result count.

- [ ] **Step 7: Commit**

```bash
git add site/engine/serve.mjs site/engine/serve.test.mjs site/compare-server.mjs
git commit -m "feat(engine): catalog-backed search with live top-10 verification"
```

---

## Task 11a: Query-interpretation UI ("did we understand you?")

**Files:**
- Modify: `site/engine/serve.mjs` — return the parsed interpretation and accept overrides
- Modify: `site/compare-server.mjs` — pass `cat`/`spec` query params through, expose `interpretation` in the response
- Modify: `site/compare.html` — add the interpretation bar markup
- Modify: `site/assets/js/compare.js` — render chips, handle edits, re-run
- Test: `site/engine/serve.test.mjs` (extend)

**Interfaces:**
- Consumes: `identify` from `./matcher.mjs`; `CATEGORIES` from `./categories.mjs`
- Produces (extends `rankOffers`'s return): `interpretation: {category, brand, model, units, specs, ambiguous, alternatives}`
- `rankOffers(catalog, query, {verify, verifyTop, limit, override})` — `override` is `{category?, units?, specs?}`; any field present REPLACES the parsed value and is treated as a hard filter.

**Why:** the engine already parses every query into category + units + specs via
`identify()`. Today that reasoning is invisible: the shopper types «غسالة ٧ كيلو»
and gets results with no indication of what the engine actually searched for.
Surfacing it turns a silent guess into a confirmable one — and because a
confirmed category selects which attributes are *identity-defining*, a single
correction measurably improves match precision. It also rescues the ~11% of
titles `detectCategory` cannot classify: the shopper simply tells us.

**UX shape** — a bar directly beneath the search row, before results:

```
بندوّر على:  [ غسالة ▾ ]  [ 7 كيلو ✕ ]  [ توشيبا ✕ ]  [ + مواصفة ]
             ^ dropdown     ^ removable chips relax the filter
```

- Each parsed attribute renders as a removable chip. Removing one relaxes it
  from a hard filter to unknown, widening results.
- Category renders as a `<select>` populated from `CATEGORIES`, so a wrong or
  missing detection is one click to fix.
- When `ambiguous` is true (no category detected, or the leading token matched
  two categories within 3 characters of each other), show the bar in a prompting
  state with `alternatives` offered, rather than silently guessing.
- Any change re-runs the search with overrides in the query string.
- Must respect the page's existing i18n: strings go through the `T` table in
  `compare.js` with `data-i18n` attributes, Arabic default, English when
  `lang=en`.

- [ ] **Step 1: Write the failing test**

```js
// append to site/engine/serve.test.mjs
import { CATEGORIES } from './categories.mjs';

test('rankOffers reports how it interpreted the query', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'غسالة توشيبا 7 كيلو اتوماتيك فتحة علوية', price: 11000 });
  const r = await rankOffers(c, 'غسالة توشيبا 7 كيلو', { verify: async () => null });
  assert.equal(r.interpretation.category, 'washer');
  assert.equal(r.interpretation.brand, 'toshiba');
  assert.equal(r.interpretation.units.kg, 7);
  assert.equal(r.interpretation.ambiguous, false);
  c.close();
});

test('an unrecognised category is reported ambiguous with alternatives', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'كبة فريش 400 وات 1.5 لتر', price: 2200 });
  const r = await rankOffers(c, 'كبة فريش 400 وات', { verify: async () => null });
  assert.equal(r.interpretation.ambiguous, true);
  assert.ok(Array.isArray(r.interpretation.alternatives));
  c.close();
});

test('a category override is applied as a hard filter', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1',
    title: 'غسالة توشيبا 7 كيلو اتوماتيك', price: 11000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2',
    title: 'غسالة اطباق بوش 12 فرد', price: 18000 });
  const r = await rankOffers(c, 'غسالة', {
    verify: async () => null, override: { category: 'dishwasher' } });
  assert.equal(r.interpretation.category, 'dishwasher');
  assert.ok(r.results.every(x => !x.title.includes('7 كيلو')),
    'washer offers must be filtered out when the shopper says dishwasher');
  c.close();
});

test('removing a unit override widens the result set', async () => {
  const c = openCatalog();
  c.upsertOffer({ domain: 'a.com', url: 'https://a.com/1', title: 'غسالة توشيبا 7 كيلو', price: 11000 });
  c.upsertOffer({ domain: 'b.com', url: 'https://b.com/2', title: 'غسالة توشيبا 9 كيلو', price: 13000 });
  const narrow = await rankOffers(c, 'غسالة توشيبا 7 كيلو', { verify: async () => null });
  const wide = await rankOffers(c, 'غسالة توشيبا 7 كيلو', {
    verify: async () => null, override: { units: {} } });
  assert.ok(wide.results.length > narrow.results.length,
    'clearing the kg filter must return both capacities');
  c.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test site/engine/serve.test.mjs`
Expected: FAIL — `r.interpretation is undefined`

- [ ] **Step 3: Extend `rankOffers` in `site/engine/serve.mjs`**

Add `override` support and an `interpretation` block. Build the effective
identity by starting from `identify(query)` and replacing any field present in
`override`. Compute `ambiguous` as `!effective.category`. Compute
`alternatives` as the category keys whose names appear anywhere in the
normalized query, or — when none do — the 6 most common categories
(`fridge`, `washer`, `tv`, `ac`, `microwave`, `cooker`) as a starting menu.
Return:

```js
interpretation: {
  category: effective.category,
  brand: effective.brand,
  model: effective.model,
  units: effective.units,
  specs: effective.specs,
  ambiguous,
  alternatives,
}
```

Keep every existing return field unchanged — `results`, `cheapest`, `stats`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test site/engine/serve.test.mjs`
Expected: PASS

- [ ] **Step 5: Thread overrides through the HTTP layer**

In `site/compare-server.mjs`, in the catalog branch of `compare()`, read
`cat` and any `u_<unit>` / `s_<spec>` query params into an `override` object and
pass it to `rankOffers`. Include `interpretation` in the JSON response.
An explicitly empty param (`u_kg=`) means "cleared", not "absent".

- [ ] **Step 6: Add the interpretation bar to the page**

In `site/compare.html`, directly after the `.filters` div inside `.search-card`:

```html
<div class="interp" id="interp" style="display:none">
  <span class="interp__label" data-i18n="interpLabel">بندوّر على:</span>
  <select id="interpCat" class="interp__cat"></select>
  <span id="interpChips" class="interp__chips"></span>
</div>
```

In `site/assets/js/compare.js`:
- add `interpLabel`, `interpAsk`, and category display names to BOTH the Arabic
  and English `T` tables — follow the existing table's shape exactly
- after a successful response, populate `#interpCat` from
  `data.interpretation.alternatives` (or the full category list) and render one
  removable chip per unit and spec
- when `data.interpretation.ambiguous` is true, add an `interp--ask` class and
  show the `interpAsk` prompt instead of the plain label
- changing the select or removing a chip re-runs `run()` with the override
  params appended
- style the bar in `site/assets/css/site.css`, matching the existing
  `.search-card` / `.filters` visual language — reuse existing custom properties
  and spacing rather than introducing a new palette

- [ ] **Step 7: Verify in the real page**

```bash
PORT=8095 node --env-file-if-exists=site/.env site/compare-server.mjs &
sleep 8
curl -s "http://localhost:8095/api/compare?q=$(node -e "process.stdout.write(encodeURIComponent('غسالة توشيبا 7 كيلو'))")&discover=0" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('interpretation:',JSON.stringify(j.interpretation))})"
```

Expected: an `interpretation` object naming category `washer`, brand `toshiba`,
and `units.kg` 7. Then load `http://localhost:8095/compare.html` in a browser,
search the same phrase, and confirm the bar renders, the category dropdown
changes results, and removing the `7 كيلو` chip widens them.

- [ ] **Step 8: Commit**

```bash
git add site/engine/serve.mjs site/engine/serve.test.mjs site/compare-server.mjs \
        site/compare.html site/assets/js/compare.js site/assets/css/site.css
git commit -m "feat(ui): confirmable query interpretation on the compare page"
```

---

## Task 12: Benchmark against the live-fanout baseline

**Files:**
- Create: `scripts/bench-catalog.mjs`

The spec's success metric is **measured, not asserted**. This script produces the number.

- [ ] **Step 1: Write the benchmark**

```js
// scripts/bench-catalog.mjs
/* Milestone-1 success metric: catalog path vs live fan-out, across >=6
   appliance categories. Prints offers-per-query and latency for both. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.SADKO_NO_SERVE = '1';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { openCatalog } = await import('../site/engine/catalog.mjs');
const { rankOffers } = await import('../site/engine/serve.mjs');
const engine = await import('../site/compare-server.mjs');

const QUERIES = [
  'شاشة شارب 75 بوصة 4K سمارت',
  'غسالة توشيبا 8 كيلو اتوماتيك',
  'ثلاجة تورنيدو نوفروست 355 لتر',
  'تكييف شارب 2.25 حصان انفرتر',
  'ميكروويف فريش 36 لتر',
  'بوتاجاز لاجيرمانيا 5 شعلة',
  'قلاية هوائية بيكو',
  'سخان كهربائي',
];

const catalog = openCatalog(path.join(ROOT, 'site', 'data', 'catalog.db'));
const reg = await engine.loadRegistry();
const live = reg.stores.filter(s => (s.t || 3) <= 2);

console.log('query'.padEnd(36), 'catalog', 'ms', '  live', 'ms');
let cSum = 0, lSum = 0;
for (const q of QUERIES) {
  const t0 = Date.now();
  const r = await rankOffers(catalog, q, { verify: async () => null });
  const cMs = Date.now() - t0;

  const t1 = Date.now();
  const results = await Promise.all(live.map(s =>
    engine.searchStore(s, q, [q]).catch(() => ({ items: [] }))));
  const lN = results.reduce((n, w) => n + (w.items?.length || 0), 0);
  const lMs = Date.now() - t1;

  cSum += r.results.length; lSum += lN;
  console.log(q.padEnd(36), String(r.results.length).padStart(6), String(cMs).padStart(5),
    String(lN).padStart(6), String(lMs).padStart(5));
}
console.log(`\nTOTAL offers  catalog=${cSum}  live=${lSum}  ratio=${lSum ? (cSum / lSum).toFixed(2) : 'n/a'}x`);
console.log('Target: ratio >= 3.0 and catalog latency < 3000ms');
catalog.close();
process.exit(0);
```

- [ ] **Step 2: Run it**

Run: `node scripts/bench-catalog.mjs`
Expected: a table plus a ratio line.

**Report the real number even if it misses the target.** A ratio below 3.0 after only a capped crawl is expected and is information about crawl depth, not a reason to change the metric.

- [ ] **Step 3: Commit**

```bash
git add scripts/bench-catalog.mjs
git commit -m "feat(scripts): catalog vs live-fanout benchmark"
```

---

## Definition of Done

- [ ] `node --test site/engine/*.test.mjs` passes — all tasks 1-11
- [ ] `node scripts/crawl-m1.mjs --max 50` populates `site/data/catalog.db` for ≥2 stores
- [ ] `node scripts/bench-catalog.mjs` prints a real, reported ratio
- [ ] Server responds with `mode: catalog`
- [ ] `git log` shows one commit per task
- [ ] `site/.env` still untracked: `git check-ignore -v site/.env` succeeds

## Known Milestone-2 work (explicitly out of scope)

- Stores whose product pages carry no JSON-LD need a microdata/DOM fallback extractor.
- Category-pagination crawling for the 51 stores with no usable sitemap.
- Aggregator ingestion (`egprices.com`, `eg.labeb.com`, `pricena.com` — all robots-permitted; `SKIP_DOMAINS` currently blocks `pricena` and must be updated).
- Scheduled re-crawl and stale-offer pruning.
- The 4 sitemap-less live-search stores (`raneen`, `amazon.eg`, `noon`, `carrefouregypt`) continue on live adapters.

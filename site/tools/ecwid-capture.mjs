/* ============================================================================
   Ecwid connection check, fixture capture, and catalogue survey.
   Implementation plan Task 1, expanded per revision 2 of the design.

   Run from site/:
     node tools/ecwid-capture.mjs --check     what the credentials look like, and
                                              whether the API answers at all
     node tools/ecwid-capture.mjs --capture   write real payloads to
                                              engine/fixtures/ as test fixtures
     node tools/ecwid-capture.mjs --survey    page the whole catalogue and answer
                                              the open questions from DATA:
                                              variations, weights, was-prices,
                                              ribbons, brand/SKU fill rates
     node tools/ecwid-capture.mjs --all       all three, in that order

   The token is never printed, logged or written to a file. Customer identity in
   captured order payloads and in the store profile is scrubbed BEFORE anything
   touches the disk, because fixtures get committed.
   ========================================================================== */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ecwidEnv, describeEnv } from './ecwid-env.mjs';

const OUT = path.join(import.meta.dirname, '..', 'engine', 'fixtures');
const env = ecwidEnv();
const BASE = `https://app.ecwid.com/api/v3/${env.storeId}`;

const args = process.argv.slice(2);
const want = {
  check: args.includes('--check') || args.includes('--all') || args.length === 0,
  capture: args.includes('--capture') || args.includes('--all'),
  survey: args.includes('--survey') || args.includes('--all'),
};

/* ---------------------------------------------------------------- transport */

async function call(pathAndQuery, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + pathAndQuery, {
    method,
    headers: {
      Authorization: `Bearer ${env.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Deliberately quotes the response, never the request headers.
    const e = new Error(`${method} ${pathAndQuery} -> ${res.status}: ${text.slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  try { return text ? JSON.parse(text) : null; }
  catch { throw new Error(`${pathAndQuery} returned ${res.status} but not JSON`); }
}

/* --------------------------------------------------------------- scrubbing */

/* Any field that could carry a real person's identity. Fixtures are committed,
   so this runs before the write, not after. */
const FAKE = {
  email: 'test@example.com', name: 'عميل تجريبي', phone: '+200000000000',
  firstName: 'عميل', lastName: 'تجريبي', companyName: 'SADKO test',
  street: 'شارع تجريبي', city: 'القاهرة', postalCode: '00000',
  ownerEmail: 'test@example.com', accountEmail: 'test@example.com',
  accountName: 'SADKO test', ip: '0.0.0.0', customerId: 0,
};
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = k in FAKE ? FAKE[k] : scrub(x);
    return out;
  }
  return v;
}

function write(name, data) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(`  wrote engine/fixtures/${name}`);
}

/* ------------------------------------------------------------------- check */

async function check() {
  console.log('=== credentials ===');
  console.log(describeEnv(env));
  if (!env.hasToken) { console.log('\nNo token — stopping here.'); process.exit(1); }

  console.log('\n=== does the API answer? ===');
  try {
    const page = await call('/products?limit=1');
    console.log(`products      OK — ${page.total} in the store`);
  } catch (e) {
    console.error(`products      FAILED — ${e.message}`);
    if (e.status === 403) {
      console.error('\nA 403 means one of three things:');
      console.error('  · the token is wrong or was revoked');
      console.error('  · the custom app was not given catalogue read access');
      console.error("  · the token belongs to a different store than " + env.storeId);
    }
    process.exit(1);
  }

  for (const [label, p] of [['categories', '/categories?limit=1'], ['orders', '/orders?limit=1'], ['profile', '/profile']]) {
    try {
      const r = await call(p);
      const n = r && r.total != null ? ` — ${r.total}` : '';
      console.log(`${label.padEnd(13)} OK${n}`);
    } catch (e) {
      console.log(`${label.padEnd(13)} no access — ${e.status || ''} ${String(e.message).slice(0, 90)}`);
    }
  }
  console.log('\nOK');
}

/* ----------------------------------------------------------------- capture */

async function capture() {
  console.log('\n=== capturing fixtures ===');

  const products = await call('/products?limit=1');
  const product = products.items && products.items[0];
  if (!product) { console.log('  the store has no products — nothing to capture'); return; }
  write('ecwid-product.json', product);
  console.log(`    product ${product.id} — fields: ${Object.keys(product).join(', ')}`);

  const cats = await call('/categories?limit=1');
  if (cats.items && cats.items[0]) {
    write('ecwid-category.json', cats.items[0]);
    console.log(`    category ${cats.items[0].id} — fields: ${Object.keys(cats.items[0]).join(', ')}`);
  }

  /* Store profile carries the configured payment and shipping methods, which
     revision 2 needs in order to replace the hard-coded payment list. Scrubbed,
     because a profile also carries the account owner's details. */
  try {
    const profile = await call('/profile');
    write('ecwid-profile.json', scrub(profile));
    const pay = (profile.payment && profile.payment.paymentOptions) || profile.paymentOptions || [];
    const ship = (profile.shipping && profile.shipping.shippingOptions) || profile.shippingOptions || [];
    console.log(`    profile — ${pay.length} payment option(s), ${ship.length} shipping option(s)`);
    if (pay.length) console.log(`      payment keys: ${Object.keys(pay[0]).join(', ')}`);
    if (ship.length) console.log(`      shipping keys: ${Object.keys(ship[0]).join(', ')}`);
  } catch (e) { console.log(`    profile — not captured: ${String(e.message).slice(0, 120)}`); }

  /* Orders. Scrubbed, and we report which fields could carry our own SDK- ref —
     the open item from the original spec that decides push idempotency. */
  try {
    const orders = await call('/orders?limit=1');
    if (orders.items && orders.items.length) {
      const o = scrub(orders.items[0]);
      write('ecwid-order.json', o);
      const cand = Object.keys(o).filter(k => /external|orderNumber|refer|comment|custom|vendorOrder/i.test(k));
      console.log(`    order — ref-field candidates: ${cand.join(', ') || '(none found)'}`);
    } else {
      console.log('    orders — store has none yet; ecwid-order.json not written');
      console.log('      (revision 2 §6 expects this: the test store reports 0 orders)');
    }
  } catch (e) { console.log(`    orders — not captured: ${String(e.message).slice(0, 120)}`); }

  /* The delivery-cost calculation revision 2 decided to rely on. Uses the first
     real product so the request is representative. */
  try {
    const calc = await call('/order/calculate', {
      method: 'POST',
      body: {
        items: [{ productId: product.id, quantity: 1 }],
        shippingPerson: { name: FAKE.name, countryCode: 'EG', city: 'القاهرة', street: FAKE.street },
      },
    });
    write('ecwid-calculate.json', scrub(calc));
    const opts = calc.availableShippingOptions || calc.shippingOptions || [];
    console.log(`    calculate — ${opts.length} shipping option(s) offered for Cairo`);
    for (const o of opts.slice(0, 6))
      console.log(`      ${String(o.shippingMethodName || o.name || '?').slice(0, 62)}  ${o.shippingRate ?? o.rate ?? '?'}`);
    if (!opts.length)
      console.log('      none — expected while the test storefront is closed (revision 2 §6)');
  } catch (e) { console.log(`    calculate — failed: ${String(e.message).slice(0, 160)}`); }
}

/* ------------------------------------------------------------------ survey */

/* Answers revision 2 §10 from data instead of asking SADKO:
   · do products carry WEIGHT (which decides whether Ecwid can pick the right
     shipping size band automatically, or whether the customer picks and can
     under-pay)
   · do products have OPTIONS / VARIATIONS (the gap the new site cannot render)
   · how many carry a real COMPARE-TO price (whether discounts can be shown)
   · ribbon, brand and SKU fill rates
   · how many images per product                                             */
async function survey() {
  console.log('\n=== catalogue survey (pages the whole catalogue) ===');
  /* Field names below are taken from a REAL captured payload, not guessed.
     Ecwid has no trackQuantity (it has `unlimited`), no requiresShipping (it
     has `isShippingRequired`) and no top-level `brand` (brand is an attribute).
     An earlier pass used the guessed names and reported four false zeroes. */
  const s = {
    total: 0, enabled: 0, inStock: 0, tracked: 0, unlimited: 0,
    withWeight: 0, zeroWeight: 0, withDimensions: 0, requiresShipping: 0, fixedRate: 0,
    withOptions: 0, withCombinations: 0,
    withCompareTo: 0, compareToAbovePrice: 0,
    withRibbon: 0, withAttributes: 0, withBrandAttr: 0, withSku: 0,
    noName: 0, withNameTranslated: 0, withDescTranslated: 0, langs: new Set(),
    noCategory: 0,
    images1: 0, imagesMany: 0, noImage: 0, maxImages: 0,
    currencies: new Set(), optionExamples: [], weighted: [], brandNames: new Set(),
  };

  for (let offset = 0; ; ) {
    const page = await call(`/products?limit=100&offset=${offset}`);
    const items = (page && page.items) || [];
    if (!items.length) break;

    for (const p of items) {
      s.total++;
      if (p.enabled !== false) s.enabled++;
      if (p.inStock) s.inStock++;
      if (p.unlimited === false) s.tracked++; else if (p.unlimited) s.unlimited++;
      if (p.isShippingRequired) s.requiresShipping++;
      if (p.fixedShippingRateOnly) s.fixedRate++;

      if (!p.name || !String(p.name).trim()) s.noName++;
      if (p.nameTranslated && Object.keys(p.nameTranslated).length) {
        s.withNameTranslated++;
        for (const l of Object.keys(p.nameTranslated)) s.langs.add(l);
      }
      if (p.descriptionTranslated && Object.keys(p.descriptionTranslated).length) s.withDescTranslated++;

      const cats = Array.isArray(p.categoryIds) ? p.categoryIds : [];
      if (!cats.length && !p.defaultCategoryId) s.noCategory++;

      const w = Number(p.weight);
      if (Number.isFinite(w) && w > 0) {
        s.withWeight++;
        if (s.weighted.length < 5) s.weighted.push(`${p.id} ${String(p.name).slice(0, 40)} → ${w}`);
      } else s.zeroWeight++;
      const d = p.dimensions || {};
      if (Number(d.length) > 0 || Number(d.width) > 0 || Number(d.height) > 0) s.withDimensions++;

      const opts = Array.isArray(p.options) ? p.options : [];
      if (opts.length) {
        s.withOptions++;
        if (s.optionExamples.length < 5)
          s.optionExamples.push(`${p.id} ${String(p.name).slice(0, 38)} → ${opts.map(o => o.name).join(', ')}`);
      }
      if (Array.isArray(p.combinations) && p.combinations.length) s.withCombinations++;

      const cmp = Number(p.compareToPrice), price = Number(p.price);
      if (Number.isFinite(cmp) && cmp > 0) {
        s.withCompareTo++;
        if (Number.isFinite(price) && cmp > price) s.compareToAbovePrice++;
      }

      if (p.ribbon && (p.ribbon.text || typeof p.ribbon === 'string')) s.withRibbon++;
      if (p.sku && String(p.sku).trim()) s.withSku++;

      /* Ecwid has no top-level brand: it lives in attributes, where a built-in
         brand attribute has type BRAND. Count both so a nonstandard setup
         still shows up as "attributes present but no brand attribute". */
      const attrs = Array.isArray(p.attributes) ? p.attributes : [];
      if (attrs.length) s.withAttributes++;
      for (const a of attrs) {
        const isBrand = String(a.type || '').toUpperCase() === 'BRAND' || /brand|ماركة|علامة/i.test(String(a.name || ''));
        if (isBrand && a.value && String(a.value).trim()) {
          s.withBrandAttr++;
          if (s.brandNames.size < 12) s.brandNames.add(String(a.value).trim());
          break;
        }
      }

      const imgs = (Array.isArray(p.galleryImages) ? p.galleryImages.length : 0) + (p.imageUrl ? 1 : 0);
      if (imgs > s.maxImages) s.maxImages = imgs;
      if (!imgs) s.noImage++; else if (imgs === 1) s.images1++; else s.imagesMany++;

      if (p.defaultDisplayedPriceFormatted) {
        const m = /[^\d.,\s]+/.exec(p.defaultDisplayedPriceFormatted);
        if (m) s.currencies.add(m[0].trim());
      }
    }

    offset += items.length;
    process.stdout.write(`\r  scanned ${offset} / ${page.total}   `);
    if (offset >= (page.total ?? offset)) break;
  }
  console.log('\n');

  const pct = n => s.total ? ` (${Math.round(n / s.total * 100)}%)` : '';
  const row = (label, n, extra = '') => console.log(`  ${label.padEnd(30)} ${String(n).padStart(5)}${extra}`);

  row('products scanned', s.total);
  row('enabled', s.enabled, pct(s.enabled));
  row('in stock', s.inStock, pct(s.inStock));
  row('quantity tracked', s.tracked, pct(s.tracked));
  row('unlimited stock', s.unlimited, pct(s.unlimited));
  row('requires shipping', s.requiresShipping, pct(s.requiresShipping));
  row('fixed shipping rate only', s.fixedRate, pct(s.fixedRate));
  console.log('');
  console.log('  -- content quality --');
  row('MISSING a name', s.noName, pct(s.noName));
  row('in no category at all', s.noCategory, pct(s.noCategory));
  row('has translated name', s.withNameTranslated, pct(s.withNameTranslated));
  row('has translated description', s.withDescTranslated, pct(s.withDescTranslated));
  if (s.langs.size) console.log(`    translation languages present: ${[...s.langs].join(', ')}`);
  console.log('');
  console.log('  -- shipping band selection (revision 2 §10 q1 and q3) --');
  row('WITH a weight set', s.withWeight, pct(s.withWeight));
  row('with NO weight', s.zeroWeight, pct(s.zeroWeight));
  row('with dimensions set', s.withDimensions, pct(s.withDimensions));
  if (s.weighted.length) {
    console.log('    examples that DO have a weight:');
    for (const x of s.weighted) console.log('      ' + x);
  }
  console.log('');
  console.log('  -- variations (the gap the new site cannot render) --');
  row('with options', s.withOptions, pct(s.withOptions));
  row('with combinations/variants', s.withCombinations, pct(s.withCombinations));
  if (s.optionExamples.length) {
    console.log('    examples:');
    for (const x of s.optionExamples) console.log('      ' + x);
  }
  console.log('');
  console.log('  -- fields the new site newly gains --');
  row('compare-to price set', s.withCompareTo, pct(s.withCompareTo));
  row('  ...genuinely ABOVE price', s.compareToAbovePrice, pct(s.compareToAbovePrice));
  row('ribbon set (= our badge)', s.withRibbon, pct(s.withRibbon));
  row('any attributes', s.withAttributes, pct(s.withAttributes));
  row('  ...a brand attribute', s.withBrandAttr, pct(s.withBrandAttr));
  row('SKU filled', s.withSku, pct(s.withSku));
  if (s.brandNames.size) console.log(`    brands seen: ${[...s.brandNames].join(' · ')}`);
  console.log('');
  console.log('  -- images --');
  row('exactly one image', s.images1, pct(s.images1));
  row('more than one', s.imagesMany, pct(s.imagesMany));
  row('no image at all', s.noImage, pct(s.noImage));
  row('most images on one product', s.maxImages);
  if (s.currencies.size) console.log(`\n  currency symbols seen: ${[...s.currencies].join(' ')}`);

  console.log('\n  Interpretation:');
  if (s.zeroWeight > s.total * 0.1)
    console.log(`  · ${s.zeroWeight} products have no weight, so Ecwid CANNOT reliably pick the`);
  else
    console.log('  · weights are broadly present, so weight-based band selection looks viable;');
  if (s.zeroWeight > s.total * 0.1)
    console.log('    shipping size band for them. Treat revision 2 §2.2 as blocked until resolved.');
  if (s.withOptions || s.withCombinations)
    console.log(`  · ${s.withOptions} products HAVE options — the variations gap is real, not hypothetical.`);
  else
    console.log('  · no product uses options, so the variations gap is theoretical. Good.');
  if (!s.compareToAbovePrice)
    console.log('  · no product has a real was-price, so the مختارات صادكو rail would render empty.');
  else
    console.log(`  · ${s.compareToAbovePrice} products carry a real discount, so that rail has content.`);
  if (s.imagesMany)
    console.log(`  · ${s.imagesMany} products have multiple images; the site shows one. Worth a gallery.`);
}

/* -------------------------------------------------------------------- main */

try {
  if (want.check) await check();
  if (want.capture) await capture();
  if (want.survey) await survey();
} catch (e) {
  console.error('\nFAILED: ' + e.message);
  process.exit(1);
}

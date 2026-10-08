/* ============================================================================
   What changes the moment the storefront switches from the seed to Ecwid?

   Run this BEFORE turning SADKO_ECWID on in production. 77 products appearing
   and 38 disappearing is not something customers should discover first.

   From site/:   node tools/ecwid-diff.mjs
                 node tools/ecwid-diff.mjs --sync    (refresh the mirror first)
   ========================================================================== */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ecwidEnv } from './ecwid-env.mjs';
import { openEcwidStore } from '../engine/ecwid-store.mjs';
import { openEcwidApi } from '../engine/ecwid-api.mjs';
import { createEcwidSync } from '../engine/ecwid-sync.mjs';
import { createEcwidSource } from '../engine/ecwid-source.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const env = ecwidEnv();
const store = await openEcwidStore(path.join(ROOT, 'data', 'ecwid.db'));

if (process.argv.includes('--sync')) {
  const api = openEcwidApi({ storeId: env.storeId, token: env.token });
  if (!api.configured) { console.error('No token — cannot sync. See --check on ecwid-capture.'); process.exit(1); }
  process.stdout.write('syncing… ');
  const r = await createEcwidSync({ api, store }).syncAll();
  console.log(`${r.products} products, ${r.categories} categories, ${r.payment} payment, ${r.shipping} shipping\n`);
}

const seed = JSON.parse(readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8')).products;

/* Compare what the storefront WOULD serve, not the raw mirror — so the
   filtering (disabled, incomplete, banners) and the ordering are included. */
const source = createEcwidSource({
  store, seedLoader: async () => seed, enabled: true,
  bannerCategoryId: process.env.SADKO_ECWID_BANNER_CATEGORY || null,
});
const live = await source.catalogBase();

if (source.activeSource() !== 'ecwid') {
  console.log('The mirror is empty, so the storefront would still serve the seed.');
  console.log('Run with --sync first.');
  store.close();
  process.exit(0);
}

const byId = rows => new Map(rows.map(r => [String(r.id), r]));
const S = byId(seed), L = byId(live);

const added = [...L.keys()].filter(k => !S.has(k));
const removed = [...S.keys()].filter(k => !L.has(k));
const kept = [...L.keys()].filter(k => S.has(k));
const repriced = kept.filter(k => Number(S.get(k).price) !== Number(L.get(k).price));
const renamed = kept.filter(k => String(S.get(k).title).trim() !== String(L.get(k).title).trim());
const oos = live.filter(p => p.inStock === false);
const discounted = live.filter(p => p.compareToPrice != null);
const gallery = live.filter(p => Array.isArray(p.images) && p.images.length > 1);
const st = await store.stats();

const money = n => Number(n).toLocaleString('en-EG', { maximumFractionDigits: 0 });

console.log('='.repeat(64));
console.log(`SEED ${seed.length} products   ->   ECWID would serve ${live.length}`);
console.log('='.repeat(64));
console.log(`  mirrored in total        ${st.products}`);
console.log(`    of which enabled       ${st.enabled}`);
console.log(`    incomplete (no name)   ${st.incomplete}   excluded from the storefront`);
console.log('');
console.log(`  ADDED (not on the site today)      ${added.length}`);
console.log(`  REMOVED (site still advertises)    ${removed.length}`);
console.log(`  repriced                           ${repriced.length}`);
console.log(`  renamed                            ${renamed.length}`);
console.log('');
console.log(`  out of stock, shown last           ${oos.length}  (${Math.round(oos.length / live.length * 100)}% of what is served)`);
console.log(`  with a real was-price              ${discounted.length}`);
console.log(`  with more than one image           ${gallery.length}`);

const show = (label, ids, fmt) => {
  if (!ids.length) return;
  console.log(`\n-- ${label} --`);
  for (const id of ids.slice(0, 15)) console.log('   ' + fmt(id));
  if (ids.length > 15) console.log(`   … and ${ids.length - 15} more`);
};

show('ADDED', added, id => {
  const r = L.get(id);
  return `${id.padEnd(11)} ${money(r.price).padStart(9)}  ${String(r.title).slice(0, 44)}`;
});
show('REMOVED — the site is advertising these and Ecwid no longer has them', removed, id => {
  const r = S.get(id);
  return `${id.padEnd(11)} ${money(r.price).padStart(9)}  ${String(r.title).slice(0, 44)}`;
});
show('REPRICED', repriced, id => {
  const a = Number(S.get(id).price), b = Number(L.get(id).price);
  const dir = b > a ? 'up  ' : 'down';
  return `${id.padEnd(11)} ${dir} ${money(a).padStart(9)} -> ${money(b).padStart(9)}  ${String(L.get(id).title).slice(0, 34)}`;
});

if (repriced.length) {
  const deltas = repriced.map(id => Number(L.get(id).price) - Number(S.get(id).price));
  const up = deltas.filter(d => d > 0).length;
  console.log(`\n   ${up} went up, ${deltas.length - up} went down.`);
}

/* A total replacement means the two sides do not share an id space at all, which
   is a different situation from a catalogue that drifted — and it changes what
   this diff can tell you. Say so rather than letting "990 added" read as growth. */
if (!kept.length && added.length && removed.length) {
  console.log('\n' + '!'.repeat(64));
  console.log('NO PRODUCT ID APPEARS ON BOTH SIDES.');
  console.log(`This store's ids (e.g. ${added[0]}) share nothing with the seed's`);
  console.log(`(e.g. ${removed[0]}), so this is a DIFFERENT STORE, not a drifted one.`);
  console.log('');
  console.log('What that means:');
  console.log('  · this diff is NOT what a production cutover would look like');
  console.log('  · anything in the site keyed to product or category ids will not');
  console.log('    match — curated rails in collections.json, the home-page hotspot');
  console.log('    links, and the 30 generated category pages');
  console.log('  · so verify the MECHANISM here, but verify the STOREFRONT against');
  console.log('    production (store 18028328), whose ids do match the seed');
  console.log('!'.repeat(64));
}

console.log('\nNothing above is live yet: this reads the mirror, not the storefront.');
console.log('The switch happens when SADKO_ECWID=1 and a token are both set.');
store.close();

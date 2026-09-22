// site/engine/ecwid-ads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AD_SLOTS, adFoldersFromEnv, buildSlotMap, adSlotOf, isAd, adCounts, adIssues }
  from './ecwid-ads.mjs';

/* --------------------------- the configuration -------------------------- */

test('one environment variable per slot, each a category id', () => {
  const f = adFoldersFromEnv({
    SADKO_ECWID_ADS_HERO: '206900001',
    SADKO_ECWID_ADS_WIDE: '206900002',
    SADKO_ECWID_ADS_SQUARE: '206900003',
  });
  assert.deepEqual(f, { hero: '206900001', wide: '206900002', square: '206900003' });
});

test('only the square folder configured is a valid state', () => {
  /* Exactly what the owner is doing first: square ads from a folder, the
     other two slots still on the old convention. */
  const f = adFoldersFromEnv({ SADKO_ECWID_ADS_SQUARE: '206900003' });
  assert.deepEqual(f, { square: '206900003' });
});

test('a blank value is not an id — that is how a folder is switched off', () => {
  /* A systemd EnvironmentFile line `KEY=` is a real empty string, not an
     unset variable. */
  assert.deepEqual(adFoldersFromEnv({ SADKO_ECWID_ADS_SQUARE: '' }), {});
  assert.deepEqual(adFoldersFromEnv({ SADKO_ECWID_ADS_SQUARE: '   ' }), {});
});

test('a non-numeric value is refused rather than silently matching nothing', () => {
  /* The likely typo is pasting a panel URL. Failing visibly at configuration
     beats a folder that quietly holds no ads. */
  assert.deepEqual(adFoldersFromEnv({
    SADKO_ECWID_ADS_SQUARE: 'https://my.shopsettings.com/store/142682751#category:id=206900003',
  }), {});
  assert.deepEqual(adFoldersFromEnv({ SADKO_ECWID_ADS_SQUARE: 'square' }), {});
});

test('surrounding whitespace is tolerated', () => {
  assert.deepEqual(adFoldersFromEnv({ SADKO_ECWID_ADS_SQUARE: ' 206900003 ' }), { square: '206900003' });
});

test('an empty environment configures nothing', () => {
  assert.deepEqual(adFoldersFromEnv({}), {});
  assert.deepEqual(adFoldersFromEnv(), {});
});

/* ------------------------------ the mapping ----------------------------- */

test('THE POINT: everything in the square folder is a square ad', () => {
  /* No SKU anywhere in this test. Dropping the artwork in the folder is the
     whole interaction. */
  const { map } = buildSlotMap({ square: '206900003' },
                               { '206900003': ['9001', '9002', '9003'] });
  assert.deepEqual(map, { 9001: 'square', 9002: 'square', 9003: 'square' });
});

test('three folders map to three slots', () => {
  const { map } = buildSlotMap(
    { hero: '1', wide: '2', square: '3' },
    { 1: ['a'], 2: ['b'], 3: ['c', 'd'] });
  assert.deepEqual(map, { a: 'hero', b: 'wide', c: 'square', d: 'square' });
});

test('a folder with no configured id contributes nothing', () => {
  const { map } = buildSlotMap({ square: '3' }, { 1: ['a'], 3: ['c'] });
  assert.deepEqual(map, { c: 'square' });
});

test('an empty folder is not an error', () => {
  const { map, conflicts } = buildSlotMap({ square: '3' }, { 3: [] });
  assert.deepEqual(map, {});
  assert.deepEqual(conflicts, []);
});

test('a folder id with no contents entry is not an error either', () => {
  /* The fetch for that folder may have failed; the others must still work. */
  const { map } = buildSlotMap({ hero: '1', square: '3' }, { 3: ['c'] });
  assert.deepEqual(map, { c: 'square' });
});

test('a product in two folders keeps the earlier slot and is REPORTED', () => {
  /* A banner in two folders is a staff mistake. Resolving it quietly would
     make it look deliberate, so the conflict is surfaced for the admin panel
     while the render stays predictable. */
  const { map, conflicts } = buildSlotMap(
    { hero: '1', square: '3' }, { 1: ['x'], 3: ['x'] });
  assert.deepEqual(map, { x: 'hero' }, 'hero precedes square in AD_SLOTS');
  assert.deepEqual(conflicts, [{ id: 'x', kept: 'hero', also: 'square' }]);
});

test('numeric ids from the API are handled as readily as strings', () => {
  const { map } = buildSlotMap({ square: 3 }, { 3: [9001, 9002] });
  assert.deepEqual(map, { 9001: 'square', 9002: 'square' });
});

test('blank and null ids inside a folder are skipped', () => {
  const { map } = buildSlotMap({ square: '3' }, { 3: ['9001', '', null, undefined, '  '] });
  assert.deepEqual(map, { 9001: 'square' });
});

/* ------------------------ folder beats SKU ------------------------------ */

const P = (over = {}) => ({ id: '9001', title: 'إعلان', image: 'https://cdn/a.jpg', sku: '', ...over });

test('the folder decides the slot, not the SKU', () => {
  /* Whatever is in the SKU field — a real product code, most likely — the
     folder is the answer. */
  const map = { 9001: 'square' };
  assert.equal(adSlotOf(P({ sku: '600330254' }), map), 'square');
  assert.equal(adSlotOf(P({ sku: 'banner-hero' }), map), 'square',
    'the folder must win over the SKU, or a moved ad keeps its old slot');
});

test('the SKU convention still works for anything not in a folder', () => {
  assert.equal(adSlotOf(P({ sku: 'banner-hero' }), {}), 'hero');
  assert.equal(adSlotOf(P({ sku: 'banner-wide' }), {}), 'wide');
  assert.equal(adSlotOf(P({ sku: 'banner-square' }), {}), 'square');
});

test('a bare slot word in the SKU is accepted, as it was before', () => {
  assert.equal(adSlotOf(P({ sku: 'hero' }), {}), 'hero');
  assert.equal(adSlotOf(P({ sku: 'HERO' }), {}), 'hero');
});

test('a banner- prefix with an unknown tail is still a banner, shaped square', () => {
  assert.equal(adSlotOf(P({ sku: 'banner-nonsense' }), {}), 'square');
});

test('an ORDINARY product is not an ad, whatever its SKU looks like', () => {
  /* This is the guard that matters: adSlotOf must not default to a slot, or
     every product in the catalogue would render as a square advert. */
  assert.equal(adSlotOf(P({ sku: '600330254' }), {}), null);
  assert.equal(adSlotOf(P({ sku: '' }), {}), null);
  assert.equal(adSlotOf(P({ sku: 'square-door-handle' }), {}), null,
    'a product whose code merely contains a slot word is not an ad');
  assert.equal(adSlotOf(P({ sku: 'heroic-blender' }), {}), null);
});

test('a junk product does not throw', () => {
  assert.equal(adSlotOf(null, {}), null);
  assert.equal(adSlotOf({}, {}), null);
  assert.equal(adSlotOf({ id: null, sku: 'banner-hero' }, {}), null);
});

/* ------------------------------- isAd ---------------------------------- */

test('anything with a slot is an ad', () => {
  assert.equal(isAd(P(), { 9001: 'square' }), true);
  assert.equal(isAd(P({ sku: 'banner-hero' }), {}), true);
});

test('the legacy single banner category still marks an ad', () => {
  /* It predates the per-slot folders and may still hold entries. */
  assert.equal(isAd(P({ categoryIds: ['206811031'] }), {}, '206811031'), true);
  assert.equal(isAd(P({ categoryId: '206811031', categoryIds: [] }), {}, '206811031'), true);
});

test('an ordinary product is not an ad', () => {
  assert.equal(isAd(P({ sku: '600330254', categoryIds: ['206629520'] }), {}, '206811031'), false);
  assert.equal(isAd(null, {}, '206811031'), false);
});

test('with no legacy category configured, only slots count', () => {
  assert.equal(isAd(P({ categoryIds: ['206811031'] }), {}, null), false);
});

/* ---------------------------- the diagnostics -------------------------- */

test('the counts are per slot, because that is the question being asked', () => {
  /* "3 square, 0 hero" explains why the top of the page is unchanged; a
     single total of 3 does not. */
  const map = { 1: 'square', 2: 'square', 3: 'square' };
  const products = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4', sku: '600330254' }];
  assert.deepEqual(adCounts(products, map), { hero: 0, wide: 0, square: 3, none: 0 });
});

test('an ad missing its artwork or headline is named, not silently dropped', () => {
  /* deriveBanners drops these, correctly and silently — the owner drops three
     images in and two appear with nothing saying why. */
  const map = { 1: 'square', 2: 'square', 3: 'square' };
  const issues = adIssues([
    { id: '1', title: 'إعلان', image: 'https://cdn/a.jpg' },
    { id: '2', title: '', image: 'https://cdn/b.jpg' },
    { id: '3', title: 'إعلان', image: '', images: [] },
  ], map);
  assert.deepEqual(issues, [
    { id: '2', slot: 'square', reasons: ['no-name'] },
    { id: '3', slot: 'square', reasons: ['no-image'] },
  ]);
});

test('an ad with neither is reported once with both reasons', () => {
  const issues = adIssues([{ id: '1', title: '  ', image: '' }], { 1: 'square' });
  assert.deepEqual(issues[0].reasons, ['no-name', 'no-image']);
});

test('the images array counts as artwork', () => {
  const issues = adIssues([{ id: '1', title: 'إعلان', image: '', images: ['https://cdn/a.jpg'] }],
                          { 1: 'square' });
  assert.deepEqual(issues, []);
});

test('an ordinary product is never reported as a broken ad', () => {
  assert.deepEqual(adIssues([{ id: '9', title: '', image: '', sku: '600330254' }], {}), []);
});

/* ------------------------------ the vocabulary ------------------------- */

test('the slot order is hero, wide, square — the conflict rule depends on it', () => {
  assert.deepEqual(AD_SLOTS, ['hero', 'wide', 'square']);
});

/* ======================================================================
   Merging with the local promos, one slot at a time.

   The measured bug: with only the SQUARE folder configured, the hero strap
   at the top of the shop page went EMPTY — the route replaced promos.json
   wholesale, discarding both local hero banners. That makes the staged
   rollout the owner asked for impossible.
   ================================================================== */

import { groupOf, mergePromos } from './ecwid-ads.mjs';

/* The real local file: two heroes, one wide tile, three square tiles. */
const LOCAL = [
  { id: 'bestsellers', slot: 'hero', art: 'wide', title: 'الأكثر مبيعاً', titleEn: 'Best sellers' },
  { id: 'nbe-instalments', slot: 'hero', art: 'wide', title: 'تقسيط ٦ شهور', titleEn: '6 months' },
  { id: 'summer', slot: 'slot', art: 'wide', title: 'الصيف مع صادكو', titleEn: 'Summer' },
  { id: 'instalments-tile', slot: 'slot', art: 'square', title: 'صادكو بالتقسيط', titleEn: 'Instalments' },
  { id: 'delivery-tile', slot: 'slot', art: 'square', title: 'هانوصل لك', titleEn: 'We deliver' },
  { id: 'kiriazi-solitaire', slot: 'slot', art: 'square', title: 'كريازى', titleEn: 'Kiriazi' },
];

const E = (slot, id) => ({ id: 'ecwid-' + id, slot, art: slot === 'square' ? 'square' : 'wide',
                           title: 'إعلان ' + id, source: 'ecwid' });

test('both vocabularies collapse to the same three groups', () => {
  /* promos.json says slot:'slot' + art; a derived banner says slot directly. */
  assert.equal(groupOf({ slot: 'hero', art: 'wide' }), 'hero');
  assert.equal(groupOf({ slot: 'slot', art: 'square' }), 'square');
  assert.equal(groupOf({ slot: 'slot', art: 'wide' }), 'wide');
  assert.equal(groupOf({ slot: 'square' }), 'square');
  assert.equal(groupOf({ slot: 'wide' }), 'wide');
  assert.equal(groupOf(null), null);
  assert.equal(groupOf({ slot: 'nonsense' }), null);
});

test('THE BUG: square ads from Ecwid must NOT empty the hero strap', () => {
  const r = mergePromos([E('square', 1), E('square', 2), E('square', 3)], LOCAL);
  const heroes = r.promos.filter(p => groupOf(p) === 'hero');
  assert.equal(heroes.length, 2, 'the local hero banners were discarded');
  assert.deepEqual(heroes.map(p => p.id), ['bestsellers', 'nbe-instalments']);
});

test('the square tiles ARE replaced by Ecwid, which is the point', () => {
  const r = mergePromos([E('square', 1), E('square', 2), E('square', 3)], LOCAL);
  const squares = r.promos.filter(p => groupOf(p) === 'square');
  assert.equal(squares.length, 3);
  assert.ok(squares.every(p => p.source === 'ecwid'), 'a local square tile survived');
});

test('the wide tile is untouched while only square is configured', () => {
  const r = mergePromos([E('square', 1)], LOCAL);
  const wide = r.promos.filter(p => groupOf(p) === 'wide');
  assert.deepEqual(wide.map(p => p.id), ['summer']);
});

test('the merge reports which groups came from where', () => {
  /* So the admin panel and the startup log can say "square from Ecwid, hero
     and wide still local" rather than leaving it to be inferred. */
  const r = mergePromos([E('square', 1)], LOCAL);
  assert.deepEqual(r.fromEcwid, ['square']);
  assert.deepEqual(r.fromLocal.sort(), ['hero', 'wide']);
});

test('taking over a second slot replaces only that one', () => {
  /* The owner's next step: "continue doing this for the rest". */
  const r = mergePromos([E('square', 1), E('hero', 9)], LOCAL);
  assert.deepEqual(r.fromEcwid.sort(), ['hero', 'square']);
  assert.deepEqual(r.fromLocal, ['wide']);
  assert.equal(r.promos.filter(p => groupOf(p) === 'hero').length, 1);
  assert.equal(r.promos.filter(p => groupOf(p) === 'hero')[0].source, 'ecwid');
});

test('all three slots from Ecwid leaves nothing local', () => {
  const r = mergePromos([E('hero', 1), E('wide', 2), E('square', 3)], LOCAL);
  assert.deepEqual(r.fromEcwid, ['hero', 'wide', 'square']);
  assert.deepEqual(r.fromLocal, []);
  assert.ok(r.promos.every(p => p.source === 'ecwid'));
});

test('no Ecwid ads at all leaves promos.json exactly as it was', () => {
  const r = mergePromos([], LOCAL);
  assert.deepEqual(r.promos.map(p => p.id), LOCAL.map(p => p.id));
  assert.deepEqual(r.fromEcwid, []);
});

test('the local bilingual copy survives on the groups Ecwid did not take', () => {
  /* A derived banner carries no English at all, so losing the local entry
     would leave an English shopper with nothing in that slot. */
  const r = mergePromos([E('square', 1)], LOCAL);
  for (const p of r.promos.filter(x => groupOf(x) !== 'square')) {
    assert.ok(p.titleEn, 'an English title was lost from ' + p.id);
  }
});

test('an unrecognised local entry is kept rather than dropped', () => {
  /* promos.json is owner-editable; a shape this grouping does not know must
     not silently vanish. */
  const odd = { id: 'odd', slot: 'mystery' };
  const r = mergePromos([E('square', 1)], LOCAL.concat([odd]));
  assert.ok(r.promos.some(p => p.id === 'odd'));
});

test('the output is ordered hero, then wide, then square', () => {
  /* shop.js deals the first wide into the single-banner block and the rest
     into the square row, so the order is not cosmetic. */
  const r = mergePromos([E('hero', 1), E('square', 3), E('wide', 2)], []);
  assert.deepEqual(r.promos.map(groupOf), ['hero', 'wide', 'square']);
});

test('junk on either side does not throw', () => {
  assert.deepEqual(mergePromos(null, null).promos, []);
  assert.deepEqual(mergePromos([null], [null]).promos, []);
});

/* ======================================================================
   Unconfiguring a folder takes effect at once.

   The measured bug: after a run with SADKO_ECWID_ADS_SQUARE set, removing
   the variable and restarting still served 983 products instead of 990 and
   still rendered the folder's contents as adverts. The stored map outlived
   the configuration that produced it.
   ================================================================== */

test('the map is derived from the CURRENT config, so a removed folder stops counting', () => {
  /* buildSlotMap is given the live folder config and the stored contents;
     intersecting them is what makes unsetting a folder immediate. */
  const storedContents = { '206629525': ['9001', '9002', '9003'] };

  const configured = buildSlotMap({ square: '206629525' }, storedContents);
  assert.equal(Object.keys(configured.map).length, 3, 'a configured folder should map its contents');

  const unconfigured = buildSlotMap({}, storedContents);
  assert.deepEqual(unconfigured.map, {},
    'the stored contents still mark products as ads after the folder was removed');
});

test('repointing a slot at a different folder drops the old contents', () => {
  const stored = { '111': ['a', 'b'], '222': ['c'] };
  const { map } = buildSlotMap({ square: '222' }, stored);
  assert.deepEqual(map, { c: 'square' }, 'the previous folder\'s contents survived the change');
});

/* ======================================================================
   The server wiring. Source-level, like the other wiring suites.
   ================================================================== */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SERVER = readFileSync(path.join(import.meta.dirname, '..', 'compare-server.mjs'), 'utf8');
const SYNC = readFileSync(path.join(import.meta.dirname, 'ecwid-sync.mjs'), 'utf8');
const SOURCE = readFileSync(path.join(import.meta.dirname, 'ecwid-source.mjs'), 'utf8');

test('the folders are read from the environment, one variable per slot', () => {
  assert.match(SERVER, /adFoldersFromEnv\(process\.env\)/);
});

test('the promos route runs when only ad folders are configured', () => {
  /* It was gated on the legacy banner category alone, so a store using only
     folders would never have reached it. */
  assert.match(SERVER, /ECWID_BANNER_CATEGORY \|\| Object\.keys\(ECWID_AD_FOLDERS\)\.length/);
});

test('the route MERGES with promos.json instead of replacing it', () => {
  assert.match(SERVER, /mergePromos\(derived, local\)/);
  assert.ok(!/if \(promos\.length\) \{[\s\S]{0,200}source: 'ecwid',\s*\n\s*derivedAt/.test(SERVER),
    'the wholesale replacement is back');
});

test('the response says which slots came from where', () => {
  assert.match(SERVER, /slotsFromEcwid: merged\.fromEcwid/);
  assert.match(SERVER, /slotsFromLocal: merged\.fromLocal/);
});

test('a missing promos.json degrades to Ecwid-only rather than throwing', () => {
  const route = /u\.pathname === '\/data\/promos\.json'[\s\S]{0,2600}/.exec(SERVER)[0];
  assert.match(route, /catch \(e\) \{ local = null; \}/);
});

test('the slot map reaches the source as a GETTER, not a captured value', () => {
  /* Every sync rebuilds it; a value captured at construction would pin the
     storefront to whatever the folders held at boot. */
  assert.match(SERVER, /adSlotMap: \(\) =>/);
  assert.match(SOURCE, /typeof adSlotMap === 'function' \? adSlotMap\(\) : adSlotMap/);
});

test('the folder wins over the SKU at the render seam too', () => {
  assert.match(SERVER, /slotOf: p => ecwidSource\(\)\.adSlotOf\(p\)/);
});

test('an ad-folder product is excluded from the catalogue', () => {
  /* Otherwise the artwork is offered for sale. isAd is part of isBanner,
     which build() filters out. */
  assert.match(SOURCE, /isAd\(p, slotMap\(\), banner\)/);
});

test('folder membership is refreshed on its own schedule', () => {
  /* Moving an ad between folders changes no product field, so updatedFrom
     would never report it and the ad would keep its old slot until the daily
     full sync. */
  assert.match(SERVER, /es\.syncAdFolders\(\)\.then\(after\)/);
});

test('an unreadable folder keeps its previous contents', () => {
  /* A transient API error must not blank the homepage's adverts. */
  const fn = /async function syncAdFolders[\s\S]{0,2200}?\n  \}/.exec(SYNC)[0];
  assert.match(fn, /if \(prevContents\[id\]\) contents\[id\] = prevContents\[id\];/);
});

test('no token leaves the stored state alone; no folders clears it', () => {
  const fn = /async function syncAdFolders[\s\S]{0,2200}?\n  \}/.exec(SYNC)[0];
  assert.match(fn, /if \(!api\.configured\) return/);
  assert.match(fn, /setState\('ad_folders', null\)/);
});

test('the admin panel reports the folders, the per-slot counts and the problems', () => {
  assert.match(SERVER, /bySlot: adCounts\(bannerList, st\.map\)/);
  assert.match(SERVER, /issues: adIssues\(bannerList, st\.map\)/);
  assert.match(SERVER, /conflicts: st\.conflicts/);
  assert.match(SERVER, /failed: st\.failed/);
});

test('the startup log names the configured folders', () => {
  /* So a misconfigured folder shows up in the log rather than only as "my
     adverts did not appear". */
  assert.match(SERVER, /\[ecwid\] ad folders: /);
  assert.match(SERVER, /no ad folders configured/);
});

/* ======================================================================
   The destination the owner types in the panel.

   Needed because two of the three square tiles being moved into Ecwid point
   at contact.html and delivery.html, and the third at one product — none of
   which a category can express. Without it all three would have become "the
   shop", which is a worse page than they have today.

   It is staff-typed text that ends up in an href on our own pages, so the
   allow-list is the security boundary, not a convenience.
   ================================================================== */

import { adDestination } from './ecwid-ads.mjs';

test('a site page name becomes that page', () => {
  assert.equal(adDestination('contact'), 'contact.html');
  assert.equal(adDestination('delivery'), 'delivery.html');
  assert.equal(adDestination('finder'), 'finder.html');
});

test('the .html a staff member may add is tolerated', () => {
  assert.equal(adDestination('contact.html'), 'contact.html');
  assert.equal(adDestination('  Delivery.HTML  '), 'delivery.html');
});

test('a specific product is reachable', () => {
  assert.equal(adDestination('product:837495061'), 'product.html?id=837495061');
});

test('a category is reachable, in the form that also targets the aisle', () => {
  assert.equal(adDestination('cat:206629766'), 'shop.html?cat=206629766');
});

test('an empty SKU means "use the category fallback"', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(adDestination(v), null);
});

test('a slot marker is NOT read as a destination', () => {
  /* banner-hero is the legacy way of saying which slot this is. Reading it as
     a page name would be nonsense. */
  assert.equal(adDestination('banner-hero'), null);
  assert.equal(adDestination('banner-square'), null);
  assert.equal(adDestination('hero'), null);
  assert.equal(adDestination('square'), null);
});

test('a real product code falls through to the category fallback', () => {
  /* Ads created by copying a product keep its SKU; that must not be read as
     a destination. */
  assert.equal(adDestination('600330254'), null);
  assert.equal(adDestination('80240465'), null);
});

/* -------------------------- the security boundary ---------------------- */

test('an absolute URL is REFUSED', () => {
  /* An open redirect on our own pages, and the exact thing the p.url bug did. */
  for (const v of ['https://evil.test', 'http://evil.test/x', '//evil.test',
                   'https://sadko-test.company.site/products/x']) {
    assert.equal(adDestination(v), null, 'accepted: ' + v);
  }
});

test('a javascript: or data: URL is REFUSED', () => {
  for (const v of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>',
                   'vbscript:msgbox']) {
    assert.equal(adDestination(v), null, 'accepted: ' + v);
  }
});

test('a path that climbs out of the site is REFUSED', () => {
  for (const v of ['../../etc/passwd', '/admin.html', '../admin', './contact']) {
    assert.equal(adDestination(v), null, 'accepted: ' + v);
  }
});

test('a page NOT on the list is refused, admin.html above all', () => {
  /* The list is things it makes sense to advertise. A glob over the folder
     would have offered the staff console. */
  for (const v of ['admin', 'admin.html', 'account', 'checkout', 'cart']) {
    assert.equal(adDestination(v), null, 'accepted: ' + v);
  }
});

test('a product or category id must be digits only', () => {
  for (const v of ['product:abc', 'product:1;drop', 'cat:x', 'product:', 'cat:',
                   'product:837495061 OR 1=1']) {
    assert.equal(adDestination(v), null, 'accepted: ' + v);
  }
});

test('an absurdly long id is refused rather than rendered', () => {
  assert.equal(adDestination('product:' + '9'.repeat(40)), null);
});

test('every accepted destination is a bare relative path this site can re-base', () => {
  /* shop.js runs these through P() for the pages under /category/, and leaves
     anything absolute alone — so an absolute value would also escape that. */
  for (const v of ['contact', 'delivery', 'product:1', 'cat:2', 'shop']) {
    const d = adDestination(v);
    assert.ok(d, v + ' should be accepted');
    assert.ok(!/^([a-z]+:|\/\/|\/)/i.test(d), 'not re-basable: ' + d);
  }
});

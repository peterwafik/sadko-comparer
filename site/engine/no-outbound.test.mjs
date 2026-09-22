// site/engine/no-outbound.test.mjs
/* Nothing on this site may send a shopper somewhere else to buy from SADKO.

   There were three such exits, found and closed one after another:
     • product cards hrefed p.url, the Ecwid storefront
     • the product page's primary button did the same, in a new tab
     • the price comparer's own SADKO row said "Buy from SADKO ↗" and went to
       the old WordPress listing on sadko-group.com

   A single grep over the client scripts is what stops a fourth appearing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const JS = path.join(import.meta.dirname, '..', 'assets', 'js');
const files = readdirSync(JS).filter(n => n.endsWith('.js'));
const read = n => readFileSync(path.join(JS, n), 'utf8');

/* admin.js is exempt and deliberately so: it is the staff console, and its
   links into the Ecwid control panel are the whole point of it. */
const SHOPPER_FACING = files.filter(n => n !== 'admin.js');

test('no shopper-facing script builds a link to the Ecwid storefront', () => {
  const bad = [];
  for (const n of SHOPPER_FACING) {
    const src = read(n);
    /* company.site is Ecwid's own storefront host for this store, and
       app.ecwid.com is its API/admin host. Neither belongs in an href a
       customer can click. */
    if (/href[^\n]{0,80}(company\.site|app\.ecwid\.com)/.test(src)) bad.push(n);
  }
  assert.deepEqual(bad, [], 'these scripts link to Ecwid');
});

test('no shopper-facing script hrefs a product or offer url field', () => {
  /* p.url / r.url / i.url are all the same trap: a catalogue or crawl record's
     own URL, which for SADKO's rows points off this site. compare.js may
     still href r.url for OTHER retailers — that is asserted separately
     below — so this check looks for the SADKO branch specifically. */
  const bad = [];
  for (const n of SHOPPER_FACING) {
    const src = read(n);
    if (/href="'\s*\+\s*esc\((?:p|prod|i|it)\.url\)/.test(src)) bad.push(n + ' (esc(x.url))');
    if (/href="\$\{(?:p|prod|i|it)\.url\}/.test(src)) bad.push(n + ' (${x.url})');
  }
  assert.deepEqual(bad, [], 'these scripts href a record url');
});

test('the comparer does not offer to buy from SADKO off-site', () => {
  const src = read('compare.js');
  /* The SADKO branch must not carry r.url, and must not open a new tab. */
  const row = /const isSadko = [\s\S]{0,2600}?<\/article>/.exec(src);
  assert.ok(row, 'the offer row markup is gone');
  const sadkoBranch = /\(isSadko\s*\n?\s*\?([\s\S]{0,300}?)\n\s*:/.exec(row[0]);
  assert.ok(sadkoBranch, 'the SADKO branch of the buy button is gone');
  assert.ok(!/r\.url/.test(sadkoBranch[1]), 'the SADKO row still hrefs the crawled listing url');
  assert.ok(!/_blank/.test(sadkoBranch[1]), 'the SADKO row still opens a new tab');
  assert.match(sadkoBranch[1], /sadkoSearchHref/);
});

test('the SADKO row goes to this site\'s own search', () => {
  const src = read('compare.js');
  const fn = /function sadkoSearchHref\(title\)[\s\S]{0,700}?\n  \}/.exec(src)[0];
  assert.match(fn, /shop\.html\?q=/);
  assert.match(fn, /encodeURIComponent/);
});

test('the SADKO label no longer promises an outbound jump', () => {
  /* The ↗ arrow means "this leaves the site". */
  const src = read('compare.js');
  const labels = [...src.matchAll(/buySadko: '([^']*)'/g)].map(m => m[1]);
  assert.equal(labels.length, 2, 'expected an Arabic and an English label');
  for (const l of labels) {
    assert.ok(!l.includes('↗'), 'the outbound arrow is back on: ' + l);
    assert.ok(!/اشترى من صادكو|Buy from SADKO/.test(l),
      'the label still says "buy from SADKO", which is not what it does: ' + l);
  }
});

test('OTHER retailers are still linked out — that is what a comparer is for', () => {
  /* The fix must not have broken the comparer itself. */
  const src = read('compare.js');
  assert.match(src, /href="\$\{r\.url\}" target="_blank" rel="noopener"/,
    'the non-SADKO offer link is gone');
  assert.match(src, /href="\$\{l\.url\}" target="_blank" rel="noopener"/,
    'the store search links are gone');
});

test('the concierge call-to-action is still a phone call, not a link away', () => {
  assert.match(read('compare.js'), /class="cc-cta" href="tel:19140"/);
});

test('a mailto is not an outbound buy link', () => {
  /* Guard against this suite being tightened into uselessness: the support
     address appears in several files and must keep working. */
  const withMail = SHOPPER_FACING.filter(n => /mailto:csupport@sadko-group\.com/.test(read(n)));
  assert.ok(withMail.length >= 2, 'the support address vanished from the site');
});

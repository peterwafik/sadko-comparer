// product.js is a browser IIFE, so this is a source-level guard rather than a
// behavioural test: every id that wire() looks up must still be produced by the
// render path, and render() must still hand off to wire() and guides() once the
// markup exists. Renaming an id, or dropping either call, would otherwise fail
// silently in the UI — nothing throws, the button/form/box just never wires up.
//
// To make the guard mean something (rather than a whole-file grep that would
// also pass if render() rendered nothing at all), each check is scoped to the
// specific function body that is supposed to produce it, using a brace-counting
// extractor. product.js has no object/array literal braces embedded inside its
// HTML string literals (verified by inspection), so counting `{`/`}` from a
// function's opening brace to its matching close is a reliable boundary here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/product.js', import.meta.url), 'utf8');

function functionBody(source, name) {
  const head = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*{');
  const m = head.exec(source);
  assert.ok(m, 'function ' + name + ' not found in source');
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0) {
    assert.ok(i < source.length, 'unbalanced braces while scanning ' + name + '()');
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

const renderBody = functionBody(src, 'render');
const headBody = functionBody(src, 'head');
const qaPanelBody = functionBody(src, 'qaPanel');

function hasId(body, id) {
  return body.includes('id="' + id + '"') || body.includes("id='" + id + "'");
}

test('head() still emits id="btnSave" (wire() binds the save toggle to it)', () => {
  assert.ok(hasId(headBody, 'btnSave'), 'head() no longer emits id btnSave');
});

test('qaPanel() still emits id="qaForm" (wire() binds the Q&A submit handler to it)', () => {
  assert.ok(hasId(qaPanelBody, 'qaForm'), 'qaPanel() no longer emits id qaForm');
});

test('render() still emits an empty id="guidesBox" container for guides() to fill', () => {
  assert.ok(hasId(renderBody, 'guidesBox'), 'render() no longer emits id guidesBox');
});

test('render() still invokes wire(...) and guides(...) after building the markup', () => {
  assert.match(renderBody, /\bwire\s*\(/, 'render() no longer calls wire()');
  assert.match(renderBody, /\bguides\s*\(/, 'render() no longer calls guides()');
});

test('render() calls head(...) and qaPanel(...) so their ids actually reach the page', () => {
  assert.match(renderBody, /\bhead\s*\(/, 'render() no longer calls head()');
  assert.match(renderBody, /\bqaPanel\s*\(/, 'render() no longer calls qaPanel()');
});

test('the section functions the PDP relies on all still exist', () => {
  for (const fn of ['suitability', 'spaceCheck', 'goodToKnow', 'energyPanel',
                    'specsPanel', 'reviewsPanel', 'qaPanel', 'guides', 'wire']) {
    assert.match(src, new RegExp('function\\s+' + fn + '\\s*\\('), 'missing ' + fn);
  }
});

/* ======================================================================
   The PDP stops handing the shopper to Ecwid.

   The page's one primary button used to be an outbound link to p.url —
   Ecwid's own storefront — opened in a new tab. So the page that exists to
   give buying guidance ended by sending the buyer somewhere else to buy.
   These guards are what stop that regressing, and they are source-level for
   the same reason as the ids above: nothing throws when a button quietly
   goes back to being a link.
   ================================================================== */

const galleryBody = functionBody(src, 'gallery');
const payPanelBody = functionBody(src, 'payPanel');
const stockLineBody = functionBody(src, 'stockLine');
const wireBody = functionBody(src, 'wire');
const specsBody = functionBody(src, 'specsPanel');
const descBody = functionBody(src, 'descLines');

test('NOTHING on the product page links out to the Ecwid storefront any more', () => {
  /* p.url is the Ecwid product URL. The page may still carry it in the cart
     record, but it must not be rendered as a destination. */
  assert.ok(!/href="'\s*\+\s*esc\(p\.url\)/.test(src),
    'the page hrefs p.url again — that is the Ecwid storefront');
  assert.ok(!/target="_blank"/.test(headBody),
    'head() opens a new tab again, which it only ever did to reach Ecwid');
});

test('head() offers add-to-cart and buy-now instead', () => {
  assert.ok(hasId(headBody, 'btnAdd'), 'head() no longer emits id btnAdd');
  assert.ok(hasId(headBody, 'btnBuy'), 'head() no longer emits id btnBuy');
});

test('buy-now goes to the site checkout, not anywhere else', () => {
  assert.match(headBody, /btnBuy[\s\S]{0,120}checkout\.html/);
});

test('wire() binds both buy controls, or they are dead markup', () => {
  assert.match(wireBody, /#btnAdd/);
  assert.match(wireBody, /#btnBuy/);
});

test('add-to-cart honours a refusal rather than claiming success', () => {
  /* skCart.add returns false for a product Ecwid reports out of stock. The
     button must not say "added" in that case. */
  assert.match(wireBody, /skCart\.add\(p\) === false/);
});

test('buy-now does not add a second copy of something already in the cart', () => {
  assert.match(wireBody, /skCart\.items\(\)[\s\S]{0,160}String\(p\.id\)/);
});

/* ------------------------------- gallery -------------------------------- */

test('the gallery renders the whole images[] array, not just the first image', () => {
  /* 427 products in the live store carry 2-7 images and the page rendered
     one. This is the single most visible thing Ecwid's page had that ours
     did not. */
  assert.match(galleryBody, /p\.images/);
  assert.match(galleryBody, /imgs\.map/);
});

test('a single-image product gets no thumbnail strip', () => {
  assert.match(galleryBody, /imgs\.length < 2/);
});

test('the gallery falls back to p.image when images[] is absent', () => {
  /* The seed catalogue has no images[] at all, so the Ecwid flag being off
     must not blank the product page. */
  assert.match(galleryBody, /\[p\.image\]/);
});

test('thumbnails are real buttons, so they are reachable by keyboard', () => {
  assert.match(galleryBody, /<button type="button" class="pdp__thumb/);
  assert.match(galleryBody, /aria-label=/);
});

test('render() actually calls gallery() — the frame is no longer inline', () => {
  assert.match(renderBody, /\bgallery\s*\(/);
});

test('wire() switches the main image when a thumbnail is chosen', () => {
  assert.match(wireBody, /pdpMain/);
  assert.match(wireBody, /pdp__thumb/);
});

/* --------------------------- Ecwid-only fields -------------------------- */

test('the page shows availability, which it never used to', () => {
  assert.match(renderBody + headBody, /stockLine\(/);
});

test('a remaining count is printed ONLY when Ecwid is tracking the quantity', () => {
  /* An untracked product's quantity field is not a stock figure. Printing it
     would invent scarcity the store never claimed. */
  assert.match(stockLineBody, /stockTracked === true/);
  const low = /q <= 5[\s\S]{0,400}/.exec(stockLineBody);
  assert.ok(low, 'the low-stock branch is gone');
  assert.ok(/tracked &&/.test(stockLineBody), 'the count is no longer gated on tracking');
});

test('the SKU reaches the specifications list', () => {
  assert.match(specsBody, /String\(p\.sku \|\| ''\)\.trim\(\)/);
  assert.match(specsBody, /Product code/);
});

test('a weight is shown only when one was actually entered', () => {
  /* 0 is Ecwid "unset" and the mapper already nulls it; a weight decides a
     real delivery charge, so it must never be implied. */
  assert.match(specsBody, /if \(p\.weight\)/);
});

/* ------------------------ instalments and payment ----------------------- */

test('the product page no longer shows the distracting guidance panels', () => {
  /* The owner asked for these off the product page: they distracted from the
     product. Household size and space live in the finder, payment and
     instalments in checkout. The functions stay (below), only unrendered. */
  for (const fn of ['payPanel', 'suitability', 'spaceCheck', 'goodToKnow', 'energyPanel']) {
    assert.ok(!new RegExp('\\b' + fn + '\\s*\\(').test(renderBody), 'render() shows ' + fn + ' again');
  }
  assert.ok(!/api\/payment-methods/.test(src), 'the product page still fetches the payment methods it no longer shows');
  assert.match(renderBody, /specsPanel\(p, s\)/, 'the specifications section must stay');
});

test('the specifications show only the rows that have a value', () => {
  assert.match(specsBody, /rows\.filter\(r => r\[1\] != null/);
  assert.ok(!/not stated|غير متوفر/.test(specsBody), 'an empty row is labelled "not stated" again');
  assert.ok(!/'؟'/.test(specsBody), 'a "?" placeholder can reach the dimensions row again');
});

test('a restricted plan names the brand it is restricted to', () => {
  /* Ecwid cannot enforce a product restriction on a manual method, so the
     page says it rather than silently offering an 18-month Kiriazi plan on a
     Samsung television. */
  assert.match(payPanelBody, /m\.restricted/);
  assert.match(payPanelBody, /m\.brand/);
});

test('the payment panel quotes no instalment figure', () => {
  /* A monthly amount depends on the term and the provider approval. Printing
     one would be a quoted price with no basis. */
  assert.ok(!/شهرياً|\/month|per month/.test(payPanelBody),
    'the panel appears to quote a monthly instalment');
});

test('the panel still says plainly that no card is taken', () => {
  assert.match(payPanelBody, /بيانات بطاقة/);
  assert.match(payPanelBody, /card details/);
});

test('an empty methods list renders nothing rather than an empty panel', () => {
  assert.match(payPanelBody, /if \(!list\.length\) return '';/);
});

/* ---------------------------- the description --------------------------- */

test('the rich description is rendered when the detail endpoint supplied one', () => {
  assert.match(specsBody, /descLines\(p\)/);
  assert.match(descBody, /p\.descriptionHtml/);
});

test('description markup is parsed inert and re-escaped, never written as HTML', () => {
  assert.match(descBody, /createElement\('template'\)/);
  assert.ok(!/descriptionHtml\s*\+/.test(specsBody + descBody), 'descriptionHtml is concatenated into markup again');
  assert.match(specsBody, /esc\(x\.v\)/);
});

test('the plain description is still the fallback, so the flag being off is safe', () => {
  assert.match(descBody, /S\.norm\(p\.description\)/);
});

test('specifications and the SADKO description are one bulleted list, not two sections', () => {
  assert.match(specsBody, /class="spec-list"/);
  assert.ok(!/<details|الوصف الأصلى من صادكو/.test(specsBody), 'the separate description box is back');
});

/* -------------------------- the loads fail soft ------------------------- */

test('the detail read fails soft — it cannot blank the page', () => {
  const mount = functionBody(src, 'mountProduct');
  const detail = functionBody(mount, 'detail');
  assert.match(detail, /\.catch\(\(\) => null\)/);
});

test('a product still renders from the list entry when there is no detail endpoint', () => {
  const mount = functionBody(src, 'mountProduct');
  assert.match(mount, /extra \? Object\.assign\(\{\}, p, extra\) : p/);
});

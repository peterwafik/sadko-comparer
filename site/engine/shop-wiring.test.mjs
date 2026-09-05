// shop.js is a browser IIFE with no exports, so — exactly like product-ids.test.mjs
// — this is a source-level guard rather than a behavioural test, and says so.
// It exists because the branch review found shop.js completely untested while all
// three late fix rounds landed in it, and because the search box (finding 1) is
// wired here: the renderers and the URL/catalogue logic are covered by
// storefront.test.mjs and shop-core.test.mjs, but nothing checked that shop.js
// actually connects the two.
//
// Every assertion is scoped to the specific function that must contain it, using
// the same brace-counting extractor product-ids.test.mjs uses. A whole-file grep
// would pass against a shop.js that rendered a search box and never wired it, or
// wired it in a function that is never called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/shop.js', import.meta.url), 'utf8');

function functionBody(source, name) {
  const head = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*{');
  const m = head.exec(source);
  assert.ok(m, 'function ' + name + ' not found in shop.js');
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

// Comment-stripped copy, for the two whole-file scans below: shop.js documents in
// prose the bugs it fixed, so a raw grep for the old code would match the comment
// explaining why that code is gone. Only /* */ blocks and full-line // comments are
// removed; shop.js contains no "//" inside a string literal (asserted below).
const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
                .split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');

const renderHub = functionBody(src, 'renderHub');
const renderBrowse = functionBody(src, 'renderBrowse');
const wireSearch = functionBody(src, 'wireSearch');
const wireBrowse = functionBody(src, 'wireBrowse');
const localizePromos = functionBody(src, 'localizePromos');
const liveBands = functionBody(src, 'liveBands');

test('the extractor really isolated the functions it is about to assert over', () => {
  // guards the guard: an extractor that returned '' would make every
  // "body.includes(...)" assertion below fail loudly, but a too-greedy one that
  // returned the whole file would make them all vacuously pass.
  assert.ok(renderHub.includes('U.promoHero'), 'renderHub body looks wrong');
  assert.ok(!renderHub.includes('function renderBrowse'), 'renderHub body swallowed the next function');
  assert.ok(wireBrowse.includes('#facetClear'), 'wireBrowse body looks wrong');
  assert.ok(!wireBrowse.includes('function render('), 'wireBrowse body swallowed the next function');
});

/* ---------------------------------------------------------------- search --- */

test('the hub renders a search box and wires it', () => {
  assert.match(renderHub, /U\.searchBox\(/, 'hub renders no search box');
  assert.match(renderHub, /wireSearch\(/, 'hub search box is rendered but never wired');
});

test('the browse view wires the toolbar search box and tells it the current term', () => {
  // storefront.test.mjs asserts toolbar() emits the field and populates it from
  // state.q; this asserts shop.js binds it. Passing state.q as the third argument
  // is what makes an unchanged resubmit a no-op instead of a duplicate history entry.
  assert.match(wireBrowse, /wireSearch\(root,/, 'browse never calls wireSearch');
  assert.match(wireBrowse, /\}, state\.q\);/, 'wireSearch is not told the current term');
});

test('a search submit navigates through go() with the term and page 1', () => {
  assert.match(wireBrowse, /\{ q: q, page: 1/, 'search submit does not reset to page 1 with the new term');
  assert.match(renderHub, /q: q,/, 'hub search submit does not carry the term');
});

test('wireSearch cancels the native submit rather than reloading the page', () => {
  assert.match(wireSearch, /addEventListener\('submit'/);
  assert.match(wireSearch, /ev\.preventDefault\(\)/);
});

test('wireSearch restores focus after the re-render that destroys the input', () => {
  assert.match(wireSearch, /FOCUS_SEARCH = true/);
  assert.match(wireSearch, /input\.focus\(\)/);
});

test('shop.js has no "//" inside a string literal, so the comment strip is safe', () => {
  assert.ok(!/['"`][^'"`\n]*\/\//.test(src),
    'a string literal contains "//" — the comment strip above would corrupt it');
});

test('every catalogue filter call passes the EN title translator', () => {
  // Without the 4th argument shop-core.filter() cannot match an English query
  // against the Arabic catalogue — the regression the review caught. The three
  // facet-count calls need it too, or a facet count disagrees with the result set
  // it claims to count. Arguments are read with a balanced-paren scan, because
  // three of the four calls nest Object.assign(...) inside.
  const calls = [];
  for (let i = code.indexOf('C.filter('); i >= 0; i = code.indexOf('C.filter(', i + 1)) {
    let j = i + 'C.filter('.length;
    let depth = 1;
    while (depth > 0 && j < code.length) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
      j++;
    }
    assert.equal(depth, 0, 'unbalanced C.filter( call at offset ' + i);
    calls.push(code.slice(i, j));
  }
  assert.ok(calls.length >= 4, 'expected at least 4 C.filter() calls, found ' + calls.length);
  for (const call of calls) {
    assert.ok(/,\s*TR\s*\)$/.test(call), 'C.filter call with no translator: ' + call);
  }
});

test('the search term survives every other facet change', () => {
  const applyForm = functionBody(wireBrowse, 'applyForm');
  assert.match(applyForm, /q: state\.q/, 'changing a facet would drop the search term');
});

test('"clear filters" clears the search term too', () => {
  // It is rendered inside the same results column as the other facets; leaving it
  // set would make the button visibly not clear what is narrowing the results.
  const clearIdx = wireBrowse.indexOf("#facetClear");
  assert.ok(clearIdx > 0, '#facetClear handler not found');
  const handler = wireBrowse.slice(clearIdx, clearIdx + 900);
  assert.match(handler, /go\(\{ cat: '', q: '',/, 'clear filters does not reset q');
});

test('the pager and price bands keep the search term in their hrefs', () => {
  // both build their target from Object.assign({}, state, …) — state carries q, so
  // a page-2 link or a price band inside a search stays inside that search.
  assert.match(renderBrowse, /U\.pager\(pg\.page, pg\.pages, function \(n\) \{/);
  assert.match(renderBrowse, /Object\.assign\(\{\}, state, \{ cat: fixed \? '' : state\.cat, page: n \}\)/);
  assert.match(functionBody(src, 'bandHref'), /Object\.assign\(\{\}, base,/);
});

/* -------------------------------------------------- delegated pure logic --- */

test('promo localisation is delegated to the tested shop-core helper', () => {
  assert.match(localizePromos, /C\.localizePromos\(promos, EN/);
  // the dishonest Arabic fallback must not come back
  assert.ok(!/titleEn \|\| /.test(code), 'the `titleEn || title` Arabic fallback is back in shop.js');
  assert.ok(!/subEn \|\| /.test(code));
  assert.ok(!/ctaEn \|\| /.test(code));
});

test('price-band bucketing is delegated to shop-core so counts cannot drift from filter()', () => {
  assert.match(liveBands, /C\.bandCounts\(products\)/);
  assert.ok(!liveBands.includes('p.price >= b.min'), 'liveBands re-implements the band boundaries locally');
});

/* ------------------------------------------- gaps the fix-wave re-review found --- */

// Nothing pinned what TR is bound to: the re-review showed that hardcoding
// `var TR = null` passed all 398 tests while silently restoring the branch review's
// finding 1 — an English shopper matching nothing in an Arabic-only catalogue.
test('TR binds to the EN title translator, not to null', () => {
  assert.match(code, /var TR = EN \? U\.translateForEN : null;/,
    'TR is no longer bound to U.translateForEN in EN mode');
});

// The translator must reach the results list AND all three facet counts, or a facet
// advertises a count the grid then contradicts.
test('every filter() call is passed TR, so facet counts cannot drift from the grid', () => {
  const body = functionBody(src, 'renderBrowse');
  // C.filter(...) takes nested Object.assign(...) arguments, so a lazy [^)]* stops
  // at the first inner ')' and reads the call as truncated. Balance the parens.
  const calls = [];
  for (let i = body.indexOf('C.filter('); i !== -1; i = body.indexOf('C.filter(', i + 1)) {
    let j = i + 'C.filter('.length, depth = 1;
    while (depth > 0 && j < body.length) {
      if (body[j] === '(') depth++;
      else if (body[j] === ')') depth--;
      j++;
    }
    calls.push(body.slice(i, j));
  }
  assert.equal(calls.length, 4, 'expected 4 C.filter() calls in renderBrowse (results + 3 facet counts)');
  calls.forEach(c => assert.ok(/,\s*TR\s*\)$/.test(c), 'filter() call missing the TR translator: ' + c));
});

// go()'s category pinning broke three separate times on this branch — pager hrefs,
// price-band hrefs, and the category radio — so pin the rule itself rather than each
// caller: on a page carrying data-cat, go() stays on location.pathname and strips
// `cat` from the query (render() reasserts it from the attribute).
test('go() keeps a pinned category page on its own path', () => {
  const body = functionBody(src, 'go');
  assert.match(body, /getAttribute\('data-cat'\)/, 'go() no longer reads data-cat');
  assert.match(body, /fixed \? location\.pathname : P\('shop\.html'\)/,
    'go() no longer pins a category page to its own path');
  assert.match(body, /cat: ''/, 'go() no longer strips cat from a pinned page URL');
});

// Emptying the search box on a pinned category page must not write `?all=1`:
// render() forces all:false there, so the flag changes nothing and only leaves a
// URL that contradicts the cat/min/max beside it.
test('clearing the search box does not write ?all=1 on a pinned category page', () => {
  const body = functionBody(src, 'wireBrowse');
  const idx = body.indexOf('wireSearch(');
  assert.ok(idx > 0, 'wireSearch call not found in wireBrowse');
  const handler = body.slice(idx, idx + 600);
  assert.ok(!/all: state\.all \|\| !q/.test(handler),
    'the unpinned `all: state.all || !q` is back — it writes ?all=1 on category pages');
  assert.match(handler, /data-cat[\s\S]*state\.all \|\| !q/,
    'the all flag is no longer gated on the page being unpinned');
});

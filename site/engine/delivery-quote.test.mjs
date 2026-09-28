// site/engine/delivery-quote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rateCard, quoteDelivery } from './ecwid-shipping.mjs';
import { toShippingMethodForTest } from './ecwid-sync.mjs';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/ecwid-shipping-options.json', import.meta.url), 'utf8'));
const METHODS = RAW.map(toShippingMethodForTest).filter(m => m.enabled);
const CARD = rateCard(METHODS);
const q = (governorate, lines) => quoteDelivery({ governorate, lines, card: CARD });

test('the rate card reads the real store: metro, both banded regions, and crafts', () => {
  assert.deepEqual([CARD.metro.cairo.perOrder, CARD.metro.cairo.perItem], [200, 50]);
  assert.ok(CARD.metro.giza && CARD.metro.alex);
  assert.deepEqual(['small', 'medium', 'large', 'xl'].map(k => CARD.delta[k].perItem), [275, 525, 630, 1140]);
  assert.deepEqual(['small', 'medium', 'large', 'xl'].map(k => CARD.upper[k].perItem), [330, 605, 845, 1320]);
  assert.equal(CARD.craft.perOrder, 50);
  assert.deepEqual(CARD.problems, []);
});

test('the worked examples from the spec', () => {
  const cart = [{ id: 'f', qty: 1, cls: 'xl' }, { id: 'a', qty: 1, cls: 'small' }];
  const sohag = q('سوهاج', cart);
  assert.equal(sohag.quotable, true);
  assert.equal(sohag.fee, 1650);
  assert.deepEqual(sohag.lines.map(l => l.fee), [1320, 330]);
  assert.equal(q('القاهرة', cart).fee, 300);
});

test('metro has no cap: five items cost 200 + 5 × 50', () => {
  assert.equal(q('الجيزة', [{ id: 'x', qty: 5, cls: 'small' }]).fee, 450);
});

// Review focus 5
test('quantity multiplies the per-item band rate', () => {
  assert.equal(q('الدقهلية', [{ id: 'x', qty: 3, cls: 'medium' }]).fee, 3 * 525);
});

test('crafts: a flat 50 in Cairo and Giza, added to appliances, refused elsewhere', () => {
  assert.equal(q('القاهرة', [{ id: 'c', qty: 2, cls: 'craft' }]).fee, 50);
  assert.equal(q('الجيزة', [{ id: 'c', qty: 1, cls: 'craft' }, { id: 'f', qty: 1, cls: 'large' }]).fee, 50 + 200 + 50);
  assert.deepEqual(q('الإسكندرية', [{ id: 'c', qty: 1, cls: 'craft' }]), { quotable: false, reason: 'craft-area' });
});

test('anything unknown refuses the whole quote rather than half of it', () => {
  assert.deepEqual(q('شمال سيناء', [{ id: 'x', qty: 1, cls: 'small' }]), { quotable: false, reason: 'no-region' });
  assert.deepEqual(q('سوهاج', [{ id: 'x', qty: 1, cls: 'small' }, { id: 'y', qty: 1, cls: null }]),
    { quotable: false, reason: 'unclassified', id: 'y' });
  const noUpperXl = rateCard(METHODS.filter(m => !(/كبيرة جدا/.test(m.title) && /الصعيد/.test(m.title))));
  assert.deepEqual(quoteDelivery({ governorate: 'أسوان', lines: [{ id: 'x', qty: 1, cls: 'xl' }], card: noUpperXl }),
    { quotable: false, reason: 'no-rate', id: 'x' });
});

// Review focus 3
test('before the first sync there is no card, and the quote says so without throwing', () => {
  assert.equal(rateCard([]), null);
  assert.deepEqual(quoteDelivery({ governorate: 'القاهرة', lines: [{ id: 'x', qty: 1, cls: 'small' }], card: null }),
    { quotable: false, reason: 'no-rates' });
});

test('a tiered table is reported, never half-applied', () => {
  const tiered = METHODS.map(m => /الدلتا/.test(m.title) && /صغيرة/.test(m.title)
    ? { ...m, rates: { basedOn: 'weight', rows: [{ from: 0, to: 10, perOrder: 0, perItem: 275 }, { from: 10, to: null, perOrder: 0, perItem: 400 }] } } : m);
  const c = rateCard(tiered);
  assert.equal(c.delta.small, undefined);
  assert.ok(c.problems.some(p => p.code === 'tiered'));
});

test('the store delivery-time sentence travels with the quote', () => {
  assert.ok(q('سوهاج', [{ id: 'x', qty: 1, cls: 'small' }]).notes.some(n => /14/.test(n)));
});

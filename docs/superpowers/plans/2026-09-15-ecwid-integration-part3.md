# Ecwid Backend Integration Implementation Plan — Part 3 (Tasks 11–15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 1 (Tasks 1–6):** `docs/superpowers/plans/2026-09-15-ecwid-integration.md`
**Part 2 (Tasks 7–10):** `docs/superpowers/plans/2026-09-15-ecwid-integration-part2.md`
**Spec:** `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`

**Global Constraints:** as stated in Part 1. Two bear directly on this part:
- **Never synthesise a shipping cost or grand total.** `createOrder` stores `grandTotal: null` deliberately, because delivery and installation are confirmed by customer care.
- **Task 1's recorded answer governs Task 12.** `site/engine/fixtures/README.md` names the verified Ecwid field that holds and can be queried for the local `SDK-` ref. Do not begin Task 12 while that is still a placeholder.

---

### Task 11: `toEcwidOrder` and `toLocalStatus`

**Files:**
- Modify: `site/engine/ecwid-map.mjs`
- Test: `site/engine/ecwid-map.test.mjs`

**Interfaces:**
- Consumes: a local order as `createOrder` builds it (`engine/accounts.mjs`) — `{ ref, items:[{id,title,price,qty,image}], subtotal, payment, delivery:{name,phone,governorate,address,floor,hasLift}, note, totals }` — and a user `{ email, name, phone }`.
- Produces:
  - `toEcwidOrder(localOrder, user)` → Ecwid order payload. Throws on an unknown payment method.
  - `toLocalStatus(ecwidOrder)` → one of `received, confirmed, preparing, shipping, delivered, cancelled`, or `null` when Ecwid's status maps to nothing meaningful.
  - `PAYMENT_MAP` — the exported table, so a test can assert it covers exactly the site's three methods.
  - `FEES_NOTE_AR` — the exact Arabic fees-to-be-confirmed sentence.

- [ ] **Step 1: Write the failing tests**

Append to `site/engine/ecwid-map.test.mjs`:

```js
import { toEcwidOrder, toLocalStatus, PAYMENT_MAP, FEES_NOTE_AR } from './ecwid-map.mjs';

const ORDER = (over = {}) => ({
  ref: 'SDK-A1B2C3',
  createdAt: '2026-09-15T10:00:00.000Z',
  status: 'received',
  items: [
    { id: '676766143', title: 'مبرد مياه كولدير', price: 6999, qty: 1, image: 'i.webp' },
    { id: '678016981', title: 'ثلاجة كريازي', price: 15785, qty: 2, image: 'j.webp' },
  ],
  subtotal: 6999 + 15785 * 2,
  payment: 'cod',
  delivery: { name: 'محمد علي', phone: '+201000000000', governorate: 'القاهرة',
              address: 'شارع ١٠', floor: '3', hasLift: true },
  note: 'اتصل قبل التوصيل',
  totals: { subtotal: 6999 + 15785 * 2, deliveryFee: null, installFee: null,
            grandTotal: null, currency: 'EGP', note: FEES_NOTE_AR },
  ...over });
const USER = { email: 'buyer@example.com', name: 'محمد علي', phone: '+201000000000' };

test('every line item is carried with its id, quantity and price', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].productId, 676766143);     // Ecwid wants a number
  assert.equal(o.items[0].quantity, 1);
  assert.equal(o.items[0].price, 6999);
  assert.equal(o.items[1].quantity, 2);
});

test('the local ref travels with the order so the push can be made idempotent', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.ok(JSON.stringify(o).includes('SDK-A1B2C3'), 'the SDK- ref must appear somewhere queryable');
});

test('the customer email and delivery details are carried', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.equal(o.email, 'buyer@example.com');
  assert.equal(o.shippingPerson.name, 'محمد علي');
  assert.equal(o.shippingPerson.phone, '+201000000000');
  assert.match(o.shippingPerson.street, /شارع ١٠/);
});

test('floor and lift reach the order, because they decide how delivery is done', () => {
  const o = toEcwidOrder(ORDER(), USER);
  const blob = JSON.stringify(o);
  assert.ok(blob.includes('3'), 'floor is missing');
  assert.match(o.orderComments, /مصعد|بدون مصعد/);
});

/* ---- totals: the honesty rule (spec SS7.5) ---- */

test('the order total is the items subtotal and nothing else', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.equal(o.subtotal, 38569);
  assert.equal(o.total, 38569);
});

test('no shipping cost is ever invented', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.equal(o.shippingOption, undefined, 'a shipping option would imply a decided cost');
  assert.ok(!('shippingRate' in o), 'a shipping rate must not be fabricated');
});

test('the fees-to-be-confirmed note travels on the order', () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.ok(o.orderComments.includes(FEES_NOTE_AR),
    'the Ecwid order must say what the customer receipt says');
});

test('the fees note names delivery and installation in Arabic', () => {
  assert.match(FEES_NOTE_AR, /التوصيل/);
  assert.match(FEES_NOTE_AR, /التركيب/);
});

test("the customer's own note is kept alongside the fees note", () => {
  const o = toEcwidOrder(ORDER(), USER);
  assert.ok(o.orderComments.includes('اتصل قبل التوصيل'));
});

/* ---- payment ---- */

test('the payment table covers exactly the three methods the site offers', () => {
  assert.deepEqual(Object.keys(PAYMENT_MAP).sort(), ['bank', 'cod', 'showroom']);
});

test('cash on delivery maps to an awaiting-payment order', () => {
  const o = toEcwidOrder(ORDER({ payment: 'cod' }), USER);
  assert.equal(o.paymentStatus, 'AWAITING_PAYMENT');
  assert.match(o.paymentMethod, /\S/);
});

test('bank transfer and showroom pickup are also awaiting payment, never paid', () => {
  for (const m of ['bank', 'showroom']) {
    const o = toEcwidOrder(ORDER({ payment: m }), USER);
    assert.equal(o.paymentStatus, 'AWAITING_PAYMENT',
      `${m} must never be pushed as PAID — no money has been taken`);
  }
});

test('an unknown payment method THROWS rather than guessing', () => {
  assert.throws(() => toEcwidOrder(ORDER({ payment: 'crypto' }), USER), /unknown payment method/i);
});

test('a missing payment method throws too', () => {
  assert.throws(() => toEcwidOrder(ORDER({ payment: undefined }), USER), /unknown payment method/i);
});

test('an order with no items throws rather than pushing an empty order', () => {
  assert.throws(() => toEcwidOrder(ORDER({ items: [] }), USER), /no items/i);
});

/* ---- status coming back ---- */

test('Ecwid fulfilment statuses map onto the site statuses', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'AWAITING_PROCESSING' }), 'received');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'PROCESSING' }), 'preparing');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SHIPPED' }), 'shipping');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'DELIVERED' }), 'delivered');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'READY_FOR_PICKUP' }), 'shipping');
});

test('a cancelled or refunded order maps to cancelled whatever the fulfilment says', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'PROCESSING', paymentStatus: 'CANCELLED' }), 'cancelled');
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SHIPPED', paymentStatus: 'REFUNDED' }), 'cancelled');
});

test('an unknown Ecwid status maps to null so the local status is left untouched', () => {
  assert.equal(toLocalStatus({ fulfillmentStatus: 'SOMETHING_NEW' }), null);
  assert.equal(toLocalStatus({}), null);
});

test('every value toLocalStatus can return is a real site status', () => {
  const ALLOWED = new Set(['received', 'confirmed', 'preparing', 'shipping', 'delivered', 'cancelled']);
  for (const f of ['AWAITING_PROCESSING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'WILL_NOT_DELIVER']) {
    const s = toLocalStatus({ fulfillmentStatus: f });
    if (s !== null) assert.ok(ALLOWED.has(s), `${f} produced "${s}", which is not a site status`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: FAIL — `toEcwidOrder is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `site/engine/ecwid-map.mjs`:

```js
/* ============================================================================
   Orders: SADKO -> Ecwid, and status back again.

   The load-bearing rule is SS7.5 of the spec: the site deliberately does not know
   the grand total, because delivery and installation depend on the appliance and
   the address and are confirmed by customer care. So the push sends the items
   subtotal, leaves shipping UNSET, and carries the same Arabic sentence the
   customer's receipt carries. Never add a shippingRate or a computed total here
   — a number invented in this function becomes a promise on a real order.
   ========================================================================== */

export const FEES_NOTE_AR =
  'رسوم التوصيل والتركيب تُؤكَّد من خدمة العملاء قبل التنفيذ.';

/* The site's three methods. No card capture exists, so nothing is ever PAID at
   the moment of ordering — every method is awaiting payment. */
export const PAYMENT_MAP = {
  cod:      { method: 'الدفع عند الاستلام / Cash on delivery', status: 'AWAITING_PAYMENT' },
  bank:     { method: 'تحويل بنكي / Bank transfer',            status: 'AWAITING_PAYMENT' },
  showroom: { method: 'الدفع في المعرض / Pay at showroom',      status: 'AWAITING_PAYMENT' },
};

export function toEcwidOrder(order, user = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) throw new Error('toEcwidOrder: no items');

  const pay = PAYMENT_MAP[String(order.payment || '')];
  if (!pay) throw new Error(`toEcwidOrder: unknown payment method "${order.payment}"`);

  const d = order.delivery || {};
  const subtotal = Number(order.subtotal) || items.reduce((n, i) => n + Number(i.price) * Number(i.qty), 0);

  const lift = d.hasLift ? 'يوجد مصعد' : 'بدون مصعد';
  const comments = [
    `مرجع الطلب: ${order.ref}`,                 // also the idempotency key — see SS7.2
    FEES_NOTE_AR,
    d.governorate ? `المحافظة: ${d.governorate}` : null,
    d.floor ? `الطابق: ${d.floor} (${lift})` : lift,
    order.note ? `ملاحظة العميل: ${order.note}` : null,
  ].filter(Boolean).join('\n');

  return {
    email: user.email || '',
    /* externalFulfillment tells Ecwid this order was created by us. The ref is
       ALSO in orderComments above, which is what findOrderByRef matches on when
       the dedicated external-id field is unavailable (Task 1's recorded answer). */
    externalOrderId: order.ref,
    createdDate: order.createdAt,

    items: items.map(i => ({
      productId: Number(i.id),
      name: i.title,
      price: Number(i.price),
      quantity: Number(i.qty),
      sku: i.sku || undefined,
    })),

    /* Items only. Shipping is deliberately absent, not zero: an explicit 0
       would read as free delivery, which is exactly the claim the receipt
       refuses to make. */
    subtotal,
    total: subtotal,

    paymentMethod: pay.method,
    paymentStatus: pay.status,
    fulfillmentStatus: 'AWAITING_PROCESSING',

    shippingPerson: {
      name: d.name || user.name || '',
      phone: d.phone || user.phone || '',
      street: [d.address, d.floor ? `الطابق ${d.floor}` : null].filter(Boolean).join(' — '),
      city: d.governorate || '',
      countryCode: 'EG',
    },

    orderComments: comments,
  };
}

/* Ecwid -> the site's own ORDER_STATUSES (engine/accounts.mjs:92).
   Anything unrecognised returns null, and the caller leaves the local status
   alone: inventing a transition would lie to the customer about their order. */
const FULFILMENT = {
  AWAITING_PROCESSING: 'received',
  QUEUED: 'received',
  PROCESSING: 'preparing',
  READY_FOR_PICKUP: 'shipping',
  SHIPPED: 'shipping',
  OUT_FOR_DELIVERY: 'shipping',
  DELIVERED: 'delivered',
  WILL_NOT_DELIVER: 'cancelled',
  RETURNED: 'cancelled',
};
const DEAD_PAYMENT = new Set(['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

export function toLocalStatus(o = {}) {
  if (DEAD_PAYMENT.has(String(o.paymentStatus || '').toUpperCase())) return 'cancelled';
  const f = String(o.fulfillmentStatus || '').toUpperCase();
  return FULFILMENT[f] || null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test engine/ecwid-map.test.mjs`
Expected: PASS, 41 tests (22 from Tasks 3–4 plus 19 here).

- [ ] **Step 5: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/engine/ecwid-map.mjs site/engine/ecwid-map.test.mjs
git commit -m "feat(ecwid): order mapping with no fabricated totals

toEcwidOrder sends the items subtotal, leaves shipping UNSET rather than
zero, and carries the same Arabic fees-to-be-confirmed sentence the
customer receipt carries. An explicit 0 would read as free delivery, which
is the exact claim checkout.js refuses to make.

The payment table covers the site's three methods and nothing else, and an
unknown or missing method throws: a wrong payment status on a real order is
worse than a failed push. Nothing is ever pushed as PAID, because no money
has been taken at ordering time.

toLocalStatus returns null for any Ecwid status it does not recognise, so
the caller leaves the local status untouched rather than inventing a
transition and lying to the customer."
```

---

### Task 12: The push queue and the idempotent worker

**Do not start this task while `site/engine/fixtures/README.md` still contains the placeholder.** Task 1 records which Ecwid field holds and can be queried for the `SDK-` ref; `findOrderByRef` in `ecwid-api.mjs` must match that recorded answer before this worker can be trusted.

**Files:**
- Modify: `site/engine/ecwid-store.mjs` — add migration 2 and the queue methods
- Modify: `site/engine/ecwid-sync.mjs` — add `pushPendingOrders()` and `pushOrder(ref)`
- Test: `site/engine/ecwid-push.test.mjs`

**Interfaces:**
- Consumes: `toEcwidOrder` (Task 11), `api.createOrder` / `api.findOrderByRef` (Task 2).
- Produces, on the store: `enqueueOrderPush(ref)`, `nextDuePush(nowISO)` → row or `null`, `markPushed(ref, ecwidOrderId)`, `markPushFailed(ref, error, nextAttemptAt)`, `pushRow(ref)`, `pendingPushes()`, `failedPushes()`, `resetPush(ref)`.
  On the sync: `pushOrder(ref, { loadOrder, loadUser })` → `{ ok, ecwidOrderId?, adopted?, error? }`, and `pushPendingOrders({ loadOrder, loadUser })` → `{ pushed, failed }`.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-push.test.mjs`:

```js
// site/engine/ecwid-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openEcwidStore } from './ecwid-store.mjs';
import { createEcwidSync } from './ecwid-sync.mjs';
import { FEES_NOTE_AR } from './ecwid-map.mjs';

const ORDER = {
  ref: 'SDK-A1B2C3', createdAt: '2026-09-15T10:00:00.000Z',
  items: [{ id: '676766143', title: 'مبرد', price: 6999, qty: 1 }],
  subtotal: 6999, payment: 'cod',
  delivery: { name: 'محمد', phone: '+201000000000', governorate: 'القاهرة', address: 'ش ١٠' },
  note: '',
};
const USER = { email: 'buyer@example.com', name: 'محمد', phone: '+201000000000' };
const loaders = { loadOrder: async () => ORDER, loadUser: async () => USER };

function fresh(api) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-push-'));
  const store = openEcwidStore(path.join(dir, 'ecwid.db'));
  const sync = createEcwidSync({ api, store });
  return { store, sync, cleanup: () => { try { store.close(); } catch (e) {} rmSync(dir, { recursive: true, force: true }); } };
}
const stub = over => ({ configured: true, listProducts: async () => ({ items: [], total: 0, count: 0 }),
  listCategories: async () => [], listAllProductIds: async () => new Set(), getProduct: async () => null,
  findOrderByRef: async () => null, createOrder: async () => ({ id: 'EC-1' }), ...over });

test('enqueue then push stores the Ecwid order id against the ref', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, true);
    assert.equal(r.ecwidOrderId, 'EC-1');
    assert.equal(store.pushRow('SDK-A1B2C3').ecwid_order_id, 'EC-1');
  } finally { cleanup(); }
});

test('the payload sent to Ecwid carries the subtotal and the fees note', async () => {
  let sent = null;
  const { store, sync, cleanup } = fresh(stub({ createOrder: async p => { sent = p; return { id: 'EC-2' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(sent.total, 6999);
    assert.ok(sent.orderComments.includes(FEES_NOTE_AR));
    assert.ok(!('shippingRate' in sent), 'no shipping cost may be invented');
  } finally { cleanup(); }
});

/* ---- idempotency: the bug that would ship a customer two fridges ---- */

test('a push whose response was lost ADOPTS the existing Ecwid order instead of duplicating', async () => {
  let created = 0;
  const { store, sync, cleanup } = fresh(stub({
    findOrderByRef: async ref => ref === 'SDK-A1B2C3' ? { id: 'EC-EXISTING' } : null,
    createOrder: async () => { created++; return { id: 'EC-NEW' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(created, 0, 'a duplicate order must never be created');
    assert.equal(r.adopted, true);
    assert.equal(r.ecwidOrderId, 'EC-EXISTING');
  } finally { cleanup(); }
});

test('pushing the same ref twice creates exactly one Ecwid order', async () => {
  let created = 0;
  const seen = new Map();
  const { store, sync, cleanup } = fresh(stub({
    findOrderByRef: async ref => seen.get(ref) ? { id: seen.get(ref) } : null,
    createOrder: async p => { created++; const id = 'EC-' + created; seen.set(p.externalOrderId, id); return { id }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(created, 1);
  } finally { cleanup(); }
});

test('an already-pushed ref is not pushed again by the worker', async () => {
  let created = 0;
  const { store, sync, cleanup } = fresh(stub({ createOrder: async () => { created++; return { id: 'EC-1' }; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const r = await sync.pushPendingOrders(loaders);
    assert.equal(r.pushed, 0);
    assert.equal(created, 1);
  } finally { cleanup(); }
});

/* ---- failure handling ---- */

test('a failed push is retried later, not lost', async () => {
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { const e = new Error('ecwid-503'); e.status = 503; throw e; } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    const r = await sync.pushOrder('SDK-A1B2C3', loaders);
    assert.equal(r.ok, false);
    const row = store.pushRow('SDK-A1B2C3');
    assert.equal(row.attempts, 1);
    assert.match(row.last_error, /503/);
    assert.ok(row.next_attempt_at, 'a retry must be scheduled');
    assert.equal(row.ecwid_order_id, null);
  } finally { cleanup(); }
});

test('the retry backs off — each attempt is scheduled further out', async () => {
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { throw new Error('down'); } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const first = store.pushRow('SDK-A1B2C3').next_attempt_at;
    store.resetPush('SDK-A1B2C3');                 // make it due again
    await sync.pushOrder('SDK-A1B2C3', loaders);
    const second = store.pushRow('SDK-A1B2C3').next_attempt_at;
    assert.ok(Date.parse(second) > Date.parse(first), 'backoff must increase');
  } finally { cleanup(); }
});

test('after the attempt cap the order parks as failed and is surfaced, never dropped', async () => {
  const { store, sync, cleanup } = fresh(stub({
    createOrder: async () => { throw new Error('down'); } }));
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    for (let i = 0; i < 8; i++) { store.resetPush('SDK-A1B2C3'); await sync.pushOrder('SDK-A1B2C3', loaders); }
    const failed = store.failedPushes();
    assert.equal(failed.length, 1);
    assert.equal(failed[0].ref, 'SDK-A1B2C3');
    assert.ok(failed[0].attempts >= 6);
  } finally { cleanup(); }
});

test('an unknown payment method parks the order rather than pushing a wrong status', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-BAD');
    const r = await sync.pushOrder('SDK-BAD', {
      loadOrder: async () => ({ ...ORDER, ref: 'SDK-BAD', payment: 'crypto' }),
      loadUser: async () => USER });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown payment method/i);
  } finally { cleanup(); }
});

test('nextDuePush skips a row whose retry time has not arrived', () => {
  const { store, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-A1B2C3');
    store.markPushFailed('SDK-A1B2C3', 'down', '2099-01-01T00:00:00.000Z');
    assert.equal(store.nextDuePush('2026-09-15T00:00:00.000Z'), null);
    assert.ok(store.nextDuePush('2099-06-01T00:00:00.000Z'));
  } finally { cleanup(); }
});

test('pushPendingOrders drains everything due', async () => {
  const { store, sync, cleanup } = fresh(stub({ createOrder: async p => ({ id: 'EC-' + p.externalOrderId }) }));
  try {
    for (const ref of ['SDK-1', 'SDK-2', 'SDK-3']) store.enqueueOrderPush(ref);
    const r = await sync.pushPendingOrders({
      loadOrder: async ref => ({ ...ORDER, ref }), loadUser: async () => USER });
    assert.equal(r.pushed, 3);
    assert.equal(store.pendingPushes().length, 0);
  } finally { cleanup(); }
});

test('a missing local order parks rather than crashing the worker', async () => {
  const { store, sync, cleanup } = fresh(stub());
  try {
    store.enqueueOrderPush('SDK-GONE');
    const r = await sync.pushOrder('SDK-GONE', { loadOrder: async () => null, loadUser: async () => USER });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/i);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-push.test.mjs`
Expected: FAIL — `store.enqueueOrderPush is not a function`.

- [ ] **Step 3: Add migration 2 and the queue methods to `ecwid-store.mjs`**

Append to the `MIGRATIONS` array:

```js
}, {
  id: 2, name: 'order push queue',
  sql: `
  CREATE TABLE IF NOT EXISTS order_push (
    ref TEXT PRIMARY KEY,
    ecwid_order_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    pushed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS order_push_due ON order_push(pushed_at, next_attempt_at);
  `,
}];
```

Add the prepared statements beside the others, and the methods to the returned object:

```js
  const MAX_ATTEMPTS = 6;
  const pqIns = db.prepare('INSERT INTO order_push (ref, attempts, next_attempt_at, created_at) VALUES (?,0,?,?) ' +
                           'ON CONFLICT(ref) DO NOTHING');
  const pqGet = db.prepare('SELECT * FROM order_push WHERE ref = ?');
  const pqDue = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS +
                           " AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1");
  const pqOk = db.prepare('UPDATE order_push SET ecwid_order_id = ?, pushed_at = ?, last_error = NULL WHERE ref = ?');
  const pqBad = db.prepare('UPDATE order_push SET attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE ref = ?');
  const pqPend = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts < ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const pqFail = db.prepare('SELECT * FROM order_push WHERE pushed_at IS NULL AND attempts >= ' + MAX_ATTEMPTS + ' ORDER BY created_at');
  const pqReset = db.prepare('UPDATE order_push SET next_attempt_at = NULL WHERE ref = ?');
```

```js
    /* ---- order push queue (spec SS7.1) ----
       An order is written locally FIRST and only then queued here, so a push
       that never succeeds costs visibility, never the order itself. */
    MAX_PUSH_ATTEMPTS: MAX_ATTEMPTS,
    enqueueOrderPush(ref) { pqIns.run(String(ref), null, nowISO()); },
    pushRow(ref) { return pqGet.get(String(ref)) || null; },
    nextDuePush(at = nowISO()) { return pqDue.get(at) || null; },
    markPushed(ref, ecwidOrderId) { pqOk.run(String(ecwidOrderId), nowISO(), String(ref)); },
    markPushFailed(ref, error, nextAttemptAt) {
      pqBad.run(String(error).slice(0, 500), nextAttemptAt || null, String(ref));
    },
    pendingPushes: () => pqPend.all(),
    failedPushes: () => pqFail.all(),
    resetPush(ref) { pqReset.run(String(ref)); },
```

- [ ] **Step 4: Add the worker to `ecwid-sync.mjs`**

Add the import at the top:

```js
import { toSadkoProduct, toSadkoCategory, toEcwidOrder } from './ecwid-map.mjs';
```

Change the `map` default to `{ toSadkoProduct, toSadkoCategory, toEcwidOrder }`, then add inside `createEcwidSync`:

```js
  /* ---- pushing orders into Ecwid -----------------------------------------
     check-then-create. If a previous attempt succeeded but its response was
     lost, creating again would put a SECOND order in front of staff and the
     customer would be shipped twice. So we always look for our ref first and
     adopt what we find. Never reorder these two calls. */
  const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

  async function pushOrder(ref, { loadOrder, loadUser }) {
    const row = store.pushRow(ref);
    if (row && row.ecwid_order_id) return { ok: true, ecwidOrderId: row.ecwid_order_id, already: true };

    const schedule = attempts =>
      new Date(Date.now() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]).toISOString();
    const park = (msg, attempts) => {
      store.markPushFailed(ref, msg, schedule(attempts));
      console.error(`[ecwid] order push ${ref} failed: ${msg}`);
      return { ok: false, error: msg };
    };
    const attempts = row ? row.attempts : 0;

    let order, user, payload;
    try {
      order = await loadOrder(ref);
      if (!order) return park('local order not found', attempts);
      user = await loadUser(order);
      payload = map.toEcwidOrder(order, user);          // throws on unknown payment
    } catch (e) { return park(String(e.message || e), attempts); }

    try {
      const existing = await api.findOrderByRef(ref);
      if (existing && existing.id) {
        store.markPushed(ref, existing.id);
        return { ok: true, ecwidOrderId: String(existing.id), adopted: true };
      }
      const created = await api.createOrder(payload);
      const id = created && (created.id ?? created.orderId);
      if (id == null) return park('ecwid returned no order id', attempts);
      store.markPushed(ref, id);
      return { ok: true, ecwidOrderId: String(id) };
    } catch (e) { return park(String(e.message || e), attempts); }
  }

  async function pushPendingOrders(loaders) {
    let pushed = 0, failed = 0;
    for (let i = 0; i < 25; i++) {                      // bounded, so one tick cannot run forever
      const due = store.nextDuePush();
      if (!due) break;
      const r = await pushOrder(due.ref, loaders);
      r.ok ? pushed++ : failed++;
      if (!r.ok) break;        // the next due row is usually blocked by the same outage
    }
    return { pushed, failed };
  }
```

Add both to the returned object: `pushOrder, pushPendingOrders,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test engine/ecwid-push.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 6: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/engine/ecwid-store.mjs site/engine/ecwid-sync.mjs site/engine/ecwid-push.test.mjs
git commit -m "feat(ecwid): idempotent order push queue

The order is written locally first and only then queued, so a push that
never succeeds costs visibility, never the order.

The worker does check-then-create: it looks for our SDK- ref in Ecwid and
adopts what it finds before creating anything. A push whose response was
lost would otherwise put a second order in front of staff and ship the
customer twice — a test asserts pushing the same ref twice creates exactly
one Ecwid order.

Failures back off over six attempts and then park as failed, surfaced for
manual retry rather than dropped. An unknown payment method parks the order
instead of pushing a wrong payment status."
```

---

### Task 13: Wire checkout, and let status flow back

**Files:**
- Modify: `site/compare-server.mjs` — the `/api/orders` POST handler (around line 2297), and `applyEcwidOrderEvent` (the Task 8 stub)
- Modify: `site/engine/accounts.mjs` — add `orderByRefAny(ref)` and `setOrderStatus` reuse
- Test: `site/engine/ecwid-wiring.test.mjs`

**Interfaces:**
- Consumes: `pushOrder`/`pushPendingOrders` (Task 12), `toLocalStatus` (Task 11), `db.allOrders()` / `db.setOrderStatus()` (existing).
- Produces: `orderByRefAny(ref)` on the accounts store → the order regardless of owner, needed because a webhook has no session. And `applyEcwidOrderEvent(ev)` in the server.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-wiring.test.mjs`:

```js
// site/engine/ecwid-wiring.test.mjs
// Asserts the server WIRES the pieces together. compare-server.mjs is a server
// module, so this reads the source — the same approach shop-wiring.test.mjs uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(import.meta.dirname, '..', 'compare-server.mjs'), 'utf8');

test('a placed order is enqueued for Ecwid', () => {
  const handler = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  assert.match(handler, /enqueueOrderPush/, 'checkout does not queue an Ecwid push');
});

test('the local order is created BEFORE the push is queued', () => {
  const handler = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  const created = handler.indexOf('createOrder');
  const queued = handler.indexOf('enqueueOrderPush');
  assert.ok(created > -1 && queued > created,
    'the customer receipt must be written before anything reaches Ecwid');
});

test('the checkout response never waits on Ecwid', () => {
  const handler = /u\.pathname === '\/api\/orders' && req\.method === 'POST'[\s\S]{0,1400}/.exec(src)[0];
  assert.ok(!/await\s+(ecwidSync\(\)|es)\.pushOrder/.test(handler),
    'checkout must not await the Ecwid push — an Ecwid outage would block the sale');
});

test('the order webhook is handled rather than stubbed', () => {
  assert.ok(!/order event ignored for now/.test(src), 'the Task 8 stub is still in place');
  assert.match(src, /async function applyEcwidOrderEvent[\s\S]{0,900}toLocalStatus/);
});

test('an unmapped Ecwid status leaves the local status untouched', () => {
  const fn = /async function applyEcwidOrderEvent[\s\S]{0,900}?\n\}/.exec(src)[0];
  assert.match(fn, /if\s*\(\s*!\s*(status|local)\s*\)\s*return/,
    'an unmapped status must return early, not write a guessed status');
});

test('the push worker runs on a timer so parked orders are retried', () => {
  assert.match(src, /pushPendingOrders/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-wiring.test.mjs`
Expected: FAIL on the enqueue assertion.

- [ ] **Step 3: Add `orderByRefAny` to `engine/accounts.mjs`**

A webhook carries no session, so the order must be findable without a user id. Add beside `orderByRef`:

```js
    /* A webhook has no session, so status updates arriving from Ecwid need the
       order by ref alone. Deliberately separate from orderByRef(userId, ref),
       which stays scoped to its owner for anything a customer can reach. */
    orderByRefAny: ref => store.allOrders().find(o => o.ref === ref) || null,
```

- [ ] **Step 4: Wire the checkout handler**

In `site/compare-server.mjs`, extend the existing `/api/orders` POST handler. Insert after the `recordPurchase` block and before the `return`:

```js
        /* Hand the order to Ecwid so staff fulfil it from the desk they know.
           Deliberately NOT awaited: the customer's receipt already exists, and
           an Ecwid outage must never block a sale or delay the response. The
           queue and its timer own delivery from here. */
        try {
          const store = ecwidStore(), es = ecwidSync();
          if (store && es) {
            store.enqueueOrderPush(r.order.ref);
            es.pushOrder(r.order.ref, ORDER_LOADERS).catch(e =>
              console.error('[ecwid] immediate push failed, queued for retry:', e.message));
          }
        } catch (e) { console.error('[ecwid] could not queue order push:', e.message); }
```

Add the loaders and the status handler above the request handler, replacing the Task 8 stub:

```js
/* How the push worker finds an order and its customer. Kept in one place so
   the timer, the immediate push and the admin retry all load identically. */
const ORDER_LOADERS = {
  loadOrder: async ref => { const db = accounts(); return db ? db.orderByRefAny(ref) : null; },
  loadUser: async order => {
    const db = accounts();
    const u = db && order ? db.getUser(order.userId) : null;
    return u || { email: '', name: (order.delivery || {}).name || '', phone: (order.delivery || {}).phone || '' };
  },
};

/* Status flowing back from Ecwid: staff mark an order shipped there, the
   customer sees it here. An unmapped Ecwid status leaves the local status
   ALONE — inventing a transition would lie to the customer about their order. */
async function applyEcwidOrderEvent(ev) {
  const api = ecwidApi(), db = accounts();
  if (!api || !db) return;
  const remote = await api.getOrder(ev.entityId);
  if (!remote) return;
  const ref = remote.externalOrderId ||
    (/(SDK-[A-Z0-9]{6})/.exec(String(remote.orderComments || '')) || [])[1];
  if (!ref) return;
  const status = toLocalStatus(remote);
  if (!status) return;
  const local = db.orderByRefAny(ref);
  if (!local || local.status === status) return;
  const r = db.setOrderStatus(ref, status);
  if (r && r.error) return console.error('[ecwid] status update rejected:', r.error);
  console.log(`[ecwid] order ${ref} -> ${status} (from Ecwid ${ev.entityId})`);
}
```

Add the import beside the other map imports:

```js
import { toLocalStatus } from './engine/ecwid-map.mjs';
```

- [ ] **Step 5: Add the push timer**

Inside the `HTTP_SERVER.listen` callback, beside the sync timers from Task 7:

```js
    // Parked and pending order pushes: retried every 2 minutes.
    setInterval(() => { es.pushPendingOrders(ORDER_LOADERS).catch(() => {}); }, 2 * 60 * 1000).unref();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test engine/ecwid-wiring.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/compare-server.mjs site/engine/accounts.mjs site/engine/ecwid-wiring.test.mjs
git commit -m "feat(ecwid): checkout queues a push, status flows back from Ecwid

/api/orders writes the local order first and only then queues the Ecwid
push, without awaiting it: the customer's receipt already exists, and an
Ecwid outage must never block a sale. A test asserts that ordering and
asserts the handler does not await the push.

order.updated events map Ecwid's fulfilment status onto the site's own
ORDER_STATUSES, so staff keep working in Ecwid and the customer sees the
result here. An unmapped Ecwid status returns early and leaves the local
status alone rather than inventing a transition.

accounts gains orderByRefAny, since a webhook carries no session; the
owner-scoped orderByRef stays as it is for anything a customer can reach."
```

---

### Task 14: Admin becomes a read-only window

**Files:**
- Modify: `site/compare-server.mjs` — the `/api/admin/*` block (around lines 1943–2160)
- Modify: `site/assets/js/admin.js` — product and order editors become read-only; add the sync panel
- Test: `site/engine/ecwid-admin.test.mjs`

**Interfaces:**
- Consumes: `ecwidSource().describe()` (Task 7), `store.pendingPushes()` / `failedPushes()` / `resetPush()` (Task 12), `sync.syncProducts` / `fullReconcile` / `pushOrder` (Tasks 6, 12).
- Produces: `GET /api/admin/ecwid` → `{ ecwid: describe(), pending, failed }`; `POST /api/admin/ecwid/sync` → `{ ok, written, removed }`; `POST /api/admin/ecwid/push/:ref` → `{ ok, ecwidOrderId? }`.

- [ ] **Step 1: Write the failing tests**

Create `site/engine/ecwid-admin.test.mjs`:

```js
// site/engine/ecwid-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SITE = path.join(import.meta.dirname, '..');
const src = readFileSync(path.join(SITE, 'compare-server.mjs'), 'utf8');
const adminJs = readFileSync(path.join(SITE, 'assets', 'js', 'admin.js'), 'utf8');

test('the admin exposes an Ecwid status route', () => {
  assert.match(src, /rest === 'ecwid' && req\.method === 'GET'/);
});

test('the admin can trigger a sync and retry a failed push', () => {
  assert.match(src, /ecwid\/sync|seg\[0\] === 'ecwid' && seg\[1\] === 'sync'/);
  assert.match(src, /seg\[1\] === 'push'/);
});

test('no admin response can carry the token', () => {
  /* describe() is the only thing the panel receives, and it reports counts and
     the last error. Nothing may read the token env var into a response. */
  const block = /if \(u\.pathname\.startsWith\('\/api\/admin\/'\)\)[\s\S]*?\n  \}/.exec(src)[0];
  assert.ok(!/SADKO_ECWID_TOKEN/.test(block), 'the admin block must never touch the token');
});

test('product editing is disabled for Ecwid-owned fields while Ecwid is the source', () => {
  assert.match(src, /ECWID_OWNED_FIELDS/);
  const owned = /const ECWID_OWNED_FIELDS = \[([^\]]*)\]/.exec(src)[1];
  for (const f of ['title', 'price', 'image', 'description', 'categoryId'])
    assert.match(owned, new RegExp("'" + f + "'"), `${f} should be Ecwid-owned`);
  assert.ok(!/'badge'/.test(owned), 'badge is site-only and must stay editable');
});

test('a PATCH touching an Ecwid-owned field is refused with a clear reason', () => {
  assert.match(src, /ecwid-owned/);
});

test('the admin UI shows a sync panel and links out to Ecwid', () => {
  assert.match(adminJs, /ecwid/i);
  assert.match(adminJs, /my\.ecwid\.com|ecwid\.com\/store/, 'no deep link to the Ecwid admin');
});

test('the admin order desk no longer offers a local status control while Ecwid owns it', () => {
  assert.match(adminJs, /ECWID_READONLY|ecwidReadOnly/,
    'admin.js must gate the local status editor when Ecwid owns order status');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test engine/ecwid-admin.test.mjs`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Add the server routes**

In `site/compare-server.mjs`, declare the owned-field list beside `EDITABLE_FIELDS`'s import:

```js
/* Fields Ecwid owns once it is the catalogue source. The owner edits these in
   Ecwid, not here, so there is exactly one writer per field and a local
   override can never silently mask a future Ecwid price change. `badge` is
   absent deliberately: Ecwid has no equivalent, so it stays site-only. */
const ECWID_OWNED_FIELDS = ['title', 'price', 'image', 'description', 'categoryId', 'url', 'brand'];
```

Inside the `/api/admin/` block, add before the `return json(404, ...)`:

```js
      /* ------- Ecwid connection and sync ------- */
      if (rest === 'ecwid' && req.method === 'GET') {
        const st = ecwidStore();
        return json(200, {
          ecwid: ecwidSource().describe(),          // counts + last error only, never a token
          ownedFields: ECWID_OWNED_FIELDS,
          pending: st ? st.pendingPushes() : [],
          failed: st ? st.failedPushes() : [],
        });
      }

      if (seg[0] === 'ecwid' && seg[1] === 'sync' && req.method === 'POST') {
        const es = ecwidSync();
        if (!es) return json(503, { error: 'ecwid-off', message: lang === 'en'
          ? 'Ecwid is not connected.' : 'إكويد غير متصل.' });
        await es.syncCategories();
        const r = await es.fullReconcile();
        cadm.log(actor, 'ecwid.sync', null, r);
        return json(200, { ok: true, ...r, ecwid: ecwidSource().describe() });
      }

      if (seg[0] === 'ecwid' && seg[1] === 'push' && seg[2] && req.method === 'POST') {
        const es = ecwidSync(), st = ecwidStore();
        if (!es || !st) return json(503, { error: 'ecwid-off' });
        const ref = decodeURIComponent(seg[2]);
        st.resetPush(ref);                          // make it due now
        const r = await es.pushOrder(ref, ORDER_LOADERS);
        cadm.log(actor, 'ecwid.push', ref, r);
        return json(r.ok ? 200 : 400, r);
      }
```

Guard the product PATCH so Ecwid-owned fields cannot be written while Ecwid is the source. In the existing `products/:id` PATCH branch, before `cadm.setOverride`:

```js
          if (ecwidSource().activeSource() === 'ecwid') {
            const touched = Object.keys(b || {}).filter(k => ECWID_OWNED_FIELDS.includes(k));
            if (touched.length) return json(409, {
              error: 'ecwid-owned',
              fields: touched,
              message: lang === 'en'
                ? `Edit these in Ecwid, not here: ${touched.join(', ')}. The catalogue syncs from Ecwid, so a local change would be overwritten.`
                : `عدّل هذه الحقول في إكويد لا هنا: ${touched.join('، ')}. الكتالوج يُزامن من إكويد، وأي تعديل محلي سيُستبدل.`,
            });
          }
```

Apply the same guard in the `products` POST (create) branch, refusing creation outright while Ecwid is the source:

```js
      if (seg[0] === 'products' && seg.length === 1 && req.method === 'POST') {
        if (ecwidSource().activeSource() === 'ecwid') return json(409, {
          error: 'ecwid-owned',
          message: lang === 'en'
            ? 'Add products in Ecwid. The catalogue syncs from there, so a product added here would disappear on the next sync.'
            : 'أضف المنتجات في إكويد. الكتالوج يُزامن من هناك، وأي منتج يُضاف هنا سيختفي مع المزامنة التالية.',
        });
        const b = await readJson(req, 80000);
        // ... existing body unchanged
```

- [ ] **Step 4: Update `admin.js`**

Add a sync panel and read-only gating. Fetch the status once on load and store it:

```js
  /* Ecwid owns the catalogue and order status. The control room shows what is
     synced and links out to Ecwid; it does not offer a second editor, because
     two writers on one field is how the two systems would drift. */
  var ECWID_READONLY = false;
  var ECWID_STORE_ID = '18028328';
  function ecwidAdminUrl(kind, id) {
    var base = 'https://my.ecwid.com/store/' + ECWID_STORE_ID;
    if (kind === 'product') return base + '#product:id=' + encodeURIComponent(id);
    if (kind === 'order') return base + '#order:id=' + encodeURIComponent(id);
    return base;
  }

  function loadEcwidStatus() {
    return api('GET', 'ecwid').then(function (d) {
      ECWID_READONLY = !!(d && d.ecwid && d.ecwid.source === 'ecwid');
      return d;
    }).catch(function () { return null; });
  }

  function renderEcwidPanel(d) {
    if (!d || !d.ecwid) return '';
    var e = d.ecwid;
    var connected = e.source === 'ecwid';
    var rows = [
      [t('الحالة', 'Status'), connected ? t('متصل بإكويد', 'Connected to Ecwid')
        : (e.enabled ? t('في انتظار أول مزامنة', 'Awaiting first sync') : t('غير متصل', 'Not connected'))],
      [t('المنتجات', 'Products'), String(e.products)],
      [t('الأقسام', 'Categories'), String(e.categories)],
      [t('آخر مزامنة', 'Last sync'), e.lastSync && e.lastSync.at ? e.lastSync.at : t('لا يوجد', 'none')],
      [t('آخر خطأ', 'Last error'), e.lastError || t('لا يوجد', 'none')],
      [t('طلبات في الانتظار', 'Pending pushes'), String((d.pending || []).length)],
      [t('طلبات متعثرة', 'Failed pushes'), String((d.failed || []).length)]
    ];
    var failed = (d.failed || []).map(function (f) {
      return '<li>' + esc(f.ref) + ' — ' + esc(f.last_error || '') +
        ' <button class="adm-retry" data-ref="' + esc(f.ref) + '">' + t('إعادة المحاولة', 'Retry') + '</button></li>';
    }).join('');
    return '<section class="adm-card"><h2>' + t('إكويد', 'Ecwid') + '</h2>' +
      '<table>' + rows.map(function (r) {
        return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p><a href="' + ecwidAdminUrl() + '" target="_blank" rel="noopener">' +
        t('افتح لوحة إكويد', 'Open the Ecwid admin') + '</a></p>' +
      '<button id="adm-ecwid-sync">' + t('زامن الآن', 'Sync now') + '</button>' +
      (failed ? '<h3>' + t('طلبات لم تصل إلى إكويد', 'Orders not yet in Ecwid') + '</h3><ul>' + failed + '</ul>' : '') +
      '</section>';
  }
```

Wire the two buttons where the other admin handlers are bound:

```js
    on(document, 'click', '#adm-ecwid-sync', function () {
      api('POST', 'ecwid/sync').then(function () { renderDashboard(); });
    });
    on(document, 'click', '.adm-retry', function (el) {
      api('POST', 'ecwid/push/' + encodeURIComponent(el.getAttribute('data-ref')))
        .then(function () { renderDashboard(); });
    });
```

In the product editor, when `ECWID_READONLY` is true, render the Ecwid-owned inputs disabled with an explanation and a deep link, leaving only `badge` editable:

```js
    var ownedNote = ECWID_READONLY
      ? '<p class="adm-note">' + t('الاسم والسعر والصورة والوصف والقسم تُدار في إكويد. عدّلها هناك وستظهر هنا خلال دقائق.',
          'Name, price, image, description and category are managed in Ecwid. Edit them there and they appear here within minutes.') +
        ' <a href="' + ecwidAdminUrl('product', p.id) + '" target="_blank" rel="noopener">' +
        t('افتح في إكويد', 'Open in Ecwid') + '</a></p>'
      : '';
```

In the order desk, when `ECWID_READONLY` is true, replace the status `<select>` with the current status as text plus a deep link:

```js
    var statusCell = ECWID_READONLY
      ? esc(statusLabel(o.status)) + ' <a href="' + ecwidAdminUrl('order', o.ecwidOrderId || o.ref) +
        '" target="_blank" rel="noopener">' + t('حدّثها في إكويد', 'Update in Ecwid') + '</a>'
      : statusSelect(o);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test engine/ecwid-admin.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the whole suite and commit**

Run: `node --test engine/*.test.mjs` — all green.

```bash
git add site/compare-server.mjs site/assets/js/admin.js site/engine/ecwid-admin.test.mjs
git commit -m "feat(admin): read-only window onto Ecwid, with a sync panel

The control room stops being a second editor. While Ecwid is the catalogue
source, a PATCH touching title, price, image, description, categoryId, url
or brand is refused with a message naming the fields and pointing at Ecwid,
and creating a product is refused outright — it would vanish on the next
sync. badge stays editable, since Ecwid has no equivalent.

Adds GET /api/admin/ecwid (counts, last error, pending and failed pushes),
a sync-now action, and per-order retry for pushes that parked. A test
asserts the admin block never so much as mentions the token env var.

The order desk shows status as text with a deep link to Ecwid, because
status is written in Ecwid now and two writers is how the two would drift."
```

---

### Task 15: Operations and rollout

**Files:**
- Modify: `LAUNCH.md` — new section
- Create: `site/tools/ecwid-preflight.mjs`
- Test: `site/engine/ecwid-docs.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: a documented runbook, and a preflight script that checks the connection without printing the token.

- [ ] **Step 1: Write the failing test**

Create `site/engine/ecwid-docs.test.mjs`:

```js
// site/engine/ecwid-docs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const launch = readFileSync(path.join(import.meta.dirname, '..', '..', 'LAUNCH.md'), 'utf8');

test('LAUNCH.md documents the Ecwid rollout', () => {
  assert.match(launch, /Ecwid/);
  assert.match(launch, /SADKO_ECWID/);
});

test('the runbook names all three environment values', () => {
  for (const k of ['SADKO_ECWID_STORE_ID', 'SADKO_ECWID_TOKEN', 'SADKO_ECWID_WEBHOOK_SECRET'])
    assert.match(launch, new RegExp(k), `${k} is undocumented`);
});

test('the runbook contains no real token value', () => {
  const sec = /## .*Ecwid[\s\S]*?(?=\n## |\n# |$)/.exec(launch)[0];
  assert.ok(!/SADKO_ECWID_TOKEN=(?!<|\.\.\.|your)\S{12,}/.test(sec),
    'a literal token appears to be pasted into the runbook');
});

test('the runbook requires the diff review before the flag goes on', () => {
  assert.match(launch, /ecwid-diff/);
});

test('the runbook covers a category added in Ecwid needing an English name and a rebuild', () => {
  const sec = /## .*Ecwid[\s\S]*?(?=\n## |\n# |$)/.exec(launch)[0];
  assert.match(sec, /mkcategories/);
});

test('the runbook covers the customer-email decision gate', () => {
  const sec = /## .*Ecwid[\s\S]*?(?=\n## |\n# |$)/.exec(launch)[0];
  assert.match(sec, /email/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test engine/ecwid-docs.test.mjs`
Expected: FAIL — LAUNCH.md has no Ecwid section.

- [ ] **Step 3: Write the preflight script**

Create `site/tools/ecwid-preflight.mjs`:

```js
/* Is the Ecwid connection healthy? Prints a verdict and never the token.
   From site/:  SADKO_ECWID=1 node tools/ecwid-preflight.mjs */
import { openEcwidApi } from '../engine/ecwid-api.mjs';

const tok = process.env.SADKO_ECWID_TOKEN || '';
const store = process.env.SADKO_ECWID_STORE_ID || '18028328';
console.log('store:', store);
console.log('token:', tok ? `present (${tok.length} chars)` : 'MISSING');
console.log('webhook secret:', process.env.SADKO_ECWID_WEBHOOK_SECRET ? 'present' : 'MISSING');
if (!tok) process.exit(1);

const api = openEcwidApi({ storeId: store, token: tok });
try {
  const page = await api.listProducts({ limit: 1 });
  console.log('products reachable — total:', page.total);
  const cats = await api.listCategories();
  console.log('categories reachable —', cats.length);
  console.log('\nOK');
} catch (e) {
  console.error('\nFAILED:', e.message);        // ecwid-api never puts the token in a message
  console.error(e.status === 403
    ? 'A 403 means the token is rejected or the plan does not include API access.'
    : 'Check connectivity and the store id.');
  process.exit(1);
}
```

- [ ] **Step 4: Add the runbook to `LAUNCH.md`**

Append this section:

```markdown
## Ecwid integration

The catalogue, the shop rails and order fulfilment are driven by the Ecwid store
that also backs sadko-group.com. Design: `docs/superpowers/specs/2026-09-15-ecwid-integration-design.md`.

### Configuration

Three values in `/etc/sadko.env`, read by `sadko.service`. **Put the token in
this file yourself and never paste it into a terminal, a commit, a chat message
or this document.**

```
SADKO_ECWID=1
SADKO_ECWID_STORE_ID=18028328
SADKO_ECWID_TOKEN=<from Ecwid: Settings -> Apps -> API access>
SADKO_ECWID_WEBHOOK_SECRET=<the custom app's client secret>
```

Then `systemctl restart sadko` and check the connection without revealing it:

```
cd /srv/sadko/site && SADKO_ECWID=1 node tools/ecwid-preflight.mjs
```

A 403 means the token is rejected or the plan does not include API access.

### Webhooks

Register `https://<live-host>/api/ecwid/webhook` in the custom app's settings and
subscribe to `product.created`, `product.updated`, `product.deleted`,
`category.*` and `order.updated`. Unsigned or wrongly signed deliveries are
rejected with 401; a missing `SADKO_ECWID_WEBHOOK_SECRET` rejects everything,
which is deliberate — a misconfigured server must be closed, not open.

Missed events are not a problem: an incremental pull runs every 15 minutes and a
full reconcile runs daily.

### Turning it on (in this order)

1. Configure the values above with `SADKO_ECWID` still **unset**. Nothing changes.
2. Set `SADKO_ECWID=1`, restart, and let the first sync finish. The mirror fills
   while the seed is still being served.
3. **Review the diff before customers see it:**
   `SADKO_ECWID=1 node tools/ecwid-diff.mjs`
   It reports additions, removals, reprices, real discounts and out-of-stock
   counts. At the time of writing that was 77 added and 38 removed against the
   July snapshot. If the numbers look wrong, stop and investigate — do not
   proceed.
4. Confirm the storefront switched: `GET /api/admin/ecwid` should report
   `source: "ecwid"`.
5. Register the webhooks, then change a price in Ecwid and confirm it appears
   within seconds.
6. Enable order push by placing one real test order, then confirm it appears
   once — and only once — in the Ecwid orders screen.
7. Decide the customer email (below).

Rolling back is setting `SADKO_ECWID=` and restarting; the seed file is still
there and untouched.

### The customer confirmation email

The site has never sent email: confirmation is the on-screen receipt plus a call
on 19140, and the receipt deliberately refuses to show delivery as zero. Ecwid
can email the customer, and that email may render unset shipping as free, which
would contradict the receipt.

So Ecwid's **staff** notification is on and the **customer** email stays off
until this is checked: place a test order, read the email Ecwid actually sends,
and only enable it if the fees-to-be-confirmed line survives in the template.
An email implying free delivery is a false statement to a customer — leave it off
and report back rather than shipping it.

### When staff add a category in Ecwid

Categories sync as data, but `site/category/*.html` are 30 static pages generated
from a hardcoded Arabic-and-English name map with build-time asserts. A new Ecwid
category therefore has no page, and `node site/mkcategories.mjs` will fail the
assert — on purpose, because an English category name cannot be invented.

To add one: get the English name from the owner, add the id to `NAMES` and the
name pair to `CAT_EN` in both `site/mkcategories.mjs` and `site/assets/js/nav.js`
(they must stay in sync), run `node site/mkcategories.mjs`, and deploy.

### Where things live

| Concern | Owner |
|---|---|
| Products, prices, stock, categories, was-prices | **Ecwid** |
| Order fulfilment and status | **Ecwid** |
| عروض صادكو / الأكثر مبيعاً / مختارات صادكو rails | **Derived** from Ecwid — not editable |
| Advertisement banners (`promos.json`) | SADKO admin — Ecwid has no banner entity |
| Buying guides, finder questions | SADKO admin |
| Customer accounts, saved homes, the comparer | SADKO — unaffected by Ecwid |
| Product `badge` | SADKO admin — Ecwid has no equivalent |
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test engine/ecwid-docs.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite**

Run: `node --test engine/*.test.mjs`
Expected: all green; the total is well above the original 483.

- [ ] **Step 7: Commit**

```bash
git add LAUNCH.md site/tools/ecwid-preflight.mjs site/engine/ecwid-docs.test.mjs
git commit -m "docs(ecwid): rollout runbook and preflight check

LAUNCH.md gains the ordered switch-on procedure, which requires reviewing
tools/ecwid-diff.mjs output BEFORE the flag goes on in production — 77
additions and 38 removals should not reach customers unseen.

tools/ecwid-preflight.mjs verifies the connection and reports the token as
present-with-a-length, never its value; a test asserts no literal token was
pasted into the runbook.

Also documents the two things that will otherwise surprise someone later:
a category added in Ecwid needs an English name and a mkcategories rebuild,
and the customer confirmation email stays off until someone has actually
read what Ecwid sends."
```

---

## Plan self-review

**Spec coverage.** Every section maps to a task: §4.1 modules → Tasks 2–6; §4.2 server changes → Tasks 7, 8, 10, 13, 14; §5.1 product shape → Task 3; §5.2 three sync paths → Tasks 6–8; §5.3 precedence → Tasks 5, 7, 14; §5.4 out-of-stock → Tasks 3, 9; §5.5 was-prices and the guard rewrite → Tasks 3, 9; §6.1 rails → Task 9; §6.2 banners → Task 10; §7.1–7.5 orders → Tasks 11–13; §7.6 email → Task 15; §7.7 stock → Task 12 (a push decrements Ecwid stock as a consequence, no code needed); §8 admin → Task 14; §9.1 secrets → Task 15; §9.2 new categories → Task 15; §10 degradation → Tasks 6, 7, 12; §10.1 cut scope → no task, deliberately; §11 testing → distributed; §12 rollout → Tasks 7, 15; §13 open item → Task 1.

**Type consistency.** `toSadkoProduct` emits `categoryIds` (Task 3), which `deriveRails` reads (Task 9) and the store round-trips (Task 5). `toEcwidOrder` emits `externalOrderId` (Task 11), which `findOrderByRef` matches and `applyEcwidOrderEvent` reads back (Tasks 2, 13). `store.pushRow().ecwid_order_id` is snake_case throughout, matching the SQL column. `ORDER_LOADERS` is defined once in Task 13 and reused by Task 14's retry route.

**Known follow-ups, deliberately out of scope.** The product card and product page still need to *render* `inStock` and `compareToPrice` — the data arrives in Task 3 and the rails use it in Task 9, but the visual treatment of an unavailable product and a was-price is storefront design work, and it belongs in its own scoped change rather than being smuggled in here. Flag it to the owner when Task 9 lands.

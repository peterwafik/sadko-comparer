/* ============================================================================
   Do the customer and order shapes we assumed actually match Ecwid's?

   Run from site/:
     node tools/ecwid-preflight.mjs

   WHY THIS EXISTS. Everything the site does with customers and orders was
   written against Ecwid's documented model and NEVER against a real payload,
   because the configured token is a `public_` one and /customers and /orders
   both answer 403. That is a normal state to be in — but this project has
   already been bitten four times by a guessed Ecwid field name:

     trackQuantity          was really  unlimited
     requiresShipping       was really  isShippingRequired
     a top-level brand      was really  an attribute
     /orders/calculate      was really  /order/calculate

   Each one was found by a feature quietly doing nothing. The readers in
   engine/ecwid-customers.mjs therefore accept several plausible spellings
   rather than betting on one — but "it still works" is not the same as
   "we know which name is real", and the shapes below decide what a customer
   sees on their own orders page.

   So: the FIRST thing to run once a secret_ token is in place. It reads one
   customer and one order, reports which assumed field names are actually
   present, and names the ones that are missing — before a customer finds them
   for us.

   READ-ONLY. It creates nothing, changes nothing, and deletes nothing.
   The token is never printed. No customer's name, email, address or phone is
   ever written to the terminal: this reports FIELD NAMES and whether a value
   was present, never the value.
   ========================================================================== */

import { ecwidEnv, describeEnv } from './ecwid-env.mjs';

const env = ecwidEnv();
const BASE = `https://app.ecwid.com/api/v3/${env.storeId}`;

/* Colour only when a terminal is attached, so a redirected log stays clean. */
const tty = process.stdout.isTTY;
const g = s => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const r = s => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const y = s => (tty ? `\x1b[33m${s}\x1b[0m` : s);
const dim = s => (tty ? `\x1b[2m${s}\x1b[0m` : s);

async function call(pathAndQuery) {
  const res = await fetch(BASE + pathAndQuery, {
    headers: {
      Authorization: `Bearer ${env.token}`,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  try { return JSON.parse(text); } catch { throw new Error('malformed JSON'); }
}

/* Every field the site reads, and where it reads it. `alts` are the other
   spellings the readers already tolerate — if the real name turns out to be
   one of those, the code works but this says so, which is the point. */
const CUSTOMER_FIELDS = [
  { path: 'id', why: 'the customer id used to update the record' },
  { path: 'email', why: 'THE join key between Ecwid and the site' },
  { path: 'name', why: 'display name' },
  { path: 'registered', why: 'account vs guest checkout' },
  { path: 'billingPerson', why: 'phone and address are read from here' },
  { path: 'totalOrderCount', why: 'shown in the admin lookup', optional: true },
  { path: 'createDate', why: 'shown in the admin lookup', optional: true },
];

const ORDER_FIELDS = [
  { path: 'id', alts: ['orderNumber', 'vendorOrderNumber'], why: 'the reference shown to a customer for an Ecwid-origin order' },
  { path: 'email', why: 'how an order is attached to a customer' },
  { path: 'fulfillmentStatus', why: 'THE status axis the site maps to received/preparing/shipping/delivered' },
  { path: 'paymentStatus', why: 'cancelled and refunded override fulfilment' },
  { path: 'externalOrderId', alts: ['externalFulfillmentOrderId'], why: 'our SDK- ref — idempotency AND the webhook join' },
  { path: 'items', why: 'the order lines' },
  { path: 'subtotal', why: 'the figure shown; deliberately not recomputed' },
  { path: 'total', why: 'only trusted when above subtotal — means staff entered delivery', optional: true },
  { path: 'paymentMethod', why: 'shown on the order', optional: true },
  { path: 'orderComments', why: 'the customer note, and the fallback home of our ref', optional: true },
  { path: 'shippingPerson', alts: ['billingPerson'], why: 'delivery name, phone, governorate' },
  { path: 'createDate', alts: ['createdDate', 'updateDate'], why: 'the order date' },
];

const ITEM_FIELDS = [
  { path: 'productId', alts: ['id'], why: 'links the line back to the catalogue' },
  { path: 'name', alts: ['productName'], why: 'the line title' },
  { path: 'price', why: 'the line price' },
  { path: 'quantity', alts: ['qty'], why: 'the line quantity' },
  { path: 'sku', why: 'shown to staff', optional: true },
  { path: 'imageUrl', alts: ['smallThumbnailUrl'], why: 'the line thumbnail', optional: true },
];

/* Presence only. A value is NEVER printed — these are real customers. */
const present = (o, k) => o != null && o[k] != null && o[k] !== '';

function report(title, sample, fields) {
  console.log(`\n${title}`);
  if (!sample) { console.log(dim('  no sample available')); return { missing: [], viaAlt: [] }; }
  const missing = [], viaAlt = [];
  for (const f of fields) {
    if (present(sample, f.path)) {
      console.log(`  ${g('✓')} ${f.path}`);
      continue;
    }
    const hit = (f.alts || []).find(a => present(sample, a));
    if (hit) {
      viaAlt.push(`${f.path} → ${hit}`);
      console.log(`  ${y('~')} ${f.path}  ${y('is actually')} ${y(hit)}   ${dim(f.why)}`);
      continue;
    }
    if (f.optional) { console.log(`  ${dim('·')} ${dim(f.path + '  absent (optional)')}`); continue; }
    missing.push(f.path);
    console.log(`  ${r('✗')} ${f.path}  ${r('MISSING')}   ${dim(f.why)}`);
  }
  /* Names Ecwid sent that we do not read. Not a problem — but a field called
     something obviously relevant is how the four earlier mistakes announce
     themselves. */
  const known = new Set(fields.flatMap(f => [f.path, ...(f.alts || [])]));
  const extra = Object.keys(sample).filter(k => !known.has(k));
  if (extra.length) console.log(dim('  also present: ' + extra.slice(0, 22).join(', ')));
  return { missing, viaAlt };
}

async function main() {
  console.log('Ecwid preflight — customer and order shapes\n');
  console.log(describeEnv());
  if (!env.storeId || !env.hasToken) {
    console.log(r('\nNo store id or token. Set them in /etc/sadko.env or site/.ecwid.env.'));
    process.exitCode = 2;
    return;
  }

  /* --- can this token see them at all? ---

     ACCESS and DATA are tracked separately, because "readable but the store
     has none yet" is a real third state and the first version treated it as
     no access: a brand-new store answers 200 with zero orders, and the tool
     then claimed the scope was missing. */
  const access = { customers: false, orders: false };
  let customers = null, orders = null, blocked = false;
  for (const [label, path] of [['customers', '/customers?limit=1'], ['orders', '/orders?limit=1']]) {
    try {
      const page = await call(path);
      const items = (page && page.items) || [];
      const total = page && page.total != null ? page.total : items.length;
      access[label] = true;
      console.log(`${g('✓')} /${label} readable — ${total} in the store`
        + (total === 0 ? dim('  (nothing to check the shapes against yet)') : ''));
      if (label === 'customers') customers = items[0] || null;
      else orders = items[0] || null;
    } catch (e) {
      if (e.status === 403 || e.status === 401) {
        blocked = true;
        /* Report the token this deployment ACTUALLY has, rather than assuming
           a public one — once a secret token is in place, blaming the token
           sends the reader to fix the wrong thing. With a secret token a 403
           means the APP was never granted the scope. */
        const kind = env.tokenKind || (env.hasToken ? 'unknown' : 'none');
        console.log(`${r('✗')} /${label} → ${e.status}. `
          + (kind === 'secret'
              ? `The token is a ${g('secret_')} one, so this is a missing ${r('scope')}: `
                + `the app was never granted ${label} access.`
              : `This is a ${r('public_')} token; reading ${label} needs a ${g('secret_')} one.`));
      } else {
        console.log(`${r('✗')} /${label} → ${e.message}`);
      }
    }
  }

  /* PARTIAL access is the normal half-way state, not a dead end: a custom app
     is commonly granted order scopes and not customer scopes, or the reverse.
     Bailing out entirely here was wrong — it hid the order shapes, which are
     the ones that decide what a customer sees on their own orders page, at
     exactly the moment they first became checkable. So each half is reported
     on its own and whatever IS readable still gets verified. */
  const SCOPES_FIX = '\nIn the Ecwid panel: Apps → Custom apps → Edit → Access scopes.\n' +
    'Grant read AND write for the missing one, then run this again.';

  if (!access.customers && !access.orders) {
    console.log(y('\nNeither customers nor orders can be read, so nothing below could be checked.')
      + SCOPES_FIX);
    process.exitCode = 1;
    return;
  }
  if (blocked) {
    console.log(y('\nPartial access: ')
      + (access.orders ? g('orders yes') : r('orders no')) + ', '
      + (access.customers ? g('customers yes') : r('customers no'))
      + '. Only the readable half is checked below.' + SCOPES_FIX);
  }
  if (!customers && !orders) {
    /* Readable, but empty. Not a failure — and specifically not a scope
       problem, which is what the first version reported. */
    console.log(y('\nNothing to check the shapes against yet: the store has no '
      + (access.orders && access.customers ? 'orders or customers'
        : access.orders ? 'orders' : 'customers') + ' at all.'));
    console.log('Run this again once one exists — pushing a waiting order creates both.');
    return;
  }

  const c = report('CUSTOMER — engine/ecwid-customers.mjs toEcwidCustomer / the admin lookup',
    customers, CUSTOMER_FIELDS);
  const o = report('ORDER — engine/ecwid-customers.mjs fromEcwidOrder, engine/ecwid-map.mjs toLocalStatus',
    orders, ORDER_FIELDS);
  const i = report('ORDER ITEM',
    orders && Array.isArray(orders.items) ? orders.items[0] : null, ITEM_FIELDS);

  /* The status values matter as much as the field names: FULFILMENT in
     ecwid-map.mjs maps a fixed list, and an unmapped value leaves the local
     status alone — correct, but silent. */
  if (orders) {
    console.log('\nSTATUS VALUES on this sample');
    console.log(`  fulfillmentStatus: ${orders.fulfillmentStatus ?? dim('absent')}`);
    console.log(`  paymentStatus:     ${orders.paymentStatus ?? dim('absent')}`);
    console.log(dim('  engine/ecwid-map.mjs maps AWAITING_PROCESSING, QUEUED, PROCESSING,'));
    console.log(dim('  READY_FOR_PICKUP, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, WILL_NOT_DELIVER,'));
    console.log(dim('  RETURNED — anything else leaves the local status untouched.'));
  }

  const missing = [...c.missing, ...o.missing, ...i.missing];
  const alts = [...c.viaAlt, ...o.viaAlt, ...i.viaAlt];
  console.log('');
  if (missing.length) {
    console.log(r(`${missing.length} required field(s) not found: ${missing.join(', ')}`));
    console.log('Fix the reader in engine/ecwid-customers.mjs before trusting the merge.');
    process.exitCode = 1;
  } else if (alts.length) {
    console.log(y(`All fields found, ${alts.length} under an alternative name: ${alts.join(', ')}`));
    console.log('The readers tolerate these, so nothing is broken — but now it is known.');
  } else {
    console.log(g('Every assumed field name is real. The customer and order mapping is verified.'));
  }
}

main().catch(e => {
  console.error(r('preflight failed: ') + (e && e.message));
  process.exitCode = 2;
});

// site/engine/ecwid-docs.test.mjs
// The runbook is the only thing standing between an operator and a silent
// misconfiguration, so the facts in it are asserted rather than trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dirname, '..', '..');
const launch = readFileSync(path.join(REPO, 'LAUNCH.md'), 'utf8');
const section = /\n## .*Ecwid[\s\S]*?(?=\n## |$)/.exec(launch);

test('LAUNCH.md has an Ecwid section', () => {
  assert.ok(section, 'no Ecwid section in LAUNCH.md');
});

test('the runbook names every environment variable the server reads', () => {
  /* A variable the code reads but the runbook omits is a silent
     misconfiguration waiting to happen — the token was first placed as
     ECWID_TOKEN, which compare-server.mjs does not read. */
  const server = readFileSync(path.join(REPO, 'site', 'compare-server.mjs'), 'utf8');
  const used = [...new Set([...server.matchAll(/process\.env\.(SADKO_ECWID\w*)/g)].map(m => m[1]))];
  assert.ok(used.length >= 4, 'expected several SADKO_ECWID vars, found ' + used.length);
  for (const v of used) assert.match(section[0], new RegExp(v), `${v} is undocumented`);
});

test('the runbook warns about spaces around the equals sign', () => {
  /* systemd EnvironmentFile is KEY=value. `KEY = value` does not parse
     reliably, and the failure is silent: the site just serves the seed. */
  assert.match(section[0], /no spaces|without spaces|NO SPACES/i);
});

test('the runbook contains no real token value', () => {
  assert.ok(!/SADKO_ECWID_TOKEN=(?!<|\.\.\.|your|the )\S{12,}/.test(section[0]),
    'a literal token appears to be pasted into the runbook');
  assert.ok(!/SADKO_ECWID_WEBHOOK_SECRET=(?!<|\.\.\.|your|the )\S{12,}/.test(section[0]),
    'a literal secret appears to be pasted into the runbook');
});

test('the runbook requires the diff review before the flag goes on', () => {
  assert.match(section[0], /ecwid-diff/);
});

test('the runbook explains how to check the connection', () => {
  assert.match(section[0], /ecwid-capture\.mjs --check|--check/);
});

test('the connection-check tool the runbook names actually exists', () => {
  const named = [...section[0].matchAll(/tools\/(ecwid-[\w-]+\.mjs)/g)].map(m => m[1]);
  assert.ok(named.length, 'the runbook names no tools at all');
  for (const t of new Set(named))
    assert.ok(existsSync(path.join(REPO, 'site', 'tools', t)), `runbook names a missing tool: ${t}`);
});

test('the runbook records the webhook signature scheme', () => {
  /* Ecwid signs "{eventCreated}.{eventId}", NOT the body. An operator
     diagnosing a 401 will otherwise reach for the body and get nowhere. */
  assert.match(section[0], /eventCreated/);
  assert.match(section[0], /eventId/);
  assert.match(section[0], /X-Ecwid-Webhook-Signature/);
});

test('the runbook covers the two blockers we actually hit', () => {
  assert.match(section[0], /weight/i, 'the missing product weights must be recorded');
  assert.match(section[0], /order.*(scope|403)|403.*order/i, 'the missing order scopes must be recorded');
});

test('the runbook warns that the test store has different ids from production', () => {
  assert.match(section[0], /142682751/);
  assert.match(section[0], /18028328/);
});

test('the runbook explains how to add a banner', () => {
  assert.match(section[0], /206811031|banner categor/i);
  assert.match(section[0], /hero|wide|square/, 'the slot vocabulary must be documented');
});

test('the runbook covers a category added in Ecwid needing an English name', () => {
  assert.match(section[0], /mkcategories/);
});

test('the runbook covers the customer-email decision gate', () => {
  assert.match(section[0], /email/i);
});

test('the runbook says who owns what after launch', () => {
  for (const s of ['Ecwid', 'promos.json'])
    assert.match(section[0], new RegExp(s.replace('.', '\\.')), `${s} missing from the ownership table`);
});

test('rolling back is documented, because a flag you cannot unset is not a flag', () => {
  assert.match(section[0], /SADKO_ECWID=\s*$|unset|roll ?back/im);
});

/* ======================================================================
   The delivery finding.

   An earlier version of this runbook said /order/calculate returns zero
   shipping options and blamed the missing weights alone. Both were wrong,
   and the correction is load-bearing: entering weights would NOT have been
   enough, because no method is bound to a region either. If the section
   ever reverts to the single-cause story, the owner fixes half the problem
   and then trusts a Cairo rate for Aswan.
   ================================================================== */

test('the runbook does NOT claim the calculator returns no shipping options', () => {
  assert.ok(!/returns zero shipping options/.test(section[0]),
    'the disproved claim is back in the runbook');
});

test('the runbook records BOTH delivery blockers, not just the weights', () => {
  assert.match(section[0], /destinationZone/, 'the missing destination zones are undocumented');
  assert.match(section[0], /0 of 1,453/, 'the weight count is undocumented');
});

test('the runbook shows the evidence, not just the conclusion', () => {
  /* The by-governorate table is what makes the finding checkable by someone
     who doubts it. */
  for (const place of ['Aswan', 'Marsa Matrouh', 'Sohag']) {
    assert.match(section[0], new RegExp(place), place + ' is missing from the evidence table');
  }
  assert.match(section[0], /القاهرة الكبرى/, 'the method Ecwid actually chose is not named');
});

test('the runbook names the singular shippingOption field that caused the misreading', () => {
  assert.match(section[0], /shippingOption/);
  assert.match(section[0], /singular/i);
});

test('the runbook gives a fix for each delivery blocker, not just a diagnosis', () => {
  const del = /Delivery totals are blocked[\s\S]*?(?=\n\*\*Customer and order reads)/.exec(section[0]);
  assert.ok(del, 'the delivery blocker section is gone');
  assert.match(del[0], /Shipping & Pickup/, 'no fix given for the zones');
  assert.match(del[0], /Ecwid → Products/, 'no fix given for the weights');
});

test('the runbook still forbids letting the customer pick the shipping band', () => {
  /* The standing rule: they could choose the small-appliance rate for a
     refrigerator, and a total that is too low is a price SADKO would have to
     honour or retract. */
  assert.match(section[0], /must not|Do not work around/i);
  assert.match(section[0], /pick the band|picks the band/i);
});

test('the site can report the delivery state itself, so the runbook is not the only record', () => {
  assert.match(section[0], /api\/shipping-methods/);
  assert.match(section[0], /quotable/);
});

/* --------------------------- the accounts limit ------------------------ */

test('the runbook states that sign-in cannot move to Ecwid', () => {
  /* Asked repeatedly, and the answer is a hard API limit rather than a
     backlog item. */
  assert.match(section[0], /no API that verifies a customer's password|cannot move to Ecwid/i);
  assert.match(section[0], /identity provider/i, 'the SSO direction is not explained');
  assert.match(section[0], /linked by \*\*email\*\*|linked by email/i);
});

test('the runbook flags the customer and order reads as UNVERIFIED', () => {
  /* They are built and unit-tested against a shape no real payload has
     confirmed, because the test store's token cannot read either endpoint.
     Claiming them as working would be the exact mistake this project has
     already made four times with Ecwid field names. */
  assert.match(section[0], /unverified/i);
  assert.match(section[0], /four Ecwid field names|guessed four/i);
});

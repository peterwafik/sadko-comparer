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

/* --------------------- category pages across stores -------------------- */

test('the runbook explains that category pages resolve by NAME across stores', () => {
  /* Without this, the next person to see an empty category page edits the 30
     static files or the dropdown, neither of which is where the fix lives. */
  assert.match(section[0], /data-cat-name/);
  assert.match(section[0], /category-alias\.mjs/);
});

test('the runbook records that an ambiguous name resolves to nothing', () => {
  assert.match(section[0], /ambiguous/i);
});

test('the runbook explains the parent-category subtree', () => {
  /* The single most surprising part: Ecwid files a product under the child
     only, so a parent matched nothing until the subtree was expanded. */
  assert.match(section[0], /subtree/i);
  assert.match(section[0], /parentId/);
});

test('the runbook no longer says a new Ecwid category has no page', () => {
  /* It gets one generated now. Leaving the old claim would send staff to do
     work that is not needed. */
  assert.ok(!/A new Ecwid\s*\ncategory therefore has no page/.test(section[0]),
    'the superseded claim is back');
  assert.match(section[0], /Nothing is required for it to work/);
});

/* ------------------------ advertisement folders ------------------------ */

test('the runbook records the ad folder ids that were actually created', () => {
  /* Configured by id, so the ids ARE the configuration. */
  assert.match(section[0], /SADKO_ECWID_ADS_SQUARE/);
  assert.match(section[0], /206866501/);
  assert.match(section[0], /206866002/);
});

test('the runbook explains why folders are addressed by id and not by name', () => {
  /* Otherwise the next person renames a folder expecting it to matter, or
     tries to look one up by name and finds Ecwid returns no name at all. */
  assert.match(section[0], /BY ID, NOT BY NAME/i);
  assert.match(section[0], /products\?category=/);
});

test('THE BLOCKER is recorded: a disabled product is an id-only stub', () => {
  /* This is why the adverts are enabled, contradicting the instruction in the
     old SITE BANNERS category description. Without it written down, someone
     switches them to Disabled and the adverts silently vanish. */
  assert.match(section[0], /disabled PRODUCT/i);
  assert.match(section[0], /\{id, enabled:false\}/);
  assert.match(section[0], /secret token/i);
});

test('the runbook admits the cost of enabling them', () => {
  /* An enabled advert is reachable in Ecwid's own storefront. Recording the
     benefit without the cost would be a half-truth. */
  assert.match(section[0], /reachable in Ecwid's own storefront/i);
  assert.match(section[0], /0\.00 EGP/);
});

test('the runbook corrects the "463 empty shells" reading', () => {
  assert.match(section[0], /463/);
  assert.match(section[0], /disabled products/i);
});

test('the destination allow-list is documented as a security boundary', () => {
  assert.match(section[0], /security boundary/i);
  assert.match(section[0], /javascript:/);
  assert.match(section[0], /admin/);
});

test('the per-slot merge is documented, so nobody expects hero to vanish', () => {
  assert.match(section[0], /PER SLOT/);
  assert.match(section[0], /slotsFromEcwid/);
});

test('the runbook records that artwork FILLS rather than crops', () => {
  /* Someone will see a stretched advert and "fix" it back to cover, which
     silently re-trims the footer bar off every upload. The trade has to be
     written down as a decision. */
  assert.match(section[0], /object-fit: fill/);
  assert.match(section[0], /nothing is cropped/i);
  assert.match(section[0], /1000×1000|1000x1000/);
});

test('the runbook records the positional naming and what the number does', () => {
  assert.match(section[0], /POSITIONAL/i);
  assert.match(section[0], /إعلان مربع ١/);
  assert.match(section[0], /order control/i);
  assert.match(section[0], /right-to-left/i);
});

test('the runbook says the DESCRIPTION is the alt text', () => {
  /* Otherwise whoever swaps the artwork leaves a stale message behind for
     screen readers. */
  assert.match(section[0], /alt text/i);
  assert.match(section[0], /Description/);
});

test('the runbook lists all three ad folders with their real ids', () => {
  for (const id of ['206876252', '206876253', '206866501']) {
    assert.match(section[0], new RegExp(id), 'folder ' + id + ' is undocumented');
  }
});

test('the runbook explains the CATEGORY page banner rules', () => {
  /* The question that prompted this: which banner shows at the top of a
     specific category page, and how is it aimed. */
  assert.match(section[0], /cat:206629766/);
  assert.match(section[0], /brand-wide/i);
  assert.match(section[0], /never.*different category|different category.*never/i);
  assert.match(section[0], /[Ss]ubcategor/);
});

test('the runbook records the duplicate-SKU limit and both uniquifiers', () => {
  assert.match(section[0], /already in use/i);
  assert.match(section[0], /contact2/);
  assert.match(section[0], /contact#2/);
});

test('the runbook says an ad folder is never a destination', () => {
  assert.match(section[0], /never a destination/i);
});

test('the runbook records that each ad block takes its own artwork shape', () => {
  /* Otherwise the next wide advert silently lands in the 1:1 grid and is
     stretched, which is exactly what happened. */
  assert.match(section[0], /own shape/i);
  assert.match(section[0], /2\.6/);
});

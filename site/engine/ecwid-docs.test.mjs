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

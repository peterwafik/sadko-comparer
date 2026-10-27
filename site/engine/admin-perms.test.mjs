// site/engine/admin-perms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, FULL, cleanPerms, sectionOf, allowed } from './admin-perms.mjs';

test('the sections are the portal pages an admin can be given', () => {
  assert.deepEqual(SECTIONS, ['scenes', 'ads', 'shop', 'guides', 'finder', 'site', 'orders', 'products', 'coupons',
    'delivery', 'payments', 'customers', 'activity']);
  assert.ok(SECTIONS.every(s => FULL[s] === 'edit'));
});

test('perms keep only known sections and levels', () => {
  assert.deepEqual(cleanPerms({ orders: 'view', products: 'edit', admins: 'edit', coupons: 'root', ads: 'none' }), { orders: 'view', products: 'edit' });
  assert.deepEqual(cleanPerms(null), {});
});

test('every admin route belongs to exactly one section', () => {
  const S = (rest, m = 'GET') => sectionOf(rest, m);
  assert.equal(S('store/orders'), 'orders');
  assert.equal(S('store/orders/7537', 'PATCH'), 'orders');
  assert.equal(S('ecwid/orders/SDK-1/retry', 'POST'), 'orders');
  assert.equal(S('ecwid/push/SDK-1', 'POST'), 'orders');
  assert.equal(S('store/products'), 'products');
  assert.equal(S('leftovers/discard', 'POST'), 'products');
  assert.equal(S('analytics'), 'products');
  assert.equal(S('store/customers'), 'customers');
  assert.equal(S('ecwid/customer'), 'customers');
  assert.equal(S('ecwid/customers/link', 'POST'), 'customers');
  assert.equal(S('store/coupons/1', 'DELETE'), 'coupons');
  assert.equal(S('store/payments'), 'payments');
  assert.equal(S('store/delivery'), 'delivery');
  assert.equal(S('delivery-classes'), 'delivery');
  assert.equal(S('ads/setup', 'POST'), 'ads');
  assert.equal(S('shop/layout', 'PUT'), 'shop');
  assert.equal(S('content/scenes', 'PUT'), 'scenes');
  assert.equal(S('site/link-targets'), 'scenes');
  assert.equal(S('content/guides'), 'guides');
  assert.equal(S('upload', 'POST'), 'guides');
  assert.equal(S('content/finder'), 'finder');
  assert.equal(S('site/settings', 'PUT'), 'site');
  assert.equal(S('audit'), 'activity');
  assert.equal(S('admins'), 'master');
  assert.equal(S('admins/x%40y.z', 'DELETE'), 'master');
  assert.equal(S('admins/x%40y.z/perms', 'PUT'), 'master');
  assert.equal(S('ecwid/sync', 'POST'), 'products');
  /* open to every signed-in admin: who am I, the dashboard, Ecwid status */
  assert.equal(S('me'), 'any');
  assert.equal(S('overview'), 'any');
  assert.equal(S('ecwid'), 'any');
  /* anything unmapped is refused, never let through */
  assert.equal(S('something/new'), 'master');
});

test('view lets an admin read; only edit lets them change', () => {
  const p = { orders: 'view', products: 'edit' };
  assert.equal(allowed('admin', p, 'orders', false), true);
  assert.equal(allowed('admin', p, 'orders', true), false);
  assert.equal(allowed('admin', p, 'products', true), true);
  assert.equal(allowed('admin', p, 'coupons', false), false, 'no entry = no access');
  assert.equal(allowed('admin', p, 'any', true), true);
  assert.equal(allowed('admin', FULL, 'master', false), false, 'managing admins is the master\'s alone');
});

test('the master can do everything', () => {
  for (const s of SECTIONS.concat(['master', 'any'])) assert.equal(allowed('master', {}, s, true), true);
});

/* ---- wiring ---- */
import { readFileSync } from 'node:fs';
const SRV = readFileSync(new URL('../compare-server.mjs', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../assets/js/admin/core.js', import.meta.url), 'utf8');
const PEOPLE = readFileSync(new URL('../assets/js/admin/pages-people.js', import.meta.url), 'utf8');
const SITEJS = readFileSync(new URL('../assets/js/admin/pages-site.js', import.meta.url), 'utf8');

test('every admin route is checked against the admin\'s access before it runs', () => {
  const block = SRV.slice(SRV.indexOf("if (u.pathname.startsWith('/api/admin/')) {"));
  const gate = block.indexOf('if (!allowed(sess.role, sess.perms, section,');
  assert.ok(gate > 0, 'the access check is missing');
  assert.ok(gate < block.indexOf("if (rest === 'me'"), 'the check must come before the first route');
  assert.ok(gate < block.indexOf("const rest = u.pathname.slice('/api/admin/'.length)"), 'and before any route reads the path');
});

test('only the operator or the master can invite; only the operator can set the master', () => {
  const inv = SRV.slice(SRV.indexOf("if (step === 'invite') {"), SRV.indexOf("if (step === 'master') {"));
  assert.match(inv, /s\.role === 'master'/);
  assert.match(inv, /bearerIsAdminSecret\(req\) \? 'operator'/);
  const mst = SRV.slice(SRV.indexOf("if (step === 'master') {"), SRV.indexOf("if (step === 'login') {"));
  assert.match(mst, /if \(!bearerIsAdminSecret\(req\)\) return json\(403/);
});

test('the dashboard leaves out what an admin may not view', () => {
  const ov = SRV.slice(SRV.indexOf("if (rest === 'overview' && req.method === 'GET') {"), SRV.indexOf('/* ======== the store, straight from Ecwid'));
  for (const s of ['products', 'orders', 'coupons', 'customers', 'activity']) assert.ok(ov.includes("can('" + s + "')"), s);
});

test('the portal hides what the server refuses, and locks view-only pages', () => {
  assert.match(CORE, /const visible = \(\) => PAGES\.filter\(p => can\(sectionOfPage\(p\), false\)\);/);
  assert.match(CORE, /if \(readOnly && seq === routeSeq\) setReadOnly\(true\);/);
  assert.match(PEOPLE, /label: \['المسؤولون', 'Admins'\], source: 'site', perm: 'master'/);
  assert.match(SITEJS, /label: \['لوحة المتابعة', 'Dashboard'\], perm: 'any'/);
  /* every other page's key is its section */
  const ALL = CORE + PEOPLE + SITEJS + readFileSync(new URL('../assets/js/admin/pages-store.js', import.meta.url), 'utf8');
  for (const s of SECTIONS) assert.ok(ALL.includes("page('" + s + "'") || ALL.includes("contentPage('" + s + "'"), s + ' has no page');
});

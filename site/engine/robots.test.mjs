// site/engine/robots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots } from './robots.mjs';

test('empty Disallow means allow everything (labeb.com style)', () => {
  const r = parseRobots('User-agent: *\nDisallow:\nSitemap: https://eg.labeb.com/sitemap.xml');
  assert.equal(r.allowed('/anything'), true);
  assert.deepEqual(r.sitemaps, ['https://eg.labeb.com/sitemap.xml']);
});

test('honours Disallow paths', () => {
  const r = parseRobots('User-agent: *\nDisallow: /Checkout\nDisallow: /Account/');
  assert.equal(r.allowed('/Checkout'), false);
  assert.equal(r.allowed('/Account/me'), false);
  assert.equal(r.allowed('/product/123'), true);
});

test('reads Crawl-delay', () => {
  const r = parseRobots('User-agent: *\nCrawl-delay: 5\nDisallow:');
  assert.equal(r.crawlDelay, 5);
});

test('applies the wildcard group, not another bot group', () => {
  const txt = 'User-agent: AhrefsBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n';
  const r = parseRobots(txt);
  assert.equal(r.allowed('/product/1'), true);
  assert.equal(r.allowed('/admin'), false);
});

test('collects multiple sitemaps regardless of group', () => {
  const r = parseRobots('Sitemap: https://a/s1.xml\nUser-agent: *\nDisallow:\nSitemap: https://a/s2.xml');
  assert.equal(r.sitemaps.length, 2);
});

test('Disallow beats Allow: / for the specific path (Finding 1)', () => {
  const r = parseRobots('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /checkout');
  assert.equal(r.allowed('/admin'), false);
  assert.equal(r.allowed('/checkout'), false);
  assert.equal(r.allowed('/product/1'), true);
});

test('longest matching pattern wins (RFC 9309 specificity)', () => {
  const r = parseRobots('User-agent: *\nDisallow: /a/\nAllow: /a/b/');
  assert.equal(r.allowed('/a/b/c'), true);
  assert.equal(r.allowed('/a/x'), false);
});

test('consecutive User-agent lines share one rule block', () => {
  const r = parseRobots('User-agent: *\nUser-agent: Googlebot\nDisallow: /');
  assert.equal(r.allowed('/anything'), false);
});

test('trailing $ anchors the match to end-of-path', () => {
  const r = parseRobots('User-agent: *\nDisallow: /secret$');
  assert.equal(r.allowed('/secret'), false);
  assert.equal(r.allowed('/secretive'), true);
});

test('regex metacharacters like ? are escaped, not interpreted', () => {
  const r = parseRobots('User-agent: *\nDisallow: /search?');
  assert.equal(r.allowed('/searching'), true);
});

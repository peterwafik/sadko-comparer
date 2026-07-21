// site/engine/verify.test.mjs
// IMPORTANT 4 (M1 final review): live verification is new automated traffic
// this branch introduces on top of the crawler, and must meet the same
// politeness bar — CRAWLER_UA, a robots.txt check per fetch, and a skip
// (not a fetch) when robots disallows. CRITICAL 2 (same review): the
// verified price must be rejected unless the re-fetched page's own top
// product still identifies as the SAME product as the offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifyOffer } from './verify.mjs';
import { CRAWLER_UA } from './robots.mjs';

const offer = (over = {}) => ({
  url: 'https://store.example/p/1', domain: 'store.example',
  title_raw: 'شاشة شارب 75 بوصة 4K سمارت 4T-C75FN6EX', price: 39699,
  ...over,
});

test('IMPORTANT 4: verification must not fetch a URL that robots disallows', async () => {
  let productFetched = false;
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt'))
      return { ok: true, text: async () => 'User-agent: *\nDisallow: /p/' };
    productFetched = true;
    return { ok: true, text: async () => '<html></html>' };
  };
  const verify = createVerifyOffer({ fetchImpl, extractProducts: () => [] });
  const result = await verify(offer());
  assert.equal(result, null, 'a disallowed URL must return null, not a price');
  assert.equal(productFetched, false, 'the product page must never be fetched when robots disallows it');
});

test('IMPORTANT 4: an allowed URL is fetched with the honest CRAWLER_UA, not a spoofed browser UA', async () => {
  let seenUA = null;
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/robots.txt')) return { ok: true, text: async () => 'User-agent: *\nDisallow:' };
    seenUA = opts.headers['user-agent'];
    return { ok: true, text: async () => '<html></html>' };
  };
  const verify = createVerifyOffer({
    fetchImpl,
    extractProducts: () => [{ title: offer().title_raw, price: 39699 }],
  });
  await verify(offer());
  assert.equal(seenUA, CRAWLER_UA, 'verification fetches must identify as the crawler, never a spoofed Chrome UA');
});

test('IMPORTANT 4: robots.txt for a domain is fetched once and cached across many verifications', async () => {
  let robotsFetches = 0;
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt')) { robotsFetches++; return { ok: true, text: async () => 'User-agent: *\nDisallow:' }; }
    return { ok: true, text: async () => '<html></html>' };
  };
  const verify = createVerifyOffer({
    fetchImpl,
    extractProducts: () => [{ title: offer().title_raw, price: 100 }],
  });
  await verify(offer({ url: 'https://store.example/p/1' }));
  await verify(offer({ url: 'https://store.example/p/2' }));
  await verify(offer({ url: 'https://store.example/p/3' }));
  assert.equal(robotsFetches, 1, 'one robots.txt lookup must serve many verifications of the same domain');
});

test('CRITICAL 2: a re-fetched page whose top product does not match the offer identity is rejected', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' };
    return { ok: true, text: async () => '<html></html>' };
  };
  // the page's first JSON-LD Product is a cheap unrelated accessory — e.g. a
  // related-product carousel item, not the TV the offer itself is for
  const verify = createVerifyOffer({
    fetchImpl,
    extractProducts: () => [{ title: 'كفر حماية شاشة موبايل', price: 199 }],
  });
  const result = await verify(offer());
  assert.equal(result, null, 'a mismatched product on the re-fetched page must never be trusted as this offer\'s price');
});

test('a re-fetched page whose top product DOES match the offer identity is trusted', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' };
    return { ok: true, text: async () => '<html></html>' };
  };
  const verify = createVerifyOffer({
    fetchImpl,
    extractProducts: () => [{ title: 'شاشة شارب 4K سمارت 75 بوصة 4T-C75FN6EX', price: 38500 }],
  });
  const result = await verify(offer());
  assert.equal(result, 38500);
});

test('a network failure during verification returns null rather than throwing', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/robots.txt')) return { ok: true, text: async () => '' };
    throw new Error('ECONNRESET');
  };
  const verify = createVerifyOffer({ fetchImpl, extractProducts: () => [] });
  const result = await verify(offer());
  assert.equal(result, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProduct } from './extract.mjs';

const LD = obj => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;

test('reads schema.org Product JSON-LD', () => {
  const html = LD({ '@type': 'Product', name: 'شاشة شارب 75 بوصة 4K',
    offers: { '@type': 'Offer', price: '39699', priceCurrency: 'EGP', availability: 'https://schema.org/InStock' } });
  const p = extractProduct(html, 'https://s.com/product/1');
  assert.equal(p.title, 'شاشة شارب 75 بوصة 4K');
  assert.equal(p.price, 39699);
  assert.equal(p.inStock, true);
});

test('finds Product nested inside @graph', () => {
  const html = LD({ '@graph': [{ '@type': 'WebPage' },
    { '@type': 'Product', name: 'غسالة توشيبا 8 كيلو', offers: { price: 12079 } }] });
  assert.equal(extractProduct(html, 'https://s.com/product/2').price, 12079);
});

test('marks out-of-stock rather than dropping the product', () => {
  const html = LD({ '@type': 'Product', name: 'ثلاجة تورنيدو 395 لتر',
    offers: { price: 29179, availability: 'https://schema.org/OutOfStock' } });
  const p = extractProduct(html, 'https://s.com/product/3');
  assert.equal(p.inStock, false);
});

test('uses lowPrice when an AggregateOffer has no price', () => {
  const html = LD({ '@type': 'Product', name: 'ميكروويف فريش 36 لتر',
    offers: { '@type': 'AggregateOffer', lowPrice: 7549, highPrice: 7899 } });
  assert.equal(extractProduct(html, 'https://s.com/product/4').price, 7549);
});

test('returns null when no product data is present', () => {
  assert.equal(extractProduct('<html><body>nothing</body></html>', 'https://s.com/x'), null);
});

test('rejects UI chrome masquerading as a product title', () => {
  const html = LD({ '@type': 'Product', name: 'إضافة إلى السلة', offers: { price: 52405 } });
  assert.equal(extractProduct(html, 'https://s.com/?add-to-cart=3991'), null);
});

test('accepts @type as an array containing Product', () => {
  const html = LD({ '@type': ['Product', 'Thing'], name: 'تكييف شارب 2.25 حصان', offers: { price: 53400 } });
  assert.equal(extractProduct(html, 'https://s.com/product/5').price, 53400);
});

test('rejects @type as an array without Product', () => {
  const html = LD({ '@type': ['WebPage', 'Thing'], name: 'صفحة ويب طويلة جداً', offers: { price: 100 } });
  assert.equal(extractProduct(html, 'https://s.com/product/6'), null);
});

test('accepts @type as a schema.org URL', () => {
  const html = LD({ '@type': 'http://schema.org/Product', name: 'ثلاجة تورنيدو 355 لتر', offers: { price: 22269 } });
  assert.equal(extractProduct(html, 'https://s.com/product/7').price, 22269);
});

// Realistic WooCommerce-shaped microdata fixture: breadcrumb decoys with
// itemprop="name" BEFORE the Product scope, a Product itemscope containing a
// nested Offer itemscope, mirroring egypt.sharafdg.com/product/... markup.
const MICRO = ({
  name = 'Kenwood Vacuum Cleaner VC7050',
  price = '7918.93',
  currency = 'EGP ',
  availability = 'http://schema.org/InStock',
} = {}) => `<html><body>
<nav class="breadcrumb">
  <span itemprop="name">Home</span>
  <span itemprop="name">Vacuum Cleaners</span>
</nav>
<div itemtype="http://schema.org/Product" itemscope>
  <h1 itemprop="name" class="product_title entry-title">${name}</h1>
  <div itemtype="http://schema.org/Offer" itemscope itemprop="offers">
    <span itemprop="price" content="${price}">${price} EGP</span>
    <span itemprop="priceCurrency" content="${currency}">${currency}</span>
    <link itemprop="availability" href="${availability}" />
  </div>
</div>
</body></html>`;

test('microdata: extracts name, price and currency when JSON-LD is absent', () => {
  const p = extractProduct(MICRO(), 'https://egypt.sharafdg.com/product/kenwood-vacuum-cleaner-vc7050/');
  assert.equal(p.title, 'Kenwood Vacuum Cleaner VC7050');
  assert.equal(p.price, 7919);
  assert.equal(p.currency, 'EGP');
});

test('microdata: priceCurrency with a trailing space is trimmed', () => {
  const p = extractProduct(MICRO({ currency: 'EGP ' }), 'https://s.com/product/8');
  assert.equal(p.currency, 'EGP');
});

test('microdata: decoy breadcrumb itemprop="name" is not picked as the title', () => {
  const p = extractProduct(MICRO(), 'https://s.com/product/9');
  assert.notEqual(p.title, 'Home');
  assert.notEqual(p.title, 'Vacuum Cleaners');
  assert.equal(p.title, 'Kenwood Vacuum Cleaner VC7050');
});

test('JSON-LD still wins when both JSON-LD and microdata are present', () => {
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product', name: 'غسالة سامسونج 10 كيلو', offers: { price: 15999 },
  })}</script>`;
  const html = MICRO().replace('<body>', `<body>${jsonLd}`);
  const p = extractProduct(html, 'https://s.com/product/10');
  assert.equal(p.title, 'غسالة سامسونج 10 كيلو');
  assert.equal(p.price, 15999);
});

test('microdata: out-of-stock availability sets inStock false', () => {
  const p = extractProduct(MICRO({ availability: 'http://schema.org/OutOfStock' }), 'https://s.com/product/11');
  assert.equal(p.inStock, false);
});

test('returns null when a page has neither JSON-LD nor microdata', () => {
  assert.equal(extractProduct('<html><body><h1>Just a page</h1></body></html>', 'https://s.com/y'), null);
});

test('microdata: UI-chrome title is rejected by the shared gate', () => {
  const html = MICRO({ name: 'Add to Cart' });
  assert.equal(extractProduct(html, 'https://s.com/product/12'), null);
});

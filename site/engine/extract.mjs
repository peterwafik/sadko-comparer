/* Product page -> normalized record, via schema.org JSON-LD.
   The sanity gate is shared with the live adapters — see ./offer-gate.mjs.
   Without it, "add to cart" anchors and cart URLs get priced as products. */
import { UI_TITLE, BAD_URL, parsePrice, decodeEntities as decode } from './offer-gate.mjs';

export function extractProduct(html, url) {
  if (BAD_URL.test(url)) return null;
  let found = null;
  const isProduct = (t) => {
    const s = String(t).toLowerCase();
    return s === 'product' || s.endsWith('/product');
  };
  const walk = node => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const typeVal = node['@type'];
    if (Array.isArray(typeVal) ? typeVal.some(isProduct) : isProduct(typeVal)) {
      const offer = [].concat(node.offers || [])[0] || {};
      const price = parsePrice(offer.price ?? offer.lowPrice ?? node.price);
      if (price) {
        found = {
          title: decode(node.name),
          price,
          currency: offer.priceCurrency || 'EGP',
          inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(offer.availability || '')),
        };
        return;
      }
    }
    for (const k of ['@graph', 'itemListElement', 'mainEntity', 'item'])
      if (node[k]) walk(node[k]);
  };

  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch {}
    if (found) break;
  }
  if (!found) return null;
  if (!found.title || found.title.length < 8 || UI_TITLE.test(found.title)) return null;
  return found;
}

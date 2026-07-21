/* Product page -> normalized record, via a three-rung ladder: schema.org
   JSON-LD, falling back to schema.org microdata, falling back to Open Graph
   product tags (og:title/og:price:amount) when a store publishes NEITHER
   schema.org format — confirmed live on hyper-techno.com, which emits only
   <meta property="og:..."> tags and yielded zero products before this rung.
   The sanity gate is shared with the live adapters — see ./offer-gate.mjs.
   Without it, "add to cart" anchors and cart URLs get priced as products. */
import { UI_TITLE, BAD_URL, parsePrice, decodeEntities as decode } from './offer-gate.mjs';

const VOID_TAGS = new Set(['meta', 'input', 'img', 'br', 'hr', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

// Collects every element carrying itemprop="<prop>" in document order, each with
// its resolved raw value (content/href attribute preferred, else inner text),
// its class attribute (used to pick the real title among lookalikes) and its
// position (used to prefer the candidate closest to the Product scope).
function readItemprop(html, prop) {
  const out = [];
  const re = new RegExp(`<(\\w+)([^>]*\\bitemprop=["']${prop}["'][^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrs = m[2];
    const selfClosing = /\/\s*$/.test(attrs) || VOID_TAGS.has(tag.toLowerCase());
    const contentMatch = attrs.match(/\bcontent=["']([^"']*)["']/i);
    const hrefMatch = attrs.match(/\bhref=["']([^"']*)["']/i);
    let raw;
    if (contentMatch) raw = contentMatch[1];
    else if (hrefMatch) raw = hrefMatch[1];
    else if (!selfClosing) {
      const openEnd = m.index + m[0].length;
      const closeIdx = html.indexOf('</' + tag, openEnd);
      raw = closeIdx > -1 ? html.slice(openEnd, closeIdx) : '';
    } else raw = '';
    const classMatch = attrs.match(/\bclass=["']([^"']*)["']/i);
    out.push({ raw, className: classMatch ? classMatch[1] : '', index: m.index });
  }
  return out;
}

// Microdata fallback: only reached when JSON-LD found nothing.
//
// Scoping heuristic: a page can carry many itemprop="name" elements
// (breadcrumbs, brand, related-product cards). Rather than parse full DOM
// nesting with regex (unreliable for arbitrary HTML), we slice the document
// at the first Product itemtype tag and only look forward from there — this
// alone drops any decoys that precede the product (e.g. breadcrumb trail).
// Within that region we additionally prefer a candidate whose class attribute
// looks like a product-title class (WooCommerce emits class="product_title
// entry-title"), falling back to the longest text candidate otherwise, since
// a real title is rarely the shortest string on the page.
function extractMicrodata(html) {
  const scopeMatch = /<[a-zA-Z][a-zA-Z0-9]*\b[^>]*\bitemtype=["'][^"']*\/Product["'][^>]*>/i.exec(html);
  if (!scopeMatch) return null;
  const region = html.slice(scopeMatch.index);

  const names = readItemprop(region, 'name');
  if (!names.length) return null;
  const titled = names.find(n => /product[-_ ]?title/i.test(n.className));
  const nameCand = titled || names.reduce((a, b) => (decode(b.raw).length > decode(a.raw).length ? b : a));
  const title = decode(nameCand.raw);

  const prices = readItemprop(region, 'price');
  if (!prices.length) return null;
  const price = parsePrice(prices[0].raw);
  if (!price) return null;

  const currencies = readItemprop(region, 'priceCurrency');
  const currency = (currencies.length ? decode(currencies[0].raw).trim() : '') || 'EGP';

  const availabilities = readItemprop(region, 'availability');
  const availability = availabilities.length ? availabilities[0].raw : '';

  return {
    title,
    price,
    currency,
    inStock: !/OutOfStock|SoldOut|Discontinued/i.test(availability),
  };
}

// Open Graph fallback: only reached when neither JSON-LD nor microdata found
// anything. Reads <meta> tags whose "property" (or, in the wild, "name")
// attribute matches a given key — attribute order varies site to site, so
// "property"/"name" and "content" are each located independently within the
// tag's attribute text rather than assumed to appear in a fixed order.
function readMeta(html, key) {
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const keyMatch = attrs.match(/\b(?:property|name)=["']([^"']*)["']/i);
    if (!keyMatch || keyMatch[1].toLowerCase() !== key) continue;
    const contentMatch = attrs.match(/\bcontent=["']([^"']*)["']/i);
    if (contentMatch) return contentMatch[1];
  }
  return null;
}

function extractOpenGraph(html) {
  const ogTitle = readMeta(html, 'og:title');
  const rawTitle = ogTitle != null ? ogTitle : (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!rawTitle) return null;
  const title = decode(rawTitle);

  const priceRaw = readMeta(html, 'og:price:amount') ?? readMeta(html, 'product:price:amount');
  const price = parsePrice(priceRaw);
  if (!price) return null;

  const currencyRaw = readMeta(html, 'og:price:currency') ?? readMeta(html, 'product:price:currency');
  const currency = (currencyRaw != null ? decode(currencyRaw).trim() : '') || 'EGP';

  const availability = readMeta(html, 'og:availability') ?? readMeta(html, 'product:availability') ?? '';

  return {
    title,
    price,
    currency,
    inStock: !/OutOfStock|SoldOut|Discontinued/i.test(availability),
  };
}

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

  const str = String(html);
  for (const m of str.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch {}
    if (found) break;
  }
  if (!found) {
    try { found = extractMicrodata(str); } catch { found = null; }
  }
  if (!found) {
    try { found = extractOpenGraph(str); } catch { found = null; }
  }
  if (!found) return null;
  if (!found.title || found.title.length < 8 || UI_TITLE.test(found.title)) return null;
  return found;
}

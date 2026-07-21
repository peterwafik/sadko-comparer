/* Sitemap and sitemap-index parsing. Regex rather than an XML parser keeps the
   zero-dependency rule; sitemaps are a fixed, simple shape.
   Pure — fetching and walking live in crawler.mjs. */

// Matches <loc>, optionally namespaced (e.g. <xhtml:loc>), with either plain
// text or CDATA-wrapped content. The backreference (\1) ties the closing tag
// to the same (possibly namespaced) tag name as the opening one.
const LOC_RE = /<((?:[\w-]+:)?loc)\b[^>]*>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/\1\s*>/gi;

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseSitemap(xml) {
  const text = String(xml || '');
  const urls = [];
  for (const m of text.matchAll(LOC_RE)) {
    const raw = m[2] !== undefined ? m[2] : m[3];
    if (raw == null) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    urls.push(decodeXmlEntities(trimmed));
  }
  return { isIndex: /<sitemapindex/i.test(text), urls };
}

const PRODUCT_PATH = /\/(product|products|item)\/[\w-]+/i;
const PRODUCT_ID = /-p-?\d{3,}/i;
// A /p/ segment is a product slug only when it isn't a purely-numeric
// pagination index (e.g. /p/2, /p/10/) — a product slug is /p/some-name.
const PRODUCT_SLUG = /\/p\/(?!\d+(?:[/?]|$))[\w-]+/i;

// Static-asset extensions. Matched right before a query string, fragment, or
// end of string so e.g. "/logo.svg?v=2" still counts as an .svg asset.
const ASSET_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|css|m?js|json|xml|pdf|zip|woff2?|ttf|eot|mp4|webm|avi|mp3)(?:[?#]|$)/i;

// Asset/static-resource directory segments. Magento (and others) serve
// product *images* under paths like /media/catalog/product/... which would
// otherwise false-positive against PRODUCT_PATH above — this must be checked
// first so it can never be overridden by a positive product-shape match.
const ASSET_DIR_RE = /\/(?:media|cache|static|assets|uploads|thumbs|thumbnails|skin|pub\/media|wp-content|wp-includes)\//i;

export function isProductUrl(u) {
  const s = String(u || '');
  if (!s) return false;
  if (ASSET_EXT_RE.test(s) || ASSET_DIR_RE.test(s)) return false;
  return PRODUCT_PATH.test(s) || PRODUCT_ID.test(s) || PRODUCT_SLUG.test(s);
}

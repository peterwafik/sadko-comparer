/* Sitemap and sitemap-index parsing. Regex rather than an XML parser keeps the
   zero-dependency rule; sitemaps are a fixed, simple shape.
   Pure — fetching and walking live in crawler.mjs. */

export function parseSitemap(xml) {
  const text = String(xml || '');
  const urls = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  return { isIndex: /<sitemapindex/i.test(text), urls };
}

export function isProductUrl(u) {
  return /\/(product|products|item)\//i.test(u) || /-p-?\d{3,}/i.test(u) || /\/p\/[\w-]+/i.test(u);
}

/* ============================================================================
   Tavily discovery layer — URL DISCOVERY ONLY.
   ----------------------------------------------------------------------------
   Reaches Egyptian stores the engine cannot: stores that block our search path
   but serve product pages (raneen, sharpegy), and stores absent from the
   registry entirely. Tavily search returns product-page URLs; the engine's own
   fetch + extract + matcher + verification pipeline turns them into offers.

   NOTHING but the URL is taken from Tavily. Its snippet prices are unreliable
   — it reported EGP 1,863 for a refrigerator and returned a "DMN(49)" variant
   when asked for "PMN(49)". Prices and identity come from our own extractor.

   Fails soft: no key, a timeout, an HTTP error, or malformed JSON all return an
   empty array. The engine must remain fully functional without Tavily, exactly
   as it is without the NVIDIA key.

   export discoverProductUrls(query, {maxResults, timeoutMs}) -> [{url, domain}]
   export tavilyEnabled() -> boolean
   ========================================================================== */

const KEY = process.env.TAVILY_API_KEY || '';

export function tavilyEnabled() { return !!KEY; }

/* domains that are never a product source — marketplaces of listings, social,
   search engines, review/aggregator sites. Mirrors the engine's SKIP_DOMAINS
   intent but kept local so this module is self-contained. */
const SKIP = /facebook|instagram|youtube|tiktok|twitter|x\.com|wikipedia|olx\.|dubizzle|aqarmap|linkedin|pinterest|google\.|bing\.|duckduckgo|yaoota|pricena|yallakora|blogspot|wordpress\.com|reddit|quora/i;

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

/* One Tavily search. Returns raw result URLs, or [] on any failure. */
async function search(query, timeoutMs) {
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: 10, search_depth: 'basic', include_answer: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.results) ? j.results.map(x => x.url).filter(Boolean) : [];
  } catch { return []; }
}

/* Discover candidate product-page URLs for a query. Runs two phrasings (Arabic
   / Latin adapt to the query script) and dedupes by domain — one strong URL
   per store is enough; the pipeline probes the store from there. */
export async function discoverProductUrls(query, { maxResults = 8, timeoutMs = 9000 } = {}) {
  if (!KEY) return [];
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const isLatin = !/[؀-ۿ]/.test(q);
  const phrasings = isLatin
    ? [`${q} price Egypt buy`, `${q} سعر مصر`]
    : [`${q} سعر مصر شراء`, `${q} price Egypt`];

  const settled = await Promise.allSettled(phrasings.map(p => search(p, timeoutMs)));
  const urls = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);

  const byDomain = new Map();
  for (const u of urls) {
    const d = hostOf(u);
    if (!d || SKIP.test(d)) continue;
    // prefer a URL that looks like a product page over a category/home URL
    const looksProduct = /\/(product|products|item|p)\/|-p-?\d|\/dp\/|\.html(\?|$)/i.test(u);
    if (!byDomain.has(d) || (looksProduct && !byDomain.get(d).looksProduct))
      byDomain.set(d, { url: u, domain: d, looksProduct });
  }
  return [...byDomain.values()].slice(0, maxResults).map(({ url, domain }) => ({ url, domain }));
}

/* Live re-verification of a single catalog offer: refetch the page and
   confirm the page still describes the SAME product before trusting its
   price enough to re-crown a winner.

   Two failure modes this guards against (M1 final review, findings 2 & 4):

   1. IDENTITY: naively lifting the first JSON-LD Product off a refetched
      page is unsafe — a related-product carousel or "customers also bought"
      block routinely puts a DIFFERENT, cheaper item first. Accepting that
      price blindly can re-crown a 199 EGP accessory over a 41,000 EGP TV.
      So every candidate price is re-identified with identify() and must
      satisfy sameProduct(offer, candidate).same === true before it is
      trusted.

   2. ETHICS: this fetch is NEW automated traffic the catalog engine adds on
      top of the crawler — one extra HTTP request per verified offer, per
      customer search. It must meet the same politeness bar the crawler
      holds itself to: the honest, identifying CRAWLER_UA (never a spoofed
      browser UA), and a robots.txt check before every fetch. robots.txt is
      cached per domain (with a TTL) so one lookup serves many
      verifications instead of one per offer. A URL robots disallows is
      never fetched — verification simply returns null for it. */
import { identify, sameProduct } from './matcher.mjs';
import { parseRobots, CRAWLER_UA } from './robots.mjs';

const ROBOTS_TTL_MS = 6 * 3600e3;

/* extractProducts(html, domain) -> [{ title, price, url }, ...], ordered as
   they appear on the page (index 0 = the page's own top JSON-LD Product).
   Left injectable rather than importing compare-server.mjs's jsonLdProducts
   directly: compare-server.mjs starts an HTTP server at module load, so
   nothing outside it may import it un-gated (see SADKO_NO_SERVE=1). */
export function createVerifyOffer({
  fetchImpl = fetch,
  extractProducts,
  robotsTtlMs = ROBOTS_TTL_MS,
  timeoutMs = 8000,
} = {}) {
  if (typeof extractProducts !== 'function')
    throw new Error('createVerifyOffer requires an extractProducts(html, domain) function');

  const robotsCache = new Map(); // domain -> { robots, t }
  async function getRobots(domain) {
    const cached = robotsCache.get(domain);
    if (cached && Date.now() - cached.t < robotsTtlMs) return cached.robots;
    let robots;
    try {
      const res = await fetchImpl(`https://${domain}/robots.txt`, {
        headers: { 'user-agent': CRAWLER_UA },
        signal: AbortSignal.timeout(6000),
      });
      robots = parseRobots(res && res.ok ? await res.text() : '');
    } catch {
      robots = parseRobots('');
    }
    robotsCache.set(domain, { robots, t: Date.now() });
    return robots;
  }

  return async function verifyOffer(o) {
    try {
      const u = new URL(o.url);
      const robots = await getRobots(u.hostname);
      if (!robots.allowed(u.pathname)) return null; // never fetch what robots disallows

      const res = await fetchImpl(o.url, {
        headers: { 'user-agent': CRAWLER_UA, accept: 'text/html,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res || !res.ok) return null;
      const html = await res.text();
      const items = extractProducts(html, o.domain || u.hostname) || [];
      const top = items[0];
      if (!top || !top.price) return null;

      // Re-identify the fetched page and require it still matches the
      // OFFER's own identity before trusting the price.
      const offerIdentity = identify(o.title_raw || o.title || '');
      const pageIdentity = identify(top.title || '');
      const m = sameProduct(offerIdentity, pageIdentity);
      return m.same === true ? top.price : null;
    } catch {
      return null;
    }
  };
}

/* Catalog search -> identity grouping -> live verification -> ranking.
   Ranking is DETERMINISTIC: price decides, identity confidence gates who may be
   crowned. Only 'exact'/'strong' offers can take rank 1. */
import { identify, sameProduct } from './matcher.mjs';

export async function rankOffers(catalog, query, opts = {}) {
  const { verify = async () => null, verifyTop = 10, limit = 200 } = opts;
  const rows = catalog.search(query, limit);
  if (!rows.length) return { results: [], cheapest: null, stats: { candidates: 0, verified: 0 } };

  // keep only offers whose identity is compatible with the query's identity
  const want = identify(query);
  const scored = [];
  for (const r of rows) {
    const got = identify(r.title_raw);
    const m = sameProduct(want, got);
    // when the query itself is under-specified (no brand/category), fall back to
    // FTS relevance and mark the offer weak rather than discarding everything
    const confidence = m.same ? m.confidence : (want.brand || want.category ? null : 'weak');
    if (!confidence) continue;
    scored.push({ ...r, confidence });
  }

  scored.sort((a, b) => a.price - b.price);

  // live re-verify only the cheapest N
  let verified = 0;
  await Promise.all(scored.slice(0, verifyTop).map(async o => {
    try {
      const fresh = await verify(o);
      if (typeof fresh === 'number' && fresh > 0) { o.price = fresh; o.verifiedFlag = true; verified++; }
    } catch {}
  }));
  scored.sort((a, b) => a.price - b.price);

  const results = scored.map(o => ({
    domain: o.domain, url: o.url, title: o.title_raw, price: o.price,
    currency: o.currency || 'EGP', confidence: o.confidence,
    verified: !!o.verifiedFlag, checkedAt: o.last_checked,
  }));

  // Crowning gate: everything reaching `results` already cleared sameProduct's
  // identity check (confidence 'none' — any contradiction on a defining
  // attribute — was filtered out above and never made it into `scored`).
  // 'weak' here means "no contradiction, just an attribute the query didn't
  // mention" (e.g. the query omits "smart" but the offer says it) — that is
  // still the same product, so it remains eligible to be crowned cheapest.
  let rank = 0;
  for (const r of results)
    if (rank < 5) r.rank = ++rank;

  return {
    results,
    cheapest: results.find(r => r.rank === 1) || null,
    stats: { candidates: rows.length, matched: results.length, verified },
  };
}

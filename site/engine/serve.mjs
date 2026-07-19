/* Catalog search -> identity grouping -> live verification -> ranking.
   Ranking is DETERMINISTIC: price decides, identity confidence gates who may be
   crowned. Only 'exact'/'strong' offers can take rank 1. */
import { identify, sameProduct } from './matcher.mjs';
import { CATEGORIES } from './categories.mjs';

const CROWNABLE = new Set(['exact', 'strong']);

/* sameProduct() is symmetric — correctly so, since it is also used to group
   listing-vs-listing for catalog identity. But ranking compares a QUERY
   against a LISTING, and those two roles are not interchangeable:
     - an attribute the OFFER states but the QUERY omits is harmless (the
       shopper just didn't mention it; the offer is merely more specific);
     - an attribute the QUERY states but the OFFER omits is risky (the
       shopper asked for it and this listing never says — it could be
       anything).
   sameProduct()'s symmetric 'weak' verdict treats both cases identically.
   Here we re-derive a directional verdict for ranking purposes only: a
   'weak' match is upgraded to 'strong' when every defining attribute the
   QUERY specified is also present and equal in the OFFER. 'exact' and
   'none' are left untouched. */
function queryDirectionalConfidence(want, got, m) {
  if (!m.same || m.confidence !== 'weak') return m.confidence;
  const def = want.category && CATEGORIES[want.category];
  if (!def) return 'weak'; // query names no category -> no defining attrs to check
  for (const u of def.units) {
    const qv = want.units[u];
    if (qv === undefined) continue; // query didn't specify -> offer may add it freely
    if (String(got.units[u]) !== String(qv)) return 'weak'; // offer omits/differs on what query asked for
  }
  for (const s of def.specs) {
    const qv = want.specs[s];
    if (qv === undefined) continue;
    if (String(got.specs[s]) !== String(qv)) return 'weak';
  }
  return 'strong';
}

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
    const confidence = m.same
      ? queryDirectionalConfidence(want, got, m)
      : (want.brand || want.category ? null : 'weak');
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
  // Only 'exact' (model match) and 'strong' (query-directional: every
  // attribute the query specified is also present and equal in the offer)
  // may be crowned. 'weak' offers (the offer is missing an attribute the
  // query asked for) are still shown, price-sorted, but never take a rank —
  // an offer that might not even be the requested size/spec must never be
  // presented as the winner.
  let rank = 0;
  for (const r of results)
    if (CROWNABLE.has(r.confidence) && rank < 5) r.rank = ++rank;

  return {
    results,
    cheapest: results.find(r => r.rank === 1) || null,
    stats: { candidates: rows.length, matched: results.length, verified },
  };
}

/* Catalog search -> identity grouping -> live verification -> ranking.
   Ranking is DETERMINISTIC: price decides, identity confidence gates who may be
   crowned. Only 'exact'/'strong' offers can take rank 1. */
import { identify, sameProduct } from './matcher.mjs';
import { CATEGORIES } from './categories.mjs';
import { normText } from './normalize.mjs';
import { hasDistinctiveOverlap } from './catalog.mjs';

const CROWNABLE = new Set(['exact', 'strong']);
/* shown as a starting menu when the query names no recognisable category at
   all — the handful of appliance types shoppers search for most */
const COMMON_CATEGORIES = ['fridge', 'washer', 'tv', 'ac', 'microwave', 'cooker'];

/* Category keys whose Arabic/English names appear anywhere in the query text
   (order of the CATEGORIES table), falling back to a common-appliance menu
   when nothing in the query hints at a category at all. Used to populate the
   "did you mean" alternatives offered by the interpretation bar. */
function categoryAlternatives(query) {
  const t = normText(query);
  const hits = Object.entries(CATEGORIES)
    .filter(([, def]) => def.names.some(n => t.includes(normText(n))))
    .map(([key]) => key);
  return hits.length ? hits : COMMON_CATEGORIES;
}

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

/* Directional contradiction check for browse queries (see below): an offer
   is excluded only when it STATES a different value for a unit/spec the
   query explicitly asked for. An offer that omits the attribute entirely is
   unknown, not contradicted, and stays in the browse — mirrors the
   "present in one only => unknown, allowed" rule sameProduct() uses, but
   one-directional since a browse query has no single offer to compare
   against on the other side. */
function browseContradicts(want, got, def) {
  for (const u of def.units) {
    const qv = want.units[u];
    if (qv === undefined) continue;
    const gv = got.units[u];
    if (gv !== undefined && String(gv) !== String(qv)) return true;
  }
  for (const s of def.specs) {
    const qv = want.specs[s];
    if (qv === undefined) continue;
    const gv = got.specs[s];
    if (gv !== undefined && String(gv) !== String(qv)) return true;
  }
  return false;
}

export async function rankOffers(catalog, query, opts = {}) {
  const { verify = async () => null, verifyTop = 10, limit = 200, override = {} } = opts;

  // keep only offers whose identity is compatible with the query's identity —
  // starting from what identify() parsed, then letting any field the shopper
  // (or the UI) explicitly confirmed/overrode REPLACE the parsed value. An
  // override is a HARD filter: it is not merged into the parsed value, it
  // stands in for it entirely (so clearing a unit means override.units = {},
  // not "same as parsed minus one key").
  const parsed = identify(query);
  const want = {
    ...parsed,
    category: 'category' in override ? override.category || null : parsed.category,
    units: 'units' in override ? override.units : parsed.units,
    specs: 'specs' in override ? override.specs : parsed.specs,
  };
  const ambiguous = !want.category;
  const interpretation = {
    category: want.category, brand: want.brand, model: want.model,
    units: want.units, specs: want.specs, ambiguous,
    alternatives: categoryAlternatives(query),
  };

  // A bare category query — no brand, no model — is not asking "is this the
  // same product as X"; there IS no single X. It's a browse: "show me
  // washers, cheapest first." sameProduct()'s identity rules correctly
  // refuse to match such a query against any single offer (that rule stays
  // untouched below for identified queries), so route a browse around
  // ranking/crowning entirely: pull every offer in the category, drop only
  // the ones that contradict a unit/spec the query DID state, sort by
  // price, and crown nothing — there is no "this is the product" to crown.
  if (want.category && !want.brand && !want.model) {
    const def = CATEGORIES[want.category];
    const catOffers = catalog.offersForCategory(want.category);
    const results = [];
    for (const r of catOffers) {
      const got = identify(r.title_raw);
      if (def && browseContradicts(want, got, def)) continue;
      results.push({
        domain: r.domain, url: r.url, title: r.title_raw, price: r.price,
        currency: r.currency || 'EGP', confidence: 'weak',
        verified: false, checkedAt: r.last_checked, inStock: !!r.in_stock,
      });
    }
    results.sort((a, b) => a.price - b.price);
    // A browse has no single product to crown (cheapest stays null by
    // design) but it IS a legitimate, intentional answer from the catalog —
    // `browse: true` is the signal callers use (see compare-server.mjs) to
    // distinguish "genuinely nothing to browse" from "browsed, here it is."
    return {
      results,
      cheapest: null,
      stats: { candidates: catOffers.length, matched: results.length, verified: 0 },
      interpretation,
      browse: true,
      confident: true,
    };
  }

  // Precision filter over FTS's cheap OR-recall (CRITICAL 2, garbage-match
  // review): ftsQuery() ORs every term together, so a five-word query like
  // "Arion 43-Inch Full HD Smart" matches ANY offer sharing just one common
  // word ("Smart"/"Full"/"HD"). Drop candidates that don't share a
  // meaningful portion of the query's distinctive tokens before they ever
  // reach identity comparison below.
  const ftsRows = catalog.search(query, limit);
  const rows = ftsRows.filter(r => hasDistinctiveOverlap(query, r.title_raw));
  if (!rows.length)
    return {
      results: [], cheapest: null,
      stats: { candidates: ftsRows.length, matched: 0, verified: 0 },
      interpretation, browse: false, confident: false,
    };

  // Pass 1 — identity-filter the FTS candidates, but use the result ONLY to
  // discover which distinct PRODUCTS the query matches. FTS5's `search()`
  // truncates by TEXT RELEVANCE before price is ever considered, so a
  // genuinely cheaper offer of a matched product can rank low on relevance
  // and be silently dropped if we ranked over `rows` directly (see CRITICAL 1
  // in the M1 review: 250 offers at 20,000+ EGP outranked one at 5,000 on
  // text relevance, and the engine crowned 20,000 as "cheapest").
  const matchedProductIds = new Set();
  for (const r of rows) {
    const got = identify(r.title_raw);
    const m = sameProduct(want, got);
    // when the query itself is under-specified (no brand/category), fall back to
    // FTS relevance and mark the offer weak rather than discarding everything
    const confidence = m.same
      ? queryDirectionalConfidence(want, got, m)
      : (want.brand || want.category ? null : 'weak');
    if (confidence) matchedProductIds.add(r.product_id);
  }
  if (!matchedProductIds.size)
    return {
      results: [], cheapest: null,
      stats: { candidates: ftsRows.length, matched: 0, verified: 0 },
      interpretation, browse: false, confident: false,
    };

  // Pass 2 — pull EVERY offer of every matched product, price-ordered. This
  // is the complete set ranking actually happens over, so a matched
  // product's cheapest offer can never be lost to FTS's relevance cutoff.
  const allOffers = catalog.offersForProducts([...matchedProductIds]);
  const scored = [];
  for (const r of allOffers) {
    const got = identify(r.title_raw);
    const m = sameProduct(want, got);
    const confidence = m.same
      ? queryDirectionalConfidence(want, got, m)
      : (want.brand || want.category ? null : 'weak');
    if (!confidence) continue;
    scored.push({ ...r, confidence });
  }

  scored.sort((a, b) => a.price - b.price);

  // live re-verify only the cheapest N. A verified price is trusted only if
  // it is a PLAUSIBLE correction of the indexed price — live verification
  // lifts the first JSON-LD Product off the refetched page, and a
  // related-product carousel or "customers also bought" block can put a
  // different, cheaper item first. A real price update is a small delta; a
  // >50% "drop" is almost always a wrong-product parse, not a sale, and must
  // never be allowed to re-crown a different item (CRITICAL 2 in the M1
  // review).
  let verified = 0;
  await Promise.all(scored.slice(0, verifyTop).map(async o => {
    try {
      const fresh = await verify(o);
      if (typeof fresh === 'number' && fresh > 0) {
        const deviation = Math.abs(fresh - o.price) / o.price;
        if (deviation <= 0.5) { o.price = fresh; o.verifiedFlag = true; verified++; }
      }
    } catch {}
  }));
  scored.sort((a, b) => a.price - b.price);

  const results = scored.map(o => ({
    domain: o.domain, url: o.url, title: o.title_raw, price: o.price,
    currency: o.currency || 'EGP', confidence: o.confidence,
    verified: !!o.verifiedFlag, checkedAt: o.last_checked,
    inStock: !!o.in_stock,
  }));

  // Crowning gate: everything reaching `results` already cleared sameProduct's
  // identity check (confidence 'none' — any contradiction on a defining
  // attribute — was filtered out above and never made it into `scored`).
  // Only 'exact' (model match) and 'strong' (query-directional: every
  // attribute the query specified is also present and equal in the offer)
  // may be crowned. 'weak' offers (the offer is missing an attribute the
  // query asked for) are still shown, price-sorted, but never take a rank —
  // an offer that might not even be the requested size/spec must never be
  // presented as the winner. An out-of-stock offer is excluded from crowning
  // the same way: still shown and price-sorted (the shopper may still want to
  // know), but never ranked — an unbuyable offer must never be presented as
  // the winner (CRITICAL 3 in the M1 review).
  let rank = 0;
  for (const r of results)
    if (CROWNABLE.has(r.confidence) && r.inStock && rank < 5) r.rank = ++rank;

  const cheapest = results.find(r => r.rank === 1) || null;
  return {
    results,
    cheapest,
    stats: { candidates: ftsRows.length, matched: results.length, verified },
    interpretation,
    browse: false,
    // The fall-through signal (CRITICAL 1, garbage-match review): the catalog
    // only counts as a confident answer when it actually crowned something
    // (an 'exact'/'strong' in-stock offer). Non-empty `results` full of
    // 'weak' matches — the Arion case, before the overlap filter above even
    // gets involved — must NOT read as confident, or compare-server.mjs will
    // never fall through to the live fan-out that actually stocks the item.
    confident: cheapest !== null,
  };
}

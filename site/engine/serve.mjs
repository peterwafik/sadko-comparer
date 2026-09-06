/* Catalog search -> identity grouping -> live verification -> ranking.
   Ranking is DETERMINISTIC: price decides, identity confidence gates who may be
   crowned. Only 'exact'/'strong' offers can take rank 1. */
import { identify, sameProduct, BRANDS } from './matcher.mjs';
import { CATEGORIES } from './categories.mjs';
import { normText } from './normalize.mjs';
import { hasDistinctiveOverlap, distinctiveTokens } from './catalog.mjs';

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

/* Accessory blocklist for the catalog path — the same idea as
   compare-server.mjs's isRelevant()/ACCESSORY, reimplemented as a small pure
   helper here rather than imported (compare-server.mjs starts an HTTP server
   at module load; importing it anywhere is unsafe). A minimal stem list:
   screen protectors, cases/covers, stands/mounts and similar goods sold FOR
   a device are never the device itself. Only the LEADING product-type
   segment of the title is inspected (capped at 50 chars, split on the first
   comma/dash/pipe/paren) — feature bullets deep in a real product's title
   routinely mention "stand" or "cover" without the product BEING one. */
/* Kept to stems that are long enough to be safe as an Arabic substring test —
   'رف' (shelf) and 'درج' (drawer) are genuine accessory words but would fire
   inside ordinary ones ('شرف' — Sharaf DG's own name — 'معرفة', 'مدرج'), so
   they are deliberately absent. 'حاجز' (divider/barrier) earns its place: a
   fridge shelf divider listed at 165 EGP was being crowned as the cheapest
   Toshiba fridge over a real 16,333 EGP one. */
const ACCESSORY_WORDS = [
  'حمايه', 'حماية', 'جراب', 'كفر', 'كاڤر', 'حافظه', 'غطاء', 'حامل', 'واقي', 'ستاند', 'فريم', 'حاجز',
  'protector', 'case', 'cover', 'pouch', 'sleeve', 'holder', 'stand', 'mount', 'guard', 'skin',
  'screen protector', 'divider', 'organizer',
];

/* Real catalog titles from this crawl are routinely "SKU-CODE-Arabic
   description" ("2T-C32DG6EX-شاشة شارب 32 بوصة أندرويد ريسيفر داخلي") — the
   hyphen sits INSIDE the leading SKU, not between a product-type clause and
   a feature-bullet tail. Splitting on hyphen/dash/paren (as
   compare-server.mjs's leadingSegment does) would truncate the window
   before the product-type word is ever reached, on both genuine listings
   (a real TV wrongly excluded) and accessory ones (an accessory word missed
   because it now falls just past the cut). Only a comma/Arabic-comma/pipe —
   which in this catalog really does separate "what the product is" from its
   feature-bullet tail — is treated as a boundary here. */
function leadingSegment(text, window = 60) {
  const head = text.slice(0, window);
  const m = head.match(/[,،|]/);
  return m ? head.slice(0, m.index) : head;
}

/* Does the query's resolved category's own name actually appear in the
   offer's LEADING segment? detectCategory() scans the WHOLE title for the
   EARLIEST category-name occurrence, so a tablet or smartwatch whose specs
   merely mention "touchscreen" deep in a comma-separated feature list gets
   mis-tagged as category 'tv' even though its own leading clause names a
   completely different (unregistered) product type ("تابلت...", "ساعة...").
   This does not touch detectCategory itself — it's an additional, narrower
   recheck applied only to ranking/filtering decisions here: trust a
   category match only when the category's name is where a leading-noun
   scan would actually find it. */
function categoryNameInLeading(category, title) {
  const def = CATEGORIES[category];
  if (!def) return false;
  const lead = normText(leadingSegment(title));
  return def.names.some(n => lead.includes(normText(n)));
}

/* full-word match for Latin stems ("stand" must not fire inside "standard"),
   plain substring for Arabic (consistent with the rest of the engine). */
function wordIn(normalizedText, word) {
  const nw = normText(word);
  return /^[a-z]+$/.test(nw)
    ? new RegExp('(^|[^a-z0-9])' + nw + '([^a-z0-9]|$)').test(normalizedText)
    : normalizedText.includes(nw);
}

// A narrower window than categoryNameInLeading's: a real product's title
// routinely mentions an accessory WORD as an ordinary feature/color spec
// further in ("...الشكل الجديد غطاء اسود..." — "new shape, BLACK LID" on a
// genuine washer) without the product BEING that accessory. Real
// product-type declarations are short — capping tighter here keeps that
// washer in a bare "غسالة" browse while still catching genuine accessory
// listings, whose product-type word (accessory or not) is always among the
// first few words, SKU prefix included.
const ACCESSORY_WINDOW = 30;

/* An offer is rejected as an accessory UNLESS the query itself asked for
   that accessory (a query for "حماية شاشة" must still find screen
   protectors). */
function isAccessoryOffer(query, title) {
  const qn = normText(query);
  if (ACCESSORY_WORDS.some(w => wordIn(qn, w))) return false;
  const lead = normText(leadingSegment(title, ACCESSORY_WINDOW));
  return ACCESSORY_WORDS.some(w => wordIn(lead, w));
}

/* Category enforcement for the catalog path: a query that resolved to a
   category must not surface offers of a DIFFERENT known category (already
   caught upstream by sameProduct's category-mismatch rule) OR offers that
   are simply uncategorized but happen to share the query's brand token —
   that's exactly the "شاشة سامسونج" bug (a Samsung phone/power bank/earbud
   listing carries no category signal at all, but shares "samsung" with the
   query and slipped through as if compatible). An uncategorized offer is
   only kept if it shares a query token that ISN'T merely the brand name —
   real evidence the listing is actually about the requested category, not
   just the same brand. */
function categoryOk(want, got, query) {
  if (!want.category) return true;
  if (got.category)
    return got.category === want.category && categoryNameInLeading(want.category, got.title || '');
  // Brand names can be multi-word ("ال جي" for LG), but distinctiveTokens()
  // splits on whitespace — comparing whole-string brand names against
  // single-word query tokens would never actually strip "ال"/"جي" out, and
  // "ال" (Arabic "the/al-") is common enough to spuriously overlap almost
  // any Arabic title, letting an unrelated same-brand product (a Bluetooth
  // speaker) pass a "تلفزيون ال جي" query. Split each brand-name variant
  // into its own words so every one of them is excluded individually.
  const brandNames = (want.brand && BRANDS[want.brand]) || [];
  const brandWords = new Set(brandNames.flatMap(n => normText(n).split(/\s+/)));
  const qTokens = distinctiveTokens(query).filter(tok => !brandWords.has(tok));
  if (!qTokens.length) return false;
  const nt = normText(got.title || '');
  return qTokens.some(tok => nt.includes(tok));
}

/* Brand enforcement: a DIFFERENT known brand disqualifies (mirrors — and is
   largely already covered by — sameProduct's own brand-mismatch rule, but
   the bare-category browse branch never calls sameProduct at all, so this
   stands on its own there too). Absence of a detected brand on the offer is
   not a contradiction. */
function brandOk(want, got) {
  if (!want.brand || !got.brand) return true;
  return got.brand === want.brand;
}

/* Single gate applied on both the bare-category browse branch and the
   identity-matched branch: category, brand, accessory. */
function offerAllowed(want, got, query, title) {
  return categoryOk(want, got, query) && brandOk(want, got) && !isAccessoryOffer(query, title);
}

/* sameProduct()'s blanket 'insufficient identity' verdict fires whenever
   EITHER side is missing a brand or category to compare against — it makes
   no distinction between "the offer's brand is undetected" (not a
   contradiction — see brandOk above) and "the query itself named no brand
   at all". That collapses a real, same-category, brand-undetected offer
   into 'none' alongside genuinely unrelated listings. Recover the former
   case here as a 'weak' match — shown, price-sorted, but per the crowning
   gate below never crowned over a genuinely branded/verified offer — without
   touching sameProduct itself (its symmetric identity rules are relied on
   elsewhere and are out of scope for this fix). */
function directedConfidence(want, got, query) {
  const m = sameProduct(want, got);
  if (m.same) return queryDirectionalConfidence(want, got, m);
  if (m.reason === 'insufficient identity' && want.brand && !got.brand &&
      want.category && got.category === want.category) {
    return 'weak';
  }
  return want.brand || want.category ? null : 'weak';
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
      if (!offerAllowed(want, got, query, r.title_raw)) continue;
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
    // when the query itself is under-specified (no brand/category), fall back to
    // FTS relevance and mark the offer weak rather than discarding everything
    const confidence = directedConfidence(want, got, query);
    if (confidence && offerAllowed(want, got, query, r.title_raw)) matchedProductIds.add(r.product_id);
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
    const confidence = directedConfidence(want, got, query);
    if (!confidence) continue;
    if (!offerAllowed(want, got, query, r.title_raw)) continue;
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

/* Fold the live fan-out's rows into a catalog answer and re-crown across both.

   catalog.db is a PARTIAL mirror: scripts/crawl-m1.mjs fills it from product
   sitemaps, so it holds only the stores that publish one. amazon.eg,
   carrefouregypt.com and the other headless/JS-only stores are absent from it
   by construction and can only ever be reached by the live fan-out. A
   confident catalog match is therefore an answer about ~10 stores, not about
   the market, and crowning its cheapest row as *the* cheapest states something
   the engine has not checked. Reported case: a Midea MF-CY85WK air fryer
   crowned at 6,498 from Sharaf DG while Amazon Egypt listed the same model at
   5,800 — a real, cheaper offer the shopper was never shown.

   Two rules, both deliberately conservative:

   - A live row is added only for a domain the catalog answer does not already
     cover. Both pipelines can return the same store, but they qualify a match
     differently: the catalog cleared sameProduct's identity check, the live
     row only cleared isRelevant. Where they overlap the stricter one wins,
     so a looser live match can never undercut a verified catalog price.

   - Crowning is recomputed over the union, and a row may be crowned only if
     the pipeline that produced it had already crowned it (`rank` set —
     'exact'/'strong' and in stock on the catalog side, unflagged on the live
     side). Merging must not promote a row neither pipeline was willing to
     stand behind; uncrownable rows stay visible and price-sorted, exactly as
     they are today. */
export function mergeLiveRows(catalogRows, liveRows = [], query = '', want = null) {
  const covered = new Set(catalogRows.map(r => r.domain));
  const crownable = new Set();

  // Catalog rows arrive already identity-checked by the pass above; their
  // crownability was decided by the crowning gate and is taken as given.
  const merged = catalogRows.map(r => {
    const copy = { ...r };
    if (r.rank != null) crownable.add(copy);
    return copy;
  });

  for (const row of liveRows) {
    if (covered.has(row.domain)) continue;
    const copy = { ...row };
    let ok = row.rank != null;          // the live pipeline was willing to crown it
    if (want) {
      const got = identify(row.title || '');
      // Wrong category, wrong brand, or an accessory FOR the product is not an
      // answer to the query at any price, and is dropped exactly as
      // offerAllowed drops it on the catalog side. Without this the live
      // pipeline's looser filter picks the winner: isRelevant does not know
      // "حاجز أدوية ثلاجة توشيبا" is a 165 EGP shelf divider rather than a
      // fridge, and it was crowned cheapest over a real 16,333 EGP Toshiba.
      if (!offerAllowed(want, got, query, row.title || '')) continue;
      /* Crowning, though, is all the identity verdict decides — it does not
         decide visibility. sameProduct compares model strings exactly, so the
         Egyptian retail suffix makes TW-BJ100M4EG read as a "model mismatch"
         against a query for TW-BJ100M4 even though it is the same washer;
         dropping on that verdict hid Amazon's 22,620 EGP listing of exactly
         the machine the shopper typed. Same-brand, same-category offers are
         therefore kept and price-sorted, flagged 'variant' so the UI says the
         engine is not certain they are the same unit, and left uncrowned —
         the rule 'weak' offers already follow throughout this module. */
      const confidence = directedConfidence(want, got, query);
      ok = ok && !!confidence && CROWNABLE.has(confidence);
      if (!ok && !copy.flags?.includes('variant')) copy.flags = [...(copy.flags || []), 'variant'];
    }
    if (ok) crownable.add(copy);
    merged.push(copy);
  }

  merged.sort((a, b) => a.price - b.price);
  let n = 0;
  for (const r of merged) r.rank = crownable.has(r) && n < 5 ? ++n : undefined;
  return merged;
}

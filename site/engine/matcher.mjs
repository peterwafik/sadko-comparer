/* Product identity. Pure — the whole accuracy claim of the comparer rests on
   sameProduct(). See docs/superpowers/specs/2026-07-19-price-comparer-catalog-design.md */
import { normText, extractModel } from './normalize.mjs';
import { extractUnits } from './units.mjs';
import { detectCategory, extractSpecs, CATEGORIES } from './categories.mjs';

export const BRANDS = {
  kiriazi: ['كريازي', 'kiriazi'], sharp: ['شارب', 'sharp'], tornado: ['تورنيدو', 'tornado'],
  fresh: ['فريش', 'fresh'], olympic: ['اوليمبك', 'olympic'], coldair: ['كولدير', 'coldair'],
  toshiba: ['توشيبا', 'toshiba'], zanussi: ['زانوسي', 'zanussi'], beko: ['بيكو', 'beko'],
  lg: ['ال جي', 'lg'], samsung: ['سامسونج', 'samsung'], midea: ['ميديا', 'midea'],
  carrier: ['كاريير', 'carrier'], unionaire: ['يونيون اير', 'unionaire'],
  passap: ['باساب', 'passap'], philips: ['فيليبس', 'philips'], kenwood: ['كينوود', 'kenwood'],
  braun: ['براون', 'braun'], hisense: ['هايسنس', 'hisense'], haier: ['هاير', 'haier'],
  bosch: ['بوش', 'bosch'], panasonic: ['باناسونيك', 'panasonic'],
  lagermania: ['لاجيرمانيا', 'lagermania', 'la germania'],
  sokany: ['سوكاني', 'sokany'], white_whale: ['وايت ويل', 'white whale'],
};

function detectBrand(title) {
  const t = normText(title);
  let best = null, pos = Infinity;
  for (const [brand, names] of Object.entries(BRANDS))
    for (const n of names) {
      const i = t.indexOf(normText(n));
      if (i !== -1 && i < pos) { best = brand; pos = i; }
    }
  return best;
}

export function identify(title) {
  const category = detectCategory(title);
  const brand = detectBrand(title);
  const model = extractModel(title);
  const allUnits = extractUnits(title);
  // keep only the units this category treats as DEFINING
  const defining = category ? CATEGORIES[category].units : [];
  const units = {};
  for (const u of defining) if (allUnits[u] !== undefined) units[u] = allUnits[u];
  const specs = category ? extractSpecs(title, category) : {};

  // A brand alone is not an identity anchor: it is unbounded — every
  // uncategorised item of that brand (a screen protector, a case, a power
  // bank, a tablet...) would collapse onto the SAME b:<brand>|c:?|| key.
  // Likewise a category alone, or neither, has nothing identity-bearing to
  // group by — the shared key would be IDENTICAL for every such listing,
  // collapsing unrelated products into one row at scale. Only fall into the
  // b:|c:|units|specs bucket when BOTH brand and category are known AND at
  // least one defining unit or spec value was extracted — that combination
  // is still bounded to one product type/configuration, and sameProduct's
  // confidence tiers keep a bare brand+category match from being crowned.
  // A brand+category pair with ZERO units and ZERO specs carries no more
  // identity than brand-alone: five different Fresh vacuums and a
  // mis-categorised Fresh thermal jug would all collapse onto the identical
  // bucket b:fresh|c:vacuum||, merging distinct products with wildly
  // different prices. That case — and the fully-unknown case — both fall
  // back to a key derived from the normalized title: deterministic (same
  // title -> same key, so re-crawls keep their price history) and unique
  // per distinct title (so unrelated listings never collide).
  const hasDefiningAttr = Object.keys(units).length > 0 || Object.keys(specs).length > 0;
  const key = model
    ? `m:${model}`
    : (brand && category && hasDefiningAttr)
      ? `b:${brand}|c:${category}|` +
        Object.entries(units).sort().map(([k, v]) => `${k}=${v}`).join(',') + '|' +
        Object.entries(specs).sort().map(([k, v]) => `${k}=${v}`).join(',')
      : `t:${normText(title)}`;

  return { brand, category, model, units, specs, key, title };
}

/* The rule: present in both and different => different product.
   Present in one only => unknown, allowed, lower confidence. */
export function sameProduct(a, b) {
  // Brand/category contradictions override everything downstream, including
  // an exact model-token match — a coincidental token collision across
  // brands or categories must never be crowned 'exact'.
  if (a.category && b.category && a.category !== b.category)
    return { same: false, confidence: 'none', reason: 'category mismatch' };
  if (a.brand && b.brand && a.brand !== b.brand)
    return { same: false, confidence: 'none', reason: 'brand mismatch' };

  if (a.model && b.model)
    return a.model === b.model
      ? { same: true, confidence: 'exact', reason: 'model match' }
      : { same: false, confidence: 'none', reason: 'model mismatch' };

  let bothKnown = 0, oneMissing = 0;
  const compare = (av, bv) => {
    const aHas = av !== undefined, bHas = bv !== undefined;
    // absent from BOTH listings is agreement, not missing information — a washer
    // pair that neither states RPM still deserves a 'strong' match
    if (!aHas && !bHas) return true;
    if (!aHas || !bHas) { oneMissing++; return true; }
    bothKnown++;
    return String(av) === String(bv);
  };

  const cat = a.category || b.category;
  const def = cat ? CATEGORIES[cat] : null;
  if (def) {
    for (const u of def.units)
      if (!compare(a.units[u], b.units[u]))
        return { same: false, confidence: 'none', reason: `unit ${u} differs` };
    for (const s of def.specs)
      if (!compare(a.specs[s], b.specs[s]))
        return { same: false, confidence: 'none', reason: `spec ${s} differs` };
  }

  if (!a.brand || !b.brand || !cat)
    return { same: false, confidence: 'none', reason: 'insufficient identity' };

  // every defining attribute known to both agreed
  return bothKnown > 0 && oneMissing === 0
    ? { same: true, confidence: 'strong', reason: 'all specs agree' }
    : { same: true, confidence: 'weak', reason: 'partial spec overlap' };
}

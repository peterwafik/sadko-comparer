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

  const key = model
    ? `m:${model}`
    : `b:${brand || '?'}|c:${category || '?'}|` +
      Object.entries(units).sort().map(([k, v]) => `${k}=${v}`).join(',') + '|' +
      Object.entries(specs).sort().map(([k, v]) => `${k}=${v}`).join(',');

  return { brand, category, model, units, specs, key, title };
}

/* The rule: present in both and different => different product.
   Present in one only => unknown, allowed, lower confidence. */
export function sameProduct(a, b) {
  if (a.model && b.model)
    return a.model === b.model
      ? { same: true, confidence: 'exact', reason: 'model match' }
      : { same: false, confidence: 'none', reason: 'model mismatch' };

  if (a.category && b.category && a.category !== b.category)
    return { same: false, confidence: 'none', reason: 'category mismatch' };
  if (a.brand && b.brand && a.brand !== b.brand)
    return { same: false, confidence: 'none', reason: 'brand mismatch' };

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

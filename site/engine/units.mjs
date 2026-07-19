/* Extract {canonicalUnit: number} from a bilingual product title.
   Real titles omit the space ("4.7لتر", "1500وات") and abbreviate ("7 ك"),
   so the number and unit are matched as one pattern with optional separator. */
import { normDigits, normText } from './normalize.mjs';

/* Order matters: longer/more specific spellings first, so "لتر" does not
   shadow nothing and "كيلو" is preferred over the bare "ك". */
const UNITS = [
  ['inch',  ['بوصه', 'بوصة', 'انش', 'inches', 'inch', '"']],
  ['liter', ['لتر', 'liters', 'litres', 'liter', 'litre', 'ltr', 'l']],
  ['kg',    ['كيلو', 'كجم', 'kilogram', 'kilo', 'kgs', 'kg', 'ك']],
  ['feet',  ['قدم', 'feet', 'foot', 'ft']],
  ['hp',    ['حصان', 'horsepower', 'hp']],
  ['rpm',   ['لفه', 'لفة', 'دورة', 'rpm']],
  ['watt',  ['وات', 'watts', 'watt', 'w']],
  ['tb',    ['تيرا', 'tb']],
  ['gb',    ['جيجا', 'gb']],
  ['cm',    ['سم', 'cm']],
];

/* A dimension pair like "90 × 60 سم" describes width×depth, not one value —
   detect and skip rather than record a misleading cm. */
const DIMENSION = /\d+\s*[x×*]\s*\d+/;

export function extractUnits(title) {
  const t = normText(normDigits(title));
  const out = {};
  for (const [canon, spellings] of UNITS) {
    for (const sp of spellings) {
      // bare single-letter units (l, w, k) require a word boundary before them
      const needsBoundary = /^[a-z]$/.test(sp) || sp === 'ك';
      const unitPat = sp.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
      const re = new RegExp(
        '(\\d+(?:\\.\\d+)?)\\s*' + unitPat + (needsBoundary ? '(?![a-z\\u0600-\\u06FF])' : ''),
        'i');
      const m = t.match(re);
      if (!m) continue;
      if (canon === 'cm' && DIMENSION.test(t)) break;   // size pair, not a spec
      out[canon] = parseFloat(m[1]);
      break;
    }
  }
  return out;
}

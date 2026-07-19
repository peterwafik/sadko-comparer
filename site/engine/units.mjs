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
   detect and skip that specific number rather than suppressing cm outright.
   Checked around the matched number's own position, not the whole title, so
   a standalone cm reading elsewhere in the same title still gets recorded. */
function isDimensionPairNumber(t, numStart, numStr) {
  const numEnd = numStart + numStr.length;
  const before = t.slice(0, numStart);
  const after = t.slice(numEnd);
  return /\d+\s*[x×*]\s*$/.test(before) || /^\s*[x×*]\s*\d+/.test(after);
}

export function extractUnits(title) {
  const t = normText(normDigits(title));
  const out = {};
  for (const [canon, spellings] of UNITS) {
    for (const sp of spellings) {
      // Latin-script spellings (and bare Arabic 'ك') require a trailing word
      // boundary so a unit doesn't prefix-match inside a longer token, e.g.
      // "gb" inside "gbps". Arabic words take prefixes/suffixes, so other
      // Arabic spellings keep no trailing guard.
      //
      // The boundary itself differs by script: a Latin spelling must not be
      // followed by more Latin/digits (blocks "gb" in "gbps"), but real
      // catalog titles run an English fragment straight into an Arabic one
      // with no space ("10 Feetثلاجة") — so Arabic script must still be
      // allowed to follow. Bare Arabic 'ك' has the opposite need: it must
      // not be followed by more Arabic letters (blocks 'ك' inside 'كيلو').
      const isLatin = /^[a-z]+$/i.test(sp);
      const isBareArabicKaf = sp === 'ك';
      let boundary = '';
      if (isLatin) boundary = '(?![a-zA-Z0-9])';
      else if (isBareArabicKaf) boundary = '(?![a-z\\u0600-\\u06FF])';
      const unitPat = sp.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
      const re = new RegExp(
        '(\\d+(?:\\.\\d+)?)\\s*' + unitPat + boundary,
        'gi');
      let m;
      let found = null;
      while ((m = re.exec(t))) {
        if (canon === 'cm' && isDimensionPairNumber(t, m.index, m[1])) continue;
        found = m;
        break;
      }
      if (!found) continue;
      out[canon] = parseFloat(found[1]);
      break;
    }
  }
  return out;
}

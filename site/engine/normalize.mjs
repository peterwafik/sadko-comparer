/* Text normalization primitives. Pure — no I/O, no state.
   Arabic titles vary freely in alef/ya/ta-marbuta spelling and digit script;
   every comparison in the engine runs through here first. */

export function normDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٬٫]/g, ',');
}

export function normText(s) {
  return normDigits(s)
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '')   // diacritics + tatweel
    .replace(/\s+/g, ' ')
    .trim();
}

export function normModel(s) {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* A model number is a letters+digits run of >=5 normalized chars that is not a
   pure spec value. Real titles split models across BOTH spaces and en-dashes
   ("RF – 51 FTV – DST", "TC4 -ZWF7240SS5"), so consecutive ALL-CAPS/digit
   fragments are joined. Casing is the signal that separates a model fragment
   from prose: "RF"/"FTV"/"BK" are fragments, "Black"/"Frost"/"Tornado" are not.
   Spec tokens (16GB, RAM, SSD, 4K) are dropped so a spec list never reads as a
   model. */
const SPEC_ONLY = /^\d+(GB|TB|MB|KG|ML|MM|CM|HZ|HP|W|K|L|INCH|INCHES|LPM|RPM)$/;
const SPEC_WORDS = new Set(['RAM', 'SSD', 'HDD', 'LED', 'LCD', 'OLED', 'QLED', 'UHD', 'FHD',
  'HD', 'TV', 'PC', 'USB', 'WIFI', 'AC', 'DC', 'CPU', 'GPU', 'NFC', 'GPS', 'LTE',
  'BAGLESS', 'COMPRESSOR', 'INVERTER', 'DIGITAL', 'SOLO', 'GRILL', 'SILVER', 'BLACK',
  'WHITE', 'STEEL', 'TURBO', 'ECO', 'PLUS', 'MAX', 'PRO', 'SMART', 'TYPE',
  'DOBLY', 'DOLBY', 'AUDIO', 'MISSION', 'MASTER', 'SERIES', 'EDITION']);

/* A candidate is a "plausible identifier" once it clears the same bar the old
   single-best scan used: >=5 normalized chars, at least one letter and one
   digit, and not a pure spec value ("500W" survives SPEC_ONLY as a run only
   via fusion, so it's re-checked here too). */
function isValidModel(s) {
  return s.length >= 5 && /\d/.test(s) && /[A-Z]/.test(s) && !SPEC_ONLY.test(s);
}

/* Returns every plausible identifier in a title, most-distinctive (longest)
   first. Consecutive ALL-CAPS/digit fragments are joined across spaces and
   dashes exactly as before ("RF – 51 FTV – DST" -> one model), but three
   things now stop a run from swallowing a second, independent identifier:
   a token that STARTS with "(" is a standalone parenthesised group and is a
   run boundary on both sides ("PL-BL1200185 (810307)" -> two runs), ALL-CAPS
   feature words in SPEC_WORDS terminate a run the way Titlecase prose
   already did, and a run that is already a valid model on its own starts a
   fresh candidate rather than absorbing the next fragment when that
   fragment is *also* independently a valid model (catches adjacent SKU +
   model pairs with no feature word or bracket between them, e.g.
   "F500013673 - FW-17VDB").
   A parenthesis that is merely GLUED to the end of a fragment (no space
   before it, e.g. "8460SUP(DS)") is not a boundary at all — it's one
   fragment with a trailing variant code, and normModel already strips the
   paren characters when the run is joined. */
export function extractModels(title) {
  const t = normDigits(String(title ?? ''));
  const runs = [];
  let cur = [];
  const flush = () => { if (cur.length) runs.push(cur.join('')); cur = []; };

  for (const tok of t.split(/\s+/)) {
    if (/^[-–—]+$/.test(tok)) continue;          // a lone dash connects, never breaks
    const opensParen = tok.startsWith('(');       // only a standalone "(...)" token is a boundary
    if (opensParen) flush();                      // never fuse a standalone paren group with what precedes it
    const core = normModel(tok);
    const stripped = tok.replace(/[-–—()]/g, '');
    const isFragment = core.length > 0 && core.length <= 12 &&
      stripped === stripped.toUpperCase() && /^[A-Z0-9]+$/.test(core);
    if (!isFragment) { flush(); continue; }
    if (SPEC_ONLY.test(core) || SPEC_WORDS.has(core)) { flush(); continue; }
    if (cur.length) {
      const accumulated = cur.join('');
      if (isValidModel(accumulated) && isValidModel(core)) flush();  // two identifiers, not one fused run
    }
    cur.push(core);
    if (opensParen) flush();                      // ...or with what follows it
  }
  flush();

  const seen = new Set();
  const out = [];
  for (const r of runs) {
    if (!isValidModel(r) || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

export function extractModel(title) {
  return extractModels(title)[0] ?? null;
}

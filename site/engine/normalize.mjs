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
  'HD', 'TV', 'PC', 'USB', 'WIFI', 'AC', 'DC', 'CPU', 'GPU', 'NFC', 'GPS', 'LTE']);

export function extractModel(title) {
  const t = normDigits(String(title ?? ''));
  const runs = [];
  let cur = [];
  const flush = () => { if (cur.length) runs.push(cur.join('')); cur = []; };

  for (const tok of t.split(/\s+/)) {
    if (/^[-–—]+$/.test(tok)) continue;          // a lone dash connects, never breaks
    const core = normModel(tok);
    const stripped = tok.replace(/[-–—]/g, '');
    const isFragment = core.length > 0 && core.length <= 12 &&
      stripped === stripped.toUpperCase() && /^[A-Z0-9]+$/.test(core);
    if (!isFragment) { flush(); continue; }
    if (SPEC_ONLY.test(core) || SPEC_WORDS.has(core)) { flush(); continue; }
    cur.push(core);
  }
  flush();

  let best = null;
  for (const r of runs) {
    if (r.length < 5) continue;
    if (!/\d/.test(r) || !/[A-Z]/.test(r)) continue;
    if (SPEC_ONLY.test(r)) continue;
    if (!best || r.length > best.length) best = r;
  }
  return best;
}

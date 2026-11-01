/* ============================================================================
   SADKO spec engine — turns a catalogue row into normalised, comparable specs.
   ----------------------------------------------------------------------------
   The catalogue we have is a scrape: `title` + a free-text `description` that
   happens to carry the manufacturer's spec sheet in a semi-consistent shape
   ("280 Liter", "Dimensions: Width: 55 cm.Depth: 62.5 cm.", "9 KG",
   "2.25 حصان", "65 بوصة", "Class (A)"). This module reads those out into fixed
   fields so the finder, the suitability panel and the energy calculator can all
   reason about the same numbers.

   HONESTY RULE — the one thing that must never be broken here: a spec we could
   not read is `undefined`, never a guess and never a zero. Every consumer is
   expected to say "غير متوفر" and to refuse to filter on a spec it doesn't
   have, rather than silently drop a product that might have been the right one.

     skSpecs.derive(product) -> { brand, capacity, dims, energy, … , known: [] }
     skSpecs.of(product)     -> memoised derive()
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- text normalisation ---------- */
  const AR_DIGITS = /[٠-٩]/g;
  function norm(s) {
    return String(s || '')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(AR_DIGITS, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[٫،]/g, '.')
      .replace(/‏|‎|‪|‬/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const num = s => { const n = parseFloat(String(s).replace(/,/g, '')); return isFinite(n) ? n : undefined; };

  /* ---------- brands (bilingual) ---------- */
  const BRANDS = [
    ['Kiriazi', 'كريازي', ['كريازى', 'kiriazi']],
    ['Fresh', 'فريش', ['فريش', 'fresh']],
    ['Sharp', 'شارب', ['شارب', 'sharp']],
    ['Toshiba', 'توشيبا', ['توشيبا', 'toshiba']],
    ['Tornado', 'تورنيدو', ['تورنيدو', 'tornado']],
    ['Carrier', 'كاريير', ['كاريير', 'كارير', 'carrier']],
    ['Unionaire', 'يونيون اير', ['يونيون اير', 'يونيونير', 'unionaire']],
    ['White Whale', 'وايت ويل', ['وايت ويل', 'white whale']],
    ['Zanussi', 'زانوسي', ['زانوسي', 'زانوسى', 'zanussi']],
    ['Beko', 'بيكو', ['بيكو', 'beko']],
    ['LG', 'إل جي', ['إل جي', 'ال جي', 'lg']],
    ['Samsung', 'سامسونج', ['سامسونج', 'سامسونغ', 'samsung']],
    ['Hoover', 'هوفر', ['هوفر', 'hoover']],
    ['Universal', 'يونيفرسال', ['يونيفرسال', 'universal']],
    ['Koldair', 'كولدير', ['كولدير', 'koldair']],
    ['Midea', 'ميديا', ['ميديا', 'midea']],
    ['Haier', 'هاير', ['هاير', 'haier']],
    ['Bosch', 'بوش', ['بوش', 'bosch']],
    ['Electrolux', 'إلكترولوكس', ['إلكترولوكس', 'electrolux']],
    ['Ariston', 'أريستون', ['أريستون', 'اريستون', 'ariston']],
    ['Olympic', 'أوليمبيك', ['أوليمبيك', 'اوليمبيك', 'olympic']],
    ['Jac', 'جاك', ['جاك', 'jac']],
    ['Gree', 'جري', ['جري', 'gree']],
    ['TCL', 'تي سي إل', ['tcl']],
    ['Hisense', 'هايسنس', ['هايسنس', 'hisense']],
    ['Philips', 'فيليبس', ['فيليبس', 'philips']],
    ['Braun', 'براون', ['براون', 'braun']],
    ['Moulinex', 'مولينكس', ['مولينكس', 'moulinex']],
    ['Black & Decker', 'بلاك اند ديكر', ['بلاك اند ديكر', 'black &amp; decker', 'black & decker', 'black+decker']],
    ['Kenwood', 'كينوود', ['كينوود', 'kenwood']],
    ['Tefal', 'تيفال', ['تيفال', 'tefal']],
    ['Delonghi', 'ديلونجي', ['ديلونجي', 'delonghi', "de'longhi"]],
    ['Panasonic', 'باناسونيك', ['باناسونيك', 'panasonic']],
    ['Dora', 'دورا', ['دورا', 'dora']],
    ['Passap', 'باساب', ['باساب', 'passap']],
    ['Sona', 'سونا', ['سونا', 'sona']],
    ['Home Elec', 'هوم اليك', ['هوم اليك', 'home elec']],
    ['General', 'جنرال', ['جنرال', 'general']],
  ];
  /* Arabic letters that are spelled either way: Ecwid's registered "كريازي"
     never matched the list's "كريازى", so Kiriazi showed as an unknown brand
     with no logo. Both sides are folded before comparing. */
  const foldAr = s => String(s).replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[أإآ]/g, 'ا');
  /* Compiled once. brandOf used to build every keyword's RegExp on every call,
     i.e. ~40 patterns for each of the ~990 products the shop derives on load
     (profiled at ~0.3 s of a throttled phone's load). Same patterns, same
     order, so the same brand wins. */
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let BRAND_RES = null;
  const brandRes = () => BRAND_RES || (BRAND_RES = BRANDS.map(([en, ar, keys]) => ({
    en, ar,
    res: keys.map(k => (/[a-z]/i.test(k) ? new RegExp('(^|[^a-z])' + escRe(k) + '([^a-z]|$)', 'i')
                                          : new RegExp(escRe(foldAr(k))))),
  })));
  function brandOf(hay) {
    const H = foldAr(hay);
    for (const b of brandRes()) {
      for (const re of b.res) if (re.test(H)) return { en: b.en, ar: b.ar };
    }
    return undefined;
  }

  /* The brand the owner registered on the product (Ecwid's BRAND attribute) is
     authoritative, and was being ignored: only the fixed list above was scanned,
     so a product whose brand is registered but not in that list showed the brand
     as unavailable. Known brands keep their bilingual names; any other registered
     brand is shown as typed, in both languages, rather than dropped. */
  function registeredBrand(v) {
    /* \s, not s: the bare "s" stripped the letter, so "Samsung" read "Sam ung". */
    const name = String(v == null ? '' : v).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return undefined;
    return brandOf(norm(name)) || { en: name, ar: name };
  }

  /* ---------- dimensions (cm) ---------- */
  // Handles "Width: 55 cm.Depth: 62.5 cm.Height: 153.1 cm", "Width 59.5, Depth 64.5 and Height 101.5",
  // "عرض 55 سم", and bare "55 x 62 x 153".
  function dimsOf(hay) {
    const grab = (labels) => {
      for (const L of labels) {
        const re = new RegExp(L + '\\s*[:\\-]?\\s*([\\d.]+)\\s*(?:cm|سم|س\\.م)?', 'i');
        const m = hay.match(re);
        if (m) { const v = num(m[1]); if (v > 5 && v < 400) return v; }
      }
      return undefined;
    };
    let w = grab(['width', 'العرض', 'عرض']);
    let d = grab(['depth', 'العمق', 'عمق']);
    let h = grab(['height', 'الارتفاع', 'الإرتفاع', 'ارتفاع', 'إرتفاع']);
    if (w === undefined && d === undefined && h === undefined) {
      const m = hay.match(/(\d{2,3}(?:\.\d)?)\s*[x×*]\s*(\d{2,3}(?:\.\d)?)\s*[x×*]\s*(\d{2,3}(?:\.\d)?)/);
      if (m) { w = num(m[1]); d = num(m[2]); h = num(m[3]); }
    }
    return (w || d || h) ? { w, d, h } : undefined;
  }

  /* ---------- capacity ---------- */
  // Each unit is kept in its own field: comparing 9 kg against 280 L is meaningless,
  // and a single "capacity" number would invite exactly that mistake.
  function capacityOf(hay) {
    const one = (re, lo, hi) => {
      const m = hay.match(re);
      if (!m) return undefined;
      const v = num(m[1]);
      return (v >= lo && v <= hi) ? v : undefined;
    };
    return {
      litre: one(/(\d{2,4}(?:\.\d)?)\s*(?:liter|litre|لتر)/i, 3, 900),
      kg:    one(/(?:capacity\s*[:\-]?\s*)?(\d{1,2}(?:\.\d)?)\s*(?:kg|كجم|كيلو)/i, 1, 30),
      feet:  one(/(\d{1,2})\s*(?:feet|قدم)/i, 3, 30),
      inch:  one(/(\d{2})\s*(?:inch|"|بوصة)/i, 14, 100),
      hp:    one(/(\d(?:\.\d{1,2})?)\s*(?:hp|حصان)/i, 0.5, 6),
      // Arabic spec sheets write BTU as "17.400" — a THOUSANDS separator, not a
      // decimal point. Read that shape first and scale it, or an 17,400 BTU unit
      // silently becomes 17.
      btu:   (function () {
               const m = hay.match(/(\d{2})\.(\d{3})\s*\(?\s*(?:و\s*ح\s*ب|btu)/i);
               if (m) return num(m[1] + m[2]);
               return one(/(?:btu\/?h?\s*[:\-]?\s*|و\s*ح\s*ب)\D{0,12}?(\d{4,6})/i, 3000, 80000);
             })(),
      watt:  one(/(\d{3,4})\s*(?:watt|وات)/i, 100, 4000),
    };
  }

  /* ---------- energy / efficiency ---------- */
  function energyOf(hay) {
    const cls = hay.match(/class\s*\(?\s*([A-D])\s*\+*\s*\)?|درجة\s*(?:كفاءة|الطاقة)\s*\(?\s*([A-D])/i);
    const inverter = /inverter|انفرتر|إنفرتر/i.test(hay);
    const saving = /energy\s*sav|higher efficiency|less consumption|توفير\s*(?:في\s*)?(?:الطاقة|الكهرباء)|موفر\s*(?:للطاقة|للكهرباء)|كفاءة\s*عالية/i.test(hay);
    const kwh = (hay.match(/(\d{2,4})\s*kwh/i) || [])[1];
    return {
      cls: cls ? (cls[1] || cls[2] || '').toUpperCase() : undefined,
      inverter, saving: saving || inverter,
      kwhYear: kwh ? num(kwh) : undefined,
    };
  }

  /* ---------- colour ---------- */
  const COLORS = [
    ['silver', 'سيلفر', /silver|سيلفر|فض[يى]/i],
    ['black', 'أسود', /black|أسود|اسود/i],
    ['white', 'أبيض', /white|أبيض|ابيض/i],
    ['stainless', 'ستانلس', /stainless|ستانلس/i],
    ['grey', 'رمادي', /\bgr[ae]y\b|رمادي|رمادى/i],
    ['blue', 'أزرق', /\bblue\b|أزرق|ازرق/i],
    ['red', 'أحمر', /\bred\b|أحمر|احمر/i],
    ['beige', 'بيچ', /beige|بيج|بيچ/i],
    ['gold', 'ذهبي', /\bgold\b|ذهبي|ذهبى/i],
  ];
  function colorOf(hay) {
    for (const [key, ar, re] of COLORS) if (re.test(hay)) return { key, ar };
    return undefined;
  }

  /* ---------- misc feature flags ---------- */
  function featuresOf(hay) {
    const f = {};
    const has = re => re.test(hay);
    f.noFrost   = has(/no\s*[- ]?frost|نو\s*فروست|بدون\s*ثلج/i);
    f.defrost   = has(/\bdefrost\b|دى\s*فروست|دي\s*فروست/i);
    f.smart     = has(/\bsmart\b|سمارت|android|أندرويد|اندرويد|google tv|web ?os/i);
    f.digital   = has(/digital|ديجيتال/i);
    f.plasma    = has(/plasma|بلازما/i);
    f.heating   = has(/cooling\s*&?\s*heating|بارد\s*[-\/]?\s*ساخن|تدفئة/i);
    f.coolOnly  = !f.heating && has(/cooling only|بارد\s*فقط/i);
    f.frontLoad = has(/front\s*load|أوتوماتيك\s*فول|امامية|أمامية/i);
    f.topLoad   = has(/top\s*load|فوق\s*أوتوماتيك|عل?و?ي[ةه]?\s*التحميل|توب\s*لود/i);
    f.halfAuto  = has(/half\s*automatic|نص\s*أوتوماتيك|نصف\s*أوتوماتيك/i);
    f.steam     = has(/\bsteam\b|بخار/i);
    f.childLock = has(/child\s*lock|قفل\s*الأطفال|آمن\s*للأطفال/i);
    f.warranty  = (hay.match(/warranty\s*[:\-]?\s*(\d{1,2})\s*(?:year|سنة|سنوات)|ضمان\s*(\d{1,2})\s*(?:سنة|سنوات)/i) || []).slice(1).find(Boolean);
    // "2 Doors 10 Feet" — read the count BEFORE the word first, and never let a
    // trailing "10 Feet" be swallowed as the door count.
    const doors = hay.match(/(\d)\s*doors?\b/i) || hay.match(/doors?\s*[:\-]?\s*(\d)(?!\d)/i)
               || hay.match(/(\d)\s*(?:باب|أبواب)/);
    f.doors = doors ? num(doors[1]) : undefined;
    const cov = hay.match(/coverage\s*area\s*[^\d]{0,14}(\d{1,3})\s*(?:square\s*met|m2|م2|متر)/i)
             || hay.match(/(?:تكييف|تغطية)\D{0,18}(\d{1,3})\s*متر\s*مربع/i);
    f.coverM2 = cov ? num(cov[1]) : undefined;
    const res = hay.match(/\b(4k|8k|full\s*hd|fhd|hd)\b/i);
    f.resolution = res ? res[1].toUpperCase().replace(/\s+/g, ' ') : undefined;
    const rpm = hay.match(/(\d{3,4})\s*rpm|سرعة\s*(?:الدوران|العصر)\D{0,8}(\d{3,4})/i);
    f.rpm = rpm ? num(rpm[1] || rpm[2]) : undefined;
    return f;
  }

  /* ---------- installation / delivery notes worth surfacing ---------- */
  function notesOf(hay) {
    const out = [];
    if (/installation|التركيب/i.test(hay) && /القاهرة|cairo/i.test(hay))
      out.push({ key: 'install-area', ar: 'التركيب متاح فى القاهرة والجيزة والإسكندرية فقط، راجع التفاصيل قبل الشراء.', en: 'Installation is available in Cairo, Giza and Alexandria only, so check before buying.' });
    if (/no delivery charges|free\s*\)?\s*delivery|بدون\s*رسوم\s*توصيل/i.test(hay))
      out.push({ key: 'free-delivery', ar: 'التوصيل مجانى للقاهرة والجيزة والإسكندرية حسب وصف المنتج.', en: 'Free delivery to Cairo, Giza and Alexandria per the product description.' });
    if (/north coast/i.test(hay) && /fees/i.test(hay))
      out.push({ key: 'coast-fee', ar: 'التوصيل للساحل الشمالى موسمى وعليه رسوم إضافية.', en: 'North Coast delivery is seasonal and carries an extra fee.' });
    return out;
  }

  /* ---------- category family ---------- */
  // Drives which questions the finder asks and which specs the panels show.
  const FAMILY = {
    '38003882': 'fridge', '38005648': 'freezer', '38005652': 'washer',
    '38003963': 'washer', '38022381': 'tv', '38032005': 'ac',
    '38003799': 'cooker', '50318054': 'fan', '40507239': 'waterheater',
    '48143206': 'waterheater', '48149056': 'waterheater', '102858075': 'watercooler',
    '57646037': 'microwave', '112439376': 'small', '68782006': 'small',
    '185355010': 'small', '185364502': 'small', '81167227': 'small',
    '81170222': 'vacuum', '38022354': 'dishwasher',
  };

  /* ---------- main ---------- */
  function derive(p) {
    const title = norm(p.title);
    const desc = norm(p.description);
    const hay = title + ' ' + desc;
    const family = FAMILY[String(p.categoryId)] || 'other';

    const s = {
      id: p.id, title, family,
      price: typeof p.price === 'number' ? p.price : num(p.price),
      brand: registeredBrand(p.brand) || brandOf(hay),
      dims: dimsOf(hay),
      cap: capacityOf(hay),
      energy: energyOf(hay),
      color: colorOf(hay),
      f: featuresOf(hay),
      notes: notesOf(hay),
    };

    // A single headline capacity per family, so the UI has one honest number to show.
    s.headline = (() => {
      const c = s.cap;
      if (family === 'fridge' || family === 'freezer' || family === 'watercooler')
        return c.litre ? { v: c.litre, u: 'لتر', uEn: 'L' } : (c.feet ? { v: c.feet, u: 'قدم', uEn: 'ft' } : undefined);
      if (family === 'washer' || family === 'dishwasher') return c.kg ? { v: c.kg, u: 'كجم', uEn: 'kg' } : undefined;
      if (family === 'tv') return c.inch ? { v: c.inch, u: 'بوصة', uEn: '"' } : undefined;
      if (family === 'ac') return c.hp ? { v: c.hp, u: 'حصان', uEn: 'HP' } : undefined;
      if (family === 'microwave') return c.litre ? { v: c.litre, u: 'لتر', uEn: 'L' } : undefined;
      return c.litre ? { v: c.litre, u: 'لتر', uEn: 'L' } : (c.watt ? { v: c.watt, u: 'وات', uEn: 'W' } : undefined);
    })();

    // What we could actually read — the panels use this to be explicit about gaps.
    s.known = [];
    if (s.brand) s.known.push('brand');
    if (s.headline) s.known.push('capacity');
    if (s.dims && (s.dims.w || s.dims.h)) s.known.push('dims');
    if (s.energy.cls || s.energy.saving) s.known.push('energy');
    if (s.color) s.known.push('color');
    return s;
  }

  const cache = new Map();
  function of(p) {
    if (!p) return null;
    const k = p.id;
    if (!cache.has(k)) cache.set(k, derive(p));
    return cache.get(k);
  }

  /* ---------- household-size guidance (used by finder + product panel) ----------
     Ranges are editorial guidance, deliberately generous and expressed as a
     range, never as a single "correct" number. */
  const SIZING = {
    fridge:  [{ ppl: 2, min: 180, max: 320 }, { ppl: 4, min: 250, max: 420 }, { ppl: 6, min: 320, max: 600 }, { ppl: 99, min: 400, max: 900 }],
    freezer: [{ ppl: 2, min: 90, max: 200 }, { ppl: 4, min: 150, max: 300 }, { ppl: 6, min: 200, max: 400 }, { ppl: 99, min: 250, max: 900 }],
    washer:  [{ ppl: 2, min: 6, max: 8 }, { ppl: 4, min: 7, max: 10 }, { ppl: 6, min: 9, max: 13 }, { ppl: 99, min: 10, max: 30 }],
  };
  function sizeFor(family, people) {
    const table = SIZING[family];
    if (!table || !people) return undefined;
    return table.find(r => people <= r.ppl) || table[table.length - 1];
  }

  // Rough room-area guidance for ACs (Egyptian rule of thumb, ~1 HP per 12–16 m²).
  function acHpFor(m2) {
    if (!m2) return undefined;
    if (m2 <= 14) return { min: 1, max: 1.5 };
    if (m2 <= 20) return { min: 1.5, max: 2.25 };
    if (m2 <= 30) return { min: 2.25, max: 3 };
    return { min: 3, max: 5 };
  }

  /* The server derives delivery size classes from the same parser, so the
     product page and the delivery fee can never disagree about a size. */
  const api = { derive, of, norm, sizeFor, acHpFor, BRANDS, FAMILY };
  if (typeof window !== 'undefined') window.skSpecs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

/* Category table — the extension point. Adding an appliance type is one entry
   here; no matcher code changes. `units` and `specs` are the DEFINING
   attributes: if two listings disagree on any of them, they are different
   products. */
import { normText } from './normalize.mjs';

export const CATEGORIES = {
  tv:        { units: ['inch'],           specs: ['resolution', 'smart'],
               names: ['تلفزيون', 'تليفزيون', 'تلفاز', 'شاشه', 'television', 'tv'] },
  fridge:    { units: ['liter', 'feet'],  specs: ['doors', 'nofrost'],
               names: ['ثلاجه', 'تلاجه', 'refrigerator', 'fridge'] },
  freezer:   { units: ['liter', 'feet'],  specs: ['drawers'],
               names: ['فريزر', 'ديب فريزر', 'freezer'] },
  washer:    { units: ['kg', 'rpm'],      specs: ['loading'],
               names: ['غساله', 'washing machine', 'washer'] },
  dishwasher:{ units: [],                 specs: ['sets'],
               names: ['غساله اطباق', 'dishwasher'] },
  dryer:     { units: ['kg'],             specs: [],
               names: ['مجفف', 'دراير', 'dryer'] },
  ac:        { units: ['hp'],             specs: ['inverter', 'mode'],
               names: ['تكييف', 'تكيف', 'مكيف', 'air conditioner', 'conditioner'] },
  microwave: { units: ['liter', 'watt'],  specs: ['grill'],
               names: ['ميكروويف', 'مايكروويف', 'ميكرويف', 'مايكرويف', 'microwave'] },
  oven:      { units: ['liter'],          specs: ['fuel'],
               names: ['فرن', 'oven'] },
  cooker:    { units: ['cm'],             specs: ['burners', 'fuel'],
               names: ['بوتاجاز', 'بوتجاز', 'cooker', 'stove'] },
  fryer:     { units: ['liter', 'watt'],  specs: ['digital'],
               names: ['قلايه', 'مقلاه', 'air fryer', 'fryer', 'airfryer'] },
  heater:    { units: ['liter', 'watt'],  specs: ['fuel'],
               names: ['سخان', 'heater'] },
  cooler:    { units: [],                 specs: ['taps'],
               names: ['مبرد مياه', 'مبرد ميه', 'water dispenser', 'dispenser'] },
  vacuum:    { units: ['watt'],           specs: [],
               names: ['مكنسه', 'vacuum', 'hoover'] },
  blender:   { units: ['watt'],           specs: [],
               names: ['خلاط', 'blender', 'mixer'] },
  kettle:    { units: ['liter', 'watt'],  specs: [],
               names: ['غلايه', 'كاتيل', 'kettle'] },
  fan:       { units: [],                 specs: ['type'],
               names: ['مروحه', 'fan'] },
  laptop:    { units: ['inch', 'gb', 'tb'], specs: ['cpu', 'ram'],
               names: ['لاب توب', 'لابتوب', 'laptop', 'notebook'] },
  phone:     { units: ['gb'],             specs: ['ram', 'network'],
               names: ['موبايل', 'هاتف', 'smartphone', 'mobile phone'] },
  iron:      { units: ['watt'],           specs: ['steam'],
               names: ['مكواه', 'مكوه', 'iron', 'steam iron'] },
  hob:       { units: ['cm'],             specs: ['burners', 'fuel'],
               names: ['مسطح', 'مسطح طباخ', 'hob', 'cooktop'] },
  food_processor: { units: ['liter', 'watt'], specs: [],
               names: ['محضر طعام', 'محضر', 'قطاعه', 'food processor', 'chopper'] },
  hand_mixer: { units: ['watt'],          specs: [],
               names: ['مضرب بيض', 'هاند بلندر', 'hand mixer', 'hand blender'] },
};

/* Decide by EARLIEST occurrence, not mere presence. Arabic product titles lead
   with the product type; a water cooler that mentions "بالثلاجة شاشة" later in
   the description must not be classified as a fridge or a TV. Longer names win
   ties so "مبرد مياه" beats a shorter accidental match. */
export function detectCategory(title) {
  const t = normText(title);
  let bestCat = null, bestPos = Infinity, bestLen = 0;
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    for (const name of def.names) {
      const n = normText(name);
      const pos = t.indexOf(n);
      if (pos === -1) continue;
      if (pos < bestPos || (pos === bestPos && n.length > bestLen)) {
        bestCat = cat; bestPos = pos; bestLen = n.length;
      }
    }
  }
  return bestCat;
}

/* Spec readers, keyed by spec name. Each returns a value or undefined. */
const SPEC_READERS = {
  nofrost:  t => /نوفروست|نو فروست|no ?frost/.test(t) || undefined,
  inverter: t => /انفرتر|inverter/.test(t) || undefined,
  smart:    t => /سمارت|ذكيه|smart/.test(t) || undefined,
  digital:  t => /ديجيتال|digital/.test(t) || undefined,
  grill:    t => /جريل|grill/.test(t) || undefined,
  doors:    t => (t.match(/(\d+)\s*باب/) || t.match(/(\d+)\s*doors?/) || [])[1],
  burners:  t => (t.match(/(\d+)\s*شعله/) || t.match(/(\d+)\s*burners?/) || [])[1],
  taps:     t => (t.match(/(\d+)\s*حنفيه/) || t.match(/(\d+)\s*taps?/) || [])[1],
  drawers:  t => (t.match(/(\d+)\s*درج/) || [])[1],
  sets:     t => (t.match(/(\d+)\s*فرد/) || [])[1],
  ram:      t => (t.match(/(\d+)\s*(?:جيجا)?\s*ram/) || [])[1],
  cpu:      t => (t.match(/\b(i[3579]|ryzen\s*\d|celeron|athlon)\b/) || [])[1],
  resolution: t => (t.match(/\b(4k|8k|uhd|fhd|hd)\b/) || [])[1],
  loading:  t => /فتحه علويه|top ?load/.test(t) ? 'top'
              : /فتحه اماميه|front ?load/.test(t) ? 'front' : undefined,
  fuel:     t => /غاز|gas/.test(t) ? 'gas'
              : /كهرب|electric/.test(t) ? 'electric' : undefined,
  mode:     t => /بارد\s*[-\/ ]?\s*ساخن|cooling ?& ?heating|heat/.test(t) ? 'cool-heat'
              : /بارد|cooling/.test(t) ? 'cool' : undefined,
  network:  t => /\b5g\b/.test(t) ? '5g' : /\b4g\b/.test(t) ? '4g' : undefined,
  type:     t => /عمود|ستاند|قائم|\bstand\b/.test(t) ? 'stand'
              : /حائط|جدار|\bwall\b/.test(t) ? 'wall'
              : /سقف|\bceiling\b/.test(t) ? 'ceiling'
              : /مكتب|طاوله|\bdesk\b/.test(t) ? 'desk' : undefined,
  steam:    t => /بخار|steam/.test(t) || undefined,
};

export function extractSpecs(title, category) {
  const def = CATEGORIES[category];
  if (!def) return {};
  const t = normText(title);
  const out = {};
  for (const spec of def.specs) {
    const read = SPEC_READERS[spec];
    if (!read) continue;
    const v = read(t);
    if (v !== undefined) out[spec] = v;
  }
  return out;
}

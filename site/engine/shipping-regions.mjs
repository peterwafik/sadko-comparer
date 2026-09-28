/* ============================================================================
   Governorate → delivery region.

   Every Ecwid shipping method has destinationZone WORLD, so Ecwid cannot tell
   Aswan from Cairo; the region exists only in the method NAMES. This is that
   reading, made explicit: three regions exactly as the store titles them, and
   null — "customer care confirms the fee" — for anywhere they do not name.
   ========================================================================== */

const LIST = [
  ['القاهرة', 'Cairo', 'metro', 'cairo'], ['الجيزة', 'Giza', 'metro', 'giza'],
  ['الإسكندرية', 'Alexandria', 'metro', 'alex'],
  ['القليوبية', 'Qalyubia', 'delta'], ['الشرقية', 'Sharqia', 'delta'], ['الدقهلية', 'Dakahlia', 'delta'],
  ['الغربية', 'Gharbia', 'delta'], ['المنوفية', 'Monufia', 'delta'], ['كفر الشيخ', 'Kafr El Sheikh', 'delta'],
  ['دمياط', 'Damietta', 'delta'], ['البحيرة', 'Beheira', 'delta'], ['بورسعيد', 'Port Said', 'delta'],
  ['الإسماعيلية', 'Ismailia', 'delta'], ['السويس', 'Suez', 'delta'],
  ['الفيوم', 'Fayoum', 'upper'], ['بنى سويف', 'Beni Suef', 'upper'], ['المنيا', 'Minya', 'upper'],
  ['أسيوط', 'Assiut', 'upper'], ['سوهاج', 'Sohag', 'upper'], ['قنا', 'Qena', 'upper'],
  ['الأقصر', 'Luxor', 'upper'], ['أسوان', 'Aswan', 'upper'], ['الوادى الجديد', 'New Valley', 'upper'],
  ['مطروح', 'Matrouh', 'upper'], ['البحر الأحمر', 'Red Sea', 'upper'],
  ['الساحل الشمالى', 'North Coast', 'upper'],
  ['شمال سيناء', 'North Sinai', null], ['جنوب سيناء', 'South Sinai', null],
];

/* Names people actually type or had saved: [alias, region, metro key]. */
const ALIASES = [
  ['مرسى مطروح', 'upper', null], ['حلوان', 'metro', 'cairo'], ['القاهرة الكبرى', 'metro', 'cairo'],
  ['6 أكتوبر', 'metro', 'giza'], ['السادس من أكتوبر', 'metro', 'giza'], ['الشيخ زايد', 'metro', 'giza'],
];

export function normGov(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/^محافظه\s+/, '').replace(/\s+/g, ' ');
}

const BY = new Map();
for (const [ar, en, region, metro] of LIST) {
  const v = { region: region || null, metro: metro || null };
  BY.set(normGov(ar), v); BY.set(normGov(en), v);
}
for (const [alias, region, metro] of ALIASES) BY.set(normGov(alias), { region, metro });

export const GOVERNORATES = LIST.map(([ar, en, region]) => ({ ar, en, region: region || null }));
export function regionOf(name) { const v = BY.get(normGov(name)); return v ? v.region : null; }
export function metroKeyOf(name) { const v = BY.get(normGov(name)); return v ? v.metro : null; }

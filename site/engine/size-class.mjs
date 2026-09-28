/* ============================================================================
   Product → delivery size band.

   Ecwid charges the Delta and Upper Egypt per item by band — small, medium,
   large, extra-large — and defines each band only in words inside the method
   titles. This reads a product into one of those bands, by category NAME
   (the test and production stores share no ids), and uses the product's own
   size where the store splits a category by it. It returns null rather than
   guessing: a null band means customer care confirms the fee.
   ========================================================================== */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const specs = require('../assets/js/specs.js');

export const CLASS_LABELS = {
  small: { ar: 'منتجات صغيرة', en: 'Small appliance' },
  medium: { ar: 'منتجات متوسطة', en: 'Medium appliance' },
  large: { ar: 'منتجات كبيرة', en: 'Large appliance' },
  xl: { ar: 'منتجات كبيرة جدا', en: 'Extra-large appliance' },
  craft: { ar: 'حرف يدوية ومنتجات عضوية', en: 'Handicrafts & organic' },
};

const N = s => String(s == null ? '' : s).trim().toLowerCase()
  .replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ');

const ok = (cls, ar, en) => ({ cls, why: { ar, en } });
const no = (ar, en) => ({ cls: null, why: { ar, en } });

function fridge(p) {
  if (/(4|٤)\s*باب/.test(N(p.title))) return ok('xl', 'ثلاجة 4 باب', '4-door refrigerator');
  const l = specs.derive(p).cap.litre;
  if (!l) return no('ثلاجة بدون سعة باللتر فى العنوان', 'refrigerator with no litres in its title');
  return l > 450 ? ok('xl', `ثلاجة ${l} لتر (فوق 450)`, `${l} L refrigerator (over 450)`)
                 : ok('large', `ثلاجة ${l} لتر (حتى 450)`, `${l} L refrigerator (up to 450)`);
}
function tv(p) {
  const i = specs.derive(p).cap.inch;
  if (!i) return no('شاشة بدون مقاس بالبوصة فى العنوان', 'television with no inches in its title');
  if (i < 50) return ok('medium', `شاشة ${i} بوصة`, `${i}" television`);
  if (i <= 75) return ok('large', `شاشة ${i} بوصة (50–75)`, `${i}" television (50–75)`);
  return ok('xl', `شاشة ${i} بوصة (فوق 75)`, `${i}" television (over 75)`);
}
function washer(p) {
  return /واش\s*تاور|وتش\s*تور|wash\s*tower/i.test(p.title)
    ? ok('xl', 'غسالة واش تاور', 'wash-tower washer') : ok('medium', 'غسالة ملابس', 'washing machine');
}
function fanOrCooler(p) {
  const t = N(p.title);
  if (/شفاط/.test(t)) {
    const cm = Number((/(\d{2,3})\s*سم/.exec(t) || [])[1]);
    if (/بوتاجاز|بوتجاز|هرمي|مدخنه/.test(t) || cm >= 60) return ok('medium', 'شفاط بوتاجاز', 'cooker hood');
    return ok('small', 'شفاط', 'extractor fan');
  }
  if (/مروحه|مراوح|دفايه|دفاديه|\bfan\b|heater/.test(t)) return ok('small', 'مروحة أو دفاية', 'fan or heater');
  if (/مبرد|cooler/.test(t)) return ok('medium', 'مبرد هواء', 'air cooler');
  return no('منتج غير واضح فى قسم المراوح والمبردات', 'unclear product in fans & coolers');
}

const small = () => ok('small', 'جهاز صغير', 'small appliance');
const medium = () => ok('medium', 'جهاز متوسط', 'medium appliance');

const BY_CATEGORY = new Map([
  ...['خلاطات و محضرات طعام', 'مكاوي', 'كاتيل و ماكينات قهوه', 'ميكروييف', 'مكانس', 'قلايات', 'افران كهربائيه']
    .map(c => [c, small]),
  ...['تكييفات هواء', 'سخانات كهرباء', 'سخانات غاز', '5 شعله', '4 شعله', 'غسالات اطباق', 'مبردات مياه']
    .map(c => [c, medium]),
  ...['فريزر راسي', 'فريزر افقي'].map(c => [c, () => ok('large', 'فريزر', 'freezer')]),
  ['نو فروست', fridge], ['ديفروست', fridge], ['تليفزيونات', tv], ['غسالات ملابس', washer],
  ['مبردات هواء ومراوح', fanOrCooler],
  ['حرف يدويه ومنتجات عضويه', () => ok('craft', 'حرف يدوية', 'handicraft')],
]);

/* For categories the table does not name (offers, unnamed folders): the title
   alone, and only when exactly one family matches. */
const BY_TITLE = [
  [/ثلاج/, fridge], [/شاشه|تليفزيون|تلفزيون/, tv], [/غساله ملابس/, washer],
  [/تكييف|سخان|بوتاجاز|بوتجاز/, medium],
  [/مروحه|دفايه/, () => ok('small', 'مروحة أو دفاية', 'fan or heater')],
  [/ميكرويف|مكواه|خلاط|كاتل|مكنسه/, small],
];

export function sizeClassOf(product, categoryName) {
  const p = { id: product && product.id, title: String((product && product.title) || ''),
              description: String((product && product.description) || '') };
  const rule = BY_CATEGORY.get(N(categoryName));
  if (rule) return rule(p);
  const hits = BY_TITLE.filter(([re]) => re.test(N(p.title)));
  if (hits.length === 1) return hits[0][1](p);
  return no('القسم غير معروف لتحديد فئة الشحن', 'category not recognised for delivery');
}

process.env.SADKO_NO_SERVE = '1';
const { isRelevant } = await import('file:///D:/SADKO/site/compare-server.mjs');
const q = 'تكييف سبليت انفرتر بارد وساخن مع بلازما كلاستر من شارب AY-XP18UHE، 2.25 حصان - فضي';
const attrs = { brand:'Sharp', model_number:'AY-XP18UHE', size_value:2.25, size_unit:'hp',
  query_en:'Sharp split inverter AC 2.25hp', query_ar:'مكيف سبليت انفرتر شارب 2.25 حصان', compatible_brands:[] };
console.log('AI OFF, identical Arabic title  ->', isRelevant(q, q, null));
console.log('AI ON,  identical Arabic title  ->', isRelevant(q, q, attrs));
const amazonAr = 'تكييف هواء شارب AY-XP24UHE سبليت رقمي بتقنية بلازما كلاستر - 3 حصان، فضي';
console.log('AI ON,  other Arabic sharp AC   ->', isRelevant(amazonAr, q, attrs));
const en = 'Sharp Split Air Conditioner 2.25 HP Cool-Heat Inverter Digital Plasma Cluster Silver AY-XP18UHE';
console.log('AI ON,  English sharp title     ->', isRelevant(en, q, attrs));

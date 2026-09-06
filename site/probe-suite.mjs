process.env.SADKO_NO_SERVE = '1';
const M = await import('file:///D:/SADKO/site/compare-server.mjs');
const { ADAPTERS, isRelevant, understandQuery } = M;
const store = { domain:'amazon.eg', platform:'amazon', needsHeadless:true };

const seeds = ['تكييف شارب','غسالة اتوماتيك','ثلاجة توشيبا','شاشة سامسونج','ميكروويف','سخان كهربائي',
               'Samsung washing machine','LG refrigerator'];
const cases = [];
for (const s of seeds) {
  let raw = [];
  try { raw = (await ADAPTERS.amazon(store, s)) || []; } catch { }
  raw.slice(0, 2).forEach(x => cases.push({ seed: s, title: x.title, price: x.price }));
  console.log(`harvest "${s}" -> ${raw.length} items`);
}
console.log(`\n=== ${cases.length} pasted-title cases ===\n`);
let pass = 0, fail = 0;
for (const c of cases) {
  const attrs = await understandQuery(c.title);
  const variants = [c.title];
  if (attrs) {
    if (attrs.model_number && String(attrs.model_number).length >= 4) variants.push(String(attrs.model_number));
    if (attrs.query_en && attrs.query_en.length > 3) variants.push(String(attrs.query_en));
    if (attrs.query_ar && attrs.query_ar.length > 3) variants.push(String(attrs.query_ar));
  }
  const attempts = [...new Set(variants.map(x=>x.trim()).filter(x=>x.length>=2))].slice(0,3);
  let got = null, usedAttempt = -1;
  for (const [i,a] of attempts.entries()) {
    let raw = [];
    try { raw = (await ADAPTERS.amazon(store, a)) || []; } catch {}
    const kept = raw.filter(it => it.price && isRelevant(it.title, c.title, attrs));
    if (kept.length) { got = kept; usedAttempt = i+1; break; }
  }
  const exact = got && got.some(x => x.title.slice(0,60) === c.title.slice(0,60));
  if (exact) pass++; else fail++;
  console.log(`${exact ? 'PASS' : 'FAIL'} [attempt ${usedAttempt}] want: ${c.title.slice(0,70)}`);
  if (!exact) console.log(`        got: ${got ? got.map(x=>x.title.slice(0,70)).slice(0,2).join(' | ') : 'NOTHING'}`);
}
console.log(`\n>> exact pasted product retrieved: ${pass}/${pass+fail}`);
process.exit(0);

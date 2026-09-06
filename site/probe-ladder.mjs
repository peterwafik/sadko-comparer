process.env.SADKO_NO_SERVE = '1';
const M = await import('file:///D:/SADKO/site/compare-server.mjs');
const { ADAPTERS, isRelevant, understandQuery } = M;

const q = 'تكييف سبليت انفرتر بارد وساخن مع بلازما كلاستر من شارب AY-XP18UHE، 2.25 حصان - فضي';
const attrs = await understandQuery(q);
console.log('attrs =', JSON.stringify(attrs));

// rebuild the ladder exactly as searchStore does
const variants = [q];
if (attrs) {
  if (attrs.model_number && String(attrs.model_number).length >= 4) variants.push(String(attrs.model_number));
  if (attrs.query_en && attrs.query_en.length > 3) variants.push(String(attrs.query_en));
  if (attrs.query_ar && attrs.query_ar.length > 3) variants.push(String(attrs.query_ar));
}
const attempts = [...new Set(variants.map(x=>x.trim()).filter(x=>x.length>=2))].slice(0,3);
console.log('attempts =', JSON.stringify(attempts, null, 1));

const store = { domain:'amazon.eg', platform:'amazon', needsHeadless:true };
for (const [i, a] of attempts.entries()) {
  const t0 = Date.now();
  let raw = [];
  try { raw = (await ADAPTERS.amazon(store, a)) || []; }
  catch (e) { console.log(`\n--- attempt ${i+1} THREW: ${e.message}`); continue; }
  const kept = raw.filter(it => it.price && isRelevant(it.title, q, attrs));
  console.log(`\n--- attempt ${i+1} (${Date.now()-t0}ms) q="${a}"`);
  console.log(`    raw=${raw.length} kept=${kept.length}`);
  raw.slice(0,6).forEach(x => {
    const ok = x.price && isRelevant(x.title, q, attrs);
    console.log(`      ${ok?'KEEP':'drop'} [${x.price}] ${x.title}`);
  });
  if (kept.length) { console.log('    >> LADDER STOPS HERE, returns these'); break; }
}
process.exit(0);

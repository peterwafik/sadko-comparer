process.env.SADKO_NO_SERVE = '1';
const M = await import('file:///D:/SADKO/site/compare-server.mjs');
const { ADAPTERS, isRelevant, understandQuery } = M;
const q = 'تكييف سبليت انفرتر بارد وساخن مع بلازما كلاستر من شارب AY-XP18UHE، 2.25 حصان - فضي';
const attrs = await understandQuery(q);
const store = { domain:'amazon.eg', platform:'amazon', needsHeadless:true };
const N = +(process.argv[2] || 6);
let hits = 0;
for (let i = 1; i <= N; i++) {
  let raw = [];
  try { raw = (await ADAPTERS.amazon(store, q)) || []; } catch (e) { console.log(i, 'THREW', e.message); continue; }
  const kept = raw.filter(it => it.price && isRelevant(it.title, q, attrs));
  const exact = kept.some(x => /XP18UHE/i.test(x.title));
  if (exact) hits++;
  console.log(`run ${i}: raw=${String(raw.length).padStart(2)} kept=${String(kept.length).padStart(2)} exactModelKept=${exact ? 'YES' : 'no '}  top kept: ${(kept[0]||{}).title || '—'}`);
}
console.log(`\n>> exact model survived ${hits}/${N} runs`);
process.exit(0);

process.env.SADKO_NO_SERVE='1';
const { ADAPTERS, isRelevant, understandQuery } = await import('file:///D:/SADKO/site/compare-server.mjs');
const fs = await import('node:fs');
const q = JSON.parse(fs.readFileSync('cases.json','utf8'))[7].title;
const attrs = await understandQuery(q);
const variants=[q];
if(attrs){ if(attrs.model_number&&String(attrs.model_number).length>=4) variants.push(String(attrs.model_number));
  if(attrs.query_en&&attrs.query_en.length>3) variants.push(String(attrs.query_en));
  if(attrs.query_ar&&attrs.query_ar.length>3) variants.push(String(attrs.query_ar)); }
const attempts=[...new Set(variants.map(x=>x.trim()).filter(x=>x.length>=2))].slice(0,3);
console.log('attempts =', JSON.stringify(attempts,null,1));
const store={domain:'amazon.eg',platform:'amazon',needsHeadless:true};
for(const [i,a] of attempts.entries()){
  const t0=Date.now(); let raw=[];
  try{ raw=(await ADAPTERS.amazon(store,a))||[]; }catch(e){ console.log(`attempt ${i+1} THREW`,e.message); continue; }
  const kept=raw.filter(it=>it.price&&isRelevant(it.title,q,attrs));
  console.log(`\nattempt ${i+1} (${Date.now()-t0}ms) raw=${raw.length} kept=${kept.length}  q="${a.slice(0,50)}"`);
  raw.slice(0,5).forEach(x=>console.log(`   ${isRelevant(x.title,q,attrs)?'KEEP':'drop'} [${x.price}] ${x.title.slice(0,66)}`));
  if(kept.length){ console.log('   >> ladder stops'); break; }
}
process.exit(0);

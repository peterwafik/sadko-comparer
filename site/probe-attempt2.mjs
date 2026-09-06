process.env.SADKO_NO_SERVE='1';
const { ADAPTERS } = await import('file:///D:/SADKO/site/compare-server.mjs');
const store={domain:'amazon.eg',platform:'amazon',needsHeadless:true};
for (const m of ['FMW-25KC-SW','GR-RT468WE-PMN','Q6F 55 QLED','QA55Q6F']) {
  let raw=[]; try{ raw=(await ADAPTERS.amazon(store,m))||[]; }catch(e){ console.log(m,'THREW'); continue; }
  console.log(`\nsearch "${m}" -> ${raw.length}`);
  raw.slice(0,4).forEach(x=>console.log(`   [${x.price}] ${x.title.slice(0,75)}`));
}
process.exit(0);

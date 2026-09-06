process.env.SADKO_NO_SERVE='1';
const { ADAPTERS } = await import('file:///D:/SADKO/site/compare-server.mjs');
const store={domain:'amazon.eg',platform:'amazon',needsHeadless:true};
for (const m of ['VG4130EE','مروحة تيفال VG4130EE','Tefal VG4130EE']) {
  let raw=[]; try{ raw=(await ADAPTERS.amazon(store,m))||[]; }catch(e){ console.log(m,'THREW'); continue; }
  console.log(`\nsearch "${m}" -> ${raw.length}`);
  raw.slice(0,3).forEach(x=>console.log(`   [${x.price}] ${x.title.slice(0,72)}`));
}
process.exit(0);

process.env.SADKO_NO_SERVE='1';
const { ADAPTERS } = await import('file:///D:/SADKO/site/compare-server.mjs');
const store={domain:'amazon.eg',platform:'amazon',needsHeadless:true};
const seeds=['غسالة اطباق','خلاط كهربائي','مكواة بخار','سماعات بلوتوث','لاب توب','مكنسة كهربائية','شفاط مطبخ','بوتاجاز'];
const out=[];
for(const s of seeds){ let raw=[]; try{raw=(await ADAPTERS.amazon(store,s))||[];}catch{}
  if(raw[0]) out.push({seed:s,title:raw[0].title,price:raw[0].price}); }
(await import('node:fs')).writeFileSync('cases.json',JSON.stringify(out,null,1));
console.log('cases:',out.length); process.exit(0);

process.env.SADKO_NO_SERVE='1';
const { isRelevant, understandQuery } = await import('file:///D:/SADKO/site/compare-server.mjs');
const c = JSON.parse((await import('node:fs')).readFileSync('cases.json','utf8'));
const q = c[7].title;
const attrs = await understandQuery(q);
console.log('query :', q);
console.log('ai.model_number =', JSON.stringify(attrs && attrs.model_number));
const titles = [
  'Tefal VG4130EE Silence Force, Stand Fan, Silent Technology, Remote Control, 16 Inch',
  'Tefal VG4135EE Silence Force, Stand Fan, Anti-Mosquito, Silent Technology',
];
for (const t of titles) console.log(`  isRelevant=${String(isRelevant(t,q,attrs)).padEnd(5)} :: ${t.slice(0,66)}`);
process.exit(0);

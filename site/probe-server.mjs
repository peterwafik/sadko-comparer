// End-to-end: paste a real Amazon title into the LIVE server, check whether
// the amazon.eg row is that same product.
import { readFileSync } from 'node:fs';
const cases = JSON.parse(readFileSync('cases.json','utf8'));
let pass=0, wrong=0, missing=0;
for (const c of cases) {
  const url = `http://localhost:8082/api/compare?q=${encodeURIComponent(c.title)}&discover=0`;
  let r;
  try { r = await (await fetch(url)).json(); } catch(e){ console.log('ERR', e.message); continue; }
  const rows = r.results || [];
  const az = rows.filter(x => x.domain === 'amazon.eg');
  const exact = az.some(x => x.title.slice(0,55) === c.title.slice(0,55));
  const cheapest = rows[0];
  if (exact) { pass++; console.log(`PASS  amazon row = pasted product`); }
  else if (az.length) { wrong++; console.log(`WRONG amazon row is a DIFFERENT product`); }
  else { missing++; console.log(`MISS  no amazon row at all`); }
  console.log(`      pasted: ${c.title.slice(0,68)}`);
  console.log(`      amazon: ${az.length ? az.map(x=>`[${x.price}] ${x.title.slice(0,60)}`).join(' | ') : '—'}`);
  console.log(`      crowned cheapest: ${cheapest ? `[${cheapest.price}] ${cheapest.domain} :: ${cheapest.title.slice(0,55)}` : '—'}\n`);
}
console.log(`>> pasted product found on amazon row: ${pass}/${cases.length}  (wrong product: ${wrong}, absent: ${missing})`);

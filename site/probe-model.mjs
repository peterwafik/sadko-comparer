process.env.SADKO_NO_SERVE='1';
const { isRelevant, understandQuery } = await import('file:///D:/SADKO/site/compare-server.mjs');
const pairs = [
  ['ميكروويف ديجيتال 25 لتر فضي من فريش FMW-25KC-SW', 'ميكروويف فريش، لون فضي ميكانيكي سعة 25 لتر طراز FMW-25MC-SW'],
  ['ثلاجة GR-RT468WE-PMN(49)-PRO، بتقنية الإنفرتر، ومنطقة تبريد', 'ثلاجة طراز GR-RT468WE-DMN (49) بفلتر بيولوجي نقي من توشيبا'],
  ['تلفزيون ذكي بشاشة QLED 55 بوصة، Q6F، معالج Q4 لايت', 'شاشة تلفزيون سمارت QLED 55 بوصة من سامسونج، معالج نيورال كوانتوم QN70H'],
];
for (const [q,t] of pairs) {
  const attrs = await understandQuery(q);
  console.log(`\nq  : ${q.slice(0,60)}`);
  console.log(`t  : ${t.slice(0,60)}`);
  console.log(`ai.model_number = ${JSON.stringify(attrs && attrs.model_number)}`);
  console.log(`isRelevant -> ${isRelevant(t,q,attrs)}   (should be false: different model)`);
}
process.exit(0);

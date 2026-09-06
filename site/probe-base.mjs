process.env.SADKO_NO_SERVE='1';
const { isRelevant } = await import('file:///D:/SADKO/site/compare-server.mjs');
const Q1 = 'ميكروويف ديجيتال 25 لتر فضي من فريش FMW-25KC-SW';
const cands = [
  ['exact model, Arabic title', 'ميكروويف ديجيتال 25 لتر فضي من فريش طراز FMW-25KC-SW', Q1, {model_number:'FMW-25KC-SW'}],
  ['neighbour model, Arabic',   'ميكروويف ديجيتال 25 لتر فضي من فريش طراز FMW-25MC-SW', Q1, {model_number:'FMW-25KC-SW'}],
  ['no model stated, Arabic',   'ميكروويف ديجيتال 25 لتر فضي من فريش',                  Q1, {model_number:'FMW-25KC-SW'}],
  ['measurement tokens only',   'ميكروويف ديجيتال 25 لتر فضي من فريش 850 وات 1400rpm',  Q1, {model_number:'FMW-25KC-SW'}],
];
for (const [name,t,q,a] of cands) console.log(`${String(isRelevant(t,q,a)).padEnd(5)}  ${name}`);
process.exit(0);

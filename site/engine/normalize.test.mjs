import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDigits, normText, normModel, extractModel, extractModels } from './normalize.mjs';

test('normDigits converts Arabic-Indic digits', () => {
  assert.equal(normDigits('٧٥ بوصة'), '75 بوصة');
  assert.equal(normDigits('۱۲۸'), '128');
  assert.equal(normDigits('75'), '75');
});

test('normText unifies Arabic letter variants and decodes entities', () => {
  assert.equal(normText('غسالة'), normText('غساله'));      // ta-marbuta vs ha
  assert.equal(normText('كريازى'), normText('كريازي'));    // alef-maqsura vs ya
  assert.equal(normText('أمازون'), normText('امازون'));    // hamza forms
  assert.equal(normText('Cooling &amp; Heating'), 'cooling & heating');
  assert.equal(normText('a&nbsp;&nbsp;b'), 'a b');
});

test('normModel strips separators so spaced models compare equal', () => {
  assert.equal(normModel('RF – 51 FTV – DST'), 'RF51FTVDST');
  assert.equal(normModel('RF-51FTV-DST'), 'RF51FTVDST');
  assert.equal(normModel('TC4 -ZWF7240SS5'), 'TC4ZWF7240SS5');
  assert.equal(normModel('sk- 5119'), 'SK5119');
});

test('extractModel finds the model token in real titles', () => {
  assert.equal(extractModel('ثلاجة تورنيدو 2 باب انفرتر نوفروست 355 لتر – اسود RF-40FTV-BK'), 'RF40FTVBK');
  assert.equal(extractModel('غسالة توشيبا فتحة علوية اتوماتيك 10 كيلو بالطلمبة - باب كروم - ابيض AWE-E1050SUP'), 'AWEE1050SUP');
  assert.equal(extractModel('تكييف شارب اسبليت 2.25 حصان بارد - ساخن انفرتر ديجيتال لون سيلفر AY-XP18UHE'), 'AYXP18UHE');
  assert.equal(extractModel('ميكروويف تورنيدو 28 لتر سولو TMD- 28S-BK'), 'TMD28SBK');
});

test('extractModel rejects pure spec tokens', () => {
  assert.equal(extractModel('تلفزيون سامسونج 55 بوصة 4K سمارت'), null);
  assert.equal(extractModel('لاب توب 16GB RAM 512GB SSD'), null);
  assert.equal(extractModel('غسالة 7 كيلو 1200 لفة'), null);
  assert.equal(extractModel('Sharp 75 inch 4K Smart TV'), null);
});

/* REGRESSION: an earlier implementation joined model fragments only across
   dashes, so a model written with internal SPACES came back null and the same
   fridge in two languages failed to match. */
test('extractModel joins fragments split by spaces as well as dashes', () => {
  assert.equal(extractModel('Tornado Refrigerator No Frost 355L Black RF – 40 FTV – BK'), 'RF40FTVBK');
  assert.equal(extractModel('غسالة ملابس زانوسى اتوماتيك 7 ك ديجيتال 1200 لفة TC4 -ZWF7240SS5'), 'TC4ZWF7240SS5');
});

/* REGRESSION: Titlecase prose words must terminate a model run, or
   "No Frost ... Black" would be swallowed into the model. */
test('extractModel does not absorb Titlecase prose', () => {
  assert.equal(extractModel('Tornado No Frost Black RF-40FTV-BK'), 'RF40FTVBK');
});

/* DEFECT FIX: two adjacent identifiers (a SKU and a model) with nothing but a
   dash between them must not be fused into one bogus string. Whichever
   single candidate extractModel prefers, extractModels must expose both. */
test('extractModels splits an adjacent SKU + model pair instead of fusing them', () => {
  const title = 'مبرد مياه مكتبى فريش اسود 2 حنفية F500013673 - FW-17VDB';
  const models = extractModels(title);
  assert.ok(!models.includes('F500013673FW17VDB'), 'must not fuse the SKU and model');
  assert.deepEqual(models, ['F500013673', 'FW17VDB']);
  assert.equal(extractModel(title), extractModels(title)[0]);
});

/* DEFECT FIX: an ALL-CAPS feature word (BAGLESS) immediately after a model
   must terminate the run, the same way Titlecase prose already does. */
test('extractModels stops a run at an ALL-CAPS feature word', () => {
  const title = 'مكنسة ال جى 2000 وات - احمر VC5420NNTR - BAGLESS';
  const models = extractModels(title);
  assert.ok(!models.includes('VC5420NNTRBAGLESS'), 'must not absorb BAGLESS into the model');
  assert.deepEqual(models, ['VC5420NNTR']);
});

/* DEFECT FIX: a model split across multiple dashed fragments, followed by a
   trailing SKU, must yield the joined model and the separate SKU — not one
   fused string. */
test('extractModels separates a multi-fragment model from a trailing SKU', () => {
  const title = 'ميكروويف فريش 36 لتر ديجيتال بالجريل ــ سيلفر FMW - 36KCG - SSG - F500015260';
  const models = extractModels(title);
  assert.ok(!models.includes('FMW36KCGSSGF500015260'), 'must not fuse the model and the SKU');
  assert.deepEqual(models, ['FMW36KCGSSG', 'F500015260']);
});

/* DEFECT FIX: a parenthesised SKU must never fuse with the model that
   precedes it. */
test('extractModels never fuses across a parenthesis boundary', () => {
  const title = 'PL-BL1200185 (810307) خلاط بلوتو 1.85 لتر';
  const models = extractModels(title);
  assert.ok(!models.includes('PLBL1200185810307'), 'must not fuse across the parenthesis');
  assert.deepEqual(models, ['PLBL1200185']);
  assert.equal(extractModel(title), 'PLBL1200185');
});

/* REGRESSION: a parenthesis GLUED to the end of a fragment (no space before
   it) must not sever the fragment from the run that precedes it — it's one
   fragment with a trailing variant code, not a separate SKU. */
test('extractModel keeps a fragment joined to its preceding run when a paren is glued to its end', () => {
  assert.equal(extractModel('AEW - 8460SUP(DS)'), 'AEW8460SUPDS');
});

/* Companion to the glued-paren case above: a parenthesised group that is its
   OWN token (space before the "(") is still a standalone SKU and must still
   be split off the run before it, never fused into it. ("810307" is an
   all-digit SKU, so it is filtered out by isValidModel same as before — the
   point pinned here is that it must not fuse into "PLBL1200185810307".) A
   fix for the glued case above must not regress this one. */
test('extractModels still splits a standalone parenthesised token from the run before it', () => {
  const title = 'PL-BL1200185 (810307) خلاط بلوتو 1.85 لتر';
  const models = extractModels(title);
  assert.ok(!models.includes('PLBL1200185810307'), 'must not fuse the standalone paren group into the run');
  assert.deepEqual(models, ['PLBL1200185']);
  assert.equal(extractModel(title), 'PLBL1200185');
});

test('extractModels orders candidates longest-first and deduplicates', () => {
  const models = extractModels('مبرد مياه مكتبى فريش اسود 2 حنفية F500013673 - FW-17VDB');
  for (let i = 1; i < models.length; i++) {
    assert.ok(models[i - 1].length >= models[i].length, 'expected longest-first ordering');
  }
  assert.equal(new Set(models).size, models.length, 'expected no duplicates');
});

test('extractModels returns [] and extractModel returns null when no identifier is present', () => {
  assert.deepEqual(extractModels('تلفزيون سامسونج 55 بوصة 4K سمارت'), []);
  assert.equal(extractModel('تلفزيون سامسونج 55 بوصة 4K سمارت'), null);
});

/* DEFECT FIX: a single hyphen/paren-dense token with no internal space to
   split on can normalize to well over 12 chars ("GR-RT468WE-PMN(49)-PRO" ->
   "GRRT468WEPMN49PRO", 17 chars). The old per-fragment cap of 12 rejected it
   outright, so the model was never found and a real cheaper offer never
   matched. The cap is raised to 32 — comfortably above real model numbers —
   while the ALL-CAPS/alphanumeric/digit+letter/SPEC_ONLY/SPEC_WORDS checks
   still keep prose out. */
test('extractModel finds a model whose normalized single token exceeds 12 chars', () => {
  assert.equal(
    extractModel('TOSHIBA Refrigerator GR-RT468WE-PMN(49)-PRO, Inverter, Cooling Zone'),
    'GRRT468WEPMN49PRO'
  );
});

/* Companion: the same model embedded in a longer, differently-worded real
   Amazon title must extract to the identical string so the query and the
   listing can match. */
test('extractModel finds the same long model in a longer real-world title', () => {
  assert.equal(
    extractModel('TOSHIBA Refrigerator GR-RT468WE-PMN(49)-PRO, Inverter, Cooling Zone, No Frost'),
    'GRRT468WEPMN49PRO'
  );
});

/* Guard against the raised cap making the extractor greedy: a long ALL-CAPS
   prose phrase (no model, just feature words) must still yield null. Digits
   are what the cap used to gate on; this proves the digit+letter requirement
   in isValidModel does that job on its own. */
test('extractModel still rejects long ALL-CAPS prose with no digits after the cap increase', () => {
  assert.equal(extractModel('REFRIGERATOR NO FROST INVERTER COOLING'), null);
});

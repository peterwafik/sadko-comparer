import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normDigits, normText, normModel, extractModel } from './normalize.mjs';

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

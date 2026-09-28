// site/engine/size-class.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeClassOf } from './size-class.mjs';

const cls = (title, cat) => sizeClassOf({ title }, cat).cls;

test('each category name maps to its band', () => {
  assert.equal(cls('خلاط براون', 'خلاطات و محضرات طعام'), 'small');
  assert.equal(cls('مكواة فيليبس', 'مكاوى'), 'small');
  assert.equal(cls('ميكرويف شارب 25 لتر', 'ميكروييف'), 'small');
  assert.equal(cls('مكنسة هوفر', 'مكانس'), 'small');
  assert.equal(cls('قلاية هوائية', 'قلايات'), 'small');
  assert.equal(cls('بوتاجاز فريش', '5 شعلة'), 'medium');
  assert.equal(cls('تكييف شارب 1.5 حصان', 'تكييفات هواء'), 'medium');
  assert.equal(cls('سخان اوليمبيك', 'سخانات كهرباء'), 'medium');
  assert.equal(cls('غسالة اطباق بيكو', 'غسالات أطباق'), 'medium');
  assert.equal(cls('غسالة توشيبا 8 كيلو', 'غسالات ملابس'), 'medium');
  assert.equal(cls('ديب فريزر', 'فريزر أفقى'), 'large');
  assert.equal(cls('زيت زيتون', 'حرف يدوية ومنتجات عضوية'), 'craft');
});

test('refrigerators split on 450 litres, and a 4-door is extra-large', () => {
  assert.equal(cls('ثلاجة شارب 450 لتر', 'نو فروست'), 'large');
  assert.equal(cls('ثلاجة شارب 451 لتر', 'نو فروست'), 'xl');
  assert.equal(cls('ثلاجة توشيبا 350 لتر 4 باب', 'ديفروست'), 'xl');
  assert.equal(cls('ثلاجة بدون سعة', 'نو فروست'), null, 'no litres in the title → no guess');
});

test('televisions split at 50 and 75 inches', () => {
  assert.equal(cls('شاشة سامسونج 49 بوصة', 'تليفزيونات'), 'medium');
  assert.equal(cls('شاشة سامسونج 50 بوصة', 'تليفزيونات'), 'large');
  assert.equal(cls('شاشة سامسونج 75 بوصة', 'تليفزيونات'), 'large');
  assert.equal(cls('شاشة سامسونج 76 بوصة', 'تليفزيونات'), 'xl');
  assert.equal(cls('شاشة سامسونج', 'تليفزيونات'), null);
});

test('the fans-and-coolers category is split by what the product is', () => {
  const C = 'مبردات هواء ومراوح';
  assert.equal(cls('مروحة ستاند توشيبا', C), 'small');
  assert.equal(cls('دفاية زيت ديلونجى 9 ريشة', C), 'small');
  assert.equal(cls('شفاط حمام فريش 6 بوصة', C), 'small');
  assert.equal(cls('شفاط تورنيدو 25 سم بالشبكة', C), 'small');
  assert.equal(cls('شفاط بيكو 90 سم – استيل', C), 'medium', 'a cooker hood is an installation, not a small appliance');
  assert.equal(cls('شفاط بوتاجاز فريش 60 سم', C), 'medium');
  assert.equal(cls('مبرد هواء كولدير', C), 'medium');
  assert.equal(cls('جهاز غامض', C), null);
});

test('a wash-tower washer is extra-large', () => {
  assert.equal(cls('غسالة ال جى واش تاور', 'غسالات ملابس'), 'xl');
  assert.equal(cls('LG Wash Tower 13kg', 'غسالات ملابس'), 'xl');
});

test('unknown categories classify only on an unambiguous title', () => {
  assert.equal(cls('ثلاجة شارب 300 لتر', 'عروض صادكو'), 'large');
  assert.equal(cls('جهاز المشي ProForm', ''), null);
  assert.equal(cls('إعلان مربع ١', undefined), null);
});

test('every answer carries a reason in both languages', () => {
  for (const [t, c] of [['ثلاجة بدون سعة', 'نو فروست'], ['مروحة', 'مبردات هواء ومراوح'], ['x', 'y']]) {
    const r = sizeClassOf({ title: t }, c);
    assert.ok(r.why && r.why.ar && r.why.en, JSON.stringify(r));
  }
});

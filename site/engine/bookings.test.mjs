import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseHM, slotTimes, dateIsBookable, validEgyptPhone, validateBooking, makeRef, openBookings,
} from './bookings.mjs';

test('slotTimes generates hourly slots within opening hours, exclusive of close', () => {
  assert.deepEqual(slotTimes('11:00', '14:00', 60), ['11:00', '12:00', '13:00']);
  assert.deepEqual(slotTimes('11:00', '11:00', 60), []);      // zero window
  assert.deepEqual(slotTimes('bad', '20:00', 60), []);         // bad input
});

test('parseHM validates 24h times', () => {
  assert.equal(parseHM('09:30'), 570);
  assert.equal(parseHM('24:00'), null);
  assert.equal(parseHM('9:5'), null);
});

test('dateIsBookable: today and future within window, not past, not absurd', () => {
  const today = '2026-07-21';
  assert.equal(dateIsBookable('2026-07-21', today), true);     // today
  assert.equal(dateIsBookable('2026-07-25', today), true);     // near future
  assert.equal(dateIsBookable('2026-07-20', today), false);    // yesterday
  assert.equal(dateIsBookable('2026-12-01', today), false);    // beyond 60 days
  assert.equal(dateIsBookable('2026-02-31', today), false);    // not a real date
  assert.equal(dateIsBookable('nonsense', today), false);
});

test('validEgyptPhone accepts real formats, rejects junk', () => {
  assert.equal(validEgyptPhone('01001234567'), true);
  assert.equal(validEgyptPhone('0100 123 4567'), true);
  assert.equal(validEgyptPhone('+201112223334'), true);
  assert.equal(validEgyptPhone('0225792070'), true);          // landline
  assert.equal(validEgyptPhone('12345'), false);
  assert.equal(validEgyptPhone('01301234567'), false);         // 013 is not a valid Egyptian prefix
  assert.equal(validEgyptPhone(''), false);
});

test('makeRef is SDK-prefixed and avoids confusable characters', () => {
  const seq = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  let i = 0;
  const ref = makeRef(() => seq[i++]);
  assert.match(ref, /^SDK-[ACDEFGHJKLMNPQRSTUVWXYZ2345679]{6}$/);
  assert.equal(ref.includes('0'), false);
  assert.equal(ref.includes('O'), false);
  assert.equal(ref.includes('I'), false);
  assert.equal(ref.includes('1'), false);
});

const BRANCHES = [{ id: 'maspero' }, { id: 'marina' }];
const TIMES = ['11:00', '12:00', '13:00'];
const TODAY = '2026-07-21';
const okRec = () => ({ branch: 'maspero', date: '2026-07-22', time: '12:00',
  name: 'Youssef', phone: '01001234567', devices: [{ id: '1', title: 'Microwave' }] });

test('validateBooking accepts a good record', () => {
  assert.deepEqual(validateBooking(okRec(), BRANCHES, TIMES, TODAY), { ok: true });
});

test('validateBooking rejects each bad field', () => {
  const bad = (patch, reason) => assert.equal(
    validateBooking({ ...okRec(), ...patch }, BRANCHES, TIMES, TODAY).error, reason);
  bad({ devices: [] }, 'no-devices');
  bad({ branch: 'nope' }, 'bad-branch');
  bad({ date: '2026-07-20' }, 'bad-date');
  bad({ time: '10:00' }, 'bad-time');
  bad({ name: 'x' }, 'bad-name');
  bad({ phone: '123' }, 'bad-phone');
});

/* ---- store round-trip with a temp file + temp branches config ---- */
function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sadko-book-'));
  const bf = path.join(dir, 'branches.json');
  const df = path.join(dir, 'bookings.json');
  writeFileSync(bf, JSON.stringify({
    openFrom: '11:00', openTo: '14:00', slotMinutes: 60, slotCapacity: 2,
    branches: [{ id: 'maspero' }, { id: 'marina' }],
  }));
  return { store: openBookings(df, bf), dir };
}

test('slotsFor marks a slot taken once it reaches capacity', () => {
  const { store, dir } = tempStore();
  try {
    const rec = () => ({ branch: 'maspero', date: '2026-07-22', time: '12:00',
      name: 'Ali', phone: '01001234567', devices: [{ id: '1', title: 'X' }] });
    const before = store.slotsFor('maspero', '2026-07-22', TODAY).slots.find(s => s.time === '12:00');
    assert.equal(before.taken, false);
    store.create(rec(), { today: TODAY, ref: 'SDK-AAAAAA' });
    store.create(rec(), { today: TODAY, ref: 'SDK-BBBBBB' });   // capacity is 2
    const after = store.slotsFor('maspero', '2026-07-22', TODAY).slots.find(s => s.time === '12:00');
    assert.equal(after.taken, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('create refuses a full slot even if validation passes', () => {
  const { store, dir } = tempStore();
  try {
    const rec = () => ({ branch: 'maspero', date: '2026-07-22', time: '12:00',
      name: 'Ali', phone: '01001234567', devices: [{ id: '1', title: 'X' }] });
    assert.equal(store.create(rec(), { today: TODAY }).ok, true);
    assert.equal(store.create(rec(), { today: TODAY }).ok, true);
    assert.equal(store.create(rec(), { today: TODAY }).error, 'slot-full');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('create persists a booking retrievable via all()', () => {
  const { store, dir } = tempStore();
  try {
    const r = store.create({ branch: 'maspero', date: '2026-07-22', time: '11:00',
      name: 'Youssef Zaki', phone: '0100 123 4567',
      devices: [{ id: '9', title: 'Fridge', price: 20000, category: 'fridge' }] },
      { today: TODAY });
    assert.equal(r.ok, true);
    const all = store.all();
    assert.equal(all.length, 1);
    assert.equal(all[0].ref, r.ref);
    assert.equal(all[0].phone, '01001234567');        // normalized
    assert.equal(all[0].status, 'pending');
    assert.equal(all[0].devices[0].title, 'Fridge');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

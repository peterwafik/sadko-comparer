/* ============================================================================
   Home Experience bookings — a small, JSON-file-backed booking store.
   ----------------------------------------------------------------------------
   Powers the "come try the appliances in a simulated home room" flow:
     · time-slot availability per branch/date (simple per-slot capacity)
     · booking creation with full server-side validation
     · a unique human-readable reference per booking

   Zero dependencies. Pure logic (slot generation, validation) is separated
   from I/O so it is unit-testable without a filesystem.

   openBookings(file, branchesFile) -> {
     slotsFor(branchId, dateStr) -> { date, branch, slots:[{time, taken}] }
     create(record) -> { ok, ref } | { error }
     all() -> booking[]
     close()
   }
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/* ---- pure helpers (no I/O — tested directly) ---- */

export function parseHM(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? h * 60 + min : null;
}
const fmtHM = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/* every slot start between openFrom and openTo, exclusive of the closing time */
export function slotTimes(openFrom, openTo, stepMin) {
  const a = parseHM(openFrom), b = parseHM(openTo);
  if (a == null || b == null || !(stepMin > 0) || b <= a) return [];
  const out = [];
  for (let t = a; t < b; t += stepMin) out.push(fmtHM(t));
  return out;
}

/* a date string is a valid booking date if it is a real YYYY-MM-DD, not in the
   past, and within `maxDays` of `today` (both YYYY-MM-DD strings) */
export function dateIsBookable(dateStr, today, maxDays = 60) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false;
  const d = new Date(dateStr + 'T00:00:00Z'), t = new Date(today + 'T00:00:00Z');
  if (isNaN(d) || isNaN(t)) return false;
  if (d.getUTCMonth() + 1 !== +dateStr.slice(5, 7) || d.getUTCDate() !== +dateStr.slice(8, 10)) return false; // rejects 2026-02-31
  const days = Math.round((d - t) / 86400000);
  return days >= 0 && days <= maxDays;
}

/* Egyptian phone: mobile 010/011/012/015 + 8 digits, or a landline 0<area>...
   Accepts spaces/dashes; validates the digit stream. */
export function validEgyptPhone(raw) {
  const d = String(raw || '').replace(/[\s\-()]/g, '');
  if (/^(?:\+?20|0)?1[0125]\d{8}$/.test(d)) return true;        // mobile
  if (/^0\d{8,9}$/.test(d)) return true;                        // landline (e.g. 02xxxxxxxx / 03xxxxxxx)
  return false;
}

/* validate a booking record against the branch registry and the offered slots.
   `today` is injected so the check is deterministic and testable. Returns
   { ok:true } or { error:'<reason>' }. Does NOT check slot capacity — that
   needs the persisted set and is done in create(). */
export function validateBooking(rec, branches, offeredTimes, today) {
  if (!rec || typeof rec !== 'object') return { error: 'empty' };
  if (!Array.isArray(rec.devices) || rec.devices.length < 1) return { error: 'no-devices' };
  if (rec.devices.length > 12) return { error: 'too-many-devices' };
  if (!branches.some(b => b.id === rec.branch)) return { error: 'bad-branch' };
  if (!dateIsBookable(rec.date, today)) return { error: 'bad-date' };
  if (!offeredTimes.includes(rec.time)) return { error: 'bad-time' };
  if (!rec.name || String(rec.name).trim().length < 2) return { error: 'bad-name' };
  if (!validEgyptPhone(rec.phone)) return { error: 'bad-phone' };
  return { ok: true };
}

/* short, unambiguous, human-readable ref: SDK-XXXXXX (no easily-confused chars).
   `rand` and `stamp` are injected for deterministic tests. */
const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
export function makeRef(rand = Math.random, stamp = null) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return 'SDK-' + s;
}

/* ---- the store (I/O) ---- */

export function openBookings(file, branchesFile) {
  const cfg = JSON.parse(readFileSync(branchesFile, 'utf8'));
  const branches = cfg.branches;
  const capacity = cfg.slotCapacity || 2;
  const times = slotTimes(cfg.openFrom, cfg.openTo, cfg.slotMinutes || 60);

  const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { bookings: [] }; } };
  const save = data => writeFileSync(file, JSON.stringify(data, null, 1));

  const takenCount = (all, branch, date, time) =>
    all.filter(b => b.branch === branch && b.date === date && b.time === time && b.status !== 'cancelled').length;

  return {
    branches,
    slotTimes: times,

    /* slot availability for a branch/date, today injected for testability */
    slotsFor(branchId, dateStr, today = new Date().toISOString().slice(0, 10)) {
      if (!branches.some(b => b.id === branchId)) return { error: 'bad-branch' };
      if (!dateIsBookable(dateStr, today)) return { error: 'bad-date' };
      const all = load().bookings;
      return {
        date: dateStr, branch: branchId,
        slots: times.map(time => ({ time, taken: takenCount(all, branchId, dateStr, time) >= capacity })),
      };
    },

    /* validate, re-check capacity against the persisted set, persist, return ref */
    create(rec, opts = {}) {
      const today = opts.today || new Date().toISOString().slice(0, 10);
      const v = validateBooking(rec, branches, times, today);
      if (v.error) return v;
      const data = load();
      if (takenCount(data.bookings, rec.branch, rec.date, rec.time) >= capacity) return { error: 'slot-full' };
      const ref = opts.ref || makeRef();
      const booking = {
        ref, createdAt: opts.now || new Date().toISOString(),
        branch: rec.branch, date: rec.date, time: rec.time,
        name: String(rec.name).trim().slice(0, 80),
        phone: String(rec.phone).replace(/[\s\-()]/g, '').slice(0, 20),
        notes: String(rec.notes || '').trim().slice(0, 500),
        devices: rec.devices.slice(0, 12).map(d => ({
          id: String(d.id || '').slice(0, 40), title: String(d.title || '').slice(0, 160),
          image: String(d.image || '').slice(0, 300), price: +d.price || 0,
          category: String(d.category || '').slice(0, 60),
        })),
        status: 'pending',
      };
      data.bookings = data.bookings || [];
      data.bookings.push(booking);
      save(data);
      return { ok: true, ref, booking };
    },

    all() { return load().bookings; },
  };
}

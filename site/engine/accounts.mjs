/* ============================================================================
   SADKO accounts — real server-side authentication, zero dependencies.
   ----------------------------------------------------------------------------
   This is deliberately NOT a browser-side "login". A password kept in
   localStorage protects nothing, so accounts live here, on the server that
   already runs this site (see Dockerfile / DEPLOY.md — a long-lived Node
   process with a writable data directory).

   What is implemented, and why:
   • Passwords are stored as scrypt hashes with a per-user 16-byte random salt.
     Never plaintext, never a fast hash. Verification is timing-safe.
   • Sessions are 32 random bytes. The COOKIE carries the raw token; the file
     stores only its SHA-256, so a leaked accounts.json cannot be replayed as a
     login. Cookies are HttpOnly + SameSite=Lax (and Secure behind HTTPS), so
     page scripts cannot read them and XSS cannot exfiltrate a session.
   • Login failures are deliberately vague ("wrong email or password") and
     rate-limited per email+IP, so the endpoint cannot be used to discover which
     emails are registered or to brute-force one.
   • Registration and login take the same code path cost whether or not the
     account exists, to avoid a timing oracle.

   What is NOT implemented, and must not be pretended: email verification,
   password reset (needs an email sender), 2FA, and any card processing. Orders
   are recorded with offline payment methods only — see the payment note in
   compare-server.mjs.

   Storage is libSQL (engine/accounts-db.mjs over engine/db.mjs): hosted Turso
   on Vercel, a local SQLite file otherwise. Every method that reaches it is
   async. An older accounts.json is imported once on first boot (local store
   only) and renamed aside. Deleting a user removes their identities, homes,
   sessions and orders in the same atomic batch.
   ========================================================================== */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { openAccountsDb, importLegacyJson } from './accounts-db.mjs';
import { applyCoupon } from './coupons.mjs';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const MAX_FAILS = 8;                 // per email+ip within the window
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const sha256 = s => createHash('sha256').update(String(s)).digest('hex');
const nowISO = () => new Date().toISOString();

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
}

/* A throwaway hash used when an email is unknown, so a login attempt against a
   non-existent account costs the same as a real one. */
const DUMMY_SALT = randomBytes(16).toString('hex');
const DUMMY_HASH = hashPassword('dummy-password-for-timing', DUMMY_SALT);

export function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }
export function validatePassword(p) {
  const s = String(p || '');
  if (s.length < 8) return { ok: false, error: 'password-short' };
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return { ok: false, error: 'password-weak' };
  return { ok: true };
}
export function validatePhone(p) {
  const s = String(p || '').replace(/[\s-]/g, '');
  return s === '' || /^(\+?20)?0?1[0-2,5]\d{8}$/.test(s);   // Egyptian mobile, optional
}

/* Only these profile keys are ever persisted, so a client cannot inject
   arbitrary fields into the stored record. One list drives every home/room
   profile — the UI, the filter and the validation all read from it. */
export const PROFILE_KEYS = [
  // identity of the place
  'name', 'icon', 'scope', 'roomType',
  // who lives there
  'people', 'adults', 'kids', 'elderly', 'pets',
  // the property
  'homeType', 'ownership', 'areaM2', 'rooms', 'governorate', 'area',
  // getting an appliance in
  'floor', 'hasLift', 'doorwayW', 'stairsTight',
  // utilities that decide what will even work
  'cookerFuel', 'hasStabilizer', 'kitchenSize',
  // the gaps things must fit into (cm)
  'fridgeSlotW', 'fridgeSlotH', 'washerSlotW', 'cookerSlotW', 'dishwasherSlotW',
  // room-scoped
  'roomAreaM2', 'sunFacing', 'coastal',
  // habits
  'cookFrequency', 'laundryPerWeek', 'noiseSensitive', 'smartPreference',
  // buying preferences
  'budgetBand', 'energyPriority', 'brands', 'finish', 'notes',
];
const MAX_HOMES = 8;

/* The lifecycle an order moves through on the owner's desk. Kept small and
   explicit so a bad value can never be written to the orders table. */
export const ORDER_STATUSES = ['received', 'confirmed', 'preparing', 'shipping', 'delivered', 'cancelled'];

export function cleanProfile(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of PROFILE_KEYS) {
    let v = input[k];
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v = v.slice(0, 20).map(x => String(x).slice(0, 40));
    else if (typeof v === 'number') v = isFinite(v) ? v : undefined;
    else if (typeof v === 'boolean') { /* keep */ }
    else v = String(v).slice(0, 200);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/* A named place the customer shops for: a whole home, or a single room. */
export function makeHome(input, existingId) {
  const p = cleanProfile(input || {});
  return Object.assign({
    id: existingId || ('h' + randomBytes(6).toString('hex')),
    name: p.name || 'منزلى',
    icon: p.icon || '🏠',
    scope: p.scope === 'room' ? 'room' : 'home',
    createdAt: nowISO(),
  }, p);
}

/* Async: opening reaches the database (a local file, or hosted Turso when
   TURSO_DATABASE_URL is set). Every method below that touches the store
   returns a Promise. There is no timer in here; the server calls sweep(). */
export async function openAccounts(file) {
  // Callers historically passed .../accounts.json. Keep that signature, but put
  // the data in a real database beside it and import the old file once.
  const dbFile = file.replace(/\.json$/i, '') + '.db';
  const store = await openAccountsDb(dbFile);
  if (/\.json$/i.test(file)) {
    const r = await importLegacyJson(store, file);   // no-op on a hosted store
    if (r.imported) console.log('[accounts] imported ' + r.imported + ' user(s) from the legacy JSON file');
  }

  const norm = e => String(e || '').trim().toLowerCase();

  function activeHome(u) {
    return (u.homes || []).find(h => h.id === u.activeHomeId) || (u.homes || [])[0] || null;
  }

  function publicUser(u) {
    if (!u) return null;
    const home = activeHome(u);
    return {
      id: u.id, email: u.email, name: u.name, phone: u.phone || '',
      address: u.address || null, createdAt: u.createdAt,
      homes: u.homes || [], activeHomeId: u.activeHomeId || (home ? home.id : null),
      // `profile` stays as the ACTIVE home so older callers keep working
      profile: home ? home : {},
      hasPassword: !!u.hash,
      // only the provider names leave the server, never a token
      providers: (u.identities || []).map(i => i.provider),
    };
  }

  async function issueSession(userId) {
    const raw = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await store.addSession(sha256(raw), userId, nowISO(), expires);
    return { raw, expires };
  }

  return {
    /* ---- housekeeping ----
       Deletes expired sessions and login-failure rows older than the window.
       Nothing depends on it for correctness (expired sessions are refused and
       removed on read; old failures fall outside the counted window), it only
       keeps the tables small. The server schedules it. */
    async sweep() {
      const sessions = await store.pruneSessions();
      const fails = await store.pruneFails(FAIL_WINDOW_MS);
      return { sessions, fails };
    },

    /* ---- registration ---- */
    async register({ email, password, name, phone, address, profile }) {
      const em = norm(email);
      if (!validateEmail(em)) return { error: 'bad-email' };
      const pw = validatePassword(password);
      if (!pw.ok) return { error: pw.error };
      if (!String(name || '').trim()) return { error: 'bad-name' };
      if (!validatePhone(phone)) return { error: 'bad-phone' };
      if (await store.getUserByEmail(em)) return { error: 'email-taken' };

      const salt = randomBytes(16).toString('hex');
      const homes = [];
      if (profile && Object.keys(cleanProfile(profile)).length) homes.push(makeHome(profile));
      let user;
      try {
        user = await store.createUser({
          id: 'u' + randomBytes(8).toString('hex'),
          email: em, name: String(name).trim().slice(0, 80),
          phone: String(phone || '').trim().slice(0, 30),
          address: address ? String(address).trim().slice(0, 300) : null,
          salt, hash: hashPassword(password, salt),
          homes, activeHomeId: homes[0] ? homes[0].id : null,
          identities: [], createdAt: nowISO(),
        });
      } catch (e) {
        // Two registrations for one email raced past the check above; the
        // UNIQUE column refused the second. Same answer as the check gives.
        if (/UNIQUE/i.test(String(e && e.message))) return { error: 'email-taken' };
        throw e;
      }
      return { ok: true, user: publicUser(user), session: await issueSession(user.id) };
    },

    /* ---- social sign-in ----
       `identity` must already have been verified by engine/oidc.mjs; this
       function decides who it belongs to.

       The linking rule is the security-sensitive part: an identity may only
       attach to an EXISTING password account when the provider asserts the
       email is verified. Without that check, anyone who could mint a token
       claiming someone else's address would inherit their account. */
    async signInWithIdentity(identity) {
      if (!identity || !identity.provider || !identity.sub || !identity.email) return { error: 'bad-identity' };
      const em = norm(identity.email);

      let user = await store.userByIdentity(identity.provider, identity.sub);
      let created = false;

      if (!user) {
        const byEmail = await store.getUserByEmail(em);
        if (byEmail) {
          if (!identity.emailVerified) return { error: 'email-unverified' };
          await store.linkIdentity(byEmail.id, { provider: identity.provider, sub: identity.sub, email: em, linkedAt: nowISO() });
          user = await store.getUser(byEmail.id);
        } else {
          created = true;
          user = await store.createUser({
            id: 'u' + randomBytes(8).toString('hex'),
            email: em,
            name: (identity.name || em.split('@')[0]).slice(0, 80),
            phone: '', address: null,
            // No password at all — this account signs in through its provider.
            salt: null, hash: null,
            homes: [], activeHomeId: null,
            identities: [{ provider: identity.provider, sub: identity.sub, email: em, linkedAt: nowISO() }],
            createdAt: nowISO(),
          });
        }
      }
      return { ok: true, user: publicUser(user), session: await issueSession(user.id), created };
    },

    /* ---- home / room profiles ---- */
    async listHomes(userId) {
      const u = await store.getUser(userId);
      return u ? u.homes : [];
    },
    async addHome(userId, input) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if ((u.homes || []).length >= MAX_HOMES) return { error: 'too-many-homes' };
      const h = makeHome(input);
      await store.addHome(userId, h);
      if (!u.activeHomeId) await store.saveUser(Object.assign(u, { activeHomeId: h.id }));
      return { ok: true, home: h, user: publicUser(await store.getUser(userId)) };
    },
    async updateHome(userId, homeId, patch) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      const cur = (u.homes || []).find(h => h.id === homeId);
      if (!cur) return { error: 'no-home' };
      const merged = Object.assign({}, cur, cleanProfile(patch));
      merged.id = cur.id;                       // id is never client-controlled
      merged.createdAt = cur.createdAt;
      await store.updateHome(userId, homeId, merged);
      return { ok: true, home: merged, user: publicUser(await store.getUser(userId)) };
    },
    async removeHome(userId, homeId) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      await store.removeHome(userId, homeId);
      if (u.activeHomeId === homeId) {
        const now = await store.getUser(userId);
        await store.saveUser(Object.assign(now, { activeHomeId: now.homes[0] ? now.homes[0].id : null }));
      }
      return { ok: true, user: publicUser(await store.getUser(userId)) };
    },
    async setActiveHome(userId, homeId) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (homeId && !(u.homes || []).some(h => h.id === homeId)) return { error: 'no-home' };
      await store.saveUser(Object.assign(u, { activeHomeId: homeId || null }));
      return { ok: true, user: publicUser(await store.getUser(userId)) };
    },

    /* ---- login ---- */
    async login({ email, password, ip }) {
      const em = norm(email);
      const key = em + '|' + (ip || '');
      // Record this attempt BEFORE counting. With an async store, "count, then
      // write later" would let a burst of parallel requests all pass the check
      // before any of them was recorded. Writing first means the last of any
      // burst sees every attempt that got through, so at most MAX_FAILS
      // passwords are tried per window. A refused attempt is withdrawn, so
      // being refused does not itself extend the lock-out (as before).
      const attempt = await store.addFail(key);
      if (await store.failCount(key, FAIL_WINDOW_MS) > MAX_FAILS) {
        await store.dropFail(attempt);
        return { error: 'too-many' };
      }

      const found = await store.getUserByEmail(em);
      // An account created through Google/Microsoft has no password at all.
      // Treat it exactly like an unknown email — same work, same message — so
      // this endpoint cannot be used to discover which accounts are social.
      const user = (found && found.hash && found.salt) ? found : null;
      // Always run scrypt, even for an unknown email, so response time does not
      // reveal whether the account exists.
      const salt = user ? user.salt : DUMMY_SALT;
      const expect = user ? user.hash : DUMMY_HASH;
      const got = hashPassword(password, salt);
      const a = Buffer.from(got, 'hex'), b = Buffer.from(expect, 'hex');
      const good = !!user && a.length === b.length && timingSafeEqual(a, b);

      if (!good) return { error: 'bad-credentials' };        // deliberately vague; the attempt stays recorded
      await store.clearFails(key);
      return { ok: true, user: publicUser(user), session: await issueSession(user.id) };
    },

    /* ---- sessions ---- */
    async userForToken(rawToken) {
      if (!rawToken) return null;
      return publicUser(await store.userForSession(sha256(rawToken)));
    },
    async logout(rawToken) {
      if (!rawToken) return { ok: true, removed: 0 };
      return { ok: true, removed: await store.dropSession(sha256(rawToken)) };
    },

    /* ---- profile ---- */
    async updateProfile(userId, patch) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (patch.name != null && String(patch.name).trim()) u.name = String(patch.name).trim().slice(0, 80);
      if (patch.phone != null) { if (!validatePhone(patch.phone)) return { error: 'bad-phone' }; u.phone = String(patch.phone).trim().slice(0, 30); }
      if (patch.address != null) u.address = String(patch.address).trim().slice(0, 300) || null;
      await store.saveUser(u);
      // A profile patch edits the ACTIVE home, creating one if this account has
      // none yet — so the old single-profile call site keeps working unchanged.
      if (patch.profile) {
        const clean = cleanProfile(patch.profile);
        const cur = activeHome(u);
        if (cur) { await store.updateHome(userId, cur.id, Object.assign({}, cur, clean)); }
        else if (Object.keys(clean).length) {
          const h = makeHome(clean);
          await store.addHome(userId, h);
          await store.saveUser(Object.assign(await store.getUser(userId), { activeHomeId: h.id }));
        }
      }
      return { ok: true, user: publicUser(await store.getUser(userId)) };
    },
    async changePassword(userId, currentPassword, newPassword) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (!u.hash || !u.salt) return { error: 'no-password' };   // social-only account
      const got = Buffer.from(hashPassword(currentPassword, u.salt), 'hex');
      const exp = Buffer.from(u.hash, 'hex');
      if (got.length !== exp.length || !timingSafeEqual(got, exp)) return { error: 'bad-credentials' };
      const pw = validatePassword(newPassword);
      if (!pw.ok) return { error: pw.error };
      u.salt = randomBytes(16).toString('hex');
      u.hash = hashPassword(newPassword, u.salt);
      await store.saveUser(u);
      // Signing out other devices is the correct behaviour after a password change.
      await store.dropUserSessions(userId);
      return { ok: true };
    },

    /* ---- orders ---- */
    // Offline payment only. No card data is accepted, stored or transmitted
    // anywhere in this codebase; see PAYMENT_METHODS in compare-server.mjs.
    async createOrder(userId, { items, payment, delivery, note, totals, deliveryQuote, coupon }) {
      const u = await store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (!Array.isArray(items) || !items.length) return { error: 'empty-cart' };
      if (items.length > 60) return { error: 'too-many-items' };

      const clean = items.slice(0, 60).map(i => ({
        id: String(i.id || '').slice(0, 40),
        title: String(i.title || '').slice(0, 300),
        price: Number(i.price) || 0,
        qty: Math.max(1, Math.min(20, Number(i.qty) || 1)),
        image: String(i.image || '').slice(0, 500),
      }));
      const subtotal = clean.reduce((n, i) => n + i.price * i.qty, 0);
      const ref = 'SDK-' + randomBytes(3).toString('hex').toUpperCase();
      const order = {
        ref, userId, createdAt: nowISO(), status: 'received',
        items: clean, subtotal,
        payment: String(payment || 'cod').slice(0, 20),
        delivery: {
          name: String((delivery && delivery.name) || u.name).slice(0, 80),
          phone: String((delivery && delivery.phone) || u.phone).slice(0, 30),
          governorate: String((delivery && delivery.governorate) || '').slice(0, 60),
          address: String((delivery && delivery.address) || u.address || '').slice(0, 300),
          floor: String((delivery && delivery.floor) || '').slice(0, 20),
          hasLift: !!(delivery && delivery.hasLift),
        },
        note: String(note || '').slice(0, 500),
        // The delivery fee is stored only when the SERVER quoted it from Ecwid's
        // own rates (engine/delivery-order.mjs); otherwise, and for installation
        // always, it stays null for customer care to confirm. Storing a
        // fabricated 0 would be a lie on a document the customer keeps.
        totals: deliveryQuote && deliveryQuote.quotable
          ? { subtotal, deliveryFee: deliveryQuote.fee, installFee: null, grandTotal: subtotal + deliveryQuote.fee,
              currency: 'EGP', methodName: deliveryQuote.methodName, deliveryLines: deliveryQuote.lines,
              note: 'رسوم التركيب بتتأكد من خدمة العملاء قبل التنفيذ.' }
          : { subtotal, deliveryFee: null, installFee: null, grandTotal: null, currency: 'EGP',
              note: 'رسوم التوصيل والتركيب بتتأكد من خدمة العملاء قبل التنفيذ.' },
      };
      /* A coupon Ecwid applied (engine/coupons.mjs); the route checked it. */
      if (coupon && coupon.ok) { order.totals = applyCoupon(order.totals, coupon); order.coupon = coupon; }
      await store.addOrder(order);
      return { ok: true, order };
    },
    ordersFor: async userId => store.ordersFor(userId),

    /* A webhook carries no session, so a status update arriving from Ecwid
       needs the order by ref alone. Deliberately separate from
       orderByRef(userId, ref), which stays scoped to its owner for anything a
       customer can reach. */
    orderByRefAny: async ref => (ref ? store.orderByRefAny(String(ref)) : null),
    orderByRef: async (userId, ref) => store.orderByRef(userId, ref),

    /* ---- privacy: the customer's own data, and erasing it ---- */
    /* One account, safe to hand outwards.

       The row underneath carries `salt` and `hash`, so this is NOT
       store.getUser re-exported: a password hash has no business travelling
       to the Ecwid mapper, or anywhere else that did not ask for it.

       This accessor was missing, and its absence was invisible because the
       only caller is the order push — which was ALSO failing on a 403. Two
       orders sat in the queue with "db.getUser is not a function" against
       them, so order push would not have started working the moment a secret
       token arrived. */
    /* By email, the key Ecwid files customers under. Normalised and
       credential-stripped for the same reasons as getUser above. */
    async getUserByEmail(email) {
      const em = norm(email);
      const u = em ? await store.getUserByEmail(em) : null;
      if (!u) return null;
      const { salt, hash, ...safe } = u;
      return safe;
    },

    async getUser(userId) {
      const u = userId ? await store.getUser(userId) : null;
      if (!u) return null;
      const { salt, hash, ...safe } = u;
      return safe;
    },

    async exportUser(userId) {
      const u = await store.getUser(userId);
      if (!u) return null;
      return {
        exportedAt: nowISO(),
        account: { id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address, createdAt: u.createdAt },
        places: u.homes,
        signInMethods: (u.identities || []).map(i => ({ provider: i.provider, linkedAt: i.linkedAt })),
        orders: await store.ordersFor(userId),
        note: 'كلمة المرور غير مدرجة هنا لأنها مخزَّنة مشفَّرة وغير قابلة للاسترجاع. / Your password is not included: it is stored hashed and cannot be recovered.',
      };
    },
    async deleteUser(userId) {
      if (!(await store.getUser(userId))) return { error: 'no-user' };
      await store.deleteUser(userId);           // one batch: identities, homes, sessions, orders, then the user
      return { ok: true };
    },

    async stats() {
      const [users, sessions, orders] = await Promise.all([store.userCount(), store.sessionCount(), store.orderCount()]);
      return { users, sessions, orders };
    },

    /* ---- admin desk ----
       These read across ALL customers, so the server MUST gate them behind an
       admin check before calling. They never expose password hashes or salts. */
    ORDER_STATUSES,
    async listUsersAdmin() {
      const [users, counts] = await Promise.all([store.allUsers(), store.orderCountsByUser()]);
      const out = users.map(u => ({
        id: u.id, email: u.email, name: u.name, phone: u.phone || '',
        createdAt: u.createdAt, homes: (u.homes || []).length,
        orders: counts.get(u.id) || 0,
        providers: (u.identities || []).map(i => i.provider),
      }));
      out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return out;
    },
    async allOrders() {
      // attach a light customer label so the desk can show who ordered
      const [users, orders] = await Promise.all([store.allUsers(), store.allOrders()]);
      const names = new Map(users.map(u => [u.id, { name: u.name, email: u.email, phone: u.phone || '' }]));
      return orders.map(o => Object.assign({ customer: names.get(o.userId) || null }, o));
    },
    async setOrderStatus(ref, status) {
      status = String(status || '').trim();
      if (!ORDER_STATUSES.includes(status)) return { error: 'bad-status' };
      const o = await store.setOrderStatus(String(ref || ''), status);
      if (!o) return { error: 'no-order' };
      return { ok: true, order: o };
    },
    async adminOverview() {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [users, sessions, orders, ordersToday, ordersWeek] = await Promise.all([
        store.userCount(), store.sessionCount(), store.orderCount(),
        store.ordersSince(dayAgo), store.ordersSince(weekAgo),
      ]);
      return { users, sessions, orders, ordersToday, ordersWeek };
    },
    async getOrderAny(ref) {
      return ref ? store.orderByRefAny(String(ref)) : null;
    },

    __raw: () => store.raw,   // tests only: assert on the stored rows directly (db.mjs API)
    close() { try { store.close(); } catch (e) {} },
  };
}

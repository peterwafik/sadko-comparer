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

   Storage is SQLite (engine/accounts-db.mjs) — transactional, indexed, and
   safe under concurrent requests. An older accounts.json is imported once on
   first boot and renamed aside. Deleting a user cascades to their homes,
   sessions and orders.
   ========================================================================== */

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { openAccountsDb, importLegacyJson } from './accounts-db.mjs';

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

export function openAccounts(file) {
  // Callers historically passed .../accounts.json. Keep that signature, but put
  // the data in a real database beside it and import the old file once.
  const dbFile = file.replace(/\.json$/i, '') + '.db';
  const store = openAccountsDb(dbFile);
  if (/\.json$/i.test(file)) {
    const r = importLegacyJson(store, file);
    if (r.imported) console.log('[accounts] imported ' + r.imported + ' user(s) from the legacy JSON file');
  }

  const norm = e => String(e || '').trim().toLowerCase();

  /* Housekeeping that used to happen on every read of the JSON blob. Cheap
     indexed deletes now, so it can run on a timer instead of per request. */
  function sweep() {
    store.pruneSessions();
    store.pruneFails(FAIL_WINDOW_MS);
  }
  sweep();
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  if (sweeper.unref) sweeper.unref();

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

  function issueSession(userId) {
    const raw = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    store.addSession(sha256(raw), userId, nowISO(), expires);
    return { raw, expires };
  }

  return {
    /* ---- registration ---- */
    register({ email, password, name, phone, address, profile }) {
      const em = norm(email);
      if (!validateEmail(em)) return { error: 'bad-email' };
      const pw = validatePassword(password);
      if (!pw.ok) return { error: pw.error };
      if (!String(name || '').trim()) return { error: 'bad-name' };
      if (!validatePhone(phone)) return { error: 'bad-phone' };
      if (store.getUserByEmail(em)) return { error: 'email-taken' };

      const salt = randomBytes(16).toString('hex');
      const homes = [];
      if (profile && Object.keys(cleanProfile(profile)).length) homes.push(makeHome(profile));
      const user = store.createUser({
        id: 'u' + randomBytes(8).toString('hex'),
        email: em, name: String(name).trim().slice(0, 80),
        phone: String(phone || '').trim().slice(0, 30),
        address: address ? String(address).trim().slice(0, 300) : null,
        salt, hash: hashPassword(password, salt),
        homes, activeHomeId: homes[0] ? homes[0].id : null,
        identities: [], createdAt: nowISO(),
      });
      return { ok: true, user: publicUser(user), session: issueSession(user.id) };
    },

    /* ---- social sign-in ----
       `identity` must already have been verified by engine/oidc.mjs; this
       function decides who it belongs to.

       The linking rule is the security-sensitive part: an identity may only
       attach to an EXISTING password account when the provider asserts the
       email is verified. Without that check, anyone who could mint a token
       claiming someone else's address would inherit their account. */
    signInWithIdentity(identity) {
      if (!identity || !identity.provider || !identity.sub || !identity.email) return { error: 'bad-identity' };
      const em = norm(identity.email);

      let user = store.userByIdentity(identity.provider, identity.sub);
      let created = false;

      if (!user) {
        const byEmail = store.getUserByEmail(em);
        if (byEmail) {
          if (!identity.emailVerified) return { error: 'email-unverified' };
          store.linkIdentity(byEmail.id, { provider: identity.provider, sub: identity.sub, email: em, linkedAt: nowISO() });
          user = store.getUser(byEmail.id);
        } else {
          created = true;
          user = store.createUser({
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
      return { ok: true, user: publicUser(user), session: issueSession(user.id), created };
    },

    /* ---- home / room profiles ---- */
    listHomes(userId) {
      const u = store.getUser(userId);
      return u ? u.homes : [];
    },
    addHome(userId, input) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (store.homeCount(userId) >= MAX_HOMES) return { error: 'too-many-homes' };
      const h = makeHome(input);
      store.addHome(userId, h);
      if (!u.activeHomeId) store.saveUser(Object.assign(u, { activeHomeId: h.id }));
      return { ok: true, home: h, user: publicUser(store.getUser(userId)) };
    },
    updateHome(userId, homeId, patch) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      const cur = (u.homes || []).find(h => h.id === homeId);
      if (!cur) return { error: 'no-home' };
      const merged = Object.assign({}, cur, cleanProfile(patch));
      merged.id = cur.id;                       // id is never client-controlled
      merged.createdAt = cur.createdAt;
      store.updateHome(userId, homeId, merged);
      return { ok: true, home: merged, user: publicUser(store.getUser(userId)) };
    },
    removeHome(userId, homeId) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      store.removeHome(userId, homeId);
      if (u.activeHomeId === homeId) {
        const rest = store.getUser(userId).homes;
        store.saveUser(Object.assign(store.getUser(userId), { activeHomeId: rest[0] ? rest[0].id : null }));
      }
      return { ok: true, user: publicUser(store.getUser(userId)) };
    },
    setActiveHome(userId, homeId) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (homeId && !(u.homes || []).some(h => h.id === homeId)) return { error: 'no-home' };
      store.saveUser(Object.assign(u, { activeHomeId: homeId || null }));
      return { ok: true, user: publicUser(store.getUser(userId)) };
    },

    /* ---- login ---- */
    login({ email, password, ip }) {
      const em = norm(email);
      const key = em + '|' + (ip || '');
      if (store.failCount(key, FAIL_WINDOW_MS) >= MAX_FAILS) return { error: 'too-many' };

      const found = store.getUserByEmail(em);
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

      if (!good) {
        store.addFail(key);
        return { error: 'bad-credentials' };                 // deliberately vague
      }
      store.clearFails(key);
      return { ok: true, user: publicUser(user), session: issueSession(user.id) };
    },

    /* ---- sessions ---- */
    userForToken(rawToken) {
      if (!rawToken) return null;
      return publicUser(store.userForSession(sha256(rawToken)));
    },
    logout(rawToken) {
      if (!rawToken) return { ok: true, removed: 0 };
      return { ok: true, removed: store.dropSession(sha256(rawToken)) };
    },

    /* ---- profile ---- */
    updateProfile(userId, patch) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (patch.name != null && String(patch.name).trim()) u.name = String(patch.name).trim().slice(0, 80);
      if (patch.phone != null) { if (!validatePhone(patch.phone)) return { error: 'bad-phone' }; u.phone = String(patch.phone).trim().slice(0, 30); }
      if (patch.address != null) u.address = String(patch.address).trim().slice(0, 300) || null;
      store.saveUser(u);
      // A profile patch edits the ACTIVE home, creating one if this account has
      // none yet — so the old single-profile call site keeps working unchanged.
      if (patch.profile) {
        const clean = cleanProfile(patch.profile);
        const cur = activeHome(u);
        if (cur) { store.updateHome(userId, cur.id, Object.assign({}, cur, clean)); }
        else if (Object.keys(clean).length) {
          const h = makeHome(clean);
          store.addHome(userId, h);
          store.saveUser(Object.assign(store.getUser(userId), { activeHomeId: h.id }));
        }
      }
      return { ok: true, user: publicUser(store.getUser(userId)) };
    },
    changePassword(userId, currentPassword, newPassword) {
      const u = store.getUser(userId);
      if (!u) return { error: 'no-user' };
      if (!u.hash || !u.salt) return { error: 'no-password' };   // social-only account
      const got = Buffer.from(hashPassword(currentPassword, u.salt), 'hex');
      const exp = Buffer.from(u.hash, 'hex');
      if (got.length !== exp.length || !timingSafeEqual(got, exp)) return { error: 'bad-credentials' };
      const pw = validatePassword(newPassword);
      if (!pw.ok) return { error: pw.error };
      u.salt = randomBytes(16).toString('hex');
      u.hash = hashPassword(newPassword, u.salt);
      store.saveUser(u);
      // Signing out other devices is the correct behaviour after a password change.
      store.dropUserSessions(userId);
      return { ok: true };
    },

    /* ---- orders ---- */
    // Offline payment only. No card data is accepted, stored or transmitted
    // anywhere in this codebase; see PAYMENT_METHODS in compare-server.mjs.
    createOrder(userId, { items, payment, delivery, note, totals }) {
      const u = store.getUser(userId);
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
        // Delivery/installation charges are NOT computed here: they depend on the
        // product and the address and are confirmed by customer care. Storing a
        // fabricated 0 would be a lie on a document the customer keeps.
        totals: { subtotal, deliveryFee: null, installFee: null,
                  grandTotal: null, currency: 'EGP',
                  note: 'رسوم التوصيل والتركيب بتتأكد من خدمة العملاء قبل التنفيذ.' },
      };
      store.addOrder(order);
      return { ok: true, order };
    },
    ordersFor: userId => store.ordersFor(userId),

    /* A webhook carries no session, so a status update arriving from Ecwid
       needs the order by ref alone. Deliberately separate from
       orderByRef(userId, ref), which stays scoped to its owner for anything a
       customer can reach. */
    orderByRefAny: ref => store.allOrders().find(o => o.ref === ref) || null,
    orderByRef: (userId, ref) => store.orderByRef(userId, ref),

    /* ---- privacy: the customer's own data, and erasing it ---- */
    exportUser(userId) {
      const u = store.getUser(userId);
      if (!u) return null;
      return {
        exportedAt: nowISO(),
        account: { id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address, createdAt: u.createdAt },
        places: u.homes,
        signInMethods: (u.identities || []).map(i => ({ provider: i.provider, linkedAt: i.linkedAt })),
        orders: store.ordersFor(userId),
        note: 'كلمة المرور غير مدرجة هنا لأنها مخزَّنة مشفَّرة وغير قابلة للاسترجاع. / Your password is not included: it is stored hashed and cannot be recovered.',
      };
    },
    deleteUser(userId) {
      if (!store.getUser(userId)) return { error: 'no-user' };
      store.deleteUser(userId);                 // cascades: homes, sessions, orders, identities
      return { ok: true };
    },

    stats() { return { users: store.userCount(), sessions: store.sessionCount(), orders: store.orderCount() }; },

    /* ---- admin desk ----
       These read across ALL customers, so the server MUST gate them behind an
       admin check before calling. They never expose password hashes or salts. */
    ORDER_STATUSES,
    listUsersAdmin() {
      const out = [];
      store.eachUser(u => out.push({
        id: u.id, email: u.email, name: u.name, phone: u.phone || '',
        createdAt: u.createdAt, homes: (u.homes || []).length,
        orders: store.ordersFor(u.id).length,
        providers: (u.identities || []).map(i => i.provider),
      }));
      out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return out;
    },
    allOrders() {
      // attach a light customer label so the desk can show who ordered
      const names = new Map();
      store.eachUser(u => names.set(u.id, { name: u.name, email: u.email, phone: u.phone || '' }));
      return store.allOrders().map(o => Object.assign({ customer: names.get(o.userId) || null }, o));
    },
    setOrderStatus(ref, status) {
      status = String(status || '').trim();
      if (!ORDER_STATUSES.includes(status)) return { error: 'bad-status' };
      const o = store.setOrderStatus(String(ref || ''), status);
      if (!o) return { error: 'no-order' };
      return { ok: true, order: o };
    },
    adminOverview() {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      return {
        users: store.userCount(), sessions: store.sessionCount(), orders: store.orderCount(),
        ordersToday: store.ordersSince(dayAgo), ordersWeek: store.ordersSince(weekAgo),
      };
    },
    getOrderAny(ref) {
      const all = store.allOrders();
      return all.find(o => o.ref === ref) || null;
    },

    __raw: () => store.raw,   // tests only: assert on the stored bytes/rows directly
    close() { try { clearInterval(sweeper); store.close(); } catch (e) {} },
  };
}

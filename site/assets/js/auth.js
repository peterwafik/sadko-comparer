/* ============================================================================
   SADKO client auth — a thin, honest wrapper over the real /api/auth endpoints.
   ----------------------------------------------------------------------------
   The session lives in an HttpOnly cookie set by the server, which means this
   script CANNOT read it — that is the point. Nothing here stores a password or
   a token; `skAuth.me()` simply asks the server who you are.

   The site can also be served as plain static files with no Node process
   behind it. In that case every call fails, and instead of pretending to sign
   people in we set `skAuth.available = false` so pages can say plainly that
   accounts need the full deployment. Never fake a signed-in state.

     await skAuth.me()            -> user | null   (cached per page)
     await skAuth.register(data)  -> {ok,user} | {error,message}
     await skAuth.login(...)      -> {ok,user} | {error,message}
     await skAuth.logout()
     await skAuth.saveProfile(patch)
     skAuth.onChange(fn)          -> fires whenever the signed-in user changes
   ========================================================================== */
(function () {
  'use strict';

  const ROOT = /\/category\//.test(location.pathname) ? '../' : '';
  const API = ROOT + 'api/';
  const EN = () => !!(window.skLang && window.skLang.get() === 'en');
  const listeners = [];
  let cached, loaded = false;

  function emit() { listeners.forEach(fn => { try { fn(cached); } catch (e) {} }); }

  async function call(pathname, opts) {
    const o = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body && typeof o.body !== 'string') {
      o.headers['content-type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const url = '/' + API.replace(/^\//, '') + pathname + (pathname.includes('?') ? '&' : '?') + 'lang=' + (EN() ? 'en' : 'ar');
    let r;
    try { r = await fetch(url.replace('//api/', '/api/'), o); }
    catch (e) { skAuth.available = false; return { error: 'offline', message: offlineMsg() }; }
    if (r.status === 404 || r.status === 503) {
      skAuth.available = false;
      return { error: 'unavailable', message: offlineMsg() };
    }
    skAuth.available = true;
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok && !data.error) data.error = 'http-' + r.status;
    return data;
  }

  /* ---- guest homes: the same feature without an account ---- */
  const GK = 'sadko-homes-v1', GA = 'sadko-home-active';
  function guestHomes() { try { return JSON.parse(localStorage.getItem(GK)) || []; } catch (e) { return []; } }
  function guestActiveId() { try { return localStorage.getItem(GA) || null; } catch (e) { return null; } }
  function saveGuest(list, activeId) {
    try {
      localStorage.setItem(GK, JSON.stringify(list));
      if (activeId) localStorage.setItem(GA, activeId); else localStorage.removeItem(GA);
    } catch (e) {}
    document.dispatchEvent(new CustomEvent('sk-store-change', { detail: { key: GK } }));
  }
  /* When a guest signs in, carry the places they already described into the
     account instead of quietly dropping them. */
  async function adoptGuestHomes() {
    const list = guestHomes();
    if (!list.length || !cached) return;
    for (const h of list) {
      const copy = Object.assign({}, h); delete copy.id; delete copy.createdAt;
      await skAuth.addHome(copy);
    }
    saveGuest([], null);
  }

  function offlineMsg() {
    return EN()
      ? 'Accounts are not available on this deployment — the site is being served without its server. You can still browse, compare, save products and build plans; ordering needs sign-in.'
      : 'الحسابات غير متاحة فى هذه النسخة — فالموقع يعمل دون الخادم الخاص به. ويمكنك التصفح والمقارنة وحفظ المنتجات وإنشاء الخطط، غير أن تقديم الطلب يتطلب تسجيل الدخول.';
  }

  const skAuth = {
    available: true,

    /* Who is signed in. Cached for the page; pass true to force a refetch. */
    async me(force) {
      if (loaded && !force) return cached;
      const d = await call('auth/me', { method: 'GET' });
      cached = d && d.user ? d.user : null;
      loaded = true;
      emit();
      return cached;
    },
    /* Synchronous read of the last known user — for render paths that cannot await. */
    current() { return cached || null; },
    isReady() { return loaded; },

    async register(payload) {
      const d = await call('auth/register', { method: 'POST', body: payload });
      if (d.ok) { cached = d.user; loaded = true; emit(); await adoptGuestHomes(); }
      return d;
    },
    async login(email, password) {
      const d = await call('auth/login', { method: 'POST', body: { email, password } });
      if (d.ok) { cached = d.user; loaded = true; emit(); await adoptGuestHomes(); }
      return d;
    },
    async logout() {
      const d = await call('auth/logout', { method: 'POST' });
      cached = null; loaded = true; emit();
      return d;
    },
    async saveProfile(patch) {
      const d = await call('auth/profile', { method: 'POST', body: patch });
      if (d.ok) { cached = d.user; emit(); }
      return d;
    },
    async changePassword(current, next) {
      const d = await call('auth/password', { method: 'POST', body: { current, next } });
      if (d.ok) { cached = null; emit(); }
      return d;
    },
    async orders() {
      const d = await call('orders', { method: 'GET' });
      return d.orders || [];
    },
    async placeOrder(payload) { return call('orders', { method: 'POST', body: payload }); },

    /* Privacy self-service: a copy of everything, or erase it all. */
    exportUrl() { return '/api/auth/export'; },
    async deleteAccount(confirmEmail) {
      const d = await call('auth/delete', { method: 'POST', body: { confirmEmail } });
      if (d.ok) { cached = null; loaded = true; emit(); }
      return d;
    },

    /* ---- social sign-in ----
       We never see a password here; the provider hands the browser a signed ID
       token and the SERVER verifies it. `config()` reports which providers this
       deployment actually has credentials for, so no dead button is rendered. */
    async config() {
      if (this._cfg) return this._cfg;
      const d = await call('auth/config', { method: 'GET' });
      this._cfg = (d && d.providers) ? d : { providers: [], passwordAuth: true };
      return this._cfg;
    },
    async oauth(provider, credential, nonce) {
      const d = await call('auth/oauth', { method: 'POST', body: { provider, credential, nonce } });
      if (d.ok) { cached = d.user; loaded = true; emit(); await adoptGuestHomes(); }
      return d;
    },

    /* ---- house / room profiles ----
       A customer can keep several places (the flat, the coast chalet, a single
       room) and the ACTIVE one drives filtering everywhere on the site. Guests
       get the same feature from localStorage so nothing is gated behind signup. */
    homes() {
      if (cached) return cached.homes || [];
      return guestHomes();
    },
    activeHome() {
      const list = skAuth.homes();
      const id = cached ? cached.activeHomeId : guestActiveId();
      return list.find(h => h.id === id) || list[0] || null;
    },
    async addHome(data) {
      if (cached) { const d = await call('auth/homes', { method: 'POST', body: data }); if (d.ok) { cached = d.user; emit(); } return d; }
      const h = Object.assign({ id: 'g' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(),
                                name: data.name || 'منزلى', icon: data.icon || '🏠', scope: data.scope === 'room' ? 'room' : 'home' }, data);
      const list = guestHomes(); list.push(h);
      saveGuest(list, h.id); emit();
      return { ok: true, home: h, local: true };
    },
    async updateHome(id, patch) {
      if (cached) { const d = await call('auth/homes', { method: 'PATCH', body: { id, patch } }); if (d.ok) { cached = d.user; emit(); } return d; }
      const list = guestHomes();
      const i = list.findIndex(h => h.id === id);
      if (i < 0) return { error: 'no-home' };
      list[i] = Object.assign({}, list[i], patch, { id: list[i].id });
      saveGuest(list, guestActiveId()); emit();
      return { ok: true, home: list[i], local: true };
    },
    async removeHome(id) {
      if (cached) { const d = await call('auth/homes', { method: 'DELETE', body: { id } }); if (d.ok) { cached = d.user; emit(); } return d; }
      const list = guestHomes().filter(h => h.id !== id);
      saveGuest(list, guestActiveId() === id ? (list[0] && list[0].id) : guestActiveId()); emit();
      return { ok: true, local: true };
    },
    async setActiveHome(id) {
      if (cached) { const d = await call('auth/homes/active', { method: 'POST', body: { id } }); if (d.ok) { cached = d.user; emit(); } return d; }
      saveGuest(guestHomes(), id); emit();
      return { ok: true, local: true };
    },

    onChange(fn) { listeners.push(fn); if (loaded) { try { fn(cached); } catch (e) {} } },
    offlineMsg,

    /* The profile that filtering should use, wherever it lives: the ACTIVE
       home of the signed-in account, or the active guest home, or the older
       single device profile. One accessor so no page has to know which. */
    profile() {
      const h = skAuth.activeHome();
      if (h) return h;
      try { return (window.skStore && window.skStore.profile.get()) || {}; } catch (e) { return {}; }
    },
    async setProfile(patch) {
      try { window.skStore && window.skStore.profile.set(patch); } catch (e) {}
      if (cached) return skAuth.saveProfile({ profile: patch });
      return { ok: true, local: true };
    },
  };

  window.skAuth = skAuth;
  // Resolve the session as early as possible so nav and pages can paint once.
  skAuth.me();
})();

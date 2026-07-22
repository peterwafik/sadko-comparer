/* ============================================================================
   SADKO social sign-in — OpenID Connect ID-token verification, zero deps.
   ----------------------------------------------------------------------------
   "Sign in with Google" (and the other providers here) hands the BROWSER a
   signed JWT. That token is worthless unless the server checks it properly, so
   this module does the full job rather than trusting the client:

     1. RS256 signature, against the provider's published JWKS (cached).
     2. `iss` matches the provider exactly (or its tenant pattern).
     3. `aud` equals OUR client id — otherwise a token minted for a different
        app could be replayed against this one.
     4. `exp` / `iat` inside a small clock skew.
     5. `nonce` matches the one we issued, when we issued one.
     6. `email_verified` — an unverified email must never be allowed to take
        over an existing password account by matching on address.

   Why this shape: the ID-token ("credential") flow needs only a PUBLIC client
   id, no client secret, so the whole thing is free to run and there is no
   secret to leak from this repo. Providers are enabled purely by setting an
   environment variable; with none set, the buttons simply do not appear.
   ========================================================================== */

import { createPublicKey, createVerify } from 'node:crypto';

export const PROVIDERS = {
  google: {
    id: 'google',
    label: { ar: 'جوجل', en: 'Google' },
    env: 'GOOGLE_CLIENT_ID',
    iss: ['https://accounts.google.com', 'accounts.google.com'],
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    mode: 'gis',                     // Google Identity Services button, ID token straight back
    docs: 'https://console.cloud.google.com/apis/credentials',
  },
  microsoft: {
    id: 'microsoft',
    label: { ar: 'مايكروسوفت', en: 'Microsoft' },
    env: 'MICROSOFT_CLIENT_ID',
    // Tenant-specific issuer: https://login.microsoftonline.com/{tenantId}/v2.0
    issPattern: /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i,
    jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    mode: 'redirect',
    docs: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps',
  },
};

/* Which providers this deployment can actually offer. */
export function enabledProviders(env) {
  const e = env || process.env;
  return Object.values(PROVIDERS)
    .filter(p => !!(e[p.env] || '').trim())
    .map(p => ({ id: p.id, label: p.label, mode: p.mode, clientId: (e[p.env] || '').trim() }));
}
export function clientIdFor(id, env) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const v = ((env || process.env)[p.env] || '').trim();
  return v || null;
}

/* ---------- base64url ---------- */
const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const jsonPart = s => { try { return JSON.parse(b64u(s).toString('utf8')); } catch { return null; } };

/* ---------- JWKS cache ---------- */
const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map();          // url -> { at, keys }

export function _clearJwksCache() { jwksCache.clear(); }

async function getJwks(url, fetchImpl, now) {
  const hit = jwksCache.get(url);
  if (hit && (now - hit.at) < JWKS_TTL_MS) return hit.keys;
  const res = await (fetchImpl || fetch)(url, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) throw new Error('jwks-unavailable');
  const body = await res.json();
  const keys = (body && body.keys) || [];
  jwksCache.set(url, { at: now, keys });
  return keys;
}

/**
 * Verify a provider ID token.
 * @returns {Promise<{ok:true, claims, identity}|{ok:false, error:string}>}
 */
export async function verifyIdToken(providerId, token, opts = {}) {
  const p = PROVIDERS[providerId];
  if (!p) return { ok: false, error: 'unknown-provider' };

  const clientId = opts.clientId || clientIdFor(providerId, opts.env);
  if (!clientId) return { ok: false, error: 'provider-not-configured' };

  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed-token' };

  const header = jsonPart(parts[0]);
  const claims = jsonPart(parts[1]);
  if (!header || !claims) return { ok: false, error: 'malformed-token' };
  // Only RS256. Refusing "alg":"none" and HS* here is what stops the classic
  // algorithm-confusion forgery.
  if (header.alg !== 'RS256') return { ok: false, error: 'bad-alg' };
  if (!header.kid) return { ok: false, error: 'no-kid' };

  const now = opts.now || Date.now();

  let keys;
  try { keys = await getJwks(p.jwks, opts.fetchImpl, now); }
  catch { return { ok: false, error: 'jwks-unavailable' }; }

  const jwk = keys.find(k => k.kid === header.kid && (k.kty === 'RSA'));
  if (!jwk) return { ok: false, error: 'unknown-key' };

  let pub;
  try { pub = createPublicKey({ key: jwk, format: 'jwk' }); }
  catch { return { ok: false, error: 'bad-key' }; }

  const signed = parts[0] + '.' + parts[1];
  const sig = b64u(parts[2]);
  const good = createVerify('RSA-SHA256').update(signed).verify(pub, sig);
  if (!good) return { ok: false, error: 'bad-signature' };

  // issuer
  const issOk = p.issPattern ? p.issPattern.test(String(claims.iss || ''))
                             : (p.iss || []).includes(claims.iss);
  if (!issOk) return { ok: false, error: 'bad-issuer' };

  // audience — a token minted for another app must not work here
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return { ok: false, error: 'bad-audience' };

  // freshness
  const skew = opts.skewSec == null ? 300 : opts.skewSec;
  const sec = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + skew < sec) return { ok: false, error: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat - skew > sec) return { ok: false, error: 'not-yet-valid' };

  // replay protection when we issued a nonce
  if (opts.nonce && claims.nonce !== opts.nonce) return { ok: false, error: 'bad-nonce' };

  if (!claims.sub) return { ok: false, error: 'no-subject' };
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'no-email' };

  // Google/Microsoft both send this. Anything falsy means we must NOT treat the
  // address as proof of ownership.
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true'
                     || claims.verified_email === true;

  return {
    ok: true,
    claims,
    identity: {
      provider: providerId,
      sub: String(claims.sub),
      email,
      emailVerified,
      name: String(claims.name || claims.given_name || '').trim().slice(0, 80),
      picture: String(claims.picture || '').slice(0, 400),
    },
  };
}

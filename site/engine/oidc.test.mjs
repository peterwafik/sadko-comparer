// site/engine/oidc.test.mjs
// The verifier is tested against locally minted tokens: we generate an RSA key,
// serve it as a fake JWKS, and sign our own JWTs. That exercises the real
// signature path without touching the network or Google's servers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID } from 'node:crypto';
import { verifyIdToken, enabledProviders, clientIdFor, PROVIDERS, _clearJwksCache } from './oidc.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { publicKey: otherPub, privateKey: otherPriv } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';

const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function sign(claims, { key = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const head = b64u({ alg, kid, typ: 'JWT' });
  const body = b64u(claims);
  if (alg === 'none') return head + '.' + body + '.';
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(key).toString('base64url');
  return head + '.' + body + '.' + sig;
}
function jwksFetch(pub = publicKey, kid = KID) {
  return async () => ({ ok: true, json: async () => ({ keys: [{ ...pub.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] }) });
}
const NOW = Date.now();
const baseClaims = (over = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '11223344',
  email: 'Nour@Gmail.com'.toLowerCase(), email_verified: true, name: 'Nour',
  iat: Math.floor(NOW / 1000) - 10, exp: Math.floor(NOW / 1000) + 3600, ...over,
});
const opts = (over = {}) => ({ clientId: CLIENT_ID, fetchImpl: jwksFetch(), now: NOW, ...over });

test('a well-formed Google token verifies and yields an identity', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims()), opts());
  assert.equal(r.ok, true);
  assert.equal(r.identity.provider, 'google');
  assert.equal(r.identity.email, 'nour@gmail.com');
  assert.equal(r.identity.emailVerified, true);
  assert.equal(r.identity.sub, '11223344');
});

test('CRITICAL: a token signed by the wrong key is rejected', async () => {
  _clearJwksCache();
  const forged = sign(baseClaims(), { key: otherPriv });      // signed by an attacker's key
  const r = await verifyIdToken('google', forged, opts());     // JWKS still serves the real key
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-signature');
});

test('CRITICAL: alg=none is refused', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims(), { alg: 'none' }), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-alg');
});

test('CRITICAL: a token minted for another app (wrong aud) is refused', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims({ aud: 'someone-elses-client-id' })), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-audience');
});

test('CRITICAL: a token from another issuer is refused', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims({ iss: 'https://evil.example.com' })), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-issuer');
});

test('an expired token is refused, and clock skew is bounded', async () => {
  _clearJwksCache();
  const past = Math.floor(NOW / 1000) - 4000;
  const r = await verifyIdToken('google', sign(baseClaims({ exp: past })), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'expired');
});

test('a token issued in the future is refused', async () => {
  _clearJwksCache();
  const soon = Math.floor(NOW / 1000) + 4000;
  const r = await verifyIdToken('google', sign(baseClaims({ iat: soon, exp: soon + 3600 })), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-yet-valid');
});

test('an unknown kid is refused rather than guessed', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims(), { kid: 'not-published' }), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown-key');
});

test('nonce is enforced when we issued one', async () => {
  _clearJwksCache();
  const n = randomUUID();
  const good = await verifyIdToken('google', sign(baseClaims({ nonce: n })), opts({ nonce: n }));
  assert.equal(good.ok, true);
  _clearJwksCache();
  const replay = await verifyIdToken('google', sign(baseClaims({ nonce: 'other' })), opts({ nonce: n }));
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'bad-nonce');
});

test('email_verified:false is surfaced, not silently trusted', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims({ email_verified: false })), opts());
  assert.equal(r.ok, true);
  assert.equal(r.identity.emailVerified, false, 'caller must be able to refuse account linking');
});

test('a token with no email is refused', async () => {
  _clearJwksCache();
  const c = baseClaims(); delete c.email;
  const r = await verifyIdToken('google', sign(c), opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-email');
});

test('malformed input never throws', async () => {
  _clearJwksCache();
  for (const bad of ['', 'x', 'a.b', 'a.b.c.d', null, undefined, 'not.a.jwt']) {
    const r = await verifyIdToken('google', bad, opts());
    assert.equal(r.ok, false);
  }
});

test('an unconfigured provider refuses instead of half-working', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims()), { fetchImpl: jwksFetch(), now: NOW, env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'provider-not-configured');
});

test('unknown provider id is refused', async () => {
  const r = await verifyIdToken('myspace', 'a.b.c', opts());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown-provider');
});

test('Microsoft tenant issuers are matched by pattern', async () => {
  assert.ok(PROVIDERS.microsoft.issPattern.test('https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'));
  assert.ok(!PROVIDERS.microsoft.issPattern.test('https://login.microsoftonline.example.com/x/v2.0'));
});

test('providers are advertised only when their client id is configured', () => {
  assert.deepEqual(enabledProviders({}), []);
  const one = enabledProviders({ GOOGLE_CLIENT_ID: CLIENT_ID });
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'google');
  assert.equal(one[0].clientId, CLIENT_ID);
  assert.equal(clientIdFor('google', { GOOGLE_CLIENT_ID: CLIENT_ID }), CLIENT_ID);
  assert.equal(clientIdFor('google', {}), null);
});

test('a JWKS outage fails closed', async () => {
  _clearJwksCache();
  const r = await verifyIdToken('google', sign(baseClaims()), opts({ fetchImpl: async () => ({ ok: false }) }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'jwks-unavailable');
});

/* ======================================================================
   Passwordless mode.

   The reason it exists: Ecwid has no API that verifies a password, so the
   only way the site stops STORING credentials is to stop having them —
   sign-in moves entirely to a provider, and signInWithIdentity already
   creates accounts with salt and hash both null.

   The danger it has to refuse: turning passwords off with no provider
   configured locks every customer out of the site, permanently and
   silently. GOOGLE_CLIENT_ID is currently unset, so that is not a
   hypothetical — it is the live state of this deployment.
   ================================================================== */
import { authMode } from './oidc.mjs';

test('by default, passwords stay on', () => {
  assert.equal(authMode({}, 1).passwordless, false);
  assert.equal(authMode({}, 0).passwordless, false);
});

test('the flag turns passwords off when a provider is configured', () => {
  const m = authMode({ SADKO_AUTH_PASSWORDLESS: '1' }, 1);
  assert.equal(m.passwordless, true);
  assert.ok(!m.fatal);
});

test('the flag is accepted in the spellings an operator will actually type', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 '])
    assert.equal(authMode({ SADKO_AUTH_PASSWORDLESS: v }, 1).passwordless, true, v + ' should enable it');
  for (const v of ['0', 'false', 'no', 'off', '', '  '])
    assert.equal(authMode({ SADKO_AUTH_PASSWORDLESS: v }, 1).passwordless, false, v + ' should not');
});

test('the flag with NO provider is fatal, and does not quietly leave passwords on', () => {
  /* Both silent outcomes are wrong. Leaving passwords on means the operator
     believes a door is shut that is open. Turning them off means nobody can
     sign in at all. So it refuses to start and says which. */
  const m = authMode({ SADKO_AUTH_PASSWORDLESS: '1' }, 0);
  assert.equal(m.fatal, true);
  assert.equal(m.passwordless, false, 'it must not half-apply');
  assert.match(m.reason, /provider/);
});

test('the fatal message names the actual fix, not the symptom', () => {
  const m = authMode({ SADKO_AUTH_PASSWORDLESS: 'yes' }, 0);
  assert.match(m.message, /GOOGLE_CLIENT_ID/);
});

test('the security policy lets the Google button load its own stylesheet', async () => {
  /* Google Identity Services injects https://accounts.google.com/gsi/style
     into the page; without it in style-src the browser blocks it and the
     button renders unstyled. */
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const server = readFileSync(path.join(import.meta.dirname, '..', 'compare-server.mjs'), 'utf8');
  const style = /"style-src [^"]*"/.exec(server);
  assert.ok(style, 'a style-src directive exists');
  assert.match(style[0], /https:\/\/accounts\.google\.com\/gsi\/style/);
});

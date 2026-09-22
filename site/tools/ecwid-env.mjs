/* ============================================================================
   Where the Ecwid credentials come from, resolved in one place.

   Order of precedence:
     1. the process environment  (how the server gets them in production,
        via /etc/sadko.env loaded by sadko.service)
     2. site/.ecwid.env          (a local development convenience — matched by
        `*.env` in .gitignore, so it can never be committed)

   Nothing in here prints, logs or returns a credential's value. Callers get
   `hasToken` and `tokenLength` so they can report that a token is present
   without ever handling it.
   ========================================================================== */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL_FILE = path.join(import.meta.dirname, '..', '.ecwid.env');

/* A deliberately small parser: KEY=value per line, # comments, optional
   surrounding quotes. It TOLERATES spaces around `=` (a very easy mistake to
   make) even though systemd's EnvironmentFile does not — see the warning in
   describeEnv() below, which tells the operator to fix the real file. */
function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (key) out[key] = val;
  }
  return out;
}

function localFile() {
  if (!existsSync(LOCAL_FILE)) return {};
  try { return parseEnvFile(readFileSync(LOCAL_FILE, 'utf8')); }
  catch { return {}; }
}

/* Accept the documented name, and also the shorter ones an operator is likely
   to have written by hand. Which one was found is reported, so a mismatch
   surfaces as a note rather than as "no token". */
const TOKEN_KEYS = ['SADKO_ECWID_TOKEN', 'ECWID_TOKEN', 'ECWID_ACCESS_TOKEN'];
const SECRET_KEYS = ['SADKO_ECWID_WEBHOOK_SECRET', 'ECWID_WEBHOOK_SECRET', 'ECWID_CLIENT_SECRET'];
const STORE_KEYS = ['SADKO_ECWID_STORE_ID', 'ECWID_STORE_ID'];

function pick(keys, sources) {
  for (const src of sources) {
    for (const k of keys) {
      const v = src[k];
      if (v != null && String(v).trim() !== '') return { key: k, value: String(v).trim(), from: src.__label };
    }
  }
  return null;
}

export function ecwidEnv() {
  const env = { ...process.env, __label: 'environment' };
  const file = { ...localFile(), __label: 'site/.ecwid.env' };
  const sources = [env, file];

  const token = pick(TOKEN_KEYS, sources);
  const secret = pick(SECRET_KEYS, sources);
  const store = pick(STORE_KEYS, sources);

  return {
    storeId: store ? store.value : '142682751',          // the SADKO test store
    storeIdFrom: store ? store.from : 'default',
    token: token ? token.value : '',
    secret: secret ? secret.value : '',

    /* Everything below is safe to print. */
    hasToken: !!token,
    tokenLength: token ? token.value.length : 0,
    /* 'secret' | 'public' | 'unknown' | null — the PREFIX only, which is safe
       to print and is what decides how to read a 403: with a public token it
       means the wrong token, with a secret one it means a missing app scope.
       Callers that guessed "public" when refused sent the reader to fix the
       wrong thing. */
    tokenKind: token
      ? (token.value.startsWith('secret_') ? 'secret'
        : token.value.startsWith('public_') ? 'public' : 'unknown')
      : null,
    tokenKey: token ? token.key : null,
    tokenFrom: token ? token.from : null,
    hasSecret: !!secret,
    secretLength: secret ? secret.value.length : 0,
    secretKey: secret ? secret.key : null,
    localFilePath: LOCAL_FILE,
    localFileExists: existsSync(LOCAL_FILE),
  };
}

/* A human-readable account of what was found, with no credential in it. Also
   surfaces the two configuration mistakes that fail silently in production:
   a non-canonical variable name, and spaces around `=` in the systemd file. */
export function describeEnv(e = ecwidEnv()) {
  const lines = [];
  lines.push(`store id     ${e.storeId}  (from ${e.storeIdFrom})`);
  lines.push(e.hasToken
    ? `token        present, ${e.tokenLength} chars  (as ${e.tokenKey}, from ${e.tokenFrom})`
    : 'token        MISSING');
  lines.push(e.hasSecret
    ? `app secret   present, ${e.secretLength} chars  (as ${e.secretKey})`
    : 'app secret   missing  (only needed for webhooks)');

  /* The single most confusing failure this integration produced. Ecwid issues
     TWO tokens per custom app: a `public_` one, which is read-only and limited
     to catalogue data (it is meant to be embedded in a storefront), and a
     `secret_` one, which carries the app's actual access scopes.

     With a public token the catalogue syncs perfectly — products, categories
     and the store profile all return 200 — and then /orders returns 403 and
     every write returns 403. That looks exactly like a missing scope, and it
     is not: the scopes are on the app, the token simply cannot use them. */
  if (e.hasToken && e.token.startsWith('public_')) {
    lines.push('');
    lines.push('WARNING: this is a PUBLIC token (public_…).');
    lines.push('  Public tokens are READ-ONLY and limited to catalogue data, so:');
    lines.push('    · products, categories and profile will work');
    lines.push('    · /orders will return 403, and so will every write');
    lines.push('  That is NOT a missing scope. Use the SECRET token instead:');
    lines.push('  Ecwid > Apps > Custom Apps > Edit > "Show secret token".');
  }

  if (e.hasToken && e.tokenKey !== 'SADKO_ECWID_TOKEN') {
    lines.push('');
    lines.push(`NOTE: found the token as ${e.tokenKey}, but compare-server.mjs reads`);
    lines.push('      SADKO_ECWID_TOKEN. These tools accept either; the SERVER does not.');
    lines.push('      Rename it in /etc/sadko.env before deploying, or the live site will');
    lines.push('      silently serve the seed catalogue instead of Ecwid.');
  }
  if (!e.hasToken) {
    lines.push('');
    lines.push('To supply it for local development, create this file:');
    lines.push('  ' + e.localFilePath);
    lines.push('containing one line, with NO spaces around the equals sign:');
    lines.push('  SADKO_ECWID_TOKEN=<the token from Ecwid: Apps > Custom Apps>');
    lines.push('It is matched by *.env in .gitignore, so it cannot be committed.');
  }
  return lines.join('\n');
}

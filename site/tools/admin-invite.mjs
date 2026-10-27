#!/usr/bin/env node
/* ============================================================================
   Invite an admin, or reset one: prints a temporary password, ONCE.

     node --env-file=.admin.env tools/admin-invite.mjs peter@example.com
     node --env-file=.admin.env tools/admin-invite.mjs --url https://sadko-home.vercel.app peter@example.com

   The server makes the password (engine/admin-auth.mjs) and keeps only its
   hash, so this is the only place it is ever visible. It is valid for 48
   hours; the first sign-in must replace it and enrol an authenticator app.
   Running this again for the same email resets that admin completely.

     node --env-file=.admin.prod.env tools/admin-invite.mjs --url https://sadko-home.vercel.app --master owner@example.com

   --master makes an EXISTING admin the master account instead (no password
   reset): the one admin no one else can remove or restrict, and the only one
   who manages the others. There is one master; this moves the role.

   Authorised by SADKO_ADMIN_SECRET, the same value the server has. Nothing is
   written to disk here.
   ========================================================================== */

const args = process.argv.slice(2);
let url = 'http://localhost:8082';
const i = args.indexOf('--url');
if (i >= 0) { url = args[i + 1]; args.splice(i, 2); }
const m = args.indexOf('--master');
const master = m >= 0;
if (master) args.splice(m, 1);
const email = args[0];
const secret = process.env.SADKO_ADMIN_SECRET || '';

if (!email || !/@/.test(email)) {
  console.error('usage: node --env-file=.admin.env tools/admin-invite.mjs [--url https://site] [--master] someone@example.com');
  process.exit(2);
}
if (secret.length < 24) {
  console.error('SADKO_ADMIN_SECRET is not set (or shorter than 24 characters) in this shell.');
  process.exit(2);
}

const res = await fetch(url.replace(/\/$/, '') + '/api/admin-auth/' + (master ? 'master' : 'invite') + '?lang=en', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + secret },
  body: JSON.stringify({ email }),
}).catch(e => { console.error('Could not reach ' + url + ': ' + e.message); process.exit(1); });

const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  console.error(`Invite failed (${res.status}): ${body.message || body.error || 'unknown error'}`);
  process.exit(1);
}
if (master) {
  /* No process.exit here: exiting while fetch's sockets are still closing
     trips a libuv assertion on Windows (src\win\async.c). The script simply
     ends once the output is written. */
  console.log('\n  ' + body.email + ' is now the master admin.\n');
} else {
console.log('');
console.log('  Admin:              ' + body.email);
console.log('  Temporary password: ' + body.tempPassword);
console.log('  Valid until:        ' + new Date(body.expiresAt).toLocaleString());
console.log('  Sign in at:         ' + url.replace(/\/$/, '') + '/admin');
console.log('');
console.log('  They will set their own password and scan a QR code with an authenticator app.');
}

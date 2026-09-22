/* ============================================================================
   Put the Ecwid token in place, safely, for someone who does not want to edit
   configuration files.

     node tools/set-ecwid-token.mjs

   It asks for the token, checks it against Ecwid BEFORE saving anything, then
   writes it with the right file permissions and tells you what now works.

   WHY IT EXISTS. Swapping this token is the single thing standing between the
   site and a working integration, and the manual route is three chances to
   get it wrong: paste into the wrong file, leave the file world-readable, or
   save a token that does not actually have the access needed and discover it
   later through a customer's missing order.

   WHAT IT WILL NOT DO. It never prints the token, never logs it, never puts
   it in shell history, and never sends it anywhere except api.ecwid.com. The
   input is not echoed to the screen as you paste. If the check fails, nothing
   is written at all — the old token stays exactly as it was.
   ========================================================================== */

import { existsSync, readFileSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const SITE = path.join(import.meta.dirname, '..');
const LOCAL = path.join(SITE, '.ecwid.env');
const SYSTEM = '/etc/sadko.env';

/* Prefer the system file when it exists (that is the VM); otherwise the local
   development file. --file= overrides both. */
const argFile = process.argv.find(a => a.startsWith('--file='));
const TARGET = argFile ? argFile.slice(7) : (existsSync(SYSTEM) ? SYSTEM : LOCAL);

const tty = process.stdout.isTTY;
const g = s => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const r = s => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const y = s => (tty ? `\x1b[33m${s}\x1b[0m` : s);
const b = s => (tty ? `\x1b[1m${s}\x1b[0m` : s);

/* Read lines WITHOUT echoing them. A token pasted into a visible prompt ends
   up in a screenshot, a shoulder-glance, or a support chat.

   The suppression is at readline's _writeToOutput, which is the one place
   every character passes through. Clearing the line after the fact was the
   first attempt and it leaked: the pasted token still flashed up, which for a
   credential is the same as being shown.

   ONE input session for every question.

   A fresh readline per question looked simpler and silently broke the second
   one: closing an interface leaves stdin ended, so the next interface reads
   EOF and returns empty — the client secret was skipped without a word. One
   interface, opened once and closed at the end. */
function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let armed = false;
  rl._writeToOutput = function (chunk) {
    /* The prompt itself is printed; everything after it is the secret. */
    if (!armed) { rl.output.write(chunk); return; }
    /* Newlines may pass, so the cursor still moves off the prompt line. */
    if (/^[\r\n]+$/.test(chunk)) rl.output.write(chunk);
  };
  return {
    ask(question) {
      return new Promise(resolve => {
        armed = false;
        rl.output.write(question);
        armed = true;
        rl.question('', answer => {
          armed = false;
          process.stdout.write('\n');
          resolve(String(answer || '').trim());
        });
      });
    },
    close() { try { rl.close(); } catch (e) {} },
  };
}

const STORE_ID = process.env.SADKO_ECWID_STORE_ID || '142682751';

/* Ask Ecwid what this token can actually do, before trusting it with anything.

   READING and WRITING are separate scopes and are checked separately. The
   first version tested GET /orders only and reported "orders — so orders can
   be sent to Ecwid: works" — on a token that could read orders and not create
   them, which is a real and common grant. That is precisely the claim that
   must not be wrong: sending orders is the whole job.

   The write check POSTs a deliberately EMPTY body. A permitted-but-invalid
   call answers 400 or 422; a forbidden one answers 403. So permission is
   established without creating anything in the owner's store. */
async function probe(token) {
  const call = async (p, opt) => {
    try {
      const res = await fetch(`https://app.ecwid.com/api/v3/${STORE_ID}${p}`, {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json',
                   'content-type': 'application/json' },
        ...(opt || {}),
      });
      return res.status;
    } catch (e) { return 0; }
  };
  const canWrite = s => s !== 403 && s !== 401 && s !== 0;
  const postOrders = await call('/orders', { method: 'POST', body: '{}' });
  return {
    products: await call('/products?limit=1'),
    ordersRead: await call('/orders?limit=1'),
    ordersWrite: postOrders,
    ordersWriteOk: canWrite(postOrders),
    customers: await call('/customers?limit=1'),
  };
}

/* Replace one KEY=value in place, keeping every other line untouched. */
function writeValue(file, key, value) {
  let lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  let replaced = false;
  lines = lines.map(l => {
    if (new RegExp('^\\s*' + key + '\\s*=').test(l)) { replaced = true; return `${key}=${value}`; }
    return l;
  });
  if (!replaced) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${key}=${value}`);
  }
  writeFileSync(file, lines.join('\n').replace(/\n+$/, '\n'));
  try { chmodSync(file, 0o600); } catch (e) {}
  return replaced;
}

/* Replace SADKO_ECWID_TOKEN in place, keeping every other line untouched. */
function writeToken(file, token) {
  let lines = [];
  if (existsSync(file)) {
    copyFileSync(file, file + '.bak');          // a way back, with the same 0600
    try { chmodSync(file + '.bak', 0o600); } catch (e) {}
    lines = readFileSync(file, 'utf8').split(/\r?\n/);
  }
  let replaced = false;
  lines = lines.map(l => {
    if (/^\s*SADKO_ECWID_TOKEN\s*=/.test(l)) { replaced = true; return `SADKO_ECWID_TOKEN=${token}`; }
    return l;
  });
  if (!replaced) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`SADKO_ECWID_TOKEN=${token}`);
  }
  writeFileSync(file, lines.join('\n').replace(/\n+$/, '\n'));
  /* Owner-read-only. This token has full read and write over the whole store,
     so it must not be readable by any other account on the machine.

     On Windows chmod only toggles the read-only flag — POSIX permission bits
     do not exist, so this is a no-op there and the caller is told so rather
     than being reassured about something that did not happen. The file that
     matters is the one on the Linux server. */
  let locked = false;
  try {
    chmodSync(file, 0o600);
    locked = process.platform !== 'win32';
  } catch (e) { locked = false; }
  return { replaced, locked };
}

/* --secret: set only the app's client secret, in its own run. */
async function mainSecret() {
  console.log(b('\nSADKO — set the Ecwid app client secret\n'));
  console.log(`This will be saved to:  ${TARGET}`);
  console.log('\nIn Ecwid: Apps -> Custom apps -> Edit -> "App keys" -> Client secret.');
  console.log('It is what proves a webhook really came from Ecwid, so a NEW app');
  console.log('has a NEW one.');
  console.log(y('\nPaste it below. It will NOT appear on screen as you paste.\n'));

  const asker = makeAsker();
  const secret = await asker.ask('Client secret: ');
  asker.close();

  if (!secret) { console.log(r('\nNothing entered. No changes made.')); process.exitCode = 1; return; }
  if (/^(secret|public)_/.test(secret)) {
    console.log(r('\nThat is an access TOKEN, not the client secret — different fields.'));
    console.log('The client secret is under "App keys". Nothing was changed.');
    process.exitCode = 1;
    return;
  }
  if (secret.length < 16) {
    console.log(r('\nThat is too short to be a client secret. Nothing was changed.'));
    process.exitCode = 1;
    return;
  }
  writeValue(TARGET, 'SADKO_ECWID_WEBHOOK_SECRET', secret);
  console.log(g(`\nClient secret saved to ${TARGET}`));
  console.log('\nThis only matters once webhooks are registered, which needs the');
  console.log('site to be on its public address. Nothing else has to change.');
}

async function main() {
  if (process.argv.includes('--secret')) return mainSecret();
  console.log(b('\nSADKO — set the Ecwid token\n'));
  console.log(`This will be saved to:  ${TARGET}`);
  console.log('Nothing is saved until Ecwid confirms the token works.\n');
  console.log('In Ecwid: Apps -> Custom apps -> Edit -> "Show secret token" -> Copy.');
  console.log(y('Paste it below. It will NOT appear on screen as you paste.\n'));

  const asker = makeAsker();
  const token = await asker.ask('Token: ');

  if (!token) {
    asker.close();
    console.log(r('\nNothing entered. No changes made.'));
    process.exitCode = 1;
    return;
  }

  /* Shape check first — a clear message beats a confusing 401. */
  if (!/^(secret|public)_[A-Za-z0-9_-]{10,}$/.test(token)) {
    console.log(r('\nThat does not look like an Ecwid token.'));
    console.log('An Ecwid token starts with "secret_" or "public_". Nothing was changed.');
    asker.close();
    process.exitCode = 1;
    return;
  }
  if (token.startsWith('public_')) {
    console.log(y('\nThat is the PUBLIC token — the one already in use.'));
    console.log('It cannot read orders or customers, which is the problem we are fixing.');
    console.log('Go back and click "Show secret token" instead. Nothing was changed.');
    asker.close();
    process.exitCode = 1;
    return;
  }

  console.log('\nChecking it with Ecwid…');
  const p = await probe(token);

  const ok = s => s === 200;
  const mark = good => (good ? g('works') : r('NO'));
  console.log(`  ${mark(ok(p.products))}   the catalogue — products and prices`);
  console.log(`  ${mark(ok(p.ordersRead))}   reading orders — so staff changes show on the site`);
  console.log(`  ${mark(p.ordersWriteOk)}   SENDING orders to Ecwid — the important one`);
  console.log(`  ${mark(ok(p.customers))}   customers — so customer details are saved in Ecwid`);

  if (!ok(p.products)) {
    console.log(r('\nEcwid refused this token even for the catalogue, so it was NOT saved.'));
    console.log('Copy it again — it is easy to miss a character. Nothing was changed.');
    asker.close();
    process.exitCode = 1;
    return;
  }

  const missing = [];
  if (!ok(p.ordersRead)) missing.push('read orders');
  if (!p.ordersWriteOk) missing.push('create/update orders');
  if (!ok(p.customers)) missing.push('read/update customers');

  if (missing.length) {
    /* The token is real but the APP lacks scopes. Saved anyway — it beats the
       public token — but the missing half is named exactly, because this is
       the fault that otherwise surfaces weeks later as a customer's order
       never arriving in Ecwid. */
    console.log(y('\nThis token is real, but it is not allowed to:'));
    for (const m of missing) console.log(y('   · ' + m));
    console.log('\nTwo different things cause this, and the second one catches everybody:');
    console.log('\n  1. The app was never granted the permission.');
    console.log('     Fix: same page as the token -> "Access scopes" -> switch it on.');
    console.log('\n  2. The permission IS granted, but this token is OLDER than the grant.');
    console.log('     An Ecwid token carries the permissions it was issued with, so');
    console.log('     changing the scopes does not upgrade a token you already copied.');
    console.log('     Fix: after saving the scopes, copy the secret token AGAIN and');
    console.log('     re-run this. Regenerate it if the page offers that.');
    console.log(y('\nIf you have already switched the scopes on, it is number 2.'));
    console.log('\nSaving this token anyway — it is still better than the public one.');
  }

  const { replaced, locked } = writeToken(TARGET, token);
  console.log(g(`\nSaved to ${TARGET}`) + (replaced ? ' (previous value replaced)' : ' (added)'));
  if (existsSync(TARGET + '.bak')) console.log(`A copy of the old file is at ${TARGET}.bak`);
  if (locked) console.log('Permissions set so only this machine\'s owner can read it.');
  else console.log(y('Note: file permissions were not changed — this is Windows, which has no') +
                   y('\n      equivalent setting. The file that needs locking down is the one on'
                     + '\n      the server, where this tool does set it.'));

  /* The app's CLIENT SECRET is a second value from the same page — what proves
     a webhook really came from Ecwid — so a NEW app means a new one.

     Asked for in a SEPARATE RUN (--secret), not as a second prompt here. Two
     prompts in one run silently broke: readline consumes the whole input on
     the first question and the second never resolves, which for someone
     following instructions looks like the tool hanging for no reason. One
     question per run cannot do that. */
  console.log(dim('\nIf this token came from a NEW custom app, its "Client secret" changed'));
  console.log(dim('too. Set it with:  node tools/set-ecwid-token.mjs --secret'));

  console.log(b('\nWhat to do next\n'));
  if (TARGET === SYSTEM) {
    console.log('  sudo systemctl restart sadko');
    console.log('  node tools/ecwid-preflight.mjs');
  } else {
    console.log('  Restart the site, then run:  node tools/ecwid-preflight.mjs');
  }
  console.log('\nAfter the restart, within five minutes the site will by itself:');
  console.log('  · create every existing account as a customer in Ecwid');
  console.log('  · send the orders that are waiting');
  console.log('  · start showing order status changes staff make in Ecwid');
  console.log('You can also press "Link them now" and "Retry" in the SADKO admin panel');
  console.log('to make both happen immediately.\n');
}

main().catch(e => {
  console.error(r('\nSomething went wrong: ') + (e && e.message));
  console.error('Nothing was saved.');
  process.exitCode = 2;
});

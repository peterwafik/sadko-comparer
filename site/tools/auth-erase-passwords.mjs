/* ============================================================================
   Erase every stored password from this server, permanently.

     node tools/auth-erase-passwords.mjs            what it would do
     node tools/auth-erase-passwords.mjs --erase    actually do it

   WHY. Ecwid has no API that verifies a password, so sign-in cannot be
   delegated to it. The only way this server stops holding credentials is to
   stop having them: SADKO_AUTH_PASSWORDLESS=1 closes the password routes, and
   this removes the hashes those routes left behind. After it runs, a stolen
   copy of accounts.db contains no credential material of any kind.

   IRREVERSIBLE. A scrypt hash cannot be recovered. Every customer who signed
   in with a password will be able to sign in ONLY through a provider
   afterwards — and only if the email on their provider account matches the one
   here, which is how accounts.signInWithIdentity links them.

   So the order of operations matters:

     1. Configure GOOGLE_CLIENT_ID and confirm sign-in works.
     2. Set SADKO_AUTH_PASSWORDLESS=1 and restart. The server refuses to start
        if no provider is configured, so step 1 cannot be skipped.
     3. Give customers who used a password a chance to sign in with Google at
        least once — it links by verified email automatically.
     4. Only then run this.

   It prints no email addresses. Counts only.
   ========================================================================== */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const FILE = process.argv.find(a => a.startsWith('--db='))?.slice(5)
  || path.join(import.meta.dirname, '..', 'data', 'accounts.db');
const DO_IT = process.argv.includes('--erase');

if (!existsSync(FILE)) {
  console.error(`No accounts database at ${FILE}`);
  console.error('Pass --db=<path> if it lives somewhere else.');
  process.exit(2);
}

const db = new DatabaseSync(FILE);

/* A credential is present if EITHER column is set: a row with a salt and no
   hash is useless for signing in but is still credential material, and the
   point is to leave none behind. */
const q = sql => db.prepare(sql).get();
const total = q('SELECT COUNT(*) c FROM users').c;
const withPw = q('SELECT COUNT(*) c FROM users WHERE salt IS NOT NULL OR hash IS NOT NULL').c;
const withIdent = q(
  'SELECT COUNT(DISTINCT u.id) c FROM users u JOIN identities i ON i.user_id = u.id').c;

/* The population this is dangerous for: a password and no provider linked.
   After the erase they have no way in at all until they sign in with Google
   using the same email — which they cannot be told to do retroactively. */
const strandedRow = q(
  'SELECT COUNT(*) c FROM users u WHERE (u.salt IS NOT NULL OR u.hash IS NOT NULL) ' +
  'AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id)');
const stranded = strandedRow.c;

console.log(`accounts database: ${FILE}`);
console.log(`  users                      ${total}`);
console.log(`  holding a password         ${withPw}`);
console.log(`  with a provider linked     ${withIdent}`);
console.log(`  password and NO provider   ${stranded}`);

if (!withPw) {
  console.log('\nNothing to erase — this server already holds no passwords.');
  db.close();
  process.exit(0);
}

if (stranded) {
  console.log(`\n⚠  ${stranded} account(s) have a password and no linked provider.`);
  console.log('   Erasing now leaves them with no way to sign in until they use');
  console.log('   Google with the SAME email address, which links automatically.');
  console.log('   Consider emailing them first, or accept it deliberately.');
}

if (!DO_IT) {
  console.log(`\nDry run. Re-run with --erase to clear ${withPw} credential(s).`);
  db.close();
  process.exit(0);
}

db.exec('BEGIN');
try {
  db.prepare('UPDATE users SET salt = NULL, hash = NULL WHERE salt IS NOT NULL OR hash IS NOT NULL').run();
  /* Every password-derived session goes too. Leaving them valid would mean a
     cookie minted by a credential that no longer exists still opens the door. */
  const sessions = q('SELECT COUNT(*) c FROM sessions').c;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM login_fails').run();
  db.exec('COMMIT');
  console.log(`\nErased ${withPw} credential(s). Signed out ${sessions} session(s).`);
  console.log('VACUUM to reclaim the pages the old values sat in:');
  console.log(`  sqlite3 ${FILE} "VACUUM;"`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFailed, nothing changed: ' + (e && e.message));
  process.exitCode = 1;
}
db.close();

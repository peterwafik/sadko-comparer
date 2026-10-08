/* Vercel function: the whole site API, the live catalogue JSON and the
   category pages (see the rewrites in ../vercel.json). It is the same request
   handler the local server listens with, so behaviour cannot drift between
   the two. Background work a long-running server did on timers (catching up
   with Ecwid, retrying unsent orders) is started after the response instead,
   and waitUntil keeps the function alive until it finishes. */
import { waitUntil } from '@vercel/functions';
import { handle, afterResponse } from '../compare-server.mjs';

export default async function sadko(req, res) {
  await handle(req, res);
  const job = afterResponse();
  if (job) waitUntil(job.catch(e => console.error('[after] ', e && e.message || e)));
}

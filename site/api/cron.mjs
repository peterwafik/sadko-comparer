/* Vercel cron (once a day on Hobby; see "crons" in ../vercel.json): a full
   Ecwid sync and reconcile, every parked order and customer push retried, and
   expired sessions swept. Vercel calls it with the project's CRON_SECRET as a
   bearer token; anything else is refused, so a stranger cannot trigger a sync. */
import { maintenance } from '../compare-server.mjs';

export default async function cron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) {
    res.statusCode = 401;
    return res.end('unauthorized');
  }
  const report = await maintenance({ full: true });
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(report));
}

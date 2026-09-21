/* ============================================================================
   Webhook verification. This route is PUBLIC, so it is the one place an
   attacker can reach the sync machinery.

   THE SIGNATURE SCHEME IS UNUSUAL AND EASY TO GET WRONG. Ecwid does NOT sign
   the request body. It signs the string

       `${eventCreated}.${eventId}`

   with HMAC-SHA256 keyed on the app's CLIENT SECRET (not an access token),
   base64-encoded, delivered in the `X-Ecwid-Webhook-Signature` header. This is
   per Ecwid's own documentation and is pinned by a test. An earlier draft of
   the design assumed the raw body, which would have produced verification that
   never validates — every delivery rejected, silently.

   WHAT THE SIGNATURE DOES NOT COVER, and why it matters. Because only
   eventCreated and eventId are signed, a valid signature proves "Ecwid sent
   this", not "this is about your store" or "this concerns that entity". An
   observed signature could be replayed with a different storeId, entityId or
   eventType. Two things contain that:

     · the route checks storeId against our own configured store
     · the sync RE-FETCHES the entity instead of trusting the payload, so a
       forged entityId can only make us re-read our own data and converge on
       its true state — a wasted API call, never a corruption

   Rules: compare in constant time, and treat a missing secret as REJECT. A
   misconfigured server must be closed, not open.
   ========================================================================== */

import { createHmac, timingSafeEqual } from 'node:crypto';

/* Exported so a test can compute the expected value independently, and so an
   operator can reproduce a signature by hand when diagnosing a rejection. */
export function signatureFor(eventCreated, eventId, secret) {
  return createHmac('sha256', String(secret))
    .update(`${eventCreated}.${eventId}`)
    .digest('base64');
}

export function verifyWebhook({ event, signature, secret }) {
  if (!secret || !signature) return false;
  if (!event || event.eventId == null || event.eventCreated == null) return false;

  const expected = Buffer.from(signatureFor(event.eventCreated, event.eventId, secret), 'base64');

  let given;
  try { given = Buffer.from(String(signature), 'base64'); } catch { return false; }
  /* A base64 decode of junk does not throw, it just yields the wrong bytes —
     so the length guard is what actually catches it, and it must come before
     timingSafeEqual, which throws on a length mismatch. */
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/* The documented body: eventId, eventCreated, storeId, entityId, eventType,
   data. `event` is carried through untouched so verification signs exactly the
   values that arrived, rather than anything this function normalised. */
export function parseWebhook(rawBody) {
  let d;
  try { d = JSON.parse(rawBody); } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  if (d.eventId == null || d.eventCreated == null) return null;   // unverifiable
  if (d.entityId == null || !d.eventType) return null;            // unactionable
  return {
    event: d,
    eventId: String(d.eventId),
    eventCreated: d.eventCreated,
    storeId: d.storeId != null ? String(d.storeId) : null,
    entityId: String(d.entityId),
    eventType: String(d.eventType),
  };
}

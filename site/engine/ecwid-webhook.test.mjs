// site/engine/ecwid-webhook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, parseWebhook, signatureFor } from './ecwid-webhook.mjs';

const SECRET = 'client-secret-abc';

/* Ecwid signs "{eventCreated}.{eventId}" — NOT the request body. Verified
   against Ecwid's own documentation; an earlier draft of the design said the
   raw body, which would have produced verification that never validates. */
const sign = (eventCreated, eventId, secret = SECRET) =>
  createHmac('sha256', secret).update(`${eventCreated}.${eventId}`).digest('base64');

const EV = (over = {}) => ({
  eventId: 'evt-1', eventCreated: 1758480000, storeId: 142682751,
  entityId: 865565594, eventType: 'product.updated', data: {}, ...over,
});
const body = (over = {}) => JSON.stringify(EV(over));

/* ------------------------------ signature ------------------------------- */

test('signatureFor matches an independently computed HMAC', () => {
  assert.equal(signatureFor(1758480000, 'evt-1', SECRET), sign(1758480000, 'evt-1'));
});

test('the signature is over eventCreated.eventId, NOT the body', () => {
  /* Two payloads differing only in entityId share a signature, because Ecwid
     does not sign the body. Pinning this stops anyone "fixing" the
     implementation to hash the body, which would break every delivery. */
  const a = signatureFor(1758480000, 'evt-1', SECRET);
  const ev1 = EV({ entityId: 1 }), ev2 = EV({ entityId: 2 });
  assert.equal(verifyWebhook({ event: ev1, signature: a, secret: SECRET }), true);
  assert.equal(verifyWebhook({ event: ev2, signature: a, secret: SECRET }), true);
});

test('a correctly signed event verifies', () => {
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: sign(ev.eventCreated, ev.eventId), secret: SECRET }), true);
});

test('a tampered eventId does not verify', () => {
  const ev = EV();
  const sig = sign(ev.eventCreated, ev.eventId);
  assert.equal(verifyWebhook({ event: { ...ev, eventId: 'evt-2' }, signature: sig, secret: SECRET }), false);
});

test('a tampered eventCreated does not verify', () => {
  const ev = EV();
  const sig = sign(ev.eventCreated, ev.eventId);
  assert.equal(verifyWebhook({ event: { ...ev, eventCreated: 1 }, signature: sig, secret: SECRET }), false);
});

test('a wrong secret does not verify', () => {
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: sign(ev.eventCreated, ev.eventId, 'other'), secret: SECRET }), false);
});

test('an absent signature does not verify', () => {
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: '', secret: SECRET }), false);
  assert.equal(verifyWebhook({ event: ev, signature: undefined, secret: SECRET }), false);
});

test('an absent secret NEVER verifies — an unconfigured server must be closed', () => {
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: sign(ev.eventCreated, ev.eventId), secret: '' }), false);
  assert.equal(verifyWebhook({ event: ev, signature: sign(ev.eventCreated, ev.eventId), secret: undefined }), false);
});

test('a signature of the wrong length is rejected without throwing', () => {
  /* timingSafeEqual throws on a length mismatch, so the guard must come first. */
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: 'short', secret: SECRET }), false);
});

test('a non-base64 signature is rejected without throwing', () => {
  const ev = EV();
  assert.equal(verifyWebhook({ event: ev, signature: '!!!not base64!!!', secret: SECRET }), false);
});

test('a missing event object is rejected', () => {
  assert.equal(verifyWebhook({ event: null, signature: 'x', secret: SECRET }), false);
  assert.equal(verifyWebhook({ event: {}, signature: 'x', secret: SECRET }), false);
});

/* -------------------------------- parsing ------------------------------- */

test('parseWebhook pulls every field Ecwid documents', () => {
  const p = parseWebhook(body());
  assert.equal(p.eventId, 'evt-1');
  assert.equal(p.eventCreated, 1758480000);
  assert.equal(p.storeId, '142682751');
  assert.equal(p.entityId, '865565594');
  assert.equal(p.eventType, 'product.updated');
});

test('parseWebhook returns null on malformed JSON rather than throwing', () => {
  assert.equal(parseWebhook('not json'), null);
  assert.equal(parseWebhook(''), null);
});

test('parseWebhook returns null when the identifying fields are absent', () => {
  assert.equal(parseWebhook(JSON.stringify({ eventType: 'product.updated' })), null);
  assert.equal(parseWebhook(JSON.stringify({ eventId: 'e', eventCreated: 1 })), null);
});

test('the raw event is kept so verification can use the original values', () => {
  const p = parseWebhook(body());
  assert.equal(p.event.eventId, 'evt-1');
  assert.equal(p.event.eventCreated, 1758480000);
});

test('an order event parses the same way', () => {
  const p = parseWebhook(body({ eventType: 'order.updated', entityId: 12 }));
  assert.equal(p.eventType, 'order.updated');
  assert.equal(p.entityId, '12');
});

/* ------------------------- the store-id guard --------------------------- */

test('a signed event for a DIFFERENT store is detectable', () => {
  /* Ecwid's signature covers only eventCreated and eventId — not storeId,
     entityId or eventType. So a valid signature says "this came from Ecwid",
     not "this is about your store". The route must check storeId itself.
     Our re-fetch design already limits the damage: a forged entityId only
     makes us re-read that entity from OUR store and converge on its real
     state. But there is no reason to act on another store's event at all. */
  const p = parseWebhook(body({ storeId: 999999 }));
  assert.equal(p.storeId, '999999');
  assert.notEqual(p.storeId, '142682751');
});

/* ============================================================================
   The guest "Track an order" lookup.

   Guest details are deleted from this server once Ecwid has the order, so the
   lookup asks Ecwid, and answers with status and tracking ONLY — never a name,
   an address or the items. Both the order number and the phone must match.
   ========================================================================== */
import { toLocalStatus } from './ecwid-map.mjs';
import { trackingOf } from './ecwid-customers.mjs';

const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);

/* +201027890565, 01027890565 and "0102 789 0565" are the same phone. */
export function phoneMatches(a, b) {
  const x = last10(a), y = last10(b);
  return x.length === 10 && x === y;
}

export function publicStatus(remote) {
  return { ref: String(remote.externalOrderId || ''), status: toLocalStatus(remote) || 'received',
           tracking: trackingOf(remote) };
}

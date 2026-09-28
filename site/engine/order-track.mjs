/* ============================================================================
   The guest "Track an order" lookup.

   Guest details are deleted from this server once Ecwid has the order, so the
   lookup asks Ecwid, and answers with status and tracking ONLY — never a name,
   an address or the items. Both the order number and the phone must match.
   ========================================================================== */
import { toLocalStatus } from './ecwid-map.mjs';
import { trackingOf } from './ecwid-customers.mjs';

/* Arabic-Indic (٠-٩) and Persian (۰-۹) digits become ASCII first: a phone typed
   on an Arabic keyboard is the same number, and \D alone would erase it. */
const ascii = s => String(s || '')
  .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
const last10 = p => ascii(p).replace(/\D/g, '').slice(-10);

/* +201027890565, 01027890565 and "0102 789 0565" are the same phone. */
export function phoneMatches(a, b) {
  const x = last10(a), y = last10(b);
  return x.length === 10 && x === y;
}

export function publicStatus(remote) {
  return { ref: String(remote.externalOrderId || ''), status: toLocalStatus(remote) || 'received',
           tracking: trackingOf(remote) };
}

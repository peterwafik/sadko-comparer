/* Offer-sanity gate, shared by the crawler's extractor and the live adapters in
   compare-server.mjs. A harvested "item" is only an OFFER if it points at a real
   product page and is not storefront chrome. */

export const UI_TITLE = /^(?:إضافة إلى السلة|أضف إلى السلة|اضف للسلة|أضف للسلة|اضف الى السلة|اشتر(?:ى|ي) الآن|عرض المنتج|عرض التفاصيل|اقرأ المزيد|اقرا المزيد|التفاصيل|قارن|المفضلة|السلة|add to cart|add to basket|buy now|read more|view (?:product|details|more)|compare|wishlist|quick view|select options|show details)\s*$/i;

export const BAD_URL = /[?&](?:add-to-cart|add_to_cart|remove_item|s)=|\/(?:cart|checkout|wishlist|compare|my-account|account|login|register)(?:\/|$|\?)/i;

export function parsePrice(x) {
  if (typeof x === 'number') return x >= 100 && x <= 2e6 ? Math.round(x) : 0;
  const t = String(x ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\s,]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '');
  const v = parseFloat(t.replace(/[^\d.]/g, ''));
  return v >= 100 && v <= 2e6 ? Math.round(v) : 0;
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isProductOffer(o) {
  if (!o || !o.price || !o.url) return false;
  const title = String(o.title || '').trim();
  if (title.length < 8 || UI_TITLE.test(title)) return false;
  let u; try { u = new URL(o.url); } catch { return false; }
  // href="#" and bare-domain links resolve to the site root — navigation, not a
  // product; an offer the customer cannot click is worse than no offer
  if (!u.pathname || u.pathname === '/') return false;
  if (BAD_URL.test(u.href)) return false;
  return true;
}

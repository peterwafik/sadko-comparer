/* robots.txt parsing and fetching. The crawler MUST route every URL through
   allowed() and MUST wait crawlDelay between requests to the same host. */
export const CRAWLER_UA =
  'Mozilla/5.0 (compatible; SADKO-price-comparer/1.0; +https://sadko-group.com/bot)';

export function parseRobots(text, ua = '*') {
  const lines = String(text || '').split(/\r?\n/);
  const sitemaps = [];
  const groups = new Map();       // ua -> {disallow:[], allow:[], delay:null}
  let current = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();

    if (key === 'sitemap') { sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      const name = val.toLowerCase();
      if (!groups.has(name)) groups.set(name, { disallow: [], allow: [], delay: null });
      current = [groups.get(name)];
      continue;
    }
    for (const g of current) {
      if (key === 'disallow' && val) g.disallow.push(val);
      else if (key === 'allow' && val) g.allow.push(val);
      else if (key === 'crawl-delay') g.delay = parseFloat(val) || null;
    }
  }

  const g = groups.get(ua.toLowerCase()) || groups.get('*') || { disallow: [], allow: [], delay: null };
  const match = (rules, path) => rules.some(r => {
    const pat = r.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pat).test(path);
  });

  return {
    crawlDelay: g.delay,
    sitemaps,
    allowed: path => match(g.allow, path) ? true : !match(g.disallow, path),
  };
}

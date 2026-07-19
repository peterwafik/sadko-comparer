/* robots.txt parsing and fetching. The crawler MUST route every URL through
   allowed() and MUST wait crawlDelay between requests to the same host. */
export const CRAWLER_UA =
  'Mozilla/5.0 (compatible; SADKO-price-comparer/1.0; +https://sadko-group.com/bot)';

// Compiles a robots.txt pattern into a matcher. Only `*` (wildcard) and a
// trailing `$` (end-of-path anchor) are special; every other character,
// including regex metacharacters like `?`, `.`, `(`, is matched literally.
function compilePattern(pattern) {
  let body = pattern;
  let anchored = false;
  if (body.endsWith('$')) {
    anchored = true;
    body = body.slice(0, -1);
  }
  const escaped = body
    .split('*')
    .map(seg => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return {
    pattern,
    length: pattern.length,
    regex: new RegExp('^' + escaped + (anchored ? '$' : '')),
  };
}

export function parseRobots(text, ua = '*') {
  const lines = String(text || '').split(/\r?\n/);
  const sitemaps = [];
  const groups = new Map();       // ua -> {disallow:[], allow:[], delay:null}
  let current = [];
  // True once a non-user-agent directive has been seen since the last
  // User-agent line; consecutive User-agent lines (no rules between them)
  // accumulate into the same group set per RFC 9309.
  let boundary = true;

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
      if (boundary) current = [];
      current.push(groups.get(name));
      boundary = false;
      continue;
    }
    boundary = true;
    for (const g of current) {
      if (key === 'disallow' && val) g.disallow.push(val);
      else if (key === 'allow' && val) g.allow.push(val);
      else if (key === 'crawl-delay') g.delay = parseFloat(val) || null;
    }
  }

  const g = groups.get(ua.toLowerCase()) || groups.get('*') || { disallow: [], allow: [], delay: null };
  const allowRules = g.allow.map(compilePattern);
  const disallowRules = g.disallow.map(compilePattern);

  // Longest matching pattern wins (RFC 9309 specificity rule); Allow wins ties.
  const longestMatch = (rules, path) =>
    rules.reduce((best, r) => (r.regex.test(path) && r.length > best ? r.length : best), -1);

  return {
    crawlDelay: g.delay,
    sitemaps,
    // Contract: path should be an absolute path (leading '/'), e.g.
    // new URL(url).pathname. A path without a leading '/' will match no
    // rule and is therefore always allowed.
    allowed: path => longestMatch(disallowRules, path) > longestMatch(allowRules, path) ? false : true,
  };
}

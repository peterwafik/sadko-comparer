// site/engine/tools-helpers.test.mjs
//
// set-ecwid-token.mjs saved the production token, then called an undefined
// colour helper `dim` while printing its hints — and its catch-all told the
// operator "Nothing was saved." after a successful save. The tools run on the
// VM by hand, where a crash like that is only ever found live. So: every helper
// a tool wraps console output in must be defined in that tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TOOLS = path.join(import.meta.dirname, '..', 'tools');

test('every helper a tool wraps its output in is defined in that tool', () => {
  for (const f of readdirSync(TOOLS).filter(f => f.endsWith('.mjs'))) {
    const src = readFileSync(path.join(TOOLS, f), 'utf8');
    const used = new Set([...src.matchAll(/console\.(?:log|error|warn)\(\s*([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]));
    for (const name of used) {
      const defined = new RegExp(String.raw`(?:const|let|var|function)\s+${name}\b|import\s*\{[^}]*\b${name}\b`).test(src);
      assert.ok(defined, `${f} calls ${name}(...) inside console output but never defines it`);
    }
  }
});

test('set-ecwid-token never claims "Nothing was saved" after it has saved', () => {
  const src = readFileSync(path.join(TOOLS, 'set-ecwid-token.mjs'), 'utf8');
  const tail = src.slice(src.lastIndexOf('main().catch'));
  assert.ok(!/console\.error\('Nothing was saved\.'\)/.test(tail),
    'the catch-all must say whether the token was already saved, not always "Nothing was saved."');
});

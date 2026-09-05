// product.js is a browser IIFE, so this is a source-level guard rather than a
// behavioural test: every id that wire() looks up must still be produced by the
// render path. Renaming one in head() would otherwise fail silently in the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/product.js', import.meta.url), 'utf8');

const REQUIRED_IDS = ['btnSave', 'qaForm', 'guidesBox'];

test('every id wire() depends on is still emitted by the render path', () => {
  for (const id of REQUIRED_IDS) {
    assert.ok(src.includes("id=\"" + id + "\"") || src.includes("id='" + id + "'"),
      'render path no longer emits id ' + id);
  }
});

test('the section functions the PDP relies on all still exist', () => {
  for (const fn of ['suitability', 'spaceCheck', 'goodToKnow', 'energyPanel',
                    'specsPanel', 'reviewsPanel', 'qaPanel', 'guides', 'wire']) {
    assert.match(src, new RegExp('function\\s+' + fn + '\\s*\\('), 'missing ' + fn);
  }
});

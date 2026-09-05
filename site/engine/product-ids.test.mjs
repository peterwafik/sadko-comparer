// product.js is a browser IIFE, so this is a source-level guard rather than a
// behavioural test: every id that wire() looks up must still be produced by the
// render path, and render() must still hand off to wire() and guides() once the
// markup exists. Renaming an id, or dropping either call, would otherwise fail
// silently in the UI — nothing throws, the button/form/box just never wires up.
//
// To make the guard mean something (rather than a whole-file grep that would
// also pass if render() rendered nothing at all), each check is scoped to the
// specific function body that is supposed to produce it, using a brace-counting
// extractor. product.js has no object/array literal braces embedded inside its
// HTML string literals (verified by inspection), so counting `{`/`}` from a
// function's opening brace to its matching close is a reliable boundary here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/product.js', import.meta.url), 'utf8');

function functionBody(source, name) {
  const head = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*{');
  const m = head.exec(source);
  assert.ok(m, 'function ' + name + ' not found in source');
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0) {
    assert.ok(i < source.length, 'unbalanced braces while scanning ' + name + '()');
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

const renderBody = functionBody(src, 'render');
const headBody = functionBody(src, 'head');
const qaPanelBody = functionBody(src, 'qaPanel');

function hasId(body, id) {
  return body.includes('id="' + id + '"') || body.includes("id='" + id + "'");
}

test('head() still emits id="btnSave" (wire() binds the save toggle to it)', () => {
  assert.ok(hasId(headBody, 'btnSave'), 'head() no longer emits id btnSave');
});

test('qaPanel() still emits id="qaForm" (wire() binds the Q&A submit handler to it)', () => {
  assert.ok(hasId(qaPanelBody, 'qaForm'), 'qaPanel() no longer emits id qaForm');
});

test('render() still emits an empty id="guidesBox" container for guides() to fill', () => {
  assert.ok(hasId(renderBody, 'guidesBox'), 'render() no longer emits id guidesBox');
});

test('render() still invokes wire(...) and guides(...) after building the markup', () => {
  assert.match(renderBody, /\bwire\s*\(/, 'render() no longer calls wire()');
  assert.match(renderBody, /\bguides\s*\(/, 'render() no longer calls guides()');
});

test('render() calls head(...) and qaPanel(...) so their ids actually reach the page', () => {
  assert.match(renderBody, /\bhead\s*\(/, 'render() no longer calls head()');
  assert.match(renderBody, /\bqaPanel\s*\(/, 'render() no longer calls qaPanel()');
});

test('the section functions the PDP relies on all still exist', () => {
  for (const fn of ['suitability', 'spaceCheck', 'goodToKnow', 'energyPanel',
                    'specsPanel', 'reviewsPanel', 'qaPanel', 'guides', 'wire']) {
    assert.match(src, new RegExp('function\\s+' + fn + '\\s*\\('), 'missing ' + fn);
  }
});

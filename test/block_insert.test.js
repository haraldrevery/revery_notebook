'use strict';

/* Unit tests for the pure paragraph inserter (src/sidebar/block_insert.js)
   behind live-preview media drops: the inserted block always ends up as
   its own paragraph — one blank line on each side, never glued onto the
   neighbouring text, never an extra blank line where one already exists —
   and the cursor lands on the blank line after it. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', 'block_insert.js')).href;
const IMG = '![pic.png](pic.png)';

/* Apply the insertion at `pos` of `doc`; returns the new text and the
   text of the line the cursor lands on. */
async function apply(doc, pos, block = IMG) {
  const { paragraphInsertion } = await import(MOD_URL);
  const { insert, cursor } = paragraphInsertion(doc.slice(Math.max(0, pos - 2), pos), doc.slice(pos, pos + 2), block);
  const text = doc.slice(0, pos) + insert + doc.slice(pos);
  const at = pos + cursor;
  assert.ok(at >= 0 && at <= text.length, 'cursor inside the new document');
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = text.indexOf('\n', at);
  return { text, cursorLine: text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd), atLineStart: lineStart === at };
}

test('after a line followed by a blank line: reuses the blank line after', async () => {
  const doc = 'para one\n\nnext';
  const r = await apply(doc, doc.indexOf('\n'));
  assert.equal(r.text, `para one\n\n${IMG}\n\nnext`);
  assert.equal(r.cursorLine, '');
  assert.ok(r.atLineStart);
});

test('after a line directly followed by text (soft break / list item): blank lines on both sides', async () => {
  const doc = '- alpha\n- beta';
  const r = await apply(doc, doc.indexOf('\n'));
  assert.equal(r.text, `- alpha\n\n${IMG}\n\n- beta`);
  assert.equal(r.cursorLine, '');
});

test('on a blank line between blocks: no doubled blank lines', async () => {
  const doc = 'above\n\nbelow';
  const r = await apply(doc, doc.indexOf('\n') + 1); // the blank line (from == to)
  assert.equal(r.text, `above\n\n${IMG}\n\nbelow`);
  assert.equal(r.cursorLine, '');
});

test('at the end of the document: a trailing newline, cursor on the new last line', async () => {
  const doc = 'last line';
  const r = await apply(doc, doc.length);
  assert.equal(r.text, `last line\n\n${IMG}\n`);
  assert.equal(r.cursorLine, '');
});

test('at the end of a document that already ends with a newline', async () => {
  const doc = 'last line\n';
  const r = await apply(doc, doc.indexOf('\n'));
  assert.equal(r.text, `last line\n\n${IMG}\n\n`);
  assert.equal(r.cursorLine, '');
});

test('at the start of the document: no leading blank line', async () => {
  const doc = '\n\nfirst';
  const r = await apply(doc, 0);
  assert.equal(r.text, `${IMG}\n\nfirst`);
  assert.equal(r.cursorLine, '');
});

test('after a line that already has TWO blank lines after it: nothing added after', async () => {
  const doc = 'text\n\n\nmore';
  const r = await apply(doc, doc.indexOf('\n'));
  assert.equal(r.text, `text\n\n${IMG}\n\n\nmore`);
  assert.equal(r.cursorLine, '');
});

test('a mid-line point (stale position) still never glues onto text', async () => {
  const doc = 'glued text';
  const r = await apply(doc, 5);
  assert.equal(r.text, `glued\n\n${IMG}\n\n text`);
  assert.equal(r.cursorLine, '');
});

test('multi-line block (several media links) stays one paragraph', async () => {
  const doc = 'a\n\nb';
  const block = `${IMG}\n![two.png](two.png)`;
  const r = await apply(doc, 1, block);
  assert.equal(r.text, `a\n\n${block}\n\nb`);
  assert.equal(r.cursorLine, '');
});

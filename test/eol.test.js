'use strict';

/* Line-ending rules (src/sidebar/eol.js). The editor always holds '\n';
   a file keeps CRLF on save only when it was purely CRLF. Anything else
   (LF, mixed, old-Mac lone CR) is written as LF — the previous behaviour —
   so these tests pin exactly when the file's own style is preserved. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/sidebar/eol.js');

test('detectEol: pure CRLF (incl. BOM, trailing and leading breaks) is CRLF', async () => {
  const { detectEol } = await load();
  assert.equal(detectEol('a\r\nb\r\n'), '\r\n');
  assert.equal(detectEol('﻿# T\r\nx'), '\r\n');
  assert.equal(detectEol('\r\n'), '\r\n');
  assert.equal(detectEol('\r\n\r\nlast'), '\r\n');
});

test('detectEol: LF, mixed, lone CR, no breaks and non-strings are LF', async () => {
  const { detectEol } = await load();
  assert.equal(detectEol('a\nb\n'), '\n');
  assert.equal(detectEol('a\r\nb\nc'), '\n', 'mixed → LF');
  assert.equal(detectEol('\na\r\n'), '\n', 'a leading bare LF makes it mixed');
  assert.equal(detectEol('a\r\nb\rc'), '\n', 'a lone CR makes it mixed');
  assert.equal(detectEol('a\rb\r'), '\n', 'old-Mac CR only');
  assert.equal(detectEol('single line'), '\n');
  assert.equal(detectEol(''), '\n');
  assert.equal(detectEol(null), '\n');
});

test('normalizeEol matches what the editor holds', async () => {
  const { normalizeEol } = await load();
  assert.equal(normalizeEol('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(normalizeEol('﻿x\r\n'), '﻿x\n', 'BOM untouched');
  assert.equal(normalizeEol(undefined), undefined);
});

test('toDiskText round-trips a pure CRLF file byte for byte', async () => {
  const { detectEol, normalizeEol, toDiskText } = await load();
  const disk = '﻿# Titel åäö\r\n\r\nrad två\r\n';
  const editorText = normalizeEol(disk);
  assert.equal(toDiskText(editorText, detectEol(disk)), disk);
  assert.equal(toDiskText('a\nb', '\n'), 'a\nb', 'LF files are written unchanged');
});

'use strict';

/* The import decoder (src/sidebar/import_text.js): an imported file becomes
   text only when that is lossless — the import used to decode lossily and
   silently replace every non-UTF-8 byte with U+FFFD. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', 'import_text.js')).href;
const load = () => import(MOD_URL);

const utf16 = (s, le) => {
  const out = [le ? 0xFF : 0xFE, le ? 0xFE : 0xFF];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (le) out.push(c & 0xFF, c >> 8); else out.push(c >> 8, c & 0xFF);
  }
  return new Uint8Array(out);
};

test('UTF-8 is decoded exactly; a leading BOM is kept (the backends keep it too)', async () => {
  const { decodeImportedText } = await load();
  const text = '# Notes 📝\nÜnïcode — 测试\r\nlast line';
  assert.equal(decodeImportedText(Buffer.from(text, 'utf8')), text);
  assert.equal(decodeImportedText(Buffer.from('﻿with BOM', 'utf8')), '﻿with BOM');
  assert.equal(decodeImportedText(new Uint8Array(0)), '');
  // A plain ArrayBuffer (what File.arrayBuffer() gives) decodes the same.
  assert.equal(decodeImportedText(new Uint8Array(Buffer.from('plain ✓', 'utf8')).buffer), 'plain ✓');
});

test('UTF-16 with a byte-order mark is converted (without carrying the BOM)', async () => {
  const { decodeImportedText } = await load();
  const text = 'Café 📝 note\r\n';
  assert.equal(decodeImportedText(utf16(text, true)), text);
  assert.equal(decodeImportedText(utf16(text, false)), text);
});

test('anything that would not decode losslessly is refused', async () => {
  const { decodeImportedText } = await load();
  // Windows-1252 "café" and "naïve": 0xE9 / 0xEF are not valid UTF-8 here.
  assert.throws(() => decodeImportedText(new Uint8Array([0x63, 0x61, 0x66, 0xE9])));
  assert.throws(() => decodeImportedText(new Uint8Array([0x6E, 0x61, 0xEF, 0x76, 0x65])));
  // UTF-16 with an unpaired surrogate, and with an odd byte count.
  assert.throws(() => decodeImportedText(new Uint8Array([0xFF, 0xFE, 0x3D, 0xD8, 0x41, 0x00])));
  assert.throws(() => decodeImportedText(new Uint8Array([0xFF, 0xFE, 0x41, 0x00, 0x42])));
  // A UTF-32LE BOM starts like UTF-16LE's; it must not be read as UTF-16.
  assert.throws(() => decodeImportedText(new Uint8Array([0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00])));
});

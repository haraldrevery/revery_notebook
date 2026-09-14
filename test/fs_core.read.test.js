'use strict';

/* Strict UTF-8 reads (electron/fs_core.js readUtf8TextStrict).
   The editor only understands UTF-8. A lossy decode turns every byte it
   cannot map into U+FFFD, and the next autosave would write that back —
   destroying the original text of any legacy-encoded file. These tests pin
   the contract: valid UTF-8 (BOM and CRLF included) round-trips byte for
   byte; anything else is refused and the file is never touched. The Rust
   twin is read_text_strict in tauri/src/main.rs (same message). */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readUtf8TextStrict, atomicWriteFile, NOT_UTF8_MESSAGE } = require('../electron/fs_core.js');

describe('readUtf8TextStrict', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-read-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const put = (name, bytes) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, bytes);
    return p;
  };

  const isNotUtf8 = (err) => err.code === 'EREVERY_NOT_UTF8' && err.message === NOT_UTF8_MESSAGE;

  test('valid UTF-8 with Swedish letters and emoji decodes unchanged', () => {
    const text = '# Anteckning åäö ÅÄÖ 📝\n\nrad två\n';
    const p = put('ok.md', Buffer.from(text, 'utf8'));
    assert.equal(readUtf8TextStrict(p), text);
  });

  test('a leading BOM is kept as U+FEFF and a write-back is byte-identical', () => {
    const bytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('# Titel åäö\n', 'utf8')]);
    const p = put('bom.md', bytes);
    const text = readUtf8TextStrict(p);
    assert.equal(text.charCodeAt(0), 0xFEFF, 'BOM must not be stripped');
    atomicWriteFile(p, text);
    assert.deepEqual(fs.readFileSync(p), bytes);
  });

  test('CRLF line endings are returned verbatim', () => {
    const p = put('crlf.txt', Buffer.from('a\r\nb\r\n', 'utf8'));
    assert.equal(readUtf8TextStrict(p), 'a\r\nb\r\n');
  });

  test('an empty file reads as an empty string', () => {
    assert.equal(readUtf8TextStrict(put('empty.md', Buffer.alloc(0))), '');
  });

  test('Windows-1252 text is refused and the file is left untouched', () => {
    const bytes = Buffer.from([0x48, 0xE5, 0x6C, 0x6C, 0xF6]); // "Hållö" in cp1252
    const p = put('ansi.txt', bytes);
    assert.throws(() => readUtf8TextStrict(p), isNotUtf8);
    assert.deepEqual(fs.readFileSync(p), bytes);
  });

  test('UTF-16 LE (Notepad "Unicode") is refused', () => {
    const p = put('utf16.txt', Buffer.from([0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00]));
    assert.throws(() => readUtf8TextStrict(p), isNotUtf8);
  });

  test('a missing file throws the OS error, not the encoding error', () => {
    assert.throws(() => readUtf8TextStrict(path.join(dir, 'nope.md')), (err) => err.code === 'ENOENT');
  });
});

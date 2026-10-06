'use strict';

/* electron/spellcheck.js — the pure parts. Which bundled spell-check
   languages the system's preferences turn on, and how the bundled
   dictionaries reach the profile (end-to-end: spellcheck_offline_e2e). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BUNDLED_DICTIONARIES, spellCheckLanguages, installBundledDictionaries } = require('../electron/spellcheck.js');

const SRC = path.join(__dirname, '..', 'electron', 'dictionaries');

test('the bundled dictionaries exist and carry Chromium\'s file names', () => {
  assert.deepEqual(BUNDLED_DICTIONARIES.map((d) => d.lang), ['en-US', 'sv-SE']);
  for (const d of BUNDLED_DICTIONARIES) {
    assert.match(d.file, /^[a-z]{2}-[A-Z]{2}-\d+-\d+\.bdic$/);
    assert.ok(fs.statSync(path.join(SRC, d.file)).size > 100000, d.file);
  }
  for (const licence of ['LICENSE', 'COPYING', 'README.md']) {
    assert.ok(fs.existsSync(path.join(SRC, licence)), licence);
  }
});

test('languages: the system\'s preferences, in order, mapped onto the bundled ones', () => {
  assert.deepEqual(spellCheckLanguages(['sv-SE', 'en-US']), ['sv-SE', 'en-US']);
  assert.deepEqual(spellCheckLanguages(['en-GB']), ['en-US'], 'any English → the bundled English');
  assert.deepEqual(spellCheckLanguages(['sv_FI.UTF-8', 'EN']), ['sv-SE', 'en-US'], 'locale spellings and case');
  assert.deepEqual(spellCheckLanguages(['en-US', 'en', 'en-AU']), ['en-US'], 'no repeats');
  assert.deepEqual(spellCheckLanguages(['de-DE', 'fr-FR']), [], 'nothing bundled → none (spell check off)');
  assert.deepEqual(spellCheckLanguages(['de-DE', 'en-US']), ['en-US']);
  for (const bad of [undefined, null, 'en-US', 42, {}]) assert.deepEqual(spellCheckLanguages(bad), []);
});

test('install: copies the dictionaries, leaves an identical copy alone, replaces a damaged one', (t) => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-spell-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));
  const dicts = path.join(dest, 'Dictionaries'); // created on demand

  const files = BUNDLED_DICTIONARIES.map((d) => d.file);
  assert.deepEqual(installBundledDictionaries(dicts), files);
  for (const f of files) {
    assert.ok(fs.readFileSync(path.join(dicts, f)).equals(fs.readFileSync(path.join(SRC, f))), f);
  }

  /* An identical copy is not rewritten (same inode: no replace happened). */
  const ino = fs.statSync(path.join(dicts, files[0])).ino;
  installBundledDictionaries(dicts);
  assert.equal(fs.statSync(path.join(dicts, files[0])).ino, ino);

  /* A truncated copy (e.g. a crash during an earlier copy) is replaced. */
  fs.writeFileSync(path.join(dicts, files[1]), 'partial');
  installBundledDictionaries(dicts);
  assert.ok(fs.readFileSync(path.join(dicts, files[1])).equals(fs.readFileSync(path.join(SRC, files[1]))));
  assert.deepEqual(fs.readdirSync(dicts).sort(), [...files].sort(), 'no temp files left behind');
});

test('install never throws: a missing source reports nothing installed', (t) => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-spell-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(installBundledDictionaries(path.join(dest, 'D'), path.join(dest, 'no-such-dir')), []);
  } finally {
    console.warn = warn;
  }
});

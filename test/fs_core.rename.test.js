'use strict';

/* isCaseOnlyAliasOfSameFile (electron/fs_core.js) — the ONLY exception to
   "a rename never overwrites an existing destination". It must say yes
   solely for the very same file under a spelling that differs only in
   case; above all, two DIFFERENT files whose names differ only in case
   (possible on case-sensitive disks and network shares) must never be
   treated as one — the rename would overwrite the second file. The Rust
   twin is resolve_rename_target in tauri/src/main.rs. */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isCaseOnlyAliasOfSameFile } = require('../electron/fs_core.js');

describe('isCaseOnlyAliasOfSameFile', () => {
  let dir;
  let caseSensitive;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-rename-'));
    fs.writeFileSync(path.join(dir, 'Probe'), '');
    caseSensitive = !fs.existsSync(path.join(dir, 'probe'));
    fs.rmSync(path.join(dir, 'Probe'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('two different files differing only in case are NOT the same file', (t) => {
    if (!caseSensitive) return t.skip('this filesystem is case-insensitive');
    fs.writeFileSync(path.join(dir, 'Note.md'), 'one');
    fs.writeFileSync(path.join(dir, 'note.md'), 'two');
    assert.equal(isCaseOnlyAliasOfSameFile(path.join(dir, 'Note.md'), path.join(dir, 'note.md')), false);
  });

  test('the same path is the same file (a no-op rename)', () => {
    const p = path.join(dir, 'a.md');
    fs.writeFileSync(p, 'x');
    assert.equal(isCaseOnlyAliasOfSameFile(p, p), true);
  });

  test('a different name is never an alias, even of the same inode (hard link)', () => {
    const a = path.join(dir, 'a.md');
    fs.writeFileSync(a, 'x');
    const b = path.join(dir, 'b.md');
    fs.linkSync(a, b);
    assert.equal(isCaseOnlyAliasOfSameFile(a, b), false);
  });

  test('different folders, or a missing file, are never aliases', () => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'a.md'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'a.md'), 'y');
    assert.equal(isCaseOnlyAliasOfSameFile(path.join(dir, 'a.md'), path.join(dir, 'sub', 'a.md')), false);
    assert.equal(isCaseOnlyAliasOfSameFile(path.join(dir, 'a.md'), path.join(dir, 'A.md')), !caseSensitive);
    assert.equal(isCaseOnlyAliasOfSameFile(path.join(dir, 'nope.md'), path.join(dir, 'Nope.md')), false);
  });
});

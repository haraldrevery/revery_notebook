'use strict';

/* Entry-level file operations in electron/fs_core.js — what rename, move
   and "Move to Trash" act on:
     validateEntryInside — a link is the LINK, never its target;
     renameEntry         — never overwrites, never copies/deletes, refuses
                           other drives, moves links as links;
     trashableEntry      — the entry the trash receives;
     checkEntryName      — must agree with src/sidebar/paths.js.
   The Rust twins live in tauri/src/main.rs (safe_entry_inside,
   rename_node, check_entry_name) with their own unit tests. */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../electron/fs_core.js');
const { validateEntryInside, renameEntry, trashableEntry, lexists } = core;

const canSymlink = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-lnprobe-'));
  try { fs.symlinkSync('x', path.join(d, 'l')); return true; } catch (_) { return false; }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
})();

describe('entries inside the project', () => {
  let base, root;
  const p = (...s) => path.join(root, ...s);

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revery-entry-')));
    root = path.join(base, 'proj');
    fs.mkdirSync(path.join(root, 'real', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'real', 'inside.md'), 'inside');
    fs.writeFileSync(path.join(root, 'a.md'), 'a');
    fs.mkdirSync(path.join(base, 'outside'));
    fs.writeFileSync(path.join(base, 'outside', 'secret.md'), 'secret');
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  test('a plain entry is returned in canonical spelling', () => {
    assert.equal(validateEntryInside(p('a.md'), root), p('a.md'));
    assert.equal(validateEntryInside(p('sub', 'new.md'), root), p('sub', 'new.md')); // may not exist yet
  });

  test('the project root and anything outside are never entries', () => {
    assert.throws(() => validateEntryInside(root, root), /Security Error/);
    assert.throws(() => validateEntryInside(path.join(base, 'outside', 'secret.md'), root), /Security Error/);
    assert.throws(() => validateEntryInside(p('..', 'outside'), root), /Security Error/);
  });

  test('a link is the link itself — never its target', (t) => {
    if (!canSymlink) return t.skip('symlinks unavailable');
    fs.symlinkSync('real', p('link'));
    fs.symlinkSync(path.join(base, 'outside'), p('outlink'));
    assert.equal(validateEntryInside(p('link'), root), p('link'));
    // A link pointing OUTSIDE is still an entry inside the project: the
    // link can be moved or trashed without touching what it points to.
    assert.equal(validateEntryInside(p('outlink'), root), p('outlink'));
    // …but nothing BEHIND it is reachable.
    assert.throws(() => validateEntryInside(p('outlink', 'secret.md'), root), /Security Error/);
  });

  test('a root opened through a symlink resolves to the real spelling', (t) => {
    if (!canSymlink) return t.skip('symlinks unavailable');
    const alias = path.join(base, 'alias');
    fs.symlinkSync(root, alias);
    assert.equal(validateEntryInside(path.join(alias, 'a.md'), alias), p('a.md'));
  });

  test('trashableEntry: the link, not its target; null when gone', (t) => {
    assert.equal(trashableEntry(p('nope.md'), root), null);
    assert.equal(trashableEntry(p('a.md'), root), p('a.md'));
    assert.throws(() => trashableEntry(root, root), /Security Error/);
    if (!canSymlink) return t.skip('symlinks unavailable');
    fs.symlinkSync('real', p('link'));
    fs.symlinkSync('missing-target', p('dangling'));
    assert.equal(trashableEntry(p('link'), root), p('link'));
    assert.equal(trashableEntry(p('dangling'), root), p('dangling')); // exists as an entry
  });

  test('renameEntry moves a file and refuses to overwrite', async () => {
    await renameEntry(p('a.md'), p('sub', 'a.md'), root);
    assert.equal(fs.readFileSync(p('sub', 'a.md'), 'utf8'), 'a');
    fs.writeFileSync(p('b.md'), 'b');
    await assert.rejects(renameEntry(p('b.md'), p('sub', 'a.md'), root), /already exists/);
    assert.equal(fs.readFileSync(p('sub', 'a.md'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(p('b.md'), 'utf8'), 'b');
  });

  test('renameEntry never replaces a dangling link at the destination', async (t) => {
    if (!canSymlink) return t.skip('symlinks unavailable');
    fs.symlinkSync('missing-target', p('sub', 'a.md'));
    await assert.rejects(renameEntry(p('a.md'), p('sub', 'a.md'), root), /already exists/);
    assert.equal(fs.lstatSync(p('sub', 'a.md')).isSymbolicLink(), true);
  });

  test('renameEntry moves a link as a link; the target folder stays put', async (t) => {
    if (!canSymlink) return t.skip('symlinks unavailable');
    fs.symlinkSync(p('real'), p('abslink'));           // absolute link
    await renameEntry(p('abslink'), p('sub', 'abslink'), root);
    assert.equal(fs.lstatSync(p('sub', 'abslink')).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(p('real', 'inside.md'), 'utf8'), 'inside');
    assert.equal(fs.readFileSync(p('sub', 'abslink', 'inside.md'), 'utf8'), 'inside');
  });

  test('a relative link may be renamed in place but not moved to another folder', async (t) => {
    if (!canSymlink) return t.skip('symlinks unavailable');
    fs.symlinkSync('real', p('rel'));
    await assert.rejects(renameEntry(p('rel'), p('sub', 'rel'), root), /relative link/);
    assert.equal(fs.lstatSync(p('rel')).isSymbolicLink(), true);
    assert.equal(lexists(p('sub', 'rel')), false);
    await renameEntry(p('rel'), p('rel2'), root);
    assert.equal(fs.readFileSync(p('rel2', 'inside.md'), 'utf8'), 'inside');
    assert.equal(fs.readFileSync(p('real', 'inside.md'), 'utf8'), 'inside');
  });

  test('renameEntry refuses a folder into itself, the root, and bad names', async () => {
    await assert.rejects(renameEntry(p('real'), p('real', 'deep', 'real'), root), /into itself/);
    await assert.rejects(renameEntry(root, p('sub', 'x'), root), /Security Error/);
    await assert.rejects(renameEntry(p('a.md'), p('.a.md'), root), /Invalid name/);
    await assert.rejects(renameEntry(p('a.md'), p('con.md'), root), /Invalid name/);
    await assert.rejects(renameEntry(p('a.md'), p('a.md.1.revery_tmp'), root), /Invalid name/);
    assert.equal(fs.readFileSync(p('a.md'), 'utf8'), 'a');
  });

  test('a pure move keeps an existing name the rule would refuse today', async () => {
    fs.writeFileSync(p('aux.md'), 'legacy'); // possible on Linux
    await renameEntry(p('aux.md'), p('sub', 'aux.md'), root);
    assert.equal(fs.readFileSync(p('sub', 'aux.md'), 'utf8'), 'legacy');
  });

  test('another drive (EXDEV) is refused and nothing changes — no copy fallback', async () => {
    const orig = fs.promises.rename;
    fs.promises.rename = async () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
    try {
      await assert.rejects(renameEntry(p('real'), p('sub', 'real'), root), /another drive/);
    } finally { fs.promises.rename = orig; }
    assert.equal(fs.readFileSync(p('real', 'inside.md'), 'utf8'), 'inside');
    assert.equal(lexists(p('sub', 'real')), false);
  });

  test('EBUSY is NOT turned into a copy: off Windows it fails at once', async () => {
    const orig = fs.promises.rename;
    let calls = 0;
    fs.promises.rename = async () => { calls++; const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
    try {
      await assert.rejects(renameEntry(p('real'), p('sub', 'real'), root, { platform: 'linux' }), /busy/);
    } finally { fs.promises.rename = orig; }
    assert.equal(calls, 1);
    assert.equal(lexists(p('sub', 'real')), false);
    assert.equal(fs.readFileSync(p('real', 'inside.md'), 'utf8'), 'inside');
  });

  test('Windows: a transient lock is retried, then the rename happens once', async () => {
    const orig = fs.promises.rename;
    let calls = 0;
    fs.promises.rename = async (a, b) => {
      if (++calls < 3) { const e = new Error('locked'); e.code = 'EPERM'; throw e; }
      return orig(a, b);
    };
    try {
      await renameEntry(p('real'), p('sub', 'real'), root, { platform: 'win32', sleep: async () => {} });
    } finally { fs.promises.rename = orig; }
    assert.equal(calls, 3);
    assert.equal(fs.readFileSync(p('sub', 'real', 'inside.md'), 'utf8'), 'inside');
  });

  test('Windows: a destination that appears during the retry is never overwritten', async () => {
    const orig = fs.promises.rename;
    fs.promises.rename = async () => { const e = new Error('locked'); e.code = 'EBUSY'; throw e; };
    const sleep = async () => { fs.writeFileSync(p('sub', 'a.md'), 'someone else'); };
    try {
      await assert.rejects(renameEntry(p('a.md'), p('sub', 'a.md'), root, { platform: 'win32', sleep }), /already exists/);
    } finally { fs.promises.rename = orig; }
    assert.equal(fs.readFileSync(p('sub', 'a.md'), 'utf8'), 'someone else');
    assert.equal(fs.readFileSync(p('a.md'), 'utf8'), 'a');
  });
});

test('fs_core.checkEntryName agrees with the renderer rule (paths.js)', async () => {
  const { checkEntryName: rendererRule } = await import('../src/sidebar/paths.js');
  const corpus = ['notes.md', 'Meeting 26.09.2026.md', 'README', '', '  ', '.', '..', 'a/b', 'a\\b',
    'x\u0001', '.hidden', 'notes.', 'notes ', ' x', 'CON', 'aux.md', 'com¹', 'conout$',
    'nul.tar.gz', 'con-notes.md', 'x.revery_tmp', 'x.REVERY_BAK', 'a'.repeat(255), 'a'.repeat(256),
    'å'.repeat(127), 'å'.repeat(128), 'Ärende.md'];
  for (const n of corpus) assert.equal(core.checkEntryName(n), rendererRule(n), JSON.stringify(n));
});

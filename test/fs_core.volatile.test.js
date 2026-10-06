'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureVolatileDir,
  volatilePaths,
  setVolatileContent,
  getVolatileContent,
  deleteVolatileContent,
  listVolatileBackups,
  purgeOldVolatileFiles,
} = require('../electron/fs_core.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Overwrite a backup's meta file with a chosen timestamp (test control). */
function setMetaTs(dir, originalPath, ts) {
  const { metaFile } = volatilePaths(dir, originalPath);
  fs.writeFileSync(metaFile, JSON.stringify({ originalPath, ts }));
}

describe('ensureVolatileDir', () => {
  let base;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-vol-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('creates a missing directory with 0700 permissions', () => {
    const dir = path.join(base, 'volatile');
    ensureVolatileDir(dir);
    const st = fs.statSync(dir);
    assert.ok(st.isDirectory());
    if (process.platform !== 'win32') {
      assert.equal(st.mode & 0o777, 0o700);
    }
  });

  test('tightens permissions of an existing over-permissive directory', { skip: process.platform === 'win32' }, () => {
    const dir = path.join(base, 'volatile');
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755); // explicit — mkdir mode is umask-filtered
    ensureVolatileDir(dir);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  });

  test('refuses to follow a symlink', { skip: process.platform === 'win32' }, () => {
    const realDir = path.join(base, 'somewhere-else');
    fs.mkdirSync(realDir);
    const link = path.join(base, 'volatile-link');
    fs.symlinkSync(realDir, link, 'dir');
    assert.throws(() => ensureVolatileDir(link), /symlink/);
  });

  test('refuses a path that exists as a regular file', { skip: process.platform === 'win32' }, () => {
    const asFile = path.join(base, 'volatile-file');
    fs.writeFileSync(asFile, 'not a dir');
    assert.throws(() => ensureVolatileDir(asFile), /not a directory/);
  });
});

describe('volatile backup lifecycle', () => {
  let dir;
  const noteA = '/home/user/notes/a.md';
  const noteB = '/home/user/notes/b.md';
  const other = '/somewhere/else/c.md';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-vol-life-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('set → get roundtrip returns content, timestamp and original path', () => {
    const before = Date.now();
    setVolatileContent(dir, noteA, 'draft text 📝');
    const got = getVolatileContent(dir, noteA);
    assert.equal(got.content, 'draft text 📝');
    assert.equal(got.originalPath, noteA);
    assert.ok(got.ts >= before && got.ts <= Date.now());
  });

  test('get returns null when no backup exists', () => {
    assert.equal(getVolatileContent(dir, noteA), null);
  });

  test('set overwrites the previous backup for the same path', () => {
    setVolatileContent(dir, noteA, 'v1');
    setVolatileContent(dir, noteA, 'v2');
    assert.equal(getVolatileContent(dir, noteA).content, 'v2');
    // exactly one data + one meta file
    assert.equal(fs.readdirSync(dir).length, 2);
  });

  test('delete removes both files and is idempotent', () => {
    setVolatileContent(dir, noteA, 'x');
    deleteVolatileContent(dir, noteA);
    assert.equal(getVolatileContent(dir, noteA), null);
    assert.deepEqual(fs.readdirSync(dir), []);
    deleteVolatileContent(dir, noteA); // second call must not throw
  });

  test('backups for different paths do not collide', () => {
    setVolatileContent(dir, noteA, 'AAA');
    setVolatileContent(dir, noteB, 'BBB');
    assert.equal(getVolatileContent(dir, noteA).content, 'AAA');
    assert.equal(getVolatileContent(dir, noteB).content, 'BBB');
  });

  test('list filters by prefix and sorts newest first', () => {
    setVolatileContent(dir, noteA, 'a');
    setVolatileContent(dir, noteB, 'b');
    setVolatileContent(dir, other, 'c');
    setMetaTs(dir, noteA, 1000);
    setMetaTs(dir, noteB, 3000);
    setMetaTs(dir, other, 2000);

    const listed = listVolatileBackups(dir, '/home/user/notes/');
    assert.deepEqual(listed, [
      { originalPath: noteB, ts: 3000 },
      { originalPath: noteA, ts: 1000 },
    ]);
  });

  test('list skips unreadable meta files instead of guessing', () => {
    setVolatileContent(dir, noteA, 'a');
    const { metaFile } = volatilePaths(dir, noteA);
    fs.writeFileSync(metaFile, '{broken');
    assert.deepEqual(listVolatileBackups(dir, '/'), []);
  });

  test('purge deletes only pairs older than maxAge', () => {
    setVolatileContent(dir, noteA, 'old');
    setVolatileContent(dir, noteB, 'young');
    const now = Date.now();
    setMetaTs(dir, noteA, now - WEEK_MS - 1000);
    setMetaTs(dir, noteB, now - 1000);

    purgeOldVolatileFiles(dir, WEEK_MS, now);

    assert.equal(getVolatileContent(dir, noteA), null, 'old backup purged');
    assert.equal(getVolatileContent(dir, noteB).content, 'young');
  });

  test('purge never deletes a backup listed in keepPaths, however old', () => {
    setVolatileContent(dir, noteA, 'pending recovery');
    setVolatileContent(dir, noteB, 'old');
    const now = Date.now();
    setMetaTs(dir, noteA, now - WEEK_MS * 3);
    setMetaTs(dir, noteB, now - WEEK_MS * 3);

    purgeOldVolatileFiles(dir, WEEK_MS, now, [noteA]);

    assert.equal(getVolatileContent(dir, noteA).content, 'pending recovery');
    assert.equal(getVolatileContent(dir, noteB), null, 'unlisted old backup purged');
  });

  test('purge keeps pairs with malformed meta (never delete when unsure)', () => {
    setVolatileContent(dir, noteA, 'text');
    const { metaFile, dataFile } = volatilePaths(dir, noteA);
    fs.writeFileSync(metaFile, 'garbage');
    purgeOldVolatileFiles(dir, WEEK_MS, Date.now() + WEEK_MS * 10);
    assert.ok(fs.existsSync(dataFile), 'data file must survive');
    assert.ok(fs.existsSync(metaFile), 'meta file must survive');
  });

  test('purge tolerates a missing directory', () => {
    purgeOldVolatileFiles(path.join(dir, 'does-not-exist'), WEEK_MS);
  });
});

/* ── Multi-location recovery (volatile temp dir + durable userData dir) ──
   The temp-dir backup is RAM-backed tmpfs on modern Linux and does not
   survive a reboot; the autosave-suspended states additionally snapshot
   to a durable dir. Recovery must consult BOTH and prefer the newest. */
describe('merged multi-directory recovery', () => {
  const { getNewestVolatileContent, listVolatileBackupsMerged } = require('../electron/fs_core.js');

  let base, volDir, durDir;
  const note = '/home/user/notes/todo.md';

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-merged-'));
    volDir = path.join(base, 'volatile');
    durDir = path.join(base, 'durable');
    ensureVolatileDir(volDir);
    ensureVolatileDir(durDir);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('newest snapshot wins regardless of which directory holds it', () => {
    setVolatileContent(volDir, note, 'volatile older');
    setVolatileContent(durDir, note, 'durable newer');
    setMetaTs(volDir, note, 1000);
    setMetaTs(durDir, note, 2000);
    assert.equal(getNewestVolatileContent([volDir, durDir], note).content, 'durable newer');

    setMetaTs(volDir, note, 3000); // volatile becomes the newer one
    assert.equal(getNewestVolatileContent([volDir, durDir], note).content, 'volatile older');
  });

  test('a snapshot present in only one directory is still found', () => {
    setVolatileContent(durDir, note, 'only durable');
    assert.equal(getNewestVolatileContent([volDir, durDir], note).content, 'only durable');
    assert.equal(getNewestVolatileContent([volDir], note), null);
  });

  test('missing/empty directory list degrades to null, not a throw', () => {
    assert.equal(getNewestVolatileContent([], note), null);
    assert.equal(getNewestVolatileContent([path.join(base, 'nope')], note), null);
  });

  test('merged listing dedupes by originalPath keeping the newest ts', () => {
    const other = '/home/user/notes/other.md';
    setVolatileContent(volDir, note, 'v');
    setVolatileContent(durDir, note, 'd');
    setVolatileContent(durDir, other, 'o');
    setMetaTs(volDir, note, 1000);
    setMetaTs(durDir, note, 2000);
    setMetaTs(durDir, other, 1500);

    const merged = listVolatileBackupsMerged([volDir, durDir], '/home/user');
    assert.equal(merged.length, 2, 'one entry per originalPath');
    assert.deepEqual(merged.map((b) => b.ts), [2000, 1500], 'newest first');
    assert.equal(merged[0].originalPath, note);
  });
});

/* ── The disk version a backup was edited from (meta.base) ──────────────
   Start-up recovery compares it with the file: the same version → Restore
   only puts unsaved edits back; another version → the file changed since,
   and keeping both is the default. Pinned here: the base travels WITH its
   own text (per directory, newest snapshot wins), anything unusable is
   dropped, and backups written before the field existed still read. */
describe('backup base (the disk version the text was edited from)', () => {
  const { getNewestVolatileContent } = require('../electron/fs_core.js');
  const BASE_A = 'v1:5:0123456789abcdef';
  const BASE_B = 'v1:6:fedcba9876543210';
  let base, volDir, durDir;
  const note = '/home/user/notes/chapter.md';

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-base-'));
    volDir = path.join(base, 'volatile');
    durDir = path.join(base, 'durable');
    ensureVolatileDir(volDir);
    ensureVolatileDir(durDir);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test('set → get returns the base with the text; the meta keeps its old fields', () => {
    setVolatileContent(volDir, note, 'edited', BASE_A);
    const got = getVolatileContent(volDir, note);
    assert.deepEqual([got.content, got.originalPath, got.base], ['edited', note, BASE_A]);
    const meta = JSON.parse(fs.readFileSync(volatilePaths(volDir, note).metaFile, 'utf8'));
    assert.equal(meta.originalPath, note);
    assert.equal(typeof meta.ts, 'number');
    assert.equal(meta.base, BASE_A);
  });

  test('a later write replaces the base along with the text — or drops it', () => {
    setVolatileContent(volDir, note, 'one', BASE_A);
    setVolatileContent(volDir, note, 'two', BASE_B);
    assert.deepEqual([getVolatileContent(volDir, note).content, getVolatileContent(volDir, note).base], ['two', BASE_B]);
    setVolatileContent(volDir, note, 'three');
    assert.deepEqual([getVolatileContent(volDir, note).content, getVolatileContent(volDir, note).base], ['three', null]);
  });

  test('unusable bases are not recorded', () => {
    for (const bad of ['', 42, {}, 'x'.repeat(201), null, undefined]) {
      setVolatileContent(volDir, note, 'text', bad);
      assert.equal(getVolatileContent(volDir, note).base, null, JSON.stringify(bad));
      const meta = JSON.parse(fs.readFileSync(volatilePaths(volDir, note).metaFile, 'utf8'));
      assert.ok(!('base' in meta), 'no base key written for ' + JSON.stringify(bad));
    }
  });

  test('a backup written before the field existed reads with base null', () => {
    const { dataFile, metaFile } = volatilePaths(volDir, note);
    fs.writeFileSync(dataFile, 'old text');
    fs.writeFileSync(metaFile, JSON.stringify({ originalPath: note, ts: 1234 }));
    assert.deepEqual(getVolatileContent(volDir, note), { content: 'old text', ts: 1234, originalPath: note, base: null });
  });

  test('the newest snapshot across directories brings its own base', () => {
    setVolatileContent(volDir, note, 'volatile', BASE_A);
    setVolatileContent(durDir, note, 'durable', BASE_B);
    const meta = (dir, ts, b) => fs.writeFileSync(volatilePaths(dir, note).metaFile,
      JSON.stringify({ originalPath: note, ts, base: b }));
    meta(volDir, 1000, BASE_A);
    meta(durDir, 2000, BASE_B);
    assert.deepEqual(['content', 'base'].map((k) => getNewestVolatileContent([volDir, durDir], note)[k]), ['durable', BASE_B]);
    meta(volDir, 3000, BASE_A);
    assert.deepEqual(['content', 'base'].map((k) => getNewestVolatileContent([volDir, durDir], note)[k]), ['volatile', BASE_A]);
  });

  test('listing and purging are unaffected by the extra field', () => {
    setVolatileContent(volDir, note, 'text', BASE_A);
    assert.deepEqual(listVolatileBackups(volDir, '/home/user').map((b) => b.originalPath), [note]);
    const { metaFile } = volatilePaths(volDir, note);
    fs.writeFileSync(metaFile, JSON.stringify({ originalPath: note, ts: 1, base: BASE_A }));
    purgeOldVolatileFiles(volDir, WEEK_MS);
    assert.equal(getVolatileContent(volDir, note), null, 'an old pair is purged as before');
  });
});

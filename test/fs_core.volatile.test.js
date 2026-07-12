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

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { atomicWriteFile } = require('../electron/fs_core.js');

/* fs_core holds a reference to the same `fs` module object, so patching a
   method here is visible inside atomicWriteFile. Every patch is restored in
   afterEach even when an assertion throws. */
const realRenameSync = fs.renameSync;
const realCopyFileSync = fs.copyFileSync;
const realWriteSync = fs.writeSync;

function exdevOn(target) {
  fs.renameSync = (src, dest) => {
    if (dest === target) {
      const e = new Error('EXDEV: cross-device link not permitted');
      e.code = 'EXDEV';
      throw e;
    }
    return realRenameSync(src, dest);
  };
}

/** Directory entries other than the target file itself (leftover detector). */
function siblings(dir, targetName) {
  return fs.readdirSync(dir).filter(n => n !== targetName);
}

describe('atomicWriteFile', () => {
  let dir, target;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-atomic-'));
    target = path.join(dir, 'note.md');
  });

  afterEach(() => {
    fs.renameSync = realRenameSync;
    fs.copyFileSync = realCopyFileSync;
    fs.writeSync = realWriteSync;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('creates a new file with the exact content', () => {
    atomicWriteFile(target, 'hello world');
    assert.equal(fs.readFileSync(target, 'utf8'), 'hello world');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('replaces an existing file', () => {
    fs.writeFileSync(target, 'OLD');
    atomicWriteFile(target, 'NEW');
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('preserves multibyte UTF-8 content', () => {
    const content = '📝 → Ünïcode 测试 \u{1F5C2}\nsecond line';
    atomicWriteFile(target, content);
    assert.equal(fs.readFileSync(target, 'utf8'), content);
  });

  test('failed temp write: target untouched, temp cleaned up', () => {
    fs.writeFileSync(target, 'OLD');
    fs.writeSync = () => {
      const e = new Error('ENOSPC: no space left on device');
      e.code = 'ENOSPC';
      throw e;
    };
    assert.throws(() => atomicWriteFile(target, 'NEW'), /ENOSPC/);
    fs.writeSync = realWriteSync;
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('non-EXDEV rename failure: error propagates, temp cleaned, target untouched', () => {
    fs.writeFileSync(target, 'OLD');
    fs.renameSync = () => {
      const e = new Error('EPERM: operation not permitted');
      e.code = 'EPERM';
      throw e;
    };
    assert.throws(() => atomicWriteFile(target, 'NEW'), /EPERM/);
    fs.renameSync = realRenameSync;
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('EXDEV fallback: copies over existing destination, cleans temp and snapshot', () => {
    fs.writeFileSync(target, 'OLD');
    exdevOn(target);
    atomicWriteFile(target, 'NEW');
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('EXDEV fallback: works when the destination does not exist yet', () => {
    exdevOn(target);
    atomicWriteFile(target, 'FRESH');
    assert.equal(fs.readFileSync(target, 'utf8'), 'FRESH');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('EXDEV copy failure: previous content restored from snapshot', () => {
    fs.writeFileSync(target, 'OLD');
    exdevOn(target);
    fs.copyFileSync = (src, dest) => {
      if (String(src).includes('.revery_tmp')) {
        const e = new Error('EIO: i/o error');
        e.code = 'EIO';
        throw e;
      }
      return realCopyFileSync(src, dest);
    };
    assert.throws(() => atomicWriteFile(target, 'NEW'), /EIO/);
    fs.copyFileSync = realCopyFileSync;
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('EXDEV copy failure AND restore failure: snapshot kept, error names it', () => {
    fs.writeFileSync(target, 'OLD');
    exdevOn(target);
    fs.copyFileSync = (src, dest) => {
      // The dest→bak snapshot must succeed; every copy FROM tmp or bak fails.
      if (String(src).includes('.revery_tmp') || String(src).includes('.revery_bak')) {
        const e = new Error('EIO: i/o error');
        e.code = 'EIO';
        throw e;
      }
      return realCopyFileSync(src, dest);
    };
    let err;
    try {
      atomicWriteFile(target, 'NEW');
    } catch (e) {
      err = e;
    }
    fs.copyFileSync = realCopyFileSync;
    assert.ok(err, 'atomicWriteFile should have thrown');
    assert.match(err.message, /preserved at/);
    const baks = siblings(dir, 'note.md').filter(n => n.includes('.revery_bak'));
    assert.equal(baks.length, 1, 'exactly one snapshot must be kept');
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), 'OLD');
  });
});

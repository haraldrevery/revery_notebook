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

  /* write(2) may write FEWER bytes than asked (nearly full disk, file-size
     limit) and fs.writeSync then just returns the smaller count. A single
     writeSync used to fsync and rename that truncated temp file over the
     note — and report success. */
  test('short writes are completed: the file is never truncated', () => {
    fs.writeFileSync(target, 'OLD');
    const content = 'Thesis chapter 📝 with Ünïcode 测试\n'.repeat(80);
    let calls = 0;
    fs.writeSync = (fd, buf, off, len, pos) => {
      calls++;
      return realWriteSync(fd, buf, off, Math.min(len, 7), pos); // at most 7 bytes per call
    };
    atomicWriteFile(target, content);
    fs.writeSync = realWriteSync;
    assert.equal(fs.readFileSync(target, 'utf8'), content);
    assert.ok(calls > 100, 'the write must have been split into many short writes');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('short write, then the disk is full: the save fails, target untouched, temp cleaned up', () => {
    fs.writeFileSync(target, 'OLD');
    let calls = 0;
    fs.writeSync = (fd, buf, off, len, pos) => {
      if (++calls === 1) return realWriteSync(fd, buf, off, Math.floor(len / 2), pos);
      const e = new Error('ENOSPC: no space left on device');
      e.code = 'ENOSPC';
      throw e;
    };
    assert.throws(() => atomicWriteFile(target, 'NEW CONTENT THAT DOES NOT FIT'), /ENOSPC/);
    fs.writeSync = realWriteSync;
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  test('a write that makes no progress fails instead of looping forever', () => {
    fs.writeFileSync(target, 'OLD');
    fs.writeSync = () => 0;
    assert.throws(() => atomicWriteFile(target, 'NEW'), /no progress/);
    fs.writeSync = realWriteSync;
    assert.equal(fs.readFileSync(target, 'utf8'), 'OLD');
    assert.deepEqual(siblings(dir, 'note.md'), []);
  });

  /* The real kernel behaviour, not a mock: RLIMIT_FSIZE of 1 KiB makes
     write(2) return a short count exactly like a nearly full disk. */
  test('real short write (file-size limit): reported as an error, target untouched',
    { skip: process.platform !== 'linux' }, () => {
      fs.writeFileSync(target, 'OLD CONTENT');
      const child = `
        process.on('SIGXFSZ', () => {}); // keep running, like a real ENOSPC (no signal there)
        const { atomicWriteFile } = require(${JSON.stringify(path.join(__dirname, '..', 'electron', 'fs_core.js'))});
        try { atomicWriteFile(process.argv[1], 'x'.repeat(5000)); console.log('WROTE'); }
        catch (e) { console.log('THREW ' + e.code); }`;
      const { spawnSync } = require('node:child_process');
      const r = spawnSync('sh', ['-c', 'ulimit -f 1 && exec "$0" -e "$1" "$2"', process.execPath, child, target],
        { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), 'THREW EFBIG', `child output: ${r.stdout} ${r.stderr}`);
      assert.equal(fs.readFileSync(target, 'utf8'), 'OLD CONTENT');
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

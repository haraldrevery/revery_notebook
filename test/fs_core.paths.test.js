'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validatePath,
  validatePathInside,
  sanitizeDropFilename,
} = require('../electron/fs_core.js');

describe('validatePath', () => {
  test('rejects empty string', () => {
    assert.throws(() => validatePath(''), /empty or wrong type/);
  });

  test('rejects non-string input', () => {
    assert.throws(() => validatePath(123), /empty or wrong type/);
    assert.throws(() => validatePath(null), /empty or wrong type/);
    assert.throws(() => validatePath(undefined), /empty or wrong type/);
  });

  test('rejects null bytes', () => {
    assert.throws(() => validatePath('/tmp/a\0b'), /null byte/);
  });

  test('resolves to an absolute path', () => {
    assert.equal(validatePath('some/relative'), path.resolve('some/relative'));
    assert.equal(validatePath('/abs/../abs2/x'), path.resolve('/abs2/x'));
  });
});

describe('sanitizeDropFilename', () => {
  test('strips directory components (POSIX and Windows separators)', () => {
    assert.equal(sanitizeDropFilename('dir/sub/name.md'), 'name.md');
    assert.equal(sanitizeDropFilename('C:\\Users\\x\\pic.png'), 'pic.png');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(sanitizeDropFilename('  spaced.md  '), 'spaced.md');
  });

  test('keeps ordinary names with spaces and dashes', () => {
    assert.equal(sanitizeDropFilename('my notes - draft 2.md'), 'my notes - draft 2.md');
  });

  test('rejects empty, dot and dot-dot names', () => {
    assert.throws(() => sanitizeDropFilename(''), /Invalid file name/);
    assert.throws(() => sanitizeDropFilename('.'), /Invalid file name/);
    assert.throws(() => sanitizeDropFilename('..'), /Invalid file name/);
    assert.throws(() => sanitizeDropFilename('dir/..'), /Invalid file name/);
  });

  test('rejects control characters and null bytes', () => {
    assert.throws(() => sanitizeDropFilename('a\u0007b.md'), /control characters/);
    assert.throws(() => sanitizeDropFilename('a\nb.md'), /control characters/);
  });

  test('rejects non-string input', () => {
    assert.throws(() => sanitizeDropFilename(42), /Invalid file name/);
  });
});

describe('validatePathInside', () => {
  let root;        // real (symlink-resolved) project root
  let outside;     // sibling dir outside the root

  before(() => {
    root    = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revery-root-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revery-outside-')));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'x');
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('accepts an existing path inside the root', () => {
    const p = path.join(root, 'sub', 'file.txt');
    assert.equal(validatePathInside(p, root), p);
  });

  test('accepts the root itself', () => {
    assert.equal(validatePathInside(root, root), root);
  });

  test('accepts a new nested path whose parents do not exist yet', () => {
    const p = path.join(root, 'new_a', 'new_b', 'note.md');
    assert.equal(validatePathInside(p, root), p);
  });

  test('rejects .. traversal that escapes the root', () => {
    const escape = path.join(root, '..', path.basename(outside), 'evil.txt');
    assert.throws(() => validatePathInside(escape, root), /escapes project root/);
  });

  test('rejects an absolute path outside the root', () => {
    assert.throws(
      () => validatePathInside(path.join(outside, 'f.txt'), root),
      /escapes project root/
    );
  });

  test('rejects a path through a symlink that points outside the root', () => {
    const link = path.join(root, 'sneaky');
    fs.symlinkSync(outside, link, 'dir');
    try {
      assert.throws(
        () => validatePathInside(path.join(link, 'f.txt'), root),
        /escapes project root/
      );
    } finally {
      fs.unlinkSync(link);
    }
  });

  test('accepts a symlink that stays inside the root', () => {
    const link = path.join(root, 'alias');
    fs.symlinkSync(path.join(root, 'sub'), link, 'dir');
    try {
      const resolved = validatePathInside(path.join(link, 'file.txt'), root);
      assert.equal(resolved, path.join(root, 'sub', 'file.txt'));
    } finally {
      fs.unlinkSync(link);
    }
  });
});

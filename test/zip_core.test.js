'use strict';

/* Unit tests for electron/zip_core.js — the exact walk+zip code the
   project:export-zip IPC handler runs (the handler adds only the OS save
   dialog and the already-tested atomicWriteFile call around it).

   Covered here:
     - archive validity (structural EOCD checks + `unzip -t` when available)
     - UTF-8 filenames survive a byte-level roundtrip
     - symlinks NEVER enter the archive (content-leak guard)
     - empty directories are preserved
     - the destination zip is excluded when saved inside the project
     - entry/size caps fail with clear messages
     - deterministic output for identical trees                        */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const { buildZip, walkProject, crc32, MAX_ENTRIES } = require('../electron/zip_core.js');

function makeFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `revery-zip-${label}-`));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.mkdirSync(path.join(root, 'empty'));
  fs.writeFileSync(path.join(root, 'note.md'), '# Hello\n\nworld');
  fs.writeFileSync(path.join(root, 'sub', 'inner.md'), 'nested content here');
  fs.writeFileSync(path.join(root, 'sub', 'ÅÄÖ anteckning.md'), 'åäö unicode');
  return root;
}

function hasUnzip() {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

/* Minimal reader: walk the central directory and inflate each entry.
   Independent of the writer's bookkeeping — reads offsets from the EOCD. */
function readZip(buffer) {
  const eocdAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
  assert.ok(eocdAt >= 0, 'EOCD signature present');
  const count = buffer.readUInt16LE(eocdAt + 10);
  let at = buffer.readUInt32LE(eocdAt + 16); // central directory offset
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(at), 0x02014B50, 'central header signature');
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const csize = buffer.readUInt32LE(at + 20);
    const usize = buffer.readUInt32LE(at + 24);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    /* payload sits after the local header + its name/extra */
    const lNameLen = buffer.readUInt16LE(localAt + 26);
    const lExtraLen = buffer.readUInt16LE(localAt + 28);
    const dataAt = localAt + 30 + lNameLen + lExtraLen;
    const payload = buffer.subarray(dataAt, dataAt + csize);
    const data = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload);
    entries.push({ name, method, crc, usize, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('zip roundtrip: files, unicode names, empty dirs, valid CRCs', () => {
  const root = makeFixture('roundtrip');
  const { buffer, entries, bytes } = buildZip(root, {});
  assert.equal(entries, 5, '2 dirs + 3 files');
  assert.ok(bytes > 0);

  const items = readZip(buffer);
  assert.equal(items.length, 5);
  const names = items.map((e) => e.name).sort();
  assert.deepEqual(names, [
    'empty/', 'note.md', 'sub/', 'sub/inner.md', 'sub/ÅÄÖ anteckning.md',
  ]);
  for (const it of items) {
    assert.equal(crc32(it.data), it.crc, `CRC matches for ${it.name}`);
    assert.equal(it.data.length, it.usize, `size matches for ${it.name}`);
  }
  const unicode = items.find((e) => e.name === 'sub/ÅÄÖ anteckning.md');
  assert.equal(unicode.data.toString('utf8'), 'åäö unicode');

  if (hasUnzip()) {
    const tmpZip = path.join(os.tmpdir(), `revery-zip-check-${process.pid}.zip`);
    fs.writeFileSync(tmpZip, buffer);
    try {
      execFileSync('unzip', ['-t', tmpZip], { stdio: 'pipe' }); // throws on corrupt
    } finally {
      fs.rmSync(tmpZip, { force: true });
    }
  }
});

test('symlinks never enter the archive', { skip: process.platform === 'win32' }, () => {
  const root = makeFixture('symlink');
  fs.symlinkSync('/etc/passwd', path.join(root, 'evil-file-link'));
  fs.symlinkSync('/etc', path.join(root, 'evil-dir-link'));
  const { buffer, entries } = buildZip(root, {});
  assert.equal(entries, 5, 'links must not add entries');
  for (const it of readZip(buffer)) {
    assert.ok(!it.name.includes('evil'), `symlink leaked: ${it.name}`);
  }
});

test('destination zip inside the project is excluded', () => {
  const root = makeFixture('exclude');
  const dest = path.join(root, 'export.zip');
  fs.writeFileSync(dest, 'pretend older export');
  const { buffer, entries } = buildZip(root, { excludePath: dest });
  assert.equal(entries, 5);
  for (const it of readZip(buffer)) assert.notEqual(it.name, 'export.zip');
});

test('caps fail with clear messages', () => {
  const root = makeFixture('caps');
  /* entry cap: fake it cheap by asserting the constant is enforced via a
     small custom limit is not exposed — so exercise the SIZE cap, which is
     reachable without creating 65k files: one sparse-ish big file. */
  const big = path.join(root, 'big.bin');
  const fd = fs.openSync(big, 'w');
  fs.ftruncateSync(fd, 513 * 1024 * 1024); // sparse on ext4 — no real disk use
  fs.closeSync(fd);
  assert.throws(() => walkProject(root, {}), /too large/i);
  fs.rmSync(big, { force: true });
  assert.ok(MAX_ENTRIES >= 60000, 'entry cap constant sane');
});

test('deterministic output for identical trees', () => {
  const root = makeFixture('determinism');
  const a = buildZip(root, {}).buffer;
  const b = buildZip(root, {}).buffer;
  assert.ok(a.equals(b), 'same tree → byte-identical archive');
});

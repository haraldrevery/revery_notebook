'use strict';

/* zip_core.js — pure, dependency-free ZIP builder for "Zip Project Export".
 *
 * Same philosophy as fs_core.js: all logic lives in a plain-node module so
 * unit tests can exercise the EXACT code the IPC handler runs. The ZIP
 * container (PKZIP appnote) is assembled by hand over node's built-in
 * zlib.deflateRawSync — no npm dependency, nothing new to audit or bundle.
 *
 * Safety properties (tested):
 *  - Symlinks are SKIPPED (lstat via withFileTypes) — a link inside the
 *    project can never pull file content from outside the project root.
 *  - The destination zip itself is excluded, so exporting into your own
 *    project folder (then re-exporting over it) can't recurse.
 *  - Hard caps instead of zip64: ≤ 65,000 entries and ≤ 512 MB of input,
 *    failing with a clear message rather than a corrupt archive.
 *
 * The caller writes the returned Buffer through fs_core.atomicWriteFile,
 * so a crash mid-export can never leave a truncated zip at the target.
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ENTRIES     = 65000;               // classic zip limit is 65535
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;   // stay far below zip64 territory

/* ── CRC-32 (IEEE 802.3), table-driven ────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ── MS-DOS date/time encoding (zip's native timestamp format) ────────── */
function dosDateTime(mtime) {
  const d = (mtime instanceof Date) ? mtime : new Date(mtime);
  const year = Math.max(d.getFullYear(), 1980); // DOS epoch floor
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date, time };
}

/* ── Recursive project walk ───────────────────────────────────────────────
 * Returns { files: [{rel, abs, size, mtime}], dirs: [{rel, mtime}] } with
 * rel paths always '/'-separated. Symlinks (files AND directories) are
 * skipped. `excludePath` (absolute) is omitted wherever it appears.
 * Throws on cap violations.                                              */
function walkProject(rootPath, opts) {
  const excludeAbs = (opts && opts.excludePath)
    ? path.resolve(opts.excludePath) : null;

  const files = [];
  const dirs  = [];
  let totalBytes = 0;

  const visit = (absDir, relDir) => {
    const dirents = fs.readdirSync(absDir, { withFileTypes: true });
    for (const de of dirents) {
      const abs = path.join(absDir, de.name);
      const rel = relDir ? relDir + '/' + de.name : de.name;

      if (de.isSymbolicLink()) continue;               // never follow links
      if (excludeAbs && path.resolve(abs) === excludeAbs) continue;

      if (de.isDirectory()) {
        let mtime;
        try { mtime = fs.lstatSync(abs).mtime; } catch (_) { mtime = new Date(); }
        dirs.push({ rel, mtime });
        if (files.length + dirs.length > MAX_ENTRIES) {
          throw new Error(`Project has too many items for zip export (limit ${MAX_ENTRIES}).`);
        }
        visit(abs, rel);
      } else if (de.isFile()) {
        const st = fs.lstatSync(abs);
        totalBytes += st.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new Error('Project is too large for zip export (limit 512 MB).');
        }
        files.push({ rel, abs, size: st.size, mtime: st.mtime });
        if (files.length + dirs.length > MAX_ENTRIES) {
          throw new Error(`Project has too many items for zip export (limit ${MAX_ENTRIES}).`);
        }
      }
      /* other kinds (sockets, fifos…) are silently skipped */
    }
  };

  visit(rootPath, '');
  /* Deterministic archive layout regardless of readdir order. */
  files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  dirs.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return { files, dirs, totalBytes };
}

/* ── Record writers ───────────────────────────────────────────────────── */
const FLAG_UTF8 = 0x0800;

function localHeader(nameBuf, method, dos, crc, csize, usize) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034B50, 0);       // PK\x03\x04
  h.writeUInt16LE(20, 4);               // version needed
  h.writeUInt16LE(FLAG_UTF8, 6);
  h.writeUInt16LE(method, 8);
  h.writeUInt16LE(dos.time, 10);
  h.writeUInt16LE(dos.date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(csize, 18);
  h.writeUInt32LE(usize, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);               // extra len
  return h;
}

function centralHeader(nameBuf, method, dos, crc, csize, usize, extAttrs, offset) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014B50, 0);       // PK\x01\x02
  h.writeUInt16LE(20, 4);               // version made by
  h.writeUInt16LE(20, 6);               // version needed
  h.writeUInt16LE(FLAG_UTF8, 8);
  h.writeUInt16LE(method, 10);
  h.writeUInt16LE(dos.time, 12);
  h.writeUInt16LE(dos.date, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(csize, 20);
  h.writeUInt32LE(usize, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30);               // extra len
  h.writeUInt16LE(0, 32);               // comment len
  h.writeUInt16LE(0, 34);               // disk number
  h.writeUInt16LE(0, 36);               // internal attrs
  h.writeUInt32LE(extAttrs, 38);        // external attrs (0x10 = DOS dir bit)
  h.writeUInt32LE(offset, 42);          // local header offset
  return h;
}

/* ── Core assembler ───────────────────────────────────────────────────────
 * items: [{ name, data (Buffer | null = directory), mtime }] in archive
 * order. Directory names must carry their trailing '/'.                  */
function assembleZip(items) {
  const chunks  = [];
  const central = [];
  let offset = 0;

  const push = (buf) => { chunks.push(buf); offset += buf.length; };

  for (const item of items) {
    const nameBuf = Buffer.from(item.name, 'utf8');
    const dos = dosDateTime(item.mtime);
    const at = offset;
    if (item.data == null) {
      /* Directory entry — preserves empty folders on extract. */
      push(localHeader(nameBuf, 0, dos, 0, 0, 0));
      push(nameBuf);
      central.push(centralHeader(nameBuf, 0, dos, 0, 0, 0, 0x10, at));
      central.push(nameBuf);
    } else {
      const data = item.data;
      const crc = crc32(data);
      /* Deflate, but keep whichever representation is smaller (tiny or
         already-compressed files often grow under deflate).           */
      const deflated = zlib.deflateRawSync(data);
      const useDeflate = deflated.length < data.length;
      const method = useDeflate ? 8 : 0;
      const payload = useDeflate ? deflated : data;
      push(localHeader(nameBuf, method, dos, crc, payload.length, data.length));
      push(nameBuf);
      push(payload);
      central.push(centralHeader(nameBuf, method, dos, crc, payload.length, data.length, 0, at));
      central.push(nameBuf);
    }
  }

  const cdStart = offset;
  for (const c of central) push(c);
  const cdSize = offset - cdStart;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);    // PK\x05\x06
  eocd.writeUInt16LE(0, 4);             // this disk
  eocd.writeUInt16LE(0, 6);             // cd start disk
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);            // comment len
  push(eocd);

  return Buffer.concat(chunks);
}

/* ── Build the archive from a project folder ──────────────────────────────
 * buildZip(rootPath, { excludePath }) → { buffer, entries, bytes }
 * Throws with a user-presentable message on cap violations / IO errors.  */
function buildZip(rootPath, opts) {
  const { files, dirs, totalBytes } = walkProject(rootPath, opts);
  const items = [
    ...dirs.map((d) => ({ name: d.rel + '/', data: null, mtime: d.mtime })),
    ...files.map((f) => ({ name: f.rel, data: fs.readFileSync(f.abs), mtime: f.mtime })),
  ];
  return { buffer: assembleZip(items), entries: items.length, bytes: totalBytes };
}

/* ── Build the archive from in-memory entries ─────────────────────────────
 * buildZipFromEntries([{ name: 'dir/file.ext', data: Buffer|string }])
 *   → { buffer, entries, bytes }
 * Parent directory entries ('dir/') are inserted automatically. Used by
 * the LaTeX project export (main.tex + images/*). Same caps as the
 * project export.                                                        */
function buildZipFromEntries(entries) {
  const now = new Date();
  const dirSet = new Set();
  const items = [];

  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || !e.name || e.name.endsWith('/')) {
      throw new Error('Invalid zip entry name');
    }
    if (e.name.includes('..') || e.name.startsWith('/') || e.name.includes('\0')) {
      throw new Error(`Unsafe zip entry name: ${e.name}`);
    }
    const parts = e.name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/') + '/';
      if (!dirSet.has(d)) {
        dirSet.add(d);
        items.push({ name: d, data: null, mtime: now });
      }
    }
  }

  let bytes = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    bytes += data.length;
    if (bytes > MAX_TOTAL_BYTES) {
      throw new Error('Export is too large for zip (limit 512 MB).');
    }
    items.push({ name: e.name, data, mtime: e.mtime || now });
  }
  if (items.length > MAX_ENTRIES) {
    throw new Error(`Too many zip entries (limit ${MAX_ENTRIES}).`);
  }
  return { buffer: assembleZip(items), entries: items.length, bytes };
}

module.exports = { buildZip, buildZipFromEntries, walkProject, crc32, MAX_ENTRIES, MAX_TOTAL_BYTES };

/**
 * electron/fs_core.js — pure file-system logic behind the IPC handlers.
 *
 * Everything here is plain Node (no `electron` imports) so it can be unit
 * tested with `node --test`. main.js owns the wiring: window state, IPC
 * registration, the volatile-dir readiness flag, and trusted-roots policy.
 *
 * This module is the single source of truth for the atomic-write strategy.
 * Both fs:write-file and dialog:save-file used to carry their own inline
 * copy of it, and the two had already drifted (the save-dialog copy was
 * missing the destination fsync in the EXDEV fallback).
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

/* ── fsync-safe write helper ────────────────────────────────────────────
   Flushes kernel buffers to physical disk before returning, so a rename
   that follows can never publish a file whose bytes are still in flight
   (ext4 delayed allocation can otherwise produce a zero-byte file after
   power loss). */
function writeFileWithFsync(filePath, data, encoding) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'w');
    fs.writeSync(fd, data, null, encoding || 'utf8');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/* Persist a directory-entry change (create/rename) to disk. POSIX only —
   NTFS journals directory entries together with file content. Non-fatal:
   the data write itself has already been fsynced by the caller. */
function syncParentDir(filePath) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    const parent = path.dirname(filePath);
    fd = fs.openSync(parent, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    console.warn('[revery] syncParentDir failed (non-fatal):', err.message);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/* ── Atomic file write ──────────────────────────────────────────────────
   Strategy: write to a unique sibling temp file (same directory → same
   filesystem), fsync it, then rename over the destination. A crash at any
   point leaves the destination either untouched or fully replaced — never
   truncated.

   On EXDEV/EBUSY (exotic mounts, or a sync agent briefly locking the
   destination) rename is impossible, so we fall back to copy. A copy can
   be interrupted mid-write, so the existing destination is snapshotted to
   a .revery_bak first; the snapshot is deleted only after the copy (or the
   restore from it) verifiably succeeded. A kept .revery_bak is the only
   intact copy of the previous content and must survive for manual
   recovery. */
function atomicWriteFile(safe, content) {
  const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const tmp = safe + `.${uniqueSuffix}.revery_tmp`;
  const bak = safe + `.${uniqueSuffix}.revery_bak`;

  try {
    writeFileWithFsync(tmp, content, 'utf8');
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw err;
  }

  try {
    fs.renameSync(tmp, safe);
    syncParentDir(safe);
  } catch (err) {
    if (err.code === 'EXDEV' || err.code === 'EBUSY') {
      // Step A: Snapshot the existing destination so we can restore it if
      //         the cross-device copy is interrupted mid-write.
      let hasBak = false;
      if (fs.existsSync(safe)) {
        try {
          fs.copyFileSync(safe, bak);
          hasBak = true;
        } catch (bakErr) {
          try { fs.rmSync(tmp, { force: true }); } catch (_) {}
          throw new Error(`EXDEV fallback aborted: cannot create backup: ${bakErr.message}`);
        }
      }

      // Step B: Overwrite destination from the fully-written temp file.
      try {
        fs.copyFileSync(tmp, safe);
        // copyFileSync does not fsync the destination. Without this, power
        // loss between the copy and the OS flushing its buffers can leave
        // `safe` truncated. Mirrors sync_data() in Tauri's atomic_write_file.
        try {
          const fd = fs.openSync(safe, 'r');
          try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        } catch (_) { /* non-fatal: best-effort sync */ }
        syncParentDir(safe);
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        if (hasBak) { try { fs.rmSync(bak, { force: true }); } catch (_) {} }
      } catch (fallbackErr) {
        /* Only delete the snapshot if the restore actually succeeded —
           otherwise the .revery_bak is the only intact copy of the previous
           content (dest may be truncated). */
        let restored = false;
        if (hasBak) {
          try { fs.copyFileSync(bak, safe); restored = true; } catch (_) {}
          if (restored) {
            try { fs.rmSync(bak, { force: true }); } catch (_) {}
          }
        }
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        if (hasBak && !restored) {
          throw new Error(
            `${fallbackErr.message} — the file may be incomplete. A snapshot of ` +
            `the previous content was preserved at "${bak}". Rename it over the ` +
            `original to recover.`
          );
        }
        throw fallbackErr;
      }
    } else {
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      throw err;
    }
  }
}

/* ── Path security: prevent directory traversal ─────────────────────────
   All file-system IPC handlers validate paths through these before
   touching the OS. */
function validatePath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Invalid path: empty or wrong type');
  }
  if (raw.includes('\0')) throw new Error('Invalid path: null byte');
  const resolved = path.resolve(raw);
  // Allow any real absolute path — callers that need root restrictions
  // (e.g. only within the opened project folder) should add a second check.
  return resolved;
}

function validatePathInside(raw, rootPath) {
  const resolved = validatePath(raw);  // already absolute and normalised (no '..')
  // 1. Resolve the actual physical path of the root to prevent trickery
  const root = fs.realpathSync(path.resolve(rootPath));

  let realResolved;
  if (fs.existsSync(resolved)) {
    // 2. Existing path: full realpath (resolves symlinks)
    realResolved = fs.realpathSync(resolved);
  } else {
    // 3. New path (target or parent may not exist yet).
    // Walk up the ancestry to find the deepest existing ancestor, then
    // re-attach the non-existing tail components as plain name segments.
    // This avoids the ENOENT that realpathSync throws when the parent itself
    // is new, while preserving all symlink-escape protection.
    let existing = resolved;
    const tail = [];
    while (!fs.existsSync(existing)) {
      tail.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) {
        // Reached the filesystem root without finding an existing ancestor
        throw new Error(`Security Error: Path has no resolvable ancestor: ${resolved}`);
      }
      existing = parent;
    }
    const realAncestor = fs.realpathSync(existing);
    realResolved = path.join(realAncestor, ...tail);
  }

  const rel = path.relative(root, realResolved);

  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Security Error: Path escapes project root: ${resolved}`);
  }
  return realResolved;
}

/* Reduce a dropped file's name to a safe basename inside the target dir. */
function sanitizeDropFilename(raw) {
  if (typeof raw !== 'string') throw new Error('Invalid file name');
  const base = raw.split(/[/\\]/).pop().trim();
  if (!base || base === '.' || base === '..') throw new Error('Invalid file name');
  if (base.includes('\0')) throw new Error('File name contains null byte');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(base)) throw new Error('File name contains control characters');
  return base;
}

/* ── Volatile (crash backup) storage ────────────────────────────────────
   One backup slot per original file path, keyed by sha256 of the path:
     <dir>/<key>.revery_volatile   the note text
     <dir>/<key>.meta.json         { originalPath, ts }
   Writes are atomic (unique temp + rename) so a crash mid-backup keeps the
   PREVIOUS backup intact — exactly what crash recovery is supposed to
   provide. */

/* Verify the volatile directory is safe to write user-note backups into.
   On Unix, the OS temp dir is a shared namespace with predictable
   subdirectory names, so a pre-planted symlink or a directory owned by
   another local user must be refused. Throws when unsafe; the caller
   decides how to degrade (crash backup off for the session). */
function ensureVolatileDir(dir) {
  // Step 1: Create with restrictive perms. recursive:true is idempotent —
  // succeeds if dir already exists, but does NOT change perms in that case.
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw new Error(`Cannot create volatile dir: ${err.message}`);
    }
  }

  // Windows has no Unix permission bits and no real "owner" concept for the
  // user temp dir; we rely on the OS user-profile temp directory's default ACLs.
  if (process.platform === 'win32') return;

  // Step 2: Use lstat (NOT stat) so a pre-planted symlink can't fool us by
  // resolving to a directory we don't actually own.
  let st;
  try {
    st = fs.lstatSync(dir);
  } catch (statErr) {
    throw new Error(`Cannot stat volatile dir: ${statErr.message}`);
  }

  if (st.isSymbolicLink()) {
    throw new Error(`Volatile path is a symlink — refusing to follow: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Volatile path exists but is not a directory: ${dir}`);
  }

  // Step 3: Owner check. If another local user owns this directory, refuse.
  if (st.uid !== process.getuid()) {
    throw new Error(
      `Volatile dir is owned by uid=${st.uid}, not the current user (uid=${process.getuid()}). Refusing to use.`
    );
  }

  // Step 4: Permission check. Must be exactly 0700. If it isn't, try to
  // tighten — chmod will succeed because step 3 confirmed we own it.
  if ((st.mode & 0o777) !== 0o700) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch (chmodErr) {
      throw new Error(
        `Volatile dir has unsafe permissions (mode=${(st.mode & 0o777).toString(8)}) ` +
        `and could not be tightened: ${chmodErr.message}`
      );
    }
  }
}

function volatilePaths(dir, originalPath) {
  const key = crypto.createHash('sha256').update(originalPath).digest('hex');
  return {
    dataFile: path.join(dir, key + '.revery_volatile'),
    metaFile: path.join(dir, key + '.meta.json'),
  };
}

function setVolatileContent(dir, originalPath, content) {
  const { dataFile, metaFile } = volatilePaths(dir, originalPath);

  const uniq    = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const dataTmp = dataFile + '.' + uniq + '.tmp';
  const metaTmp = metaFile + '.' + uniq + '.tmp';

  // Data first: if the meta write fails afterward, the user still has
  // current text on disk paired with a stale ts — recoverable. Reverse
  // ordering would lose text on the same crash. The fsync matters here:
  // the crash backup must be durable precisely at crash time.
  try {
    writeFileWithFsync(dataTmp, content, 'utf8');
    fs.renameSync(dataTmp, dataFile);
    syncParentDir(dataFile);
  } catch (err) {
    try { fs.rmSync(dataTmp, { force: true }); } catch (_) {}
    throw err;
  }

  try {
    writeFileWithFsync(metaTmp, JSON.stringify({ originalPath, ts: Date.now() }), 'utf8');
    fs.renameSync(metaTmp, metaFile);
    syncParentDir(metaFile);
  } catch (err) {
    try { fs.rmSync(metaTmp, { force: true }); } catch (_) {}
    throw err;
  }
}

function getVolatileContent(dir, originalPath) {
  const { dataFile, metaFile } = volatilePaths(dir, originalPath);
  try {
    const content = fs.readFileSync(dataFile, 'utf8');
    const meta    = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return { content, ts: meta.ts, originalPath: meta.originalPath };
  } catch {
    return null; /* No backup exists — not an error */
  }
}

function deleteVolatileContent(dir, originalPath) {
  const { dataFile, metaFile } = volatilePaths(dir, originalPath);
  try { fs.unlinkSync(dataFile); } catch { /* already gone */ }
  try { fs.unlinkSync(metaFile); } catch { /* already gone */ }
}

/* List crash backups whose originalPath starts with `prefix`, newest-first. */
function listVolatileBackups(dir, prefix) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
      if (typeof meta.originalPath === 'string' && meta.originalPath.startsWith(prefix)) {
        out.push({ originalPath: meta.originalPath, ts: typeof meta.ts === 'number' ? meta.ts : 0 });
      }
    } catch { /* unreadable meta — skip, never guess */ }
  }
  out.sort((a, b) => b.ts - a.ts); // newest first
  return out;
}

/* Delete backup pairs older than maxAgeMs. Unreadable or malformed meta
   files are skipped, never deleted — when in doubt, keep the user's data. */
function purgeOldVolatileFiles(dir, maxAgeMs, now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return; // dir doesn't exist yet or is unreadable — nothing to purge
  }

  for (const entry of entries) {
    // Only inspect meta files; the matching .revery_volatile is handled below.
    if (!entry.endsWith('.meta.json')) continue;

    const metaFile = path.join(dir, entry);
    const dataFile = path.join(dir, entry.replace('.meta.json', '.revery_volatile'));

    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      // 'ts' is Date.now() ms stored by setVolatileContent.
      if (typeof meta.ts !== 'number' || (now - meta.ts) < maxAgeMs) {
        continue; // Young enough — leave it alone.
      }
      // Old backup: delete the data file first, then the meta file.
      try { fs.unlinkSync(dataFile); } catch { /* already gone */ }
      try { fs.unlinkSync(metaFile); } catch { /* already gone */ }
    } catch {
      // Unreadable or malformed meta — skip this pair, do not delete.
    }
  }
}

/* ── Persistent settings store ──────────────────────────────────────────
   Corruption-tolerant JSON settings with a `.bak` of the last known-good
   state. Every successful write atomically refreshes the .bak. If the main
   file turns up unparseable, readers recover from .bak silently; writers
   additionally quarantine the corrupt bytes (renamed to *.corrupt-<ts>.json)
   so we never keep tripping over them and the user can inspect what was
   lost.

   `getFilePath` is a function (not a string) because Electron's
   app.getPath('userData') must be resolved lazily. */
function createSettingsStore(getFilePath) {
  const getBakFile = () => getFilePath() + '.bak';

  /** Classify the main settings file.
   *  Returns { state: 'absent' | 'ok' | 'corrupt', data: object } */
  function readSettingsRaw() {
    const file = getFilePath();
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return { state: 'absent', data: {} };
      // Permission/IO error: treat as corrupt so writers don't blindly clobber.
      console.warn('[revery] Could not read settings file:', err.message);
      return { state: 'corrupt', data: {} };
    }
    // Zero-byte file is an anomaly (atomic-rename writes never produce this);
    // treat as corrupt so .bak recovery kicks in.
    if (raw.length === 0) return { state: 'corrupt', data: {} };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { state: 'ok', data: parsed };
      }
      return { state: 'corrupt', data: {} };
    } catch {
      return { state: 'corrupt', data: {} };
    }
  }

  /** Load and parse the .bak file. Returns the object on success, null otherwise. */
  function tryLoadSettingsBak() {
    let raw;
    try {
      raw = fs.readFileSync(getBakFile(), 'utf8');
    } catch {
      return null;
    }
    if (raw.length === 0) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  /** Best-effort: rename a corrupt main settings file out of the way.
   *  Errors are logged, never thrown — caller proceeds with a fresh write. */
  function quarantineCorruptSettings() {
    const dest = getFilePath();
    try {
      if (!fs.existsSync(dest)) return;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = path.extname(dest);
      const quarantine = path.join(
        path.dirname(dest),
        `${path.basename(dest, ext)}.corrupt-${ts}${ext}`
      );
      fs.renameSync(dest, quarantine);
      console.warn(`[revery] Quarantined corrupt settings file → ${quarantine}`);
    } catch (err) {
      console.error('[revery] Could not quarantine corrupt settings:', err.message);
    }
  }

  /** Best-effort: atomically replace .bak with the bytes just written to main.
   *  Errors are logged; .bak must never fail the main write. */
  function refreshSettingsBak(jsonContent) {
    const dest = getBakFile();
    const tmp = dest + '.' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.bak_tmp';
    try {
      writeFileWithFsync(tmp, jsonContent, 'utf8');
      fs.renameSync(tmp, dest);
      syncParentDir(dest);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      console.warn('[revery] Could not refresh settings .bak:', err.message);
    }
  }

  function readSettings() {
    const r = readSettingsRaw();
    if (r.state === 'ok' || r.state === 'absent') return r.data;
    // Main is corrupt — try .bak silently for read-only callers.
    // If .bak is also unavailable, return {} (legacy behavior). The next
    // writeSettings() call will quarantine the corrupt main file.
    const bak = tryLoadSettingsBak();
    return bak || {};
  }

  function writeSettings(patch) {
    /* Step 1: choose a merge base that does NOT discard recoverable fields. */
    const r = readSettingsRaw();
    let base;
    if (r.state === 'ok' || r.state === 'absent') {
      base = r.data;
    } else {
      // Main file is corrupt. Recover from .bak if possible, else quarantine.
      const bak = tryLoadSettingsBak();
      if (bak) {
        console.warn('[revery] Settings file was corrupt; recovered from .bak.');
        base = bak;
      } else {
        console.error('[revery] Settings file is corrupt and .bak is unavailable. Quarantining and starting fresh.');
        base = {};
      }
      quarantineCorruptSettings(); // always preserve the corrupt bytes for forensics
    }

    /* Step 2: atomically write the merged result to the main file. */
    const dest = getFilePath();
    const tmp = dest + '.' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.revery_settings_tmp';
    const json = JSON.stringify({ ...base, ...patch }, null, 2);
    try {
      writeFileWithFsync(tmp, json, 'utf8');
      fs.renameSync(tmp, dest);
      syncParentDir(dest);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      throw err;
    }

    /* Step 3: refresh the .bak so we always have a known-good copy.
       Best-effort: never propagate failures — main write already succeeded. */
    refreshSettingsBak(json);
  }

  return { readSettings, writeSettings, readSettingsRaw };
}

module.exports = {
  writeFileWithFsync,
  syncParentDir,
  atomicWriteFile,
  validatePath,
  validatePathInside,
  sanitizeDropFilename,
  ensureVolatileDir,
  volatilePaths,
  setVolatileContent,
  getVolatileContent,
  deleteVolatileContent,
  listVolatileBackups,
  purgeOldVolatileFiles,
  createSettingsStore,
};

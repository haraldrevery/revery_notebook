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

/* ── Write EVERY byte ────────────────────────────────────────────────────
   write(2) may write fewer bytes than asked — POSIX allows it when the
   disk is nearly full or a file-size limit is reached — and fs.writeSync
   then simply returns the smaller count, without an error. A single
   writeSync therefore let a truncated temp file be fsynced and renamed
   over the note, and the save reported success. Keep writing until all
   bytes are down; when no more fit, the next write throws the real error
   (ENOSPC, EFBIG) and the caller's cleanup keeps the old file. */
function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const n = fs.writeSync(fd, buffer, offset, buffer.length - offset);
    if (!(n > 0)) {
      throw new Error(`Write failed: no progress after ${offset} of ${buffer.length} bytes.`);
    }
    offset += n;
  }
}

/* ── Permission bits of a file being replaced ───────────────────────────
   The atomic rename publishes a NEW file, which gets the default mode: a
   private 0600 note became readable by other users after its first save,
   and an executable script lost its x bit. The temp file takes over the
   old file's bits instead (POSIX; on Windows the mode is only the
   read-only flag, and copying that would make the next save fail).
   Keeping them is best effort — it must never fail the save. */
function existingModeBits(p) {
  if (process.platform === 'win32') return null;
  try { return fs.statSync(p).mode & 0o7777; } catch (_) { return null; } // new file: default mode
}

function applyModeBits(fd, mode) {
  try {
    fs.fchmodSync(fd, mode);
  } catch (_) {
    try {
      fs.fchmodSync(fd, mode & 0o777); // setuid/setgid can be refused: keep the rest
    } catch (err) {
      console.warn('[revery] could not keep the file permissions (non-fatal):', err.message);
    }
  }
}

/* ── fsync-safe write helper ────────────────────────────────────────────
   Flushes kernel buffers to physical disk before returning, so a rename
   that follows can never publish a file whose bytes are still in flight
   (ext4 delayed allocation can otherwise produce a zero-byte file after
   power loss). `mode` (optional): permission bits to give the new file
   before its bytes are written (existingModeBits). */
function writeFileWithFsync(filePath, data, encoding, mode) {
  const buffer = typeof data === 'string'
    ? Buffer.from(data, encoding || 'utf8')
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength); // Buffer / typed array, no copy
  let fd;
  try {
    fd = fs.openSync(filePath, 'w');
    if (mode != null) applyModeBits(fd, mode);
    writeAllSync(fd, buffer);
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

/* ── Temporary sibling names ────────────────────────────────────────────
   The temp file (and the EXDEV snapshot) sits beside the file it replaces
   and starts with its name, so a leftover is recognisable — but with at
   most TEMP_NAME_PREFIX_BYTES bytes of it. A note may use the whole
   255-byte name limit, and "<full name>.<unique>.revery_tmp" was then too
   long to create: such a note could never be saved (ENAMETOOLONG on every
   autosave). ~100 + 34 bytes also fits the tighter limits some filesystems
   have (eCryptfs: 143). The cut never splits a UTF-8 character. MIRROR of
   temp_sibling in tauri/src/main.rs. */
const TEMP_NAME_PREFIX_BYTES = 100;

function tempNamePrefix(name) {
  const buf = Buffer.from(String(name), 'utf8');
  if (buf.length <= TEMP_NAME_PREFIX_BYTES) return String(name);
  let end = TEMP_NAME_PREFIX_BYTES;
  while (end > 0 && (buf[end] & 0xC0) === 0x80) end--; // back to a character boundary
  return buf.subarray(0, end).toString('utf8');
}

function tempSiblingPath(target, uniqueSuffix, tag) {
  return path.join(path.dirname(target), `${tempNamePrefix(path.basename(target))}.${uniqueSuffix}.${tag}`);
}

/* ── A lock that lets go in a moment ────────────────────────────────────
   Another program that briefly holds a file — antivirus scanning the temp
   file we just wrote, a sync client, the search indexer — makes a rename
   on Windows fail with EPERM, EACCES or EBUSY. On Linux and macOS, EBUSY
   is what the SMB client reports when the server refuses a file another
   computer has open (a note on a NAS or a Windows share); EPERM/EACCES
   there are real permission errors and fail at once. A rename happens
   completely or not at all, so trying again a few times can never leave a
   partial state. ONE policy for every rename here: the atomic write's
   final step and renameEntry. MIRROR of classify_rename_error /
   LOCK_RETRY_DELAYS_MS in tauri/src/main.rs. */
const LOCK_RETRY_DELAYS_MS = [100, 200, 400];

function isTransientLock(err, platform = process.platform) {
  if (!err) return false;
  if (err.code === 'EBUSY') return true;
  return platform === 'win32' && (err.code === 'EPERM' || err.code === 'EACCES');
}

/* atomicWriteFile is synchronous (every IPC handler that writes relies on
   it finishing before the next message is handled), so its retry waits
   synchronously: at most 0.7 s, and only while a lock persists. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* ── Atomic file write ──────────────────────────────────────────────────
   Strategy: write to a unique sibling temp file (same directory → same
   filesystem), fsync it, then rename over the destination. A crash at any
   point leaves the destination either untouched or fully replaced — never
   truncated.

   A rename blocked by a transient lock is retried (see above). When the
   lock does not let go, the save FAILS with the old file intact.
   It used to fall back to copying over the file in place on EBUSY — the
   error Windows gives for exactly these locks — which a crash could leave
   half-written.

   Only EXDEV (another filesystem — cannot happen for a sibling temp file
   on any ordinary mount) still falls back to a copy. A copy can be
   interrupted mid-write, so the existing destination is snapshotted to a
   .revery_bak first; the snapshot is deleted only after the copy (or the
   restore from it) verifiably succeeded. A kept .revery_bak is the only
   intact copy of the previous content and must survive for manual
   recovery.
   `opts.platform` / `opts.sleepSync` exist for the unit tests. */
function atomicWriteFile(safe, content, opts = {}) {
  const platform = opts.platform || process.platform;
  const sleep = opts.sleepSync || sleepSync;
  const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const tmp = tempSiblingPath(safe, uniqueSuffix, 'revery_tmp');
  const bak = tempSiblingPath(safe, uniqueSuffix, 'revery_bak');

  try {
    writeFileWithFsync(tmp, content, 'utf8', existingModeBits(safe));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw err;
  }

  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, safe);
      syncParentDir(safe);
      return;
    } catch (err) {
      if (isTransientLock(err, platform) && attempt < LOCK_RETRY_DELAYS_MS.length) {
        sleep(LOCK_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (err.code !== 'EXDEV') {
        try { fs.rmSync(tmp, { force: true }); } catch (_) {}
        if (isTransientLock(err, platform)) {
          const why = new Error(
            `"${path.basename(safe)}" could not be replaced: another program is using it, ` +
            `or it is read-only (${err.code}). The file on disk was not changed.`);
          why.code = err.code;
          throw why;
        }
        throw err;
      }
      copyOverDestination(safe, tmp, bak);
      return;
    }
  }
}

/* The EXDEV fallback of atomicWriteFile: snapshot → copy → clean up. */
function copyOverDestination(safe, tmp, bak) {
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
}

/* ── Strict UTF-8 text read ─────────────────────────────────────────────
   The editor only understands UTF-8. Node's 'utf8' decoding silently
   replaces every invalid byte with U+FFFD, so opening a legacy-encoded
   file (Windows-1252, UTF-16) and letting autosave run once would write
   the replacement characters back and destroy the original bytes. Decode
   with fatal:true and refuse such files instead — the same outcome as the
   Tauri backend, whose read_file returns the same message.
   ignoreBOM:true keeps a leading BOM as U+FEFF in the string (TextDecoder
   strips it by default). That matches Node's previous behaviour and Rust's
   read_to_string, so BOM files are still written back byte-identical. */
const NOT_UTF8_MESSAGE =
  'Read failed: this file is not valid UTF-8 text (it may use another encoding). ' +
  'It was not opened, so it has not been changed.';

function readUtf8TextStrict(filePath) {
  const buf = fs.readFileSync(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch (_) {
    const err = new Error(NOT_UTF8_MESSAGE);
    err.code = 'EREVERY_NOT_UTF8';
    throw err;
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

/* Is `b` the very same existing file as `a`, under a spelling that differs
   ONLY in letter case? That is the one situation in which a rename target
   "already exists" yet renaming is safe: a case-only rename on a
   case-insensitive filesystem (Windows, macOS), where both spellings name
   one directory entry. Three guards, all required, so a DIFFERENT file is
   never treated as the same (it would be overwritten):
     1. same folder, names equal ignoring case;
     2. both exist and have the same device and file ID (bigint, exact);
     3. that file ID is non-zero (some network filesystems report 0 for
        every file, which would make any two files look identical). */
function isCaseOnlyAliasOfSameFile(a, b) {
  try {
    if (path.dirname(a) !== path.dirname(b)) return false;
    if (path.basename(a).toLowerCase() !== path.basename(b).toLowerCase()) return false;
    /* lstat: the ENTRY itself. Two different links "Link" and "link" to
       one target must not look like one file (stat would follow both). */
    const sa = fs.lstatSync(a, { bigint: true });
    const sb = fs.lstatSync(b, { bigint: true });
    if (sa.ino === 0n || sb.ino === 0n) return false;
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/* ── Directory ENTRIES (rename / move / delete) ─────────────────────────
   validatePathInside resolves the whole path, the last component
   included — right for reading and writing CONTENT, wrong for acting on
   an entry: for a symbolic link it named the link's TARGET, so moving a
   link moved the folder it pointed to and deleting it trashed that
   folder. An entry is resolved like this instead: its PARENT folder
   through realpath (it must lie inside the project), then its own name
   appended untouched. The result names the link itself, never what it
   points to, and is also the canonical spelling of any entry the folder
   listing returns (fs:read-directory joins names onto the realpath of the
   folder). The project root itself is never an entry. */
function validateEntryInside(raw, rootPath) {
  const resolved = validatePath(raw);
  const name = path.basename(resolved);
  const parent = path.dirname(resolved);
  if (!name || name === '.' || name === '..' || parent === resolved) {
    throw new Error(`Security Error: Not a file or folder inside the project: ${resolved}`);
  }
  const root = fs.realpathSync(path.resolve(rootPath));
  const entry = path.join(validatePathInside(parent, root), name);
  const rel = path.relative(root, entry);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Security Error: Path escapes project root: ${resolved}`);
  }
  return entry;
}

/* Does the entry exist? lstat: a dangling link exists too (existsSync
   follows links and answered "no" — a rename would then have replaced
   the link). */
function lexists(p) {
  try { fs.lstatSync(p); return true; } catch (_) { return false; }
}

/* The one rule for names the app gives a file or folder. MIRROR of
   checkEntryName in src/sidebar/paths.js (the renderer's copy, which
   produces the friendly messages) — test/fs_core.entry.test.js checks
   both agree. Returns null when the name is fine, else the reason key. */
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
function checkEntryName(name) {
  const n = String(name == null ? '' : name);
  if (!n.trim()) return 'empty';
  if (n === '.' || n === '..') return 'invalid';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(n)) return 'invalid';
  if (n.startsWith('.')) return 'hidden';
  if (/[. ]$/.test(n) || n.startsWith(' ')) return 'edge';
  if (WIN_DEVICE_RE.test(n)) return 'device';
  if (/\.revery_(tmp|bak)$/i.test(n)) return 'internal';
  if (Buffer.byteLength(n, 'utf8') > 255) return 'long';
  return null;
}

function assertEntryName(name) {
  const why = checkEntryName(name);
  if (why) throw new Error(`Invalid name "${name}" (${why}).`);
}

/* Would moving the link `src` to `dest` change what it points to? Only a
   RELATIVE link moved to another folder: its target is resolved from the
   folder it sits in. Such a move is refused — it would silently turn the
   link into a pointer to something else (or to nothing). */
function linkMoveChangesTarget(src, dest) {
  let st;
  try { st = fs.lstatSync(src); } catch (_) { return false; }
  if (!st.isSymbolicLink()) return false;
  const target = fs.readlinkSync(src);
  if (path.isAbsolute(target)) return false;
  return path.resolve(path.dirname(src), target) !== path.resolve(path.dirname(dest), target);
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/* Rename or move one entry inside the project. Never overwrites, never
   copies, never deletes:
     • both paths are ENTRIES (validateEntryInside): a link is moved as a
       link, its target is never touched;
     • an existing destination is refused — except the same entry under a
       case-only different spelling (isCaseOnlyAliasOfSameFile);
     • a new name must pass checkEntryName (a pure move keeps its name);
     • a folder is never moved into itself;
     • a relative link is not moved to another folder (see above);
     • another drive or volume (EXDEV) is REFUSED. There used to be a
       copy-then-delete fallback (also for EBUSY): if deleting the
       original failed half way it left a partly emptied original. Inside
       one project that situation is rare; refusing is the only answer
       that can never lose or duplicate data;
     • a rename refused because something briefly holds a handle (Windows:
       antivirus, the indexer, a watcher being closed; any platform: EBUSY,
       e.g. a file open on another computer of an SMB share) is retried
       (isTransientLock / LOCK_RETRY_DELAYS_MS — the atomic write's policy).
   `opts.platform` / `opts.sleep` exist for the unit tests. */
async function renameEntry(oldRaw, newRaw, rootPath, opts = {}) {
  const platform = opts.platform || process.platform;
  const sleep = opts.sleep || sleepMs;
  const safeOld = validateEntryInside(oldRaw, rootPath);
  const safeNew = validateEntryInside(newRaw, rootPath);

  if (!lexists(safeOld)) throw new Error(`Source not found: ${safeOld}`);
  if (path.basename(safeNew) !== path.basename(safeOld)) assertEntryName(path.basename(safeNew));

  const inner = path.relative(safeOld, safeNew);
  if (inner && inner !== '..' && !inner.startsWith('..' + path.sep) && !path.isAbsolute(inner)) {
    throw new Error(`Cannot move "${path.basename(safeOld)}" into itself.`);
  }

  const destinationTaken = () => lexists(safeNew) && !isCaseOnlyAliasOfSameFile(safeOld, safeNew);
  if (destinationTaken()) throw new Error(`Destination already exists: ${safeNew}`);
  if (safeNew === safeOld) return; // same entry, same spelling: nothing to do

  if (linkMoveChangesTarget(safeOld, safeNew)) {
    throw new Error(`"${path.basename(safeOld)}" is a relative link. Moving it to another folder would change what it points to, so it was not moved.`);
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(safeOld, safeNew);
      return;
    } catch (err) {
      if (err && err.code === 'EXDEV') {
        throw new Error(`"${path.basename(safeOld)}" cannot be moved to another drive or volume from Revery (nothing was changed). Use your file manager for that move.`);
      }
      if (!isTransientLock(err, platform) || attempt >= LOCK_RETRY_DELAYS_MS.length) throw err;
      await sleep(LOCK_RETRY_DELAYS_MS[attempt]);
      if (!lexists(safeOld)) throw new Error(`Source not found: ${safeOld}`);
      if (destinationTaken()) throw new Error(`Destination already exists: ${safeNew}`);
    }
  }
}

/* The entry "Move to Trash" acts on, or null when it is already gone.
   The ENTRY (a link is trashed as a link, never its target). */
function trashableEntry(raw, rootPath) {
  const safe = validateEntryInside(raw, rootPath);
  return lexists(safe) ? safe : null;
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

/* ── Multi-location recovery ────────────────────────────────────────────
   The high-frequency crash backup lives in the OS temp dir — RAM-backed
   tmpfs on modern Linux, which is wear-free but erased by a reboot. The
   rare autosave-suspended states (external-change conflict hold, save-
   failure cooldown) additionally mirror to a durable directory under
   userData. Recovery must therefore consult BOTH locations and prefer
   the newest snapshot; deletion must clear both. */
function getNewestVolatileContent(dirs, originalPath) {
  let best = null;
  for (const dir of dirs) {
    const hit = getVolatileContent(dir, originalPath);
    if (hit && (!best || (hit.ts || 0) > (best.ts || 0))) best = hit;
  }
  return best;
}

/* Merge per-directory listings, keeping only the newest entry per
   originalPath, newest-first overall. */
function listVolatileBackupsMerged(dirs, prefix) {
  const byPath = new Map();
  for (const dir of dirs) {
    for (const b of listVolatileBackups(dir, prefix)) {
      const prev = byPath.get(b.originalPath);
      if (!prev || b.ts > prev.ts) byPath.set(b.originalPath, b);
    }
  }
  return [...byPath.values()].sort((a, b) => b.ts - a.ts);
}

/* Delete backup pairs older than maxAgeMs. Unreadable or malformed meta
   files are skipped, never deleted — when in doubt, keep the user's data.
   `keepPaths`: original paths whose backup must survive regardless of age.
   The purge runs on a startup timer, independently of the renderer's
   crash-recovery check, so the backup of the file that check is about to
   offer (the last opened file) must never be deleted underneath it. */
function purgeOldVolatileFiles(dir, maxAgeMs, now = Date.now(), keepPaths = []) {
  const keep = new Set((Array.isArray(keepPaths) ? keepPaths : [])
    .filter((p) => typeof p === 'string' && p.length > 0));
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
      if (typeof meta.originalPath === 'string' && keep.has(meta.originalPath)) {
        continue; // Pending recovery offer — leave it alone.
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
  writeAllSync,
  writeFileWithFsync,
  tempSiblingPath,
  TEMP_NAME_PREFIX_BYTES,
  syncParentDir,
  LOCK_RETRY_DELAYS_MS,
  isTransientLock,
  atomicWriteFile,
  readUtf8TextStrict,
  NOT_UTF8_MESSAGE,
  validatePath,
  validatePathInside,
  validateEntryInside,
  lexists,
  checkEntryName,
  assertEntryName,
  linkMoveChangesTarget,
  renameEntry,
  trashableEntry,
  isCaseOnlyAliasOfSameFile,
  sanitizeDropFilename,
  ensureVolatileDir,
  volatilePaths,
  setVolatileContent,
  getVolatileContent,
  getNewestVolatileContent,
  deleteVolatileContent,
  listVolatileBackups,
  listVolatileBackupsMerged,
  purgeOldVolatileFiles,
  createSettingsStore,
};

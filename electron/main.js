/**
 * electron/main.js — Revery Notebook Electron Main Process
 *
 * Responsibilities:
 *   • Create the BrowserWindow with a hardened security configuration
 *   • Register all IPC handlers that back the window.NativeAPI interface
 *   • Intercept the window close event so the frontend can veto it
 *   • Manage a volatile (crash-backup) file in the OS temp directory
 *   • Watch active files for external modifications
 *   • Persist the lastOpenedFile pointer in app userData
 *
 * Security posture:
 *   - nodeIntegration:    false  (renderer has no Node.js access)
 *   - contextIsolation:   true   (preload runs in isolated world)
 *   - sandbox:            true   (renderer is sandboxed)
 *   - webSecurity:        true
 *   - All IPC calls validated in main process before touching the FS
 *   - Paths are validated to prevent directory traversal attacks
 */

'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
} = require('electron');

const path  = require('path');
const fs    = require('fs');
const os    = require('os');

/* All pure file-system logic (atomic writes, path validation, volatile
   crash backups, the corruption-tolerant settings store) lives in
   fs_core.js so it can be unit tested without an Electron runtime.
   This file owns only the wiring: windows, IPC, dialogs, policy state. */
const {
  atomicWriteFile,
  syncParentDir,
  validatePath,
  validatePathInside,
  sanitizeDropFilename,
  ensureVolatileDir,
  setVolatileContent,
  getVolatileContent,
  deleteVolatileContent,
  listVolatileBackups,
  purgeOldVolatileFiles: purgeVolatileDir,
  createSettingsStore,
} = require('./fs_core');
const { buildZip } = require('./zip_core');

/* ── Constants ─────────────────────────────────────────────────────────── */
const getSettingsFile = () => path.join(app.getPath('userData'), 'revery_settings.json');
const VOLATILE_DIR    = path.join(os.tmpdir(), 'revery-volatile');

/* ── Active project root ──────────────────────────────────────────────────
   Set only by the OS folder dialog or by the restore-from-settings path.
   All FS handlers enforce that every path stays inside this root.         */
let currentRootPath = null;

function requireRoot() {
  if (!currentRootPath) {
    throw new Error('No project folder is open. Please open a folder first.');
  }
  return currentRootPath;
}



const PRELOAD_SCRIPT  = path.join(__dirname, 'preload.js');

/* ── Single instance ─────────────────────────────────────────────────────
   Two instances of the app would be two autosave writers and two file
   watchers on the same project — defeating the in-process save
   serialization and inviting lost writes. The lock is keyed on userData,
   so a second launch of the SAME profile exits immediately and the first
   window is brought to front instead.                                    */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/* ── Ensure volatile temp directory exists and is safe to use ───────────
   ensureVolatileDir (fs_core.js) verifies VOLATILE_DIR is owned by us, is
   not a symlink, and has 0700 perms before we write user-note backups into
   it. If verification fails for any reason, volatileDirReady stays false
   and the volatile IPC handlers no-op — the user just doesn't get crash
   backup this session. Primary save (the user's actual file) is unaffected. */
let volatileDirReady = false;
let volatileDirError = null;
try {
  ensureVolatileDir(VOLATILE_DIR);
  volatileDirReady = true;
} catch (err) {
  volatileDirError = err.message;
  console.error('[revery] Volatile directory check failed — crash recovery disabled this run:', err.message);
}

/* ── Persistent settings (thin layer on top of the JSON settings file) ── */
/* The store (fs_core.js) is corruption-tolerant: it falls back to
   revery_settings.json.bak when the main file is unparseable, quarantines
   the corrupt bytes, and only ever overwrites the main file with a merge
   that includes the recovered data — never with the raw patch alone.    */
const { readSettings, writeSettings } = createSettingsStore(getSettingsFile);

/* Path validation (validatePath / validatePathInside) and drop-filename
   sanitisation live in fs_core.js. All file-system IPC handlers call them
   before touching the OS. */




/* ── File watcher registry ──────────────────────────────────────────────
   Maps filePath → { watcher, timer }. The timer is the pending debounce
   from the last raw fs event; it must be cleared on stop, or a stale
   'fs:file-changed' can still be emitted for a path that was just
   unwatched (spurious "file changed externally" dialog after closing). */
const fileWatchers = new Map();

function stopWatcher(filePath) {
  const entry = fileWatchers.get(filePath);
  if (entry) {
    clearTimeout(entry.timer);
    entry.watcher.close();
    fileWatchers.delete(filePath);
  }
}


/* ── Main Window ──────────────────────────────────────────────────────── */
let mainWindow   = null;
let allowClose   = false;  // Flipped by frontend calling 'window:confirm-close'

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'Revery Notebook',
    /* Frameless window:
       - macOS  → titleBarStyle 'hiddenInset' keeps native traffic-light buttons
                  but hides the OS title bar; our custom drag region takes over.
       - Win/Linux → frame:false removes the OS chrome completely; our HTML
                  title bar provides Min / Max / Close buttons instead.       */
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' }
      : { frame: false }
    ),
    webPreferences: {
      preload:          PRELOAD_SCRIPT,
      nodeIntegration:  false,   // NEVER enable
      contextIsolation: true,    // ALWAYS keep true
      sandbox:          true,    // Renderer process is sandboxed
      webSecurity:      true,
      devTools:         !app.isPackaged,
    },
  });

  /* Load the app. In production load from the built dist folder.
     In dev, load from the local file (same as current web setup).       */
mainWindow.loadFile(path.join(__dirname, '..', 'www', 'index.html'));

  /* ── Never navigate, never open links ───────────────────────────────────
     Policy (CLAUDE.md "Must fix"): the app must never open links or act as
     a browser. Navigating the BrowserWindow away from the app would also
     destroy all unsaved in-memory state, and the frameless UI would leave
     the user stranded on the external page with no window controls.
     The preview's click guard already blocks link clicks and shows the
     "External links are disabled" toast; these two hooks are the
     platform-level backstop for every other vector (URLs dropped onto the
     window, window.open / target="_blank", location assignment from any
     script). Nothing is forwarded to the OS browser.
     will-navigate fires for same-frame navigations (standard link clicks).
     setWindowOpenHandler fires for target="_blank" and window.open() calls. */

mainWindow.webContents.on('will-navigate', (event, url) => {
  /* Allow reloads of the currently loaded page (window.location.reload()
     from the renderer, Ctrl+R when devTools are enabled, etc.). Without
     this guard the unconditional preventDefault() below also cancels
     reloads, which silently breaks any code path that calls reload() —
     e.g. the Total Reset flow in markdown_editor_actions_cm.js.        */
  if (url === event.sender.getURL()) return;

  event.preventDefault();
  console.warn('[revery] Blocked navigation attempt to:', url);
});

mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  console.warn('[revery] Blocked window.open attempt to:', url);
  return { action: 'deny' };
});

  /* ── Intercept the OS close button ── */
  mainWindow.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault();
      /* Signal the renderer that a close is requested */
      mainWindow.webContents.send('window:close-request');
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  /* A second instance is already quitting — never create its window. */
  if (!gotSingleInstanceLock) return;

  createWindow();



  // --- SECURITY MIGRATION: Grandfather existing projects into the trusted whitelist ---
  // Runs ONCE per install, gated by trustedRootsMigrated. On a fresh install
  // there's nothing to migrate; we still set the flag so this never runs again.
  // After this point, trustedRoots is extended ONLY by:
  //   - dialog:open-folder           (user picks a folder via the OS dialog)
  //   - app:get-default-notes-folder (backend-generated path)
  // The renderer cannot extend trustedRoots, so a compromised renderer that
  // injects malicious paths into projectHistory will never see them trusted
  // on a subsequent launch.
  try {
    const settings = readSettings();
    if (settings.trustedRootsMigrated !== true) {
      const lastRoot = settings.lastRootPath;
      const projectHistory = Array.isArray(settings.projectHistory) ? settings.projectHistory : [];
      const trustedRoots = Array.isArray(settings.trustedRoots) ? settings.trustedRoots : [];

      // 1. Trust the last opened path
      if (lastRoot && typeof lastRoot === 'string' && !trustedRoots.includes(lastRoot)) {
        trustedRoots.push(lastRoot);
      }

      // 2. Trust all paths in project history
      projectHistory.forEach(item => {
        const p = typeof item === 'string' ? item : item.path;
        if (p && typeof p === 'string' && !trustedRoots.includes(p)) {
          trustedRoots.push(p);
        }
      });

      // Always set the flag — even on a fresh install with nothing to migrate —
      // so the migration block is never re-entered for this user profile.
      writeSettings({ trustedRoots, trustedRootsMigrated: true });
    }
  } catch (err) {
    console.error('Failed to migrate trustedRoots:', err);
  }





  // Defer cleanup so the renderer's crash-recovery check finishes first.
  // Any backup the renderer will consume is either deleted by the recovery
  // flow itself, or is younger than VOLATILE_MAX_AGE_MS and left intact.
  setTimeout(purgeOldVolatileFiles, 5000);
});

const VOLATILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function purgeOldVolatileFiles() {
  // If the dir failed its startup safety check, do not enumerate or delete
  // anything — we don't own it. A planted symlink would otherwise let this
  // purge walk into (and delete matching files from) a directory the
  // attacker chose. Mirrors the guard in Rust's purge_old_volatile_files().
  if (!volatileDirReady) return;
  purgeVolatileDir(VOLATILE_DIR, VOLATILE_MAX_AGE_MS);
}


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});


/* ══════════════════════════════════════════════════════════════════════════
   IPC HANDLERS — backed by NativeAPI in preload.js
   All handlers follow the pattern: validate → operate → return result.
   Errors are thrown so ipcMain.handle propagates them as rejections,
   which preload.js surfaces as rejected Promises to the frontend.
══════════════════════════════════════════════════════════════════════════ */


/* ── Folder dialog ────────────────────────────────────────────────────── */
ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Project Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  
  const chosenPath = result.filePaths[0];

  // SECURITY FIX: Add user-selected folders to trustedRoots
  const settings = readSettings();
  const trustedRoots = Array.isArray(settings.trustedRoots) ? settings.trustedRoots : [];
  
  // Use path.resolve to prevent duplicates of the same path with different formatting
  const normalizedChosen = path.resolve(chosenPath);
  const alreadyTrusted = trustedRoots.some(t => {
    try { return path.resolve(t) === normalizedChosen; } catch { return false; }
  });

  if (!alreadyTrusted) {
    trustedRoots.push(chosenPath);
    writeSettings({ trustedRoots });
  }

  // Store the root — this is the only place a new root can be established
  // from the OS side. The path came from a native dialog, not the renderer.
  currentRootPath = chosenPath;
  return currentRootPath;
});

/* ── Restore root from persisted settings ─────────────────────────────────
   Called by the frontend on startup when getLastOpenedFile() returns a path.
   Validates that the path is an existing directory before accepting it.    */
ipcMain.handle('fs:set-root-path', (_event, dirPath) => {
  const resolved = validatePath(dirPath);          // null-byte / type check
  const stat = fs.statSync(resolved);              // must exist
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  
  // SECURITY FIX: Verify path against backend-verified trusted roots
  const settings = readSettings();
  const trustedRoots = Array.isArray(settings.trustedRoots) ? settings.trustedRoots : [];
  
  // Use path.resolve to compare paths accurately (handles trailing slashes & exact OS matches)
  const isTrusted = trustedRoots.some(trustedPath => {
    try { 
      return path.resolve(trustedPath) === resolved; 
    } catch { 
      return false; 
    }
  });

  if (!isTrusted) {
    console.error(`BLOCKED: Unauthorized root path attempt: ${resolved}`);
    throw new Error(`Security Error: This folder has not been authorized by the user.`);
  }

  currentRootPath = resolved;
});

/* ── Read directory ───────────────────────────────────────────────────── */
ipcMain.handle('fs:read-directory', (_event, dirPath) => {
  const safe = validatePathInside(dirPath, requireRoot());
  const entries = fs.readdirSync(safe, { withFileTypes: true });

  const result = entries
    .map(entry => {
      const entryPath = path.join(safe, entry.name);
      let mtime = 0, ctime = 0;
      try {
        const st = fs.statSync(entryPath);
        mtime = st.mtimeMs;
        /* birthtimeMs is 0 on Linux (no birthtime); fall back to mtime */
        ctime = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
      } catch { /* permission denied or race — leave as 0 */ }
      return {
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'dir' : 'file',
        mtime,
        ctime,
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return result;
});


/* ── Read file ────────────────────────────────────────────────────────── */
ipcMain.handle('fs:read-file', (_event, filePath) => {
  const safe = validatePathInside(filePath, requireRoot());
  /* Safety: reject files larger than 20 MB to protect the renderer */
  const stat = fs.statSync(safe);
  if (stat.size > 20 * 1024 * 1024) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`);
  }
  return fs.readFileSync(safe, 'utf8');
});



/* ── Write file ───────────────────────────────────────────────────────── */
ipcMain.handle('fs:write-file', (_event, filePath, content) => {
  if (typeof content !== 'string') throw new Error('Content must be a string');
  const safe = validatePathInside(filePath, requireRoot());
  atomicWriteFile(safe, content);
});


/* ── Copy an external (dropped) file into a folder inside the root ───────
   `contentB64` is the file's bytes as base64 — identical wire format to the
   Tauri backend, so native_api.js stays platform-agnostic. Never overwrites:
   a colliding name auto-increments to "name (1).ext". The destination is
   always freshly created (O_EXCL 'wx'), so existing files are never at risk. */
ipcMain.handle('fs:copy-into-folder', (_event, destDir, filename, contentB64) => {
  if (typeof contentB64 !== 'string') throw new Error('File data must be a base64 string');

  const root = requireRoot();
  const dir  = validatePathInside(destDir, root);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`Destination is not a folder: ${dir}`);

  const name = sanitizeDropFilename(filename);

  if (contentB64.length > 28 * 1024 * 1024) throw new Error('File too large. Max is 20 MB.');
  const buffer = Buffer.from(contentB64, 'base64');
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max is 20 MB.`);
  }

  const lastDot = name.lastIndexOf('.');
  const hasExt  = lastDot > 0;
  const base    = hasExt ? name.substring(0, lastDot) : name;
  const ext     = hasExt ? name.substring(lastDot)    : '';

  let counter = 0, finalPath, fd;
  for (;;) {
    const candidateName = counter === 0 ? name : `${base} (${counter})${ext}`;
    const candidate = validatePathInside(path.join(dir, candidateName), root);
    try {
      fd = fs.openSync(candidate, 'wx'); // O_CREAT | O_EXCL — fails if it exists
      finalPath = candidate;
      break;
    } catch (err) {
      if (err.code === 'EEXIST') {
        if (++counter > 9999) throw new Error('Too many name collisions in destination folder');
        continue;
      }
      throw err;
    }
  }

  try {
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.rmSync(finalPath, { force: true }); } catch (_) {} // brand-new → safe
    throw err;
  }
  try { fs.closeSync(fd); } catch (_) {}
  syncParentDir(finalPath);

  return { name: path.basename(finalPath), path: finalPath };
});


/* ── Create file ──────────────────────────────────────────────────────── */
ipcMain.handle('fs:create-file', (_event, filePath) => {
  const safe = validatePathInside(filePath, requireRoot());
  let fd;
  try {
    fd = fs.openSync(safe, 'wx'); // O_CREAT | O_EXCL — fails if it exists
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`File already exists: ${safe}`);
    throw err;
  }
  try { fs.closeSync(fd); } catch (_) {}
});
/* ── Create directory ─────────────────────────────────────────────────── */
ipcMain.handle('fs:create-directory', (_event, dirPath) => {
  const safe = validatePathInside(dirPath, requireRoot());

  fs.mkdirSync(safe, { recursive: true });
});




/* ── Rename node (file or directory) ─────────────────────────────────── */
// Note the added 'async' to the handler function
ipcMain.handle('fs:rename-node', async (_event, oldPath, newPath) => {
  const root = requireRoot();
  const safeOld = validatePathInside(oldPath, root);
  const safeNew = validatePathInside(newPath, root);
  
  // SECURITY FIX: Prevent renaming or moving the project root
  if (safeOld === path.resolve(root)) {
    throw new Error('Security Error: Cannot move or rename the project root folder.');
  }

  // Fast synchronous checks for existence before heavy lifting
  if (!fs.existsSync(safeOld)) throw new Error(`Source not found: ${safeOld}`);
  if (fs.existsSync(safeNew))  throw new Error(`Destination already exists: ${safeNew}`);

  try {
    await fs.promises.rename(safeOld, safeNew);
  } catch (err) {
    if (err.code === 'EXDEV' || err.code === 'EBUSY') {

      // ── Step 1: Copy ─────────────────────────────────────────────────
      try {
        await fs.promises.cp(safeOld, safeNew, { recursive: true, verbatimSymlinks: true });
      } catch (cpErr) {
        try { await fs.promises.rm(safeNew, { recursive: true, force: true }); } catch (_) {}
        throw cpErr;
      }

      // Post-copy sanity check
      const destStat = await fs.promises.stat(safeNew).catch(() => null);
      if (!destStat) {
        throw new Error(
          `Cross-device copy reported success but destination "${safeNew}" ` +
          `does not exist. The original at "${safeOld}" has not been modified.`
        );
      }

      // ── Step 2: Delete original ──────────────────────────────────────────
      try {
        await fs.promises.rm(safeOld, { recursive: true, force: true });
      } catch (rmErr) {
        const oldGone = !fs.existsSync(safeOld);

        if (!oldGone) {
          throw new Error(
            `Move incomplete: the item was copied to "${safeNew}" but the ` +
            `original at "${safeOld}" could not be fully deleted (it may be ` +
            `locked by another program). Both locations contain your data. ` +
            `Please verify both paths and remove the duplicate manually. ` +
            `Details: ${rmErr.message}`
          );
        }

        // Original is gone — attempt to restore from the copy.
        try {
          await fs.promises.cp(safeNew, safeOld, { recursive: true, verbatimSymlinks: true });
          try { await fs.promises.rm(safeNew, { recursive: true, force: true }); } catch (_) {}
          throw new Error(
            `Move failed and was rolled back: the original at "${safeOld}" was ` +
            `temporarily deleted but has been restored from the copy. No data was ` +
            `lost. Please try the move again. Details: ${rmErr.message}`
          );
        } catch (rollbackErr) {
          if (rollbackErr.message.startsWith('Move failed and was rolled back:')) {
            throw rollbackErr;
          }
          throw new Error(
            `Move partially failed: your data was copied to "${safeNew}" but ` +
            `the original could not be deleted and automatic recovery also failed. ` +
            `"${safeNew}" is your only complete copy — please move it manually ` +
            `to the intended location. ` +
            `Delete error: ${rmErr.message} | Recovery error: ${rollbackErr.message}`
          );
        }
      }
    } else {
      throw err; 
    }
  }
});


/* ── Delete node (move to OS trash) ──────────────────────────────────────
   shell.trashItem moves the item to the OS trash (Recycle Bin on Windows,
   Trash on macOS, XDG-spec trash on Linux). Available since Electron 12.
   The user can restore the item from their system trash UI.            */
ipcMain.handle('fs:delete-node', async (_event, targetPath) => {
  const root = requireRoot();
  const safe = validatePathInside(targetPath, root);

  // SECURITY: Prevent trashing of the project root
  if (safe === path.resolve(root)) {
    throw new Error('Security Error: Cannot delete the project root folder.');
  }

  if (!fs.existsSync(safe)) return; // Already gone — preserve idempotency

  // We deliberately do NOT fall back to fs.rmSync / fs.unlinkSync if
  // shell.trashItem rejects — silent permanent deletion would defeat the
  // safety net this whole change is meant to provide. Surface the error
  // to the renderer instead, which already has a console.error path.
  await shell.trashItem(safe);
});

/* ── Volatile (crash backup) write ───────────────────────────────────── */
ipcMain.handle('fs:set-volatile-content', (_event, originalPath, content) => {
  if (typeof originalPath !== 'string') return; // same guard as get/delete
  if (typeof content !== 'string') throw new Error('Content must be a string');
  if (!volatileDirReady) return;          // graceful no-op — dir failed its safety check
  setVolatileContent(VOLATILE_DIR, originalPath, content);
});



/* Reports whether the volatile (crash-backup) directory passed its startup
   safety check. Renderer surfaces the result in a status badge. Source of
   truth lives in volatileDirReady / volatileDirError above. */
ipcMain.handle('fs:get-volatile-status', () => {
  return { ready: volatileDirReady, error: volatileDirError };
});

ipcMain.handle('fs:list-volatile-backups', (_event, prefix) => {
  if (typeof prefix !== 'string' || prefix.length === 0) return [];
  if (!volatileDirReady) return [];
  return listVolatileBackups(VOLATILE_DIR, prefix);
});

/* ── Volatile (crash backup) read ────────────────────────────────────── */
ipcMain.handle('fs:get-volatile-content', (_event, originalPath) => {
  if (typeof originalPath !== 'string') return null;
  if (!volatileDirReady) return null;   // dir not safe → treat as "no backup"
  return getVolatileContent(VOLATILE_DIR, originalPath);
});


/* ── Volatile (crash backup) delete ─────────────────────────────────── */
ipcMain.handle('fs:delete-volatile-content', (_event, originalPath) => {
  if (typeof originalPath !== 'string') return;
  if (!volatileDirReady) return;        // nothing of ours to delete
  deleteVolatileContent(VOLATILE_DIR, originalPath);
});

/* ── Native message box ───────────────────────────────────────────────── */
ipcMain.handle('dialog:show-message-box', async (_event, options) => {
  /* Whitelist only safe dialog properties */
  const buttons = Array.isArray(options.buttons) ? options.buttons.map(String).slice(0, 8) : ['OK'];
  /* Out-of-range indices would make Electron's focus/Escape behaviour
     silently undefined — only accept indices that name a real button. */
  const validIdx = (v) => Number.isInteger(v) && v >= 0 && v < buttons.length;
  const safeOptions = {
    type:      ['none','info','question','warning','error'].includes(options.type) ? options.type : 'info',
    buttons,
    defaultId: validIdx(options.defaultId) ? options.defaultId : 0,
    cancelId:  validIdx(options.cancelId)  ? options.cancelId  : undefined,
    title:     String(options.title   || '').substring(0, 100),
    message:   String(options.message || '').substring(0, 500),
    detail:    String(options.detail  || '').substring(0, 1000),
  };
  return dialog.showMessageBox(mainWindow, safeOptions);
});



/* ── Export / Save-As dialog ──────────────────────────────────────────── */
/* Shows a native OS Save dialog, then writes the file atomically.
   Returns { saved: true, filePath } on success, { saved: false } on cancel.
   The frontend only shows "File saved" when saved === true.               */
ipcMain.handle('dialog:save-file', async (_event, defaultFilename, content, options) => {

  if (typeof content !== 'string') throw new Error('Content must be a string');

  /* Build a file-type filter from the extension so the OS picker is helpful */
  const ext = path.extname(defaultFilename).slice(1).toLowerCase();
  const filterMap = {
    md:   { name: 'Markdown', extensions: ['md'] },
    txt:  { name: 'Text',     extensions: ['txt'] },
    html: { name: 'HTML',     extensions: ['html', 'htm'] },
    tex:  { name: 'LaTeX',    extensions: ['tex'] },
  };
  const primaryFilter = filterMap[ext] || { name: 'All Files', extensions: ['*'] };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultFilename,
    filters: [primaryFilter, { name: 'All Files', extensions: ['*'] }],
  });

  /* User cancelled — report back cleanly, nothing written */
  if (result.canceled || !result.filePath) {
    return { saved: false };
  }

  /* Atomic write — same code path as fs:write-file (fs_core.atomicWriteFile) */
  const safe = validatePath(result.filePath);
  atomicWriteFile(safe, content);

  // Mirror what openFolderDialog does: grant this directory as a trusted root
  // so subsequent auto-saves via writeFile (which enforces validatePathInside)
  // accept the new path. The path came from a native OS dialog, so user consent
  // is established — same justification as openFolderDialog.
  const newDir = path.dirname(safe);
  const s = readSettings();
  const tr = Array.isArray(s.trustedRoots) ? s.trustedRoots : [];
  const normalizedNewDir = path.resolve(newDir);
  const alreadyTrusted = tr.some(t => {
    try { return path.resolve(t) === normalizedNewDir; } catch { return false; }
  });
  if (!alreadyTrusted) {
    tr.push(newDir);
    writeSettings({ trustedRoots: tr });
  }
  // Only pivot the active project root when the caller explicitly opts in.
  // Exports (HTML, LaTeX, MD copy) must NOT change currentRootPath — doing so
  // causes all subsequent autosaves to fail with "Security Error: Path escapes
  // project root" because the project file is no longer inside the export dir.
  if (options && options.updateRoot === true) {
    currentRootPath = newDir;
  }
  return { saved: true, filePath: result.filePath, newRootPath: newDir };
});

/* ── Zip project export ───────────────────────────────────────────────────
   Reads ONLY inside the trusted project root (zip_core.walkProject skips
   symlinks, so a link can't leak outside files into the archive). The
   destination comes exclusively from the OS save dialog below — the
   renderer passes nothing. The archive is written through the same
   atomicWriteFile path as documents, so a crash can never leave a
   truncated zip at the destination. No password option by design:
   classic zip encryption is cryptographically broken and would only
   pretend to protect the notes. */
ipcMain.handle('project:export-zip', async () => {
  const root = requireRoot();
  const folderName = path.basename(root) || 'project';
  const stamp = new Date().toISOString().slice(0, 10);

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${folderName}_${stamp}.zip`,
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const dest = validatePath(result.filePath);
  const { buffer, entries, bytes } = buildZip(root, { excludePath: dest });
  atomicWriteFile(dest, buffer);
  return { ok: true, path: dest, entries, bytes };
});

/* ── Window lifecycle ─────────────────────────────────────────────────── */
ipcMain.handle('window:confirm-close', () => {
  allowClose = true;
  if (mainWindow) mainWindow.close();
});

/* ── Frameless window controls ────────────────────────────────────────── */

/* Minimize to taskbar / dock. */
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

/* Toggle maximized ↔ restored. */
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

/* Request a close — re-enters the existing 'close' event listener, which
   sends 'window:close-request' to the renderer so the quit modal appears.
   This is intentionally identical to the user clicking the OS close button. */
ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

/* Enter or exit native OS fullscreen mode. */
ipcMain.handle('window:set-fullscreen', (_event, fullscreen) => {
  if (mainWindow) mainWindow.setFullScreen(fullscreen);
});

/* ── File watcher ─────────────────────────────────────────────────────── */
/* We watch the PARENT directory and filter events by filename, NOT the file
   itself. Reasoning: on Linux, fs.watch on a single file attaches to that
   inode via inotify. Our atomic-rename writes (tmp → safe) replace the inode,
   so the watcher silently goes deaf to every subsequent external change.
   Watching the parent directory is stable across atomic replacements. The
   pattern works the same on macOS/Windows. */
ipcMain.handle('fs:watch-file', (_event, filePath) => {

  const safe = validatePathInside(filePath, requireRoot());
  stopWatcher(filePath); // Remove any existing watcher for this path

  const parent     = path.dirname(safe);
  const targetName = path.basename(safe);

  const entry = { watcher: null, timer: null };
  entry.watcher = fs.watch(parent, (eventType, filename) => {
    /* fs.watch on a directory passes the changed entry's filename as the
       second arg. On Windows this can occasionally be null for directory-
       level events — skip those. */
    if (!filename || filename !== targetName) return;

    /* Debounce: rapid successive events (e.g. editor auto-save) fire once */
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        // Normalise eventType to 'modify' so the frontend catches it
        // (Node emits 'change'/'rename', frontend expects 'modify').
        // payload.path MUST be the renderer's own string — see note above.
        mainWindow.webContents.send('fs:file-changed', { path: filePath, eventType: 'modify' });
      }
    }, 300);
  });

  entry.watcher.on('error', (err) => {
    console.warn('[Watcher] Error watching', parent, 'for', targetName, err.message);
    stopWatcher(filePath);
  });

  fileWatchers.set(filePath, entry);
});


ipcMain.handle('fs:unwatch-file', (_event, filePath) => {
  /* Registry is keyed on the renderer's exact string (see fs:watch-file).
     Removal-only — no FS access — so no path validation is required. */
  if (typeof filePath === 'string') stopWatcher(filePath);
});

/* ── Last opened file pointer ─────────────────────────────────────────── */
ipcMain.handle('settings:get-last-opened-file', () => {
  return readSettings().lastOpenedFile || null;
});

ipcMain.handle('settings:set-last-opened-file', (_event, filePath) => {
  writeSettings({ lastOpenedFile: filePath });
});

/* ── Rename journal (Cluster C #5) ──────────────────────────────────────
   See project_sidebar.js renameActiveFileFromTitle and the boot recovery
   block. The renderer writes a pendingRename entry before renaming the
   active file so a crash mid-rename can be reconciled on next launch. */

ipcMain.handle('settings:get-pending-rename', () => {
  const j = readSettings().pendingRename;
  if (j && typeof j.from === 'string' && typeof j.to === 'string') {
    return { from: j.from, to: j.to, ts: typeof j.ts === 'number' ? j.ts : 0 };
  }
  return null;
});

ipcMain.handle('settings:set-pending-rename', (_event, journal) => {
  if (journal === null || journal === undefined) {
    writeSettings({ pendingRename: null });
    return;
  }
  if (typeof journal === 'object'
      && typeof journal.from === 'string'
      && typeof journal.to   === 'string') {
    writeSettings({
      pendingRename: {
        from: journal.from,
        to:   journal.to,
        ts:   Number(journal.ts) || Date.now(),
      },
    });
  }
  // Else: malformed input — silently ignore. Defensive: never write garbage.
});


ipcMain.handle('settings:clear-all', () => {
  /* Preserve folder-access state on Total Reset. Clearing trustedRoots
     would revoke the OS-level read scope the user explicitly granted via
     the open-folder dialog; clearing lastRootPath / projectHistory would
     make the app forget every project they had open. Total Reset is for
     editor preferences/state, not for re-onboarding folder access.      */
  const PRESERVE = new Set([
    'lastRootPath',
    'projectHistory',
    'trustedRoots',
    'trustedRootsMigrated',
  ]);

  const current = readSettings();
  const wipe = {};
  for (const k of Object.keys(current)) {
    if (!PRESERVE.has(k)) wipe[k] = null;
  }
  /* writeSettings does a `{ ...base, ...patch }` merge, so any key omitted
     from `wipe` keeps its existing value. PRESERVE keys are intentionally
     omitted; everything else is explicitly nulled. */
  writeSettings(wipe);
});
 

ipcMain.handle('settings:get-last-root-path', () => {
  return readSettings().lastRootPath || null;
});

ipcMain.handle('settings:set-last-root-path', (_event, dirPath) => {
  writeSettings({ lastRootPath: dirPath || null });
});

ipcMain.handle('settings:get-project-history', () => {
  const h = readSettings().projectHistory;
  return Array.isArray(h) ? h : [];
});

ipcMain.handle('settings:set-project-history', (_event, arr) => {
  if (Array.isArray(arr)) writeSettings({ projectHistory: arr });
});

/* ── App data path (exposed for diagnostics) ────────────────────────── */
ipcMain.handle('app:get-data-path', () => {
  return app.getPath('userData');
});

/* ── Show item in OS file manager ─────────────────────────────────────
   Uses Electron's shell.showItemInFolder which works cross-platform:
     macOS   → Finder, item selected
     Windows → Explorer, item selected
     Linux   → file manager opens containing folder               */
ipcMain.handle('shell:show-in-folder', (_event, itemPath) => {
  const safe = validatePathInside(itemPath, requireRoot());
  shell.showItemInFolder(safe);
});


/* ── Default notes folder ─────────────────────────────────────────────
   Returns the platform-appropriate path for the default "revery_notebook_notes"
   folder, and ensures it exists. This is used on first launch when the user
   has not yet opened their own folder.
   Paths by OS:
     Linux/macOS  → ~/Documents/revery_notebook_notes
     Windows      → C:\Users\<user>\Documents\revery_notebook_notes      */
ipcMain.handle('app:get-default-notes-folder', () => {
  const docsDir  = app.getPath('documents');
  const notesDir = path.join(docsDir, 'revery_notebook_notes');
  try {
    fs.mkdirSync(notesDir, { recursive: true });

    // SECURITY FIX: Add default generated notes folder to trustedRoots
    const settings = readSettings();
    const trustedRoots = Array.isArray(settings.trustedRoots) ? settings.trustedRoots : [];
    
    const normalizedNotesDir = path.resolve(notesDir);
    const alreadyTrusted = trustedRoots.some(t => {
      try { return path.resolve(t) === normalizedNotesDir; } catch { return false; }
    });

    if (!alreadyTrusted) {
      trustedRoots.push(notesDir);
      writeSettings({ trustedRoots });
    }
  } catch (e) {
    console.warn('[main] Could not create default notes folder:', e.message);
  }
  return notesDir;
});
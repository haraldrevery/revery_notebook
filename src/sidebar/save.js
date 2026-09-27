/* save.js — the save engine: dirty tracking, the serialized save chain,
   auto-save scheduling, inline title rename, editor input wiring.
   This is the single source of truth for all disk writes of the active
   file. Treat every ordering comment in here as load-bearing. */
import { S, docTitleEl, folderNameEl, treeEl, expandedDirs, _previewCache,
         SCRATCHPAD_PREFIX, ensureScratchpadVolatileKey,
         pendingNoteDir, sidebarPanel } from './state.js';
import { uniquePath, stripMarkdownForPreview, fileExistsViaListing } from './helpers.js';
import { baseNameOf, pathKey, samePath, sanitizeEntryName, checkEntryName } from './paths.js';
import { detectEol, normalizeEol, toDiskText } from './eol.js';
import { renderTree, highlightActiveFile } from './tree.js';
import { startWatchingFile, stopWatchingFile, checkActiveFileOnDisk } from './watcher.js';
import { pushUndo, hasUndoOperations, undoLastOperation, clearUndoStack,
         showNameProblem } from './fileops.js';
import { recordProjectOpen } from './projects.js';

/* ── Save-engine local state ─────────────────────────────────────── */
let _autoSaveTimer = null;
/* Auto-save cadence. Slow hardware mode stretches both intervals so a
   slow disk sees fewer fsync'd writes — each write keeps the identical
   atomic + fsync durability. Read at call time: toggling the setting
   applies to the very next keystroke, no restart needed.               */
function autosaveDelayMs()   { return window.slowHardwareMode ? 4000  : 1500; }
function autosaveMaxWaitMs() { return window.slowHardwareMode ? 20000 : 10000; } // force save during continuous editing
const AUTOSAVE_FAILURE_COOLDOWN_MS   = 30000; // After a save failure, suppress
                                              // automatic retries for 30 s.

/** Cancel any pending debounced auto-save (watcher + close flow use this). */
export function cancelPendingAutoSave() { clearTimeout(_autoSaveTimer); }

let _diskOpsChain = Promise.resolve();

export function _enqueueDiskOp(op) {
  const next = _diskOpsChain.then(() => op(), () => op());
  // Anchor _diskOpsChain to the *settled* outcome so a thrown error
  // inside op doesn't break FIFO for subsequent enqueues.
  _diskOpsChain = next.then(() => {}, () => {});
  return next;
}

/* ── Paths the open note has LEFT through our own operations ──────────
   A move, rename or delete of the open note runs inside the disk lock
   (_enqueueDiskOp), so every write queued BEFORE it lands first. A save
   that captured the old path and queued its write AFTER it must not
   write there: that recreated the note at its old place (a stale twin
   beside the moved note) or resurrected a deleted one. Such a write is
   skipped and the buffer stays dirty, so the next autosave writes it to
   wherever the note is now. A path leaves this set when a note is opened
   or created there again. */
const _goneActivePaths = new Set();
export function markActivePathGone(p) { if (p) _goneActivePaths.add(pathKey(p)); }
export function forgetGonePath(p)     { if (p) _goneActivePaths.delete(pathKey(p)); }

let _firstDirtyTime          = 0;
let _autoSaveCooldownUntil   = 0;
let _scratchpadFailureWarned = false;

/* ── Scratchpad → file sessions ──────────────────────────────────────
   Typing with no note open creates one (see the input listener). One
   SESSION per scratchpad document — identified by the editor's document
   generation, which changes whenever a different document is loaded
   (cm_setup.js "Document identity"). A session owns its crash-backup key
   and the latest text typed into it. Creating the file takes several
   awaits; if the user loads another document meanwhile (opens a file,
   previews an image), the session DETACHES: its own text goes into the
   new file and the editor is left alone. It never binds the new file to a
   document that is no longer on screen, and never writes another
   document's text into it. (The openers do not get that far: they wait
   for the note first — see scratchpadToNote.) */
let _scratch = null; // { gen, key, latest, creating, promise, retryAfter, failed, lastError, quiet }
const SCRATCHPAD_RETRY_MS = 5000; // after a failed create, wait before retrying

function currentDocGeneration() {
  return (typeof window.getEditorDocGeneration === 'function') ? window.getEditorDocGeneration() : 0;
}

function scratchpadSession() {
  const gen = currentDocGeneration();
  if (_scratch && _scratch.gen === gen) return _scratch;
  /* A new scratchpad document. Reuse the live placeholder key only when no
     earlier session owns it (boot recovery adopts an old backup's key as
     the live one); otherwise take a fresh key, so an earlier session's
     backup — possibly the only copy of its text — is never overwritten. */
  if (S._scratchpadVolatileKey && _scratch && _scratch.key === S._scratchpadVolatileKey) {
    S._scratchpadVolatileKey = null;
  }
  _scratch = { gen, key: ensureScratchpadVolatileKey(), latest: '', creating: false, promise: null,
               retryAfter: 0, failed: false, lastError: '', quiet: false };
  return _scratch;
}

/* The session's text is in a file now (or its document is gone): it no
   longer owns the placeholder key. The caller deletes the backup once that
   is safe. */
function releaseScratchSession(session) {
  if (_scratch === session) _scratch = null;
  if (S._scratchpadVolatileKey === session.key) S._scratchpadVolatileKey = null;
}

/** Text typed with no note open whose note does not exist yet: the
    scratchpad session of the document on screen, while it holds text.
    Null when there is none. */
function pendingScratchpad() {
  if (S.activeFilePath || window._showingUnsupportedFile) return null;
  const s = _scratch;
  if (!s || s.gen !== currentDocGeneration()) return null;
  return editor.value.trim() ? s : null;
}

function scratchpadCreateFailed(session, err, emptyFileToRemove) {
  console.error('[Sidebar] scratchpad auto-create failed:', err);
  session.creating   = false;
  session.retryAfter = Date.now() + SCRATCHPAD_RETRY_MS;
  session.failed     = true;
  session.lastError  = String(err);
  /* Until the note exists, the backup in the OS temp dir is this text's
     only copy — and that dir is emptied by a reboot on many Linux systems.
     Mirror it to the durable slot too (kept fresh by the input listener
     while the note is still missing; boot recovery reads both). */
  writeDurableSnapshot(session.key,
    currentDocGeneration() === session.gen ? editor.value : session.latest);
  /* createFile succeeded but nothing could be written: that file is ours,
     brand new and empty — move it to the trash so repeated retries (disk
     full, no permission) cannot litter the folder with empty untitled
     files. The placeholder backup is kept in every failure case. */
  if (emptyFileToRemove) window.NativeAPI.deleteNode(emptyFileToRemove).catch(() => {});
  /* quiet: an opener is waiting for this note and tells the user itself. */
  if (!session.quiet && !_scratchpadFailureWarned) {
    _scratchpadFailureWarned = true;
    window.NativeAPI.showMessageBox({
      type: 'warning',
      title: window.t('Could Not Create File'),
      message: window.t('A file could not be created to save your work.'),
      detail: String(err) + '\n\nYour typed content is still visible but has not been saved to disk. The app will retry automatically when you keep typing.',
      buttons: ['OK'],
      defaultId: 0,
    }).catch(() => {}); // ignore if the dialog itself fails
  }
}

function createNoteFromScratchpad(session, targetDir, baseName) {
  session.creating = true;
  /* Is this session's document still on screen, still without a file? */
  const attached = () => currentDocGeneration() === session.gen
    && !S.activeFilePath && !window._showingUnsupportedFile;

  session.promise = (async () => {
    let newPath = null;
    try {
      newPath = await uniquePath(targetDir, baseName, 'md');
      await window.NativeAPI.createFile(newPath);
    } catch (err) {
      scratchpadCreateFailed(session, err, null);
      return;
    }

    let written;
    let wroteOnce = false;
    try {
      written = attached() ? editor.value : session.latest;
      await window.NativeAPI.writeFile(newPath, written);
      wroteOnce = true;
      /* The document was swapped while that write ran: keystrokes typed
         before the swap can be newer than `written` — write them too. */
      if (!attached() && session.latest !== written) {
        written = session.latest;
        await window.NativeAPI.writeFile(newPath, written);
      }
    } catch (err) {
      scratchpadCreateFailed(session, err, wroteOnce ? null : newPath);
      return;
    }

    session.creating = false;
    _scratchpadFailureWarned = false;

    if (!attached()) {
      /* DETACHED — the text is safely in newPath and the editor shows
         another document, so nothing is bound. Only now may the backup go. */
      releaseScratchSession(session);
      window.NativeAPI.deleteVolatileContent(session.key).catch(() => {});
      expandedDirs.add(targetDir);
      await renderTree();
      if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
      if (typeof window.showStatusWarning === 'function') {
        window.showStatusWarning('scratchpad-detached',
          window.t('Your text was saved as "{name}".').replace('{name}', baseNameOf(newPath)),
          { priority: 30, ttl: 6000 });
      }
      return;
    }

    /* ATTACHED — bind now: no await between the check above and here. */
    S.activeFilePath   = newPath;
    forgetGonePath(newPath);
    S.previewMediaPath = null; // the preview became this note
    rememberDiskContent(written); // what the new file holds (LF, a new note)
    releaseScratchSession(session);

    let placeholderStillNeeded = false;
    if (editor.value !== written) {
      /* Keystrokes arrived during creation: the normal autosave takes them.
         Back them up under the note's own key BEFORE the placeholder goes,
         so there is never a moment without a backup. */
      markDirty();
      scheduleAutoSave();
      try {
        await window.NativeAPI.writeVolatileNow(newPath, editor.value);
      } catch (e) {
        console.warn('[Sidebar] note backup after scratchpad create failed (placeholder kept):', e);
        placeholderStillNeeded = true;
      }
    }
    if (!placeholderStillNeeded) {
      window.NativeAPI.deleteVolatileContent(session.key).catch(() => {});
    }

    try {
      await window.NativeAPI.setLastOpenedFile(newPath);
    } catch (e) {
      console.warn('[Sidebar] could not persist last-opened pointer (non-fatal):', e);
    }
    if (docTitleEl && S.activeFilePath === newPath) {
      docTitleEl.value = newPath.replace(/\\/g, '/').split('/').pop().replace(/\.(md|txt)$/, '');
    }
    if (S.activeFilePath === newPath) startWatchingFile(newPath);
    expandedDirs.add(targetDir);
    await renderTree();
    if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
  })().catch((err) => {
    console.error('[Sidebar] scratchpad create flow failed unexpectedly:', err);
    session.creating = false;
  });
  return session.promise;
}

/* Start creating the session's note in pendingNoteDir() — the folder media
   links resolve against; while an image is previewed the note is named
   after it and lands beside it. Returns the creation promise (it never
   rejects), or null when no folder is open. */
function startScratchpadCreate(session) {
  const targetDir = pendingNoteDir();
  if (!targetDir) return null;
  let baseName = S.previewMediaPath
    ? baseNameOf(S.previewMediaPath).replace(/\.[^/.]+$/, '') // note named after the image
    : 'untitled';
  /* An image name the one name rule refuses for a new file (e.g.
     "aux.png" made on Linux) would make every create attempt fail:
     such a note is simply called "untitled". */
  if (checkEntryName(baseName) || checkEntryName(baseName + '.md')) baseName = 'untitled';
  return createNoteFromScratchpad(session, targetDir, baseName);
}

/* Put pending scratchpad text into its note NOW — waiting for a create
   already running, or starting one without the retry pause. Resolves true
   once the text is in a note (then the open one, bound like any note:
   keystrokes typed meanwhile are its unsaved edits), false when the note
   could not be created (the caller tells the user; session.lastError says
   why). */
async function scratchpadToNote(session) {
  session.quiet = true;
  try {
    const creating = session.creating ? session.promise : startScratchpadCreate(session);
    if (creating) await creating;
  } finally {
    session.quiet = false;
  }
  return pendingScratchpad() !== session;
}

function tellScratchpadNotSaved(session) {
  return window.NativeAPI.showMessageBox({
    type: 'warning',
    title: window.t('Could Not Create File'),
    message: window.t('Your text could not be saved to a file, so it stays open.'),
    detail: (session.lastError ? session.lastError + '\n\n' : '')
      + window.t('Use "Save as..." in the File menu to save it somewhere else. Until then a backup is kept, and Revery offers it again at the next start.'),
    buttons: ['OK'],
    defaultId: 0,
  }).catch(() => {});
}

/** A project switch is over (switched or not): text typed while it ran
    was only backed up — its note is created now, in the project that is
    open (see S._projectSwitch). */
export function resumeScratchpadAfterSwitch() {
  const s = pendingScratchpad();
  if (s && !s.creating) startScratchpadCreate(s);
}

/* ── Durable (reboot-safe) backup mirror ─────────────────────────────
   The regular crash backup lives in the OS temp dir — RAM-backed tmpfs
   on modern Linux, gone after a reboot. That is fine while autosave
   bounds the exposure to seconds, but in the two states where autosave
   is SUSPENDED (external-change conflict hold, save-failure cooldown)
   the temp backup is the ONLY copy of everything typed since — so those
   states also mirror to a durable slot under userData. So does text typed
   with no note open whose note could not be created. Throttled to one
   write per DURABLE_MIRROR_MS so the disk-wear cost stays negligible;
   recovery transparently picks whichever backup location is newest.  */
const DURABLE_MIRROR_MS = 5000;
let _durableMirrorLast  = 0;
let _durableMirrorTimer = null;

function _durableExposed() {
  return !!S.activeFilePath
    && ((S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath)
        || Date.now() < _autoSaveCooldownUntil);
}

export function writeDurableSnapshot(path, content) {
  if (typeof window.NativeAPI.setDurableBackup !== 'function') return;
  _durableMirrorLast = Date.now();
  window.NativeAPI.setDurableBackup(path, content).catch((e) =>
    console.warn('[Sidebar] durable backup failed (non-fatal):', e));
}

/* The key whose backup must also go to the durable slot right now, or
   null: the open note while autosave is suspended and it has unsaved
   edits; with no note open, scratchpad text whose note could not be
   created (until it is, the temp backup is its only copy). */
function _durableMirrorKey() {
  if (S.activeFilePath) return (_durableExposed() && S.isDirty) ? S.activeFilePath : null;
  const s = pendingScratchpad();
  return (s && s.failed) ? s.key : null;
}

function _fireDurableMirror() {
  const key = _durableMirrorKey(); // null: state ended or buffer saved
  if (key) writeDurableSnapshot(key, editor.value);
}

function mirrorDurableWhileExposed() {
  if (!_durableMirrorKey()) return;
  clearTimeout(_durableMirrorTimer);
  const since = Date.now() - _durableMirrorLast;
  if (since >= DURABLE_MIRROR_MS) {
    _fireDurableMirror();
  } else {
    // Trailing write so the final keystrokes of a burst are captured too.
    _durableMirrorTimer = setTimeout(_fireDurableMirror, DURABLE_MIRROR_MS - since);
  }
}

/* ══════════════════════════════════════════════════════════════════
     WHAT IS ON DISK FOR THE ACTIVE FILE
   S._diskBaseline — the exact text last read from, or written to, the
   active file (raw: line endings and BOM as on disk). The watcher
   compares the disk with it to tell our own writes (and touches that
   changed nothing) from real external changes, exactly — instead of
   ignoring every event for a while after each save, which let another
   program's change slip through and be overwritten by the next autosave.
   S._diskEol — the file's line-ending style, written back on save. Only
   files that are purely CRLF keep CRLF; mixed files keep the previous
   normalise-to-LF behaviour. The editor always holds '\n' (CodeMirror
   normalises every line break).
  ══════════════════════════════════════════════════════════════════ */
/** Record `raw` as what the active file now holds on disk. */
export function rememberDiskContent(raw) {
  if (typeof raw !== 'string') { S._diskBaseline = null; S._diskEol = '\n'; return; }
  /* The backend stores lone UTF-16 surrogates as U+FFFD (native_api.js);
     record the same form, or reading our own write back would not match. */
  const api = window.NativeAPI;
  S._diskBaseline = (api && typeof api.wellFormedText === 'function') ? api.wellFormedText(raw) : raw;
  S._diskEol = detectEol(raw);
}

/* ══════════════════════════════════════════════════════════════════
     IS THE DISK STILL WHAT WE LAST SAW?
   One comparison, used by the watcher (after a change event) and by
   saveActiveFile (just before it writes, inside the disk lock). The
   watcher alone left a gap: its event arrives ~300 ms after another
   program's write (debounce), and an autosave landing in between wrote
   over that change without asking. Checking again right before writing
   closes the gap — and covers the times the watcher is silent (a network
   share without change notifications, a watcher that died, the pause
   around our own file operations, Tauri's missing delete events).
   `bufferText` is the caller's text: the editor's for the watcher, the
   text about to be written for a save.
   → { kind, error }:
     'same'       exactly the recorded on-disk text (our own write, a touch)
     'adopted'    not the record, but already equal to bufferText (e.g. a
                  Save As over this very file) — recorded as the new
                  on-disk text
     'changed'    readable and different from both: another program's
     'missing'    the file is gone (deleted or moved away)
     'unreadable' it exists but is no longer valid UTF-8
     'unknown'    could not tell (locked, over the size cap, transient)
  ══════════════════════════════════════════════════════════════════ */
export async function compareDiskWithBaseline(filePath, bufferText) {
  let content;
  try {
    content = await window.NativeAPI.readFile(filePath);
  } catch (err) {
    const exists = await fileExistsViaListing(filePath);
    if (exists === false) return { kind: 'missing' };
    if (exists === true && /not valid UTF-8/.test(String(err))) return { kind: 'unreadable' };
    return { kind: 'unknown', error: err };
  }
  if (S._diskBaseline !== null && content === S._diskBaseline) return { kind: 'same' };
  const api = window.NativeAPI;
  const wellFormed = (s) => (api && typeof api.wellFormedText === 'function') ? api.wellFormedText(s) : s;
  if (typeof bufferText === 'string' && normalizeEol(content) === wellFormed(bufferText)) {
    rememberDiskContent(content);
    return { kind: 'adopted' };
  }
  return { kind: 'changed' };
}

/* ══════════════════════════════════════════════════════════════════
     AUTO-SAVE HOLD
   While a file is held, BACKGROUND autosave never writes it; an explicit
   save (Ctrl+S, switching files, closing) still does and lifts the hold.
   Reasons: 'conflict' — after an external change the user kept their
   version (the disk keeps the other program's); 'missing' — the file was
   deleted or moved by another program (autosave would recreate it);
   'unreadable' — another program rewrote it in an encoding the editor
   cannot read. A sticky status message says so while it lasts.
  ══════════════════════════════════════════════════════════════════ */
const HOLD_STATUS = 'autosave-hold';

export function setAutosaveHold(path, reason) {
  S._conflictHoldPath = path;
  S._holdReason = reason || 'conflict';
  if (typeof window.showStatusWarning !== 'function') return;
  const msg = S._holdReason === 'missing'
    ? window.t('"{name}" was deleted or moved by another program. Auto-save is paused so it is not recreated. Press Ctrl+S to save it again, or use Save As.')
    : S._holdReason === 'unreadable'
    ? window.t('"{name}" was changed by another program to a format Revery cannot read. Auto-save is paused. Ctrl+S overwrites it with your version.')
    : window.t('Auto-save is paused for "{name}" (you kept your version). Press Ctrl+S to save it.');
  window.showStatusWarning(HOLD_STATUS, msg.replace('{name}', baseNameOf(path)), { priority: 70 });
}

export function clearAutosaveHold() {
  S._conflictHoldPath = null;
  S._holdReason = null;
  if (typeof window.clearStatusWarning === 'function') window.clearStatusWarning(HOLD_STATUS);
}

/* ══════════════════════════════════════════════════════════════════
     DIRTY INDICATOR
  ══════════════════════════════════════════════════════════════════ */

  function markDirty() {
    if (S.isDirty) return;
    S.isDirty = true;
    document.title = 'Revery Notebook •';
    if (docTitleEl) docTitleEl.classList.add('doc-title-dirty');
  }

  function markClean() {
    S.isDirty = false;
    _firstDirtyTime = 0;
    document.title = 'Revery Notebook';
    if (docTitleEl) docTitleEl.classList.remove('doc-title-dirty');
    window._sidebarUnsaved = false;
    // Buffer now matches disk (file opened / reloaded / saved / cleared) —
    // any hold is moot and must not block future autosaves.
    clearAutosaveHold();
  }

  /* ══════════════════════════════════════════════════════════════════
     INLINE RENAMING (DOC TITLE)
  ══════════════════════════════════════════════════════════════════ */
  
  let _renamePromise = null;

  /** Resolves once no title rename is in flight (never rejects). Everything
      that puts ANOTHER document in the editor — openFile and the media /
      unsupported previews, folder and project switches, Save As — awaits
      this first. A title rename retargets the open note when it completes;
      a note opened meanwhile used to be overwritten by that retarget (the
      editor showed it, autosave wrote it into the renamed file). The
      rename itself, and anything it awaits, must never call this. */
  export async function waitForTitleRename() {
    for (let i = 0; i < 10 && _renamePromise; i++) {
      try { await _renamePromise; } catch (_) { /* the rename reports its own errors */ }
    }
  }

  async function renameActiveFileFromTitle() {
  // Do not interrupt a bulk operation (move, delete, multi‑rename)
  if (S._operationLock) return;

  if (!S.activeFilePath || window._showingUnsupportedFile) return;

  const rawName = docTitleEl.value.trim();
  const parts = S.activeFilePath.replace(/\\/g, '/').split('/');
  const oldFullName = parts.pop();
  const oldDir = parts.join('/');
  
  const lastDot = oldFullName.lastIndexOf('.');
  const ext = lastDot > 0 ? oldFullName.substring(lastDot + 1) : 'md';
  const oldBaseName = lastDot > 0 ? oldFullName.substring(0, lastDot) : oldFullName;

  if (!rawName) {
    docTitleEl.value = oldBaseName;
    return;
  }

  const safeName = sanitizeEntryName(rawName);
  if (safeName === oldBaseName) {
    docTitleEl.value = safeName;
    return;
  }

  // If a rename is already in flight, wait for it
  if (_renamePromise) return _renamePromise;

  /* The one name rule (paths.checkEntryName) — for what was typed and for
     the file name it becomes. The title shows no extension; it is always
     kept. A refused name puts the old title back and says why. */
  const problem = checkEntryName(safeName) || checkEntryName(`${safeName}.${ext}`);
  if (problem) {
    docTitleEl.value = oldBaseName;
    await showNameProblem(problem, safeName);
    return;
  }



const execRename = async () => {
    S._operationLock = true;
    try {
      // Capture the old path before any async gap so we can clean up the
      // volatile backup key regardless of what happens to S.activeFilePath below.
      const oldPath = S.activeFilePath;

      // The file itself does not block its own name (case-only renames).
      const finalNewPath = await uniquePath(oldDir, safeName, ext, oldFullName);

      /* Nothing has changed on disk yet. If another document took over the
         editor meanwhile (the openers wait for this rename — see
         waitForTitleRename; this is the backstop), stop here: the note on
         screen is no longer the one the title belonged to. */
      if (!samePath(S.activeFilePath, oldPath)) return;

      await window.NativeAPI.writeVolatileNow(finalNewPath, editor.value).catch(e =>
        console.warn('[Sidebar] Pre-rename volatile migration failed (non-fatal):', e)
      );


      const journalEntry = { from: oldPath, to: finalNewPath, ts: Date.now() };
      if (typeof window.NativeAPI.setPendingRename === 'function') {
        await window.NativeAPI.setPendingRename(journalEntry).catch(e =>
          console.warn('[Sidebar] Rename journal write failed (non-fatal):', e)
        );
      }

      /* Inside the disk lock: a save of the old path that is already
         queued lands BEFORE the rename (in Tauri, commands are not even
         ordered — the write could otherwise run after the rename and
         recreate the old file), and one queued after it sees the new
         path (see _goneActivePaths). The watcher lets go of the folder
         first (Windows). Called from a save-chain step too: that is fine
         — only waiting for the save CHAIN from inside it would deadlock. */
      let followed = false; // did the open note follow the file to its new name?
      await _enqueueDiskOp(async () => {
        await stopWatchingFile();
        try {
          await window.NativeAPI.renameNode(oldPath, finalNewPath);
          followed = await retargetActiveFile(oldPath, finalNewPath);
        } finally {
          /* retargetActiveFile watches the new path; otherwise (the rename
             failed, or the open note is another document) watch whatever
             is open again — the watcher was let go for the rename. */
          if (!followed && S.activeFilePath) startWatchingFile(S.activeFilePath);
        }
      });
      pushUndo({ type: 'rename', records: [{ oldPath, newPath: finalNewPath }] });
      if (followed) {
        docTitleEl.value = finalNewPath.replace(/\\/g, '/').split('/').pop().replace(new RegExp(`\\.${ext}$`), '');
      }

      // Clear the rename journal — everything succeeded. Failure here is
      // non-fatal: a stale journal is idempotent on next boot (lastFile ===
      // journal.to triggers a no-op clear).
      if (typeof window.NativeAPI.setPendingRename === 'function') {
        window.NativeAPI.setPendingRename(null).catch(e =>
          console.warn('[Sidebar] Rename journal clear failed (non-fatal):', e)
        );
      }


      window.NativeAPI.deleteVolatileContent(oldPath).catch(() => {});


      await renderTree();
    } catch (err) {
      console.error('[Sidebar] Inline rename failed:', err);
      docTitleEl.value = oldBaseName;
      await window.NativeAPI.showMessageBox({
        type: 'error', title: window.t('Rename Failed'),
        message: window.t('Could not rename file to "{name}".').replace('{name}', safeName),
        detail: String(err),
      });
    } finally {
      S._operationLock = false;
      _renamePromise = null;
    }
  };

  _renamePromise = execRename();
  return _renamePromise;
}

/* ══════════════════════════════════════════════════════════════════
     SAVE  (the single source of truth for all disk writes)
  ══════════════════════════════════════════════════════════════════ */

let _saveChain = Promise.resolve();

/* opts.auto: this is a BACKGROUND autosave (timer / max-wait). Background
   saves never write a held file (see AUTO-SAVE HOLD) — checked inside the
   disk lock, so a timer that fired just before a hold was set cannot slip
   through. Every other caller (Ctrl+S, switching files, close, export) is
   an explicit save.
   opts.onOutcome(outcome): optional; told how THIS save ended — 'ok',
   'error', 'no-file', or one of the 'deferred-…' results below. (The
   boolean result stays the contract for every other caller.)

   Before writing the open note, the disk is compared with what we last
   read or wrote (compareDiskWithBaseline). Another program's version is
   never overwritten unseen: 'changed' or 'unreadable' → nothing is
   written and the "File Changed Externally" flow takes over
   ('deferred-verify'). A file that vanished is not recreated by a
   BACKGROUND save (that is the 'missing' hold); an explicit save still
   recreates it — the text is the user's and nothing on disk is lost. A
   held file skips the check on an explicit save: the user already chose
   their version. */
async function saveActiveFile(opts) {
  const auto = !!(opts && opts.auto);
  const report = (opts && typeof opts.onOutcome === 'function') ? opts.onOutcome : () => {};
  if (!S.activeFilePath) { report('no-file'); return false; }
  clearTimeout(_autoSaveTimer);

  const contentToSave = editor.value;

  const enqueueGen = S._replaceGeneration;
  /* The document this text belongs to. If another document is put in the
     editor before the write runs, contentToSave belongs to the OLD one and
     must never be written to whatever path is open by then. */
  const docGen = currentDocGeneration();

  // Chain this save after all previous saves
  const savePromise = _saveChain = _saveChain.then(async () => {
  // Wait for any pending rename
  if (typeof _renamePromise !== 'undefined' && _renamePromise) {
    await _renamePromise;
  }
  // Path may have changed while waiting, re‑check
  if (!S.activeFilePath) { report('no-file'); return false; }

  // Apply pending title rename if needed
  if (docTitleEl) {
    const currentBase = S.activeFilePath.replace(/\\/g, '/').split('/').pop()
                       .replace(/\.[^/.]+$/, '');
    const inputName = docTitleEl.value.trim();
    if (inputName && inputName !== currentBase && !window._showingUnsupportedFile) {
      await renameActiveFileFromTitle();
      if (!S.activeFilePath) { report('no-file'); return false; }
    }
  }


  const pathToSave = S.activeFilePath;


let writeResult;

try {
  writeResult = await _enqueueDiskOp(async () => {
    if (S._externalChangeInProgress) return 'deferred-external';
    if (enqueueGen !== S._replaceGeneration) return 'deferred-replaced';
    const held = !!S._conflictHoldPath && S._conflictHoldPath === pathToSave;
    if (auto && held) return 'deferred-hold';

    const isActive = S.activeFilePath === pathToSave;
    /* Another document is in the editor now: this text is not its text. */
    if (isActive && docGen !== currentDocGeneration()) return 'deferred-replaced';
    /* The note moved or was deleted by our own operation after this save
       captured its path (see _goneActivePaths): never write the old path. */
    if (!isActive && _goneActivePaths.has(pathKey(pathToSave))) return 'deferred-gone';

    /* Is the disk still what we last read or wrote? (see the header) */
    if (isActive && !held && S._diskBaseline !== null) {
      const disk = await compareDiskWithBaseline(pathToSave, contentToSave);
      if (disk.kind === 'changed' || disk.kind === 'unreadable'
          || (disk.kind === 'missing' && auto)) {
        return 'deferred-verify';
      }
      // The disk already holds exactly this text (recorded as such): done.
      if (disk.kind === 'adopted') return 'ok';
      // 'same', 'unknown' (cannot tell — the write reports real errors),
      // or 'missing' on an explicit save (recreate): write.
    }
    /* Write in the file's own line-ending style (see WHAT IS ON DISK). */
    const diskText = toDiskText(contentToSave, isActive ? S._diskEol : '\n');
    await window.NativeAPI.writeFile(pathToSave, diskText);
    /* Record what is on disk now INSIDE the lock, so a watcher check queued
       behind this write recognises it as ours. */
    if (isActive) rememberDiskContent(diskText);
    return 'ok';
  });
} catch (err) {
  // Real disk error from writeFile (or unexpected throw).
  console.error('[Sidebar] saveActiveFile failed:', err);
  _autoSaveCooldownUntil = Date.now() + AUTOSAVE_FAILURE_COOLDOWN_MS;
  // Autosave is now suspended for 30s and the primary disk just refused a
  // write — snapshot the exact content that failed to save to the durable
  // (reboot-safe, different location) backup slot immediately. contentToSave,
  // not editor.value: it is guaranteed to belong to pathToSave, and the
  // mirror keeps refreshing with newer keystrokes while the cooldown lasts.
  writeDurableSnapshot(pathToSave, contentToSave);
  _firstDirtyTime = 0;
  report('error');
  await window.NativeAPI.showMessageBox({
    type: 'error', title: window.t('Save Failed'),
    message: window.t('Could not write to:') + '\n' + pathToSave,
    detail: String(err)
  });
  return false;
}

if (writeResult !== 'ok') {
  // 'deferred-external', 'deferred-replaced', 'deferred-hold',
  // 'deferred-gone' or 'deferred-verify'. No dialog here — the watcher's
  // dialog / the hold's status message is the user's resolution path.
  // Treat as a save failure (return false) so callers see the same signal
  // as a real failure.
  report(writeResult);
  // 'deferred-gone': the note is elsewhere now — the edits are still
  // unsaved, so write them there.
  if (writeResult === 'deferred-gone' && S.activeFilePath && S.isDirty) scheduleAutoSave();
  // 'deferred-verify': the disk no longer holds what we last saw. Hand it
  // to the watcher's own check (outside the lock — its dialog can take
  // minutes): it asks about a changed file, pauses autosave for a vanished
  // or unreadable one, and says 'same' if the change was already undone,
  // in which case the edits are simply saved again.
  if (writeResult === 'deferred-verify') {
    checkActiveFileOnDisk(pathToSave).then((kind) => {
      if (kind === 'same' && S.activeFilePath === pathToSave && S.isDirty) scheduleAutoSave();
    }).catch((e) => console.warn('[Sidebar] disk check after a stopped save failed:', e));
  }
  return false;
}

// ── Successful write past this point — post-write bookkeeping ────────
_autoSaveCooldownUntil = 0;
// An explicit save of this file discharges any hold on it.
if (S._conflictHoldPath === pathToSave) clearAutosaveHold();

if (editor.value === contentToSave) {
  markClean();
  if (typeof showSavedIndicator === 'function') showSavedIndicator();
  window.NativeAPI.deleteVolatileContent(pathToSave).catch(() => {});
} else {
  // Don't markClean, don't showSavedIndicator (visible state is
  // ahead of disk; the next autosave will show the indicator once
  // editor and disk converge).
  window.NativeAPI.writeVolatileNow(pathToSave, editor.value).catch(err =>
    console.warn('[Sidebar] post-save volatile refresh failed:', err)
  );
  scheduleAutoSave();
}

// Update card view preview
if (S.sidebarViewMode === 'card') {
  const chunk = contentToSave.substring(0, 5000);
  const previewText = stripMarkdownForPreview(chunk).substring(0, 440);
  _previewCache.set(pathToSave, previewText);
  const card = treeEl.querySelector(`.sidebar-card[data-path="${CSS.escape(pathToSave)}"]`);
  if (card) {
    const previewEl = card.querySelector('.sidebar-card-preview');
    if (previewEl) previewEl.textContent = previewText;
  }
}

report('ok');
return true;






}).catch(err => {
  console.error('[Sidebar] Uncaught error in save chain – recovering:', err);
  report('error');
  return false;
});
return savePromise;
}



/** Resolves once every save queued so far has settled (never rejects).
    Never await this from inside a save-chain step — it would wait for
    itself. */
export function waitForSaveChainIdle() {
  return _saveChain.then(() => {}, () => {});
}

/* ══════════════════════════════════════════════════════════════════
     PUTTING ANOTHER DOCUMENT IN THE EDITOR
   Every opener goes through here: a note, an image preview, an
   unsupported file, another project. The open note is saved; `prepare`
   (optional) does the opener's own waiting, e.g. reading the next note;
   then `apply(prepared)` swaps the document. `apply` must be SYNCHRONOUS:
   it runs right after the last check that the open note has no unsaved
   edits, with no await in between, so nothing can edit the old document
   between that check and the swap.
   The openers used to save, await, then swap unconditionally: an edit
   that landed in between (a dropped image's link arriving after its copy)
   was replaced unseen — kept only in a crash backup that is never offered
   for a note that is not the last one opened. Such an edit is now saved
   and the switch prepared again. `prepare` returns SWITCH_CANCELLED to
   stop (after telling the user why). Resolves true when `apply` ran.
   Text typed with no note open counts as unsaved too: its note is created
   first (saveOpenDocument). It used to be replaced like an empty editor
   whenever that note could not be created (a read-only folder, a full
   disk) — its only copy then a temp-dir backup.
  ══════════════════════════════════════════════════════════════════ */
export const SWITCH_CANCELLED = Symbol('switch-cancelled');
const SWITCH_ATTEMPTS = 5;

const unsavedNote = () => S.isDirty && !!S.activeFilePath;
const hasUnsavedWork = () => unsavedNote() || !!pendingScratchpad();

/* Get the document on screen onto disk: the open note's edits saved, or
   text typed with no note open put into its note. False when that failed
   — the user has been told (Save Failed / Could Not Create File) — and the
   document must stay on screen. */
async function saveOpenDocument() {
  if (unsavedNote()) return saveActiveFile();
  const pending = pendingScratchpad();
  if (!pending || (await scratchpadToNote(pending))) return true;
  await tellScratchpadNotSaved(pending);
  return false;
}

/** For flows that do not replace the document but must not start while
    it is unsaved (a new file is created, then opened): saveOpenDocument
    after any title rename. */
export async function saveBeforeLeaving() {
  await waitForTitleRename();
  return saveOpenDocument();
}

export async function replaceOpenDocument(prepare, apply) {
  if (S._projectSwitch) { // switchProject is between clearing and opening
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('fs-busy', window.t('Busy — try again in a moment.'), { priority: 5, ttl: 2500 });
    }
    return false;
  }
  await waitForTitleRename(); // it would retarget the note after the swap
  for (let attempt = 0; attempt < SWITCH_ATTEMPTS; attempt++) {
    if (!(await saveOpenDocument())) return false; // failed: stay on the document
    const prepared = prepare ? await prepare() : undefined;
    if (prepared === SWITCH_CANCELLED) return false;
    if (hasUnsavedWork()) continue; // edited while saving or preparing: save that too
    apply(prepared);
    return true;
  }
  /* Still being edited after every round: stay on the open note. Nothing
     is lost, and the next attempt switches. */
  if (typeof window.showStatusWarning === 'function') {
    window.showStatusWarning('switch-busy',
      window.t('The open note is still being changed. Try again in a moment.'),
      { priority: 20, ttl: 4000 });
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════
     RETARGET — the active file moved on disk (rename / move / undo)
   The ONE place that updates every piece of state tied to the active
   file's path. A path change does not change the content, so the dirty
   flag is left exactly as it is (the sidebar rename used to call
   markClean() here, which marked unsaved edits as saved — lost on close
   whenever autosave was suspended). Call it right after the rename
   succeeded, before any other await, so watcher events for the old name
   already see the new active path.
   Only the OPEN note follows: when oldPath is not what the editor shows,
   nothing but the "left oldPath" mark happens and false is returned. A
   title rename finishing after another note had been opened used to point
   the editor (and so autosave) at the renamed file while it showed that
   other note — the next keystroke wrote the other note's text over the
   renamed one. Returns true when the open note followed.
  ══════════════════════════════════════════════════════════════════ */
export async function retargetActiveFile(oldPath, newPath) {
  if (!oldPath || !newPath) return false;
  /* The file left oldPath through our own operation — open or not, a save
     that captured oldPath must not recreate it there (_goneActivePaths). */
  markActivePathGone(oldPath);
  if (!samePath(S.activeFilePath, oldPath)) return false;
  S.activeFilePath = newPath;
  forgetGonePath(newPath);
  // A hold belongs to the file, not to its old name (message shows the new one).
  if (S._conflictHoldPath === oldPath) setAutosaveHold(newPath, S._holdReason);
  if (docTitleEl) docTitleEl.value = baseNameOf(newPath).replace(/\.(md|txt)$/, '');
  startWatchingFile(newPath);

  /* Crash backups are keyed by path. While the buffer holds unsaved text,
     move them: write the new-path backup FIRST, and delete the old one only
     once that succeeded. */
  if (S.isDirty) {
    try {
      await window.NativeAPI.writeVolatileNow(newPath, editor.value);
      if (_durableExposed()) writeDurableSnapshot(newPath, editor.value);
      await window.NativeAPI.deleteVolatileContent(oldPath);
    } catch (e) {
      console.warn('[Sidebar] could not move the crash backup to the new path (old one kept):', e);
    }
  }

  try {
    await window.NativeAPI.setLastOpenedFile(newPath);
  } catch (e) {
    console.warn('[Sidebar] could not persist last-opened pointer (non-fatal):', e);
  }
  return true;
}

  /** Schedules an auto-save after autosaveDelayMs() of inactivity, but
      forces a save once autosaveMaxWaitMs() has elapsed since the
      document first became dirty. Prevents indefinite postponement
      during continuous typing. */
  function scheduleAutoSave() {
    if (!S.activeFilePath) return;
    clearTimeout(_autoSaveTimer);

    // Conflict hold ("Keep my version"): the user chose to keep the disk
    // file as the external program left it. Background autosave stays off
    // for THIS file until an explicit save lifts the hold.
    if (S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath) {
      return;
    }

    // If a recent save failed, back off until the cooldown expires.
    if (Date.now() < _autoSaveCooldownUntil) {
      return;
    }
    if (_firstDirtyTime === 0) _firstDirtyTime = Date.now();

    if (Date.now() - _firstDirtyTime >= autosaveMaxWaitMs()) {
      // Cap reached: save immediately. saveActiveFile() will call
      // markClean() on success, which resets _firstDirtyTime.
      //
      // IMPORTANT: reset _firstDirtyTime BEFORE the save attempt so a
      // failed save (disk full, file locked, etc.) doesn't leave the
      // cap permanently exceeded — which would force an instant retry
      // on every subsequent keystroke and trap the user in an error-
      // dialog loop.
      _firstDirtyTime = Date.now();

      saveActiveFile({ auto: true });
      return;
    }

    _autoSaveTimer = setTimeout(() => saveActiveFile({ auto: true }), autosaveDelayMs());
  }

export { markDirty, markClean, saveActiveFile, scheduleAutoSave };

export function initSaveEngine() {
  if (docTitleEl) {
    // Trigger rename when the user clicks away
    docTitleEl.addEventListener('change', renameActiveFileFromTitle);
    // Trigger rename on Enter key
    docTitleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        docTitleEl.blur(); // Forces the 'change' event to fire
        editor.focus();
      }
    });
  }

/* Expose save for actions.js and other modules */
  window.sidebarSaveActiveFile    = saveActiveFile;
  window.sidebarGetActiveFilePath = () => S.activeFilePath;
  window.sidebarGetRootPath       = () => S.rootPath;
  window.sidebarIsDirty           = () => S.isDirty;
  /* For flows outside the sidebar that must not drop the open note's work
     (Total Reset): which note is open, whether it has unsaved edits, and
     whether auto-save is paused for it — then the version on screen is not
     on disk, and neither saving nor discarding it is a safe guess. */
  window.sidebarUnsavedState = () => ({
    path:  S.activeFilePath,
    dirty: S.isDirty,
    held:  !!S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath,
  });

  // Pivot the sidebar state to a newly saved file (used by Save As)
  window.sidebarPivotToNewFile = async function(newPath, newRoot, savedContent) {
    await waitForTitleRename(); // it would retarget the note after this pivot
    /* Adopt the CANONICAL spellings the folder listings use (setRootPath
       resolves the root, canonicalEntryPath the file) — the Save As
       dialog hands back the path as typed or navigated, which may run
       through a link or differ in letter case, and a spelling that
       differs from the tree's made the file operations miss that this
       note is the open one. On any failure the given spelling stays. */
    if (newRoot && newRoot !== S.rootPath) {
      try {
        const c = await window.NativeAPI.setRootPath(newRoot);
        if (typeof c === 'string' && c) newRoot = c;
      } catch (e) {
        console.warn('[Sidebar] Save As: could not resolve the new root (kept as given):', e);
      }
    }
    try {
      const c = await window.NativeAPI.canonicalEntryPath(newPath);
      if (typeof c === 'string' && c) newPath = c;
    } catch (_) { /* outside the project root: keep as given */ }
    /* Text typed with no note open (e.g. its note could not be created)
       now has this file: the session waiting to create a note for it is
       over. Its placeholder backup goes below, once this note's own backup
       holds anything Save As did not write. A create still running keeps
       its session (it detaches and reports where its text went). */
    const scratch = _scratch && _scratch.gen === currentDocGeneration() && !_scratch.creating
      && !S.activeFilePath ? _scratch : null;
    if (scratch) releaseScratchSession(scratch);
    S.activeFilePath = newPath;
    forgetGonePath(newPath);
    /* Only what Save As actually wrote is on disk. If the buffer changed
       while its dialog was open (possible where the dialog is not modal),
       those edits are NOT saved — keep them dirty so autosave writes them
       to the new file, instead of marking them saved and losing them.
       Callers that pass no content keep the previous behaviour. */
    if (typeof savedContent === 'string' && editor.value !== savedContent) {
      markDirty();
      scheduleAutoSave();
    } else {
      markClean();
    }
    // Save As wrote `savedContent` (editor text, LF) to the new file.
    rememberDiskContent(typeof savedContent === 'string' ? savedContent : null);
    if (scratch) {
      (S.isDirty ? window.NativeAPI.writeVolatileNow(newPath, editor.value) : Promise.resolve())
        .then(() => window.NativeAPI.deleteVolatileContent(scratch.key))
        .catch((e) => console.warn('[Sidebar] Save As: scratchpad backup kept:', e));
    }
    // Non-fatal: the root, title and watcher below must follow regardless.
    await window.NativeAPI.setLastOpenedFile(newPath).catch((e) => console.warn('[Sidebar] could not persist last-opened pointer (non-fatal):', e));

    // If the file was saved to a directory outside the current project root,
    // the backend has already updated its own root state and trustedRoots.
    // Sync all JS-side state that depends on S.rootPath so that:
    //   • renderTree() shows the correct directory
    //   • New File / New Folder buttons use the correct base directory
    //   • The sidebar title shows the correct folder name
    //   • Card view and expandedDirs don't hold stale paths from the old root
    if (newRoot && newRoot !== S.rootPath) {
      S.rootPath = newRoot;
      clearUndoStack(); // file undo never reaches into another project
      try { localStorage.setItem('revery_root_path', S.rootPath); } catch (_) {}
      if (typeof window.NativeAPI.setLastRootPath === 'function') {
        window.NativeAPI.setLastRootPath(S.rootPath).catch(() => {});
      }
      // Update sidebar folder name display
      const parts = newRoot.replace(/\\/g, '/').split('/');
      if (folderNameEl) folderNameEl.textContent = parts[parts.length - 1] || newRoot;
      // Reset directory state — mirrors exactly what openFolder() does
      S.selectedDirPath = newRoot;
      S.cardViewDir     = newRoot;
      expandedDirs.clear();
      expandedDirs.add(newRoot);
      // Record in recent-projects history
      if (typeof recordProjectOpen === 'function') {
        await recordProjectOpen(newRoot);
      }
    }

    if (docTitleEl) {
      const base = newPath.replace(/\\/g, '/').split('/').pop();
      docTitleEl.value = base.replace(/\.(md|txt)$/, '');
    }
    
    startWatchingFile(newPath);
    
    // Ensure the new file's directory is expanded and visible in the tree
    const dir = newPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (dir) expandedDirs.add(dir);
    
    await renderTree();
    highlightActiveFile(newPath);
  };

/* ══════════════════════════════════════════════════════════════════
     EDITOR INPUT LISTENER  (dirty tracking + auto-save + volatile)
  ══════════════════════════════════════════════════════════════════ */

  editor.addEventListener('input', () => {
/* ── Scratchpad mode: auto-create a .md file when typing with no file open ──
   Covers the empty editor AND the media preview (fileops.openMediaFile):
   both are "no active file". The folder is pendingNoteDir() — the same
   folder media ingest copies into and links resolve against — and while an
   image is previewed the note takes the image's name and lands beside it.
   The session's placeholder backup protects the text until the file exists
   (see createNoteFromScratchpad for what happens if the user moves on
   before that). */
    if (!S.activeFilePath && !window._showingUnsupportedFile) {
      const targetDir = pendingNoteDir();
      if (targetDir) {
        const session = scratchpadSession();
        session.latest = editor.value;
        /* Crash backup on EVERY scratchpad keystroke — including those typed
           while the file is being created, which used to have none. */
        try {
          window.NativeAPI.setVolatileContent(session.key, editor.value);
        } catch (e) {
          console.warn('[Sidebar] scratchpad placeholder volatile failed (non-fatal):', e);
        }
        /* Reboot-safe mirror — only while its note could not be created */
        mirrorDurableWhileExposed();
        /* During a project switch the note waits for the project being
           opened (resumeScratchpadAfterSwitch): created now, it would land
           in the project being left, which the backend is about to drop. */
        if (!S._projectSwitch && !session.creating && Date.now() >= session.retryAfter) {
          startScratchpadCreate(session);
        }
        return; // skip normal flow until the file is established
      }
    }








    if (S.activeFilePath) {
      markDirty();
      scheduleAutoSave();
      /* Volatile crash backup (separate from the debounced disk auto-save) */
      window.NativeAPI.setVolatileContent(S.activeFilePath, editor.value);
      /* Reboot-safe mirror — only active while autosave is suspended */
      mirrorDurableWhileExposed();
    }
  });

  
/* Ctrl+S → immediate save */
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      if (!S.activeFilePath) return; /* let actions.js handle web export */
      e.preventDefault();
      
      // Force blur if user is still typing in the title to trigger the rename process safely
      if (document.activeElement === docTitleEl) {
        docTitleEl.blur(); 
      }
      
      await saveActiveFile();
    }
    /* Ctrl+Z → undo the last file move or rename — ONLY while the user is
       working in the file panel (sidebarUndoAllowed). It used to fire
       whenever the editor lacked focus, so Ctrl+Z typed in the title
       field, the find bar or the project search silently moved files
       back (and rewrote links) instead of undoing the typing. */
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      if (!sidebarUndoAllowed(e)) return;
      if (!hasUndoOperations()) return;
      e.preventDefault();
      await undoLastOperation();
    }
  });

  /* Where did the user last work? A pointer press or focus inside the
     file panel (or its menus and dialogs) arms file undo; one anywhere
     else — the editor, the title, the find bar — disarms it. */
  const isPanelSurface = (el) => !!(el && el.closest && (
    (sidebarPanel && sidebarPanel.contains(el))
    || el.closest('#context-menu, #sidebar-sort-menu, .revery-input-overlay')));
  document.addEventListener('pointerdown', (e) => { _panelArmed = isPanelSurface(e.target); }, true);
  document.addEventListener('dragstart', (e) => { if (isPanelSurface(e.target)) _panelArmed = true; }, true);
  document.addEventListener('focusin', (e) => { if (!isPanelSurface(e.target)) _panelArmed = false; }, true);
}

let _panelArmed = false;

/* File undo may run only when ALL hold: the editor does not have focus;
   no text field anywhere has it (Ctrl+Z there means "undo my typing");
   no dialog is open; the file panel is open; and the last thing the user
   pressed or focused was the file panel. */
function sidebarUndoAllowed(e) {
  if (window.cmView && window.cmView.hasFocus) return false; // CM's own undo
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const t = e.target;
  if (t && t.closest && t.closest(editable)) return false;
  const a = document.activeElement;
  if (a && a !== document.body && a.closest && a.closest(editable)) return false;
  if (document.querySelector('.revery-input-overlay')) return false;
  if (!S.sidebarOpen) return false;
  return _panelArmed;
}

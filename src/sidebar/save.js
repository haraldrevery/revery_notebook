/* save.js — the save engine: dirty tracking, the serialized save chain,
   auto-save scheduling, inline title rename, editor input wiring.
   This is the single source of truth for all disk writes of the active
   file. Treat every ordering comment in here as load-bearing. */
import { S, docTitleEl, folderNameEl, treeEl, expandedDirs, _previewCache,
         SCRATCHPAD_PREFIX, ensureScratchpadVolatileKey,
         pendingNoteDir } from './state.js';
import { uniquePath, stripMarkdownForPreview } from './helpers.js';
import { baseNameOf } from './paths.js';
import { detectEol, toDiskText } from './eol.js';
import { renderTree, highlightActiveFile } from './tree.js';
import { startWatchingFile } from './watcher.js';
import { pushUndo, hasUndoOperations, undoLastOperation } from './fileops.js';
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
   document's text into it. */
let _scratch = null; // { gen, key, latest, creating, retryAfter }
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
  _scratch = { gen, key: ensureScratchpadVolatileKey(), latest: '', creating: false, retryAfter: 0 };
  return _scratch;
}

function scratchpadCreateFailed(session, err, emptyFileToRemove) {
  console.error('[Sidebar] scratchpad auto-create failed:', err);
  session.creating   = false;
  session.retryAfter = Date.now() + SCRATCHPAD_RETRY_MS;
  /* createFile succeeded but nothing could be written: that file is ours,
     brand new and empty — move it to the trash so repeated retries (disk
     full, no permission) cannot litter the folder with empty untitled
     files. The placeholder backup is kept in every failure case. */
  if (emptyFileToRemove) window.NativeAPI.deleteNode(emptyFileToRemove).catch(() => {});
  if (!_scratchpadFailureWarned) {
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

  (async () => {
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
    const releaseSession = () => {
      if (_scratch === session) _scratch = null;
      if (S._scratchpadVolatileKey === session.key) S._scratchpadVolatileKey = null;
    };

    if (!attached()) {
      /* DETACHED — the text is safely in newPath and the editor shows
         another document, so nothing is bound. Only now may the backup go. */
      releaseSession();
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
    S.previewMediaPath = null; // the preview became this note
    rememberDiskContent(written); // what the new file holds (LF, a new note)
    releaseSession();

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
}

/* ── Durable (reboot-safe) backup mirror ─────────────────────────────
   The regular crash backup lives in the OS temp dir — RAM-backed tmpfs
   on modern Linux, gone after a reboot. That is fine while autosave
   bounds the exposure to seconds, but in the two states where autosave
   is SUSPENDED (external-change conflict hold, save-failure cooldown)
   the temp backup is the ONLY copy of everything typed since — so those
   states also mirror to a durable slot under userData. Throttled to one
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

function _fireDurableMirror() {
  if (!_durableExposed() || !S.isDirty) return; // state ended or buffer saved
  writeDurableSnapshot(S.activeFilePath, editor.value);
}

function mirrorDurableWhileExposed() {
  if (!_durableExposed()) return;
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

  const safeName = rawName.replace(/[/\\?%*:|"<>]/g, '_');
  if (safeName === oldBaseName) {
    docTitleEl.value = safeName;
    return;
  }

  // If a rename is already in flight, wait for it
  if (_renamePromise) return _renamePromise;



const execRename = async () => {
    S._operationLock = true;
    try {
      // Capture the old path before any async gap so we can clean up the
      // volatile backup key regardless of what happens to S.activeFilePath below.
      const oldPath = S.activeFilePath;

      // The file itself does not block its own name (case-only renames).
      const finalNewPath = await uniquePath(oldDir, safeName, ext, oldFullName);


      await window.NativeAPI.writeVolatileNow(finalNewPath, editor.value).catch(e =>
        console.warn('[Sidebar] Pre-rename volatile migration failed (non-fatal):', e)
      );


      const journalEntry = { from: oldPath, to: finalNewPath, ts: Date.now() };
      if (typeof window.NativeAPI.setPendingRename === 'function') {
        await window.NativeAPI.setPendingRename(journalEntry).catch(e =>
          console.warn('[Sidebar] Rename journal write failed (non-fatal):', e)
        );
      }

      await window.NativeAPI.renameNode(oldPath, finalNewPath);
      pushUndo({ type: 'rename', records: [{ oldPath, newPath: finalNewPath }] });
      await retargetActiveFile(oldPath, finalNewPath);
      const finalBaseName = finalNewPath.replace(/\\/g, '/').split('/').pop().replace(new RegExp(`\\.${ext}$`), '');
      docTitleEl.value = finalBaseName;

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
   an explicit save. */
async function saveActiveFile(opts) {
  const auto = !!(opts && opts.auto);
  if (!S.activeFilePath) return false;
  clearTimeout(_autoSaveTimer);

  const contentToSave = editor.value;

  const enqueueGen = S._replaceGeneration;

  // Chain this save after all previous saves
  const savePromise = _saveChain = _saveChain.then(async () => {
  // Wait for any pending rename
  if (typeof _renamePromise !== 'undefined' && _renamePromise) {
    await _renamePromise;
  }
  // Path may have changed while waiting, re‑check
  if (!S.activeFilePath) return false;

  // Apply pending title rename if needed
  if (docTitleEl) {
    const currentBase = S.activeFilePath.replace(/\\/g, '/').split('/').pop()
                       .replace(/\.[^/.]+$/, '');
    const inputName = docTitleEl.value.trim();
    if (inputName && inputName !== currentBase && !window._showingUnsupportedFile) {
      await renameActiveFileFromTitle();
      if (!S.activeFilePath) return false;
    }
  }


  const pathToSave = S.activeFilePath;


let writeResult;

try {
  writeResult = await _enqueueDiskOp(async () => {
    if (S._externalChangeInProgress) return 'deferred-external';
    if (enqueueGen !== S._replaceGeneration) return 'deferred-replaced';
    if (auto && S._conflictHoldPath && S._conflictHoldPath === pathToSave) return 'deferred-hold';

    /* Write in the file's own line-ending style (see WHAT IS ON DISK). */
    const isActive = S.activeFilePath === pathToSave;
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
  await window.NativeAPI.showMessageBox({
    type: 'error', title: window.t('Save Failed'),
    message: window.t('Could not write to:') + '\n' + pathToSave,
    detail: String(err)
  });
  return false;
}

if (writeResult !== 'ok') {
  // 'deferred-external', 'deferred-replaced' or 'deferred-hold'. No dialog —
  // the watcher's dialog / the hold's status message is the user's
  // resolution path. Treat as a save failure (return false) so callers see
  // the same signal as a real failure.
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

return true;






}).catch(err => {
  console.error('[Sidebar] Uncaught error in save chain – recovering:', err);
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
     RETARGET — the active file moved on disk (rename / move / undo)
   The ONE place that updates every piece of state tied to the active
   file's path. A path change does not change the content, so the dirty
   flag is left exactly as it is (the sidebar rename used to call
   markClean() here, which marked unsaved edits as saved — lost on close
   whenever autosave was suspended). Call it right after the rename
   succeeded, before any other await, so watcher events for the old name
   already see the new active path.
  ══════════════════════════════════════════════════════════════════ */
export async function retargetActiveFile(oldPath, newPath) {
  if (!oldPath || !newPath) return;
  S.activeFilePath = newPath;
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

  // Pivot the sidebar state to a newly saved file (used by Save As)
  window.sidebarPivotToNewFile = async function(newPath, newRoot, savedContent) {
    S.activeFilePath = newPath;
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
    await window.NativeAPI.setLastOpenedFile(newPath);

    // If the file was saved to a directory outside the current project root,
    // the backend has already updated its own root state and trustedRoots.
    // Sync all JS-side state that depends on S.rootPath so that:
    //   • renderTree() shows the correct directory
    //   • New File / New Folder buttons use the correct base directory
    //   • The sidebar title shows the correct folder name
    //   • Card view and expandedDirs don't hold stale paths from the old root
    if (newRoot && newRoot !== S.rootPath) {
      S.rootPath = newRoot;
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
        if (!session.creating && Date.now() >= session.retryAfter) {
          const baseName = S.previewMediaPath
            ? baseNameOf(S.previewMediaPath).replace(/\.[^/.]+$/, '') // note named after the image
            : 'untitled';
          createNoteFromScratchpad(session, targetDir, baseName);
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
    /* Ctrl+Z → undo last navigation operation (move or rename).
       Only fires when the CM editor does NOT have focus, so it never
       conflicts with CM's own text undo.  We test cmView.hasFocus (a
       real DOM check) rather than activeElement === editor because
       `editor` is the JS shim object, not a DOM node — that comparison
       was always false and both handlers fired simultaneously.          */
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const editorHasFocus = window.cmView ? window.cmView.hasFocus : false;
      if (editorHasFocus) return; // CM's historyKeymap handles it
      if (!hasUndoOperations()) return;
      e.preventDefault();
      await undoLastOperation();
    }
  });
}

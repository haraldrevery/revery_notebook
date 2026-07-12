/* save.js — the save engine: dirty tracking, the serialized save chain,
   auto-save scheduling, inline title rename, editor input wiring.
   This is the single source of truth for all disk writes of the active
   file. Treat every ordering comment in here as load-bearing. */
import { S, docTitleEl, folderNameEl, treeEl, expandedDirs, _previewCache,
         SUPPRESS_MS, SCRATCHPAD_PREFIX, ensureScratchpadVolatileKey } from './state.js';
import { uniquePath, stripMarkdownForPreview } from './helpers.js';
import { renderTree, highlightActiveFile } from './tree.js';
import { startWatchingFile } from './watcher.js';
import { pushUndo, undoLastOperation } from './fileops.js';
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
let _autoCreatingFile        = false;  // Guard to prevent duplicate file creation during rapid typing

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
    // any conflict hold is moot and must not block future autosaves.
    S._conflictHoldPath = null;
  }

  /* ══════════════════════════════════════════════════════════════════
     INLINE RENAMING (DOC TITLE)
  ══════════════════════════════════════════════════════════════════ */
  
  let _renamePromise = null;

  async function renameActiveFileFromTitle() {
  // Do not interrupt a bulk operation (move, delete, multi‑rename)
  if (S._operationLock) return;

  if (!S.activeFilePath || window._showingUnsupportedFile || S._mediaPreviewMode) return;

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

      const finalNewPath = await uniquePath(oldDir, safeName, ext);


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
      S.activeFilePath = finalNewPath;
      await window.NativeAPI.setLastOpenedFile(finalNewPath);
      const finalBaseName = finalNewPath.replace(/\\/g, '/').split('/').pop().replace(new RegExp(`\\.${ext}$`), '');
      docTitleEl.value = finalBaseName;
      startWatchingFile(finalNewPath);

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

async function saveActiveFile() {
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
    if (inputName && inputName !== currentBase && !window._showingUnsupportedFile && !S._mediaPreviewMode) {
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

    await window.NativeAPI.writeFile(pathToSave, contentToSave);
    // Set the suppress window INSIDE the lock so a watcher event that
    // races our write sees the suppression even if it enters the lock
    // immediately after us.
    S._suppressWatchUntil = Date.now() + SUPPRESS_MS;
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
  // 'deferred-external' or 'deferred-replaced'. No dialog — the watcher's
  // own dialog is the user's resolution path. Treat as a save failure
  // (return false) so callers see the same signal as a real failure.
  return false;
}

// ── Successful write past this point — post-write bookkeeping ────────
_autoSaveCooldownUntil = 0;
// An explicit save of this file discharges the "Keep my version" promise.
if (S._conflictHoldPath === pathToSave) S._conflictHoldPath = null;

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

      saveActiveFile();
      return;
    }

    _autoSaveTimer = setTimeout(saveActiveFile, autosaveDelayMs());
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
  window.sidebarPivotToNewFile = async function(newPath, newRoot) {
    S.activeFilePath = newPath;
    markClean();
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
    /* ── Media preview mode: create a .md file on the first keystroke ── */
    if (S._mediaPreviewMode && !S._mediaPreviewMode.fileCreated) {
      S._mediaPreviewMode.fileCreated = true; // set immediately to prevent re-entry
      (async () => {
        const dir      = S._mediaPreviewMode.pendingMdDir;
        const baseName = S._mediaPreviewMode.mediaPath
          .replace(/\\/g, '/').split('/').pop()
          .replace(/\.[^/.]+$/, ''); // strip media extension
        const newPath  = await uniquePath(dir, baseName, 'md');
        try {
          await window.NativeAPI.createFile(newPath);
          // Write what the user has already typed (current editor content)
          await window.NativeAPI.writeFile(newPath, editor.value);
          // Suppress AFTER write — ensures the full window is fresh when
          // startWatchingFile(newPath) is called moments later.
          S._suppressWatchUntil = Date.now() + SUPPRESS_MS;
        } catch (err) {
          console.error('[Sidebar] media auto-create failed:', err);
          S._mediaPreviewMode.fileCreated = false; // allow retry
          return;
        }
        S.activeFilePath  = newPath;
        S._mediaPreviewMode = null;
        window._showingUnsupportedFile = false;
        await window.NativeAPI.setLastOpenedFile(newPath);
        if (docTitleEl) {
          docTitleEl.value = newPath.replace(/\\/g, '/').split('/').pop()
                                    .replace(/\.(md|txt)$/, '');
        }
        startWatchingFile(newPath);
        expandedDirs.add(dir);
        await renderTree();
        highlightActiveFile(newPath);
      })();
      return; // skip dirty-mark until file exists
    }


/* ── Scratchpad mode: Auto-create a .md file if typing in an empty state ── */
    if (!S.activeFilePath && !S._mediaPreviewMode && !_autoCreatingFile && !window._showingUnsupportedFile) {
      const targetDir = S.selectedDirPath || S.rootPath;
      if (targetDir) {

        const placeholderKey = ensureScratchpadVolatileKey();
        try {
          window.NativeAPI.setVolatileContent(placeholderKey, editor.value);
        } catch (e) {

          console.warn('[Sidebar] scratchpad placeholder volatile failed (non-fatal):', e);
        }

        _autoCreatingFile = true; // Lock to prevent duplicate files if user types fast
        (async () => {
          const newPath = await uniquePath(targetDir, 'untitled', 'md');
          try {
            await window.NativeAPI.createFile(newPath);
            // Instantly write the first keystrokes to the new file
            await window.NativeAPI.writeFile(newPath, editor.value);
            // Suppress AFTER write — same reasoning as saveActiveFile().
            S._suppressWatchUntil = Date.now() + SUPPRESS_MS;
          } catch (err) {
            console.error('[Sidebar] scratchpad auto-create failed:', err);
            _autoCreatingFile = false;

            if (!_scratchpadFailureWarned) {
              _scratchpadFailureWarned = true;
              window.NativeAPI.showMessageBox({
                type: 'warning',
                title: window.t('Could Not Create File'),
                message: window.t('A file could not be created to save your work.'),
                detail: String(err) + '\n\nYour typed content is still visible but has not been saved to disk. The app will retry automatically on your next keystroke.',
                buttons: ['OK'],
                defaultId: 0,
              }).catch(() => {}); // ignore if the dialog itself fails
            }
            return;
          }
          S.activeFilePath = newPath;
          _autoCreatingFile = false;
 
          _scratchpadFailureWarned = false;

          await window.NativeAPI.setLastOpenedFile(newPath);
          if (docTitleEl) {
            docTitleEl.value = newPath.replace(/\\/g, '/').split('/').pop().replace(/\.(md|txt)$/, '');
          }
          startWatchingFile(newPath);
          expandedDirs.add(targetDir);
          await renderTree();
          highlightActiveFile(newPath);

          // Mark dirty so normal autosave picks up any subsequent keystrokes
          markDirty();
          scheduleAutoSave();
          window.NativeAPI.setVolatileContent(S.activeFilePath, editor.value);


          if (S._scratchpadVolatileKey) {
            const oldKey = S._scratchpadVolatileKey;
            S._scratchpadVolatileKey = null;
            window.NativeAPI.deleteVolatileContent(oldKey).catch(() => {});
          }
        })();
        return; // skip normal flow until file is fully established
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
      if (undoStack.length === 0) return;
      e.preventDefault();
      await undoLastOperation();
    }
  });
}

/* watcher.js — external-change watcher for the active file. */
import { S } from './state.js';
import { _enqueueDiskOp, cancelPendingAutoSave, markClean, writeDurableSnapshot,
         rememberDiskContent, setAutosaveHold, clearAutosaveHold,
         scheduleAutoSave, compareDiskWithBaseline, noteBackupBase } from './save.js';
import { saveTextBesideNote } from './helpers.js';
import { renderTree } from './tree.js';

  let _watchedPath = null;

function startWatchingFile(filePath) {
    if (_watchedPath) {
      Promise.resolve(window.NativeAPI.unwatchFile(_watchedPath)).catch(() => {});
      _watchedPath = null;
    }

    if (!filePath) return;

    Promise.resolve(window.NativeAPI.watchFile(filePath, (eventType) => {
      if (eventType !== 'modify') return;
      checkActiveFileOnDisk(filePath).catch((err) =>
        console.warn('[Sidebar] external-change check failed:', err));
    })).catch((err) => {
      /* No watcher (e.g. the OS limit on watched folders is reached, or a
         network share without change notifications): say so instead of
         failing silently — changes by other programs go unnoticed. */
      console.warn('[Sidebar] Could not watch file for external changes:', err);
      if (typeof window.showStatusWarning === 'function') {
        window.showStatusWarning('watch-failed',
          window.t('Changes made to this file by other programs cannot be detected right now.'),
          { priority: 15, ttl: 8000 });
      }
    });

    _watchedPath = filePath;
  }

/* ══════════════════════════════════════════════════════════════════
     HAS ANOTHER PROGRAM CHANGED THE OPEN NOTE?
   Runs after every change event of the watched note, and when a save
   found the disk different from what we last read or wrote (save.js
   'deferred-verify': the save stopped instead of overwriting). Resolves
   to the verdict — 'same' | 'missing' | 'unreadable' | 'changed' — or
   null when there was nothing to decide (another note is open, a check
   or its dialog is already running, the file could not be read).
  ══════════════════════════════════════════════════════════════════ */
async function checkActiveFileOnDisk(filePath) {
  /* ── Quick rejects (no lock) ─────────────────────────────────────── */
  if (filePath !== S.activeFilePath) return null;

  /* If we are already inside the dialog flow for an earlier event,
     additional events from the external program are coalesced into
     the open dialog. Without this guard, a sequence of external
     writes would stack multiple dialogs. */
  if (S._externalChangeInProgress) return null;

  /* ── Verify under the disk lock ───────────────────────────────────
     Saves write AND record the on-disk text (S._diskBaseline) inside
     the same lock, so when this runs every earlier save is on disk and
     recorded. Comparing the disk with that record tells our own writes
     (and touches that changed nothing) from real external changes. The
     remaining gap — an autosave landing between another program's write
     and this event (the debounce) — is closed by the same comparison
     inside the save itself (save.js). */
  let verdict;
  try {
    verdict = await _enqueueDiskOp(async () => {
      // The user may have switched files while we waited in the queue.
      if (filePath !== S.activeFilePath) return null;
      // A check queued behind one that already opened the dialog (a change
      // event AND a stopped save for the same write): coalesce, never ask twice.
      if (S._externalChangeInProgress) return null;

      const disk = await compareDiskWithBaseline(filePath, editor.value);
      if (disk.kind === 'unknown') {
        // Locked or transient: the next change event (or save) checks again.
        console.warn('[Sidebar] Could not verify external change content:', disk.error);
        return null;
      }
      // Exactly what we last read or wrote (our own write, a no-op touch),
      // or already equal to the buffer (e.g. Save As over this very file).
      if (disk.kind === 'same' || disk.kind === 'adopted') return { kind: 'same' };
      if (disk.kind === 'missing' || disk.kind === 'unreadable') return { kind: disk.kind };

      // Real external change. Set the flag here, inside the lock,
      // so any save behind us in the chain bails on its own check.
      S._externalChangeInProgress = true;
      return { kind: 'changed' };
    });
  } catch (err) {
    // The lock op itself rejected (unexpected — read errors are handled
    // above). Be defensive.
    console.warn('[Sidebar] verify lock op rejected:', err);
    return null;
  }

  if (!verdict) return null;

  if (verdict.kind === 'same') {
    /* The file is back exactly as we know it: a hold that existed only
       because it had vanished or become unreadable is over. */
    if (S._conflictHoldPath === filePath
        && (S._holdReason === 'missing' || S._holdReason === 'unreadable')) {
      clearAutosaveHold();
      if (S.isDirty) scheduleAutoSave();
    }
    return 'same';
  }

  if (verdict.kind === 'missing' || verdict.kind === 'unreadable') {
    /* Deleted or moved by another program, or rewritten in an encoding
       the editor cannot read. Autosave would recreate the file, or
       overwrite what the other program left: pause it for this file
       (Ctrl+S / Save As still save) and snapshot the buffer — which may
       now be the only copy — to the reboot-safe slot. No modal dialog:
       a sync tool that replaces the file a moment later is simply seen
       by the next event. */
    cancelPendingAutoSave();
    setAutosaveHold(filePath, verdict.kind);
    /* Based on the version we last read or wrote (S._diskBaseline): the
       start-up recovery sees that the file is no longer that version. */
    writeDurableSnapshot(filePath, editor.value, noteBackupBase());
    return verdict.kind;
  }

  /* ── verdict 'changed': ask the user (OUTSIDE the lock) ────────────
     The dialog could take minutes to resolve. Holding the lock that
     long would block legitimate disk ops on other code paths. The
     S._externalChangeInProgress flag (set above, inside the lock) is
     what keeps saves out — not lock holding. The finally block below
     clears the flag once the dialog flow is done.                  */
  cancelPendingAutoSave();
  let resolved = false; // true once the editor holds the disk version again
  try {
    const dialogButtons = S.isDirty
      ? ['Reload from disk', 'Save my version & reload', 'Keep my version']
      : ['Reload from disk', 'Keep my version'];
    const dialogCancelId = dialogButtons.length - 1;
    /* The default (Enter — and Space where the dialog focuses it) must
       never discard anything: this question appears unasked, often while
       the user is typing. With unsaved edits, "Reload from disk" (which
       drops them) used to be the default; "Save my version & reload"
       keeps both versions, each in its own file. Without unsaved edits a
       reload loses nothing. */
    const dialogDefaultId = S.isDirty ? dialogButtons.indexOf('Save my version & reload') : 0;

    const result = await window.NativeAPI.showMessageBox({
      type: 'question',
      buttons: dialogButtons,
      defaultId: dialogDefaultId,
      cancelId:  dialogCancelId,
      title: 'File Changed Externally',
      message: `"${filePath.replace(/\\/g, '/').split('/').pop()}" was modified by another program.`,
      detail: S.isDirty
        ? 'You have unsaved changes. "Reload from disk" discards them. "Save my version & reload" writes your unsaved edits to a new file alongside the original, then loads the latest disk version. "Keep my version" leaves the editor untouched and pauses auto-save for this file — the disk keeps the external version until you save manually (Ctrl+S), switch files, or close (which writes your version).'
        : 'Do you want to reload the latest version? "Keep my version" leaves the editor as it is and pauses auto-save for this file until you save it (Ctrl+S).',
    });

    const choice = dialogButtons[result.response];

    if (choice === 'Reload from disk') {
      /* Read fresh and swap the editor under the lock. Bumping
         S._replaceGeneration inside the lock guarantees that any
         save snapshotted before this point sees the bump on its
         own check and bails. */
      try {
        await _enqueueDiskOp(async () => {
          const fresh = await window.NativeAPI.readFile(filePath);
          if (typeof window.replaceEditorContent === 'function') {
            window.replaceEditorContent(fresh);
          } else {
            editor.value = fresh;
            if (typeof render     === 'function') render();
            if (typeof countWords === 'function') countWords();
          }
          S._replaceGeneration++;
          markClean();
          rememberDiskContent(fresh);
          /* The user discarded the version that was on screen ("Reload from
             disk discards them"). Its crash backup — and a backup write of it
             still waiting in the debounce — must go too: left behind, it was
             offered again at the next start as "unsaved changes", and its
             Restore wrote the discarded text over the file. Synchronous with
             the swap: no keystroke for the reloaded text can land between. */
          window.NativeAPI.deleteVolatileContent(filePath).catch(() => {});
        });
        resolved = true;
      } catch (err) {
        console.error('[Sidebar] reload after external change failed:', err);
      }

    } else if (choice === 'Save my version & reload') {
      // Snapshot the user's content BEFORE any await so subsequent
      // keystrokes (the modal blocked them, but the awaits below do not)
      // cannot alter what we promise to preserve.
      const copyContent = editor.value;

      /* Copy + reload inside ONE lock acquisition so no save can
         interleave between writing the copy and swapping the editor.
         The failure tracking survives the lock op via closure and lets
         the catch below decide which error message to show. The copy is
         "<name>_local" beside the note (helpers.saveTextBesideNote — the
         same writer as a recovered crash backup: never overwrites, and
         removes its empty file again when the write fails). */
      let copyPath  = null;
      let reloadErr = null;
      let copyErr   = null;

      try {
        await _enqueueDiskOp(async () => {
          try {
            copyPath = await saveTextBesideNote(filePath, copyContent, '_local');
          } catch (err) {
            copyErr = err;
            throw err; // exit the lock op; outer catch reports it
          }

          // Copy succeeded. Now read+swap the original.
          try {
            const fresh = await window.NativeAPI.readFile(filePath);
            if (typeof window.replaceEditorContent === 'function') {
              window.replaceEditorContent(fresh);
            } else {
              editor.value = fresh;
              if (typeof render     === 'function') render();
              if (typeof countWords === 'function') countWords();
            }
            S._replaceGeneration++;
            markClean();
            rememberDiskContent(fresh);
          } catch (err) {
            reloadErr = err;
            throw err; // exit the lock op; outer catch shows partial-success message
          }
        });
      } catch (_innerErr) {
        // The lock op threw — copyErr OR reloadErr is set above.
        if (copyErr) {
          console.error('[Sidebar] save-as-copy failed:', copyErr);
          window.NativeAPI.showMessageBox({
            type: 'error',
            title: 'Could Not Save Copy',
            message: 'Your version could not be saved as a copy.',
            detail: String(copyErr) + '\n\nYour unsaved content is still in the editor; the disk version was NOT loaded. You can copy your work elsewhere or try again.',
            buttons: ['OK'],
          }).catch(() => {});
          return; // finally still runs, pausing autosave for this file
        }

        // copyOk && reloadErr — partial success.
        console.error('[Sidebar] reload after save-as-copy failed:', reloadErr);
        const copyNameP = copyPath.replace(/\\/g, '/').split('/').pop();
        window.NativeAPI.showMessageBox({
          type: 'warning',
          title: 'Saved Copy, Could Not Reload',
          message: `Your version was saved as "${copyNameP}", but the original could not be reloaded.`,
          detail: String(reloadErr),
          buttons: ['OK'],
        }).catch(() => {});
        return;
      }

      /* Lock op succeeded: copy is on disk and editor was swapped. */
      resolved = true;
      window.NativeAPI.deleteVolatileContent(filePath).catch(() => {});

      if (typeof renderTree === 'function') {
        await renderTree();
      }

      const copyName = copyPath.replace(/\\/g, '/').split('/').pop();
      window.NativeAPI.showMessageBox({
        type:    'info',
        title:   'Saved as Copy',
        message: `Your version was saved as "${copyName}".`,
        detail:  'The latest disk version of the original file is now loaded.',
        buttons: ['OK'],
      }).catch(() => {});
    }

  } finally {
    S._externalChangeInProgress = false;
    /* Unless the editor now shows the disk version, the disk holds
       content the editor does not: "Keep my version" (also Escape), or
       a copy/reload step that failed. Background autosave would
       silently destroy the other program's version — so pause it for
       this file, ALSO when the buffer had no unsaved edits (typing
       afterwards used to overwrite the external version unasked), and
       snapshot the buffer (the only copy of the user's version) to the
       durable, reboot-safe slot. An explicit save lifts the hold.
       The snapshot names the version it was based on — the one we last
       read or wrote, NOT what the other program left — so the start-up
       recovery never offers "Restore" over the newer file by default
       (lifecycle.js), and leaving the note without saving keeps the
       user's version as a copy (save.js keptVersionOnScreen). */
    if (!resolved && S.activeFilePath === filePath) {
      setAutosaveHold(filePath, 'conflict');
      writeDurableSnapshot(filePath, editor.value, noteBackupBase());
    }
  }
  return 'changed';
}

/* Stop watching and WAIT until the backend has let go. Both backends
   watch the note's FOLDER; on Windows an open handle inside a folder can
   make renaming or moving that folder (or any folder above it) fail. The
   file operations call this before touching the open note's path and
   start watching again afterwards (the new path, or the old one when the
   operation failed). */
async function stopWatchingFile() {
  const p = _watchedPath;
  _watchedPath = null;
  if (!p) return;
  try { await window.NativeAPI.unwatchFile(p); } catch (_) { /* gone already */ }
}

function watchedPath() { return _watchedPath; }

export { startWatchingFile, stopWatchingFile, watchedPath, checkActiveFileOnDisk };

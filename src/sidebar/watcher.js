/* watcher.js — external-change watcher for the active file. */
import { S } from './state.js';
import { _enqueueDiskOp, cancelPendingAutoSave, markClean, writeDurableSnapshot,
         rememberDiskContent, setAutosaveHold, clearAutosaveHold,
         scheduleAutoSave } from './save.js';
import { normalizeEol } from './eol.js';
import { uniquePath, fileExistsViaListing } from './helpers.js';
import { renderTree } from './tree.js';

  let _watchedPath = null;

function startWatchingFile(filePath) {
    if (_watchedPath) {
      Promise.resolve(window.NativeAPI.unwatchFile(_watchedPath)).catch(() => {});
      _watchedPath = null;
    }

    if (!filePath) return;

    Promise.resolve(window.NativeAPI.watchFile(filePath, async (eventType) => {
      /* ── Quick rejects (no lock) ─────────────────────────────────────── */
      if (eventType !== 'modify') return;
      if (filePath !== S.activeFilePath) return;

      /* If we are already inside the dialog flow for an earlier event,
         additional events from the external program are coalesced into
         the open dialog. Without this guard, a sequence of external
         writes would stack multiple dialogs. */
      if (S._externalChangeInProgress) return;

      /* ── Verify under the disk lock ───────────────────────────────────
         Saves write AND record the on-disk text (S._diskBaseline) inside
         the same lock, so when this runs every earlier save is on disk and
         recorded. Comparing the disk with that record tells our own writes
         (and touches that changed nothing) from real external changes
         exactly — there is no time window in which another program's
         change could be ignored and then overwritten by the next autosave. */
      let verdict;
      try {
        verdict = await _enqueueDiskOp(async () => {
          // The user may have switched files while we waited in the queue.
          if (filePath !== S.activeFilePath) return null;

          let content;
          try {
            content = await window.NativeAPI.readFile(filePath);
          } catch (readErr) {
            const exists = await fileExistsViaListing(filePath);
            if (exists === false) return { kind: 'missing' };
            if (exists === true && /not valid UTF-8/.test(String(readErr))) return { kind: 'unreadable' };
            // Locked or transient: the next change event checks again.
            console.warn('[Sidebar] Could not verify external change content:', readErr);
            return null;
          }

          // Exactly what we last read or wrote: our own write, or a no-op touch.
          if (S._diskBaseline !== null && content === S._diskBaseline) return { kind: 'same' };
          // Disk equals the buffer (e.g. Save As over this very file): in sync.
          if (normalizeEol(content) === editor.value) {
            rememberDiskContent(content);
            return { kind: 'same' };
          }

          // Real external change. Set the flag here, inside the lock,
          // so any save behind us in the chain bails on its own check.
          S._externalChangeInProgress = true;
          return { kind: 'changed' };
        });
      } catch (err) {
        // The lock op itself rejected (unexpected — read errors are handled
        // above). Be defensive.
        console.warn('[Sidebar] verify lock op rejected:', err);
        return;
      }

      if (!verdict) return;

      if (verdict.kind === 'same') {
        /* The file is back exactly as we know it: a hold that existed only
           because it had vanished or become unreadable is over. */
        if (S._conflictHoldPath === filePath
            && (S._holdReason === 'missing' || S._holdReason === 'unreadable')) {
          clearAutosaveHold();
          if (S.isDirty) scheduleAutoSave();
        }
        return;
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
        writeDurableSnapshot(filePath, editor.value);
        return;
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

        const result = await window.NativeAPI.showMessageBox({
          type: 'question',
          buttons: dialogButtons,
          defaultId: 0,
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

          const baseName = filePath.replace(/\\/g, '/').split('/').pop();
          const lastDot  = baseName.lastIndexOf('.');
          const stem     = lastDot > 0 ? baseName.substring(0, lastDot) : baseName;
          const ext      = lastDot > 0 ? baseName.substring(lastDot + 1) : 'md';
          const dir      = filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

          /* Copy + reload inside ONE lock acquisition so no save can
             interleave between writing the copy and swapping the editor.
             The two-phase failure tracking (createdOk/copyOk) survives
             the lock op via closure and lets the catch below decide
             which error message to show. */
          let copyPath  = null;
          let createdOk = false;
          let copyOk    = false;
          let reloadErr = null;
          let copyErr   = null;

          try {
            await _enqueueDiskOp(async () => {
              try {
                copyPath  = await uniquePath(dir, stem + '_local', ext);
                await window.NativeAPI.createFile(copyPath);
                createdOk = true;
                await window.NativeAPI.writeFile(copyPath, copyContent);
                copyOk    = true;
              } catch (err) {
                copyErr = err;
                throw err; // exit the lock op; outer catch handles cleanup
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
              // Empty placeholder cleanup if createFile succeeded but
              // writeFile failed.
              if (createdOk && !copyOk && copyPath) {
                window.NativeAPI.deleteNode(copyPath).catch(() => {});
              }
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
           durable, reboot-safe slot. An explicit save lifts the hold. */
        if (!resolved && S.activeFilePath === filePath) {
          setAutosaveHold(filePath, 'conflict');
          writeDurableSnapshot(filePath, editor.value);
        }
      }
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

export { startWatchingFile };

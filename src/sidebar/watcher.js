/* watcher.js — external-change watcher for the active file. */
import { S, SUPPRESS_MS } from './state.js';
import { _enqueueDiskOp, cancelPendingAutoSave, markClean } from './save.js';
import { uniquePath } from './helpers.js';
import { renderTree } from './tree.js';

  let _watchedPath = null;

function startWatchingFile(filePath) {
    if (_watchedPath) {
      window.NativeAPI.unwatchFile(_watchedPath);
      _watchedPath = null;
    }

    if (!filePath) return;






















    window.NativeAPI.watchFile(filePath, async (eventType) => {
      /* ── Quick rejects (no lock) ──────────────────────────────────────
         These checks run synchronously in the watcher's microtask. They
         are pre-filters; the verify op below re-checks the time-sensitive
         conditions inside the lock to handle races.                      */
      if (eventType !== 'modify') return;
      if (filePath !== S.activeFilePath) return;
      if (Date.now() < S._suppressWatchUntil) return;

      /* If we are already inside the dialog flow for an earlier event,
         additional events from the external program are coalesced into
         the open dialog. Without this guard, a sequence of external
         writes would stack multiple dialogs. */
      if (S._externalChangeInProgress) return;

      /* Synchronously cancel any pending autosave so a save can't enqueue
         on _diskOpsChain between this point and the verify op below. The
         verify op also sets S._externalChangeInProgress inside the lock, so
         any save that DOES enqueue concurrently will see that flag and
         bail; this clearTimeout is just an optimization to avoid doing
         that work in the common case. */
      cancelPendingAutoSave();

      /* ── Verify under lock ────────────────────────────────────────────
         Reading disk and setting S._externalChangeInProgress happens in
         the same lock op. Saves enqueued AFTER us in the chain see the
         flag and bail. Saves IN-FLIGHT when we entered the lock-queue
         finished their writeFile first; their S._suppressWatchUntil set
         inside the same lock means we re-detect it and short-circuit
         (so we don't fire a false-positive dialog after our own save).  */
      let diskContent;
      try {
        diskContent = await _enqueueDiskOp(async () => {
          // A save that ran just ahead of us in the chain may have set
          // S._suppressWatchUntil — re-check inside the lock.
          if (Date.now() < S._suppressWatchUntil) return null;
          // The user may have switched files while we waited in the queue.
          if (filePath !== S.activeFilePath) return null;

          let content;
          try {
            content = await window.NativeAPI.readFile(filePath);
          } catch (readErr) {
            console.warn('[Sidebar] Could not verify external change content:', readErr);
            return null;
          }
          // Compare AGAINST editor.value snapshot taken inside the lock.
          // No save can interleave between this read and this compare.
          if (content === editor.value) return null;

          // Real external change. Set the flag here, inside the lock,
          // so any save behind us in the chain bails on its own check.
          S._externalChangeInProgress = true;
          return content;
        });
      } catch (err) {
        // The lock op itself rejected (unexpected — readFile errors are
        // caught above and return null). Be defensive.
        console.warn('[Sidebar] verify lock op rejected:', err);
        return;
      }

      if (diskContent === null) return; // false alarm; no flag was set

      /* ── User dialog (OUTSIDE the lock) ───────────────────────────────
         The dialog could take minutes to resolve. Holding the lock that
         long would block legitimate disk ops on other code paths. The
         S._externalChangeInProgress flag (set above, inside the lock) is
         what keeps saves out — not lock holding. The finally block
         below clears the flag once the dialog flow is done.            */
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
            : 'Do you want to reload the latest version?',
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
            });
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
              return; // finally still runs, clearing the flag
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
        /* If we leave this flow still dirty, the user either chose "Keep my
           version" or a copy/reload step failed — in every such case the
           disk holds content the editor does not, and background autosave
           would silently destroy it (the exact behavior the dialog promised
           NOT to do). Hold autosave for this file; explicit saves lift it. */
        if (S.isDirty) S._conflictHoldPath = filePath;
      } });
           










    _watchedPath = filePath;
  }

export { startWatchingFile };

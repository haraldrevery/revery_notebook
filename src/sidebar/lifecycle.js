/* lifecycle.js — unified close-time handler and the boot sequence
   (session restore, crash recovery, scratchpad recovery). */
import { S, docTitleEl, folderNameEl, expandedDirs,
         SCRATCHPAD_PREFIX } from './state.js';
import { saveActiveFile, markClean, markDirty, scheduleAutoSave, cancelPendingAutoSave,
         rememberDiskContent } from './save.js';
import { normalizeEol } from './eol.js';
import { renderTree, highlightActiveFile } from './tree.js';
import { updateViewBtn } from './cards.js';
import { openSidebar } from './panel.js';
import { startWatchingFile } from './watcher.js';
import { openFile } from './fileops.js';
import { uniquePath, reportBakOrphans, fileExistsViaListing } from './helpers.js';
import { loadProjects, recordProjectOpen, seedProjectsCache, PROJECTS_KEY } from './projects.js';

async function sidebarHandleClose() {
  cancelPendingAutoSave();

// Case 1: A real file is open on disk
  if (S.activeFilePath) {
    if (S.isDirty) {
      let saved = false;
      for (let attempt = 0; attempt < 3 && S.isDirty; attempt++) {
        try {
          saved = await saveActiveFile();
        } catch (err) {

          console.error('[sidebarHandleClose] Save threw unexpectedly:', err);
          saved = false;
        }
        if (!saved) break; // real failure or deferred save → discard dialog below
      }

      if (!saved) {
        // saveActiveFile has already shown its own "Save Failed" dialog with
        // the OS error detail. Now confirm whether to discard or cancel
        // the close — never proceed silently.
        const baseName = S.activeFilePath.replace(/\\/g, '/').split('/').pop();
        let proceedWithClose = false;
        try {
          const choice = await window.NativeAPI.showMessageBox({
            type:    'warning',
            title:   'Unsaved Changes',
            message: `Could not save "${baseName}". Closing now will discard your changes.`,
            detail:  'Cancel to keep the window open so you can copy your work elsewhere or fix the underlying problem (e.g. free up disk space, unlock the file).',
            buttons: ['Discard and Quit', 'Cancel'],
            defaultId: 1,
            cancelId:  1,
          });
          proceedWithClose = (choice.response === 0);
        } catch (dialogErr) {
          // If the dialog itself fails, the safe default is to NOT close.
          console.error('[sidebarHandleClose] discard-confirmation dialog failed:', dialogErr);
          proceedWithClose = false;
        }
        if (!proceedWithClose) {

          return;
        }
      }
    }
    if (S.isDirty && typeof window.NativeAPI.writeVolatileNow === 'function') {
      try { await window.NativeAPI.writeVolatileNow(S.activeFilePath, editor.value); } catch (_) {}
    }
    window.isQuitting = true;
    window.NativeAPI.confirmClose();
    return;
  }

  if (editor.value.trim().length > 0) {
    if (typeof openQuitModal === 'function') {

      openQuitModal();
      return;
    }

    window.isQuitting = true;
    window.NativeAPI.confirmClose();
    return;
  }

  // Case 3: Nothing unsaved → close immediately
  window.isQuitting = true;
  window.NativeAPI.confirmClose();
}

export { sidebarHandleClose };

export function initCloseHandler() {
window.sidebarHandleClose = sidebarHandleClose;
window.NativeAPI.onWindowClose(sidebarHandleClose);
}

/* ══════════════════════════════════════════════════════════════════
     BOOT — restore session or seed default folder
  ══════════════════════════════════════════════════════════════════ */

  /* ── Scratchpad crash recovery ──────────────────────────────────────
     Backups under SCRATCHPAD_PREFIX belong to text typed before a file
     existed (auto-create hadn't completed, or kept failing, when the app
     died). Runs once per boot, AFTER the normal session restore, and
     prompts for the NEWEST non-empty backup only — older ones get their
     own prompt on subsequent boots, or expire via the 7-day purge.
     Safety invariants:
       • A backup is deleted ONLY after its content is durably on disk,
         or adopted as the live scratchpad key. (Exception: backups whose
         content is empty/whitespace — nothing recoverable — are removed.)
       • Every failure path keeps the backup and leaves the editor as-is.
       • Enter = Recover (creates a new file, destroys nothing).
         Escape = Not now (keeps the backup). Discard requires a click.
         Requires fix #2: on Tauri this 3-button dialog goes through the
         HTML fallback, which honors defaultId/cancelId.                 */
  /* Rename journal reconciliation (the inline title rename journals
     from → to before renaming). If the app died after the rename but
     before the last-opened pointer was updated, the pointer still names
     `from`. Repair it only when `from` is DEFINITELY gone and `to`
     DEFINITELY exists; anything uncertain leaves lastFile untouched and
     keeps the journal for the next boot. Must run AFTER setRootPath:
     both backends refuse every file-system call until a root is set,
     which is why this check, when it ran earlier, could never succeed.
     Never throws. */
  async function reconcilePendingRename(journal, lastFile) {
    if (!journal) return lastFile;
    let result = lastFile;
    let keepJournal = false;
    try {
      if (typeof journal.from === 'string' && typeof journal.to === 'string'
          && lastFile === journal.from) {
        const fromExists = await fileExistsViaListing(journal.from);
        const toExists   = (fromExists === false) ? await fileExistsViaListing(journal.to) : null;
        if (fromExists === null || (fromExists === false && toExists === null)) {
          keepJournal = true; // could not tell — decide on a later boot
        } else if (fromExists === false && toExists === true) {
          console.info('[Sidebar Boot] Reconciling pending rename: %s → %s', journal.from, journal.to);
          result = journal.to;
          try {
            await window.NativeAPI.setLastOpenedFile(journal.to);
          } catch (e) {
            // The corrected in-memory value is used anyway; the next boot
            // re-reconciles because the journal is kept.
            console.warn('[Sidebar Boot] Could not persist reconciled lastOpenedFile:', e);
            keepJournal = true;
          }
        }
      }
    } catch (e) {
      console.warn('[Sidebar Boot] Pending-rename reconciliation failed (non-fatal):', e);
      keepJournal = true;
    }
    if (!keepJournal && typeof window.NativeAPI.setPendingRename === 'function') {
      window.NativeAPI.setPendingRename(null).catch((e) =>
        console.warn('[Sidebar Boot] Could not clear rename journal:', e));
    }
    return result;
  }

  async function recoverScratchpadBackups() {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
    if (typeof window.NativeAPI.listVolatileBackups !== 'function') {
      return; // older backend without the command — graceful no-op
    }

    let backups = [];
    try {
      backups = await window.NativeAPI.listVolatileBackups(SCRATCHPAD_PREFIX);
    } catch (e) {
      console.warn('[Sidebar Boot] Scratchpad backup scan failed (non-fatal):', e);
      return;
    }
    if (!Array.isArray(backups)) return;

    for (const info of backups) { // newest-first from the backend
      if (!info || typeof info.originalPath !== 'string') continue;
      if (info.originalPath === S._scratchpadVolatileKey) continue; // this session's own key

      let backup = null;
      try {
        backup = await window.NativeAPI.getVolatileContent(info.originalPath);
      } catch (_) { /* unreadable → skip, never delete what we can't verify */ }
      if (!backup || typeof backup.content !== 'string') continue;

      if (backup.content.trim().length === 0) {
        // Nothing recoverable — pure noise from a crash mid-first-keystroke.
        window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {});
        continue;
      }

      const ts = new Date(backup.ts || info.ts || Date.now()).toLocaleString();
      let choice;
      try {
        choice = await window.NativeAPI.showMessageBox({
          type:    'question',
          title:   window.t('Recover unsaved text?'),
          message: window.t('Text typed in a previous session was never saved to a file.'),
          detail:  `${window.t('Last edited:')} ${ts}\n\n` +
                   window.t('\u201CRecover\u201D writes it into a new file in your project. \u201CDiscard\u201D deletes the backup permanently. \u201CNot now\u201D keeps the backup and asks again next time.'),
          buttons:   [window.t('Recover'), window.t('Discard'), window.t('Not now')],
          defaultId: 0, // Recover — safe default: creates a new file
          cancelId:  2, // Escape → Not now — never destructive
        });
      } catch (e) {
        console.warn('[Sidebar Boot] Recovery dialog failed (non-fatal):', e);
        return; // backup kept; ask again next boot
      }

      if (choice.response === 2) return;     // Not now — keep backup
      if (choice.response === 1) {           // Discard — explicit click only
        await window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {});
        return;
      }

      /* ── Recover ── */
      const dir = S.selectedDirPath || S.rootPath;

      if (!dir) {
        /* No project folder open: adopt the backup as the LIVE scratchpad.
           replaceEditorContent does not fire input listeners, so the
           auto-create flow stays dormant until the user actually types.
           Reusing the OLD key as S._scratchpadVolatileKey makes the existing
           backup the live protection for this text — zero extra writes,
           zero delete risk; the normal flow (first keystroke → create
           file → delete key) takes over from here.                      */
        if (typeof window.replaceEditorContent === 'function') {
          window.replaceEditorContent(backup.content);
        } else {
          editor.value = backup.content;
          if (typeof render     === 'function') render();
          if (typeof countWords === 'function') countWords();
        }
        S._scratchpadVolatileKey = info.originalPath;
        return;
      }

      try {
        /* Bounded create-retry on the pinned "already exists" contract (#7)
           — same pattern as createNewFile(). */
        let newPath = null;
        let created = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          newPath = await uniquePath(dir, 'recovered', 'md');
          try {
            await window.NativeAPI.createFile(newPath);
            created = true;
            break;
          } catch (err) {
            if (String(err).includes('already exists') && attempt < 4) continue;
            throw err;
          }
        }
        if (!created) throw new Error('Could not allocate a unique filename.');

        await window.NativeAPI.writeFile(newPath, backup.content);
        /* Content is durably on disk — only NOW may the backup go. */
        await window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {});

        /* Our own write cannot register as an external change: openFile()
           records what it reads as the file's on-disk content, and the
           watcher ignores events whose content matches that record. */

        expandedDirs.add(dir);
        await renderTree();
        await openFile(newPath);
      } catch (err) {
        console.error('[Sidebar Boot] Scratchpad recovery failed:', err);
        /* Backup NOT deleted — the user is asked again next boot. */
        window.NativeAPI.showMessageBox({
          type:    'error',
          title:   window.t('Recovery Failed'),
          message: window.t('The recovered text could not be written to a new file.'),
          detail:  String(err) + '\n\n' + window.t('The backup was kept. You will be asked again on the next start.'),
          buttons: ['OK'],
          defaultId: 0,
        }).catch(() => {});
      }
      return; // at most one prompt per boot
    }
  }

export function runBoot() {
  (async function bootSidebar() {
    let hasLoadedText = false;

    // Helper: Safely injects the starter guide if no file exists to open
    function injectStarterText() {
      if (hasLoadedText) return;
      hasLoadedText = true;
      const initialText = `# Revery Notebook\n\nA place to write digital notes, free from distractions and to keep the _thoughts-to-computer text_ process in one continuous flow. A markdown editor with the iconic ½ font.\n\n---\n\n## Quick Guide\n\nIn the upper right corner, settings can be personalized. You can adjust the various sizes for the interface elements and tune the performance for your hardware. Press \`CTRL+S\` to download your work as a \`.md\` file, using the name specified in the upper-left corner. In the settings you can also set how the file name prefix/suffix should be named.\n\nMore information, click the ½ logo in the center top of the screen.\n\n---\n\n\n###### - Harald Revery\n`;
      if (typeof window.replaceEditorContent === 'function') {
        window.replaceEditorContent(initialText);
      } else {
        editor.value = initialText;
        if (typeof render === 'function') render();
        if (typeof countWords === 'function') countWords();
      }
    }

try {
      /* 1. Try to restore last session */
      let lastFile = await window.NativeAPI.getLastOpenedFile();

      /* Read the rename journal now; it is reconciled right after
         setRootPath below (see reconcilePendingRename). */
      let journal = null;
      try {
        journal = (typeof window.NativeAPI.getPendingRename === 'function')
          ? await window.NativeAPI.getPendingRename()
          : null;
      } catch (e) {
        console.warn('[Sidebar Boot] Could not read rename journal (non-fatal):', e);
      }

      /* 1a. Load the last root path */
      let savedRoot = null;
      if (typeof window.NativeAPI.getLastRootPath === 'function') {
        try { savedRoot = await window.NativeAPI.getLastRootPath(); } catch { /* ignore */ }
      }
      if (!savedRoot) {
        try { savedRoot = localStorage.getItem('revery_root_path'); } catch { /* ignore */ }
      }
      if (savedRoot) {
        try { localStorage.setItem('revery_root_path', savedRoot); } catch { /* ignore */ }
      }

      /* 1b. Seed project history */
      if (typeof window.NativeAPI.getProjectHistory === 'function') {
        try {
          const nativeHistory = await window.NativeAPI.getProjectHistory();
          if (Array.isArray(nativeHistory) && nativeHistory.length > 0) {
            seedProjectsCache(nativeHistory); 
            try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(nativeHistory)); } catch { /* ignore */ }
          } else {
            const localHistory = loadProjects();
            if (localHistory.length > 0) {
               window.NativeAPI.setProjectHistory(localHistory).catch(()=>{});
            }
          }
        } catch { /* non-critical */ }
      }

      if (lastFile || savedRoot) {
        let folder = savedRoot;
        if (!folder && lastFile) {
          const parts  = lastFile.replace(/\\/g, '/').split('/');
          parts.pop();
          folder = parts.join('/');
        }

        if (folder) {
          S.rootPath        = folder;
          await window.NativeAPI.setRootPath(folder);
          lastFile = await reconcilePendingRename(journal, lastFile);
          S.selectedDirPath = folder;
          const parts = folder.replace(/\\/g, '/').split('/');
          folderNameEl.textContent = parts[parts.length - 1] || folder;
          expandedDirs.clear();
          expandedDirs.add(folder);

          await recordProjectOpen(folder);
          S.cardViewDir = folder;

          if (lastFile && lastFile.replace(/\\/g, '/').startsWith(folder.replace(/\\/g, '/'))) {
            const relPath = lastFile.replace(/\\/g, '/').substring(folder.length).replace(/^\//, '');
            const relParts = relPath.split('/');
            relParts.pop(); 
            let currentPath = folder.replace(/\\/g, '/');
            for (const p of relParts) {
              currentPath += '/' + p;
              expandedDirs.add(currentPath);
            }
            S.selectedDirPath = currentPath; 
          }
          openSidebar();
          updateViewBtn();
          await renderTree();

          /* G3: surface any leftover .revery_bak orphans before the user
             starts editing. Non-blocking failure mode — if the scan or
             dialog throws, just continue booting. */
          try { await reportBakOrphans(folder, lastFile); }
          catch (e) { console.warn('[Sidebar Boot] Bak orphan report failed:', e); }

          /* ── Load File Content & Crash Recovery ── */
          if (lastFile) {
            try {
              const diskContent = await window.NativeAPI.readFile(lastFile);
              if (typeof window.replaceEditorContent === 'function') {
                window.replaceEditorContent(diskContent);
              } else {
                editor.value = diskContent;
                if (typeof render === 'function') render();
                if (typeof countWords === 'function') countWords();
              }
              hasLoadedText = true;
              
              S.activeFilePath = lastFile;
              markClean();
              rememberDiskContent(diskContent);
              highlightActiveFile(lastFile);
              startWatchingFile(lastFile);
              
              if (docTitleEl) {
                const base = lastFile.replace(/\\/g, '/').split('/').pop();
                docTitleEl.value = base.replace(/\.(md|txt)$/, '');
              }

              /* ── Crash recovery check ── */
              try {
                const backup = await window.NativeAPI.getVolatileContent(lastFile);
                /* Backups hold editor text, whose line breaks are always '\n';
                   compare against the disk text normalised the same way, or a
                   CRLF file would look "changed" after every crash. */
                const diskAsEditor = normalizeEol(diskContent);
                if (backup && backup.content !== diskAsEditor) {
                  const ts = new Date(backup.ts).toLocaleString();

                  /* ── Suspicious-backup guard ────────────────────────────
                     A crash during the backup write itself (power loss,
                     disk full) can leave the backup empty or truncated.
                     Restoring it and letting autosave run would overwrite
                     the INTACT on-disk file within seconds. For these
                     cases: warn explicitly and make "Discard" the default
                     so a reflexive Enter keeps the safe copy.            */
                  const backupLen = backup.content.length;
                  const diskLen   = diskContent.length;
                  const suspicious =
                    (backupLen === 0 && diskLen > 0) ||
                    (diskLen > 200 && backupLen < diskLen * 0.1);

                  /* ── Staleness guard ────────────────────────────────────
                     A backup OLDER than the file's last save means the disk
                     moved on after the backup was written — e.g. the user
                     accepted an external "Reload from disk", never edited
                     again, and a durable snapshot of the abandoned version
                     survived (those outlive reboots by design). A default
                     of "Restore" would replace the NEWER saved content on
                     a reflexive Enter. Keep offering the backup (never
                     destroy data on a guess) but flip the safe default.
                     mtime and backup.ts are both ms since epoch on both
                     platforms; either being unavailable (0) disables the
                     guard — when unsure, keep today's behavior.          */
                  let fileMtime = 0;
                  try {
                    const dirPath = lastFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
                    const entries = await window.NativeAPI.readDirectory(dirPath);
                    const norm = (p) => String(p).replace(/\\/g, '/');
                    const me = (entries || []).find((e) => norm(e.path) === norm(lastFile));
                    if (me && typeof me.mtime === 'number') fileMtime = me.mtime;
                  } catch (_) { /* stat failed — content-only heuristics below */ }
                  const stale = !suspicious
                    && fileMtime > 0 && backup.ts > 0 && backup.ts < fileMtime;

                  let dialogOpts;
                  if (suspicious) {
                    dialogOpts = {
                      type:    'warning',
                      message: 'A crash backup was found, but it looks incomplete.',
                      detail:  `Last edited: ${ts}\n\nThe backup is ${backupLen === 0 ? 'empty' : 'much shorter than the saved file'} (${backupLen} vs ${diskLen} characters) — it was likely damaged by the crash itself. Restoring it would REPLACE your saved file with this incomplete content.\n\nRecommended: keep the saved version.`,
                      buttons: ['Restore incomplete backup', 'Keep saved version'],
                      defaultId: 1,
                    };
                  } else if (stale) {
                    dialogOpts = {
                      type:    'warning',
                      message: 'A crash backup was found, but the file has been saved more recently.',
                      detail:  `Backup from: ${ts}\nFile last saved: ${new Date(fileMtime).toLocaleString()}\n\nThe saved file is NEWER than this backup — restoring would replace the newer saved content with this older backup.\n\nRecommended: keep the saved version.`,
                      buttons: ['Restore older backup', 'Keep saved version'],
                      defaultId: 1,
                    };
                  } else {
                    dialogOpts = {
                      type:    'question',
                      message: 'Unsaved changes from a previous session were found.',
                      detail:  `Last edited: ${ts}\n\nRestore these changes, or discard and keep the saved version.`,
                      buttons: ['Restore', 'Discard'],
                      defaultId: 0,
                    };
                  }

                  const choice = await window.NativeAPI.showMessageBox({
                    title: 'Recover unsaved changes?',
                    cancelId: 1,
                    ...dialogOpts,
                  });
                  if (choice.response === 0) {
                    // Restore the backup content
                    if (typeof window.replaceEditorContent === 'function') {
                      window.replaceEditorContent(backup.content);
                    } else {
                      editor.value = backup.content;
                      if (typeof render === 'function') render();
                      if (typeof countWords === 'function') countWords();
                    }
                    markDirty();
                    scheduleAutoSave();
                    // Immediately create a fresh volatile backup of the restored content
                    if (typeof window.NativeAPI.writeVolatileNow === 'function') {
                      await window.NativeAPI.writeVolatileNow(lastFile, backup.content).catch(e =>
                        console.warn('[Sidebar] Refreshing backup after restore failed:', e)
                      );
                    }
                  } else {
                    // User chose Discard – delete the stale backup
                    await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {});
                  }
                } else if (backup) {
                  // Backup identical to disk – clean it up
                  await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {});
                }
              } catch (e) {
                console.warn('[Sidebar Boot] Crash-recovery check failed (non-fatal):', e);
              }

            } catch (err) {
              console.warn('[Sidebar Boot] Could not read last file:', err);
              injectStarterText();
              try { await window.NativeAPI.clearLastOpenedFile(); } catch { /* ignore */ }
            }
          } else {
            injectStarterText();
          }

          if (typeof postProcessImages === 'function') postProcessImages();
        }
        return;
      }

      /* 2. No previous session — open the default notes folder */
      let defaultFolder = null;
      try {
        defaultFolder = await window.NativeAPI.getDefaultNotesFolder();
      } catch (e) {
        console.warn('[Sidebar] getDefaultNotesFolder failed:', e);
      }

      if (defaultFolder) {
        S.rootPath        = defaultFolder;
        await window.NativeAPI.setRootPath(defaultFolder);
        try { localStorage.setItem('revery_root_path', S.rootPath); } catch (e) {}
        recordProjectOpen(defaultFolder);
        S.selectedDirPath = defaultFolder;
        S.cardViewDir = defaultFolder;
        const parts = defaultFolder.replace(/\\/g, '/').split('/');
        folderNameEl.textContent = parts[parts.length - 1] || defaultFolder;
        expandedDirs.clear();
        expandedDirs.add(defaultFolder);
        openSidebar();
        updateViewBtn();
        await renderTree();
      }

    } catch (err) {
      console.warn('[Sidebar] Boot failed:', err);
    } finally {
      // Ensure the editor never stays blank if no file/project was found
      if (!hasLoadedText) injectStarterText();

      /* Scratchpad crash recovery — deliberately after the normal session
         restore (including the per-file crash-recovery dialog), so the two
         prompts can only appear in sequence, never stacked. Must never
         block boot. */
      try {
        await recoverScratchpadBackups();
      } catch (e) {
        console.warn('[Sidebar Boot] Scratchpad recovery scan failed (non-fatal):', e);
      }
    }
  })();
}

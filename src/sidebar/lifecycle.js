/* lifecycle.js — unified close-time handler and the boot sequence
   (session restore, crash recovery, scratchpad recovery). */
import { S, docTitleEl, folderNameEl, expandedDirs,
         SCRATCHPAD_PREFIX } from './state.js';
import { saveActiveFile, markClean, markDirty, scheduleAutoSave, cancelPendingAutoSave,
         rememberDiskContent, retargetActiveFile, noteBackupBase, diskFingerprint } from './save.js';
import { isTextFingerprint } from './fingerprint.js';
import { normalizeEol } from './eol.js';
import { renderTree, highlightActiveFile } from './tree.js';
import { updateViewBtn, restoreCardViewDir } from './cards.js';
import { openSidebar } from './panel.js';
import { startWatchingFile } from './watcher.js';
import { openFile } from './fileops.js';
import { uniquePath, reportBakOrphans, fileExistsViaListing, saveTextBesideNote } from './helpers.js';
import { loadProjects, recordProjectOpen, seedProjectsCache, PROJECTS_KEY } from './projects.js';
import { joinPath, baseNameOf, parentPathOf } from './paths.js';

/* ── One close at a time ──────────────────────────────────────────────
   Every close — the title-bar button, Alt+F4, the OS — reaches this as the
   backend's close request, whose watchdog covers a page that cannot answer
   at all. A page that answers but whose save never ends (a network drive
   that stopped responding) used to leave the frameless window with no way
   out: every further close started another close flow, queued behind the
   same stuck save. Now a further close is ignored until the save has run
   for CLOSE_STUCK_MS, and after that it is reported as a failed close — the
   backend then asks whether to close anyway (default: keep the window).
   Time the flow spends asking the user (discard?) never counts. */
const CLOSE_STUCK_MS = 5000;
let _closing = null; // { savingSince } while a close request is handled

async function sidebarHandleClose() {
  if (_closing) {
    const saving = _closing.savingSince ? Date.now() - _closing.savingSince : 0;
    if (saving >= CLOSE_STUCK_MS) {
      throw new Error(`Still saving the open note before closing (for ${Math.round(saving / 1000)} s).`);
    }
    return;
  }
  const closing = _closing = { savingSince: 0 };
  /* Disk work the close waits for. After a second a status line says so,
     and how to get out if it never ends. */
  const whileSaving = async (work) => {
    closing.savingSince = Date.now();
    const notice = setTimeout(() => {
      if (typeof window.showStatusWarning === 'function') {
        window.showStatusWarning('closing',
          window.t('Saving the open note before closing… If this takes too long, close again.'),
          { priority: 90 });
      }
    }, 1000);
    try {
      return await work();
    } finally {
      clearTimeout(notice);
      closing.savingSince = 0;
      if (typeof window.clearStatusWarning === 'function') window.clearStatusWarning('closing');
    }
  };
  try {
    await handleCloseRequest(whileSaving);
  } finally {
    _closing = null;
  }
}

async function handleCloseRequest(whileSaving) {
  cancelPendingAutoSave();

// Case 1: A real file is open on disk
  if (S.activeFilePath) {
    if (S.isDirty) {
      let saved = false;
      let outcome = null;
      for (let attempt = 0; attempt < 3 && S.isDirty; attempt++) {
        try {
          saved = await whileSaving(() => saveActiveFile({ onOutcome: (o) => { outcome = o; } }));
        } catch (err) {

          console.error('[sidebarHandleClose] Save threw unexpectedly:', err);
          saved = false;
        }
        if (!saved) break; // real failure or deferred save → discard dialog below
      }

      if (!saved) {
        /* The text is not on disk and a question is coming. Keep a crash
           backup of it FIRST: when the OS is logging out or shutting down
           (SIGTERM starts this close), nobody answers, and the app is
           ended while the question waits — the backup is then all there
           is, offered at the next start. */
        if (S.isDirty && typeof window.NativeAPI.writeVolatileNow === 'function') {
          try { await whileSaving(() => window.NativeAPI.writeVolatileNow(S.activeFilePath, editor.value, noteBackupBase())); } catch (_) {}
        }
        /* The save stopped because the file on disk is no longer what we
           last read or wrote (another program changed it): the "File
           Changed Externally" question is on its way and is the user's
           path. Keep the window open rather than stacking a "discard?"
           dialog on top of it; closing again afterwards works as usual. */
        if (outcome === 'deferred-verify') return;
        // saveActiveFile has already shown its own "Save Failed" dialog with
        // the OS error detail. Now confirm whether to discard or cancel
        // the close — never proceed silently.
        const baseName = baseNameOf(S.activeFilePath || '') || 'this note';
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
      try { await whileSaving(() => window.NativeAPI.writeVolatileNow(S.activeFilePath, editor.value, noteBackupBase())); } catch (_) {}
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

  /* "Save as a copy": the crash backup becomes a separate note beside the
     one it belongs to ("<name>_recovered", helpers.saveTextBesideNote); the
     saved note stays exactly as it is. The backup is deleted only once the
     copy is on disk — if that fails it stays, and the user is told. → the
     copy's path, or null on failure. */
  async function saveBackupBesideNote(notePath, content) {
    let copyPath;
    try {
      copyPath = await saveTextBesideNote(notePath, content, '_recovered');
    } catch (err) {
      console.error('[Sidebar Boot] Saving the crash backup as a separate file failed:', err);
      await window.NativeAPI.showMessageBox({
        type:    'error',
        title:   window.t('Recovery Failed'),
        message: 'The unsaved changes could not be saved as a separate file.',
        detail:  String(err) + '\n\nThe backup was kept. Revery offers it again at the next start, as long as this is still the last note you had open.',
        buttons: ['OK'],
        defaultId: 0,
      }).catch(() => {});
      return null;
    }
    /* The text is safely in its own file from here on. */
    await window.NativeAPI.deleteVolatileContent(notePath).catch(() => {});
    try {
      expandedDirs.add(parentPathOf(copyPath));
      await renderTree();
      if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
      if (typeof window.showStatusWarning === 'function') {
        window.showStatusWarning('recovered-copy',
          window.t('The unsaved changes were saved as "{name}".').replace('{name}', baseNameOf(copyPath)),
          { priority: 30, ttl: 8000 });
      }
    } catch (e) {
      console.warn('[Sidebar Boot] refreshing the tree after recovery failed (the copy is saved):', e);
    }
    return copyPath;
  }

  /* The last note could not be opened (deleted or moved by another
     program, no longer UTF-8, too large, locked). Its crash backup may now
     be the ONLY copy of that text. The start used to show the welcome
     text, forget the note and never mention the backup — which then
     expired in the 7-day purge (on Linux: at the next reboot, with the
     temp folder).
     → 'opened'  the text was saved as a new note, which is now open;
       'kept'    the backup stays (the dialog or the copy failed) — keep
                 the last-note pointer so the next start asks again;
       'none'    nothing to recover, or the user discarded it.
     Never throws. */
  async function offerBackupOfUnreadableNote(notePath, readErr) {
    let backup = null;
    try { backup = await window.NativeAPI.getVolatileContent(notePath); } catch (_) { return 'none'; }
    if (!backup || typeof backup.content !== 'string' || !backup.content.trim()) return 'none';

    const reason = String((readErr && readErr.message) || readErr || '')
      .replace(/^Error invoking remote method '[^']*': /, '')
      .replace(/^Error: /, '');
    let choice;
    try {
      choice = await window.NativeAPI.showMessageBox({
        type:    'warning',
        title:   'Recover unsaved changes?',
        message: `"${baseNameOf(notePath)}" could not be opened, but unsaved changes to it from a previous session were found.`,
        detail:  `${reason}\n\nLast edited: ${new Date(backup.ts || Date.now()).toLocaleString()}\n\n` +
                 '“Save as a new file” writes them into a new note in this project — nothing is overwritten. “Discard” deletes them permanently.',
        buttons:   ['Save as a new file', 'Discard'],
        defaultId: 0,
        cancelId:  0, // Escape keeps the text — never destructive
      });
    } catch (e) {
      console.warn('[Sidebar Boot] Recovery dialog failed (backup kept):', e);
      return 'kept';
    }
    if (choice && choice.response === 1) {
      await window.NativeAPI.deleteVolatileContent(notePath).catch(() => {});
      return 'none';
    }
    const copyPath = await saveBackupBesideNote(notePath, backup.content);
    if (!copyPath) return 'kept';
    try {
      await openFile(copyPath);
    } catch (e) {
      console.warn('[Sidebar Boot] opening the recovered note failed (it is saved):', e);
    }
    /* Whatever is open now must not get the welcome text over it: the boot
       inserts that only when nothing was loaded ('none'). */
    return S.activeFilePath ? 'opened' : 'none';
  }

  /* The last project folder could not be opened at start (a USB stick or
     network drive that is not connected, a folder moved or renamed). This
     used to be silent: the welcome text, no project, and everything typed
     afterwards had no backup. Now the user is told; what they type is kept
     (save.js, no-project backup). Never throws. */
  async function tellProjectUnavailable(folder, err) {
    const reason = String((err && err.message) || err || '')
      .replace(/^Error invoking remote method '[^']*': /, '')
      .replace(/^Error: /, '');
    try {
      await window.NativeAPI.showMessageBox({
        type:    'warning',
        title:   window.t('Could Not Open Project'),
        message: window.t('"{name}" could not be opened. It may be on a drive that is not connected, or it was moved or renamed.')
          .replace('{name}', baseNameOf(folder) || folder),
        detail:  reason + '\n\n' + window.t('Nothing in it was changed. When it is available again, restart Revery to continue where you left off, or open a folder from the file panel. Text you type now is kept as a backup and becomes a note in the next folder you open.'),
        buttons: [window.t('OK')],
        defaultId: 0,
      });
    } catch (e) {
      console.warn('[Sidebar Boot] could not show the missing-project message:', e);
    }
  }

export function runBoot() {
  (async function bootSidebar() {
    let hasLoadedText = false;
    let unavailableRoot = null; // { folder, err } — the last project could not be opened

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
          /* The backend answers with the root's CANONICAL spelling (the
             one every folder listing uses); the renderer adopts it. */
          let canonicalRoot;
          try {
            canonicalRoot = await window.NativeAPI.setRootPath(folder);
          } catch (err) {
            unavailableRoot = { folder, err };
            throw err;
          }
          if (typeof canonicalRoot === 'string' && canonicalRoot) folder = canonicalRoot;
          S.rootPath        = folder;
          lastFile = await reconcilePendingRename(journal, lastFile);
          /* The last file in that same spelling. The stored spelling is
             still used below to OPEN it and to look up its crash backup
             (backups are keyed by the path they were written under); the
             switch to this spelling happens afterwards, through
             retargetActiveFile, which moves the backup along. */
          let canonicalLast = lastFile;
          if (lastFile) {
            try {
              const c = await window.NativeAPI.canonicalEntryPath(lastFile);
              if (typeof c === 'string' && c) canonicalLast = c;
            } catch (_) { /* outside the root or unresolvable: keep */ }
          }
          S.selectedDirPath = folder;
          const parts = folder.replace(/\\/g, '/').split('/');
          folderNameEl.textContent = parts[parts.length - 1] || folder;
          expandedDirs.clear();
          expandedDirs.add(folder);

          await recordProjectOpen(folder);

          if (canonicalLast && canonicalLast.replace(/\\/g, '/').startsWith(folder.replace(/\\/g, '/'))) {
            const relPath = canonicalLast.replace(/\\/g, '/').substring(folder.length).replace(/^\//, '');
            const relParts = relPath.split('/');
            relParts.pop(); 
            /* Built in the root's own spelling (joinPath), so the keys
               equal the tree's entry paths — '/'-joined keys never matched
               the backslash paths on Windows. */
            let currentPath = folder;
            for (const p of relParts) {
              currentPath = joinPath(currentPath, p);
              expandedDirs.add(currentPath);
            }
            S.selectedDirPath = currentPath;
          }
          /* The card view opens where it was when this project was last
             open — else at the last note's folder (selected just above).
             It used to open at the root every time (cards.js). */
          restoreCardViewDir(folder);
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
            let readFailed = false;
            try {
              let diskContent;
              try {
                diskContent = await window.NativeAPI.readFile(lastFile);
              } catch (readErr) {
                readFailed = true;
                throw readErr;
              }
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
                     the INTACT on-disk file within seconds. */
                  const backupLen = backup.content.length;
                  const diskLen   = diskContent.length;
                  const suspicious =
                    (backupLen === 0 && diskLen > 0) ||
                    (diskLen > 200 && backupLen < diskLen * 0.1);

                  /* ── Was the backup made on top of the file as it is now? ──
                     Every backup records the disk version its text was
                     edited from (save.js noteBackupBase). That version still
                     on disk → "Restore" only puts the unsaved edits back.
                     Another version → the file was changed after this text
                     was made (another program, a sync service, another
                     device — or "Keep my version"): restoring would REPLACE
                     that newer text, so keeping both is the default. The
                     timestamp check that decided this before was wrong
                     whenever a sync tool kept the other device's time: a
                     newer file looked older and Enter restored over it.
                     true | false | null (no base recorded: older backups). */
                  const based = isTextFingerprint(backup.base)
                    ? backup.base === diskFingerprint(diskContent)
                    : null;
                  const changed = !suspicious && based === false;

                  /* ── Staleness guard (backups without a base only) ──────
                     A backup OLDER than the file's last save means the disk
                     moved on after the backup was written — e.g. the user
                     accepted an external "Reload from disk", never edited
                     again, and a durable snapshot of the abandoned version
                     survived (those outlive reboots by design). A default
                     of "Restore" would replace the NEWER saved content on
                     a reflexive Enter.
                     mtime and backup.ts are both ms since epoch on both
                     platforms; either being unavailable (0) disables the
                     guard — when unsure, keep today's behavior.          */
                  let fileMtime = 0;
                  if (based === null) {
                    try {
                      const dirPath = lastFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
                      const entries = await window.NativeAPI.readDirectory(dirPath);
                      const norm = (p) => String(p).replace(/\\/g, '/');
                      const me = (entries || []).find((e) => norm(e.path) === norm(lastFile));
                      if (me && typeof me.mtime === 'number') fileMtime = me.mtime;
                    } catch (_) { /* stat failed — content-only heuristics below */ }
                  }
                  const stale = !suspicious && based === null
                    && fileMtime > 0 && backup.ts > 0 && backup.ts < fileMtime;

                  /* Every answer except an explicit "Discard" keeps the text.
                     Escape — and closing the dialog — SAVES THE BACKUP AS A
                     SEPARATE FILE: it used to mean Discard, and a reflexive
                     Escape at startup deleted the only copy of the unsaved
                     changes. A doubtful backup (incomplete, or older than the
                     file) recommends the copy too: keeping both can never
                     lose anything, while "Keep saved version" deleted it on
                     a guess. Only a blank backup has nothing worth keeping —
                     there the safe answer is the saved file. */
                  const blank = backup.content.trim().length === 0;
                  const KEEP_BOTH = '\n\nRecommended: \u201cSave backup as a copy\u201d \u2014 the saved file stays as it is and the backup becomes a separate file next to it, so nothing is lost.';
                  let dialog;
                  if (blank) {
                    dialog = {
                      type:    'warning',
                      message: 'A crash backup was found, but it is empty.',
                      detail:  `Last edited: ${ts}\n\nRestoring it would REPLACE your saved file with empty text.\n\nRecommended: keep the saved version.`,
                      choices: [['restore', 'Restore empty backup'], ['discard', 'Keep saved version']],
                      defaultAction: 'discard', cancelAction: 'discard',
                    };
                  } else if (suspicious) {
                    dialog = {
                      type:    'warning',
                      message: 'A crash backup was found, but it looks incomplete.',
                      detail:  `Last edited: ${ts}\n\nThe backup is much shorter than the saved file (${backupLen} vs ${diskLen} characters) \u2014 the crash may have damaged it. Restoring it would REPLACE your saved file with this content.` + KEEP_BOTH,
                      choices: [['restore', 'Restore incomplete backup'], ['copy', 'Save backup as a copy'], ['discard', 'Discard backup']],
                      defaultAction: 'copy', cancelAction: 'copy',
                    };
                  } else if (changed) {
                    dialog = {
                      type:    'warning',
                      message: 'Unsaved text from a previous session was found, but the file has changed since.',
                      detail:  `Last edited: ${ts}\n\nThe file on disk is no longer the version this text was based on — another program, a sync service or another device changed it afterwards (or you chose “Keep my version”). Restoring would REPLACE that newer version with this text.` + KEEP_BOTH,
                      choices: [['restore', 'Restore backup'], ['copy', 'Save backup as a copy'], ['discard', 'Discard backup']],
                      defaultAction: 'copy', cancelAction: 'copy',
                    };
                  } else if (stale) {
                    dialog = {
                      type:    'warning',
                      message: 'A crash backup was found, but the file has been saved more recently.',
                      detail:  `Backup from: ${ts}\nFile last saved: ${new Date(fileMtime).toLocaleString()}\n\nThe saved file is NEWER than this backup \u2014 restoring would replace the newer saved content with this older backup.` + KEEP_BOTH,
                      choices: [['restore', 'Restore older backup'], ['copy', 'Save backup as a copy'], ['discard', 'Discard backup']],
                      defaultAction: 'copy', cancelAction: 'copy',
                    };
                  } else {
                    dialog = {
                      type:    'question',
                      message: 'Unsaved changes from a previous session were found.',
                      detail:  `Last edited: ${ts}\n\n\u201cRestore\u201d puts them back into the editor. \u201cSave as a copy\u201d keeps the saved note as it is and writes the unsaved changes into a separate file next to it. \u201cDiscard\u201d deletes them permanently.`,
                      choices: [['restore', 'Restore'], ['copy', 'Save as a copy'], ['discard', 'Discard']],
                      defaultAction: 'restore', cancelAction: 'copy',
                    };
                  }
                  const actions = dialog.choices.map((c) => c[0]);
                  const choice = await window.NativeAPI.showMessageBox({
                    title:     'Recover unsaved changes?',
                    type:      dialog.type,
                    message:   dialog.message,
                    detail:    dialog.detail,
                    buttons:   dialog.choices.map((c) => c[1]),
                    defaultId: actions.indexOf(dialog.defaultAction),
                    cancelId:  actions.indexOf(dialog.cancelAction),
                  });
                  const action = actions[choice && choice.response] || dialog.cancelAction;

                  if (action === 'restore') {
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
                    // Immediately create a fresh volatile backup of the restored
                    // content — based on the file as it is now (rememberDiskContent above)
                    if (typeof window.NativeAPI.writeVolatileNow === 'function') {
                      await window.NativeAPI.writeVolatileNow(lastFile, backup.content, noteBackupBase()).catch(e =>
                        console.warn('[Sidebar] Refreshing backup after restore failed:', e)
                      );
                    }
                  } else if (action === 'copy') {
                    await saveBackupBesideNote(lastFile, backup.content);
                  } else {
                    // An explicit Discard (or a blank backup): delete it.
                    await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {});
                  }
                } else if (backup) {
                  // Backup identical to disk – clean it up
                  await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {});
                }
              } catch (e) {
                console.warn('[Sidebar Boot] Crash-recovery check failed (non-fatal):', e);
              }

              /* Recovery used the STORED spelling (its backup key). Now
                 adopt the canonical one through the single retarget,
                 which moves an unsaved buffer's backup, the watcher and
                 the last-opened pointer along. Same file — only the
                 spelling changes, so the file operations recognise it. */
              if (canonicalLast && canonicalLast !== lastFile && S.activeFilePath === lastFile) {
                await retargetActiveFile(lastFile, canonicalLast);
                highlightActiveFile(S.activeFilePath);
              }

            } catch (err) {
              console.warn('[Sidebar Boot] Could not read last file:', err);
              /* Only a failed READ means the note itself is unavailable; its
                 crash backup may then be the only copy of the text. */
              const recovered = readFailed ? await offerBackupOfUnreadableNote(lastFile, err) : 'none';
              if (recovered === 'opened') {
                hasLoadedText = true; // the recovered note is open: no welcome text over it
              } else {
                injectStarterText();
                /* 'kept': the backup is still there — keep the pointer, so the
                   next start asks again (and the 7-day purge spares it). */
                if (recovered !== 'kept') {
                  try { await window.NativeAPI.clearLastOpenedFile(); } catch { /* ignore */ }
                }
              }
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
        const canonicalDefault = await window.NativeAPI.setRootPath(defaultFolder);
        if (typeof canonicalDefault === 'string' && canonicalDefault) defaultFolder = canonicalDefault;
        S.rootPath        = defaultFolder;
        try { localStorage.setItem('revery_root_path', S.rootPath); } catch (e) {}
        recordProjectOpen(defaultFolder);
        S.selectedDirPath = defaultFolder;
        restoreCardViewDir(defaultFolder);
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
      if (unavailableRoot) {
        injectStarterText(); // behind the message, not a blank editor
        await tellProjectUnavailable(unavailableRoot.folder, unavailableRoot.err);
      }
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

/* fileops.js — open/create/rename/delete/move operations, folder
   switching, the undo stack, and multi-select bulk operations. */
import { S, treeEl, docTitleEl, folderNameEl, btnOpenFolder, btnNewFile, btnNewFolder,
         expandedDirs, selectedItems, _previewCache } from './state.js';
import { showInputDialog } from './dialogs.js';
import { getFileCategory, mediaMarkdown, uniquePath, uniqueDestPath } from './helpers.js';
import { saveActiveFile, markClean, scheduleAutoSave } from './save.js';
import { renderTree, updateMultiSelectHighlight, updateSelectedDirHighlight, highlightActiveFile } from './tree.js';
import { openSidebar, switchFromMobileSidebar } from './panel.js';
import { startWatchingFile } from './watcher.js';
import { recordProjectOpen } from './projects.js';

  /* ── Undo stack (moves + renames only — deletes are irreversible) ── */
  const MAX_UNDO  = 30;
  const undoStack = []; // [{type:'move'|'rename', records:[{oldPath,newPath}]}]

  /* ══════════════════════════════════════════════════════════════════
     UNDO STACK
  ══════════════════════════════════════════════════════════════════ */

  function pushUndo(op) {
    undoStack.push(op);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  /**
   * Reverse the most recent move or rename operation.
   * Works by calling renameNode in reverse order for each record.
   * Only fires when the editor textarea does NOT have focus, so it
   * never conflicts with the editor's own text-undo (Ctrl+Z).
   */
  async function undoLastOperation() {
    if (S._operationLock || undoStack.length === 0) return;
    S._operationLock = true;
    try {
      const op = undoStack.pop();
      const errors = [];

      /* Reverse in reverse order so a multi-rename undoes cleanly */
      for (const { oldPath, newPath } of [...op.records].reverse()) {
        try {
          await window.NativeAPI.renameNode(newPath, oldPath);

          /* Keep internal state in sync */
          if (S.activeFilePath) {
            const normalNew    = newPath.replace(/\\/g, '/');
            const normalOld    = oldPath.replace(/\\/g, '/');
            const normalActive = S.activeFilePath.replace(/\\/g, '/');
            if (normalActive === normalNew) {
              S.activeFilePath = oldPath;
              await window.NativeAPI.setLastOpenedFile(oldPath);
              startWatchingFile(oldPath);
              if (docTitleEl) {
                docTitleEl.value = oldPath.replace(/\\/g, '/').split('/').pop()
                                         .replace(/\.(md|txt)$/, '');
              }
            } else if (normalActive.startsWith(normalNew + '/')) {
              const rel = normalActive.substring(normalNew.length);
              S.activeFilePath = normalOld + rel;
              await window.NativeAPI.setLastOpenedFile(S.activeFilePath);
              startWatchingFile(S.activeFilePath);
            }
          }
          if (S.selectedDirPath && S.selectedDirPath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')) {
            S.selectedDirPath = oldPath;
          }
        } catch (err) {
          errors.push(`${newPath.replace(/\\/g, '/').split('/').pop()}: ${err.message}`);
        }
      }

      selectedItems.clear(); S.selectionAnchor = null;
      await renderTree();

      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: 'Undo Failed Partially',
          message: `${errors.length} item(s) could not be moved back:`,
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /**
   * Safely move an array of {path, type} items into targetDir.
   *
   * Safety guarantees:
   *  1. Saves the active file first (no dirty data loss).
   *  2. Skips moves that would place a folder inside itself or a descendant.
   *  3. Skips no-ops (item already in targetDir).
   *  4. Skips attempting to move S.rootPath.
   *  5. Deduplicates destination names to avoid clobbering existing files.
   *  6. Updates S.activeFilePath / S.selectedDirPath if they live inside a moved item.
   *  7. S._operationLock prevents concurrent FS mutations.
   */
  async function moveNodes(items, targetDir) {
    if (S._operationLock || !items.length || !targetDir) return;
    S._operationLock = true;
    try {
      if (S.isDirty && S.activeFilePath) {
        const saved = await saveActiveFile();
        if (!saved) return; // Save failed — abort move to protect data
      }

      const normalTarget = targetDir.replace(/\\/g, '/');
      const normalRoot   = (S.rootPath || '').replace(/\\/g, '/');
      const errors       = [];
      const movedRecords = []; // for undo

      for (const { path: srcPath, type } of items) {
        const normalSrc    = srcPath.replace(/\\/g, '/');
        const srcParentNorm = normalSrc.substring(0, normalSrc.lastIndexOf('/'));

        /* ── Guards ── */
        if (normalSrc === normalRoot)  continue; // never move root
        if (normalTarget === normalSrc || normalTarget.startsWith(normalSrc + '/')) continue; // circular
        if (srcParentNorm === normalTarget) continue; // already in target (no-op)

        const name     = normalSrc.split('/').pop();
        const destPath = await uniqueDestPath(targetDir, name, type);

        try {
          await window.NativeAPI.renameNode(srcPath, destPath);
          movedRecords.push({ oldPath: srcPath, newPath: destPath }); // record for undo
        } catch (err) {
          errors.push(`${name}: ${err.message}`);
          continue;
        }

        /* ── Update internal state if the active file was moved ── */
        if (S.activeFilePath) {
          const normalActive = S.activeFilePath.replace(/\\/g, '/');
          if (normalActive === normalSrc) {
            S.activeFilePath = destPath;
            await window.NativeAPI.setLastOpenedFile(destPath);
            startWatchingFile(destPath);
            if (docTitleEl) {
              const base = destPath.replace(/\\/g, '/').split('/').pop();
              docTitleEl.value = base.replace(/\.(md|txt)$/, '');
            }
          } else if (normalActive.startsWith(normalSrc + '/')) {
            /* Active file is inside a moved folder */
            const rel = normalActive.substring(normalSrc.length);
            S.activeFilePath = destPath.replace(/\\/g, '/') + rel;
            await window.NativeAPI.setLastOpenedFile(S.activeFilePath);
            startWatchingFile(S.activeFilePath);
          }
        }

        /* ── Update S.selectedDirPath if it was inside the moved item ── */
        if (S.selectedDirPath) {
          const normalSel = S.selectedDirPath.replace(/\\/g, '/');
          if (normalSel === normalSrc || normalSel.startsWith(normalSrc + '/')) {
            S.selectedDirPath = targetDir;
          }
        }

        expandedDirs.add(targetDir); // Expand destination so moved items are visible
      }

      selectedItems.clear();
      S.selectionAnchor = null;
      if (movedRecords.length) pushUndo({ type: 'move', records: movedRecords });
      await renderTree();

      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: 'Move Issues',
          message: `${errors.length} item(s) could not be moved:`,
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     MULTI-SELECT OPERATIONS  (rename / delete)
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Rename all selected items.
   * Single item → delegates to the normal renameNode dialog (unchanged UX).
   * Multiple items → asks for one base name, assigns it with _2, _3 … suffixes
   *   to avoid filesystem collisions.
   */
  async function renameSelectedNodes() {
    if (S._operationLock || selectedItems.size === 0) return;

    if (selectedItems.size === 1) {
      /* Single-item path: delegate to the existing per-item rename */
      const p  = [...selectedItems][0];
      const el = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"]`);
      await renameNode(p, el ? el.dataset.type : 'file');
      selectedItems.clear(); S.selectionAnchor = null;
      return;
    }

    S._operationLock = true;
    try {
      const paths     = [...selectedItems];
      const firstName = paths[0].replace(/\\/g, '/').split('/').pop();
      const defaultBase = firstName.replace(/\.(md|txt)$/, '');

      const baseName = await showInputDialog(
        `Rename ${paths.length} items — enter a base name\n` +
        '(items will be named: name, name_2, name_3 …):',
        defaultBase
      );
      if (!baseName) return;

      const safeBase = baseName.trim().replace(/[/\\?%*:|"<>]/g, '_');
      if (!safeBase) return;

      const renamedRecords = [];
      for (let i = 0; i < paths.length; i++) {
        const srcPath = paths[i];
        const parts   = srcPath.replace(/\\/g, '/').split('/');
        const oldName = parts[parts.length - 1];
        const el      = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(srcPath)}"]`);
        const type    = el ? el.dataset.type : (oldName.lastIndexOf('.') > 0 ? 'file' : 'dir');

        const lastDot = oldName.lastIndexOf('.');
        const hasExt  = (type === 'file') && (lastDot > 0);
        const oldExt  = hasExt ? oldName.substring(lastDot) : '';
        const newName = i === 0 ? `${safeBase}${oldExt}` : `${safeBase}_${i + 1}${oldExt}`;

        if (newName === oldName) continue;

        parts[parts.length - 1] = newName;
        const newPath = parts.join('/');

        try {
          await window.NativeAPI.renameNode(srcPath, newPath);
          renamedRecords.push({ oldPath: srcPath, newPath });
          
          /* ── Update active file if it was the renamed item OR inside it ── */
          if (S.activeFilePath) {
            const normalActive = S.activeFilePath.replace(/\\/g, '/');
            const normalSrc    = srcPath.replace(/\\/g, '/');
            const normalNew    = newPath.replace(/\\/g, '/');

            if (normalActive === normalSrc) {
              S.activeFilePath = newPath;
              markClean();
              await window.NativeAPI.setLastOpenedFile(newPath);
              if (docTitleEl) docTitleEl.value = newName.replace(/\.(md|txt)$/, '');
              startWatchingFile(newPath);
            } else if (normalActive.startsWith(normalSrc + '/')) {
              const rel = normalActive.substring(normalSrc.length);
              S.activeFilePath = normalNew + rel;
              await window.NativeAPI.setLastOpenedFile(S.activeFilePath);
              startWatchingFile(S.activeFilePath);
            }
          }

          /* ── Update selected target dir if it was inside the renamed item ── */
          if (S.selectedDirPath) {
            const normalSel = S.selectedDirPath.replace(/\\/g, '/');
            const normalSrc = srcPath.replace(/\\/g, '/');
            const normalNew = newPath.replace(/\\/g, '/');
            
            if (normalSel === normalSrc) {
              S.selectedDirPath = newPath;
            } else if (normalSel.startsWith(normalSrc + '/')) {
              const rel = normalSel.substring(normalSrc.length);
              S.selectedDirPath = normalNew + rel;
            }
          }
        } catch (err) {
          console.error('[Sidebar] multi-rename failed:', srcPath, err);
        }
      }

      selectedItems.clear(); S.selectionAnchor = null;
      if (renamedRecords.length) pushUndo({ type: 'rename', records: renamedRecords });
      await renderTree();
    } finally {
      S._operationLock = false;
    }
  }

  /** Delete all selected items with a single confirmation dialog. */
  async function deleteSelectedNodes() {
    if (S._operationLock || selectedItems.size === 0) return;
    S._operationLock = true;
    try {
      const paths = [...selectedItems];
      const n     = paths.length;

      const result = await window.NativeAPI.showMessageBox({
        type: 'question',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        title:  `Delete ${n} Item${n > 1 ? 's' : ''}`,
        message: `Permanently delete ${n} item${n > 1 ? 's' : ''}?`,
        detail: 'This cannot be undone.',
      });
      if (result.response !== 0) return;

      for (const p of paths) {
        try {
          await window.NativeAPI.deleteNode(p);

          /* Same descendant-aware logic as the single-item deleteNode below.
            Loop ordering is irrelevant: if both a directory and one of its
            descendants are in `paths`, whichever is processed first clears
            S.activeFilePath; the other iteration then finds it already null
            and the block is a no-op. */
          const normalNode = p.replace(/\\/g, '/');

          if (S.activeFilePath) {
            const normalActive = S.activeFilePath.replace(/\\/g, '/');
            if (normalActive === normalNode || normalActive.startsWith(normalNode + '/')) {
              S.activeFilePath = null;
              markClean();
              await window.NativeAPI.clearLastOpenedFile();
              /* Same rationale as deleteNode: avoid retriggering scratchpad auto-create. */
              if (typeof window.replaceEditorContent === 'function') {
                window.replaceEditorContent('');
              } else {
                editor.value = '';
                if (typeof render     === 'function') render();
                if (typeof countWords === 'function') countWords();
              }
            }
          }

          if (S.selectedDirPath) {
            const normalSel = S.selectedDirPath.replace(/\\/g, '/');
            if (normalSel === normalNode || normalSel.startsWith(normalNode + '/')) {
              S.selectedDirPath = S.rootPath;
            }
          }
        } catch (err) {
          console.error('[Sidebar] multi-delete failed:', p, err);
        }
      }

      selectedItems.clear(); S.selectionAnchor = null;
      await renderTree();
    } finally {
      S._operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     OPEN MEDIA FILE  (image/video — show preview, no text load)
  ══════════════════════════════════════════════════════════════════ */

  async function openMediaFile(filePath) {
    /* Save any dirty text file before switching away */
    if (S.isDirty && S.activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return;
    }

    /* Clear any previous state */
    S.activeFilePath                 = null;
    S._mediaPreviewMode              = null;
    window._showingUnsupportedFile = false;

    /* The media file's own directory is the natural base for the relative
       path reference.  When the user types and auto-creates a .md file it
       goes into this same directory, keeping the reference correct.       */
    const mediaDir   = filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const pendingDir = mediaDir || S.selectedDirPath || S.rootPath;

    S._mediaPreviewMode = {
      mediaPath:    filePath,
      pendingMdDir: pendingDir,
      fileCreated:  false,
    };

    /* Build markdown relative to pendingDir so the path is correct when
       the auto-created .md is saved there.                               */
    const mdText = mediaMarkdown(filePath, pendingDir);

    /* Use replaceEditorContent (via setState) rather than performTextChange
       (via dispatch) so that:
         1. The CM history is wiped — Ctrl+Z won't undo back into whatever
            file was open before.
         2. The updateListener is NOT fired, so _inputListeners are skipped
            and the media auto-create handler doesn't trigger on our own
            programmatic content change.                                   */
    if (typeof window.replaceEditorContent === 'function') {
      window.replaceEditorContent(mdText);
    } else {
      editor.value = mdText;
      if (typeof render === 'function') render();
    }

    /* Update doc-title */
    if (docTitleEl) {
      const base = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.[^/.]+$/, '');
      docTitleEl.value = base;
    }

    /* Highlight the media item in the tree */
    treeEl.querySelectorAll('.sidebar-media-active').forEach(el => el.classList.remove('sidebar-media-active'));
    const mediaEl = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(filePath)}"]`);
    if (mediaEl) mediaEl.classList.add('sidebar-media-active');

    markClean();
    switchFromMobileSidebar();
  }


  /* ══════════════════════════════════════════════════════════════════
     OPEN UNSUPPORTED FILE  (show placeholder, don't load content)
  ══════════════════════════════════════════════════════════════════ */

  async function openUnsupportedFile(filePath) {
    if (S.isDirty && S.activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return;
    }

    S.activeFilePath                 = null;
    S._mediaPreviewMode              = null;
    window._showingUnsupportedFile = true;
    switchFromMobileSidebar();

    /* Clear editor with a fresh history. replaceEditorContent uses setState,
       which does NOT fire updateListener, so no input side-effects occur.  */
    if (typeof window.replaceEditorContent === 'function') {
      window.replaceEditorContent('');
    } else {
      editor.value = '';
    }

    if (docTitleEl) {
      docTitleEl.value = filePath.replace(/\\/g, '/').split('/').pop();
    }

    /* replaceEditorContent already called render() and countWords() with
       _showingUnsupportedFile=true, so the unsupported-file message is shown.
       Only call them again if we fell back to the else branch above.     */
    if (typeof window.replaceEditorContent !== 'function') {
      if (typeof render === 'function') render();
      if (typeof countWords === 'function') countWords();
    }
    markClean();
  }


  /* ══════════════════════════════════════════════════════════════════
     OPEN FILE
  ══════════════════════════════════════════════════════════════════ */

  async function openFile(filePath) {
    /* Clear any special viewing modes */
    S._mediaPreviewMode              = null;
    window._showingUnsupportedFile = false;

    /* Auto-save current file first — no modal, no friction */
    if (S.isDirty && S.activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return; /* save failed; don't abandon current file */
    }

    let content;
    try {
      content = await window.NativeAPI.readFile(filePath);
    } catch (err) {
      await window.NativeAPI.showMessageBox({
        type: 'error', title: 'Open Failed',
        message: `Could not read:\n${filePath}`,
        detail: String(err)
      });
      return;
    }

    /* Load into editor with a fresh history so Ctrl+Z in this file
       can never undo back to content from any previously opened file. */
    if (typeof window.replaceEditorContent === 'function') {
      window.replaceEditorContent(content);
    } else {
      editor.value = content;
      if (typeof render     === 'function') render();
      if (typeof countWords === 'function') countWords();
    }

    S.activeFilePath = filePath;
    markClean();
    await window.NativeAPI.setLastOpenedFile(filePath);

    /* Update doc-title */
    if (docTitleEl) {
      const base = filePath.replace(/\\/g, '/').split('/').pop();
      docTitleEl.value = base.replace(/\.(md|txt)$/, '');
    }

    /* Re-run image fixup now that S.activeFilePath is current.
      render() fired above (via replaceEditorContent) before this assignment,
      so postProcessImages() had a stale base directory on that first pass. */
    if (typeof postProcessImages === 'function') postProcessImages();

    highlightActiveFile(filePath);
    switchFromMobileSidebar();
    startWatchingFile(filePath);
  }

  /**
   * Creates a new empty .md file in targetDir, then opens it.
   * Called by the "+" toolbar button AND by actions.js newFile().
   */
  // AFTER
async function createNewFile(targetDir) {
    /* Auto-save current before switching */
    if (S.isDirty && S.activeFilePath) await saveActiveFile();

    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) {
      await window.NativeAPI.showMessageBox({
        type: 'info', title: 'No Folder Open',
        message: 'Please open a project folder first.'
      });
      return;
    }

    // Retry loop handles the TOCTOU race between uniquePath() and createFile().
    // If another process creates the candidate filename in the gap, the Rust
    // backend returns "File already exists". We re-read the directory and try
    // a fresh unique name rather than surfacing a confusing error to the user.
    // All other errors (permissions, disk full, etc.) still abort immediately.
    const MAX_CREATE_RETRIES = 5;
    let newPath = null;
    let created = false;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      newPath = await uniquePath(dir, 'untitled', 'md');
      try {
        await window.NativeAPI.createFile(newPath);
        created = true;
        break;
      } catch (err) {
        const isCollision = String(err).includes('already exists');
        if (isCollision && attempt < MAX_CREATE_RETRIES - 1) {
          continue; // re-read directory and try again with a fresh name
        }
        console.error('[Sidebar] createFile failed:', err);
        await window.NativeAPI.showMessageBox({
          type: 'error', title: 'Could Not Create File',
          message: 'The file could not be created.',
          detail: String(err),
        });
        return;
      }
    }
    if (!created) return; // safety net — all retries exhausted

    expandedDirs.add(dir);
    await renderTree();
    await openFile(newPath);

    if (docTitleEl) {
      docTitleEl.select();
      docTitleEl.focus();
    }
  }

  async function createNewFolder(targetDir) {
    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) return;

    const name = await showInputDialog('New folder name:');
    if (!name || !name.trim()) return;

    const safeName = name.trim().replace(/[/\\?%*:|"<>]/g, '_');
    const sep      = (dir.endsWith('/') || dir.endsWith('\\')) ? '' : '/';
    const newPath  = `${dir}${sep}${safeName}`;

try {
      await window.NativeAPI.createDirectory(newPath);
      expandedDirs.add(dir);       // Expand parent so new folder is visible
      
      // Fix: Keep selection context on the parent folder so that subsequent
      // clicks to "New Folder" or "New File" create siblings, not nested items.
      S.selectedDirPath = dir;       
      
      await renderTree();
    } catch (err) {
      console.error('[Sidebar] createDirectory failed:', err);
      await window.NativeAPI.showMessageBox({
        type: 'error', title: 'Could Not Create Folder',
        message: `Could not create folder "${safeName}".`,
        detail: String(err),
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENAME / DELETE
  ══════════════════════════════════════════════════════════════════ */

// AFTER — only the first line and outer wrapper change; all inner logic is unchanged
async function renameNode(nodePath, type) {
    if (S._operationLock) return;
    S._operationLock = true;
    try {
      const parts   = nodePath.replace(/\\/g, '/').split('/');
      const oldName = parts[parts.length - 1];

      const newName = await showInputDialog(`Rename "${oldName}" to:`, oldName);
      if (!newName || newName.trim() === oldName) return;

      const safeName  = newName.trim().replace(/[/\\?%*:|"<>]/g, '_');
      const finalName = (type === 'file' && !safeName.includes('.'))
        ? safeName + oldName.substring(oldName.lastIndexOf('.'))
        : safeName;

      parts[parts.length - 1] = finalName;
      const newPath = parts.join('/');

      try {
        await window.NativeAPI.renameNode(nodePath, newPath);
        pushUndo({ type: 'rename', records: [{ oldPath: nodePath, newPath }] });

        if (S.activeFilePath) {
          const normalActive = S.activeFilePath.replace(/\\/g, '/');
          const normalOld    = nodePath.replace(/\\/g, '/');
          const normalNew    = newPath.replace(/\\/g, '/');

          if (normalActive === normalOld) {
            S.activeFilePath = newPath;
            markClean();
            await window.NativeAPI.setLastOpenedFile(newPath);
            if (docTitleEl) {
              docTitleEl.value = finalName.replace(/\.(md|txt)$/, '');
            }
            startWatchingFile(newPath);
          } else if (normalActive.startsWith(normalOld + '/')) {
            const rel = normalActive.substring(normalOld.length);
            S.activeFilePath = normalNew + rel;
            await window.NativeAPI.setLastOpenedFile(S.activeFilePath);
            startWatchingFile(S.activeFilePath);
          }
        }

        if (S.selectedDirPath) {
          const normalSel = S.selectedDirPath.replace(/\\/g, '/');
          const normalOld = nodePath.replace(/\\/g, '/');
          const normalNew = newPath.replace(/\\/g, '/');

          if (normalSel === normalOld) {
            S.selectedDirPath = newPath;
          } else if (normalSel.startsWith(normalOld + '/')) {
            const rel = normalSel.substring(normalOld.length);
            S.selectedDirPath = normalNew + rel;
          }
        }

        await renderTree();
      } catch (err) {
        console.error('[Sidebar] renameNode failed:', err);
      }
    } finally {
      S._operationLock = false;
    }
  }


async function deleteNode(nodePath, type) {
    if (S._operationLock) return;
    S._operationLock = true;
    try {
      const name = nodePath.replace(/\\/g, '/').split('/').pop();

      const result = await window.NativeAPI.showMessageBox({
        type: 'question',
        buttons: ['Move to Trash', 'Cancel'],
        defaultId: 1,
        title: `Delete ${type === 'dir' ? 'Folder' : 'File'}`,
        message: `Move "${name}" to Trash?`,
        detail: type === 'dir'
          ? 'The folder and all its contents will be moved to your system trash. You can restore them from there.'
          : 'The file will be moved to your system trash. You can restore it from there.',
      });



      if (result.response !== 0) return;

      try {
        await window.NativeAPI.deleteNode(nodePath);

        /* Detect whether the active file / selected dir is the deleted node
          itself OR a descendant of it. Pattern lifted verbatim from the
          rename + move handlers above (search for `startsWith(normalSrc + '/')`)
          so all three operations stay consistent. The trailing '/' on the
          prefix check prevents "/foo/bar2/x" from being treated as inside
          "/foo/bar". */
        const normalNode = nodePath.replace(/\\/g, '/');

        if (S.activeFilePath) {
          const normalActive = S.activeFilePath.replace(/\\/g, '/');
          if (normalActive === normalNode || normalActive.startsWith(normalNode + '/')) {
            S.activeFilePath = null;
            markClean();
            await window.NativeAPI.clearLastOpenedFile();
            if (typeof window.replaceEditorContent === 'function') {
              window.replaceEditorContent('');
            } else {
              editor.value = '';
              if (typeof render     === 'function') render();
              if (typeof countWords === 'function') countWords();
            }
          }
        }

        if (S.selectedDirPath) {
          const normalSel = S.selectedDirPath.replace(/\\/g, '/');
          if (normalSel === normalNode || normalSel.startsWith(normalNode + '/')) {
            S.selectedDirPath = S.rootPath;
          }
        }

        await renderTree();
      } catch (err) {
        console.error('[Sidebar] deleteNode failed:', err);
      }


    } finally {
      S._operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     OPEN FOLDER DIALOG
  ══════════════════════════════════════════════════════════════════ */

async function openFolder(folderPath) {
    S.rootPath = folderPath;
    // Tell the backend what the sandbox root is so all subsequent FS IPC
    // calls are validated against it. Must happen before renderTree().
    await window.NativeAPI.setRootPath(folderPath);
    try { localStorage.setItem('revery_root_path', S.rootPath); } catch (e) {}
    
// Also persist to native settings file (survives WebView storage clears)
    if (typeof window.NativeAPI.setLastRootPath === 'function') {
      await window.NativeAPI.setLastRootPath(S.rootPath).catch(() => {});
    }
    
    // CRITICAL: Add the folder to the recent projects array
    await recordProjectOpen(folderPath);

    S.selectedDirPath = folderPath;
    S.cardViewDir = folderPath;



    _previewCache.clear();
    const parts = folderPath.replace(/\\/g, '/').split('/');
    folderNameEl.textContent = parts[parts.length - 1] || folderPath;
    expandedDirs.clear();
    expandedDirs.add(folderPath);
    await renderTree();
    if (!S.sidebarOpen) openSidebar();
  }


async function promptOpenFolder() {

      /* Auto-save current file before switching folders */
      if (S.isDirty && S.activeFilePath) {
        const saved = await saveActiveFile();
        if (!saved) return; // FIX: Abort to prevent data loss
      }
    try {
      const path = await window.NativeAPI.openFolderDialog();
      if (!path) return;

      /* Clear the editor BEFORE setting the new root to prevent path-escape races */
      S.activeFilePath = null;
      await window.NativeAPI.clearLastOpenedFile();
      markClean();
      if (typeof window.replaceEditorContent === 'function') {
        window.replaceEditorContent('');
      } else {
        editor.value = '';
        if (typeof render === 'function') render();
      }
      if (typeof countWords === 'function') countWords();
      if (docTitleEl) docTitleEl.value = '';

      /* Switch to the chosen project */
      await openFolder(path);

    } catch (err) {
      console.error('[Sidebar] openFolderDialog failed:', err);
    }
  }

export { pushUndo, undoLastOperation, moveNodes, renameSelectedNodes,
         deleteSelectedNodes, openMediaFile, openUnsupportedFile, openFile,
         createNewFile, createNewFolder, renameNode, deleteNode,
         openFolder, promptOpenFolder };

export function initFileOps() {
  if (btnOpenFolder) btnOpenFolder.addEventListener('click', promptOpenFolder);

  /* Expose to the header buttons */
  if (btnNewFile)   btnNewFile.addEventListener('click',   () => createNewFile(S.selectedDirPath || S.rootPath));
  if (btnNewFolder) btnNewFolder.addEventListener('click', () => createNewFolder(S.selectedDirPath || S.rootPath));

  /* Expose to actions.js */
  window.sidebarCreateNewFile = () => createNewFile(S.selectedDirPath || S.rootPath);

  /**
   * Opens a file picker, then copies the chosen file into the active
   * folder (auto-incrementing the name if a clash exists), and opens it.
   * Auto-saves first so no work is lost.
   */
  window.sidebarImportFile = async function () {
    const dir = S.selectedDirPath || S.rootPath;
    if (!dir) {
      /* No folder open — fall back to the legacy in-browser import */
      if (typeof executeImport === 'function') executeImport();
      return;
    }


    /* Auto-save current file before switching folders */
    if (S.isDirty && S.activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return; // FIX: Abort to prevent data loss
    }

    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.md,.txt';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        alert('File is too large. Maximum is 20 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => alert('An error occurred while reading the file.');
      reader.onload = async (ev) => {
        const content  = ev.target.result;
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const ext      = file.name.endsWith('.txt') ? 'txt' : 'md';
        const destPath = await uniquePath(dir, baseName, ext);
        try {
          await window.NativeAPI.createFile(destPath);
          await window.NativeAPI.writeFile(destPath, content);
        } catch (err) {
          console.error('[Sidebar] import write failed:', err);
          return;
        }
        await renderTree();
        await openFile(destPath);
      };
      reader.readAsText(file);
    };
    input.click();
  };
}

/* fileops.js — open/create/rename/delete/move operations, folder
   switching, the undo stack, and multi-select bulk operations. */
import { S, treeEl, docTitleEl, folderNameEl, btnOpenFolder, btnNewFile, btnNewFolder,
         expandedDirs, selectedItems, _previewCache } from './state.js';
import { showInputDialog, showConfirmDialog, showFolderPickerDialog } from './dialogs.js';
import { getFileCategory, mediaMarkdown, uniquePath, uniqueDestPath } from './helpers.js';
import { saveActiveFile, markClean, scheduleAutoSave, cancelPendingAutoSave,
         retargetActiveFile, waitForSaveChainIdle, rememberDiskContent,
         _enqueueDiskOp, markActivePathGone, forgetGonePath,
         replaceOpenDocument, SWITCH_CANCELLED } from './save.js';
import { renderTree, updateMultiSelectHighlight, updateSelectedDirHighlight, highlightActiveFile } from './tree.js';
import { openSidebar, switchFromMobileSidebar } from './panel.js';
import { startWatchingFile, stopWatchingFile, watchedPath } from './watcher.js';
import { recordProjectOpen } from './projects.js';
import { rewriteLinksInText, buildAbsMapper, invertRecords } from './link_rewrite.js';
import { listProjectTextFiles, invalidateProjectScan } from './project_scan.js';
import { samePath, isInsideRoot, baseNameOf, dirOf, joinPath, parentPathOf, remapUnder,
         sanitizeEntryName, checkEntryName, renamedFileName } from './paths.js';
import { decodeImportedText } from './import_text.js';

  /* ══════════════════════════════════════════════════════════════════
     SHARED PIECES OF EVERY FILE OPERATION
  ══════════════════════════════════════════════════════════════════ */

  /* Backend errors arrive wrapped ("Error invoking remote method
     'fs:rename-node': Error: …" on Electron); the user sees the message. */
  function errText(err) {
    return String((err && err.message) || err)
      .replace(/^Error invoking remote method '[^']*': /, '')
      .replace(/^Error: /, '');
  }

  /* One file operation at a time (S._operationLock). A second one used to
     be dropped without a word — now the user is told. */
  function reportBusy() {
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('fs-busy', window.t('Busy — try again in a moment.'), { priority: 5, ttl: 2500 });
    }
  }

  /* The reason keys of paths.checkEntryName, in words. */
  function nameProblemText(reason, name) {
    switch (reason) {
      case 'empty':    return window.t('Please enter a name.');
      case 'hidden':   return window.t('A name that starts with a dot would hide the item from the file panel. Please choose another name.');
      case 'edge':     return window.t('A name cannot start with a space or end with a dot or a space. Please choose another name.');
      case 'device':   return window.t('"{name}" is a reserved name on Windows. Please choose another name.').replace('{name}', name);
      case 'internal': return window.t('This name ends like one of Revery\'s own safety files. Please choose another name.');
      case 'long':     return window.t('This name is too long. Please choose a shorter name.');
      default:         return window.t('This name cannot be used. Please choose another name.');
    }
  }

  async function showNameProblem(reason, name) {
    try {
      await window.NativeAPI.showMessageBox({
        type: 'warning', title: window.t('Invalid Name'),
        message: nameProblemText(reason, name), buttons: [window.t('OK')],
      });
    } catch (_) { /* dialog unavailable — the name was still refused */ }
  }

  /** Is the open note one of `paths`, or inside one of them? */
  function activeAffectedBy(paths) {
    if (!S.activeFilePath) return false;
    return paths.some((p) => isInsideRoot(S.activeFilePath, p));
  }

  /* Run the file-system part of an operation INSIDE the save engine's
     disk lock, so no write of the open note can interleave with it: a
     save queued before lands first, one queued after sees where the note
     is now (save.js _goneActivePaths). When the open note is involved,
     its watcher lets go of the folder first (on Windows an open handle
     can block renaming a folder) and watches again afterwards — the new
     path, or the old one when the operation failed. Never put a dialog in
     `fn`: while it runs, saves wait. */
  async function inDiskLock(involvesActive, fn) {
    return _enqueueDiskOp(async () => {
      if (involvesActive) await stopWatchingFile();
      try {
        return await fn();
      } finally {
        if (involvesActive && S.activeFilePath && !samePath(watchedPath(), S.activeFilePath)) {
          startWatchingFile(S.activeFilePath);
        }
      }
    });
  }

  /* Everything that remembers a path follows a rename/move record: the
     selected folder, the folder shown in card view, expanded folders, the
     previewed image, the selection anchor. (The open note follows through
     followActiveFile → save.retargetActiveFile.) Before this, each
     operation updated its own subset — the card view kept showing a
     folder that had moved, and undo followed the selected folder only on
     an exact match. */
  function remapPathState(records) {
    for (const { oldPath, newPath } of records) {
      const f = (p) => remapUnder(p, oldPath, newPath) || p;
      if (S.selectedDirPath)  S.selectedDirPath  = f(S.selectedDirPath);
      if (S.cardViewDir)      S.cardViewDir      = f(S.cardViewDir);
      if (S.previewMediaPath) S.previewMediaPath = f(S.previewMediaPath);
      if (S.selectionAnchor)  S.selectionAnchor  = f(S.selectionAnchor);
      const dirs = [...expandedDirs];
      expandedDirs.clear();
      for (const d of dirs) expandedDirs.add(f(d));
    }
  }

  /* …and forget what a delete took away: the view and the selected folder
     fall back to the deleted item's parent folder. */
  function forgetDeletedPathState(p) {
    const parent = parentPathOf(p);
    const hit = (q) => q && isInsideRoot(q, p);
    if (hit(S.selectedDirPath)) S.selectedDirPath = parent;
    if (hit(S.cardViewDir))     S.cardViewDir     = parent;
    if (hit(S.selectionAnchor)) S.selectionAnchor = null;
    forgetPreviewIfDeleted(p);
    for (const d of [...expandedDirs]) if (hit(d)) expandedDirs.delete(d);
  }

  /* The open note was deleted (it, or a folder around it). Inside the
     disk lock: saves queued before have landed; later ones see the path
     as gone. The buffer is cleared — the user confirmed the delete. */
  async function closeDeletedActiveFile() {
    markActivePathGone(S.activeFilePath);
    cancelPendingAutoSave();
    /* One synchronous block: with no note open, an edit arriving before the
       buffer is cleared would start a NEW note holding the deleted one's
       text (the scratchpad). */
    S.activeFilePath = null;
    markClean();
    if (typeof window.replaceEditorContent === 'function') {
      window.replaceEditorContent('');
    } else {
      editor.value = '';
      if (typeof render     === 'function') render();
      if (typeof countWords === 'function') countWords();
    }
    await window.NativeAPI.clearLastOpenedFile().catch(() => {});
  }

  /* Items of which another item in the list is an ancestor travel with
     that ancestor — acting on them separately only produced "not found"
     errors. */
  function withoutNested(items) {
    return items.filter((it) => !items.some((o) => o !== it
      && !samePath(o.path, it.path) && isInsideRoot(it.path, o.path)));
  }

  /* The type ('file' | 'dir') and link flag of a path as the tree or the
     card view shows it. */
  function itemInfo(p) {
    const el = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"], .sidebar-card[data-path="${CSS.escape(p)}"]`);
    return {
      type: el ? el.dataset.type : 'file',
      link: !!(el && el.dataset.link === '1'),
      known: !!el,
    };
  }

  /* ── Undo stack (moves + renames only — deletes are irreversible) ── */
  const MAX_UNDO  = 30;
  const undoStack = []; // [{type:'move'|'rename', records:[{oldPath,newPath}]}]

  /* ══════════════════════════════════════════════════════════════════
     LINK UPDATING ON RENAME/MOVE
     After a successful rename/move, scan the project's text files and
     rewrite markdown links that resolved to the moved path(s), so links
     never rot. Every safety property lives here:
       - matching is by RESOLVED target (same semantics as the renderer),
         computed by the pure, unit-tested link_rewrite.js — never by
         text search;
       - a file is written ONLY if a link actually changed, through the
         backends' atomic write path;
       - the active document is updated in the EDITOR BUFFER (a normal
         undoable edit that flows through autosave), never behind it;
       - the user confirms first, seeing exactly which files change
         (undo runs silently — reverting is completing their intent);
       - any per-file error skips that file and is reported; nothing
         aborts half-written.
  ══════════════════════════════════════════════════════════════════ */

  const _dirOf = (p) => p.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const _n = (p) => String(p).replace(/\\/g, '/');

  /* Apply `newText` to the editor buffer as small per-line changes instead
     of one whole-document replacement, so the cursor, scroll position,
     live-preview layout and find highlights outside the touched lines stay
     put and the undo step is exactly the link edit. The rewriter never adds
     or removes a line break; the fallback covers that anyway. Synchronous:
     the caller passes the buffer's current text. */
  function applyTextToEditor(oldText, newText) {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    const changes = [];
    if (a.length === b.length) {
      let pos = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) changes.push({ from: pos, to: pos + a[i].length, insert: b[i] });
        pos += a[i].length + 1;
      }
    } else {
      let s = 0;
      while (s < oldText.length && s < newText.length && oldText[s] === newText[s]) s++;
      let e = 0;
      while (e < oldText.length - s && e < newText.length - s
             && oldText[oldText.length - 1 - e] === newText[newText.length - 1 - e]) e++;
      changes.push({ from: s, to: oldText.length - e, insert: newText.slice(s, newText.length - e) });
    }
    if (!changes.length) return;
    if (typeof window.applyEditorChanges === 'function') window.applyEditorChanges(changes);
    else window.insertWithUndo(0, oldText.length, newText);
  }

  async function updateLinksAfterPathChange(records, { confirm = true } = {}) {
    try {
      if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return;
      records = (records || []).filter((r) => r && r.oldPath && r.newPath
        && r.oldPath.replace(/\\/g, '/') !== r.newPath.replace(/\\/g, '/'));
      if (!records.length) return;

      invalidateProjectScan(); // paths just changed — never scan a stale tree
      const files = await listProjectTextFiles(['md', 'txt']);
      if (!files.length) return;

      const mapAbs = buildAbsMapper(records);
      const mapBack = buildAbsMapper(invertRecords(records));
      const isActivePath = (p) => !!S.activeFilePath && _n(S.activeFilePath) === _n(p);

      /* PLAN — which files have links to update. The open note is read from
         its BUFFER (the `editor` shim; the #editor element is CodeMirror's
         <div> and has no value — reading that skipped the open note), other
         files from disk. A file that cannot be read (e.g. not UTF-8) is
         never touched. */
      const plans = [];
      for (const f of files) {
        const postPath = _n(f.path);
        const prePath = mapBack(postPath) || postPath;
        const opts = { fileDirBefore: _dirOf(prePath), fileDirAfter: _dirOf(postPath), mapAbs };
        let content;
        if (isActivePath(f.path)) {
          content = editor.value;
        } else {
          try { content = await window.NativeAPI.readFile(f.path); } catch (_) { continue; }
        }
        if (typeof content !== 'string') continue;
        const res = rewriteLinksInText(content, opts);
        if (res.changes > 0 && res.text !== content) {
          plans.push({ path: f.path, opts, changes: res.changes });
        }
      }
      if (!plans.length) return;

      if (confirm) {
        const total = plans.reduce((a, p) => a + p.changes, 0);
        const names = plans.map((p) => p.path.replace(/\\/g, '/').split('/').pop());
        const shown = names.slice(0, 8);
        if (names.length > shown.length) shown.push(window.t('…and {n} more').replace('{n}', names.length - shown.length));
        const ok = await showConfirmDialog(
          window.t('Update {n} link(s) in {m} file(s) so they keep working?')
            .replace('{n}', total).replace('{m}', plans.length),
          shown, window.t('Update links'));
        if (!ok) return;
      }

      /* APPLY — recompute from each file's CURRENT content: the user may have
         typed, or another program written, while the dialog was open.
         Whatever is current receives exactly the link edits, nothing else.
         (No watcher suppression: only files other than the open note are
         written here, and the watcher only reacts to the open note.) */
      const errors = [];
      for (const p of plans) {
        try {
          if (isActivePath(p.path)) {
            const cur = editor.value;
            const res = rewriteLinksInText(cur, p.opts);
            if (res.changes > 0 && res.text !== cur) {
              applyTextToEditor(cur, res.text);
              if (typeof render === 'function') render();
            }
          } else {
            const cur = await window.NativeAPI.readFile(p.path);
            const res = rewriteLinksInText(cur, p.opts);
            if (res.changes > 0 && res.text !== cur) {
              await window.NativeAPI.writeFile(p.path, res.text);
            }
          }
        } catch (err) {
          errors.push(`${p.path.replace(/\\/g, '/').split('/').pop()}: ${err.message || err}`);
        }
      }
      if (errors.length && window.NativeAPI.showMessageBox) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Link Update'),
          message: window.t('{n} file(s) could not be updated (their links are unchanged):').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } catch (err) {
      /* Never let link maintenance break the rename itself. */
      console.error('[Sidebar] link update failed (files left unchanged):', err);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     UNDO STACK
  ══════════════════════════════════════════════════════════════════ */

  function pushUndo(op) {
    undoStack.push(op);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  /* The stack stays private to this module; other modules ask through
     this function. (save.js used to read `undoStack` directly — a name
     that does not exist there, which the bundle turned into a global
     lookup that threw on every sidebar Ctrl+Z.) */
  function hasUndoOperations() {
    return undoStack.length > 0;
  }

  /* ── The active file vs. rename/move operations ────────────────────── */

  /** Before renaming/moving `paths`: when that includes the active file, let
      its pending edits reach disk and any in-flight save finish first, so no
      save can land on the OLD path after the rename (which recreated a file
      under the old name). Under a "Keep my version" hold nothing is written
      — the hold simply follows the file. Returns false when the flush
      failed; the caller then aborts the operation. */
  async function settleActiveFileBefore(paths) {
    if (!activeAffectedBy(paths)) return true;
    const held = !!S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath;
    if (S.isDirty && !held) return await saveActiveFile();
    await waitForSaveChainIdle();
    return true;
  }

  /** After `from` was renamed/moved to `to`: if the active file was `from`
      or lived inside it, hand over to the save engine's single retarget. */
  async function followActiveFile(from, to) {
    if (!S.activeFilePath) return;
    const next = remapUnder(S.activeFilePath, from, to);
    if (next && next !== S.activeFilePath) await retargetActiveFile(S.activeFilePath, next);
  }

  /** File undo never reaches into another project (openFolder, Save As). */
  function clearUndoStack() {
    undoStack.length = 0;
  }

  /**
   * Reverse the most recent move or rename operation.
   * Works by renaming each record back, in reverse order. The keyboard
   * shortcut only reaches here while the user works in the file panel
   * (save.js sidebarUndoAllowed); a status message says what was undone.
   */
  async function undoLastOperation() {
    if (undoStack.length === 0) return;
    if (S._operationLock) { reportBusy(); return; }
    S._operationLock = true;
    try {
      const op = undoStack.pop();
      const errors = [];
      const undone = [];
      const currentPaths = op.records.map((r) => r.newPath);

      if (!(await settleActiveFileBefore(currentPaths))) {
        undoStack.push(op); // the flush failed — keep the operation undoable
        return;
      }

      /* Reverse in reverse order so a multi-rename undoes cleanly */
      await inDiskLock(activeAffectedBy(currentPaths), async () => {
        for (const { oldPath, newPath } of [...op.records].reverse()) {
          try {
            await window.NativeAPI.renameNode(newPath, oldPath);
          } catch (err) {
            errors.push(`${baseNameOf(newPath)}: ${errText(err)}`);
            continue;
          }
          const back = { oldPath: newPath, newPath: oldPath };
          undone.push(back);
          await followActiveFile(newPath, oldPath);
          remapPathState([back]);
        }
      });

      selectedItems.clear(); S.selectionAnchor = null;
      await renderTree();
      /* Reverse the link rewrites too — silently: undoing the rename means
         restoring the links, no second confirmation needed. Only for what
         actually moved back. */
      if (undone.length) await updateLinksAfterPathChange(undone, { confirm: false });

      if (undone.length && typeof window.showStatusWarning === 'function') {
        const msg = op.type === 'rename'
          ? window.t('Undone: rename of "{name}".')
          : window.t('Undone: move of {n} item(s).');
        window.showStatusWarning('fs-undo',
          msg.replace('{name}', baseNameOf(undone[0].newPath)).replace('{n}', undone.length),
          { priority: 20, ttl: 5000 });
      }

      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Undo Failed Partially'),
          message: window.t('{n} item(s) could not be moved back:').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /**
   * Move an array of {path, type} items into targetDir.
   *
   *  1. Only inside the project; never the root, never into itself or a
   *     descendant, never where it already is (all compared as locations,
   *     not strings — a root opened through a link used to rename a file
   *     dropped into its own folder to name_2).
   *  2. Items inside another moved item travel with it.
   *  3. The open note's edits reach disk first; the renames run inside the
   *     disk lock (inDiskLock), and the note, its crash backup, its
   *     watcher and every remembered path follow.
   *  4. Destination names never clobber (uniqueDestPath; the backend
   *     refuses an existing destination anyway).
   *  5. S._operationLock: one file operation at a time.
   */
  async function moveNodes(items, targetDir) {
    if (!items.length || !targetDir) return;
    if (S._operationLock) { reportBusy(); return; }
    if (!S.rootPath || !isInsideRoot(targetDir, S.rootPath)) return;
    S._operationLock = true;
    try {
      const plan = withoutNested(items).filter(({ path: src }) =>
        !samePath(src, S.rootPath)                 // never the root
        && !isInsideRoot(targetDir, src)           // not into itself / a descendant
        && !samePath(dirOf(src), targetDir));      // already there
      if (!plan.length) return;

      const srcPaths = plan.map((it) => it.path);
      if (!(await settleActiveFileBefore(srcPaths))) {
        return; // Save failed — abort move to protect data
      }

      const errors = [];
      const movedRecords = []; // for undo
      await inDiskLock(activeAffectedBy(srcPaths), async () => {
        for (const { path: srcPath, type } of plan) {
          const name = baseNameOf(srcPath);
          const destPath = await uniqueDestPath(targetDir, name, type);
          try {
            await window.NativeAPI.renameNode(srcPath, destPath);
          } catch (err) {
            errors.push(`${name}: ${errText(err)}`);
            continue;
          }
          const rec = { oldPath: srcPath, newPath: destPath };
          movedRecords.push(rec);
          await followActiveFile(srcPath, destPath);
          remapPathState([rec]);
        }
      });

      if (movedRecords.length) expandedDirs.add(targetDir); // show what arrived
      selectedItems.clear();
      S.selectionAnchor = null;
      if (movedRecords.length) pushUndo({ type: 'move', records: movedRecords });
      await renderTree();
      if (movedRecords.length) await updateLinksAfterPathChange(movedRecords);

      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Move Issues'),
          message: window.t('{n} item(s) could not be moved:').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /* ── "Move to…" and "Move up one level" (context menu, both views) ── */

  /** The folder one level above the items' common folder, or null when
      they do not share one folder or it already is the project root. */
  function moveUpTarget(paths) {
    if (!paths.length || !S.rootPath) return null;
    const parent = parentPathOf(paths[0]);
    if (!paths.every((p) => samePath(parentPathOf(p), parent))) return null;
    if (samePath(parent, S.rootPath) || !isInsideRoot(parent, S.rootPath)) return null;
    return parentPathOf(parent);
  }

  async function moveItemsUp(items) {
    const target = moveUpTarget(items.map((it) => it.path));
    if (target) await moveNodes(items, target);
  }

  /* Every folder of the project for the picker (links and dot-folders are
     never offered). A cap keeps an enormous tree from freezing the UI; the
     picker says when it applies. */
  const PICKER_MAX_FOLDERS = 3000;
  async function listProjectFolders() {
    const folders = [{ path: S.rootPath, name: baseNameOf(S.rootPath) || S.rootPath, rel: '', depth: 0 }];
    let truncated = false;
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await window.NativeAPI.readDirectory(dir); } catch (_) { return; }
      const dirs = entries
        .filter((e) => e.type === 'dir' && !e.link && !e.name.startsWith('.'))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      for (const e of dirs) {
        if (folders.length >= PICKER_MAX_FOLDERS) { truncated = true; return; }
        const r = rel ? rel + '/' + e.name : e.name;
        folders.push({ path: e.path, name: e.name, rel: r, depth });
        if (depth < 32) await walk(e.path, r, depth + 1);
      }
    };
    await walk(S.rootPath, '', 1);
    return { folders, truncated };
  }

  /** "Move to…": pick a folder, then the same moveNodes as a drop. */
  async function moveItemsTo(items) {
    if (!items.length || !S.rootPath) return;
    if (S._operationLock) { reportBusy(); return; }
    const paths = items.map((it) => it.path);
    const parent = parentPathOf(paths[0]);
    const sameParent = paths.every((p) => samePath(parentPathOf(p), parent));
    const title = items.length === 1
      ? window.t('Move "{name}" to…').replace('{name}', baseNameOf(paths[0]))
      : window.t('Move {n} items to…').replace('{n}', items.length);
    const target = await showFolderPickerDialog({
      title,
      okLabel: window.t('Move here'),
      load: async () => {
        const { folders, truncated } = await listProjectFolders();
        return {
          truncated,
          folders: folders
            // never into a moved folder or below it
            .filter((f) => !paths.some((p) => isInsideRoot(f.path, p)))
            .map((f) => (sameParent && samePath(f.path, parent))
              ? { ...f, disabled: true, note: window.t('(current folder)') }
              : f),
        };
      },
    });
    if (target) await moveNodes(items, target);
  }

  /* A deleted node (or folder) that held the previewed image ends the
     preview: the highlight target is gone and the next note must not be
     named after — or placed beside — a file that no longer exists. */
  function forgetPreviewIfDeleted(node) {
    if (S.previewMediaPath && isInsideRoot(S.previewMediaPath, node)) {
      S.previewMediaPath = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     MULTI-SELECT OPERATIONS  (rename / delete)
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Rename all selected items.
   * Single item → delegates to the normal renameNode dialog (unchanged UX).
   * Multiple items → asks for one base name, assigns it with _2, _3 …
   *   suffixes; every item keeps its own extension. Names go through the
   *   one name rule; items that cannot be renamed are reported.
   */
  async function renameSelectedNodes() {
    if (selectedItems.size === 0) return;
    if (S._operationLock) { reportBusy(); return; }

    if (selectedItems.size === 1) {
      /* Single-item path: delegate to the existing per-item rename */
      const p = [...selectedItems][0];
      await renameNode(p, itemInfo(p).type);
      selectedItems.clear(); S.selectionAnchor = null;
      return;
    }

    S._operationLock = true;
    try {
      const paths     = [...selectedItems];
      const firstName = baseNameOf(paths[0]);
      const defaultBase = firstName.replace(/\.(md|txt)$/, '');

      const baseName = await showInputDialog(
        window.t('Rename {n} items — enter a base name').replace('{n}', paths.length) +
        '\n' + window.t('(items will be named: name, name_2, name_3 …):'),
        defaultBase
      );
      if (!baseName) return;

      const safeBase = sanitizeEntryName(baseName);
      const baseProblem = checkEntryName(safeBase);
      if (baseProblem) { await showNameProblem(baseProblem, safeBase); return; }

      /* Plan every new name first; refuse the whole rename if any of them
         breaks the name rule, before anything on disk changes. */
      const plan = [];
      for (let i = 0; i < paths.length; i++) {
        const srcPath = paths[i];
        const oldName = baseNameOf(srcPath);
        const { type, known } = itemInfo(srcPath);
        const isFile  = known ? type === 'file' : oldName.lastIndexOf('.') > 0;
        const oldExt  = isFile && oldName.lastIndexOf('.') > 0 ? oldName.substring(oldName.lastIndexOf('.')) : '';
        const newName = i === 0 ? `${safeBase}${oldExt}` : `${safeBase}_${i + 1}${oldExt}`;
        if (newName === oldName) continue;
        const problem = checkEntryName(newName);
        if (problem) { await showNameProblem(problem, newName); return; }
        plan.push({ oldPath: srcPath, newPath: joinPath(parentPathOf(srcPath), newName) });
      }
      if (!plan.length) return;

      if (!(await settleActiveFileBefore(plan.map((r) => r.oldPath)))) return;

      const renamedRecords = [];
      const errors = [];
      await inDiskLock(activeAffectedBy(plan.map((r) => r.oldPath)), async () => {
        for (const rec of plan) {
          try {
            await window.NativeAPI.renameNode(rec.oldPath, rec.newPath);
          } catch (err) {
            errors.push(`${baseNameOf(rec.oldPath)}: ${errText(err)}`);
            continue;
          }
          renamedRecords.push(rec);
          await followActiveFile(rec.oldPath, rec.newPath);
          remapPathState([rec]);
        }
      });

      selectedItems.clear(); S.selectionAnchor = null;
      if (renamedRecords.length) pushUndo({ type: 'rename', records: renamedRecords });
      await renderTree();
      if (renamedRecords.length) await updateLinksAfterPathChange(renamedRecords);
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Rename Issues'),
          message: window.t('{n} item(s) could not be renamed:').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /* One slot for every "your delete was stopped" notice: the newest replaces
     the last; priority above the sticky hold message (70) it explains. */
  function tellDeleteStopped(msg) {
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('action-stopped', msg.replace('{name}', baseNameOf(S.activeFilePath || '')),
        { priority: 80, ttl: 9000 });
    }
  }

  /** Is the open note among `paths` (or inside one) while auto-save is
      paused for it? Then the version on screen is not on disk, and deleting
      would lose one of the two versions: nothing is deleted, the user is
      told to save it (Ctrl+S) or resolve the pause first. Checked before
      asking — no point confirming a delete that will not happen — and again
      after (a pause can begin while the question is open). */
  function deleteBlockedByPause(paths) {
    if (!activeAffectedBy(paths) || !S._conflictHoldPath || S._conflictHoldPath !== S.activeFilePath) return false;
    tellDeleteStopped(window.t('Nothing was deleted: auto-save is paused for "{name}", so the version on screen is not on disk. Save it (Ctrl+S) or resolve the message first.'));
    return true;
  }

  /** Deleting the open note — or a folder around it — first saves what is
      on screen, exactly as opening another note would, so the copy in the
      Trash holds the latest text (it used to lack every edit autosave had
      not written yet: they were dropped with the editor). Nothing is
      deleted when the save fails (its error was shown) or stops because
      another program changed the file (that question comes up instead). */
  async function saveOpenNoteBeforeDelete(paths) {
    if (!activeAffectedBy(paths)) return true;
    if (deleteBlockedByPause(paths)) return false;
    if (S.isDirty) {
      if (!(await saveActiveFile())) {
        tellDeleteStopped(window.t('Nothing was deleted: "{name}" could not be saved first, and its latest edits would have been lost.'));
        return false;
      }
      return true;
    }
    await waitForSaveChainIdle();
    return true;
  }

  /** Move all selected items to the trash with a single confirmation. */
  async function deleteSelectedNodes() {
    if (selectedItems.size === 0) return;
    if (S._operationLock) { reportBusy(); return; }
    S._operationLock = true;
    try {
      const items = withoutNested([...selectedItems].map((p) => ({ path: p })));
      if (deleteBlockedByPause(items.map((it) => it.path))) return;
      const n     = selectedItems.size;
      const anyLink = [...selectedItems].some((p) => itemInfo(p).link);

      const result = await window.NativeAPI.showMessageBox({
        type: 'question',
        buttons: [window.t('Move to Trash'), window.t('Cancel')],
        defaultId: 1,
        title:  window.t('Delete {n} item(s)').replace('{n}', n),
        message: window.t('Move {n} item(s) to Trash?').replace('{n}', n),
        detail: window.t('You can restore them from your system trash.')
          + (anyLink ? '\n' + window.t('Links are removed as links; the items they point to are not changed.') : ''),
      });
      if (result.response !== 0) return;
      if (!(await saveOpenNoteBeforeDelete(items.map((it) => it.path)))) return;

      const errors = [];
      await inDiskLock(activeAffectedBy(items.map((it) => it.path)), async () => {
        for (const { path: p } of items) {
          try {
            await window.NativeAPI.deleteNode(p);
          } catch (err) {
            errors.push(`${baseNameOf(p)}: ${errText(err)}`);
            continue;
          }
          if (S.activeFilePath && isInsideRoot(S.activeFilePath, p)) await closeDeletedActiveFile();
          forgetDeletedPathState(p);
        }
      });

      selectedItems.clear(); S.selectionAnchor = null;
      await renderTree();
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Delete Issues'),
          message: window.t('{n} item(s) could not be moved to the trash (nothing else was changed):').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     OPEN MEDIA FILE  (image — show it in the preview; nothing is written)

     Clicking an image previews it and PREPARES a note beside it without
     creating a file: the editor becomes the ordinary scratchpad (no active
     file) holding the image link, and S.previewMediaPath tells the rest
     of the app which image is shown. pendingNoteDir() then points at the
     image's folder, so the preview resolves the link there, media dropped
     meanwhile is copied there, and the first keystroke creates the note
     there — named after the image (save.js). Everything else is the
     normal scratchpad path: volatile crash backup from the first
     keystroke, atomic create + write, autosave. No special mode exists in
     the save engine.
  ══════════════════════════════════════════════════════════════════ */

  async function openMediaFile(filePath) {
    /* The open note is saved first (save.replaceOpenDocument). */
    const switched = await replaceOpenDocument(null, () => {
      S.activeFilePath               = null;
      window._showingUnsupportedFile = false;
      S.previewMediaPath             = filePath;

      /* Relative to pendingNoteDir(), i.e. the image's own folder — where
         the note this preview may become will be created. */
      const mdText = mediaMarkdown(filePath);

      /* Use replaceEditorContent (via setState) rather than performTextChange
         (via dispatch) so that:
           1. The CM history is wiped — Ctrl+Z won't undo back into whatever
              file was open before.
           2. The updateListener is NOT fired, so _inputListeners are skipped
              and the scratchpad auto-create doesn't trigger on our own
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
    });
    if (switched) switchFromMobileSidebar();
  }


  /* ══════════════════════════════════════════════════════════════════
     OPEN UNSUPPORTED FILE  (show placeholder, don't load content)
  ══════════════════════════════════════════════════════════════════ */

  async function openUnsupportedFile(filePath) {
    /* The open note is saved first (save.replaceOpenDocument). */
    const switched = await replaceOpenDocument(null, () => {
      S.activeFilePath               = null;
      S.previewMediaPath             = null;
      window._showingUnsupportedFile = true;

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
    });
    if (switched) switchFromMobileSidebar();
  }


  /* ══════════════════════════════════════════════════════════════════
     OPEN FILE
  ══════════════════════════════════════════════════════════════════ */

  async function openFile(filePath) {
    /* save.replaceOpenDocument first lets a title rename still running
       finish (the title field lost focus to this very click — it must not
       retarget the note after another one is in the editor), then saves
       the open note. */
    const switched = await replaceOpenDocument(async () => {
      /* The open note's identity is the spelling the folder listings use
         (parent folder resolved, own name untouched): every "is this the
         open note?" check of the file operations compares against it. */
      let path = filePath;
      try {
        const c = await window.NativeAPI.canonicalEntryPath(path);
        if (typeof c === 'string' && c) path = c;
      } catch (_) { /* keep as given — the read below reports real problems */ }

      try {
        return { path, content: await window.NativeAPI.readFile(path) };
      } catch (err) {
        await window.NativeAPI.showMessageBox({
          type: 'error', title: window.t('Open Failed'),
          message: window.t('Could not read:') + '\n' + path,
          detail: String(err)
        });
        return SWITCH_CANCELLED;
      }
    }, ({ path, content }) => {
      filePath = path;
      /* Clear any special viewing modes */
      S.previewMediaPath             = null;
      window._showingUnsupportedFile = false;

      /* Load into editor with a fresh history so Ctrl+Z in this file
         can never undo back to content from any previously opened file. */
      if (typeof window.replaceEditorContent === 'function') {
        window.replaceEditorContent(content);
      } else {
        editor.value = content;
        if (typeof render     === 'function') render();
        if (typeof countWords === 'function') countWords();
      }

      S.activeFilePath = path;
      forgetGonePath(path);
      markClean();
      rememberDiskContent(content);

      /* The title belongs to the document on screen from the same moment. */
      if (docTitleEl) {
        docTitleEl.value = baseNameOf(path).replace(/\.(md|txt)$/, '');
      }
    });
    if (!switched) return;

    /* Non-fatal, like every other pointer update: a failing settings write
       (a full disk now reports it) must not stop the switch half way — the
       watcher and the highlight below belong to this note. */
    await window.NativeAPI.setLastOpenedFile(filePath).catch((e) => console.warn('[Sidebar] could not persist last-opened pointer (non-fatal):', e));

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
    if (S._operationLock) { reportBusy(); return; }
    /* Auto-save current before switching */
    if (S.isDirty && S.activeFilePath) await saveActiveFile();

    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) {
      await window.NativeAPI.showMessageBox({
        type: 'info', title: window.t('No Folder Open'),
        message: window.t('Please open a project folder first.')
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
          type: 'error', title: window.t('Could Not Create File'),
          message: window.t('The file could not be created.'),
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
    if (S._operationLock) { reportBusy(); return; }
    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) return;

    const name = await showInputDialog(window.t('New folder name:'));
    if (!name || !name.trim()) return;

    const safeName = sanitizeEntryName(name);
    const problem  = checkEntryName(safeName);
    if (problem) { await showNameProblem(problem, safeName); return; }
    const newPath  = joinPath(dir, safeName);

    /* An existing name used to "succeed" silently (mkdir of an existing
       folder does nothing): say so instead. Letter case is ignored, as on
       Windows and macOS. */
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      if (entries.some((e) => e.name.toLowerCase() === safeName.toLowerCase())) {
        await window.NativeAPI.showMessageBox({
          type: 'info', title: window.t('Name Already Used'),
          message: window.t('"{name}" already exists in this folder.').replace('{name}', safeName),
          buttons: [window.t('OK')],
        }).catch(() => {});
        return;
      }
    } catch (_) { /* listing failed — the create below reports real problems */ }

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
        type: 'error', title: window.t('Could Not Create Folder'),
        message: window.t('Could not create folder "{name}".').replace('{name}', safeName),
        detail: errText(err),
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     RENAME / DELETE
  ══════════════════════════════════════════════════════════════════ */

/**
 * Rename one file, folder or link (context menu).
 * The one name rule applies (paths.checkEntryName). A file keeps its
 * extension unless the user typed the same one or another one of the same
 * kind (paths.renamedFileName: "Meeting 26.09.2026" stays a note — it
 * used to lose ".md" and become a file the app cannot open). The dialog
 * preselects the name without its extension.
 */
async function renameNode(nodePath, type) {
    if (S._operationLock) { reportBusy(); return; }
    S._operationLock = true;
    try {
      const oldName = baseNameOf(nodePath);

      const typed = await showInputDialog(
        window.t('Rename "{name}" to:').replace('{name}', oldName), oldName,
        { selectStem: type === 'file' });
      if (!typed) return;
      const safeName = sanitizeEntryName(typed);
      if (safeName === oldName) return;
      const typedProblem = checkEntryName(safeName);
      if (typedProblem) { await showNameProblem(typedProblem, safeName); return; }

      const finalName = type === 'file' ? renamedFileName(oldName, safeName) : safeName;
      if (finalName === oldName) return;
      const finalProblem = checkEntryName(finalName);
      if (finalProblem) { await showNameProblem(finalProblem, finalName); return; }

      const newPath = joinPath(parentPathOf(nodePath), finalName);
      if (!(await settleActiveFileBefore([nodePath]))) return;

      const rec = { oldPath: nodePath, newPath };
      try {
        await inDiskLock(activeAffectedBy([nodePath]), async () => {
          await window.NativeAPI.renameNode(nodePath, newPath);
          await followActiveFile(nodePath, newPath);
          remapPathState([rec]);
        });
      } catch (err) {
        console.error('[Sidebar] renameNode failed:', err);
        /* Tell the user — a failed rename used to do nothing visible. */
        await window.NativeAPI.showMessageBox({
          type: 'error', title: window.t('Rename Failed'),
          message: window.t('Could not rename file to "{name}".').replace('{name}', finalName),
          detail: errText(err),
        }).catch(() => {});
        return;
      }
      pushUndo({ type: 'rename', records: [rec] });
      await renderTree();
      await updateLinksAfterPathChange([rec]);
    } finally {
      S._operationLock = false;
    }
  }


/**
 * Move one file, folder or link to the OS trash. A link is trashed as a
 * link — the item it points to is not touched (the backends act on the
 * entry, never its target). The delete runs inside the disk lock: a save
 * already queued lands first; the open note, when deleted, is closed.
 */
async function deleteNode(nodePath, type, isLink = false) {
    if (S._operationLock) { reportBusy(); return; }
    S._operationLock = true;
    try {
      const name = baseNameOf(nodePath);
      if (deleteBlockedByPause([nodePath])) return;

      const result = await window.NativeAPI.showMessageBox({
        type: 'question',
        buttons: [window.t('Move to Trash'), window.t('Cancel')],
        defaultId: 1,
        title: isLink ? window.t('Delete Link')
             : type === 'dir' ? window.t('Delete Folder') : window.t('Delete File'),
        message: (isLink ? window.t('Move the link "{name}" to Trash?') : window.t('Move "{name}" to Trash?'))
          .replace('{name}', name),
        detail: isLink
          ? window.t('Only the link is removed. The item it points to is not changed.')
          : type === 'dir'
            ? window.t('The folder and all its contents will be moved to your system trash. You can restore them from there.')
            : window.t('The file will be moved to your system trash. You can restore it from there.'),
      });
      if (result.response !== 0) return;
      if (!(await saveOpenNoteBeforeDelete([nodePath]))) return;

      let failure = null;
      await inDiskLock(activeAffectedBy([nodePath]), async () => {
        try {
          await window.NativeAPI.deleteNode(nodePath);
        } catch (err) {
          failure = err;
          return;
        }
        if (S.activeFilePath && isInsideRoot(S.activeFilePath, nodePath)) await closeDeletedActiveFile();
        forgetDeletedPathState(nodePath);
      });

      if (failure) {
        console.error('[Sidebar] deleteNode failed:', failure);
        /* A failed delete used to be silent. */
        await window.NativeAPI.showMessageBox({
          type: 'error', title: window.t('Delete Failed'),
          message: window.t('"{name}" could not be moved to the trash. Nothing was changed.').replace('{name}', name),
          detail: errText(failure),
        }).catch(() => {});
      }
      await renderTree();
    } finally {
      S._operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     OPEN FOLDER DIALOG
  ══════════════════════════════════════════════════════════════════ */

async function openFolder(folderPath) {
    // Tell the backend what the sandbox root is so all subsequent FS IPC
    // calls are validated against it. Must happen before renderTree().
    // Only once the backend has accepted the folder does the renderer
    // switch (it used to switch first, and a refused folder left it
    // pointing at a root the backend never took). The backend answers
    // with the root's CANONICAL spelling — the one every folder listing
    // uses — which the renderer adopts.
    const canonical = await window.NativeAPI.setRootPath(folderPath);
    if (typeof canonical === 'string' && canonical) folderPath = canonical;
    S.rootPath = folderPath;
    clearUndoStack(); // file undo never reaches into another project
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


/* Leave the current project: the editor is emptied and no note is open.
   The apply step of save.replaceOpenDocument (synchronous), for both
   project switches (this dialog, the recent-projects menu). */
function clearEditorForProjectSwitch() {
  S.activeFilePath               = null;
  S.previewMediaPath             = null;
  window._showingUnsupportedFile = false;
  markClean();
  if (typeof window.replaceEditorContent === 'function') {
    window.replaceEditorContent('');
  } else {
    editor.value = '';
    if (typeof render === 'function') render();
  }
  if (typeof countWords === 'function') countWords();
  if (docTitleEl) docTitleEl.value = '';
}

/* Switch to another project folder once the open note is saved. The
   backend makes `path` the root only here (openFolder → setRootPath): the
   picker merely authorizes it, so the old note can still be saved after
   the picker closed. */
async function switchProject(path) {
  if (!(await replaceOpenDocument(null, clearEditorForProjectSwitch))) return;
  // Non-fatal: the old note has left the editor even if this fails.
  await window.NativeAPI.clearLastOpenedFile().catch((e) => console.warn('[Sidebar] could not persist last-opened pointer (non-fatal):', e));
  await openFolder(path);
}

async function promptOpenFolder() {
    try {
      const path = await window.NativeAPI.openFolderDialog();
      if (!path) return;
      await switchProject(path);
    } catch (err) {
      console.error('[Sidebar] openFolderDialog failed:', err);
    }
  }

export { pushUndo, hasUndoOperations, undoLastOperation, clearUndoStack, moveNodes,
         moveItemsTo, moveItemsUp, moveUpTarget, renameSelectedNodes,
         deleteSelectedNodes, openMediaFile, openUnsupportedFile, openFile,
         createNewFile, createNewFolder, renameNode, deleteNode, itemInfo,
         showNameProblem, openFolder, promptOpenFolder, switchProject };

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
      const tell = (type, title, message, detail) => window.NativeAPI.showMessageBox({
        type, title, message, detail, buttons: [window.t('OK')],
      }).catch(() => {});
      if (file.size > 20 * 1024 * 1024) {
        await tell('warning', window.t('Import'), window.t('File is too large. Maximum is 20 MB.'));
        return;
      }
      /* Strictly (import_text.js): readAsText used to decode lossily and
         put U+FFFD in place of every byte that was not UTF-8. */
      let bytes;
      try {
        bytes = await file.arrayBuffer();
      } catch (err) {
        await tell('error', window.t('Import Failed'),
          window.t('"{name}" could not be read.').replace('{name}', file.name), errText(err));
        return;
      }
      let content;
      try {
        content = decodeImportedText(bytes);
      } catch (_) {
        await tell('warning', window.t('Import'),
          window.t('"{name}" was not imported.').replace('{name}', file.name),
          window.t('It is not UTF-8 text (it may use another encoding, such as Windows-1252). Importing it would have replaced some of its characters. Convert it to UTF-8 in another editor, then import it again.'));
        return;
      }
      let baseName   = sanitizeEntryName(file.name.replace(/\.[^/.]+$/, ''));
      const ext      = /\.txt$/i.test(file.name) ? 'txt' : 'md';
      /* A picked file's name the one name rule refuses (".notes.md",
         "con.md") is imported under a neutral name instead. */
      if (checkEntryName(baseName) || checkEntryName(`${baseName}.${ext}`)) baseName = 'imported';
      let destPath = null;
      let created = false;
      try {
        /* Same create-retry as createNewFile: another program may take the
           free name between uniquePath() and the exclusive create. */
        for (let attempt = 0; attempt < 5; attempt++) {
          destPath = await uniquePath(dir, baseName, ext);
          try {
            await window.NativeAPI.createFile(destPath);
            created = true;
            break;
          } catch (err) {
            if (String(err).includes('already exists') && attempt < 4) continue;
            throw err;
          }
        }
        await window.NativeAPI.writeFile(destPath, content);
      } catch (err) {
        console.error('[Sidebar] import write failed:', err);
        /* The empty file is ours (just created, exclusively): never leave
           it behind looking like the import. */
        if (created) window.NativeAPI.deleteNode(destPath).catch(() => {});
        await tell('error', window.t('Import Failed'),
          window.t('"{name}" could not be imported.').replace('{name}', file.name), errText(err));
        return;
      }
      await renderTree();
      await openFile(destPath);
    };
    input.click();
  };
}

/* dnd.js — drop-target resolution and external-file drop handling
   (tree drag wiring, global navigation guard, Tauri native drop). */
import { S, treeEl, expandedDirs, selectedItems } from './state.js';
import { renderTree, updateMultiSelectHighlight } from './tree.js';
import { handleEditorMediaPaths } from './editor_media.js';
import { moveNodes } from './fileops.js';

  /* ══════════════════════════════════════════════════════════════════
     DRAG DROP TARGET HELPER
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Given the element under the cursor during a drag, return the
   * filesystem path of the folder that should receive the drop.
   *
   * The tree DOM layout is flat siblings, not nested:
   *   treeEl
   *     itemEl.sidebar-dir          ← folder row
   *     div.sidebar-children        ← [data-parent-path="folderPath"]
   *       itemEl.sidebar-file       ← child file
   *       itemEl.sidebar-dir        ← child folder
   *       div.sidebar-children      ← ...
   *
   * So closest('.sidebar-dir') only finds the FOLDER ROW itself, not
   * a folder you're hovering "inside."  We also walk up through
   * .sidebar-children containers to find the logical parent folder.
   */
function getDropTargetDir(eventTarget) {
    /* Case 1.5: cursor is directly on a folder card */
    const dirCard = eventTarget.closest('.sidebar-card-dir');
    if (dirCard && !selectedItems.has(dirCard.dataset.path)) {
      return dirCard.dataset.path;
    }

    /* Case 1: cursor is directly on a folder row */
    const dirRow = eventTarget.closest('.sidebar-dir');
    if (dirRow && !selectedItems.has(dirRow.dataset.path)) {
      return dirRow.dataset.path;
    }

    /* Case 2: cursor is over an item inside an expanded folder's children
       container (a file row, or empty space in the children div).
       Walk up to find the nearest .sidebar-children, then use its
       data-parent-path to identify the owning folder.               */
    const childrenContainer = eventTarget.closest('.sidebar-children');
    if (childrenContainer && childrenContainer.dataset.parentPath) {
      const parentPath = childrenContainer.dataset.parentPath;
      /* Only use it if the parent folder itself is not being dragged */
      if (!selectedItems.has(parentPath)) return parentPath;
    }

    /* Case 3: empty space / root */
    if (S.sidebarViewMode === 'card') {
      return S.cardViewDir || S.rootPath;
    }
    return S.rootPath;
  }

  /**
   * Return the folder-row element that should be highlighted as the
   * drop target, or null if it's the tree root.
   */
  function getDropTargetEl(eventTarget) {
    const dirPath = getDropTargetDir(eventTarget);
    if (!dirPath || dirPath === S.rootPath || (S.sidebarViewMode === 'card' && dirPath === S.cardViewDir)) return null;
    
    if (S.sidebarViewMode === 'card') {
      return treeEl.querySelector(`.sidebar-card-dir[data-path="${CSS.escape(dirPath)}"]`);
    }
    return treeEl.querySelector(`.sidebar-dir[data-path="${CSS.escape(dirPath)}"]`);
  }

  const DROP_MAX_BYTES = 20 * 1024 * 1024;

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000; // 32 KB chunks — avoid fromCharCode arg-count limits
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }




/* A "dropped source" is either Electron File bytes or a Tauri path:
       { kind: 'file', file }   — Electron DOM drop (read bytes → base64)
       { kind: 'path', path }   — Tauri native drop (copy by source path)
     The folder-resolution, collision, refresh and error handling are shared;
     only the per-source copy call differs. */
  async function copyDroppedSources(sources, targetDir) {
    if (S._operationLock || !sources.length || !targetDir) return;
    if (!window.NativeAPI) return;

    S._operationLock = true;
    try {
      const errors = [];
      let copiedAny = false;

      for (const src of sources) {
        const label = src.kind === 'file' ? src.file.name : src.path;
        try {
          if (src.kind === 'file') {
            const file = src.file;
            if (file.size > DROP_MAX_BYTES) {
              errors.push(`${label}: too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 20 MB)`);
              continue;
            }
            let b64;
            try {
              b64 = arrayBufferToBase64(await file.arrayBuffer());
            } catch (e) {
              errors.push(`${label}: could not read (folders can't be dropped here)`);
              continue;
            }
            await window.NativeAPI.copyFileIntoFolder(targetDir, file.name, b64);
          } else {
            await window.NativeAPI.copyPathIntoFolder(src.path, targetDir);
          }
          copiedAny = true;
        } catch (err) {
          errors.push(`${label}: ${err && err.message ? err.message : err}`);
        }
      }

      if (copiedAny) {
        expandedDirs.add(targetDir);
        await renderTree();
      }
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: window.t('Copy Issues'),
          message: window.t('{n} file(s) could not be copied:').replace('{n}', errors.length),
          detail: errors.join('\n'),
        });
      }
    } finally {
      S._operationLock = false;
    }
  }

  /* Electron DOM drop → wrap File objects as sources. */
  async function copyExternalFilesIntoDir(files, targetDir) {
    const sources = Array.from(files).map((file) => ({ kind: 'file', file }));
    return copyDroppedSources(sources, targetDir);
  }

export function initDnd() {
/* ── Drop-zone event delegation on the tree container ─────────── */
  treeEl.addEventListener('dragover', (e) => {
    /* The sidebar tree is ALWAYS a valid drop target — for internal moves
       and for external OS files. Accept unconditionally so the drop fires
       and the webview can never navigate. We must NOT gate on
       dataTransfer.types here: WebKitGTK (Tauri/Linux) does not report
       "Files" during dragover, which previously dropped us into the
       no-preventDefault branch and let the OS file open as a URL. */
    e.preventDefault();
    e.dataTransfer.dropEffect = S._dragItems.length ? 'move' : 'copy';

    /* Highlight the receiving folder. */
    treeEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    treeEl.classList.remove('drop-target-root');

    const targetEl = getDropTargetEl(e.target);
    if (targetEl) {
      targetEl.classList.add('drop-target');
    } else {
      /* Dropping to root — highlight the tree container itself */
      const targetPath = getDropTargetDir(e.target);
      if (targetPath === S.rootPath) treeEl.classList.add('drop-target-root');
    }
  });






  treeEl.addEventListener('dragleave', (e) => {
    /* Only clear when leaving the tree entirely, not when moving
       between child elements inside the tree.                    */
    if (e.relatedTarget && treeEl.contains(e.relatedTarget)) return;
    treeEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    treeEl.classList.remove('drop-target-root');
  });

  treeEl.addEventListener('drop', async (e) => {
    e.preventDefault();

    const targetDir = getDropTargetDir(e.target);

    treeEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    treeEl.classList.remove('drop-target-root');

    /* ── Internal move (items dragged within the tree) ── */
    if (S._dragItems.length) {
      /* Copy S._dragItems before dragend clears it (spec says drop fires
         before dragend, but we copy defensively).                     */
      const itemsToMove = [...S._dragItems];
      S._dragItems = [];
      await moveNodes(itemsToMove, targetDir);
      return;
    }

    const files = (e.dataTransfer && e.dataTransfer.files)
      ? Array.from(e.dataTransfer.files) : [];
    if (files.length) {
      await copyExternalFilesIntoDir(files, targetDir);
    }
  });

/* Clicking on empty tree space clears the multi-selection */
  treeEl.addEventListener('click', (e) => {
    if (!e.target.closest('.sidebar-item') && !e.target.closest('.sidebar-card') && selectedItems.size > 0) {
      selectedItems.clear();
      S.selectionAnchor = null;
      updateMultiSelectHighlight();
    }
  });

/* ── Global navigation guard ─────────────────────────────────────────── */
  (function installGlobalFileDropGuard() {
    ['dragenter', 'dragover'].forEach((type) => {
      window.addEventListener(type, (e) => { e.preventDefault(); });
    });
    window.addEventListener('drop', (e) => {
      const t = e.target;
      // Let plain text inputs keep native text-drag-drop.
      if (t && t.closest && t.closest('input, textarea')) return;
      e.preventDefault();
    });
  })();


/* ── Tauri: native OS file-drop (WebKitGTK can't deliver dropped File
     bytes via HTML5 DnD). Tauri's native event gives absolute source paths
     plus a cursor position; we hit-test the position to find the hovered
     folder and copy by path. Electron's onNativeFileDrop is a no-op, so this
     does nothing there. */
  (function installTauriNativeFileDrop() {
    if (!window.NativeAPI || window.NativeAPI.env !== 'tauri') return;

    const clearHighlights = () => {
      treeEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      treeEl.classList.remove('drop-target-root');
    };

    /* Physical cursor pos → { el, dir } if it lands inside the tree, else null. */
    const pointToTarget = (pos) => {
      if (!pos) return null;
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
      if (!el || !el.closest || !el.closest('#sidebar-tree')) return null;
      return { el, dir: getDropTargetDir(el) };
    };

    window.NativeAPI.onNativeFileDrop({
      onOver: (pos) => {
        clearHighlights();
        const hit = pointToTarget(pos);
        if (!hit) return;
        const targetEl = getDropTargetEl(hit.el);
        if (targetEl) targetEl.classList.add('drop-target');
        else if (hit.dir === S.rootPath) treeEl.classList.add('drop-target-root');
      },
      onLeave: clearHighlights,
      onDrop: (pos, paths) => {
        clearHighlights();
        if (!paths || !paths.length) return;
        const hit = pointToTarget(pos);
        if (hit) {
          copyDroppedSources(paths.map((p) => ({ kind: 'path', path: p })), hit.dir);
          return;
        }
        /* Not the tree — media dropped onto the EDITOR copies into the
           project and inserts a link (editor_media.js). */
        const dpr = window.devicePixelRatio || 1;
        const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
        if (el && el.closest && el.closest('#editor')) {
          handleEditorMediaPaths(paths);
        }
      },
    }).catch(() => { /* listener registration failed — drop simply won't work */ });
  })();
}

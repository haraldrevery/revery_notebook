/* dnd.js — drop-target resolution for the file panel, the tree's own
   drag-and-drop (moves + external files), the global navigation guard,
   and the Tauri native file-drop wiring. Copying and link insertion live
   in media_ingest.js; which channel delivers OS files on this platform is
   decided once by drop_transport.js. */
import { S, treeEl, selectedItems } from './state.js';
import { updateMultiSelectHighlight } from './tree.js';
import { copyIntoFolder, ingestMediaAt, filesToSources, pathsToSources, docPosAtClient } from './media_ingest.js';
import { fileDropTransport, isOsFileDrop } from './drop_transport.js';
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

  function clearDropHighlights() {
    treeEl.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    treeEl.classList.remove('drop-target-root');
  }

export function initDnd() {
  /* One channel copies OS files on this platform; see drop_transport.js. */
  const transport = fileDropTransport();

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
    clearDropHighlights();
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
    clearDropHighlights();
  });

  treeEl.addEventListener('drop', async (e) => {
    e.preventDefault();

    const targetDir = getDropTargetDir(e.target);
    clearDropHighlights();

    /* ── Internal move (items dragged within the tree) ── */
    if (S._dragItems.length) {
      /* Copy S._dragItems before dragend clears it (spec says drop fires
         before dragend, but we copy defensively).                     */
      const itemsToMove = [...S._dragItems];
      S._dragItems = [];
      await moveNodes(itemsToMove, targetDir);
      return;
    }

    /* ── External OS files ── On the 'native' transport the wrapper's own
       event delivers this very drop with source paths (below); the DOM
       event is only prevented so the webview cannot navigate. */
    if (isOsFileDrop(e.dataTransfer) && transport === 'dom') {
      await copyIntoFolder(filesToSources(e.dataTransfer.files), targetDir);
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
      /* Plain text inputs keep native text drag-and-drop; an OS file
         dropped anywhere — inputs included — must never navigate. */
      if (t && t.closest && t.closest('input, textarea') && !isOsFileDrop(e.dataTransfer)) return;
      e.preventDefault();
    });
  })();

/* ── Tauri: native OS file-drop ─────────────────────────────────────────
     Live only on the 'native' transport (Linux/macOS: WebKitGTK cannot
     deliver dropped File bytes via HTML5 DnD). Tauri's event gives
     absolute source paths plus a physical cursor position; we hit-test
     the position to find the hovered folder — or the editor — and copy by
     path. On Windows the config disables this event (tauri.windows.conf.json)
     and the DOM path above handles the same drops. */
  (function installNativeFileDrop() {
    if (transport !== 'native' || !window.NativeAPI || window.NativeAPI.env !== 'tauri') return;

    const toClient = (pos) => {
      const dpr = window.devicePixelRatio || 1;
      return { x: pos.x / dpr, y: pos.y / dpr };
    };

    /* Physical cursor pos → { el, dir } if it lands inside the tree, else null. */
    const pointToTarget = (pos) => {
      if (!pos) return null;
      const { x, y } = toClient(pos);
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest || !el.closest('#sidebar-tree')) return null;
      return { el, dir: getDropTargetDir(el) };
    };

    window.NativeAPI.onNativeFileDrop({
      onOver: (pos) => {
        clearDropHighlights();
        const hit = pointToTarget(pos);
        if (!hit) return;
        const targetEl = getDropTargetEl(hit.el);
        if (targetEl) targetEl.classList.add('drop-target');
        else if (hit.dir === S.rootPath) treeEl.classList.add('drop-target-root');
      },
      onLeave: clearDropHighlights,
      onDrop: (pos, paths) => {
        clearDropHighlights();
        if (!paths || !paths.length || !pos) return;
        const hit = pointToTarget(pos);
        if (hit) {
          copyIntoFolder(pathsToSources(paths), hit.dir);
          return;
        }
        /* Not the tree — media dropped onto the EDITOR copies into the
           project and inserts a link at the drop point (media_ingest.js). */
        const { x, y } = toClient(pos);
        const el = document.elementFromPoint(x, y);
        if (el && el.closest && el.closest('#editor')) {
          ingestMediaAt(pathsToSources(paths), docPosAtClient(x, y));
        }
      },
    }).catch(() => { /* listener registration failed — drop simply won't work */ });
  })();
}

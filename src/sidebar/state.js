/* state.js — DOM references and cross-module sidebar state.
   Everything mutable that more than one module assigns lives on the S
   object; module-private state stays in its owning module. Collections
   that are only ever mutated in place (never reassigned) are plain
   exported consts. */

/* ── DOM refs ────────────────────────────────────────────────────── */
  const btnSidebar     = document.getElementById('btn-sidebar');
  const sidebarPanel   = document.getElementById('project-sidebar');
  const sidebarDivider = document.getElementById('sidebar-divider');
  const folderNameEl   = document.getElementById('sidebar-folder-name');
  const btnProjectsBtn = document.getElementById('sidebar-projects-btn');
  const btnOpenFolder  = document.getElementById('sidebar-open-folder');
  const btnNewFile     = document.getElementById('sidebar-new-file');
  const btnNewFolder   = document.getElementById('sidebar-new-folder');
  const btnToggleAll   = document.getElementById('sidebar-toggle-all');
  const btnSortBtn     = document.getElementById('sidebar-sort-btn');
  const btnViewBtn     = document.getElementById('sidebar-view-btn');
  const treeEl         = document.getElementById('sidebar-tree');
  const docTitleEl     = document.getElementById('doc-title');
export const btnSidebarMobile = document.getElementById('btn-sidebar-mobile');

export {
  btnSidebar, sidebarPanel, sidebarDivider, folderNameEl, btnProjectsBtn,
  btnOpenFolder, btnNewFile, btnNewFolder, btnToggleAll, btnSortBtn,
  btnViewBtn, treeEl, docTitleEl,
};

/* ── Shared mutable state ────────────────────────────────────────── */
export const S = {
  sidebarOpen:      false,
  rootPath:         null,    // Currently open root folder
  activeFilePath:   null,    // File open in the editor
  selectedDirPath:  null,    // Last folder clicked in the tree (for new file/folder)
  isDirty:          false,   // True when editor differs from saved file
  _scratchpadVolatileKey: null,  // string | null — current placeholder path
  /* sidebarViewMode : 'tree' | 'card'  (persisted to localStorage) */
  sidebarViewMode:  'tree',
  cardViewDir:      null,
  /* Media file shown in the preview while no note is open (fileops.js
     openMediaFile). Display + naming only: the tree highlights it, and
     the scratchpad auto-create (save.js) names the new note after it and
     places it beside it (pendingNoteDir). Cleared whenever the editor
     moves on to a file, a folder switch, or the scratchpad creates the
     note. */
  previewMediaPath: null,
  selectionAnchor:  null,      // Last non-shift clicked path (range anchor)
  _dragItems:       [],        // [{path, type}] currently being dragged
  /* Serialize async FS operations — prevents simultaneous move/rename/delete
     from corrupting state if the user clicks very quickly. */
  _operationLock:   false,
  /* Watcher suppression: after we write ourselves we ignore the next
     watcher event for this many ms to avoid a false "external change" dialog */
  _suppressWatchUntil: 0,
  _externalChangeInProgress: false,
  _replaceGeneration: 0,
  _conflictHoldPath: null,
};

try {
  const vm = localStorage.getItem('revery_sidebar_view');
  if (vm === 'card' || vm === 'tree') S.sidebarViewMode = vm;
} catch { /* ignore */ }

/* ── Cross-module collections (mutated in place, never reassigned) ── */
export const expandedDirs  = new Set();
export const selectedItems = new Set(); // Set<path> of all multi-selected items
export const _previewCache = new Map(); // Map<filePath, previewText>

export const SUPPRESS_MS = 2000;

export const SCRATCHPAD_PREFIX = '__revery_scratchpad__/';

export function ensureScratchpadVolatileKey() {
    if (S._scratchpadVolatileKey) return S._scratchpadVolatileKey;
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)))
                     .map(b => b.toString(16).padStart(2, '0')).join('');
    S._scratchpadVolatileKey = SCRATCHPAD_PREFIX + rnd;
    return S._scratchpadVolatileKey;
  }

/* ── Where new content goes and what relative links resolve against ──
   ONE definition, shared by link building (helpers.mediaMarkdown), media
   ingest, the scratchpad auto-create (save.js), link-path completion,
   and — through window.sidebarGetLinkBaseDir — the preview's and the
   LaTeX export's image resolution:
     • the active note's folder;
     • else, while an image is previewed, that image's folder (the note the
       first keystroke creates is placed beside the image);
     • else the folder a first keystroke would create the note in: the
       selected folder, then the project root.
   Null when no project is open. Returned in the path's OWN spelling
   (separators untouched) so it compares equal to tree entries and
   expandedDirs keys; every consumer normalises through paths.js before
   doing path math. */
export function pendingNoteDir() {
  if (S.activeFilePath) return parentDir(S.activeFilePath);
  if (S.previewMediaPath) return parentDir(S.previewMediaPath) || S.rootPath || null;
  return S.selectedDirPath || S.rootPath || null;
}

function parentDir(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return '';
  return i === 0 ? p[0] : p.slice(0, i);
}

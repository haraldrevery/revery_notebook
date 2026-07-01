/**
 * project_sidebar.js — Revery Notebook Project File Sidebar
 * v2 — Obsidian/Logseq-style file management
 *
 * Key behaviours:
 *  • Auto-saves to disk (debounced, 1.5 s) — no "export first" dialogs
 *  • Suppresses the external-change watcher during own saves
 *  • Dirty indicator: • in window title + border on doc-title input
 *  • Default notes folder seeded on first launch (~/Documents/revery_notebook_notes)
 *  • New file / folder buttons target the currently selected dir, else root
 *  • Import: auto-saves first, copies file into the active folder, opens it
 *  • Ctrl+S → save (actions.js defers here when a desktop file is open)
 *  • Window-close interception with graceful save-or-discard prompt
 *
 * Exposes on window:
 *   window.sidebarSaveActiveFile()   → Promise<boolean>
 *   window.sidebarGetActiveFilePath()→ string | null
 *   window.sidebarCreateNewFile()    → void   (called by actions.js newFile)
 *   window.sidebarImportFile()       → void   (called by actions.js importFile)
 */

(function () {
  'use strict';

/* ── Guard: desktop only ─────────────────────────────────────────── */
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) {
    const btn = document.getElementById('btn-sidebar');
    if (btn) btn.style.display = 'none';
    const btnMobile = document.getElementById('btn-sidebar-mobile');
    if (btnMobile) btnMobile.style.display = 'none';
    return;
  }

  /* ── In-app input dialog (replaces prompt() which is blocked in
        sandboxed Electron renderers and inconsistent across platforms) ── */
  (function injectInputDialogStyles() {
    if (document.getElementById('revery-input-dialog-styles')) return;




  const style = document.createElement('style');
  style.id = 'revery-input-dialog-styles';
  style.textContent = `
    .revery-input-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center;
    }
    .revery-input-box {
      background: var(--bg-panel, #1e1e1e);
      border: 1px solid var(--border, #444);
      border-radius: 8px;
      padding: 20px 24px 16px;
      min-width: 300px; max-width: 420px; width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      display: flex; flex-direction: column; gap: 12px;
    }
    .revery-input-box p {
      margin: 0;
      font-size: 0.9rem;
      color: var(--text, #ccc);
      user-select: none;
    }
    .revery-input-field {
      width: 100%; box-sizing: border-box;
      padding: 7px 10px;
      background: var(--bg-panel, #1e1e1e);
      border: 1px solid var(--border, #555);
      border-radius: 5px;
      color: var(--text, #eee);
      font-size: 0.95rem;
      outline: none;
    }
    .revery-input-field:focus { border-color: var(--accent, #7a8ee0); }
    .revery-input-buttons {
      display: flex; justify-content: flex-end; gap: 8px;
    }
    .revery-input-buttons button {
      padding: 6px 16px; border-radius: 5px; border: none;
      font-size: 0.875rem; cursor: pointer;
    }
    .revery-input-cancel {
      background: var(--bg-hover, #2a2a2a);
      color: var(--text, #ccc);
      border: 1px solid var(--border, #555) !important;
    }
    .revery-input-cancel:hover { background: var(--bg-hover, #3a3a3a); }
    .revery-input-ok {
      background: var(--accent, #4a5fc1);
      color: #fff;
    }
    .revery-input-ok:hover { opacity: 0.88; }




      
      /* ── Unsupported file type — orange warning colour ── */
      .sidebar-item.sidebar-unsupported .sidebar-name {
        color: #d97706;
      }
      /* ── Media file type ── */
      .sidebar-item.sidebar-media .sidebar-name {
        color: var(--text, inherit);
      }
      .sidebar-item.sidebar-media-active {
        background: rgba(74,95,193,0.15);
        border-radius: 4px;
      }

      /* ── Multi-select ── */
      .sidebar-item.multi-selected {
        background: rgba(74,95,193,0.28);
        border-radius: 4px;
      }
      /* Prevent child text/icons from stealing the drag target */
      .sidebar-item {
        user-select: none;
        -webkit-user-select: none;
      }
      .sidebar-icon, .sidebar-name {
        pointer-events: none;
      }
      /* ── Drag source ── */
      .sidebar-item.drag-source-active {
        opacity: 0.42;
      }
      /* ── Drop target ── */
      .sidebar-item.drop-target {
        outline: 2px solid var(--accent, #4a5fc1);
        outline-offset: -2px;
        background: rgba(74,95,193,0.2) !important;
        border-radius: 4px;
      }
      /* Drop onto the tree root (empty space) */
      #sidebar-tree.drop-target-root {
        outline: 2px solid var(--accent, #4a5fc1);
        outline-offset: -2px;
        border-radius: 4px;
      }

      /* ── Sort dropdown menu ── */
      .sidebar-sort-menu {
        position: fixed;
        z-index: 10001;
        background: var(--bg-panel, #1e1e1e);
        border: 1px solid var(--border, #444);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.45);
        padding: 4px;
        min-width: 190px;
      }
      .sidebar-sort-item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 6px 10px;
        background: none; border: none; border-radius: 4px;
        color: var(--text, #ccc); font-size: 0.82rem;
        cursor: pointer; text-align: left; white-space: nowrap;
        box-sizing: border-box;
      }
      .sidebar-sort-item:hover { background: var(--bg-hover, #2e2e2e); }
      .sidebar-sort-item.sort-active { color: var(--accent, #7a8ee0); font-weight: 400; }
      .sidebar-sort-check { width: 14px; flex-shrink: 0; text-align: center; font-size: 0.75rem; }
      .sidebar-sort-sep {
        height: 1px; background: var(--border, #3a3a3a);
        margin: 4px 6px;
      }
      .sidebar-sort-group {
        padding: 4px 10px 2px;
        font-size: 0.72rem; color: var(--text-muted, #666);
        user-select: none;
      }

      /* ── Project switcher dropdown ── */
      .revery-projects-menu {
        position: fixed;
        z-index: 10002;
        background: var(--bg-panel, #1e1e1e);
        border: 1px solid var(--border, #444);
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.5);
        padding: 4px;
        min-width: 280px;
        max-width: 380px;
        max-height: 70vh;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--border, #555) transparent;
        font-family: var(--font-mono)
      }
      .revery-projects-header {
        padding: 6px 10px 4px;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted, #666);
        user-select: none;
      }
      .revery-projects-item {
        display: flex; flex-direction: column;
        width: 100%; padding: 7px 10px;
        background: none; border: none; border-radius: 5px;
        color: var(--text, #ccc); cursor: pointer;
        text-align: left; box-sizing: border-box;
      }
      .revery-projects-item:hover { background: var(--bg-hover, #2a2a2a); }
      .revery-projects-item.revery-projects-active .revery-projects-item-name {
        color: var(--accent, #7a8ee0);
      }
      .revery-projects-item-name {
        font-size: 0.85rem; font-weight: 400;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .revery-projects-item-path {
        font-size: 0.72rem; opacity: 0.5;
        font-family: var(--font-mono, monospace);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        margin-top: 1px;
      }
      .revery-projects-empty {
        padding: 12px 10px;
        font-size: 0.82rem; color: var(--text-muted, #666);
        font-style: italic;
      }
      .revery-projects-sep {
        height: 1px; background: var(--border, #3a3a3a); margin: 4px 6px;
      }
      .revery-projects-action {
        display: flex; align-items: center; gap: 6px;
        width: 100%; padding: 7px 10px;
        background: none; border: none; border-radius: 5px;
        color: var(--text, #ccc); font-size: 0.82rem;
        cursor: pointer; text-align: left; box-sizing: border-box;
      }
      .revery-projects-action:hover { background: var(--bg-hover, #2a2a2a); }

      /* ── Manage projects modal list ── */
      .revery-manage-row {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 8px; border-radius: 5px;
        background: var(--bg-hover, rgba(128,128,128,0.07));
        margin-bottom: 3px;
      }
      .revery-manage-text { flex: 1; min-width: 0; }
      .revery-manage-name {
        font-size: 0.87rem; font-weight: 400;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .revery-manage-path {
        font-size: 0.72rem; opacity: 0.55;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-family: var(--font-mono, monospace);
        margin-top: 1px;
      }

      /* ══════════════════════════════════════════════════════════════
         CARD VIEW
      ══════════════════════════════════════════════════════════════ */

      /* Card grid container (replaces normal tree list when active) */
      .sidebar-card-view {
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      /* Breadcrumb / back bar */
      .sidebar-card-nav {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 2px 6px;
        flex-shrink: 0;
      }
      .sidebar-card-back {
        background: none; border: none; cursor: pointer;
        color: var(--text, #ccc); opacity: 0.65;
        font-size: 0.85rem; padding: 2px 5px; border-radius: 4px;
        line-height: 1;
        flex-shrink: 0;
      }
      .sidebar-card-back:hover { opacity: 1; background: var(--hover-bg, rgba(128,128,128,0.12)); }
      .sidebar-card-crumb {
        font-size: 0.72rem;
        font-family: var(--font-mono, monospace);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, var(--text));
        opacity: 0.7;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Grid of cards */
      .sidebar-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        gap: 6px;
        padding: 0 6px; /* Adds 6px padding to the left and right edges */
      }

      /* Individual card — portrait 3:4 ratio */
      .sidebar-card {
        aspect-ratio: 3 / 4;
        display: flex;
        flex-direction: column;
        border-radius: 2px;
        border: 1px solid var(--border, rgba(128,128,128,0.2));
        background: var(--bg-panel, rgba(255,255,255,0.03));
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
        position: relative;
        user-select: none;
        -webkit-user-select: none;
      }
      .sidebar-card:hover {
        border-color: var(--accent, #4a5fc1);
        background: var(--bg-hover, rgba(128,128,128,0.08));
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
      .sidebar-card.sidebar-card-active {
        border-color: var(--accent, #4a5fc1);
        background: rgba(74, 95, 193, 0.12);
      }
      .sidebar-card.sidebar-card-selected {
        outline: 2px solid var(--accent, #4a5fc1);
        outline-offset: -2px;
        background: rgba(74, 95, 193, 0.18);
      }
      .sidebar-card.drop-target {
        outline: 2px solid var(--accent, #4a5fc1);
        outline-offset: -2px;
        background: rgba(74,95,193,0.3) !important;
      }
/* Card types */
      .sidebar-card-dir   { background: rgba(128,128,128,0.08); }
      .sidebar-card-media { background: var(--bg-panel, rgba(0,0,0,0.15)); }
      .sidebar-card-other { background: rgba(128,128,128,0.05); }
      .sidebar-card-text  { background: var(--bg-panel, rgba(255,255,255,0.03)); }

      /* Top section: icon or thumbnail */
      .sidebar-card-thumb {
        flex: 0 0 58%;
        display: flex; align-items: center; justify-content: center;
        font-size: 1.6rem;
        background: rgba(0,0,0,0.08);
        overflow: hidden;
        position: relative;
        font-family: var(--font-mono); 
      }
      .sidebar-card-text .sidebar-card-thumb {
        display: none;
      }
      .sidebar-card-thumb img {
        width: 100%; height: 100%;
        object-fit: cover;
        display: block;
      }
      /* Folder card: subtle gradient background */
      .sidebar-card-dir .sidebar-card-thumb {
        background: rgba(128,128,128,0.12);
        font-size: 1.8rem;
        opacity: 0.75;
      }

      /* Bottom section: title + preview */
      .sidebar-card-body {
        flex: 1;
        padding: 4px 5px 3px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        overflow: hidden;
      }
      .sidebar-card-text .sidebar-card-body {
        padding: 10px 8px; /* More breathing room */
        gap: 6px;
      }
      .sidebar-card-title {
        font-size: 0.68rem;
        font-weight: 400;
        line-height: 1.2;
        color: var(--text, #eee);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sidebar-card-text .sidebar-card-title {
        font-size: 0.8rem;       /* Larger text */
        font-weight: 400;        /* No bold */
        white-space: normal;     /* Allow wrapping */
        display: -webkit-box;
        -webkit-line-clamp: 3;   /* Allow up to 3 lines so it isn't cut off */
        -webkit-box-orient: vertical;
        margin-bottom: 4px;      /* Separation from preview */
        flex-shrink: 0;          /* Guarantee it doesn't get squished */
      }
      .sidebar-card-preview {
        font-size: 0.6rem;
        line-height: 1.3;
        color: var(--text-muted, var(--text));
        opacity: 0.55;
        overflow: hidden;
        /* Clamp to 3 lines */
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
      }
      .sidebar-card-text .sidebar-card-preview {
        font-size: 0.65rem;
        -webkit-line-clamp: 10;  /* Let the preview fill the rest of the card */
      }
    `;
    document.head.appendChild(style);
  })();

  /**
   * showInputDialog(promptText, defaultValue?)
   * Returns a Promise<string|null> — null means the user cancelled.
   * Works in sandboxed Electron, Tauri, and web — unlike prompt().
   */
  function showInputDialog(promptText, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'revery-input-overlay';

      const box = document.createElement('div');
      box.className = 'revery-input-box';

      const label = document.createElement('p');
      label.textContent = promptText;

      const input = document.createElement('input');
      input.type        = 'text';
      input.value       = defaultValue;
      input.className   = 'revery-input-field';
      input.spellcheck  = false;

      const btnRow = document.createElement('div');
      btnRow.className = 'revery-input-buttons';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className   = 'revery-input-cancel';

      const okBtn = document.createElement('button');
      okBtn.textContent = 'OK';
      okBtn.className   = 'revery-input-ok';

      function finish(value) {
        if (!document.body.contains(overlay)) return;
        document.body.removeChild(overlay);
        resolve(value);
      }

      cancelBtn.addEventListener('click',  () => finish(null));
      okBtn.addEventListener('click',      () => finish(input.value.trim() || null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); finish(input.value.trim() || null); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      });

      btnRow.append(cancelBtn, okBtn);
      box.append(label, input, btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

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

/* ── State ───────────────────────────────────────────────────────── */
  let sidebarOpen      = false;
  let rootPath         = null;    // Currently open root folder
  let activeFilePath   = null;    // File open in the editor
  let selectedDirPath  = null;    // Last folder clicked in the tree (for new file/folder)
  let expandedDirs     = new Set();
  let isDirty          = false;   // True when editor differs from saved file
  let _autoCreatingFile = false;  // Guard to prevent duplicate file creation during rapid typing


  let _scratchpadVolatileKey = null;  // string | null — current placeholder path

  const SCRATCHPAD_PREFIX = '__revery_scratchpad__/';

  function ensureScratchpadVolatileKey() {
    if (_scratchpadVolatileKey) return _scratchpadVolatileKey;
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)))
                     .map(b => b.toString(16).padStart(2, '0')).join('');
    _scratchpadVolatileKey = SCRATCHPAD_PREFIX + rnd;
    return _scratchpadVolatileKey;
  }
  /* ── Sort state ──────────────────────────────────────────────────────
     Persisted to localStorage so the user's preference survives restarts.
     sortKey: 'name' | 'modified' | 'created'
     sortDir: 'asc'  | 'desc'                                           */
  let sortKey = 'name';
  let sortDir = 'asc';
  try {
    const saved = JSON.parse(localStorage.getItem('revery_sidebar_sort') || 'null');
    if (saved && ['name','modified','created'].includes(saved.key)) sortKey = saved.key;
    if (saved && ['asc','desc'].includes(saved.dir))                sortDir = saved.dir;
  } catch { /* ignore corrupt prefs */ }

  function saveSortPref() {
    try { localStorage.setItem('revery_sidebar_sort', JSON.stringify({ key: sortKey, dir: sortDir })); } catch { /* ignore */ }
  }

  /* ── Card view state ─────────────────────────────────────────────────
     sidebarViewMode : 'tree' | 'card'  (persisted to localStorage)
     cardViewDir     : absolute path of the folder currently shown in
                       card view.  Starts at rootPath, changes when the
                       user navigates into a sub-folder card.
     _previewCache   : Map<filePath, previewText> — in-memory only,
                       cleared when the user enters a new folder.
     _cardGeneration : incremented every time we start a new card render;
                       async preview loaders check this to abort if stale.  */
  let sidebarViewMode = 'tree';
  try {
    const vm = localStorage.getItem('revery_sidebar_view');
    if (vm === 'card' || vm === 'tree') sidebarViewMode = vm;
  } catch { /* ignore */ }

  let cardViewDir     = null;
  const _previewCache = new Map();
  let   _cardGeneration = 0;
  let   _treeRenderGeneration = 0;   // ← NEW: cancels stale chunked renders

  /* ── Card size steps (px) — persisted to localStorage ─────────────────
     cardSizeIdx indexes into CARD_SIZE_STEPS.  Buttons clamp to [0, max]. */
  const CARD_SIZE_STEPS = [60, 80, 110, 145, 185];
  let cardSizeIdx = 1; // default: 80 px
  try {
    const _savedIdx = parseInt(localStorage.getItem('revery_card_size_idx'), 10);
    if (!isNaN(_savedIdx) && _savedIdx >= 0 && _savedIdx < CARD_SIZE_STEPS.length) {
      cardSizeIdx = _savedIdx;
    }
  } catch { /* ignore corrupt prefs */ }

  /** Apply the current cardSizeIdx to the live card grid (if present). */
  function applyCardSize() {
    const grid = treeEl.querySelector('.sidebar-cards-grid');
    if (grid) {
      grid.style.gridTemplateColumns =
        `repeat(auto-fill, minmax(${CARD_SIZE_STEPS[cardSizeIdx]}px, 1fr))`;
    }
    /* Keep button enabled/disabled state in sync */
    const btnSmaller = document.getElementById('sidebar-card-smaller');
    const btnLarger  = document.getElementById('sidebar-card-larger');
    if (btnSmaller) btnSmaller.disabled = (cardSizeIdx === 0);
    if (btnLarger)  btnLarger.disabled  = (cardSizeIdx === CARD_SIZE_STEPS.length - 1);
  }


  /* ══════════════════════════════════════════════════════════════════
     CARD VIEW
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Strip the most distracting markdown syntax so card previews look
   * like readable prose rather than raw markup.  Light-touch only —
   * no full parser needed here.
   */
  function stripMarkdownForPreview(raw) {
    return raw
      .replace(/^---[\s\S]*?---\n?/m, '')      // strip YAML frontmatter
      .replace(/^#{1,6}\s+/gm, '')             // strip ATX heading markers
      .replace(/!\[.*?\]\(.*?\)/g, '')         // strip images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → link text
      .replace(/`{1,3}[^`]*`{1,3}/g, '')       // inline code
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // bold/italic
      .replace(/^\s*[-*+]\s+/gm, '')           // list bullets
      .replace(/^\s*\d+\.\s+/gm, '')           // numbered lists
      .replace(/\n{2,}/g, ' ')                 // collapse blank lines
      .replace(/\s+/g, ' ')                    // collapse whitespace
      .trim();
  }

  /**
   * Asynchronously load a file preview and update the card DOM element.
   * Safe: read-only, errors are silently ignored, and a generation check
   * prevents stale loads from updating the DOM after a view switch.
   */
  async function loadCardPreview(filePath, previewEl, generation) {
    /* Return from cache if available */
    if (_previewCache.has(filePath)) {
      if (_cardGeneration !== generation) return; // stale
      previewEl.textContent = _previewCache.get(filePath);
      return;
    }

    let content;
    try {
      content = await window.NativeAPI.readFile(filePath);
    } catch {
      return; // file unreadable — leave preview blank
    }

    if (_cardGeneration !== generation) return; // view switched while we were reading

    const preview = stripMarkdownForPreview(content).substring(0, 440);
    _previewCache.set(filePath, preview);

    if (_cardGeneration !== generation) return; // double-check after sync work
    previewEl.textContent = preview;
  }

  /**
   * Build and inject a single card element into `gridEl`.
   * Returns the card element.
   */
  function buildCard(entry, generation) {
    const category = entry.type === 'dir' ? 'dir' : getFileCategory(entry.name);
    const isActive = (entry.path === activeFilePath);
    const isMediaPrev = (_mediaPreviewMode && _mediaPreviewMode.mediaPath === entry.path);

    const card = document.createElement('div');
    card.className   = 'sidebar-card';
    card.dataset.path = entry.path;
    card.dataset.type = entry.type;
    if (entry.type === 'dir')         card.classList.add('sidebar-card-dir');
    else if (category === 'media')    card.classList.add('sidebar-card-media');
    else if (category === 'other')    card.classList.add('sidebar-card-other');
    else if (category === 'text')     card.classList.add('sidebar-card-text');
    if (isActive || isMediaPrev)      card.classList.add('sidebar-card-active');

    /* ── Thumbnail area ── */
    const thumb = document.createElement('div');
    thumb.className = 'sidebar-card-thumb';

    if (entry.type === 'dir') {
      thumb.textContent = '📁';

    } else if (category === 'media') {
      /* Try to show the actual image */
      const img = document.createElement('img');
      img.alt   = entry.name;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      /* toMediaUrl is synchronous — no await needed */
      try {
        img.src = window.NativeAPI.toMediaUrl(entry.path);
      } catch {
        thumb.textContent = '🖼️';
      }
      /* Fall back to emoji if image fails to load */
      img.onerror = () => { thumb.innerHTML = ''; thumb.textContent = '🖼️'; };
      thumb.appendChild(img);

    } else if (category === 'text') {
      thumb.textContent = entry.name.endsWith('.md') ? '📄' : '📝';

    } else {
      /* Unsupported */
      thumb.style.cssText += 'opacity:0.4;';
      thumb.textContent = '?';
    }

    /* ── Body: title + preview ── */
    const body = document.createElement('div');
    body.className = 'sidebar-card-body';

    const titleEl = document.createElement('div');
    titleEl.className   = 'sidebar-card-title';
    /* Strip extension for text files */
    titleEl.textContent = (category === 'text')
      ? entry.name.replace(/\.(md|txt)$/i, '')
      : entry.name;
    titleEl.title = entry.name;

    const previewEl = document.createElement('div');
    previewEl.className = 'sidebar-card-preview';

    if (category === 'text') {
      /* Fire-and-forget preview load — card shows immediately */
      loadCardPreview(entry.path, previewEl, generation);
    } else if (entry.type === 'dir') {
      previewEl.textContent = 'Folder';
      previewEl.style.fontStyle = 'italic';
    }

    body.append(titleEl, previewEl);
    card.append(thumb, body);

/* ── Click handler ── */
    card.addEventListener('click', (e) => {
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (e.ctrlKey || e.metaKey) {
          if (selectedItems.has(entry.path)) selectedItems.delete(entry.path);
          else { selectedItems.add(entry.path); selectionAnchor = entry.path; }
        } else if (e.shiftKey && selectionAnchor) {
          const allPaths = Array.from(treeEl.querySelectorAll('.sidebar-card')).map(el => el.dataset.path);
          const ai = allPaths.indexOf(selectionAnchor);
          const bi = allPaths.indexOf(entry.path);
          if (ai !== -1 && bi !== -1) {
            const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
            selectedItems.clear();
            for (let i = lo; i <= hi; i++) selectedItems.add(allPaths[i]);
          } else {
            selectedItems.add(entry.path);
          }
        }
        updateMultiSelectHighlight();
        if (entry.type === 'dir') selectedDirPath = entry.path;
        return;
      }

      if (selectedItems.size > 0) {
        selectedItems.clear();
        updateMultiSelectHighlight();
      }
      selectionAnchor = entry.path;

      if (entry.type === 'dir') {
        /* Navigate into the folder */
        cardViewDir = entry.path;
        _previewCache.clear();
        selectedDirPath = entry.path;
        renderCards(entry.path);
      } else if (category === 'text') {
        openFile(entry.path);
      } else if (category === 'media') {
        openMediaFile(entry.path);
      } else {
        openUnsupportedFile(entry.path);
      }
    });

    /* ── Context menu ── */
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, entry.path, entry.type);
    });

    /* ── Drag-and-drop for cards ── */
    card.draggable = true;

    card.addEventListener('dragstart', (e) => {
      if (!selectedItems.has(entry.path)) {
        selectedItems.clear();
        selectedItems.add(entry.path);
        selectionAnchor = entry.path;
        updateMultiSelectHighlight();
      }
      _dragItems = Array.from(treeEl.querySelectorAll('.sidebar-card'))
        .filter(el => selectedItems.has(el.dataset.path))
        .map(el => ({ path: el.dataset.path, type: el.dataset.type }));

      e.dataTransfer.effectAllowed = category === 'media' ? 'copyMove' : 'move';
      const dragText = category === 'media' ? mediaMarkdown(entry.path) : '';
      e.dataTransfer.setData('text/plain', dragText);

      requestAnimationFrame(() => {
        treeEl.querySelectorAll('.sidebar-card').forEach(el => {
          el.classList.toggle('drag-source-active', selectedItems.has(el.dataset.path));
        });
      });
    });

    card.addEventListener('dragend', () => {
      treeEl.querySelectorAll('.drag-source-active, .drop-target').forEach(el => {
        el.classList.remove('drag-source-active', 'drop-target');
      });
      treeEl.classList.remove('drop-target-root');
      _dragItems = [];
    });

    return card;
  }
  
  /**
   * Render the card grid for `dirPath`.
   * Replaces the tree content entirely — the tree is rebuilt when the
   * user switches back to tree view.
   */
  async function renderCards(dirPath) {
    if (!dirPath) return;

    /* Bump generation so any in-flight preview loads for a previous render
       will notice they are stale and stop updating the DOM.              */
    const generation = ++_cardGeneration;

    treeEl.innerHTML = '';
    treeEl.classList.add('sidebar-card-view');

    /* ── Navigation bar ── */
    const navEl = document.createElement('div');
    navEl.className = 'sidebar-card-nav';

    const normDir  = dirPath.replace(/\\/g, '/');
    const normRoot = (rootPath || '').replace(/\\/g, '/');
    const isAtRoot = (normDir === normRoot);

    if (!isAtRoot) {
      const backBtn = document.createElement('button');
      backBtn.className   = 'sidebar-card-back';
      backBtn.textContent = '← Back';
      backBtn.title       = 'Go up one level';
      backBtn.addEventListener('click', () => {
        const parts = normDir.split('/');
        parts.pop();
        const parent = parts.join('/');
        cardViewDir = parent;
        selectedDirPath = parent;
        _previewCache.clear();
        renderCards(parent);
      });
      navEl.appendChild(backBtn);
    }

    const crumbEl = document.createElement('span');
    crumbEl.className   = 'sidebar-card-crumb';
    crumbEl.textContent = normDir.split('/').pop() || normDir;
    crumbEl.title       = dirPath;
    navEl.appendChild(crumbEl);

    treeEl.appendChild(navEl);

    /* ── Loading indicator ── */
    const loadingEl = document.createElement('div');
    loadingEl.className   = 'sidebar-loading';
    loadingEl.textContent = 'Loading…';
    treeEl.appendChild(loadingEl);

    /* ── Fetch directory ── */
    let entries;
    try {
      entries = await window.NativeAPI.readDirectory(dirPath);
    } catch (err) {
      console.warn('[Sidebar] renderCards readDirectory failed:', dirPath, err);
      if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);
      return;
    }

    /* Bail if a newer render started while we were waiting */
    if (_cardGeneration !== generation) return;

    if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);

    entries = sortEntries(entries).filter(e => !e.name.startsWith('.'));

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'sidebar-loading';
      empty.textContent = 'Empty folder';
      treeEl.appendChild(empty);
      return;
    }

    const gridEl = document.createElement('div');
    gridEl.className = 'sidebar-cards-grid';

    for (const entry of entries) {
      gridEl.appendChild(buildCard(entry, generation));
    }

treeEl.appendChild(gridEl);
    /* Apply the user's saved card size to the freshly-built grid */
    applyCardSize();
    /* Highlight active file */
    highlightActiveFileCards(activeFilePath);
    updateMultiSelectHighlight();
  }

  /** Highlight the active file card (called after openFile etc.) */
  function highlightActiveFileCards(filePath) {
    treeEl.querySelectorAll('.sidebar-card').forEach(card => {
      card.classList.toggle('sidebar-card-active', card.dataset.path === filePath);
    });
  }

  /* ── View mode toggle ─────────────────────────────────────────── */

  function updateViewBtn() {
    if (!btnViewBtn) return;
    const isCard = (sidebarViewMode === 'card');
    if (btnToggleAll) btnToggleAll.style.display = isCard ? 'none' : '';
    if (btnSortBtn)   btnSortBtn.style.display   = isCard ? 'none' : '';
    const btnSmaller = document.getElementById('sidebar-card-smaller');
    const btnLarger  = document.getElementById('sidebar-card-larger');
    if (btnSmaller) btnSmaller.style.display = isCard ? '' : 'none';
    if (btnLarger)  btnLarger.style.display  = isCard ? '' : 'none';
    if (isCard) {
    btnViewBtn.textContent = '🗃';
    btnViewBtn.title = window.t('Switch to list view');
  } else {
    btnViewBtn.textContent = '🧾';
    btnViewBtn.title = window.t('Switch to card view');
  }
}
  async function setViewMode(mode) {
    sidebarViewMode = mode;
    try { localStorage.setItem('revery_sidebar_view', mode); } catch { /* ignore */ }
    updateViewBtn();

    /* Toggle-all and sort are tree-only controls */
    const isCard = (mode === 'card');
    if (btnToggleAll) btnToggleAll.style.display = isCard ? 'none' : '';
    if (btnSortBtn)   btnSortBtn.style.display   = isCard ? 'none' : '';
    const _btnSmaller = document.getElementById('sidebar-card-smaller');
    const _btnLarger  = document.getElementById('sidebar-card-larger');
    if (_btnSmaller) _btnSmaller.style.display = isCard ? '' : 'none';
    if (_btnLarger)  _btnLarger.style.display  = isCard ? '' : 'none';

    if (mode === 'card') {
      /* Start card view at the current directory, or rootPath */
      cardViewDir = selectedDirPath || rootPath;
      _previewCache.clear();
      _cardGeneration++;
      await renderCards(cardViewDir);
    } else {
      /* Restore tree view */
      treeEl.classList.remove('sidebar-card-view');
      _cardGeneration++; // cancel any pending card preview loads
      await renderTree();
    }
  }

  if (btnViewBtn) {
    btnViewBtn.addEventListener('click', async () => {
      await setViewMode(sidebarViewMode === 'card' ? 'tree' : 'card');
    });
    updateViewBtn();
  }

  /* ── Card size buttons ─────────────────────────────────────────── */
  (function () {
    const btnSmaller = document.getElementById('sidebar-card-smaller');
    const btnLarger  = document.getElementById('sidebar-card-larger');

    if (btnSmaller) {
      btnSmaller.addEventListener('click', () => {
        if (cardSizeIdx > 0) {
          cardSizeIdx--;
          try { localStorage.setItem('revery_card_size_idx', cardSizeIdx); } catch { /* ignore */ }
          applyCardSize();
        }
      });
    }

    if (btnLarger) {
      btnLarger.addEventListener('click', () => {
        if (cardSizeIdx < CARD_SIZE_STEPS.length - 1) {
          cardSizeIdx++;
          try { localStorage.setItem('revery_card_size_idx', cardSizeIdx); } catch { /* ignore */ }
          applyCardSize();
        }
      });
    }
  })();



  async function scanBakOrphansIn(dir) {
    if (!dir) return [];
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      return entries
        .filter(e => e.type === 'file' && /\.revery_bak$/.test(e.name))
        .map(e => e.path);
    } catch (e) {
      console.warn('[Sidebar] Bak orphan scan failed for', dir, e);
      return [];
    }
  }

  async function reportBakOrphans(rootDir, lastFile) {
    /* Scan the project root and (if different) the directory of the
       last-opened file. Both are non-recursive — a project-wide walk
       at startup would block UI for too long on large folders. */
    const dirs = new Set();
    if (rootDir) dirs.add(rootDir);
    if (lastFile) {
      const lastDir = lastFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      if (lastDir) dirs.add(lastDir);
    }

    const all = [];
    for (const d of dirs) {
      const found = await scanBakOrphansIn(d);
      for (const p of found) if (!all.includes(p)) all.push(p);
    }
    if (all.length === 0) return;

    /* De-duplicate and trim file display to keep the dialog readable. */
    const display = all
      .slice(0, 5)
      .map(p => '• ' + p.replace(/\\/g, '/').split('/').pop())
      .join('\n');
    const overflow = all.length > 5 ? `\n• …and ${all.length - 5} more` : '';

    await window.NativeAPI.showMessageBox({
      type:    'warning',
      title:   'Recovery Backup Files Found',
      message: `${all.length} backup file(s) from a previous interrupted save were found.`,
      detail:
        `These were created during a cross-device save that did not complete. ` +
        `The matching original file may be corrupted.\n\n${display}${overflow}\n\n` +
        `To recover: open the file in Revery and verify it looks correct. ` +
        `If it is corrupted, locate the .revery_bak file in your file manager ` +
        `and rename it to replace the original (drop the ".<timestamp>.revery_bak" suffix).`,
      buttons: ['OK'],
    });
  }







  /* ══════════════════════════════════════════════════════════════════
     PROJECT HISTORY  (recently opened project folders)

     Stored in localStorage under 'revery_projects' as a JSON array
     of { path, name, lastOpened } objects, newest-first, max 20.
     ZERO filesystem operations — only localStorage is ever touched here.
  ══════════════════════════════════════════════════════════════════ */

const PROJECTS_KEY  = 'revery_projects';
  const MAX_PROJECTS  = 20;
  
  let _cachedProjects = null;

  /** Load the saved project list.  Returns [] on any error. */
  function loadProjects() {
    if (_cachedProjects !== null) return _cachedProjects;
    
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(p => p && typeof p.path === 'string' && p.path.length > 0);
    } catch { return []; }
  }

  /** Persist the project list to localStorage (synchronous, for runtime reads)
   * and also to the native settings file (survives WebView storage clears). */
async function saveProjects(arr) {
    _cachedProjects = arr;
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
    if (typeof window.NativeAPI.setProjectHistory === 'function') {
      await window.NativeAPI.setProjectHistory(arr).catch(() => { /* non-critical */ });
    }
  }

  async function recordProjectOpen(folderPath) {
    if (!folderPath) return;
    const normPath = folderPath.replace(/\\/g, '/');
    const name     = normPath.split('/').pop() || normPath;
    let projects   = loadProjects();
    projects = projects.filter(p => p.path.replace(/\\/g, '/') !== normPath);
    projects.unshift({ path: folderPath, name, lastOpened: Date.now() });
    if (projects.length > MAX_PROJECTS) projects = projects.slice(0, MAX_PROJECTS);
    await saveProjects(projects);
  }


  /* ── Project switcher dropdown ──────────────────────────────────── */

  function showProjectsDropdown(anchorEl) {
    /* Toggle off if already open */
    const existing = document.getElementById('revery-projects-menu');
    if (existing) { existing.remove(); return; }

    const projects = loadProjects();
    const menu = document.createElement('div');
    menu.id        = 'revery-projects-menu';
    menu.className = 'revery-projects-menu';

    /* Header label */
    const hdr = document.createElement('div');
    hdr.className   = 'revery-projects-header';
    hdr.textContent = 'Recent Projects';
    menu.appendChild(hdr);

    if (projects.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'revery-projects-empty';
      empty.textContent = 'No recent projects yet';
      menu.appendChild(empty);
    } else {
      projects.forEach(proj => {
        const normProj   = proj.path.replace(/\\/g, '/');
        const normRoot   = (rootPath || '').replace(/\\/g, '/');
        const isActive   = normProj === normRoot;

        const item = document.createElement('button');
        item.className = 'revery-projects-item';
        if (isActive) item.classList.add('revery-projects-active');
        item.title = proj.path;

        const nameEl = document.createElement('span');
        nameEl.className   = 'revery-projects-item-name';
        nameEl.textContent = proj.name + (isActive ? ' ✓' : '');

        const pathEl = document.createElement('span');
        pathEl.className   = 'revery-projects-item-path';
        pathEl.textContent = normProj;

        item.append(nameEl, pathEl);

       item.addEventListener('click', async () => {
          menu.remove();
          if (isActive) return; // Already the current project


          /* Save any unsaved work in the current file */
          if (isDirty && activeFilePath) {
            const saved = await saveActiveFile();
            if (!saved) return; // FIX: Abort the switch to prevent data loss
          }

          /* Clear the editor BEFORE setting the new root to prevent path-escape races */
          activeFilePath = null;
          await window.NativeAPI.clearLastOpenedFile(); // ← prevent stale file on next boot
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
          await openFolder(proj.path);
        });

        menu.appendChild(item);
      });
    }

    /* ── Separator ── */
    const sep = document.createElement('div');
    sep.className = 'revery-projects-sep';
    menu.appendChild(sep);

    /* ── Browse for a new folder ── */
    const browseBtn = document.createElement('button');
    browseBtn.className   = 'revery-projects-action';
    browseBtn.textContent = '📂  Browse for folder…';
    browseBtn.addEventListener('click', () => { menu.remove(); promptOpenFolder(); });
    menu.appendChild(browseBtn);

    /* ── Manage projects ── */
    const manageBtn = document.createElement('button');
    manageBtn.className   = 'revery-projects-action';
    manageBtn.textContent = '⚙  Manage projects…';
    manageBtn.addEventListener('click', () => { menu.remove(); showManageProjectsModal(); });
    menu.appendChild(manageBtn);

    document.body.appendChild(menu);

    /* Position: open below the anchor, aligned to its left edge */
    const rect  = anchorEl.getBoundingClientRect();
    const menuW = 300;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';

    /* Close on any outside click */
    setTimeout(() => {
      document.addEventListener('click', function closeProjects(e) {
        if (!menu.contains(e.target) && e.target !== anchorEl) {
          menu.remove();
          document.removeEventListener('click', closeProjects);
        }
      });
    }, 0);
  }

  if (btnProjectsBtn) {
    btnProjectsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showProjectsDropdown(btnProjectsBtn);
    });
  }


  /* ── Manage Projects modal ──────────────────────────────────────── */

  function showManageProjectsModal() {
    /* Prevent double-open */
    if (document.getElementById('revery-manage-projects-overlay')) return;

    const overlay = document.createElement('div');
    overlay.className = 'revery-input-overlay';
    overlay.id        = 'revery-manage-projects-overlay';

    const box = document.createElement('div');
    box.className = 'revery-input-box';
    /* Override default gap; we'll control spacing manually */
    box.style.cssText = 'gap: 0; min-width: 360px; max-width: 520px; width: 90%;';

    /* Title */
    const titleEl = document.createElement('p');
    titleEl.style.cssText = 'font-weight: 400; font-size: 1rem; margin: 0 0 6px; padding-bottom: 10px; border-bottom: 1px solid var(--border, #444);';
    titleEl.textContent   = 'Manage Projects';
    box.appendChild(titleEl);

    /* Hint */
    const hintEl = document.createElement('p');
    hintEl.style.cssText  = 'font-size: 0.8rem; opacity: 0.6; margin: 8px 0 12px;';
    hintEl.textContent    = 'Remove folders from the quick-switch list. No files are deleted.';
    box.appendChild(hintEl);

    /* Scrollable project list */
    const listEl = document.createElement('div');
    listEl.style.cssText  = 'overflow-y: auto; max-height: 55vh; display: flex; flex-direction: column; scrollbar-width: thin;';
    box.appendChild(listEl);

    /**
     * Rebuild the list DOM from the current localStorage state.
     * Called on initial open and after every removal so indices are
     * always fresh — avoids stale-closure bugs.
     */
    function rebuildList() {
      listEl.innerHTML = '';
      const projects = loadProjects();

      if (projects.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText   = 'padding: 20px 0; text-align: center; opacity: 0.5; font-size: 0.85rem;';
        empty.textContent     = 'No projects in list';
        listEl.appendChild(empty);
        return;
      }

      projects.forEach((proj, idx) => {
        const normProj = proj.path.replace(/\\/g, '/');
        const normRoot = (rootPath || '').replace(/\\/g, '/');
        const isActive = normProj === normRoot;

        const row = document.createElement('div');
        row.className = 'revery-manage-row';

        const textWrap = document.createElement('div');
        textWrap.className = 'revery-manage-text';

        const nameEl = document.createElement('div');
        nameEl.className   = 'revery-manage-name';
        nameEl.textContent = proj.name + (isActive ? ' (current)' : '');
        if (isActive) nameEl.style.color = 'var(--accent, #7a8ee0)';

        const pathEl = document.createElement('div');
        pathEl.className   = 'revery-manage-path';
        pathEl.textContent = normProj;
        pathEl.title       = proj.path;

        textWrap.append(nameEl, pathEl);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'revery-input-cancel';
        removeBtn.style.cssText = 'padding: 3px 10px; font-size: 0.78rem; flex-shrink: 0; cursor: pointer;';
        removeBtn.textContent   = 'Remove';
        removeBtn.title         = 'Remove from list (does not delete files)';
        removeBtn.addEventListener('click', () => {
          /* Always reload from storage, remove by index from fresh array */
          const current = loadProjects();
          /* Match by path to be safe — not by stale idx */
          const updated = current.filter(
            p => p.path.replace(/\\/g, '/') !== normProj
          );
          saveProjects(updated);
          rebuildList(); // Rebuild from fresh state
        });

        row.append(textWrap, removeBtn);
        listEl.appendChild(row);
      });
    }

    rebuildList();

    /* Done button */
    const btnRow = document.createElement('div');
    btnRow.className      = 'revery-input-buttons';
    btnRow.style.marginTop = '14px';
    const doneBtn = document.createElement('button');
    doneBtn.className   = 'revery-input-ok';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => overlay.remove());
    btnRow.appendChild(doneBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);
    /* Click outside the box to close */
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /* ══════════════════════════════════════════════════════════════════
     SORT HELPERS
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Re-sort a readDirectory() result according to the current sortKey/sortDir.
   * Directories always come before files, regardless of sort mode.
   */
  function sortEntries(entries) {
    const dirs  = entries.filter(e => e.type === 'dir');
    const files = entries.filter(e => e.type === 'file');

    function cmp(a, b) {
      if (sortKey === 'name') {
        const r = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return sortDir === 'asc' ? r : -r;
      }
      const field = sortKey === 'modified' ? 'mtime' : 'ctime';
      const av = a[field] || 0;
      const bv = b[field] || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    }

    dirs.sort(cmp);
    files.sort(cmp);
    return [...dirs, ...files];
  }

  /* ── Sort dropdown ──────────────────────────────────────────────── */

  const SORT_OPTIONS = [
  { group: window.t('Name') },
  { label: window.t('Name A → Z'),      key: 'name',     dir: 'asc'  },
  { label: window.t('Name Z → A'),      key: 'name',     dir: 'desc' },
  { group: window.t('Modified') },
  { label: window.t('Newest first'),    key: 'modified', dir: 'desc' },
  { label: window.t('Oldest first'),    key: 'modified', dir: 'asc'  },
  { group: window.t('Created') },
  { label: window.t('Newest first'),    key: 'created',  dir: 'desc' },
  { label: window.t('Oldest first'),    key: 'created',  dir: 'asc'  },
];

  function showSortMenu(anchorEl) {
    /* Remove any existing sort menu */
    const existing = document.getElementById('sidebar-sort-menu');
    if (existing) { existing.remove(); return; } // toggle off

    const menu = document.createElement('div');
    menu.id        = 'sidebar-sort-menu';
    menu.className = 'sidebar-sort-menu';

    SORT_OPTIONS.forEach(opt => {
      if (opt.group !== undefined) {
        if (opt.group !== 'Name') {
          const sep = document.createElement('div');
          sep.className = 'sidebar-sort-sep';
          menu.appendChild(sep);
        }
        const grp = document.createElement('div');
        grp.className   = 'sidebar-sort-group';
        grp.textContent = opt.group;
        menu.appendChild(grp);
        return;
      }

      const btn   = document.createElement('button');
      btn.className = 'sidebar-sort-item';
      const isActive = (opt.key === sortKey && opt.dir === sortDir);
      if (isActive) btn.classList.add('sort-active');

      const check = document.createElement('span');
      check.className   = 'sidebar-sort-check';
      check.textContent = isActive ? '✓' : '';

      const label = document.createElement('span');
      label.textContent = opt.label;

      btn.append(check, label);
      btn.addEventListener('click', async () => {
        menu.remove();
        if (sortKey === opt.key && sortDir === opt.dir) return; // no change
        sortKey = opt.key;
        sortDir = opt.dir;
        saveSortPref();
        await renderTree();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    /* Position below the anchor button */
    const rect = anchorEl.getBoundingClientRect();
    const mw   = 200;
    let left = Math.min(rect.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    menu.style.left = left + 'px';
    menu.style.top  = (rect.bottom + 4) + 'px';

    /* Close on next outside click */
    setTimeout(() => {
      document.addEventListener('click', function closeSort(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeSort);
        }
      });
    }, 0);
  }

  if (btnSortBtn) {
    btnSortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSortMenu(btnSortBtn);
    });
  }


  /* ══════════════════════════════════════════════════════════════════
     EXPAND / COLLAPSE ALL
  ══════════════════════════════════════════════════════════════════ */

  /** Recursively gather all directory paths visible in the current DOM tree. */
  function getAllDirPathsFromDOM() {
    return Array.from(treeEl.querySelectorAll('.sidebar-dir'))
                .map(el => el.dataset.path)
                .filter(Boolean);
  }

  /**
   * Expand all folders by scanning the filesystem recursively.
   * We expand one level at a time, then re-render, to keep it safe.
   * A depth cap prevents runaway expansion in huge repos.
   */
  async function expandAllDirs(dirPath, depth) {
    if (depth > 8) return; // safety: don't recurse deeper than 8 levels
    let entries;
    try { entries = await window.NativeAPI.readDirectory(dirPath); }
    catch { return; }
    for (const entry of entries) {
      if (entry.type === 'dir' && !entry.name.startsWith('.')) {
        expandedDirs.add(entry.path);
        await expandAllDirs(entry.path, depth + 1);
      }
    }
  }

  function collapseAllDirs() {
    expandedDirs.clear();
    if (rootPath) expandedDirs.add(rootPath); // keep root visible
  }

  function updateToggleAllBtn() {
  if (!btnToggleAll) return;
  /* Any expanded dir beyond root means we're in "expanded" state */
  const anyExpanded = [...expandedDirs].some(p => p !== rootPath);
  if (anyExpanded) {
    btnToggleAll.textContent = '▴▴';
    btnToggleAll.title = window.t('Collapse all folders');
  } else {
    btnToggleAll.textContent = '▾▾';
    btnToggleAll.title = window.t('Expand all folders');
  }
}

  if (btnToggleAll) {
    btnToggleAll.addEventListener('click', async () => {
      if (!rootPath) return;
      const anyExpanded = [...expandedDirs].some(p => p !== rootPath);
      if (anyExpanded) {
        collapseAllDirs();
        await renderTree();
      } else {
        await expandAllDirs(rootPath, 0);
        await renderTree();
      }
      updateToggleAllBtn();
    });
  }

  /* ── File category classification ───────────────────────────────────
     text    → editable in the editor (.md, .txt)
     media   → images/video; click inserts markdown reference
     other   → all remaining types; shown in orange, cannot be opened   */
  const SUPPORTED_TEXT  = new Set(['.md', '.txt']);
  const SUPPORTED_MEDIA = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.bmp', '.ico', '.tiff', '.tif', '.avif',
  ]);

  function getFileCategory(name) {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return 'other';
    const ext = name.substring(dot).toLowerCase();
    if (SUPPORTED_TEXT.has(ext))  return 'text';
    if (SUPPORTED_MEDIA.has(ext)) return 'media';
    return 'other';
  }

  /* ── Media-preview mode ──────────────────────────────────────────────
     When the user clicks a media file we show its image markdown in the
     editor without opening any text file.  activeFilePath stays null so
     nothing auto-saves.  On the first keystroke a .md file is created.  */
  let _mediaPreviewMode = null;
  // { mediaPath: string, pendingMdDir: string, fileCreated: boolean }

  /* ── Relative-path helper ────────────────────────────────────────────
     Returns the POSIX-style relative path from fromDir to toFile.
     Used when inserting image markdown so paths stay portable.          */
  function makeRelativePath(fromDir, toFile) {
    fromDir = fromDir.replace(/\\/g, '/').replace(/\/$/, '');
    toFile  = toFile.replace(/\\/g, '/');
    const fParts = fromDir.split('/');
    const tParts = toFile.split('/');
    let common = 0;
    while (common < fParts.length && common < tParts.length
           && fParts[common] === tParts[common]) common++;
    const up   = fParts.length - common;
    const down = tParts.slice(common);
    return '../'.repeat(up) + down.join('/');
  }

  /**
   * Build the `![name](rel)` markdown for a media file.
   * @param {string} mediaPath  - absolute path to the media file
   * @param {string} [fromDir] - directory to resolve relative path from.
   *   Defaults to activeFilePath's directory, then rootPath.
   *   Pass the directory of the file that WILL contain this reference.
   */
  function mediaMarkdown(mediaPath, fromDir) {
    const name = mediaPath.replace(/\\/g, '/').split('/').pop();
    const baseDir = (fromDir || (
      activeFilePath
        ? activeFilePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        : (rootPath || '').replace(/\\/g, '/')
    )).replace(/\\/g, '/');
    const rel = baseDir
      ? makeRelativePath(baseDir, mediaPath.replace(/\\/g, '/'))
      : name;
    return `![${name}](${rel})`;
  }

  /* ── Multi-select & drag-and-drop state ─────────────────────────── */
  let selectedItems   = new Set(); // Set<path> of all multi-selected items
  let selectionAnchor = null;      // Last non-shift clicked path (range anchor)
  let _dragItems      = [];        // [{path, type}] currently being dragged
  /* Serialize async FS operations — prevents simultaneous move/rename/delete
     from corrupting state if the user clicks very quickly.               */
  let _operationLock  = false;

  /* ── Undo stack (moves + renames only — deletes are irreversible) ── */
  const MAX_UNDO  = 30;
  const undoStack = []; // [{type:'move'|'rename', records:[{oldPath,newPath}]}]




  /* Watcher suppression: after we write ourselves we ignore the next
     watcher event for this many ms to avoid a false "external change" dialog */
 let _suppressWatchUntil = 0;
  const SUPPRESS_MS = 2000;

  let _autoSaveTimer = null;           // ← ADD THIS LINE BACK
  const AUTOSAVE_DELAY_MS              = 1500;
  const AUTOSAVE_MAX_WAIT_MS           = 10000; // Force save after 10 s of continuous editing
  const AUTOSAVE_FAILURE_COOLDOWN_MS   = 30000; // After a save failure, suppress
                                                // automatic retries for 30 s.

  let _diskOpsChain            = Promise.resolve();
  let _externalChangeInProgress = false;
  let _replaceGeneration        = 0;


  function _enqueueDiskOp(op) {
    const next = _diskOpsChain.then(() => op(), () => op());
    // Anchor _diskOpsChain to the *settled* outcome so a thrown error
    // inside op doesn't break FIFO for subsequent enqueues.
    _diskOpsChain = next.then(() => {}, () => {});
    return next;
  }


  let _firstDirtyTime         = 0;


  let _autoSaveCooldownUntil    = 0;


  let _conflictHoldPath         = null;


  let _scratchpadFailureWarned  = false;


/* ══════════════════════════════════════════════════════════════════
     DIRTY INDICATOR
  ══════════════════════════════════════════════════════════════════ */

  function markDirty() {
    if (isDirty) return;
    isDirty = true;
    document.title = 'Revery Notebook •';
    if (docTitleEl) docTitleEl.classList.add('doc-title-dirty');
  }

  function markClean() {
    isDirty = false;
    _firstDirtyTime = 0;
    document.title = 'Revery Notebook';
    if (docTitleEl) docTitleEl.classList.remove('doc-title-dirty');
    window._sidebarUnsaved = false;
    // Buffer now matches disk (file opened / reloaded / saved / cleared) —
    // any conflict hold is moot and must not block future autosaves.
    _conflictHoldPath = null;
  }

  /* ══════════════════════════════════════════════════════════════════
     INLINE RENAMING (DOC TITLE)
  ══════════════════════════════════════════════════════════════════ */
  
  let _renamePromise = null;

  async function renameActiveFileFromTitle() {
  // Do not interrupt a bulk operation (move, delete, multi‑rename)
  if (_operationLock) return;

  if (!activeFilePath || window._showingUnsupportedFile || _mediaPreviewMode) return;

  const rawName = docTitleEl.value.trim();
  const parts = activeFilePath.replace(/\\/g, '/').split('/');
  const oldFullName = parts.pop();
  const oldDir = parts.join('/');
  
  const lastDot = oldFullName.lastIndexOf('.');
  const ext = lastDot > 0 ? oldFullName.substring(lastDot + 1) : 'md';
  const oldBaseName = lastDot > 0 ? oldFullName.substring(0, lastDot) : oldFullName;

  if (!rawName) {
    docTitleEl.value = oldBaseName;
    return;
  }

  const safeName = rawName.replace(/[/\\?%*:|"<>]/g, '_');
  if (safeName === oldBaseName) {
    docTitleEl.value = safeName;
    return;
  }

  // If a rename is already in flight, wait for it
  if (_renamePromise) return _renamePromise;



const execRename = async () => {
    _operationLock = true;
    try {
      // Capture the old path before any async gap so we can clean up the
      // volatile backup key regardless of what happens to activeFilePath below.
      const oldPath = activeFilePath;

      const finalNewPath = await uniquePath(oldDir, safeName, ext);


      await window.NativeAPI.writeVolatileNow(finalNewPath, editor.value).catch(e =>
        console.warn('[Sidebar] Pre-rename volatile migration failed (non-fatal):', e)
      );


      const journalEntry = { from: oldPath, to: finalNewPath, ts: Date.now() };
      if (typeof window.NativeAPI.setPendingRename === 'function') {
        await window.NativeAPI.setPendingRename(journalEntry).catch(e =>
          console.warn('[Sidebar] Rename journal write failed (non-fatal):', e)
        );
      }

      await window.NativeAPI.renameNode(oldPath, finalNewPath);
      pushUndo({ type: 'rename', records: [{ oldPath, newPath: finalNewPath }] });
      activeFilePath = finalNewPath;
      await window.NativeAPI.setLastOpenedFile(finalNewPath);
      const finalBaseName = finalNewPath.replace(/\\/g, '/').split('/').pop().replace(new RegExp(`\\.${ext}$`), '');
      docTitleEl.value = finalBaseName;
      startWatchingFile(finalNewPath);

      // Clear the rename journal — everything succeeded. Failure here is
      // non-fatal: a stale journal is idempotent on next boot (lastFile ===
      // journal.to triggers a no-op clear).
      if (typeof window.NativeAPI.setPendingRename === 'function') {
        window.NativeAPI.setPendingRename(null).catch(e =>
          console.warn('[Sidebar] Rename journal clear failed (non-fatal):', e)
        );
      }


      window.NativeAPI.deleteVolatileContent(oldPath).catch(() => {});


      await renderTree();
    } catch (err) {
      console.error('[Sidebar] Inline rename failed:', err);
      docTitleEl.value = oldBaseName;
      await window.NativeAPI.showMessageBox({
        type: 'error', title: 'Rename Failed',
        message: `Could not rename file to "${safeName}".`,
        detail: String(err),
      });
    } finally {
      _operationLock = false;
      _renamePromise = null;
    }
  };

  _renamePromise = execRename();
  return _renamePromise;
}

  if (docTitleEl) {
    // Trigger rename when the user clicks away
    docTitleEl.addEventListener('change', renameActiveFileFromTitle);
    // Trigger rename on Enter key
    docTitleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        docTitleEl.blur(); // Forces the 'change' event to fire
        editor.focus();
      }
    });
  }


  /* ══════════════════════════════════════════════════════════════════
     SIDEBAR TOGGLE
  ══════════════════════════════════════════════════════════════════ */

function openSidebar() {
    sidebarOpen = true;
    sidebarPanel.style.display   = 'flex';
    sidebarDivider.style.display = 'block';
    if (window.savedSidebarWidth) {
      sidebarPanel.style.width = window.savedSidebarWidth;
    }
     if (btnSidebar) {
    btnSidebar.classList.add('active');
    btnSidebar.title = window.t('Close project folder');
  }
}
  function closeSidebar() {
    sidebarOpen = false;
    sidebarPanel.style.display   = 'none';
    sidebarDivider.style.display = 'none';
      if (btnSidebar) {
    btnSidebar.classList.remove('active');
    btnSidebar.title = window.t('Open project folder');
  }
}

if (btnSidebar) btnSidebar.addEventListener('click', () => {
    sidebarOpen ? closeSidebar() : openSidebar();
  });

  const btnSidebarMobile = document.getElementById('btn-sidebar-mobile');
  if (btnSidebarMobile) {
    btnSidebarMobile.addEventListener('click', () => {
      const isSidebar = document.body.getAttribute('data-view') === 'sidebar';
      if (isSidebar) {
        const toView = document.body.classList.contains('reader-mode-active') ? 'preview' : 'editor';
        document.body.setAttribute('data-view', toView);
        btnSidebarMobile.classList.remove('active');
      } else {
        document.body.setAttribute('data-view', 'sidebar');
        btnSidebarMobile.classList.add('active');
        if (!sidebarOpen) openSidebar();
      }
    });
  }

  /* Automatically revert mobile layout back to the editor when a file is opened */
  function switchFromMobileSidebar() {
    if (window.innerWidth <= 820 && document.body.getAttribute('data-view') === 'sidebar') {
      const toView = document.body.classList.contains('reader-mode-active') ? 'preview' : 'editor';
      document.body.setAttribute('data-view', toView);
      if (btnSidebarMobile) btnSidebarMobile.classList.remove('active');
    }
  }

/* ══════════════════════════════════════════════════════════════════
     SAVE  (the single source of truth for all disk writes)
  ══════════════════════════════════════════════════════════════════ */

let _saveChain = Promise.resolve();

async function saveActiveFile() {
  if (!activeFilePath) return false;
  clearTimeout(_autoSaveTimer);

  const contentToSave = editor.value;

  const enqueueGen = _replaceGeneration;

  // Chain this save after all previous saves
  const savePromise = _saveChain = _saveChain.then(async () => {
  // Wait for any pending rename
  if (typeof _renamePromise !== 'undefined' && _renamePromise) {
    await _renamePromise;
  }
  // Path may have changed while waiting, re‑check
  if (!activeFilePath) return false;

  // Apply pending title rename if needed
  if (docTitleEl) {
    const currentBase = activeFilePath.replace(/\\/g, '/').split('/').pop()
                       .replace(/\.[^/.]+$/, '');
    const inputName = docTitleEl.value.trim();
    if (inputName && inputName !== currentBase && !window._showingUnsupportedFile && !_mediaPreviewMode) {
      await renameActiveFileFromTitle();
      if (!activeFilePath) return false;
    }
  }


  const pathToSave = activeFilePath;


let writeResult;

try {
  writeResult = await _enqueueDiskOp(async () => {
    if (_externalChangeInProgress) return 'deferred-external';
    if (enqueueGen !== _replaceGeneration) return 'deferred-replaced';

    await window.NativeAPI.writeFile(pathToSave, contentToSave);
    // Set the suppress window INSIDE the lock so a watcher event that
    // races our write sees the suppression even if it enters the lock
    // immediately after us.
    _suppressWatchUntil = Date.now() + SUPPRESS_MS;
    return 'ok';
  });
} catch (err) {
  // Real disk error from writeFile (or unexpected throw).
  console.error('[Sidebar] saveActiveFile failed:', err);
  _autoSaveCooldownUntil = Date.now() + AUTOSAVE_FAILURE_COOLDOWN_MS;
  _firstDirtyTime = 0;
  await window.NativeAPI.showMessageBox({
    type: 'error', title: 'Save Failed',
    message: `Could not write to:\n${pathToSave}`,
    detail: String(err)
  });
  return false;
}

if (writeResult !== 'ok') {
  // 'deferred-external' or 'deferred-replaced'. No dialog — the watcher's
  // own dialog is the user's resolution path. Treat as a save failure
  // (return false) so callers see the same signal as a real failure.
  return false;
}

// ── Successful write past this point — post-write bookkeeping ────────
_autoSaveCooldownUntil = 0;
// An explicit save of this file discharges the "Keep my version" promise.
if (_conflictHoldPath === pathToSave) _conflictHoldPath = null;

if (editor.value === contentToSave) {
  markClean();
  if (typeof showSavedIndicator === 'function') showSavedIndicator();
  window.NativeAPI.deleteVolatileContent(pathToSave).catch(() => {});
} else {
  // Don't markClean, don't showSavedIndicator (visible state is
  // ahead of disk; the next autosave will show the indicator once
  // editor and disk converge).
  window.NativeAPI.writeVolatileNow(pathToSave, editor.value).catch(err =>
    console.warn('[Sidebar] post-save volatile refresh failed:', err)
  );
  scheduleAutoSave();
}

// Update card view preview
if (sidebarViewMode === 'card') {
  const chunk = contentToSave.substring(0, 5000);
  const previewText = stripMarkdownForPreview(chunk).substring(0, 440);
  _previewCache.set(pathToSave, previewText);
  const card = treeEl.querySelector(`.sidebar-card[data-path="${CSS.escape(pathToSave)}"]`);
  if (card) {
    const previewEl = card.querySelector('.sidebar-card-preview');
    if (previewEl) previewEl.textContent = previewText;
  }
}

return true;






}).catch(err => {
  console.error('[Sidebar] Uncaught error in save chain – recovering:', err);
  return false;
});
return savePromise;
}



  /** Schedules an auto-save after AUTOSAVE_DELAY_MS of inactivity, but
      forces a save once AUTOSAVE_MAX_WAIT_MS has elapsed since the
      document first became dirty. Prevents indefinite postponement
      during continuous typing. */
  function scheduleAutoSave() {
    if (!activeFilePath) return;
    clearTimeout(_autoSaveTimer);

    // Conflict hold ("Keep my version"): the user chose to keep the disk
    // file as the external program left it. Background autosave stays off
    // for THIS file until an explicit save lifts the hold.
    if (_conflictHoldPath && _conflictHoldPath === activeFilePath) {
      return;
    }

    // If a recent save failed, back off until the cooldown expires.
    if (Date.now() < _autoSaveCooldownUntil) {
      return;
    }
    if (_firstDirtyTime === 0) _firstDirtyTime = Date.now();

    if (Date.now() - _firstDirtyTime >= AUTOSAVE_MAX_WAIT_MS) {
      // Cap reached: save immediately. saveActiveFile() will call
      // markClean() on success, which resets _firstDirtyTime.
      //
      // IMPORTANT: reset _firstDirtyTime BEFORE the save attempt so a
      // failed save (disk full, file locked, etc.) doesn't leave the
      // cap permanently exceeded — which would force an instant retry
      // on every subsequent keystroke and trap the user in an error-
      // dialog loop.
      _firstDirtyTime = Date.now();

      saveActiveFile();
      return;
    }

    _autoSaveTimer = setTimeout(saveActiveFile, AUTOSAVE_DELAY_MS);
  }

/* Expose save for actions.js and other modules */
  window.sidebarSaveActiveFile    = saveActiveFile;
  window.sidebarGetActiveFilePath = () => activeFilePath;
  window.sidebarGetRootPath       = () => rootPath;

  // Pivot the sidebar state to a newly saved file (used by Save As)
  window.sidebarPivotToNewFile = async function(newPath, newRoot) {
    activeFilePath = newPath;
    markClean();
    await window.NativeAPI.setLastOpenedFile(newPath);

    // If the file was saved to a directory outside the current project root,
    // the backend has already updated its own root state and trustedRoots.
    // Sync all JS-side state that depends on rootPath so that:
    //   • renderTree() shows the correct directory
    //   • New File / New Folder buttons use the correct base directory
    //   • The sidebar title shows the correct folder name
    //   • Card view and expandedDirs don't hold stale paths from the old root
    if (newRoot && newRoot !== rootPath) {
      rootPath = newRoot;
      try { localStorage.setItem('revery_root_path', rootPath); } catch (_) {}
      if (typeof window.NativeAPI.setLastRootPath === 'function') {
        window.NativeAPI.setLastRootPath(rootPath).catch(() => {});
      }
      // Update sidebar folder name display
      const parts = newRoot.replace(/\\/g, '/').split('/');
      if (folderNameEl) folderNameEl.textContent = parts[parts.length - 1] || newRoot;
      // Reset directory state — mirrors exactly what openFolder() does
      selectedDirPath = newRoot;
      cardViewDir     = newRoot;
      expandedDirs.clear();
      expandedDirs.add(newRoot);
      // Record in recent-projects history
      if (typeof recordProjectOpen === 'function') {
        await recordProjectOpen(newRoot);
      }
    }

    if (docTitleEl) {
      const base = newPath.replace(/\\/g, '/').split('/').pop();
      docTitleEl.value = base.replace(/\.(md|txt)$/, '');
    }
    
    startWatchingFile(newPath);
    
    // Ensure the new file's directory is expanded and visible in the tree
    const dir = newPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (dir) expandedDirs.add(dir);
    
    await renderTree();
    highlightActiveFile(newPath);
  };

/* ══════════════════════════════════════════════════════════════════
     EDITOR INPUT LISTENER  (dirty tracking + auto-save + volatile)
  ══════════════════════════════════════════════════════════════════ */

  editor.addEventListener('input', () => {
    /* ── Media preview mode: create a .md file on the first keystroke ── */
    if (_mediaPreviewMode && !_mediaPreviewMode.fileCreated) {
      _mediaPreviewMode.fileCreated = true; // set immediately to prevent re-entry
      (async () => {
        const dir      = _mediaPreviewMode.pendingMdDir;
        const baseName = _mediaPreviewMode.mediaPath
          .replace(/\\/g, '/').split('/').pop()
          .replace(/\.[^/.]+$/, ''); // strip media extension
        const newPath  = await uniquePath(dir, baseName, 'md');
        try {
          await window.NativeAPI.createFile(newPath);
          // Write what the user has already typed (current editor content)
          await window.NativeAPI.writeFile(newPath, editor.value);
          // Suppress AFTER write — ensures the full window is fresh when
          // startWatchingFile(newPath) is called moments later.
          _suppressWatchUntil = Date.now() + SUPPRESS_MS;
        } catch (err) {
          console.error('[Sidebar] media auto-create failed:', err);
          _mediaPreviewMode.fileCreated = false; // allow retry
          return;
        }
        activeFilePath  = newPath;
        _mediaPreviewMode = null;
        window._showingUnsupportedFile = false;
        await window.NativeAPI.setLastOpenedFile(newPath);
        if (docTitleEl) {
          docTitleEl.value = newPath.replace(/\\/g, '/').split('/').pop()
                                    .replace(/\.(md|txt)$/, '');
        }
        startWatchingFile(newPath);
        expandedDirs.add(dir);
        await renderTree();
        highlightActiveFile(newPath);
      })();
      return; // skip dirty-mark until file exists
    }


/* ── Scratchpad mode: Auto-create a .md file if typing in an empty state ── */
    if (!activeFilePath && !_mediaPreviewMode && !_autoCreatingFile && !window._showingUnsupportedFile) {
      const targetDir = selectedDirPath || rootPath;
      if (targetDir) {

        const placeholderKey = ensureScratchpadVolatileKey();
        try {
          window.NativeAPI.setVolatileContent(placeholderKey, editor.value);
        } catch (e) {

          console.warn('[Sidebar] scratchpad placeholder volatile failed (non-fatal):', e);
        }

        _autoCreatingFile = true; // Lock to prevent duplicate files if user types fast
        (async () => {
          const newPath = await uniquePath(targetDir, 'untitled', 'md');
          try {
            await window.NativeAPI.createFile(newPath);
            // Instantly write the first keystrokes to the new file
            await window.NativeAPI.writeFile(newPath, editor.value);
            // Suppress AFTER write — same reasoning as saveActiveFile().
            _suppressWatchUntil = Date.now() + SUPPRESS_MS;
          } catch (err) {
            console.error('[Sidebar] scratchpad auto-create failed:', err);
            _autoCreatingFile = false;

            if (!_scratchpadFailureWarned) {
              _scratchpadFailureWarned = true;
              window.NativeAPI.showMessageBox({
                type: 'warning',
                title: 'Could Not Create File',
                message: 'A file could not be created to save your work.',
                detail: String(err) + '\n\nYour typed content is still visible but has not been saved to disk. The app will retry automatically on your next keystroke.',
                buttons: ['OK'],
                defaultId: 0,
              }).catch(() => {}); // ignore if the dialog itself fails
            }
            return;
          }
          activeFilePath = newPath;
          _autoCreatingFile = false;
 
          _scratchpadFailureWarned = false;

          await window.NativeAPI.setLastOpenedFile(newPath);
          if (docTitleEl) {
            docTitleEl.value = newPath.replace(/\\/g, '/').split('/').pop().replace(/\.(md|txt)$/, '');
          }
          startWatchingFile(newPath);
          expandedDirs.add(targetDir);
          await renderTree();
          highlightActiveFile(newPath);

          // Mark dirty so normal autosave picks up any subsequent keystrokes
          markDirty();
          scheduleAutoSave();
          window.NativeAPI.setVolatileContent(activeFilePath, editor.value);


          if (_scratchpadVolatileKey) {
            const oldKey = _scratchpadVolatileKey;
            _scratchpadVolatileKey = null;
            window.NativeAPI.deleteVolatileContent(oldKey).catch(() => {});
          }
        })();
        return; // skip normal flow until file is fully established
      }
    }








    if (activeFilePath) {
      markDirty();
      scheduleAutoSave();
      /* Volatile crash backup (separate from the debounced disk auto-save) */
      window.NativeAPI.setVolatileContent(activeFilePath, editor.value);
    }
  });

  
/* Ctrl+S → immediate save */
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      if (!activeFilePath) return; /* let actions.js handle web export */
      e.preventDefault();
      
      // Force blur if user is still typing in the title to trigger the rename process safely
      if (document.activeElement === docTitleEl) {
        docTitleEl.blur(); 
      }
      
      await saveActiveFile();
    }
    /* Ctrl+Z → undo last navigation operation (move or rename).
       Only fires when the CM editor does NOT have focus, so it never
       conflicts with CM's own text undo.  We test cmView.hasFocus (a
       real DOM check) rather than activeElement === editor because
       `editor` is the JS shim object, not a DOM node — that comparison
       was always false and both handlers fired simultaneously.          */
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const editorHasFocus = window.cmView ? window.cmView.hasFocus : false;
      if (editorHasFocus) return; // CM's historyKeymap handles it
      if (undoStack.length === 0) return;
      e.preventDefault();
      await undoLastOperation();
    }
  });


  /* ══════════════════════════════════════════════════════════════════
     OPEN FOLDER DIALOG
  ══════════════════════════════════════════════════════════════════ */

async function openFolder(folderPath) {
    rootPath = folderPath;
    // Tell the backend what the sandbox root is so all subsequent FS IPC
    // calls are validated against it. Must happen before renderTree().
    await window.NativeAPI.setRootPath(folderPath);
    try { localStorage.setItem('revery_root_path', rootPath); } catch (e) {}
    
// Also persist to native settings file (survives WebView storage clears)
    if (typeof window.NativeAPI.setLastRootPath === 'function') {
      await window.NativeAPI.setLastRootPath(rootPath).catch(() => {});
    }
    
    // CRITICAL: Add the folder to the recent projects array
    await recordProjectOpen(folderPath);

    selectedDirPath = folderPath;
    cardViewDir = folderPath;



    _previewCache.clear();
    const parts = folderPath.replace(/\\/g, '/').split('/');
    folderNameEl.textContent = parts[parts.length - 1] || folderPath;
    expandedDirs.clear();
    expandedDirs.add(folderPath);
    await renderTree();
    if (!sidebarOpen) openSidebar();
  }


async function promptOpenFolder() {

      /* Auto-save current file before switching folders */
      if (isDirty && activeFilePath) {
        const saved = await saveActiveFile();
        if (!saved) return; // FIX: Abort to prevent data loss
      }
    try {
      const path = await window.NativeAPI.openFolderDialog();
      if (!path) return;

      /* Clear the editor BEFORE setting the new root to prevent path-escape races */
      activeFilePath = null;
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
  if (btnOpenFolder) btnOpenFolder.addEventListener('click', promptOpenFolder);


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
    if (_operationLock || undoStack.length === 0) return;
    _operationLock = true;
    try {
      const op = undoStack.pop();
      const errors = [];

      /* Reverse in reverse order so a multi-rename undoes cleanly */
      for (const { oldPath, newPath } of [...op.records].reverse()) {
        try {
          await window.NativeAPI.renameNode(newPath, oldPath);

          /* Keep internal state in sync */
          if (activeFilePath) {
            const normalNew    = newPath.replace(/\\/g, '/');
            const normalOld    = oldPath.replace(/\\/g, '/');
            const normalActive = activeFilePath.replace(/\\/g, '/');
            if (normalActive === normalNew) {
              activeFilePath = oldPath;
              await window.NativeAPI.setLastOpenedFile(oldPath);
              startWatchingFile(oldPath);
              if (docTitleEl) {
                docTitleEl.value = oldPath.replace(/\\/g, '/').split('/').pop()
                                         .replace(/\.(md|txt)$/, '');
              }
            } else if (normalActive.startsWith(normalNew + '/')) {
              const rel = normalActive.substring(normalNew.length);
              activeFilePath = normalOld + rel;
              await window.NativeAPI.setLastOpenedFile(activeFilePath);
              startWatchingFile(activeFilePath);
            }
          }
          if (selectedDirPath && selectedDirPath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')) {
            selectedDirPath = oldPath;
          }
        } catch (err) {
          errors.push(`${newPath.replace(/\\/g, '/').split('/').pop()}: ${err.message}`);
        }
      }

      selectedItems.clear(); selectionAnchor = null;
      await renderTree();

      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: 'warning', title: 'Undo Failed Partially',
          message: `${errors.length} item(s) could not be moved back:`,
          detail: errors.join('\n'),
        });
      }
    } finally {
      _operationLock = false;
    }
  }


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
    if (sidebarViewMode === 'card') {
      return cardViewDir || rootPath;
    }
    return rootPath;
  }

  /**
   * Return the folder-row element that should be highlighted as the
   * drop target, or null if it's the tree root.
   */
  function getDropTargetEl(eventTarget) {
    const dirPath = getDropTargetDir(eventTarget);
    if (!dirPath || dirPath === rootPath || (sidebarViewMode === 'card' && dirPath === cardViewDir)) return null;
    
    if (sidebarViewMode === 'card') {
      return treeEl.querySelector(`.sidebar-card-dir[data-path="${CSS.escape(dirPath)}"]`);
    }
    return treeEl.querySelector(`.sidebar-dir[data-path="${CSS.escape(dirPath)}"]`);
  }
  /* ══════════════════════════════════════════════════════════════════
     MULTI-SELECT HELPERS
  ══════════════════════════════════════════════════════════════════ */

  /** All visible .sidebar-item elements in current DOM order. */
  function getVisibleItems() {
    return Array.from(treeEl.querySelectorAll('.sidebar-item'));
  }

/** Sync .multi-selected CSS class to match selectedItems set. */
  function updateMultiSelectHighlight() {
    treeEl.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.toggle('multi-selected', selectedItems.has(el.dataset.path));
    });
    treeEl.querySelectorAll('.sidebar-card').forEach(el => {
      el.classList.toggle('sidebar-card-selected', selectedItems.has(el.dataset.path));
    });
  }
  /**
   * Central click handler for every sidebar item.
   * Preserves existing single-click behaviour; adds Ctrl/Shift multi-select.
   *
   *  • Normal click  → clear selection, do normal action (open file / toggle dir)
   *  • Ctrl/⌘ click  → toggle item in selection; no open/toggle
   *  • Shift click   → range-select from anchor; no open/toggle
   */
  function handleItemClick(e, path, type, itemEl, containerEl) {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      if (selectedItems.has(path)) {
        selectedItems.delete(path);
      } else {
        selectedItems.add(path);
        selectionAnchor = path;
      }
      updateMultiSelectHighlight();
      if (type === 'dir') { selectedDirPath = path; updateSelectedDirHighlight(); }
      return;
    }

    if (e.shiftKey && selectionAnchor) {
      e.stopPropagation();
      const allPaths = getVisibleItems().map(el => el.dataset.path);
      const ai = allPaths.indexOf(selectionAnchor);
      const bi = allPaths.indexOf(path);
      if (ai !== -1 && bi !== -1) {
        const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
        selectedItems.clear();
        for (let i = lo; i <= hi; i++) selectedItems.add(allPaths[i]);
      } else {
        selectedItems.add(path);
      }
      updateMultiSelectHighlight();
      return;
    }

    /* Normal click — clear multi-selection then perform normal action */
    if (selectedItems.size > 0) {
      selectedItems.clear();
      updateMultiSelectHighlight();
    }
    selectionAnchor = path;

    if (type === 'dir') {
      selectedDirPath = path;
      updateSelectedDirHighlight();
      toggleDir(path, itemEl, containerEl);
    } else {
      openFile(path);
    }
  }


  /* ══════════════════════════════════════════════════════════════════
     DRAG-AND-DROP  —  MOVE OPERATIONS
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Like uniquePath but works for both files (with ext) and directories.
   * Appends _2, _3, … to the base name until no collision is found.
   */
  async function uniqueDestPath(targetDir, name, type) {
    const sep = (targetDir.endsWith('/') || targetDir.endsWith('\\')) ? '' : '/';
    let existingNames;
    try {
      const entries = await window.NativeAPI.readDirectory(targetDir);
      existingNames = new Set(entries.map(e => e.name));
    } catch {
      return `${targetDir}${sep}${name}`;
    }
    if (!existingNames.has(name)) return `${targetDir}${sep}${name}`;

    const lastDot = name.lastIndexOf('.');
    const hasExt  = (type === 'file') && (lastDot > 0);
    const base    = hasExt ? name.substring(0, lastDot) : name;
    const ext     = hasExt ? name.substring(lastDot)    : '';
    let counter   = 2;
    while (existingNames.has(`${base}_${counter}${ext}`)) counter++;
    return `${targetDir}${sep}${base}_${counter}${ext}`;
  }

  /**
   * Safely move an array of {path, type} items into targetDir.
   *
   * Safety guarantees:
   *  1. Saves the active file first (no dirty data loss).
   *  2. Skips moves that would place a folder inside itself or a descendant.
   *  3. Skips no-ops (item already in targetDir).
   *  4. Skips attempting to move rootPath.
   *  5. Deduplicates destination names to avoid clobbering existing files.
   *  6. Updates activeFilePath / selectedDirPath if they live inside a moved item.
   *  7. _operationLock prevents concurrent FS mutations.
   */
  async function moveNodes(items, targetDir) {
    if (_operationLock || !items.length || !targetDir) return;
    _operationLock = true;
    try {
      if (isDirty && activeFilePath) {
        const saved = await saveActiveFile();
        if (!saved) return; // Save failed — abort move to protect data
      }

      const normalTarget = targetDir.replace(/\\/g, '/');
      const normalRoot   = (rootPath || '').replace(/\\/g, '/');
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
        if (activeFilePath) {
          const normalActive = activeFilePath.replace(/\\/g, '/');
          if (normalActive === normalSrc) {
            activeFilePath = destPath;
            await window.NativeAPI.setLastOpenedFile(destPath);
            startWatchingFile(destPath);
            if (docTitleEl) {
              const base = destPath.replace(/\\/g, '/').split('/').pop();
              docTitleEl.value = base.replace(/\.(md|txt)$/, '');
            }
          } else if (normalActive.startsWith(normalSrc + '/')) {
            /* Active file is inside a moved folder */
            const rel = normalActive.substring(normalSrc.length);
            activeFilePath = destPath.replace(/\\/g, '/') + rel;
            await window.NativeAPI.setLastOpenedFile(activeFilePath);
            startWatchingFile(activeFilePath);
          }
        }

        /* ── Update selectedDirPath if it was inside the moved item ── */
        if (selectedDirPath) {
          const normalSel = selectedDirPath.replace(/\\/g, '/');
          if (normalSel === normalSrc || normalSel.startsWith(normalSrc + '/')) {
            selectedDirPath = targetDir;
          }
        }

        expandedDirs.add(targetDir); // Expand destination so moved items are visible
      }

      selectedItems.clear();
      selectionAnchor = null;
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
      _operationLock = false;
    }
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
    if (_operationLock || !sources.length || !targetDir) return;
    if (!window.NativeAPI) return;

    _operationLock = true;
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
          type: 'warning', title: 'Copy Issues',
          message: `${errors.length} file(s) could not be copied:`,
          detail: errors.join('\n'),
        });
      }
    } finally {
      _operationLock = false;
    }
  }

  /* Electron DOM drop → wrap File objects as sources. */
  async function copyExternalFilesIntoDir(files, targetDir) {
    const sources = Array.from(files).map((file) => ({ kind: 'file', file }));
    return copyDroppedSources(sources, targetDir);
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
    if (_operationLock || selectedItems.size === 0) return;

    if (selectedItems.size === 1) {
      /* Single-item path: delegate to the existing per-item rename */
      const p  = [...selectedItems][0];
      const el = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"]`);
      await renameNode(p, el ? el.dataset.type : 'file');
      selectedItems.clear(); selectionAnchor = null;
      return;
    }

    _operationLock = true;
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
          if (activeFilePath) {
            const normalActive = activeFilePath.replace(/\\/g, '/');
            const normalSrc    = srcPath.replace(/\\/g, '/');
            const normalNew    = newPath.replace(/\\/g, '/');

            if (normalActive === normalSrc) {
              activeFilePath = newPath;
              markClean();
              await window.NativeAPI.setLastOpenedFile(newPath);
              if (docTitleEl) docTitleEl.value = newName.replace(/\.(md|txt)$/, '');
              startWatchingFile(newPath);
            } else if (normalActive.startsWith(normalSrc + '/')) {
              const rel = normalActive.substring(normalSrc.length);
              activeFilePath = normalNew + rel;
              await window.NativeAPI.setLastOpenedFile(activeFilePath);
              startWatchingFile(activeFilePath);
            }
          }

          /* ── Update selected target dir if it was inside the renamed item ── */
          if (selectedDirPath) {
            const normalSel = selectedDirPath.replace(/\\/g, '/');
            const normalSrc = srcPath.replace(/\\/g, '/');
            const normalNew = newPath.replace(/\\/g, '/');
            
            if (normalSel === normalSrc) {
              selectedDirPath = newPath;
            } else if (normalSel.startsWith(normalSrc + '/')) {
              const rel = normalSel.substring(normalSrc.length);
              selectedDirPath = normalNew + rel;
            }
          }
        } catch (err) {
          console.error('[Sidebar] multi-rename failed:', srcPath, err);
        }
      }

      selectedItems.clear(); selectionAnchor = null;
      if (renamedRecords.length) pushUndo({ type: 'rename', records: renamedRecords });
      await renderTree();
    } finally {
      _operationLock = false;
    }
  }

  /** Delete all selected items with a single confirmation dialog. */
  async function deleteSelectedNodes() {
    if (_operationLock || selectedItems.size === 0) return;
    _operationLock = true;
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
            activeFilePath; the other iteration then finds it already null
            and the block is a no-op. */
          const normalNode = p.replace(/\\/g, '/');

          if (activeFilePath) {
            const normalActive = activeFilePath.replace(/\\/g, '/');
            if (normalActive === normalNode || normalActive.startsWith(normalNode + '/')) {
              activeFilePath = null;
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

          if (selectedDirPath) {
            const normalSel = selectedDirPath.replace(/\\/g, '/');
            if (normalSel === normalNode || normalSel.startsWith(normalNode + '/')) {
              selectedDirPath = rootPath;
            }
          }
        } catch (err) {
          console.error('[Sidebar] multi-delete failed:', p, err);
        }
      }

      selectedItems.clear(); selectionAnchor = null;
      await renderTree();
    } finally {
      _operationLock = false;
    }
  }


  
  /* ══════════════════════════════════════════════════════════════════
     TREE RENDERING
  ══════════════════════════════════════════════════════════════════ */
async function renderNode(containerEl, dirPath, depth, generation = 0) {   // ← accept generation
  let entries;
  try {
    entries = await window.NativeAPI.readDirectory(dirPath);
  } catch (err) {
    console.warn('[Sidebar] readDirectory failed:', dirPath, err);
    return;
  }

  /* Apply user-selected sort (dirs always precede files within each group) */
  entries = sortEntries(entries);

  const CHUNK = 100; // yield to the browser every N items   // ← NEW

  for (let i = 0; i < entries.length; i++) {   // ← for..of → indexed for loop
    /* Yield every CHUNK entries so the browser can paint and stay responsive */
    if (i > 0 && i % CHUNK === 0) {                          // ← NEW
      await new Promise(r => setTimeout(r, 0));              // ← NEW
      if (_treeRenderGeneration !== generation) return;      // ← NEW: stale — abort
    }                                                        // ← NEW

    const entry = entries[i];   // ← NEW (replaces `for (const entry of entries)`)
    if (entry.name.startsWith('.')) continue; /* skip hidden */


      const itemEl  = document.createElement('div');
      const iconEl  = document.createElement('span');
      const nameEl  = document.createElement('span');
      iconEl.className  = 'sidebar-icon';
      nameEl.className  = 'sidebar-name';
      /* Prevent child spans from becoming the drag source element.
         The parent itemEl must own the drag; child spans must not. */
      iconEl.draggable  = false;
      nameEl.draggable  = false;
      nameEl.textContent = entry.name;
      itemEl.className = 'sidebar-item';
      itemEl.dataset.path = entry.path;
      itemEl.dataset.type = entry.type;
      itemEl.style.paddingLeft = (depth * 14 + 10) + 'px';

      if (entry.type === 'dir') {
        const isExpanded = expandedDirs.has(entry.path);
        iconEl.textContent = isExpanded ? '▾' : '▸';
        itemEl.classList.add('sidebar-dir');
        if (isExpanded) itemEl.classList.add('expanded');
        if (entry.path === selectedDirPath) itemEl.classList.add('selected-dir');
        if (selectedItems.has(entry.path)) itemEl.classList.add('multi-selected');
        itemEl.appendChild(iconEl);
        itemEl.appendChild(nameEl);
        containerEl.appendChild(itemEl);

        if (isExpanded) {

          const childrenEl = document.createElement('div');
          childrenEl.className = 'sidebar-children';
          childrenEl.dataset.parentPath = entry.path;
          containerEl.appendChild(childrenEl);

          await renderNode(childrenEl, entry.path, depth + 1, generation);   // ← pass generation
      }


        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          handleItemClick(e, entry.path, 'dir', itemEl, containerEl);
        });

      } else {
        /* ── FILES — show ALL types, classified by category ── */
        const category = getFileCategory(entry.name);

        /* Icon by category */
        if (category === 'text') {
          iconEl.textContent = entry.name.endsWith('.md') ? '📄' : '📝';
        } else if (category === 'media') {
          iconEl.textContent = '🖼️';
        } else {
          iconEl.textContent = '📎';
        }

        itemEl.classList.add('sidebar-file');
        if (category === 'media')       itemEl.classList.add('sidebar-media');
        if (category === 'other')       itemEl.classList.add('sidebar-unsupported');
        if (entry.path === activeFilePath) itemEl.classList.add('active');
        if (selectedItems.has(entry.path)) itemEl.classList.add('multi-selected');
        /* Highlight if this is the currently previewed media file */
        if (_mediaPreviewMode && _mediaPreviewMode.mediaPath === entry.path) {
          itemEl.classList.add('sidebar-media-active');
        }
        itemEl.appendChild(iconEl);
        itemEl.appendChild(nameEl);
        containerEl.appendChild(itemEl);

        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (category === 'text') {
            handleItemClick(e, entry.path, 'file', itemEl, containerEl);
          } else if (category === 'media') {
            /* Ctrl/Shift → multi-select; plain click → media preview */
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleItemClick(e, entry.path, 'file', itemEl, containerEl);
            } else {
              selectedItems.clear();
              updateMultiSelectHighlight();
              selectionAnchor = entry.path;
              openMediaFile(entry.path);
            }
          } else {
            /* Unsupported: allow multi-select, but plain click = show message */
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleItemClick(e, entry.path, 'file', itemEl, containerEl);
            } else {
              selectedItems.clear();
              updateMultiSelectHighlight();
              selectionAnchor = entry.path;
              openUnsupportedFile(entry.path);
            }
          }
        });
      }

      /* ── Drag-and-drop: make every item draggable ── */
      itemEl.draggable = true;

      itemEl.addEventListener('dragstart', (e) => {
        /* Do NOT stopPropagation here — it can prevent drag initiation
           in certain Electron/Tauri Chromium builds.                  */
        /* If dragging an item not in the selection, make it the sole selection */
        if (!selectedItems.has(entry.path)) {
          selectedItems.clear();
          selectedItems.add(entry.path);
          selectionAnchor = entry.path;
          updateMultiSelectHighlight();
        }
        /* Collect all selected items (preserving DOM order = tree order) */
        _dragItems = getVisibleItems()
          .filter(el => selectedItems.has(el.dataset.path))
          .map(el => ({ path: el.dataset.path, type: el.dataset.type }));
        /* Firefox and some Electron builds require setData to activate DnD.
           We also use this text/plain payload to insert into CM when the user
           drops a sidebar item onto the editor:
             • media file  → inserts  ![name](relative/path)
             • text file   → inserts  empty string (no accidental text)
             • other file  → inserts  empty string                          */
        const dragCategory = getFileCategory(entry.name);

        /* effectAllowed:
             'move'     → files/folders being moved within the sidebar tree
             'copyMove' → media files: can be moved in tree OR copied as a
                          markdown reference into the CM editor. CM's drop
                          handler uses dropEffect='copy'; without 'copy' in
                          effectAllowed the browser cancels the drop silently. */
        e.dataTransfer.effectAllowed = dragCategory === 'media' ? 'copyMove' : 'move';

        /* text/plain payload: CM reads this on drop and inserts it at the
           cursor.  Use the current active file's directory as the base so
           the relative path is correct for the file the user is editing.  */
        const dragText = dragCategory === 'media'
          ? mediaMarkdown(entry.path) // uses activeFilePath or rootPath as base
          : '';
        e.dataTransfer.setData('text/plain', dragText);

        /* Apply ghost opacity AFTER the drag image is snapshotted */
        requestAnimationFrame(() => {
          treeEl.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('drag-source-active', selectedItems.has(el.dataset.path));
          });
        });
      });

      itemEl.addEventListener('dragend', () => {
        treeEl.querySelectorAll('.drag-source-active, .drop-target').forEach(el => {
          el.classList.remove('drag-source-active', 'drop-target');
        });
        treeEl.classList.remove('drop-target-root');
        _dragItems = [];
      });

      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, entry.path, entry.type);
      });
    }
  }


async function renderTree() {
  if (!rootPath) return;

  /* In card view mode, delegate to renderCards instead */
  if (sidebarViewMode === 'card') {
    const dir = cardViewDir || rootPath;
    _previewCache.clear();
    await renderCards(dir);
    return;
  }

  /* Increment generation so any in-flight chunked renderNode aborts */
  const generation = ++_treeRenderGeneration;   // ← NEW

  treeEl.classList.remove('sidebar-card-view');
  treeEl.innerHTML = '';
  const loadingEl = document.createElement('div');
  loadingEl.className = 'sidebar-loading';
  loadingEl.textContent = 'Loading…';
  treeEl.appendChild(loadingEl);
  await renderNode(treeEl, rootPath, 0, generation);   // ← pass generation
  if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);
  highlightActiveFile(activeFilePath);
  updateSelectedDirHighlight();
  updateToggleAllBtn();
}



  async function toggleDir(dirPath, itemEl, containerEl) {
    const isExpanded = expandedDirs.has(dirPath);
    const existing = containerEl.querySelector(
      `.sidebar-children[data-parent-path="${CSS.escape(dirPath)}"]`
    );
    if (existing) existing.remove();

    if (isExpanded) {
      expandedDirs.delete(dirPath);
      itemEl.classList.remove('expanded');
      itemEl.querySelector('.sidebar-icon').textContent = '▸';
    } else {
      expandedDirs.add(dirPath);
      itemEl.classList.add('expanded');
      itemEl.querySelector('.sidebar-icon').textContent = '▾';
      const childrenEl = document.createElement('div');
      childrenEl.className = 'sidebar-children';
      childrenEl.dataset.parentPath = dirPath;
      itemEl.insertAdjacentElement('afterend', childrenEl);
      /* Depth = (paddingLeft - 10) / 14 + 1 */
      const depth = Math.round((parseInt(itemEl.style.paddingLeft || '10') - 10) / 14) + 1;
      await renderNode(childrenEl, dirPath, depth);
    }
  }

  function updateSelectedDirHighlight() {
    treeEl.querySelectorAll('.sidebar-dir').forEach(el => {
      el.classList.toggle('selected-dir', el.dataset.path === selectedDirPath);
    });
  }

/* ── Drop-zone event delegation on the tree container ─────────── */
  treeEl.addEventListener('dragover', (e) => {
    /* The sidebar tree is ALWAYS a valid drop target — for internal moves
       and for external OS files. Accept unconditionally so the drop fires
       and the webview can never navigate. We must NOT gate on
       dataTransfer.types here: WebKitGTK (Tauri/Linux) does not report
       "Files" during dragover, which previously dropped us into the
       no-preventDefault branch and let the OS file open as a URL. */
    e.preventDefault();
    e.dataTransfer.dropEffect = _dragItems.length ? 'move' : 'copy';

    /* Highlight the receiving folder. */
    treeEl.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    treeEl.classList.remove('drop-target-root');

    const targetEl = getDropTargetEl(e.target);
    if (targetEl) {
      targetEl.classList.add('drop-target');
    } else {
      /* Dropping to root — highlight the tree container itself */
      const targetPath = getDropTargetDir(e.target);
      if (targetPath === rootPath) treeEl.classList.add('drop-target-root');
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
    if (_dragItems.length) {
      /* Copy _dragItems before dragend clears it (spec says drop fires
         before dragend, but we copy defensively).                     */
      const itemsToMove = [..._dragItems];
      _dragItems = [];
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
      selectionAnchor = null;
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
        else if (hit.dir === rootPath) treeEl.classList.add('drop-target-root');
      },
      onLeave: clearHighlights,
      onDrop: (pos, paths) => {
        clearHighlights();
        const hit = pointToTarget(pos);
        if (!hit || !paths || !paths.length) return; // dropped outside the tree
        copyDroppedSources(paths.map((p) => ({ kind: 'path', path: p })), hit.dir);
      },
    }).catch(() => { /* listener registration failed — drop simply won't work */ });
  })();





  /* ══════════════════════════════════════════════════════════════════
     OPEN MEDIA FILE  (image/video — show preview, no text load)
  ══════════════════════════════════════════════════════════════════ */

  async function openMediaFile(filePath) {
    /* Save any dirty text file before switching away */
    if (isDirty && activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return;
    }

    /* Clear any previous state */
    activeFilePath                 = null;
    _mediaPreviewMode              = null;
    window._showingUnsupportedFile = false;

    /* The media file's own directory is the natural base for the relative
       path reference.  When the user types and auto-creates a .md file it
       goes into this same directory, keeping the reference correct.       */
    const mediaDir   = filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const pendingDir = mediaDir || selectedDirPath || rootPath;

    _mediaPreviewMode = {
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
    if (isDirty && activeFilePath) {
      const saved = await saveActiveFile();
      if (!saved) return;
    }

    activeFilePath                 = null;
    _mediaPreviewMode              = null;
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
    _mediaPreviewMode              = null;
    window._showingUnsupportedFile = false;

    /* Auto-save current file first — no modal, no friction */
    if (isDirty && activeFilePath) {
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

    activeFilePath = filePath;
    markClean();
    await window.NativeAPI.setLastOpenedFile(filePath);

    /* Update doc-title */
    if (docTitleEl) {
      const base = filePath.replace(/\\/g, '/').split('/').pop();
      docTitleEl.value = base.replace(/\.(md|txt)$/, '');
    }

    /* Re-run image fixup now that activeFilePath is current.
      render() fired above (via replaceEditorContent) before this assignment,
      so postProcessImages() had a stale base directory on that first pass. */
    if (typeof postProcessImages === 'function') postProcessImages();

    highlightActiveFile(filePath);
    switchFromMobileSidebar();
    startWatchingFile(filePath);
  }


  /* ══════════════════════════════════════════════════════════════════
     FILE / FOLDER CREATION
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Build an auto-incremented path like "untitled.md", "untitled_2.md", …
   * by peeking at the directory listing. Avoids overwriting existing files
   * without asking.
   */
  async function uniquePath(dir, baseName, ext) {
    const sep  = (dir.endsWith('/') || dir.endsWith('\\')) ? '' : '/';
    const base = baseName.replace(/_\d+$/, ''); // strip trailing _N before we start

    let names;
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      names = new Set(entries.map(e => e.name));
    } catch {
      /* Can't list the directory — return plain candidate and let
         createFile surface a useful OS error on collision. */
      return `${dir}${sep}${base}.${ext}`;
    }

    /* Try plain name first, then base_2, base_3, … */
    if (!names.has(`${base}.${ext}`)) return `${dir}${sep}${base}.${ext}`;
    let counter = 2;
    while (names.has(`${base}_${counter}.${ext}`)) counter++;
    return `${dir}${sep}${base}_${counter}.${ext}`;
  }

  /**
   * Creates a new empty .md file in targetDir, then opens it.
   * Called by the "+" toolbar button AND by actions.js newFile().
   */
  // AFTER
async function createNewFile(targetDir) {
    /* Auto-save current before switching */
    if (isDirty && activeFilePath) await saveActiveFile();

    const dir = targetDir || selectedDirPath || rootPath;
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
    const dir = targetDir || selectedDirPath || rootPath;
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
      selectedDirPath = dir;       
      
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

  /* Expose to the header buttons */
  if (btnNewFile)   btnNewFile.addEventListener('click',   () => createNewFile(selectedDirPath || rootPath));
  if (btnNewFolder) btnNewFolder.addEventListener('click', () => createNewFolder(selectedDirPath || rootPath));

  /* Expose to actions.js */
  window.sidebarCreateNewFile = () => createNewFile(selectedDirPath || rootPath);


  /* ══════════════════════════════════════════════════════════════════
     IMPORT (called by actions.js importFile in desktop mode)
  ══════════════════════════════════════════════════════════════════ */

  /**
   * Opens a file picker, then copies the chosen file into the active
   * folder (auto-incrementing the name if a clash exists), and opens it.
   * Auto-saves first so no work is lost.
   */
  window.sidebarImportFile = async function () {
    const dir = selectedDirPath || rootPath;
    if (!dir) {
      /* No folder open — fall back to the legacy in-browser import */
      if (typeof executeImport === 'function') executeImport();
      return;
    }


    /* Auto-save current file before switching folders */
    if (isDirty && activeFilePath) {
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


  /* ══════════════════════════════════════════════════════════════════
     RENAME / DELETE
  ══════════════════════════════════════════════════════════════════ */

// AFTER — only the first line and outer wrapper change; all inner logic is unchanged
async function renameNode(nodePath, type) {
    if (_operationLock) return;
    _operationLock = true;
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

        if (activeFilePath) {
          const normalActive = activeFilePath.replace(/\\/g, '/');
          const normalOld    = nodePath.replace(/\\/g, '/');
          const normalNew    = newPath.replace(/\\/g, '/');

          if (normalActive === normalOld) {
            activeFilePath = newPath;
            markClean();
            await window.NativeAPI.setLastOpenedFile(newPath);
            if (docTitleEl) {
              docTitleEl.value = finalName.replace(/\.(md|txt)$/, '');
            }
            startWatchingFile(newPath);
          } else if (normalActive.startsWith(normalOld + '/')) {
            const rel = normalActive.substring(normalOld.length);
            activeFilePath = normalNew + rel;
            await window.NativeAPI.setLastOpenedFile(activeFilePath);
            startWatchingFile(activeFilePath);
          }
        }

        if (selectedDirPath) {
          const normalSel = selectedDirPath.replace(/\\/g, '/');
          const normalOld = nodePath.replace(/\\/g, '/');
          const normalNew = newPath.replace(/\\/g, '/');

          if (normalSel === normalOld) {
            selectedDirPath = newPath;
          } else if (normalSel.startsWith(normalOld + '/')) {
            const rel = normalSel.substring(normalOld.length);
            selectedDirPath = normalNew + rel;
          }
        }

        await renderTree();
      } catch (err) {
        console.error('[Sidebar] renameNode failed:', err);
      }
    } finally {
      _operationLock = false;
    }
  }


async function deleteNode(nodePath, type) {
    if (_operationLock) return;
    _operationLock = true;
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

        if (activeFilePath) {
          const normalActive = activeFilePath.replace(/\\/g, '/');
          if (normalActive === normalNode || normalActive.startsWith(normalNode + '/')) {
            activeFilePath = null;
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

        if (selectedDirPath) {
          const normalSel = selectedDirPath.replace(/\\/g, '/');
          if (normalSel === normalNode || normalSel.startsWith(normalNode + '/')) {
            selectedDirPath = rootPath;
          }
        }

        await renderTree();
      } catch (err) {
        console.error('[Sidebar] deleteNode failed:', err);
      }


    } finally {
      _operationLock = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     CONTEXT MENU
  ══════════════════════════════════════════════════════════════════ */

  function showContextMenu(x, y, nodePath, type) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;

    /* If the right-clicked item is part of a multi-selection (≥2 items),
       show the bulk-action menu instead of the per-item menu.           */
    const isMulti = selectedItems.size > 1 && selectedItems.has(nodePath);
    const nodeCategory = type === 'file' ? getFileCategory(nodePath.replace(/\\/g, '/').split('/').pop()) : 'dir';

    const items = isMulti
      ? [
          { label: `Rename ${selectedItems.size} items…`, action: () => renameSelectedNodes() },
          { label: `Delete ${selectedItems.size} items`,  action: () => deleteSelectedNodes(), danger: true },
        ]
      : type === 'dir'
      ? [
          { label: 'New File Here',    action: () => createNewFile(nodePath) },
          { label: 'New Folder Here',  action: () => createNewFolder(nodePath) },
          { label: 'Rename',           action: () => renameNode(nodePath, 'dir') },
          { sep: true },
          { label: 'Show in Explorer', action: () => window.NativeAPI.showInExplorer(nodePath) },
          { label: 'Delete',           action: () => deleteNode(nodePath, 'dir'), danger: true },
        ]
      : nodeCategory === 'text'
      ? [
          { label: 'Open',             action: () => openFile(nodePath) },
          { label: 'Rename',           action: () => renameNode(nodePath, 'file') },
          { sep: true },
          { label: 'Show in Explorer', action: () => window.NativeAPI.showInExplorer(nodePath) },
          { label: 'Delete',           action: () => deleteNode(nodePath, 'file'), danger: true },
        ]
      : nodeCategory === 'media'
      ? [
          { label: 'Preview',          action: () => openMediaFile(nodePath) },
          { label: 'Rename',           action: () => renameNode(nodePath, 'file') },
          { sep: true },
          { label: 'Show in Explorer', action: () => window.NativeAPI.showInExplorer(nodePath) },
          { label: 'Delete',           action: () => deleteNode(nodePath, 'file'), danger: true },
        ]
      : /* other/unsupported */ [
          { label: 'Rename',           action: () => renameNode(nodePath, 'file') },
          { sep: true },
          { label: 'Show in Explorer', action: () => window.NativeAPI.showInExplorer(nodePath) },
          { label: 'Delete',           action: () => deleteNode(nodePath, 'file'), danger: true },
        ];

    menu.innerHTML = '';
    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border,#3a3a3a);margin:3px 6px;';
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (item.danger ? ' menu-danger' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        menu.style.display = '';
        menu.classList.remove('show');
        item.action();
      });
      menu.appendChild(btn);
    });

    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 185;
    const rowCount = items.filter(i => !i.sep).length;
    const sepCount = items.filter(i =>  i.sep).length;
    const mh = rowCount * 32 + sepCount * 7 + 8;
    menu.style.left    = Math.min(x, vw - mw - 8) + 'px';
    menu.style.top     = Math.min(y, vh - mh - 8) + 'px';
    menu.style.display = '';
    menu.classList.add('show');
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('context-menu');
    if (menu) {
      menu.style.display = '';
      menu.classList.remove('show');
    }
    /* Clear multi-selection when the user clicks outside the sidebar tree */
    if (!treeEl.contains(e.target) && selectedItems.size > 0) {
      selectedItems.clear();
      selectionAnchor = null;
      updateMultiSelectHighlight();
    }
  });


  /* ══════════════════════════════════════════════════════════════════
     ACTIVE FILE HIGHLIGHTING
  ══════════════════════════════════════════════════════════════════ */

  function highlightActiveFile(filePath) {
    if (sidebarViewMode === 'card') {
      highlightActiveFileCards(filePath);
      return;
    }
    treeEl.querySelectorAll('.sidebar-file').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath);
    });
  }


  /* ══════════════════════════════════════════════════════════════════
     EXTERNAL FILE WATCHER
  ══════════════════════════════════════════════════════════════════ */

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
      if (filePath !== activeFilePath) return;
      if (Date.now() < _suppressWatchUntil) return;

      /* If we are already inside the dialog flow for an earlier event,
         additional events from the external program are coalesced into
         the open dialog. Without this guard, a sequence of external
         writes would stack multiple dialogs. */
      if (_externalChangeInProgress) return;

      /* Synchronously cancel any pending autosave so a save can't enqueue
         on _diskOpsChain between this point and the verify op below. The
         verify op also sets _externalChangeInProgress inside the lock, so
         any save that DOES enqueue concurrently will see that flag and
         bail; this clearTimeout is just an optimization to avoid doing
         that work in the common case. */
      clearTimeout(_autoSaveTimer);

      /* ── Verify under lock ────────────────────────────────────────────
         Reading disk and setting _externalChangeInProgress happens in
         the same lock op. Saves enqueued AFTER us in the chain see the
         flag and bail. Saves IN-FLIGHT when we entered the lock-queue
         finished their writeFile first; their _suppressWatchUntil set
         inside the same lock means we re-detect it and short-circuit
         (so we don't fire a false-positive dialog after our own save).  */
      let diskContent;
      try {
        diskContent = await _enqueueDiskOp(async () => {
          // A save that ran just ahead of us in the chain may have set
          // _suppressWatchUntil — re-check inside the lock.
          if (Date.now() < _suppressWatchUntil) return null;
          // The user may have switched files while we waited in the queue.
          if (filePath !== activeFilePath) return null;

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
          _externalChangeInProgress = true;
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
         _externalChangeInProgress flag (set above, inside the lock) is
         what keeps saves out — not lock holding. The finally block
         below clears the flag once the dialog flow is done.            */
      try {
        const dialogButtons = isDirty
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
          detail: isDirty
            ? 'You have unsaved changes. "Reload from disk" discards them. "Save my version & reload" writes your unsaved edits to a new file alongside the original, then loads the latest disk version. "Keep my version" leaves the editor untouched and pauses auto-save for this file — the disk keeps the external version until you save manually (Ctrl+S), switch files, or close (which writes your version).'
            : 'Do you want to reload the latest version?',
        });

        const choice = dialogButtons[result.response];

        if (choice === 'Reload from disk') {
          /* Read fresh and swap the editor under the lock. Bumping
             _replaceGeneration inside the lock guarantees that any
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
              _replaceGeneration++;
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
                _replaceGeneration++;
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
        _externalChangeInProgress = false;
        /* If we leave this flow still dirty, the user either chose "Keep my
           version" or a copy/reload step failed — in every such case the
           disk holds content the editor does not, and background autosave
           would silently destroy it (the exact behavior the dialog promised
           NOT to do). Hold autosave for this file; explicit saves lift it. */
        if (isDirty) _conflictHoldPath = filePath;
      } });
           










    _watchedPath = filePath;
  }


  /* ══════════════════════════════════════════════════════════════════
     SIDEBAR DIVIDER DRAG
  ══════════════════════════════════════════════════════════════════ */

  let sbDragging = false, sbStartX = 0, sbStartW = 0;
  const MIN_SIDEBAR_W = 160, MAX_SIDEBAR_W = 1200;

  if (sidebarDivider) {
    sidebarDivider.addEventListener('mousedown', (e) => {
      sbDragging = true;
      sbStartX   = e.clientX;
      sbStartW   = sidebarPanel.getBoundingClientRect().width;
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (!sbDragging) return;
    const newW = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, sbStartW + (e.clientX - sbStartX)));
    sidebarPanel.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!sbDragging) return;
    sbDragging = false;
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    
    // Save the exact pixel width the user just dragged to
    window.savedSidebarWidth = sidebarPanel.style.width;
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  });

/* ══════════════════════════════════════════════════════════════════════
   Unified close-time handler (Cluster D #8)
   ══════════════════════════════════════════════════════════════════════
   */
async function sidebarHandleClose() {
  clearTimeout(_autoSaveTimer);

// Case 1: A real file is open on disk
  if (activeFilePath) {
    if (isDirty) {
      let saved = false;
      for (let attempt = 0; attempt < 3 && isDirty; attempt++) {
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
        const baseName = activeFilePath.replace(/\\/g, '/').split('/').pop();
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
    if (isDirty && typeof window.NativeAPI.writeVolatileNow === 'function') {
      try { await window.NativeAPI.writeVolatileNow(activeFilePath, editor.value); } catch (_) {}
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

window.sidebarHandleClose = sidebarHandleClose;
window.NativeAPI.onWindowClose(sidebarHandleClose);




  
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
      if (info.originalPath === _scratchpadVolatileKey) continue; // this session's own key

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
      const dir = selectedDirPath || rootPath;

      if (!dir) {
        /* No project folder open: adopt the backup as the LIVE scratchpad.
           replaceEditorContent does not fire input listeners, so the
           auto-create flow stays dormant until the user actually types.
           Reusing the OLD key as _scratchpadVolatileKey makes the existing
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
        _scratchpadVolatileKey = info.originalPath;
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

        /* Defensive: our own write must not register as an external change
           with the watcher openFile() is about to install. */
        _suppressWatchUntil = Date.now() + SUPPRESS_MS;

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

  (async function bootSidebar() {
    let hasLoadedText = false;

    // Helper: Safely injects the starter guide if no file exists to open
    function injectStarterText() {
      if (hasLoadedText) return;
      hasLoadedText = true;
      const initialText = `# Revery Notebook\n\nA place to write digital notes, free from distractions and to keep the _thoughts-to-computer text_ process in one continuous flow. A markdown editor with the iconic ½ font.\n\n---\n\n## Quick Guide\n\nIn the upper right corner, settings can be personalized. You can adjust the various sizes for the interface elements and tune the performance for your hardware. Press \`CTRL+S\` to download your work as a \`.md\` file, using the name specified in the upper-left corner. In the settings you can also set how the file name prefix/suffix should be named.\n\nMore information, click the ½ logo in the center top of the screen.\n\n---\n###### - Harald Revery\n`;
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


      try {
        const journal = (typeof window.NativeAPI.getPendingRename === 'function')
          ? await window.NativeAPI.getPendingRename()
          : null;

        if (journal
            && typeof journal.from === 'string'
            && typeof journal.to   === 'string'
            && lastFile === journal.from) {

          let fromExists = false;
          try {
            await window.NativeAPI.readFile(journal.from);
            fromExists = true;
          } catch { /* ENOENT or unreadable */ }

          if (!fromExists) {
            let toExists = false;
            try {
              await window.NativeAPI.readFile(journal.to);
              toExists = true;
            } catch { /* ENOENT or unreadable */ }

            if (toExists) {
              // Bug case detected — the rename completed but
              // setLastOpenedFile didn't. Repair the pointer.
              console.info(
                '[Sidebar Boot] Reconciling pending rename: %s → %s',
                journal.from, journal.to
              );
              lastFile = journal.to;
              try {
                await window.NativeAPI.setLastOpenedFile(journal.to);
              } catch (e) {
                console.warn('[Sidebar Boot] Could not persist reconciled lastOpenedFile:', e);
                // Fall through with the corrected in-memory value anyway —
                // worst case the next boot re-reconciles.
              }
            }
            // else: neither path exists → leave lastFile alone, normal
            // error path will handle it (injectStarterText + clear).
          }
        }

        // Always clear the journal after consultation. Non-fatal on failure.
        if (journal && typeof window.NativeAPI.setPendingRename === 'function') {
          window.NativeAPI.setPendingRename(null).catch(e =>
            console.warn('[Sidebar Boot] Could not clear rename journal:', e)
          );
        }
      } catch (e) {
        console.warn('[Sidebar Boot] Pending-rename reconciliation failed (non-fatal):', e);
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
            _cachedProjects = nativeHistory; 
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
          rootPath        = folder;
          await window.NativeAPI.setRootPath(folder);
          selectedDirPath = folder;
          const parts = folder.replace(/\\/g, '/').split('/');
          folderNameEl.textContent = parts[parts.length - 1] || folder;
          expandedDirs.clear();
          expandedDirs.add(folder);

          await recordProjectOpen(folder);
          cardViewDir = folder;

          if (lastFile && lastFile.replace(/\\/g, '/').startsWith(folder.replace(/\\/g, '/'))) {
            const relPath = lastFile.replace(/\\/g, '/').substring(folder.length).replace(/^\//, '');
            const relParts = relPath.split('/');
            relParts.pop(); 
            let currentPath = folder.replace(/\\/g, '/');
            for (const p of relParts) {
              currentPath += '/' + p;
              expandedDirs.add(currentPath);
            }
            selectedDirPath = currentPath; 
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
              
              activeFilePath = lastFile;
              markClean();
              highlightActiveFile(lastFile);
              startWatchingFile(lastFile);
              
              if (docTitleEl) {
                const base = lastFile.replace(/\\/g, '/').split('/').pop();
                docTitleEl.value = base.replace(/\.(md|txt)$/, '');
              }

              /* ── Crash recovery check ── */
              try {
                const backup = await window.NativeAPI.getVolatileContent(lastFile);
                if (backup && backup.content !== diskContent) {
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

                  const choice = await window.NativeAPI.showMessageBox({
                    type:      suspicious ? 'warning' : 'question',
                    title:     'Recover unsaved changes?',
                    message:   suspicious
                      ? 'A crash backup was found, but it looks incomplete.'
                      : 'Unsaved changes from a previous session were found.',
                    detail:    suspicious
                      ? `Last edited: ${ts}\n\nThe backup is ${backupLen === 0 ? 'empty' : 'much shorter than the saved file'} (${backupLen} vs ${diskLen} characters) — it was likely damaged by the crash itself. Restoring it would REPLACE your saved file with this incomplete content.\n\nRecommended: keep the saved version.`
                      : `Last edited: ${ts}\n\nRestore these changes, or discard and keep the saved version.`,
                    buttons:   suspicious
                      ? ['Restore incomplete backup', 'Keep saved version']
                      : ['Restore', 'Discard'],
                    defaultId: suspicious ? 1 : 0,
                    cancelId:  1,
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
        rootPath        = defaultFolder;
        await window.NativeAPI.setRootPath(defaultFolder);
        try { localStorage.setItem('revery_root_path', rootPath); } catch (e) {}
        recordProjectOpen(defaultFolder);
        selectedDirPath = defaultFolder;
        cardViewDir = defaultFolder;
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

})(); // end IIFE

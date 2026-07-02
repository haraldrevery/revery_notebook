/* tree.js — tree rendering, sorting, expand/collapse, multi-select
   helpers, context menu, active-file highlighting. */
import { S, treeEl, btnSortBtn, btnToggleAll, expandedDirs, selectedItems, _previewCache } from './state.js';
import { getFileCategory, mediaMarkdown } from './helpers.js';
import { icon } from './icons.js';
import { renderCards, highlightActiveFileCards } from './cards.js';
import { openFile, openMediaFile, openUnsupportedFile, createNewFile, createNewFolder,
         renameNode, deleteNode, renameSelectedNodes, deleteSelectedNodes } from './fileops.js';

let _treeRenderGeneration = 0;   // cancels stale chunked renders

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

/* Built lazily so window.t is not called at module-evaluation time
   (the bundle is also parsed in web mode, where the sidebar never runs). */
let SORT_OPTIONS = null;
function getSortOptions() {
  if (!SORT_OPTIONS) {
    SORT_OPTIONS = [
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
  }
  return SORT_OPTIONS;
}

  function showSortMenu(anchorEl) {
    /* Remove any existing sort menu */
    const existing = document.getElementById('sidebar-sort-menu');
    if (existing) { existing.remove(); return; } // toggle off

    const menu = document.createElement('div');
    menu.id        = 'sidebar-sort-menu';
    menu.className = 'sidebar-sort-menu';

    getSortOptions().forEach(opt => {
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
    if (S.rootPath) expandedDirs.add(S.rootPath); // keep root visible
  }

  function updateToggleAllBtn() {
  if (!btnToggleAll) return;
  /* Any expanded dir beyond root means we're in "expanded" state */
  const anyExpanded = [...expandedDirs].some(p => p !== S.rootPath);
  if (anyExpanded) {
    btnToggleAll.textContent = '▴▴';
    btnToggleAll.title = window.t('Collapse all folders');
  } else {
    btnToggleAll.textContent = '▾▾';
    btnToggleAll.title = window.t('Expand all folders');
  }
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
        S.selectionAnchor = path;
      }
      updateMultiSelectHighlight();
      if (type === 'dir') { S.selectedDirPath = path; updateSelectedDirHighlight(); }
      return;
    }

    if (e.shiftKey && S.selectionAnchor) {
      e.stopPropagation();
      const allPaths = getVisibleItems().map(el => el.dataset.path);
      const ai = allPaths.indexOf(S.selectionAnchor);
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
    S.selectionAnchor = path;

    if (type === 'dir') {
      S.selectedDirPath = path;
      updateSelectedDirHighlight();
      toggleDir(path, itemEl, containerEl);
    } else {
      openFile(path);
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

  /* Smaller chunks in slow hardware mode = more paint yields on weak CPUs */
  const CHUNK = window.slowHardwareMode ? 40 : 100; // yield to the browser every N items

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
        if (entry.path === S.selectedDirPath) itemEl.classList.add('selected-dir');
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
          iconEl.replaceChildren(icon(entry.name.endsWith('.md') ? 'file' : 'file-lines'));
        } else if (category === 'media') {
          iconEl.replaceChildren(icon('image'));
        } else {
          iconEl.replaceChildren(icon('paperclip'));
        }

        itemEl.classList.add('sidebar-file');
        if (category === 'media')       itemEl.classList.add('sidebar-media');
        if (category === 'other')       itemEl.classList.add('sidebar-unsupported');
        if (entry.path === S.activeFilePath) itemEl.classList.add('active');
        if (selectedItems.has(entry.path)) itemEl.classList.add('multi-selected');
        /* Highlight if this is the currently previewed media file */
        if (S._mediaPreviewMode && S._mediaPreviewMode.mediaPath === entry.path) {
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
              S.selectionAnchor = entry.path;
              openMediaFile(entry.path);
            }
          } else {
            /* Unsupported: allow multi-select, but plain click = show message */
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleItemClick(e, entry.path, 'file', itemEl, containerEl);
            } else {
              selectedItems.clear();
              updateMultiSelectHighlight();
              S.selectionAnchor = entry.path;
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
          S.selectionAnchor = entry.path;
          updateMultiSelectHighlight();
        }
        /* Collect all selected items (preserving DOM order = tree order) */
        S._dragItems = getVisibleItems()
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
          ? mediaMarkdown(entry.path) // uses S.activeFilePath or S.rootPath as base
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
        S._dragItems = [];
      });

      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, entry.path, entry.type);
      });
    }
  }


async function renderTree() {
  if (!S.rootPath) return;

  /* In card view mode, delegate to renderCards instead */
  if (S.sidebarViewMode === 'card') {
    const dir = S.cardViewDir || S.rootPath;
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
  await renderNode(treeEl, S.rootPath, 0, generation);   // ← pass generation
  if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);
  highlightActiveFile(S.activeFilePath);
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
      el.classList.toggle('selected-dir', el.dataset.path === S.selectedDirPath);
    });
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

  /* ══════════════════════════════════════════════════════════════════
     ACTIVE FILE HIGHLIGHTING
  ══════════════════════════════════════════════════════════════════ */

  function highlightActiveFile(filePath) {
    if (S.sidebarViewMode === 'card') {
      highlightActiveFileCards(filePath);
      return;
    }
    treeEl.querySelectorAll('.sidebar-file').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath);
    });
  }

export { sortEntries, renderTree, updateMultiSelectHighlight, getVisibleItems,
         updateSelectedDirHighlight, showContextMenu, highlightActiveFile,
         updateToggleAllBtn };

export function initTree() {
  if (btnSortBtn) {
    btnSortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showSortMenu(btnSortBtn);
    });
  }

  if (btnToggleAll) {
    btnToggleAll.addEventListener('click', async () => {
      if (!S.rootPath) return;
      const anyExpanded = [...expandedDirs].some(p => p !== S.rootPath);
      if (anyExpanded) {
        collapseAllDirs();
        await renderTree();
      } else {
        await expandAllDirs(S.rootPath, 0);
        await renderTree();
      }
      updateToggleAllBtn();
    });
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
      S.selectionAnchor = null;
      updateMultiSelectHighlight();
    }
  });
}

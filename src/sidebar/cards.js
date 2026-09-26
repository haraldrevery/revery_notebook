/* cards.js — card view: grid rendering, previews, view-mode toggle. */
import { S, treeEl, btnViewBtn, btnToggleAll, btnSortBtn, selectedItems, _previewCache } from './state.js';
import { stripMarkdownForPreview, getFileCategory, setSidebarDragData } from './helpers.js';
import { sortEntries, renderTree, updateMultiSelectHighlight, showContextMenu } from './tree.js';
import { openFile, openMediaFile, openUnsupportedFile } from './fileops.js';
import { icon } from './icons.js';
import { samePath, isInsideRoot, baseNameOf, normalizePath, parentPathOf } from './paths.js';

let _cardGeneration = 0;

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
    const isActive = (entry.path === S.activeFilePath);
    const isMediaPrev = (S.previewMediaPath === entry.path);

    const card = document.createElement('div');
    card.className   = 'sidebar-card';
    card.dataset.path = entry.path;
    card.dataset.type = entry.type;
    if (entry.link) {
      card.dataset.link = '1';
      card.title = entry.name + ' — ' + window.t('Link');
    }
    if (entry.type === 'dir')         card.classList.add('sidebar-card-dir');
    else if (category === 'media')    card.classList.add('sidebar-card-media');
    else if (category === 'other')    card.classList.add('sidebar-card-other');
    else if (category === 'text')     card.classList.add('sidebar-card-text');
    if (isActive || isMediaPrev)      card.classList.add('sidebar-card-active');

    /* ── Thumbnail area ── */
    const thumb = document.createElement('div');
    thumb.className = 'sidebar-card-thumb';

    if (entry.type === 'dir') {
      thumb.replaceChildren(icon('folder'));

    } else if (entry.link) {
      /* A link (to a file or a folder): the link glyph, no preview —
         nothing is read or loaded through it just to draw a card. */
      thumb.replaceChildren(icon('link'));

    } else if (category === 'media' && window.slowHardwareMode) {
      /* Slow hardware mode: skip the JPEG decode entirely — icon only */
      thumb.replaceChildren(icon('image'));

    } else if (category === 'media') {
      /* Try to show the actual image */
      const img = document.createElement('img');
      /* The CARD owns the drag (same rule as the tree row's children in
         tree.js): an <img> is draggable on its own, so grabbing the
         picture started a native image drag instead of the card's. */
      img.draggable = false;
      img.alt   = entry.name;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      /* toMediaUrl is synchronous — no await needed */
      try {
        img.src = window.NativeAPI.toMediaUrl(entry.path);
      } catch {
        thumb.replaceChildren(icon('image'));
      }
      /* Fall back to emoji if image fails to load */
      img.onerror = () => { thumb.replaceChildren(icon('image')); };
      thumb.appendChild(img);

    } else if (category === 'text') {
      thumb.replaceChildren(icon(entry.name.endsWith('.md') ? 'file' : 'file-lines'));

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

    if (category === 'text' && !entry.link && !window.slowHardwareMode) {
      /* Fire-and-forget preview load — card shows immediately.
         Skipped in slow hardware mode: opening a folder in card view
         would otherwise read every text file in it off a slow disk. */
      loadCardPreview(entry.path, previewEl, generation);
    } else if (entry.type === 'dir') {
      previewEl.textContent = window.t('Folder');
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
          else { selectedItems.add(entry.path); S.selectionAnchor = entry.path; }
        } else if (e.shiftKey && S.selectionAnchor) {
          const allPaths = Array.from(treeEl.querySelectorAll('.sidebar-card')).map(el => el.dataset.path);
          const ai = allPaths.indexOf(S.selectionAnchor);
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
        if (entry.type === 'dir') S.selectedDirPath = entry.path;
        return;
      }

      if (selectedItems.size > 0) {
        selectedItems.clear();
        updateMultiSelectHighlight();
      }
      S.selectionAnchor = entry.path;

      if (entry.type === 'dir') {
        /* Navigate into the folder */
        S.cardViewDir = entry.path;
        _previewCache.clear();
        S.selectedDirPath = entry.path;
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
      showContextMenu(e.clientX, e.clientY, entry.path, entry.type, !!entry.link);
    });

    /* ── Drag-and-drop for cards ── */
    card.draggable = true;

    card.addEventListener('dragstart', (e) => {
      if (!selectedItems.has(entry.path)) {
        selectedItems.clear();
        selectedItems.add(entry.path);
        S.selectionAnchor = entry.path;
        updateMultiSelectHighlight();
      }
      S._dragItems = Array.from(treeEl.querySelectorAll('.sidebar-card'))
        .filter(el => selectedItems.has(el.dataset.path))
        .map(el => ({ path: el.dataset.path, type: el.dataset.type }));

      /* Same payloads as a tree row: the whole selection (helpers.js). */
      setSidebarDragData(e.dataTransfer, S._dragItems);

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
      S._dragItems = [];
    });

    return card;
  }
  
  /* ══════════════════════════════════════════════════════════════════
     NAVIGATION BAR — path bar, or Back + crumb
     Path bar: every folder from the project root down to the one shown,
     each ancestor a button (click: go there; drop cards on it: move them
     there). When it does not fit the panel's width it falls back to the
     compact bar: "← Back" (click: up; drop: move to the parent folder)
     plus the current folder's name. Drop targets carry data-drop-dir;
     dnd.js accepts it only for folders inside the project, and never
     offers the project root's parent (the bar starts at the root).
     Paths are sliced from the shown folder's own spelling, so they equal
     the folder listing's strings.
  ══════════════════════════════════════════════════════════════════ */

  /** [{ path, label }] from the project root down to dirPath. */
  function pathSegments(dirPath) {
    const root = S.rootPath;
    const segs = [{ path: root, label: baseNameOf(root) || root }];
    if (!root || samePath(dirPath, root) || !isInsideRoot(dirPath, root)) return segs;
    const start = normalizePath(root).length;
    for (let i = start + 1; i <= dirPath.length; i++) {
      if (i === dirPath.length || dirPath[i] === '/' || dirPath[i] === '\\') {
        const p = dirPath.slice(0, i);
        if (p.length > start && !samePath(p, segs[segs.length - 1].path)) {
          segs.push({ path: p, label: baseNameOf(p) });
        }
      }
    }
    return segs;
  }

  function navigateTo(dir) {
    if (!dir || !S.rootPath || !isInsideRoot(dir, S.rootPath)) return;
    S.cardViewDir = dir;
    S.selectedDirPath = dir;
    _previewCache.clear();
    renderCards(dir);
  }

  function buildPathBar(dirPath) {
    const navEl = document.createElement('div');
    navEl.className = 'sidebar-card-nav sidebar-card-path';
    const segs = pathSegments(dirPath);
    segs.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sidebar-card-sep';
        sep.textContent = '›';
        navEl.appendChild(sep);
      }
      if (i === segs.length - 1) {
        const cur = document.createElement('span');
        cur.className = 'sidebar-card-crumb';
        cur.textContent = seg.label;
        cur.title = seg.path;
        navEl.appendChild(cur);
      } else {
        const b = document.createElement('button');
        b.className = 'sidebar-card-seg';
        b.textContent = seg.label;
        b.title = window.t('Go to "{name}" — or drop items here to move them there').replace('{name}', seg.label);
        b.dataset.dropDir = seg.path;
        b.addEventListener('click', () => navigateTo(seg.path));
        navEl.appendChild(b);
      }
    });
    return navEl;
  }

  function buildCompactNav(dirPath) {
    const navEl = document.createElement('div');
    navEl.className = 'sidebar-card-nav';
    const atRoot = !S.rootPath || samePath(dirPath, S.rootPath) || !isInsideRoot(dirPath, S.rootPath);
    if (!atRoot) {
      const parent = parentPathOf(dirPath);
      const backBtn = document.createElement('button');
      backBtn.className   = 'sidebar-card-back';
      backBtn.textContent = '← ' + window.t('Back');
      backBtn.title       = window.t('Go up one level — or drop items here to move them there');
      backBtn.dataset.dropDir = parent;
      backBtn.addEventListener('click', () => navigateTo(parent));
      navEl.appendChild(backBtn);
    }
    const crumbEl = document.createElement('span');
    crumbEl.className   = 'sidebar-card-crumb';
    crumbEl.textContent = baseNameOf(dirPath) || dirPath;
    crumbEl.title       = dirPath;
    navEl.appendChild(crumbEl);
    return navEl;
  }

  let _navDir = null;
  function buildNav(dirPath) {
    _navDir = dirPath;
    return buildPathBar(dirPath);
  }

  /* Path bar when it fits, otherwise the compact bar. Re-checked when the
     panel is resized. Only the bar is replaced — never the grid, so a drag
     in progress keeps its source element. */
  function fitNav() {
    const nav = treeEl.querySelector('.sidebar-card-nav');
    if (!nav || !_navDir) return;
    let bar = nav;
    if (!bar.classList.contains('sidebar-card-path')) {
      bar = buildPathBar(_navDir);
      nav.replaceWith(bar);
    }
    if (bar.scrollWidth > bar.clientWidth + 1) bar.replaceWith(buildCompactNav(_navDir));
  }

  let _navObserver = null;
  let _navLastWidth = -1;
  function observeNavWidth() {
    if (_navObserver || typeof ResizeObserver !== 'function') return;
    _navObserver = new ResizeObserver(() => {
      if (S.sidebarViewMode !== 'card') return;
      const w = treeEl.clientWidth;
      if (w === _navLastWidth) return;
      _navLastWidth = w;
      fitNav();
    });
    _navObserver.observe(treeEl);
  }

  /**
   * Render the card grid for `dirPath`.
   * Replaces the tree content entirely — the tree is rebuilt when the
   * user switches back to tree view.
   */
  async function renderCards(dirPath) {
    if (!dirPath) return;
    /* The card view never shows a folder outside the project. */
    if (S.rootPath && !isInsideRoot(dirPath, S.rootPath)) {
      dirPath = S.rootPath;
      S.cardViewDir = dirPath;
    }

    /* Bump generation so any in-flight preview loads for a previous render
       will notice they are stale and stop updating the DOM.              */
    const generation = ++_cardGeneration;

    treeEl.innerHTML = '';
    treeEl.scrollTop = 0;
    treeEl.classList.add('sidebar-card-view');

    /* ── Navigation bar ── */
    treeEl.appendChild(buildNav(dirPath));
    fitNav();

    /* ── Loading indicator ── */
    const loadingEl = document.createElement('div');
    loadingEl.className   = 'sidebar-loading';
    loadingEl.textContent = window.t('Loading…');
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
      empty.textContent = window.t('Empty folder');
      treeEl.appendChild(empty);
      return;
    }

    const gridEl = document.createElement('div');
    gridEl.className = 'sidebar-cards-grid';

    for (const entry of entries) {
      gridEl.appendChild(buildCard(entry, generation));
    }

treeEl.appendChild(gridEl);
    /* Re-assert top scroll after the async gap: scrollTop is only clamped
       at a layout flush, so if readDirectory resolved before the next
       paint a stale offset from the previous view could survive into the
       fresh grid, hiding the nav bar under the sidebar header. */
    treeEl.scrollTop = 0;
    /* Apply the user's saved card size to the freshly-built grid */
    applyCardSize();
    /* Highlight active file */
    highlightActiveFileCards(S.activeFilePath);
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
    const isCard = (S.sidebarViewMode === 'card');
    if (btnToggleAll) btnToggleAll.style.display = isCard ? 'none' : '';
    if (btnSortBtn)   btnSortBtn.style.display   = isCard ? 'none' : '';
    const btnSmaller = document.getElementById('sidebar-card-smaller');
    const btnLarger  = document.getElementById('sidebar-card-larger');
    if (btnSmaller) btnSmaller.style.display = isCard ? '' : 'none';
    if (btnLarger)  btnLarger.style.display  = isCard ? '' : 'none';
    if (isCard) {
    btnViewBtn.replaceChildren(icon('view-list'));
    btnViewBtn.title = window.t('Switch to list view');
  } else {
    btnViewBtn.replaceChildren(icon('view-cards'));
    btnViewBtn.title = window.t('Switch to card view');
  }
}
  async function setViewMode(mode) {
    S.sidebarViewMode = mode;
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
      /* Start card view at the current directory, or S.rootPath */
      S.cardViewDir = S.selectedDirPath || S.rootPath;
      _previewCache.clear();
      _cardGeneration++;
      await renderCards(S.cardViewDir);
    } else {
      /* Restore tree view */
      treeEl.classList.remove('sidebar-card-view');
      _cardGeneration++; // cancel any pending card preview loads
      await renderTree();
    }
  }

export { renderCards, highlightActiveFileCards, updateViewBtn, setViewMode };

export function initCardView() {
  observeNavWidth();
  if (btnViewBtn) {
    btnViewBtn.addEventListener('click', async () => {
      await setViewMode(S.sidebarViewMode === 'card' ? 'tree' : 'card');
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
}

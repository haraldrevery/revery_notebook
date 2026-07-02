/* cards.js — card view: grid rendering, previews, view-mode toggle. */
import { S, treeEl, btnViewBtn, btnToggleAll, btnSortBtn, selectedItems, _previewCache } from './state.js';
import { stripMarkdownForPreview, getFileCategory, mediaMarkdown } from './helpers.js';
import { sortEntries, renderTree, updateMultiSelectHighlight, showContextMenu } from './tree.js';
import { openFile, openMediaFile, openUnsupportedFile } from './fileops.js';
import { icon } from './icons.js';

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
    const isMediaPrev = (S._mediaPreviewMode && S._mediaPreviewMode.mediaPath === entry.path);

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
      thumb.replaceChildren(icon('folder'));

    } else if (category === 'media') {
      /* Try to show the actual image */
      const img = document.createElement('img');
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
      showContextMenu(e.clientX, e.clientY, entry.path, entry.type);
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
      S._dragItems = [];
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
    const normRoot = (S.rootPath || '').replace(/\\/g, '/');
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
        S.cardViewDir = parent;
        S.selectedDirPath = parent;
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

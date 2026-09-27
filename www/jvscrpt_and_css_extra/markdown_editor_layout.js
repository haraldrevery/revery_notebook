// editor-layout.js

/* Helper to get X coordinate from either mouse or touch events */
const getClientX = (e) => e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;

/* ── Drag divider (editor / preview) ── */
let dragging = false, startX = 0, startLeft = 0, maxLeft = 0;

const onDividerStart = e => {
  e.preventDefault();               // ← prevents native drag-and-drop & default touch behaviors
  dragging = true; 
  startX = getClientX(e);
  startLeft = edPane.getBoundingClientRect().width;
  /* The editor may only take what the preview can spare above its 200px
     minimum (the old workspace-based cap ignored the sidebar, so the
     preview could be dragged off-screen with the sidebar open). */
  maxLeft = startLeft + Math.max(0, prPane.getBoundingClientRect().width - 200);
  divider.classList.add('dragging');
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
};

divider.addEventListener('mousedown', onDividerStart);
// Add { passive: false } to allow e.preventDefault() to block native scrolling during drag
divider.addEventListener('touchstart', onDividerStart, { passive: false });

const onDocumentMove = e => {
  if (!dragging && !outlineDragging && !readerDragging) return;

  // Prevent the browser from hijacking the drag gesture to scroll the page
  if (e.cancelable) e.preventDefault();

  const currentX = getClientX(e);

  if (dragging) {
    /* Mirrored layout puts the editor on the divider's OTHER side, so the
       same pointer movement must change its width in the other direction. */
    const dir = window.flipLayout ? -1 : 1;
    const newLeft = Math.min(Math.max(startLeft + dir * (currentX - startX), 200), maxLeft);
    edPane.style.width = newLeft + 'px';
    edPane.style.flex = '0 1 auto'; // may shrink on a smaller window — see applyPaneLayout
  }

  if (outlineDragging) {
    /* Dragging left widens the outline; dragging right narrows it —
       inverted when the layout is mirrored (outline sits far LEFT). */
    const total = workspace.getBoundingClientRect().width;
    const outlinePane = document.getElementById('outline-pane');
    const outlineDir = window.flipLayout ? 1 : -1;
    const newWidth = Math.min(Math.max(outlineStartWidth + outlineDir * (currentX - outlineStartX), 140), Math.min(420, total - 400));
    outlinePane.style.width = newWidth + 'px';
    /* Desktop overlay mode: the divider is position:absolute and anchors
       at `right: var(--outline-pane-w)` — keep it glued to the pane edge */
    document.documentElement.style.setProperty('--outline-pane-w', newWidth + 'px');
  }

  if (readerDragging) {
    /* Symmetric resize around the column's center. LIVE feedback is
       applied at most once per frame: every max-width change reflows
       the column (and makes CodeMirror re-measure in live preview), so
       unthrottled mousemove writes would jank large documents. The
       FINAL width is computed synchronously on mouseup from the last
       pointer position — never from the throttled value, which can be
       a frame stale on a fast flick.                                 */
    readerDragSawMove = true;
    readerDragPendingX = currentX;
    if (!readerDragRaf) {
      readerDragRaf = requestAnimationFrame(() => {
        readerDragRaf = null;
        document.documentElement.style.setProperty(
          readerDragKind === 'editor' ? '--editor-max-width' : '--reader-max-width',
          readerDragWidthAt(readerDragPendingX) + 'px');
      });
    }
  }
};

/* The TEXT width for a pointer position: the grabbed edge is the
   column's border box, which carries the surface's own side margins
   (live preview / classic editor; 0 for the preview's .prose) — those
   are subtracted, since the width vars hold the text alone. Floor
   120px (ColumnWidths.MIN), capped at what the container can show. */
function readerDragWidthAt(x) {
  return Math.round(Math.min(
    Math.max(2 * Math.abs(x - readerDragCenterX) - readerDragPadX, 120),
    readerDragMaxW
  ));
}

document.addEventListener('mousemove', onDocumentMove);
document.addEventListener('touchmove', onDocumentMove, { passive: false });

const onDocumentEnd = () => {
  if (dragging) {
    dragging = false;
    divider.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    /* ── Remember the user's chosen split so toggle-preview can restore it ── */
    window.savedEditorWidth = edPane.style.width;
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  }
  if (outlineDragging) {
    outlineDragging = false;
    const outlineDivider = document.getElementById('outline-divider');
    if (outlineDivider) outlineDivider.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }
  if (readerDragging) {
    readerDragging = false;
    if (readerDragRaf) { cancelAnimationFrame(readerDragRaf); readerDragRaf = null; }
    document.body.classList.remove('reader-edge-dragging', 'editor-edge-dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    /* Disarm the click swallower AFTER the click that follows this mouseup
       has been dispatched (it fires synchronously before timers run). */
    setTimeout(() => document.removeEventListener('click', swallowReaderClick, true), 0);
    /* Persist the px text width — but only if the pointer actually
       moved: a mere edge-click must not commit anything. The final width
       is computed here, synchronously, from the last pointer position. */
    if (readerDragSawMove) {
      const commit = readerDragKind === 'editor'
        ? window.commitEditorDragWidth : window.commitReaderDragWidth;
      if (typeof commit === 'function') commit(readerDragWidthAt(readerDragPendingX));
    }
    readerDragSawMove = false;
  }
};

document.addEventListener('mouseup', onDocumentEnd);
document.addEventListener('touchend', onDocumentEnd);
document.addEventListener('touchcancel', onDocumentEnd);

/* ── Drag divider (preview / outline) ── */
let outlineDragging = false, outlineStartX = 0, outlineStartWidth = 0;
const outlineDivider = document.getElementById('outline-divider');
if (outlineDivider) {
  const onOutlineDividerStart = e => {
    const outlinePane = document.getElementById('outline-pane');
    if (!outlinePane || outlinePane.style.display === 'none') return;
    e.preventDefault();             // ← same fix; without this the outline divider also fails to drag
    outlineDragging  = true;
    outlineStartX    = getClientX(e);
    outlineStartWidth = outlinePane.getBoundingClientRect().width;
    outlineDivider.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  outlineDivider.addEventListener('mousedown', onOutlineDividerStart);
  outlineDivider.addEventListener('touchstart', onOutlineDividerStart, { passive: false });
}

/* ── Drag the column edge (Reading/Editor width → "Drag to adjust") ──────
   Hovering within ±6px of a centered column's edge shows a faint line
   (CSS keyed on body.reader-edge-hover / body.editor-edge-hover) and a
   col-resize cursor; dragging resizes the column symmetrically. Two
   surfaces: the READING column (preview pane, or the LP editor column —
   writes --reader-max-width, the same variable the Reading width
   presets use) and the CLASSIC editor column (--editor-max-width); both
   commit through the menus.js hooks as px. Desktop mouse only. The drag
   START is a document CAPTURE-phase mousedown scoped strictly to the
   edge band, so interior clicks reach CodeMirror, the live-preview
   widgets and the preview's [data-sl] sync untouched; the click that
   trails a completed drag is swallowed for the same reason. */
let readerDragging  = false;
let readerDragCenterX = 0;
let readerDragMaxW  = 0;
let readerDragSawMove = false;
let readerDragPendingX = 0;
let readerDragRaf   = null;
let readerDragKind  = 'reader'; // 'reader' | 'editor' — which surface owns this drag
let readerDragPadX  = 0;        // the grabbed column's own side margins (border box − text)

const READER_EDGE_BAND = 6;

const swallowReaderClick = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

/* The draggable column surfaces that apply right now (0–2 entries).
   'reader' mirrors the surface logic used by scrollToHeading: live
   preview edits in the CM editor unless reader mode / the mobile
   preview view has taken over. 'editor' is the CLASSIC editor column —
   never in LP, where the reader surface above already owns the CM
   column via Reading width. In split view both are present at once;
   their containers are disjoint, so the hit-test picks the right one. */
function dragSurfaces() {
  if (window.innerWidth <= 820) return [];
  const body = document.body;
  const surfaces = [];
  if (window.readerDragEnabled) {
    if (body.classList.contains('live-preview-active')
        && !body.classList.contains('reader-mode-active')
        && body.dataset.view !== 'preview') {
      const col = document.querySelector('#editor .cm-content');
      const container = document.querySelector('#editor .cm-scroller');
      if (col && container) surfaces.push({ kind: 'reader', col, container });
    } else {
      const pane = document.getElementById('preview-pane');
      if (pane && getComputedStyle(pane).display !== 'none'
          && !pane.classList.contains('mobile-preview')) { // phone frame
        const col = document.querySelector('#preview .prose');
        const container = document.getElementById('preview');
        if (col && container) surfaces.push({ kind: 'reader', col, container });
      }
    }
  }
  if (window.editorDragEnabled
      && !body.classList.contains('live-preview-active')
      && !body.classList.contains('reader-mode-active')
      && body.dataset.view !== 'preview') {
    const pane = document.getElementById('editor-pane');
    if (pane && getComputedStyle(pane).display !== 'none') {
      const col = document.querySelector('#editor .cm-content');
      const container = document.querySelector('#editor .cm-scroller');
      if (col && container) surfaces.push({ kind: 'editor', col, container });
    }
  }
  return surfaces;
}

/* Hit-test: pointer within the vertical extent of a surface's container
   and within ±6px of either column edge. `target` (the event's real
   deepest target — capture phase still sees it) must live INSIDE that
   surface's container: floating layers (menus, submenus, modals/date
   picker, export dropdowns, find bar, CM tooltips) are never
   descendants of #preview / .cm-scroller, so anything stacked over the
   band keeps its clicks instead of starting a drag. The container
   itself (scrollbar hits) counts as inside. Returns { surface }.      */
function readerEdgeHit(x, y, target) {
  for (const surface of dragSurfaces()) {
    if (target && !surface.container.contains(target)) continue;
    const colRect = surface.col.getBoundingClientRect();
    if (colRect.width === 0) continue;
    const boxRect = surface.container.getBoundingClientRect();
    if (y < boxRect.top || y > boxRect.bottom || x < boxRect.left || x > boxRect.right) continue;
    if (Math.abs(x - colRect.left) > READER_EDGE_BAND
        && Math.abs(x - colRect.right) > READER_EDGE_BAND) continue;
    return { surface };
  }
  return null;
}

document.addEventListener('mousemove', (e) => {
  if (dragging || outlineDragging || readerDragging) return;
  if (e.buttons !== 0) return; // mid-selection / other button held
  const hit = readerEdgeHit(e.clientX, e.clientY, e.target);
  document.body.classList.toggle('reader-edge-hover', !!hit && hit.surface.kind === 'reader');
  document.body.classList.toggle('editor-edge-hover', !!hit && hit.surface.kind === 'editor');
});

/* The hover affordance is otherwise cleared by the NEXT mousemove — which
   never comes if the pointer leaves the window (or the app loses focus)
   from inside the band. Both handlers only remove cosmetic classes.    */
document.addEventListener('mouseleave', () => {
  if (!readerDragging) document.body.classList.remove('reader-edge-hover', 'editor-edge-hover');
});
window.addEventListener('blur', () => {
  if (!readerDragging) document.body.classList.remove('reader-edge-hover', 'editor-edge-hover');
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (dragging || outlineDragging || readerDragging) return;
  const hit = readerEdgeHit(e.clientX, e.clientY, e.target);
  if (!hit) return;

  e.preventDefault();
  e.stopPropagation();
  readerDragging = true;
  readerDragSawMove = false;
  readerDragKind = hit.surface.kind;

  const colRect = hit.surface.col.getBoundingClientRect();
  readerDragCenterX = (colRect.left + colRect.right) / 2;
  /* The column's side margins stay put while it resizes (they follow
     the pane, not the width), so they are measured once, here. */
  const colCs = getComputedStyle(hit.surface.col);
  readerDragPadX = parseFloat(colCs.paddingLeft) + parseFloat(colCs.paddingRight);
  /* Cap at the container's CONTENT width so the column can never exceed
     the pane (the outline-overlay inset arrives as container padding and
     is therefore respected automatically). */
  const cs = getComputedStyle(hit.surface.container);
  readerDragMaxW = Math.max(
    120,
    hit.surface.container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      - readerDragPadX
  );

  document.body.classList.add(
    readerDragKind === 'editor' ? 'editor-edge-dragging' : 'reader-edge-dragging');
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  document.addEventListener('click', swallowReaderClick, { capture: true, once: true });
}, true);






/* ── Mobile view toggle ── */
let lastWasNarrow = window.innerWidth <= 820;
function updateMobileBtn() {
  const narrow = window.innerWidth <= 820;
  btnView.style.display = narrow ? 'block' : 'none';
  
  if (!narrow && document.body.getAttribute('data-view') === 'sidebar') {
    document.body.setAttribute('data-view', 'editor');
    const btnMobile = document.getElementById('btn-sidebar-mobile');
    if (btnMobile) btnMobile.classList.remove('active');
  }

  // If transitioning from mobile (narrow) to desktop (!narrow), ensure preview is up-to-date
  if (!narrow && lastWasNarrow) {
    if (typeof render === 'function') render();
  }
  lastWasNarrow = narrow;

  if (!narrow) {
    /* Only reset to the default 33 % split if the user hasn't dragged a
       custom width this session — prevents the toggle from blowing away
       their chosen proportions on every resize event.                   */
    if (!window.savedEditorWidth) {
      edPane.style.width = '33.33%';
    }
  }
}
btnView.addEventListener('click', () => {
  const currentView = document.body.getAttribute('data-view');
  const isEditor = currentView === 'editor';
  
  if (isEditor) {
    // Update the preview right before switching to it on mobile
    if (typeof render === 'function') render();
  }
  
  document.body.setAttribute('data-view', isEditor ? 'preview' : 'editor');
  btnView.textContent = isEditor ? window.t('Preview') : window.t('Editor');
  
  const btnMobile = document.getElementById('btn-sidebar-mobile');
  if (btnMobile) btnMobile.classList.remove('active');
});

window.addEventListener('resize', updateMobileBtn);
updateMobileBtn();

/* ── Mobile Outline Drawer ────────────────────────────────────────────── */
/* The Outline button's click is handled entirely by toggleOutline() in
   markdown_editor_menus.js, which now contains a mobile branch that calls
   renderOutline() and toggles .mobile-outline-open directly.
   This IIFE only needs to handle the scrim tap and the view-switch close. */
(function () {
  const scrim = document.getElementById('mobile-outline-scrim');

  /* Tap the scrim to close */
  if (scrim) {
    scrim.addEventListener('click', () => {
      document.body.classList.remove('mobile-outline-open');
    });
  }

  /* Close the drawer when switching back to editor view */
  if (typeof btnView !== 'undefined' && btnView) {
    btnView.addEventListener('click', () => {
      document.body.classList.remove('mobile-outline-open');
    });
  }
})();
/* ── Top bar fit (desktop, > 820px) ───────────────────────────────────────
   The bar's content width depends on the UI size (90–270%), the language,
   desktop vs web, the word counter and status notices and the logo
   position, so no fixed width breakpoint can be right. Instead: measure.
   Labels never wrap (CSS); this picks the first state below whose
   measured groups fit and sets its classes on #topbar (see "Top bar fit"
   in the stylesheet):
     1. levels 0–2 with the logo exactly centred;
     2. levels 2–5 with the logo slid (inline `left`) just far enough to
        clear the wider group;
     3. level 5 + tb-squeeze: the title narrows by exactly the shortfall
        (--tb-title-w) and the row aligns right, so anything still left
        over goes off the LEFT edge and the window controls stay.
   Group widths are measured once per content change — one short top bar
   layout per level — and cached, so a window resize is arithmetic only. */
(function () {
  const topbar = document.getElementById('topbar');
  const title  = document.getElementById('doc-title');
  const left   = document.getElementById('topbar-left');
  const right  = document.getElementById('topbar-right');
  const center = document.getElementById('topbar-center');
  const wordcount = document.getElementById('wordcount');
  if (!topbar || !title || !left || !right || !center || typeof ResizeObserver !== 'function') return;

  const GAP = 12; // clearance between a group and the logo (px)
  const LEVELS = [
    [],
    ['tb-no-export'],
    ['tb-no-export', 'tb-title-mid'],
    ['tb-no-export', 'tb-title-mid', 'tb-short'],
    ['tb-no-export', 'tb-title-min', 'tb-short'],
    ['tb-no-export', 'tb-title-min', 'tb-short', 'tb-no-outline'],
  ];
  const LAST = LEVELS.length - 1;
  const STATE_CLASSES = ['tb-no-export', 'tb-title-mid', 'tb-title-min', 'tb-short',
    'tb-no-outline', 'tb-squeeze'];

  let widths = null;   // per level: [left group, right group] natural widths
  let logoW = 0;       // 0 when the logo sits in the left group (logo position Left)
  let lastTitleW = 0;  // the title's width at the last level
  let dirty = true;
  let rootFont = '';
  let wcLen = -1;
  let bodyFlags = '';
  let pending = false;

  const setState = (list) => {
    for (const c of STATE_CLASSES) topbar.classList.toggle(c, list.includes(c));
  };

  function measure() {
    widths = LEVELS.map(list => {
      setState(list);
      return [left.getBoundingClientRect().width, right.getBoundingClientRect().width];
    });
    lastTitleW = title.getBoundingClientRect().width; // measured at LAST, set last
    logoW = center.getBoundingClientRect().width;
    wcLen = wordcount ? wordcount.textContent.length : -1;
  }

  function fit() {
    if (window.innerWidth <= 820) { // phone layout: its own CSS
      setState([]);
      if (center.style.left) center.style.left = '';
      return;
    }
    const font = getComputedStyle(document.documentElement).fontSize; // UI size
    if (font !== rootFont) { rootFont = font; dirty = true; }
    if (dirty || !widths) { dirty = false; measure(); }

    const cs = getComputedStyle(topbar);
    const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight);
    const c = topbar.clientWidth;
    const mid = c / 2; // #topbar-center's left:50% (of the padding box)
    /* The logo-centre positions that clear both groups, or null. */
    const room = ([l, r]) => {
      const lo = padL + l + GAP + logoW / 2;
      const hi = c - padR - r - GAP - logoW / 2;
      return lo <= hi ? [lo, hi] : null;
    };
    let level = -1, x = mid;
    for (let i = 0; i <= 2 && level < 0; i++) {
      const r = room(widths[i]);
      if (r && (logoW === 0 || (r[0] <= mid && mid <= r[1]))) level = i;
    }
    for (let i = 2; i <= LAST && level < 0; i++) {
      const r = room(widths[i]);
      if (r) { level = i; x = Math.min(Math.max(mid, r[0]), r[1]); }
    }
    let titleW = '';
    if (level < 0) {
      /* Squeeze: the logo joins the row (GAP each side, like the CSS
         column-gap), and the title gives up exactly the shortfall. */
      const [l, r] = widths[LAST];
      const short = padL + l + GAP + logoW + GAP + r + padR - c;
      titleW = Math.max(0, Math.floor(lastTitleW - short)) + 'px';
    }
    setState(level < 0 ? LEVELS[LAST].concat('tb-squeeze') : LEVELS[level]);
    if (topbar.style.getPropertyValue('--tb-title-w') !== titleW) {
      if (titleW) topbar.style.setProperty('--tb-title-w', titleW);
      else topbar.style.removeProperty('--tb-title-w');
    }
    const leftPx = (level < 0 || x === mid) ? '' : Math.round(x) + 'px';
    if (center.style.left !== leftPx) center.style.left = leftPx;
  }

  /* Coalesce a burst of triggers into one fit, as a microtask: after the
     change that caused it, before the next paint — and independent of
     rendering (a never-shown window runs no animation frames). */
  const schedule = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; fit(); });
  };
  const invalidate = () => { dirty = true; schedule(); };

  /* Window width and UI size (the bar is 2.2rem tall) — synchronously,
     before paint, so a resize never shows a frame of overlap. */
  new ResizeObserver(fit).observe(topbar);

  /* Content changes: labels (language), buttons shown/hidden, status
     notices, the logo swapped or moved. Ignored: this controller's own
     writes, the dropdown menus, and word-count ticks that keep the
     count's length (its width). */
  new MutationObserver((records) => {
    for (const rec of records) {
      const el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
      if (!el || el.closest('.menu-container')) continue;
      if (el === topbar) continue; // our state classes / --tb-title-w
      if (el === center && rec.attributeName === 'style') continue;
      if (wordcount && wordcount.contains(el) && rec.attributeName !== 'style'
          && wordcount.textContent.length === wcLen) continue;
      invalidate();
      return;
    }
  }).observe(topbar, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['style', 'class'],
  });

  /* Body state that changes which buttons exist (reader mode, desktop app,
     fullscreen, logo position). Other body classes toggle constantly
     (edge-hover affordances) and are skipped by comparing this string. */
  const readBodyFlags = () => {
    const b = document.body;
    return ['desktop-app', 'is-macos', 'is-fullscreen', 'reader-mode-active', 'logo-left']
      .map(k => (b.classList.contains(k) ? 1 : 0)).join('') + (b.getAttribute('data-view') || '');
  };
  bodyFlags = readBodyFlags();
  new MutationObserver(() => {
    const f = readBodyFlags();
    if (f !== bodyFlags) { bodyFlags = f; invalidate(); }
  }).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-view'] });

  /* UI size is written to <html style="font-size">. The ResizeObserver
     sees it too (the bar is 2.2rem tall), but only where rendering runs;
     this covers it everywhere. The attribute also changes on every
     column-width write — fit() only re-measures when the computed font
     size actually differs. */
  new MutationObserver(schedule).observe(document.documentElement,
    { attributes: true, attributeFilter: ['style'] });

  /* Web fonts change every label's width once they arrive. */
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', invalidate);
    document.fonts.ready.then(invalidate);
  }

  fit();
})();

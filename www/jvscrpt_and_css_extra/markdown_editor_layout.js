// editor-layout.js

/* Helper to get X coordinate from either mouse or touch events */
const getClientX = (e) => e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;

/* ── Drag divider (editor / preview) ── */
let dragging = false, startX = 0, startLeft = 0;

const onDividerStart = e => {
  e.preventDefault();               // ← prevents native drag-and-drop & default touch behaviors
  dragging = true; 
  startX = getClientX(e);
  startLeft = edPane.getBoundingClientRect().width;
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
    const total = workspace.getBoundingClientRect().width;
    /* Mirrored layout puts the editor on the divider's OTHER side, so the
       same pointer movement must change its width in the other direction. */
    const dir = window.flipLayout ? -1 : 1;
    const newLeft = Math.min(Math.max(startLeft + dir * (currentX - startX), 200), total - 200);
    edPane.style.width = newLeft + 'px';
    edPane.style.flex = 'none';
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
    if (readerDragKind === 'editor' && readerDragSeedW === null) {
      /* First move of a classic-editor drag: convert the padding
         geometry into the max-width mechanism (lossless — see
         beginEditorDragWidth) and seed the delta math. Deferred to the
         first MOVE so a mere edge click mutates nothing. */
      readerDragSeedW = (typeof window.beginEditorDragWidth === 'function')
        ? window.beginEditorDragWidth()
        : null;
      if (readerDragSeedW === null) return; // cannot convert — drag stays inert
    }
    readerDragSawMove = true;
    readerDragPendingX = currentX;
    if (!readerDragRaf) {
      readerDragRaf = requestAnimationFrame(() => {
        readerDragRaf = null;
        if (readerDragKind === 'editor') {
          document.documentElement.style.setProperty(
            '--editor-max-width', editorDragWidthAt(readerDragPendingX) + 'px');
        } else {
          document.documentElement.style.setProperty(
            '--reader-max-width', readerDragWidthAt(readerDragPendingX) + 'px');
        }
      });
    }
  }
};

/* Clamped column width for a pointer position (reader edge drag).
   Floor 120px: below every Reader padding preset at realistic window
   sizes (10% of 1200 = 120), so nudging the edge from a narrow preset
   never JUMPS the column wider than the preset was. */
function readerDragWidthAt(x) {
  return Math.round(Math.min(
    Math.max(2 * Math.abs(x - readerDragCenterX), 120),
    readerDragMaxW
  ));
}

/* Editor variant: DELTA-anchored around the seeded width instead of the
   absolute center formula. After the first-move seed conversion the
   grabbed element edge moves inward (the preset-mode element filled the
   pane; the capped one hugs the text), so the pointer no longer sits at
   the live edge — the center math would snap the column to the pointer
   span on the first frame. Anchoring on the seed keeps it continuous:
   the column changes by twice the pointer travel, symmetric like the
   reader's. Same 120px floor and container cap. */
function editorDragWidthAt(x) {
  const seed = readerDragSeedW === null ? 120 : readerDragSeedW;
  return Math.round(Math.min(
    Math.max(seed + 2 * readerDragEdgeDir * (x - readerDragStartX), 120),
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
    /* Persist as a proportional token — but only if the pointer actually
       moved. A mere edge-click must not commit anything (the active value
       could still be a preset like '50vw' or 'none'). The final width is
       computed here, synchronously, from the last pointer position.     */
    if (readerDragSawMove) {
      if (readerDragKind === 'editor') {
        if (typeof window.commitEditorDragWidth === 'function') {
          const finalPx = editorDragWidthAt(readerDragPendingX);
          const vw = Math.min(Math.max((finalPx / window.innerWidth) * 100, 5), 100);
          window.commitEditorDragWidth(Math.round(vw * 10) / 10, finalPx);
        }
      } else if (typeof window.commitReaderDragWidth === 'function') {
        const finalPx = readerDragWidthAt(readerDragPendingX);
        const vw = Math.min(Math.max((finalPx / window.innerWidth) * 100, 5), 100);
        /* px passed alongside: fixed-width mode stores the drag's exact
           pixel result instead of roundtripping through vw. */
        window.commitReaderDragWidth(Math.round(vw * 10) / 10, finalPx);
      }
    }
    readerDragSawMove = false;
    readerDragSeedW = null;
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

/* ── Drag the column edge (Reader/Editor padding → "Drag to adjust") ─────
   Hovering within ±6px of a centered column's edge shows a faint line
   (CSS keyed on body.reader-edge-hover / body.editor-edge-hover) and a
   col-resize cursor; dragging resizes the column symmetrically. Two
   surfaces: the READING column (preview pane, or the LP editor column —
   writes --reader-max-width, the same variable the Reader padding
   presets use) and the CLASSIC editor column (writes --editor-max-width
   via the menus.js begin/commit hooks). Desktop mouse only. The drag
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
let readerDragEdgeDir = 1;      // +1 = right edge grabbed, -1 = left edge
let readerDragStartX  = 0;
let readerDragSeedW   = null;   // editor kind: column width seeded on FIRST move

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
   column via Reader padding. In split view both are present at once;
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
   itself (scrollbar hits) counts as inside. Returns the surface plus
   which edge was grabbed (+1 right / -1 left).                        */
function readerEdgeHit(x, y, target) {
  for (const surface of dragSurfaces()) {
    if (target && !surface.container.contains(target)) continue;
    const colRect = surface.col.getBoundingClientRect();
    if (colRect.width === 0) continue;
    const boxRect = surface.container.getBoundingClientRect();
    if (y < boxRect.top || y > boxRect.bottom || x < boxRect.left || x > boxRect.right) continue;
    const nearLeft  = Math.abs(x - colRect.left)  <= READER_EDGE_BAND;
    const nearRight = Math.abs(x - colRect.right) <= READER_EDGE_BAND;
    if (!nearLeft && !nearRight) continue;
    return { surface, edgeDir: nearRight ? 1 : -1 };
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
  readerDragEdgeDir = hit.edgeDir;
  readerDragStartX = e.clientX;
  readerDragSeedW = null; // editor kind: converted lazily on the first move

  const colRect = hit.surface.col.getBoundingClientRect();
  readerDragCenterX = (colRect.left + colRect.right) / 2;
  /* Cap at the container's CONTENT width so the column can never exceed
     the pane (the outline-overlay inset arrives as container padding and
     is therefore respected automatically). */
  const cs = getComputedStyle(hit.surface.container);
  readerDragMaxW = Math.max(
    120,
    hit.surface.container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
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
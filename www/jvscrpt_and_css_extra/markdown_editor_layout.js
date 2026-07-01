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
  if (!dragging && !outlineDragging) return;
  
  // Prevent the browser from hijacking the drag gesture to scroll the page
  if (e.cancelable) e.preventDefault();

  const currentX = getClientX(e);

  if (dragging) {
    const total = workspace.getBoundingClientRect().width;
    const newLeft = Math.min(Math.max(startLeft + (currentX - startX), 200), total - 200);
    edPane.style.width = newLeft + 'px';
    edPane.style.flex = 'none';
  }

  if (outlineDragging) {
    /* Dragging left widens the outline; dragging right narrows it */
    const total = workspace.getBoundingClientRect().width;
    const outlinePane = document.getElementById('outline-pane');
    const newWidth = Math.min(Math.max(outlineStartWidth - (currentX - outlineStartX), 140), Math.min(420, total - 400));
    outlinePane.style.width = newWidth + 'px';
  }
};

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
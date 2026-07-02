/* panel.js — sidebar open/close, mobile view switch, divider drag. */
import { S, btnSidebar, sidebarPanel, sidebarDivider, btnSidebarMobile } from './state.js';

function openSidebar() {
    S.sidebarOpen = true;
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
    S.sidebarOpen = false;
    sidebarPanel.style.display   = 'none';
    sidebarDivider.style.display = 'none';
      if (btnSidebar) {
    btnSidebar.classList.remove('active');
    btnSidebar.title = window.t('Open project folder');
  }
}

  /* Automatically revert mobile layout back to the editor when a file is opened */
  function switchFromMobileSidebar() {
    if (window.innerWidth <= 820 && document.body.getAttribute('data-view') === 'sidebar') {
      const toView = document.body.classList.contains('reader-mode-active') ? 'preview' : 'editor';
      document.body.setAttribute('data-view', toView);
      if (btnSidebarMobile) btnSidebarMobile.classList.remove('active');
    }
  }

  let sbDragging = false, sbStartX = 0, sbStartW = 0;
  const MIN_SIDEBAR_W = 160, MAX_SIDEBAR_W = 1200;

export { openSidebar, closeSidebar, switchFromMobileSidebar };

export function initPanel() {
if (btnSidebar) btnSidebar.addEventListener('click', () => {
    S.sidebarOpen ? closeSidebar() : openSidebar();
  });

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
        if (!S.sidebarOpen) openSidebar();
      }
    });
  }

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
}

/* index.js — entry point. Bundled by build_tools/build_sidebar.js into
   www/jvscrpt_and_css_extra/project_sidebar.js (single classic script).
   Init order mirrors the original file's top-to-bottom execution. */
import { initDialogStyles } from './dialogs.js';
import { initCardView } from './cards.js';
import { initProjects } from './projects.js';
import { initTree } from './tree.js';
import { initSaveEngine } from './save.js';
import { initPanel } from './panel.js';
import { initFileOps } from './fileops.js';
import { initDnd } from './dnd.js';
import { initEditorMedia } from './editor_media.js';
import { initCloseHandler, runBoot } from './lifecycle.js';
import { getYamlIndex } from './yaml_index.js';
import { initSearch } from './search.js';
import { listLinkCompletions } from './link_complete.js';

/* YAML autocomplete data feed for the editor (cm_setup.js). Exposed in
   BOTH modes: on desktop it indexes the whole project; in web mode it
   degrades to the current document's frontmatter (passed by the caller). */
window.sidebarYamlIndex = getYamlIndex;

/* Link-path autocomplete data feed for the editor (cm_setup.js): folder/
   media/note listings for `![...](path)` destinations. Returns null in web
   mode (no filesystem), which keeps the completion source inert there. */
window.sidebarListLinkCompletions = listLinkCompletions;

/* ── Guard: desktop only ─────────────────────────────────────────── */
if (!window.NativeAPI || !window.NativeAPI.isDesktop) {
  const btn = document.getElementById('btn-sidebar');
  if (btn) btn.style.display = 'none';
  const btnMobile = document.getElementById('btn-sidebar-mobile');
  if (btnMobile) btnMobile.style.display = 'none';
} else {
  initDialogStyles();
  initCardView();
  initProjects();
  initTree();
  initSaveEngine();
  initPanel();
  initFileOps();
  initDnd();
  initEditorMedia();
  initSearch();
  initCloseHandler();
  runBoot();

  /* Pre-warm the YAML index shortly after boot so the first click into
     frontmatter gets instant suggestions. Deliberately NOT a cache file
     in the project root: the index only re-reads changed files (mtime
     cache), and this app never writes non-user files into the notes
     folder — sync tools and the data-safety story stay clean. */
  setTimeout(() => { try { getYamlIndex('').catch(() => {}); } catch (_) {} },
             window.slowHardwareMode ? 12000 : 4000);
}


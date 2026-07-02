/* projects.js — recent-projects history, switcher dropdown, manage modal. */
import { S, btnProjectsBtn, docTitleEl } from './state.js';
import { showInputDialog } from './dialogs.js';
import { saveActiveFile, markClean } from './save.js';
import { openFolder, promptOpenFolder } from './fileops.js';

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
        const normRoot   = (S.rootPath || '').replace(/\\/g, '/');
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
          if (S.isDirty && S.activeFilePath) {
            const saved = await saveActiveFile();
            if (!saved) return; // FIX: Abort the switch to prevent data loss
          }

          /* Clear the editor BEFORE setting the new root to prevent path-escape races */
          S.activeFilePath = null;
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
        const normRoot = (S.rootPath || '').replace(/\\/g, '/');
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

/** Boot seeds the in-memory cache from the native settings file. */
export function seedProjectsCache(arr) { _cachedProjects = arr; }

export { PROJECTS_KEY, loadProjects, saveProjects, recordProjectOpen,
         showProjectsDropdown, showManageProjectsModal };

export function initProjects() {
  if (btnProjectsBtn) {
    btnProjectsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showProjectsDropdown(btnProjectsBtn);
    });
  }
}

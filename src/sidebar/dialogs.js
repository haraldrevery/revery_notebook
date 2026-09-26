/* dialogs.js — injected sidebar styles + the in-app input dialog
   (replaces prompt(), which is blocked in sandboxed Electron renderers). */

export function initDialogStyles() {
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
      /* Path bar (shown when the whole path fits; else Back + crumb).
         Every ancestor is a button: click to go there, drop to move there. */
      .sidebar-card-nav.sidebar-card-path { gap: 2px; overflow: hidden; }
      .sidebar-card-seg {
        background: none; border: none; cursor: pointer;
        color: var(--text, #ccc); opacity: 0.65;
        font-size: 0.72rem; font-family: var(--font-mono, monospace);
        text-transform: uppercase; letter-spacing: 0.05em;
        padding: 2px 4px; border-radius: 4px; line-height: 1.2;
        white-space: nowrap; flex-shrink: 0;
      }
      .sidebar-card-seg:hover { opacity: 1; background: var(--hover-bg, rgba(128,128,128,0.12)); }
      .sidebar-card-sep { opacity: 0.4; font-size: 0.72rem; flex-shrink: 0; }
      .sidebar-card-path .sidebar-card-crumb { flex-shrink: 0; opacity: 0.9; }
      .sidebar-card-back.drop-target,
      .sidebar-card-seg.drop-target {
        opacity: 1;
        outline: 2px solid var(--accent, #4a5fc1);
        outline-offset: -2px;
        background: rgba(74,95,193,0.25);
      }
      /* Links (symlinks / junctions): marked, never walked into */
      .sidebar-link-badge {
        position: absolute; top: 3px; right: 3px;
        width: 14px; height: 14px; opacity: 0.8;
        pointer-events: none;
      }
      .sidebar-item.sidebar-link .sidebar-name { font-style: italic; }

      /* "Move to…" folder picker */
      .revery-folder-picker { max-width: 460px; }
      .revery-folder-list {
        max-height: 50vh; min-height: 120px; overflow-y: auto;
        border: 1px solid var(--border, #444); border-radius: 6px;
        padding: 4px; display: flex; flex-direction: column;
      }
      .revery-folder-row {
        text-align: left; background: none; border: none; cursor: pointer;
        color: var(--text, #ccc); font-size: 0.85rem;
        padding: 4px 8px; border-radius: 4px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .revery-folder-row:hover:not(:disabled) { background: var(--hover-bg, rgba(128,128,128,0.12)); }
      .revery-folder-row.selected { background: rgba(74,95,193,0.3); }
      .revery-folder-row:disabled { opacity: 0.45; cursor: default; }
      .revery-folder-row-note { opacity: 0.7; font-style: italic; }
      .revery-folder-note { font-size: 0.78rem; opacity: 0.75; min-height: 1em; }
      .revery-input-ok:disabled { opacity: 0.45; cursor: default; }

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
        opacity: 0.72;
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
}

/**
 * OK/Cancel confirmation styled like showInputDialog. Resolves true only on
 * an explicit OK. `detailLines` renders as a small scrollable list (used to
 * show which files a link update will touch — the user sees exactly what
 * will be modified before anything is written).
 */
export function showConfirmDialog(promptText, detailLines = [], okLabel = null) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'revery-input-overlay';

    const box = document.createElement('div');
    box.className = 'revery-input-box';

    const label = document.createElement('p');
    label.textContent = promptText;
    box.appendChild(label);

    if (detailLines.length) {
      const list = document.createElement('div');
      list.style.cssText =
        'max-height:9em;overflow-y:auto;margin:8px 0;font-size:0.78em;opacity:0.85;white-space:pre-wrap;';
      list.textContent = detailLines.join('\n');
      box.appendChild(list);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'revery-input-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = window.t('Cancel');
    cancelBtn.className = 'revery-input-cancel';

    const okBtn = document.createElement('button');
    okBtn.textContent = okLabel || window.t('OK');
    okBtn.className = 'revery-input-ok';

    function finish(v) {
      if (!document.body.contains(overlay)) return;
      document.body.removeChild(overlay);
      resolve(v);
    }
    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    });

    btnRow.append(cancelBtn, okBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => okBtn.focus());
  });
}

  /**
   * showInputDialog(promptText, defaultValue?)
   * Returns a Promise<string|null> — null means the user cancelled.
   * Works in sandboxed Electron, Tauri, and web — unlike prompt().
   */
export function showInputDialog(promptText, defaultValue = '', opts = {}) {
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
      cancelBtn.textContent = window.t('Cancel');
      cancelBtn.className   = 'revery-input-cancel';

      const okBtn = document.createElement('button');
      okBtn.textContent = window.t('OK');
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
      requestAnimationFrame(() => {
        input.focus();
        /* opts.selectStem: preselect the name WITHOUT its extension, so
           typing replaces the name and the extension stays (the Finder /
           Explorer convention). */
        const dot = defaultValue.lastIndexOf('.');
        if (opts.selectStem && dot > 0) input.setSelectionRange(0, dot);
        else input.select();
      });
    });
  }

/**
 * showFolderPickerDialog({ title, okLabel, load })
 * The "Move to…" folder picker. `load()` resolves to
 *   { folders: [{ path, name, rel, depth, disabled?, note? }], truncated }
 * (the dialog is shown at once and fills in when the list arrives).
 * Returns a Promise<string|null> — the chosen folder's path, or null.
 * Keyboard: type to filter, ↑/↓ to choose, Enter to confirm, Esc to cancel.
 * Every name is set with textContent: folder names are user data.
 */
export function showFolderPickerDialog({ title, okLabel, load }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'revery-input-overlay';

    const box = document.createElement('div');
    box.className = 'revery-input-box revery-folder-picker';

    const label = document.createElement('p');
    label.textContent = title;

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.className = 'revery-input-field';
    filter.placeholder = window.t('Filter folders…');
    filter.spellcheck = false;

    const list = document.createElement('div');
    list.className = 'revery-folder-list';
    list.setAttribute('role', 'listbox');

    const note = document.createElement('div');
    note.className = 'revery-folder-note';
    note.textContent = window.t('Loading folders…');

    const btnRow = document.createElement('div');
    btnRow.className = 'revery-input-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = window.t('Cancel');
    cancelBtn.className = 'revery-input-cancel';
    const okBtn = document.createElement('button');
    okBtn.textContent = okLabel || window.t('OK');
    okBtn.className = 'revery-input-ok';
    okBtn.disabled = true;

    let folders = [];
    let selected = null; // folder object
    let rows = [];       // [{ el, folder }] currently shown and enabled

    function finish(value) {
      if (!document.body.contains(overlay)) return;
      document.body.removeChild(overlay);
      resolve(value);
    }

    function choose(f) {
      selected = f;
      okBtn.disabled = !f;
      for (const r of rows) r.el.classList.toggle('selected', r.folder === f);
      const cur = rows.find((r) => r.folder === f);
      if (cur) cur.el.scrollIntoView({ block: 'nearest' });
    }

    function render() {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren();
      rows = [];
      for (const f of folders) {
        const hay = (f.rel || f.name).toLowerCase();
        if (q && !hay.includes(q)) continue;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'revery-folder-row';
        row.setAttribute('role', 'option');
        row.style.paddingLeft = (8 + (q ? 0 : f.depth * 14)) + 'px';
        row.textContent = q ? (f.rel || f.name) : f.name;
        if (f.note) {
          const n = document.createElement('span');
          n.className = 'revery-folder-row-note';
          n.textContent = ' ' + f.note;
          row.appendChild(n);
        }
        row.title = f.rel || f.name;
        if (f.disabled) {
          row.disabled = true;
        } else {
          row.addEventListener('click', () => choose(f));
          row.addEventListener('dblclick', () => finish(f.path));
          rows.push({ el: row, folder: f });
        }
        list.appendChild(row);
      }
      if (selected && !rows.some((r) => r.folder === selected)) choose(null);
      else choose(selected);
    }

    filter.addEventListener('input', render);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
      if (e.key === 'Enter')  { e.preventDefault(); if (selected) finish(selected.path); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        const i = rows.findIndex((r) => r.folder === selected);
        const next = e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, i + 1)
          : Math.max(0, i < 0 ? 0 : i - 1);
        choose(rows[next].folder);
      }
    });
    cancelBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => { if (selected) finish(selected.path); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });

    btnRow.append(cancelBtn, okBtn);
    box.append(label, filter, list, note, btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => filter.focus());

    Promise.resolve().then(load).then((res) => {
      folders = (res && res.folders) || [];
      note.textContent = (res && res.truncated)
        ? window.t('Showing the first {n} folders — type to filter.').replace('{n}', folders.length)
        : '';
      render();
    }).catch((err) => {
      note.textContent = window.t('The folders could not be listed.') + ' ' + String((err && err.message) || err);
    });
  });
}

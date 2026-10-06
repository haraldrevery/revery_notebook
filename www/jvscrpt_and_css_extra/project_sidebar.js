/**
 * project_sidebar.js — GENERATED FILE, DO NOT EDIT DIRECTLY.
 * Source modules: src/sidebar/   Build: npm run build:sidebar
 *
 * Revery Notebook Project File Sidebar (Obsidian/Logseq-style file management).
 * Exposes on window: sidebarSaveActiveFile, sidebarGetActiveFilePath,
 * sidebarGetRootPath, sidebarPivotToNewFile, sidebarCreateNewFile,
 * sidebarImportFile, sidebarHandleClose.
 */
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/sidebar/dialogs.js
  function initDialogStyles() {
    (function injectInputDialogStyles() {
      if (document.getElementById("revery-input-dialog-styles")) return;
      const style = document.createElement("style");
      style.id = "revery-input-dialog-styles";
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




      
      /* \u2500\u2500 Unsupported file type \u2014 orange warning colour \u2500\u2500 */
      .sidebar-item.sidebar-unsupported .sidebar-name {
        color: #d97706;
      }
      /* \u2500\u2500 Media file type \u2500\u2500 */
      .sidebar-item.sidebar-media .sidebar-name {
        color: var(--text, inherit);
      }
      .sidebar-item.sidebar-media-active {
        background: rgba(74,95,193,0.15);
        border-radius: 4px;
      }

      /* \u2500\u2500 Multi-select \u2500\u2500
         Marked items are TEAL; the current file (the open note, the
         previewed image) stays indigo \u2014 a separate hue, not just a
         different strength of the same one. Same pair in card view. */
      .sidebar-item.multi-selected {
        background: rgba(20,184,166,0.24);
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
      /* \u2500\u2500 Drag source \u2500\u2500 */
      .sidebar-item.drag-source-active {
        opacity: 0.42;
      }
      /* \u2500\u2500 Drop target \u2500\u2500 */
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

      /* \u2500\u2500 Sort dropdown menu \u2500\u2500 */
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

      /* \u2500\u2500 Project switcher dropdown \u2500\u2500 */
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

      /* \u2500\u2500 Manage projects modal list \u2500\u2500 */
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

      /* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
         CARD VIEW
      \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */

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
        /* 8px + the buttons' own 4-5px: the path text starts where the
           card titles do (12px in), not against the panel's edge */
        padding: 4px 8px 6px;
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

      /* "Move to\u2026" folder picker */
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

      /* Individual card \u2014 portrait 3:4 ratio */
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
        outline: 2px solid rgba(20,184,166,0.85);
        outline-offset: -2px;
        background: rgba(20,184,166,0.16);
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
  function showConfirmDialog(promptText, detailLines = [], okLabel = null) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "revery-input-overlay";
      const box = document.createElement("div");
      box.className = "revery-input-box";
      const label = document.createElement("p");
      label.textContent = promptText;
      box.appendChild(label);
      if (detailLines.length) {
        const list = document.createElement("div");
        list.style.cssText = "max-height:9em;overflow-y:auto;margin:8px 0;font-size:0.78em;opacity:0.85;white-space:pre-wrap;";
        list.textContent = detailLines.join("\n");
        box.appendChild(list);
      }
      const btnRow = document.createElement("div");
      btnRow.className = "revery-input-buttons";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = window.t("Cancel");
      cancelBtn.className = "revery-input-cancel";
      const okBtn = document.createElement("button");
      okBtn.textContent = okLabel || window.t("OK");
      okBtn.className = "revery-input-ok";
      function finish(v) {
        if (!document.body.contains(overlay)) return;
        document.body.removeChild(overlay);
        resolve(v);
      }
      cancelBtn.addEventListener("click", () => finish(false));
      okBtn.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(false);
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
      });
      btnRow.append(cancelBtn, okBtn);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => okBtn.focus());
    });
  }
  function showInputDialog(promptText, defaultValue = "", opts = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "revery-input-overlay";
      const box = document.createElement("div");
      box.className = "revery-input-box";
      const label = document.createElement("p");
      label.textContent = promptText;
      const input = document.createElement("input");
      input.type = "text";
      input.value = defaultValue;
      input.className = "revery-input-field";
      input.spellcheck = false;
      const btnRow = document.createElement("div");
      btnRow.className = "revery-input-buttons";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = window.t("Cancel");
      cancelBtn.className = "revery-input-cancel";
      const okBtn = document.createElement("button");
      okBtn.textContent = window.t("OK");
      okBtn.className = "revery-input-ok";
      function finish(value) {
        if (!document.body.contains(overlay)) return;
        document.body.removeChild(overlay);
        resolve(value);
      }
      cancelBtn.addEventListener("click", () => finish(null));
      okBtn.addEventListener("click", () => finish(input.value.trim() || null));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(null);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(input.value.trim() || null);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      });
      btnRow.append(cancelBtn, okBtn);
      box.append(label, input, btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        input.focus();
        const dot = defaultValue.lastIndexOf(".");
        if (opts.selectStem && dot > 0) input.setSelectionRange(0, dot);
        else input.select();
      });
    });
  }
  function showFolderPickerDialog({ title, okLabel, load }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "revery-input-overlay";
      const box = document.createElement("div");
      box.className = "revery-input-box revery-folder-picker";
      const label = document.createElement("p");
      label.textContent = title;
      const filter = document.createElement("input");
      filter.type = "text";
      filter.className = "revery-input-field";
      filter.placeholder = window.t("Filter folders\u2026");
      filter.spellcheck = false;
      const list = document.createElement("div");
      list.className = "revery-folder-list";
      list.setAttribute("role", "listbox");
      const note = document.createElement("div");
      note.className = "revery-folder-note";
      note.textContent = window.t("Loading folders\u2026");
      const btnRow = document.createElement("div");
      btnRow.className = "revery-input-buttons";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = window.t("Cancel");
      cancelBtn.className = "revery-input-cancel";
      const okBtn = document.createElement("button");
      okBtn.textContent = okLabel || window.t("OK");
      okBtn.className = "revery-input-ok";
      okBtn.disabled = true;
      let folders = [];
      let selected = null;
      let rows = [];
      function finish(value) {
        if (!document.body.contains(overlay)) return;
        document.body.removeChild(overlay);
        resolve(value);
      }
      function choose(f) {
        selected = f;
        okBtn.disabled = !f;
        for (const r of rows) r.el.classList.toggle("selected", r.folder === f);
        const cur = rows.find((r) => r.folder === f);
        if (cur) cur.el.scrollIntoView({ block: "nearest" });
      }
      function render2() {
        const q = filter.value.trim().toLowerCase();
        list.replaceChildren();
        rows = [];
        for (const f of folders) {
          const hay = (f.rel || f.name).toLowerCase();
          if (q && !hay.includes(q)) continue;
          const row = document.createElement("button");
          row.type = "button";
          row.className = "revery-folder-row";
          row.setAttribute("role", "option");
          row.style.paddingLeft = 8 + (q ? 0 : f.depth * 14) + "px";
          row.textContent = q ? f.rel || f.name : f.name;
          if (f.note) {
            const n = document.createElement("span");
            n.className = "revery-folder-row-note";
            n.textContent = " " + f.note;
            row.appendChild(n);
          }
          row.title = f.rel || f.name;
          if (f.disabled) {
            row.disabled = true;
          } else {
            row.addEventListener("click", () => choose(f));
            row.addEventListener("dblclick", () => finish(f.path));
            rows.push({ el: row, folder: f });
          }
          list.appendChild(row);
        }
        if (selected && !rows.some((r) => r.folder === selected)) choose(null);
        else choose(selected);
      }
      filter.addEventListener("input", render2);
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (selected) finish(selected.path);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!rows.length) return;
          const i = rows.findIndex((r) => r.folder === selected);
          const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
          choose(rows[next].folder);
        }
      });
      cancelBtn.addEventListener("click", () => finish(null));
      okBtn.addEventListener("click", () => {
        if (selected) finish(selected.path);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) finish(null);
      });
      btnRow.append(cancelBtn, okBtn);
      box.append(label, filter, list, note, btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => filter.focus());
      Promise.resolve().then(load).then((res) => {
        folders = res && res.folders || [];
        note.textContent = res && res.truncated ? window.t("Showing the first {n} folders \u2014 type to filter.").replace("{n}", folders.length) : "";
        render2();
      }).catch((err) => {
        note.textContent = window.t("The folders could not be listed.") + " " + String(err && err.message || err);
      });
    });
  }

  // src/sidebar/state.js
  var btnSidebar = document.getElementById("btn-sidebar");
  var sidebarPanel = document.getElementById("project-sidebar");
  var sidebarDivider = document.getElementById("sidebar-divider");
  var folderNameEl = document.getElementById("sidebar-folder-name");
  var btnProjectsBtn = document.getElementById("sidebar-projects-btn");
  var btnOpenFolder = document.getElementById("sidebar-open-folder");
  var btnNewFile = document.getElementById("sidebar-new-file");
  var btnNewFolder = document.getElementById("sidebar-new-folder");
  var btnToggleAll = document.getElementById("sidebar-toggle-all");
  var btnSortBtn = document.getElementById("sidebar-sort-btn");
  var btnViewBtn = document.getElementById("sidebar-view-btn");
  var treeEl = document.getElementById("sidebar-tree");
  var docTitleEl = document.getElementById("doc-title");
  var btnSidebarMobile = document.getElementById("btn-sidebar-mobile");
  var S = {
    sidebarOpen: false,
    rootPath: null,
    // Currently open root folder
    activeFilePath: null,
    // File open in the editor
    selectedDirPath: null,
    // Last folder clicked in the tree (for new file/folder)
    isDirty: false,
    // True when editor differs from saved file
    _scratchpadVolatileKey: null,
    // string | null — current placeholder path
    /* sidebarViewMode : 'tree' | 'card'  (persisted to localStorage) */
    sidebarViewMode: "tree",
    cardViewDir: null,
    /* Media file shown in the preview while no note is open (fileops.js
       openMediaFile). Display + naming only: the tree highlights it, and
       the scratchpad auto-create (save.js) names the new note after it and
       places it beside it (pendingNoteDir). Cleared whenever the editor
       moves on to a file, a folder switch, or the scratchpad creates the
       note. */
    previewMediaPath: null,
    selectionAnchor: null,
    // Last non-shift clicked path (range anchor)
    _dragItems: [],
    // [{path, type}] currently being dragged
    /* Serialize async FS operations — prevents simultaneous move/rename/delete
       from corrupting state if the user clicks very quickly. */
    _operationLock: false,
    /* True from the moment a project switch empties the editor until the new
       project is open (fileops.switchProject). Text typed meanwhile is only
       backed up: its note is created once the switch is over, in the project
       that is then open — not in the one being left. */
    _projectSwitch: false,
    _externalChangeInProgress: false,
    _replaceGeneration: 0,
    /* Auto-save hold (save.js setAutosaveHold): the held file's path, and why
       — 'conflict' | 'missing' | 'unreadable'. */
    _conflictHoldPath: null,
    _holdReason: null,
    /* What is on disk for the active file (save.js rememberDiskContent): the
       exact text last read from or written to it, and its line-ending style.
       The watcher compares against this to recognise our own writes. */
    _diskBaseline: null,
    _diskEol: "\n"
  };
  try {
    const vm = localStorage.getItem("revery_sidebar_view");
    if (vm === "card" || vm === "tree") S.sidebarViewMode = vm;
  } catch {
  }
  var expandedDirs = /* @__PURE__ */ new Set();
  var selectedItems = /* @__PURE__ */ new Set();
  var _previewCache = /* @__PURE__ */ new Map();
  var SCRATCHPAD_PREFIX = "__revery_scratchpad__/";
  function ensureScratchpadVolatileKey() {
    if (S._scratchpadVolatileKey) return S._scratchpadVolatileKey;
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, "0")).join("");
    S._scratchpadVolatileKey = SCRATCHPAD_PREFIX + rnd;
    return S._scratchpadVolatileKey;
  }
  function pendingNoteDir() {
    if (S.activeFilePath) return parentDir(S.activeFilePath);
    if (S.previewMediaPath) return parentDir(S.previewMediaPath) || S.rootPath || null;
    return S.selectedDirPath || S.rootPath || null;
  }
  function parentDir(p) {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (i < 0) return "";
    return i === 0 ? p[0] : p.slice(0, i);
  }

  // src/sidebar/paths.js
  var paths_exports = {};
  __export(paths_exports, {
    MEDIA_EXTS: () => MEDIA_EXTS,
    TEXT_EXTS: () => TEXT_EXTS,
    baseNameOf: () => baseNameOf,
    checkEntryName: () => checkEntryName,
    decodeLinkDest: () => decodeLinkDest,
    dirOf: () => dirOf,
    encodeLinkDest: () => encodeLinkDest,
    extOf: () => extOf,
    hasUrlScheme: () => hasUrlScheme,
    isAbsolutePath: () => isAbsolutePath,
    isInsideRoot: () => isInsideRoot,
    isWindowsPath: () => isWindowsPath,
    joinPath: () => joinPath,
    mediaLinkMarkdown: () => mediaLinkMarkdown,
    normalizePath: () => normalizePath,
    parentPathOf: () => parentPathOf,
    pathKey: () => pathKey,
    relativePath: () => relativePath,
    remapUnder: () => remapUnder,
    renamedFileName: () => renamedFileName,
    resolvePath: () => resolvePath,
    samePath: () => samePath,
    sanitizeEntryName: () => sanitizeEntryName,
    uniqueName: () => uniqueName
  });
  var DRIVE_RE = /^[a-zA-Z]:(\/|$)/;
  var UNC_RE = /^\/\/[^/]/;
  var SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;
  function normalizePath(p) {
    return String(p || "").replace(/\\/g, "/").replace(/(.)\/$/, "$1");
  }
  function isWindowsPath(p) {
    const n = normalizePath(p);
    return DRIVE_RE.test(n) || UNC_RE.test(n);
  }
  function isAbsolutePath(p) {
    const n = normalizePath(p);
    return n.startsWith("/") || DRIVE_RE.test(n);
  }
  function hasUrlScheme(s) {
    return SCHEME_RE.test(String(s || ""));
  }
  function dirOf(p) {
    const n = normalizePath(p);
    const i = n.lastIndexOf("/");
    if (i < 0) return "";
    return i === 0 ? "/" : n.slice(0, i);
  }
  function baseNameOf(p) {
    const n = normalizePath(p);
    return n.slice(n.lastIndexOf("/") + 1);
  }
  function segments(dir) {
    const n = normalizePath(dir);
    return n === "/" ? [""] : n.split("/");
  }
  function sameSegment(a, b, caseInsensitive) {
    return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  function resolvePath(baseDir, rel) {
    const r = normalizePath(rel);
    if (hasUrlScheme(r) || isAbsolutePath(r) || !baseDir) return r;
    const parts = segments(baseDir);
    for (const seg of r.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return parts.join("/");
  }
  function relativePath(fromDir, toFile) {
    const f = segments(fromDir);
    const t = normalizePath(toFile).split("/");
    const ci = isWindowsPath(fromDir) || isWindowsPath(toFile);
    let common = 0;
    while (common < f.length && common < t.length && sameSegment(f[common], t[common], ci)) common++;
    return "../".repeat(f.length - common) + t.slice(common).join("/");
  }
  function encodeLinkDest(p) {
    return String(p).replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  }
  function decodeLinkDest(s) {
    try {
      return decodeURIComponent(String(s));
    } catch (_) {
      return String(s);
    }
  }
  function isInsideRoot(absPath, rootPath) {
    const r = normalizePath(rootPath);
    if (!r) return false;
    const a = normalizePath(absPath);
    const ci = isWindowsPath(r);
    const A = ci ? a.toLowerCase() : a;
    const R = ci ? r.toLowerCase() : r;
    if (A === R) return true;
    return A.startsWith(R === "/" ? "/" : R + "/");
  }
  function samePath(a, b) {
    const x = pathKey(a);
    return !!x && x === pathKey(b);
  }
  function pathKey(p) {
    const n = normalizePath(p);
    return isWindowsPath(n) ? n.toLowerCase() : n;
  }
  function sepOf(p) {
    const s = String(p);
    return s.includes("\\") && !s.includes("/") ? "\\" : "/";
  }
  function joinPath(dir, name) {
    const d = String(dir);
    if (d.endsWith("/") || d.endsWith("\\")) return d + name;
    return d + sepOf(d) + name;
  }
  function parentPathOf(p) {
    const s = String(p || "");
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    if (i < 0) return "";
    if (i === 0) return s[0];
    const head = s.slice(0, i);
    return /^[A-Za-z]:$/.test(head) ? head + s[i] : head;
  }
  function remapUnder(p, from, to) {
    if (!p || !from || !to) return null;
    if (samePath(p, from)) return to;
    if (!isInsideRoot(p, from)) return null;
    const rest = normalizePath(p).slice(normalizePath(from).length);
    const sep = sepOf(to);
    return String(to).replace(/[/\\]$/, "") + (sep === "/" ? rest : rest.replace(/\//g, sep));
  }
  var TEXT_EXTS = /* @__PURE__ */ new Set([".md", ".txt"]);
  var MEDIA_EXTS = /* @__PURE__ */ new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".ico",
    ".tiff",
    ".tif",
    ".avif"
  ]);
  function extOf(name) {
    const n = String(name || "");
    const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(i) : "";
  }
  function extGroup(ext) {
    const e = String(ext).toLowerCase();
    if (TEXT_EXTS.has(e)) return "text";
    if (MEDIA_EXTS.has(e)) return "media";
    return null;
  }
  var NAME_FORBIDDEN_RE = /[/\\?%*:|"<>]/g;
  var WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
  function sanitizeEntryName(raw) {
    return String(raw == null ? "" : raw).trim().replace(NAME_FORBIDDEN_RE, "_");
  }
  function checkEntryName(name) {
    const n = String(name == null ? "" : name);
    if (!n.trim()) return "empty";
    if (n === "." || n === "..") return "invalid";
    if (/[\u0000-\u001f\u007f/\\]/.test(n)) return "invalid";
    if (n.startsWith(".")) return "hidden";
    if (/[. ]$/.test(n) || n.startsWith(" ")) return "edge";
    if (WIN_DEVICE_RE.test(n)) return "device";
    if (/\.revery_(tmp|bak)$/i.test(n)) return "internal";
    if (new TextEncoder().encode(n).length > 255) return "long";
    return null;
  }
  function renamedFileName(oldName, typed) {
    const oldExt = extOf(oldName);
    if (!oldExt) return typed;
    const newExt = extOf(typed);
    if (newExt) {
      if (newExt.toLowerCase() === oldExt.toLowerCase()) return typed;
      const g = extGroup(newExt);
      if (g && g === extGroup(oldExt)) return typed;
    }
    return typed + oldExt;
  }
  function uniqueName(existingNames, stem, suffix = "", ignoreName = null) {
    const taken = /* @__PURE__ */ new Set();
    for (const n of existingNames || []) {
      if (typeof n === "string" && n !== ignoreName) taken.add(n.toLowerCase());
    }
    let candidate = stem + suffix;
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
      candidate = `${stem}_${i}${suffix}`;
    }
    return candidate;
  }
  function mediaLinkMarkdown(mediaPath, baseDir) {
    const name = baseNameOf(mediaPath);
    const rel = baseDir ? relativePath(baseDir, mediaPath) : name;
    return `![${name}](${encodeLinkDest(rel)})`;
  }

  // src/sidebar/drop_transport.js
  function decideFileDropTransport(env, platform) {
    if (env !== "tauri") return "dom";
    return /^win/i.test(String(platform || "")) ? "dom" : "native";
  }
  function fileDropTransport() {
    const env = window.NativeAPI ? window.NativeAPI.env : "web";
    return decideFileDropTransport(env, navigator.platform);
  }
  function isOsFileDrop(dt) {
    if (!dt) return false;
    if (dt.files && dt.files.length) return true;
    const types = Array.from(dt.types || []);
    if (types.includes("Files")) return true;
    if (types.includes("text/uri-list")) {
      let list = "";
      try {
        list = dt.getData("text/uri-list") || "";
      } catch (_) {
      }
      return /^file:/im.test(list);
    }
    return false;
  }
  var SIDEBAR_ITEM_MIME = "application/x-revery-path";
  function encodeSidebarPayload(paths) {
    return JSON.stringify(paths);
  }
  function decodeSidebarPayload(raw) {
    if (!raw) return [];
    if (raw[0] !== "[") return [raw];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((p) => typeof p === "string" && p) : [];
    } catch (_) {
      return [];
    }
  }

  // src/sidebar/helpers.js
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 32768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  function stripMarkdownForPreview(raw) {
    return raw.replace(/^---[\s\S]*?---\n?/m, "").replace(/^#{1,6}\s+/gm, "").replace(/!\[.*?\]\(.*?\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`{1,3}[^`]*`{1,3}/g, "").replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/\n{2,}/g, " ").replace(/\s+/g, " ").trim();
  }
  function getFileCategory(name) {
    const dot = name.lastIndexOf(".");
    if (dot < 0) return "other";
    const ext = name.substring(dot).toLowerCase();
    if (TEXT_EXTS.has(ext)) return "text";
    if (MEDIA_EXTS.has(ext)) return "media";
    return "other";
  }
  function mediaMarkdown(mediaPath, fromDir) {
    return mediaLinkMarkdown(mediaPath, fromDir || pendingNoteDir());
  }
  function setSidebarDragData(dataTransfer, items) {
    const files = items.filter((it) => it.type === "file").map((it) => it.path);
    const media = files.filter((p) => getFileCategory(baseNameOf(p)) === "media");
    dataTransfer.effectAllowed = media.length ? "copyMove" : "move";
    dataTransfer.setData(SIDEBAR_ITEM_MIME, encodeSidebarPayload(files));
    dataTransfer.setData("text/plain", media.map((p) => mediaMarkdown(p)).join("\n"));
  }
  async function uniqueDestPath(targetDir, name, type) {
    let existingNames;
    try {
      const entries = await window.NativeAPI.readDirectory(targetDir);
      existingNames = entries.map((e) => e.name);
    } catch {
      return joinPath(targetDir, name);
    }
    const lastDot = name.lastIndexOf(".");
    const hasExt = type === "file" && lastDot > 0;
    const base = hasExt ? name.substring(0, lastDot) : name;
    const ext = hasExt ? name.substring(lastDot) : "";
    return joinPath(targetDir, uniqueName(existingNames, base, ext));
  }
  async function uniquePath(dir, baseName, ext, ignoreName = null) {
    let names;
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      names = entries.map((e) => e.name);
    } catch {
      return joinPath(dir, `${baseName}.${ext}`);
    }
    return joinPath(dir, uniqueName(names, baseName, "." + ext, ignoreName));
  }
  async function saveTextBesideNote(notePath, content, suffix = "_recovered") {
    let dir = parentPathOf(notePath);
    if (!dir || !S.rootPath || !isInsideRoot(dir, S.rootPath)) dir = S.rootPath;
    try {
      await window.NativeAPI.readDirectory(dir);
    } catch (_) {
      dir = S.rootPath;
    }
    if (!dir) throw new Error("No project folder is open.");
    const base = baseNameOf(notePath);
    const dot = base.lastIndexOf(".");
    const oldExt = dot > 0 ? base.slice(dot + 1) : "";
    const ext = /^(md|txt)$/i.test(oldExt) ? oldExt : "md";
    let stem = (dot > 0 ? base.slice(0, dot) : base) + suffix;
    if (checkEntryName(`${stem}.${ext}`) || new TextEncoder().encode(`${stem}.${ext}`).length > 150) {
      stem = suffix.replace(/^_+/, "") || "recovered";
    }
    let newPath = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      newPath = await uniquePath(dir, stem, ext);
      try {
        await window.NativeAPI.createFile(newPath);
        break;
      } catch (err) {
        if (String(err).includes("already exists") && attempt < 4) continue;
        throw err;
      }
    }
    try {
      await window.NativeAPI.writeFile(newPath, content);
    } catch (err) {
      window.NativeAPI.deleteNode(newPath).catch(() => {
      });
      throw err;
    }
    return newPath;
  }
  async function fileExistsViaListing(p) {
    if (typeof p !== "string") return null;
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    if (i <= 0) return null;
    const dir = p.slice(0, i);
    const name = p.slice(i + 1);
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      return (entries || []).some((e) => e && e.name === name && e.type === "file");
    } catch (_) {
      return null;
    }
  }
  async function scanBakOrphansIn(dir) {
    if (!dir) return [];
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      return entries.filter((e) => e.type === "file" && /\.revery_bak$/.test(e.name)).map((e) => e.path);
    } catch (e) {
      console.warn("[Sidebar] Bak orphan scan failed for", dir, e);
      return [];
    }
  }
  async function reportBakOrphans(rootDir, lastFile) {
    const dirs = /* @__PURE__ */ new Set();
    if (rootDir) dirs.add(rootDir);
    if (lastFile) {
      const lastDir = lastFile.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      if (lastDir) dirs.add(lastDir);
    }
    const all = [];
    for (const d of dirs) {
      const found = await scanBakOrphansIn(d);
      for (const p of found) if (!all.includes(p)) all.push(p);
    }
    if (all.length === 0) return;
    const display = all.slice(0, 5).map((p) => "\u2022 " + p.replace(/\\/g, "/").split("/").pop()).join("\n");
    const overflow = all.length > 5 ? `
\u2022 \u2026and ${all.length - 5} more` : "";
    await window.NativeAPI.showMessageBox({
      type: "warning",
      title: window.t("Recovery Backup Files Found"),
      message: window.t("{n} backup file(s) from a previous interrupted save were found.").replace("{n}", all.length),
      detail: `These were created during a cross-device save that did not complete. The matching original file may be corrupted.

${display}${overflow}

To recover: open the file in Revery and verify it looks correct. If it is corrupted, locate the .revery_bak file in your file manager and rename it to the note's own name to replace the original (the backup is named after the note \u2014 shortened if that name is long \u2014 followed by ".<timestamp>.revery_bak").`,
      buttons: [window.t("OK")]
    });
  }

  // src/sidebar/icons.js
  var ICONS = {
    /* folder.svg (glyph-u1F4C1) */
    "folder": {
      vb: "124 -517 530.99 535.99",
      d: "M316 383.00390625H617.00390625V18.99609375H161.99609375V479.00390625H297.00390625V402.0C297.00390625 391.501953125 305.501953125 383.00390625 316.0 383.00390625ZM124.00390625 498.0V0.0C124.00390625 -10.498046875 132.501953125 -18.99609375 143.0 -18.99609375H636.0C646.498046875 -18.99609375 654.99609375 -10.498046875 654.99609375 0.0V402.0C654.99609375 412.498046875 646.498046875 420.99609375 636.0 420.99609375H334.99609375V498.0C334.99609375 508.498046875 326.498046875 516.99609375 316.0 516.99609375H143.0C132.501953125 516.99609375 124.00390625 508.498046875 124.00390625 498.0Z"
    },
    /* open_folder.svg (glyph-u1F4C2) */
    "folder-open": {
      vb: "64 -517 676.99 535.99",
      d: "M256 383.00372314453125H557.0037231445312V18.99627685546875H101.99627685546875V479.00372314453125H237.00372314453125V402.0C237.00372314453125 391.5022430419922 245.50213623046875 383.00372314453125 256.0 383.00372314453125ZM64.00372314453125 498.0V0.0C64.00372314453125 -10.497756958007812 72.50213623046875 -18.99627685546875 83.0 -18.99627685546875H576.0C581.54296875 -18.99627685546875 586.5283203125 -18.8447265625 590.0 -18.8447265625C593.4716796875 -18.8447265625 598.4569854736328 -18.99627685546875 604.0 -18.99627685546875C612.8980102539062 -18.99627685546875 620.4775695800781 -12.863998413085938 622.4822692871094 -4.4034881591796875L740.482421875 473.5966796875C740.8251953125 475.04296875 740.99609375 476.521484375 740.99609375 478.0C740.99609375 488.478515625 732.52734375 496.9697265625 722.048828125 496.99609375C549.9921875 497.435546875 453.6474609375 497.4404296875 450.734375 497.4404296875C391.376953125 497.4404296875 357.31640625 497.328125 348.5771484375 497.09765625C328.578125 496.5703125 328.00390625 479.9130859375 328.00390625 478.0C328.00390625 467.501953125 336.501953125 459.00390625 347.0 459.00390625C349.0380859375 459.00390625 351.076171875 459.3291015625 353.029296875 459.98046875L361.478515625 459.267578125C379.1298828125 459.3984375 411.6845703125 459.4482421875 450.6015625 459.4482421875C541.1689453125 459.4482421875 646.189453125 459.181640625 697.9873046875 459.0615234375L594.9962768554688 44.40617370605469V402.0C594.9962768554688 412.4977569580078 586.4978637695312 420.99627685546875 576.0 420.99627685546875H274.99627685546875V498.0C274.99627685546875 508.4977569580078 266.49786376953125 516.9962768554688 256.0 516.9962768554688H83.0C72.50224304199219 516.9962768554688 64.00372314453125 508.49786376953125 64.00372314453125 498.0Z"
    },
    /* new_folder.svg (glyph-u1F5C2) */
    "folder-plus": {
      vb: "124 -517 607 535.99",
      d: "M731 360C731 371 723 380 712 380H615V477C615 488 607 496 596 496C585 496 576 488 576 477V380H479C468 380 460 371 460 360C460 349 468 341 479 341H576V244C576 233 585 225 596 225C607 225 615 233 615 244V341H712C723 341 731 349 731 360ZM316 383.00390625H399.3173828125C409.814453125 383.00390625 418.3134765625 391.501953125 418.3134765625 402.0C418.3134765625 412.498046875 409.814453125 420.99609375 399.3173828125 420.99609375H334.99609375V498.0C334.99609375 508.498046875 326.498046875 516.99609375 316.0 516.99609375H143.0C132.501953125 516.99609375 124.00390625 508.498046875 124.00390625 498.0V0.0C124.00390625 -10.498046875 132.501953125 -18.99609375 143.0 -18.99609375H636.0C646.498046875 -18.99609375 654.99609375 -10.498046875 654.99609375 0.0V160.466796875C654.99609375 170.96484375 646.498046875 179.462890625 636.0 179.462890625C625.501953125 179.462890625 617.00390625 170.96484375 617.00390625 160.466796875V18.99609375H161.99609375V479.00390625H297.00390625V402.0C297.00390625 391.501953125 305.501953125 383.00390625 316.0 383.00390625Z"
    },
    /* edit_file.svg (glyph-u1F4DD) */
    "file": {
      vb: "121 -560.04 508.99 560.04",
      d: "M433.0068359375 88.55859375C434.9404296875 88.55859375 436.45703125 88.5654296875 437.6806640625 88.580078125C459.3076171875 88.849609375 460.01953125 105.1806640625 460.01953125 107.330078125C460.01953125 107.759765625 459.99609375 108.0 459.99609375 108.0C459.99609375 118.498046875 451.498046875 126.99609375 441.0 126.99609375C440.904296875 126.99609375 438.41015625 126.57421875 431.47265625 126.57421875C429.4375 126.57421875 348.9638671875 126.99609375 228.0 126.99609375C217.501953125 126.99609375 209.00390625 118.498046875 209.00390625 108.0C209.00390625 97.501953125 217.501953125 89.00390625 228.0 89.00390625C356.7333984375 89.00390625 430.9560546875 88.55859375 433.0068359375 88.55859375ZM352.884765625 479.0C352.884765625 489.498046875 344.38671875 497.99609375 333.888671875 497.99609375L140.0 497.99627685546875C129.5022430419922 497.99627685546875 121.00372314453125 489.49786376953125 121.00372314453125 479.0V19.0C121.00372314453125 8.502243041992188 129.50213623046875 0.00372314453125 140.0 0.00372314453125H520.0C530.4977569580078 0.00372314453125 538.9962768554688 8.50213623046875 538.9962768554688 19.0L538.99609375 328.0C538.99609375 338.498046875 530.498046875 346.99609375 520.0 346.99609375C509.501953125 346.99609375 501.00390625 338.498046875 501.00390625 328.0L501.00372314453125 37.99627685546875H158.99627685546875V460.00372314453125L333.888671875 460.00390625C344.38671875 460.00390625 352.884765625 468.501953125 352.884765625 479.0ZM433.0068359375 188.55859375C434.9404296875 188.55859375 436.45703125 188.5654296875 437.6806640625 188.580078125C459.3076171875 188.849609375 460.01953125 205.1806640625 460.01953125 207.330078125C460.01953125 207.759765625 459.99609375 208.0 459.99609375 208.0C459.99609375 218.498046875 451.498046875 226.99609375 441.0 226.99609375C440.904296875 226.99609375 438.41015625 226.57421875 431.47265625 226.57421875C429.4375 226.57421875 348.9638671875 226.99609375 228.0 226.99609375C217.501953125 226.99609375 209.00390625 218.498046875 209.00390625 208.0C209.00390625 197.501953125 217.501953125 189.00390625 228.0 189.00390625C356.7333984375 189.00390625 430.9560546875 188.55859375 433.0068359375 188.55859375ZM611.2843475341797 560.0448760986328C604.3056335449219 560.0448913574219 601.3480224609375 557.7919006347656 596.7767639160156 554.3097076416016C568.1146240234375 532.47607421875 331.85694885253906 331.9539337158203 320.7169189453125 322.49693298339844C314.6950378417969 317.3848419189453 314.0037078857422 310.76914978027344 314.0037078857422 308.00001525878906C314.0037078857422 297.50225830078125 322.5021209716797 289.0037384033203 332.99998474121094 289.0037384033203C337.37481689453125 289.0037384033203 341.74964904785156 290.50352478027344 345.2830505371094 293.5030975341797C582.0330963134766 494.4721374511719 617.3809051513672 522.2091979980469 620.2330322265625 524.3900299072266C626.0774078369141 527.6397705078125 629.9962615966797 533.8829498291016 629.9962615966797 541.0000152587891C629.9962615966797 550.6575012207031 622.1800842285156 560.0448913574219 611.2843322753906 560.0448913574219Z"
    },
    /* table.svg (glyph-u1F9FE) */
    "file-lines": {
      vb: "80.5 -524.55 485.78 549.75",
      d: "M528.2879028320312 486.55841064453125V452.81443786621094C324.1061553955078 453.19923400878906 316.7191619873047 453.21836853027344 118.49237060546875 453.8158874511719V486.5583953857422ZM547.2841796875 524.5509490966797H99.49609375C88.99833679199219 524.5509490966797 80.49981689453125 516.0525360107422 80.49981689453125 505.55467224121094V-6.2041168212890625C80.49981689453125 -16.701873779296875 88.99822998046875 -25.200393676757812 99.49609375 -25.200393676757812H547.2841796875C557.7819366455078 -25.200393676757812 566.2804565429688 -16.701980590820312 566.2804565429688 -6.2041168212890625V505.55467224121094C566.2804565429688 516.0524291992188 557.7820434570312 524.5509490966797 547.2841796875 524.5509490966797ZM118.49237060546875 415.8203887939453C179.79832458496094 415.6165313720703 241.1305694580078 415.43894958496094 302.4862060546875 415.28477478027344L302.9978332519531 336.2664337158203L118.49237060546875 336.71620178222656ZM528.2879028320312 414.81788635253906V335.7172393798828L340.9917755126953 336.17381286621094L340.4801483154297 415.19227600097656C403.0600128173828 415.0447692871094 465.6636047363281 414.9209899902344 528.2878875732422 414.81788635253906ZM118.49235534667969 298.72352600097656 303.2438201904297 298.2731628417969 303.8038787841797 211.774658203125 118.49235534667969 212.22596740722656ZM528.2878875732422 297.7245788574219V211.2279510498047L341.7978210449219 211.68212890625L341.2377624511719 298.1805419921875ZM118.49234008789062 50.7987060546875 528.2878723144531 49.79975891113281V12.792144775390625H118.49234008789062ZM118.49234008789062 88.79136657714844V174.23329162597656L304.04986572265625 173.78138732910156L304.6031036376953 88.33769226074219ZM528.2878875732422 87.79243469238281 342.59706115722656 88.24508666992188 342.0438232421875 173.68887329101562 528.2878875732422 173.23529052734375Z"
    },
    /* new_file.svg (glyph-u1F4C4) */
    "file-plus": {
      vb: "121 -555 490 555",
      d: "M433.0068359375 188.55859375C434.9404296875 188.55859375 436.45703125 188.5654296875 437.6806640625 188.580078125C459.3076171875 188.849609375 460.01953125 205.1806640625 460.01953125 207.330078125C460.01953125 207.759765625 459.99609375 208.0 459.99609375 208.0C459.99609375 218.498046875 451.498046875 226.99609375 441.0 226.99609375C440.904296875 226.99609375 438.41015625 226.57421875 431.47265625 226.57421875C429.4375 226.57421875 348.9638671875 226.99609375 228.0 226.99609375C217.501953125 226.99609375 209.00390625 218.498046875 209.00390625 208.0C209.00390625 197.501953125 217.501953125 189.00390625 228.0 189.00390625C356.7333984375 189.00390625 430.9560546875 188.55859375 433.0068359375 188.55859375ZM611.0 419.0C611.0 430.0 603.0 439.0 592.0 439.0H495.0V536.0C495.0 547.0 487.0 555.0 476.0 555.0C465.0 555.0 456.0 547.0 456.0 536.0V439.0H359.0C348.0 439.0 340.0 430.0 340.0 419.0C340.0 408.0 348.0 400.0 359.0 400.0H456.0V303.0C456.0 292.0 465.0 284.0 476.0 284.0C487.0 284.0 495.0 292.0 495.0 303.0V400.0H592.0C603.0 400.0 611.0 408.0 611.0 419.0ZM322.88482666015625 479.0C322.88482666015625 489.4977569580078 314.38641357421875 497.99627685546875 303.88856506347656 497.99627685546875H140.0C129.5022430419922 497.99627685546875 121.00372314453125 489.49786376953125 121.00372314453125 479.0V19.0C121.00372314453125 8.502243041992188 129.50213623046875 0.00372314453125 140.0 0.00372314453125H520.0C530.4977569580078 0.00372314453125 538.9962768554688 8.50213623046875 538.9962768554688 19.0V218.0C538.9962768554688 228.4977569580078 530.4978637695312 236.99627685546875 520.0 236.99627685546875C509.5022430419922 236.99627685546875 501.00372314453125 228.49786376953125 501.00372314453125 218.0V37.99627685546875H158.99627685546875V460.00372314453125H303.88856506347656C314.3863220214844 460.00372314453125 322.8848419189453 468.50213623046875 322.8848419189453 479.0ZM433.00685119628906 88.55859375C434.94044494628906 88.55859375 436.45704650878906 88.5654296875 437.68067932128906 88.580078125C459.30763244628906 88.849609375 460.01954650878906 105.1806640625 460.01954650878906 107.330078125C460.01954650878906 107.759765625 459.99610900878906 108.0 459.99610900878906 108.0C459.99610900878906 118.498046875 451.49806213378906 126.99609375 441.00001525878906 126.99609375C440.90431213378906 126.99609375 438.41017150878906 126.57421875 431.47267150878906 126.57421875C429.43751525878906 126.57421875 348.96388244628906 126.99609375 228.00001525878906 126.99609375C217.50196838378906 126.99609375 209.00392150878906 118.498046875 209.00392150878906 108.0C209.00392150878906 97.501953125 217.50196838378906 89.00390625 228.00001525878906 89.00390625C356.73341369628906 89.00390625 430.95606994628906 88.55859375 433.00685119628906 88.55859375Z"
    },
    /* image.svg (glyph-u1F5BC) */
    "image": {
      vb: "41 -517 585.99 511.99",
      d: "M41.00390625 364V24C41.00390625 13.501953125 49.501953125 5.00390625 60.0 5.00390625H608.0C618.498046875 5.00390625 626.99609375 13.501953125 626.99609375 24.0V364.0C626.99609375 374.498046875 618.498046875 382.99609375 608.0 382.99609375H584.8369140625L342.0615234375 514.7041015625C339.2451171875 516.232421875 336.1220703125 516.99609375 333.0 516.99609375C329.8544921875 516.99609375 326.7099609375 516.220703125 323.876953125 514.6708984375L83.30078125 382.99609375H60.0C49.501953125 382.99609375 41.00390625 374.498046875 41.00390625 364.0ZM482.0 160.00390625C482.3173828125 160.00390625 482.634765625 160.01171875 482.9521484375 160.02734375C510.6396484375 161.4072265625 537.357421875 171.6875 558.8369140625 190.2265625L589.00390625 206.0771484375V42.99609375H78.99609375V127.48828125C81.3564453125 129.1650390625 84.150390625 131.1728515625 87.4951171875 133.578125C132.8515625 166.18359375 179.154296875 198.1435546875 229.7646484375 198.1435546875C298.8828125 198.1435546875 397.0390625 160.00390625 482.0 160.00390625ZM162.462890625 382.99609375 333.0400390625 476.3583984375 505.1328125 382.99609375ZM89.8876953125 345.00390625H589.00390625V249.01171875C537.0712890625 221.72265625 536.9833984375 221.64453125 535.314453125 220.1455078125C520.3291015625 206.6865234375 501.39453125 199.1005859375 481.560546875 198.0C399.107421875 198.623046875 305.3798828125 236.14453125 229.4384765625 236.14453125C169.8916015625 236.14453125 120.51171875 203.888671875 78.99609375 174.2626953125V345.00390625H86.1259765625C86.744140625 344.943359375 87.3720703125 344.912109375 88.0068359375 344.912109375C88.6416015625 344.912109375 89.26953125 344.943359375 89.8876953125 345.00390625Z"
    },
    /* u1F4CE.svg (glyph-u1F4CE) */
    "paperclip": {
      vb: "65.82 -537.49 532.37 576.56",
      d: "M282.2373046875 263.4541015625C229.16796875 210.384765625 229.16796875 210.384765625 228.75390625 203.119140625C223.2294921875 185.751953125 197.060546875 113.6943359375 197.060546875 113.6943359375C194.6123046875 106.958984375 196.125 99.14453125 201.4912109375 93.77734375C209.6591796875 85.609375 219.6806640625 88.728515625 221.32421875 89.3173828125L316.783203125 123.509765625C319.453125 124.466796875 321.8486328125 126.0048828125 323.814453125 127.970703125L588.9453125 393.1015625C596.3681640625 400.5244140625 596.3681640625 412.54296875 588.9453125 419.9658203125L476.984375 531.927734375C469.560546875 539.3505859375 457.5419921875 539.3505859375 450.119140625 531.927734375L73.123046875 154.2880859375C69.87890625 151.0380859375 67.8037109375 146.6201171875 67.5859375 141.7236328125C65.4775390625 94.2998046875 63.59765625 10.876953125 72.3095703125 -18.0576171875C73.2548828125 -23.474609375 76.2373046875 -27.1962890625 78.109375 -29.0673828125C83.8251953125 -34.783203125 92.8447265625 -35.90625 99.4775390625 -36.7314453125C130.365234375 -40.57421875 199.84375 -38.9892578125 254.705078125 -36.865234375C259.65234375 -36.673828125 264.1162109375 -34.5869140625 267.390625 -31.3115234375C473.771484375 173.4658203125 473.771484375 173.4658203125 509.62109375 209.31640625C530.951171875 230.6455078125 549.865234375 249.6396484375 564.2685546875 264.2373046875C598.1826171875 298.609375 598.1826171875 298.623046875 598.1826171875 307.3154296875C598.1826171875 310.3466796875 597.359375 316.017578125 592.607421875 320.76953125C585.1845703125 328.1923828125 573.166015625 328.1923828125 565.7431640625 320.76953125C564.908203125 319.9345703125 574.939453125 328.3681640625 483.0244140625 236.453125C397.982421875 151.4111328125 273.837890625 28.5263671875 246.2041015625 1.17578125C246.0859375 1.056640625 245.9677734375 0.9423828125 245.853515625 0.828125C165.5048828125 -2.13671875 126.203125 -1.1416015625 107.330078125 0.6630859375C102.42578125 33.7099609375 103.568359375 92.1083984375 105.234375 132.6787109375L463.5634765625 491.619140625L548.6484375 406.5341796875L299.9755859375 157.861328125L246.4892578125 138.703125C256.6630859375 167.087890625 262.8779296875 184.912109375 265.1748046875 192.2353515625C270.890625 198.2373046875 286.0068359375 213.4931640625 308.919921875 236.4052734375C363.7685546875 291.25390625 446.8642578125 373.55078125 446.8642578125 373.55078125C454.46875 381.154296875 454.2646484375 393.1474609375 446.9306640625 400.4814453125C439.5322265625 407.8798828125 427.564453125 407.908203125 420.1318359375 400.546875C338.302734375 319.5087890625 283.6123046875 264.8291015625 282.2373046875 263.4541015625Z"
    },
    /* table.svg (glyph-u1F9FE) */
    "view-cards": {
      vb: "80.5 -524.55 485.78 549.75",
      d: "M528.2879028320312 486.55841064453125V452.81443786621094C324.1061553955078 453.19923400878906 316.7191619873047 453.21836853027344 118.49237060546875 453.8158874511719V486.5583953857422ZM547.2841796875 524.5509490966797H99.49609375C88.99833679199219 524.5509490966797 80.49981689453125 516.0525360107422 80.49981689453125 505.55467224121094V-6.2041168212890625C80.49981689453125 -16.701873779296875 88.99822998046875 -25.200393676757812 99.49609375 -25.200393676757812H547.2841796875C557.7819366455078 -25.200393676757812 566.2804565429688 -16.701980590820312 566.2804565429688 -6.2041168212890625V505.55467224121094C566.2804565429688 516.0524291992188 557.7820434570312 524.5509490966797 547.2841796875 524.5509490966797ZM118.49237060546875 415.8203887939453C179.79832458496094 415.6165313720703 241.1305694580078 415.43894958496094 302.4862060546875 415.28477478027344L302.9978332519531 336.2664337158203L118.49237060546875 336.71620178222656ZM528.2879028320312 414.81788635253906V335.7172393798828L340.9917755126953 336.17381286621094L340.4801483154297 415.19227600097656C403.0600128173828 415.0447692871094 465.6636047363281 414.9209899902344 528.2878875732422 414.81788635253906ZM118.49235534667969 298.72352600097656 303.2438201904297 298.2731628417969 303.8038787841797 211.774658203125 118.49235534667969 212.22596740722656ZM528.2878875732422 297.7245788574219V211.2279510498047L341.7978210449219 211.68212890625L341.2377624511719 298.1805419921875ZM118.49234008789062 50.7987060546875 528.2878723144531 49.79975891113281V12.792144775390625H118.49234008789062ZM118.49234008789062 88.79136657714844V174.23329162597656L304.04986572265625 173.78138732910156L304.6031036376953 88.33769226074219ZM528.2878875732422 87.79243469238281 342.59706115722656 88.24508666992188 342.0438232421875 173.68887329101562 528.2878875732422 173.23529052734375Z"
    },
    /* folder_tree_view.svg (glyph-u1F5C3) */
    "view-list": {
      vb: "93.5 -509 470.99 542.99",
      d: "M562.49609375 490C562.49609375 500.498046875 553.998046875 508.99609375 543.5 508.99609375H193.5C183.001953125 508.99609375 174.50390625 500.498046875 174.50390625 490.0C174.50390625 479.501953125 183.001953125 471.00390625 193.5 471.00390625H543.5C553.998046875 471.00390625 562.49609375 479.501953125 562.49609375 490.0ZM112.5 470.00390625C122.998046875 470.00390625 131.49609375 478.501953125 131.49609375 489.0C131.49609375 499.498046875 122.998046875 507.99609375 112.5 507.99609375C102.001953125 507.99609375 93.50390625 499.498046875 93.50390625 489.0C93.50390625 478.501953125 102.001953125 470.00390625 112.5 470.00390625ZM112.5 356.00390625C122.998046875 356.00390625 131.49609375 364.501953125 131.49609375 375.0C131.49609375 385.498046875 122.998046875 393.99609375 112.5 393.99609375C102.001953125 393.99609375 93.50390625 385.498046875 93.50390625 375.0C93.50390625 364.501953125 102.001953125 356.00390625 112.5 356.00390625ZM562.49609375 294.0C562.49609375 283.501953125 553.998046875 275.00390625 543.5 275.00390625H193.5C183.001953125 275.00390625 174.50390625 283.501953125 174.50390625 294.0V374.0C174.50390625 384.498046875 183.001953125 392.99609375 193.5 392.99609375C203.998046875 392.99609375 212.49609375 384.498046875 212.49609375 374.0V312.99609375H543.5C553.998046875 312.99609375 562.49609375 304.498046875 562.49609375 294.0ZM564.49609375 186.0C564.49609375 196.498046875 555.998046875 204.99609375 545.5 204.99609375H275.5C265.001953125 204.99609375 256.50390625 196.498046875 256.50390625 186.0C256.50390625 175.501953125 265.001953125 167.00390625 275.5 167.00390625H545.5C555.998046875 167.00390625 564.49609375 175.501953125 564.49609375 186.0ZM194.5 166.00390625C204.998046875 166.00390625 213.49609375 174.501953125 213.49609375 185.0C213.49609375 195.498046875 204.998046875 203.99609375 194.5 203.99609375C184.001953125 203.99609375 175.50390625 195.498046875 175.50390625 185.0C175.50390625 174.501953125 184.001953125 166.00390625 194.5 166.00390625ZM564.49609375 90.0C564.49609375 100.498046875 555.998046875 108.99609375 545.5 108.99609375H275.5C265.001953125 108.99609375 256.50390625 100.498046875 256.50390625 90.0C256.50390625 79.501953125 265.001953125 71.00390625 275.5 71.00390625H545.5C555.998046875 71.00390625 564.49609375 79.501953125 564.49609375 90.0ZM194.5 70.00390625C204.998046875 70.00390625 213.49609375 78.501953125 213.49609375 89.0C213.49609375 99.498046875 204.998046875 107.99609375 194.5 107.99609375C184.001953125 107.99609375 175.50390625 99.498046875 175.50390625 89.0C175.50390625 78.501953125 184.001953125 70.00390625 194.5 70.00390625ZM562.49609375 -14.0C562.49609375 -3.501953125 553.998046875 4.99609375 543.5 4.99609375H193.5C183.001953125 4.99609375 174.50390625 -3.501953125 174.50390625 -14.0C174.50390625 -24.498046875 183.001953125 -32.99609375 193.5 -32.99609375H543.5C553.998046875 -32.99609375 562.49609375 -24.498046875 562.49609375 -14.0ZM112.5 -33.99609375C122.998046875 -33.99609375 131.49609375 -25.498046875 131.49609375 -15.0C131.49609375 -4.501953125 122.998046875 3.99609375 112.5 3.99609375C102.001953125 3.99609375 93.50390625 -4.501953125 93.50390625 -15.0C93.50390625 -25.498046875 102.001953125 -33.99609375 112.5 -33.99609375Z"
    },
    /* settings_slider.svg (glyph-u1F39B) */
    "sliders": {
      vb: "62 -512 543.99 529.99",
      d: "M605.99609375 447C605.99609375 457.498046875 597.498046875 465.99609375 587.0 465.99609375H253.1005859375C244.8466796875 492.439453125 219.9228515625 511.99609375 191.0 511.99609375C162.076171875 511.99609375 137.15234375 492.439453125 128.8994140625 465.99609375H81.0C70.501953125 465.99609375 62.00390625 457.498046875 62.00390625 447.0C62.00390625 436.501953125 70.501953125 428.00390625 81.0 428.00390625H128.904296875C137.171875 401.5029296875 162.1298828125 382.00390625 191.0 382.00390625C219.9208984375 382.00390625 244.8466796875 401.5576171875 253.1005859375 428.00390625H587.0C597.498046875 428.00390625 605.99609375 436.501953125 605.99609375 447.0ZM605.99609375 247.0C605.99609375 257.498046875 597.498046875 265.99609375 587.0 265.99609375H573.0966796875C564.8310546875 292.4912109375 539.8759765625 311.99609375 511.0 311.99609375C482.078125 311.99609375 457.1533203125 292.44140625 448.8994140625 265.99609375H81.0C70.501953125 265.99609375 62.00390625 257.498046875 62.00390625 247.0C62.00390625 236.501953125 70.501953125 228.00390625 81.0 228.00390625H448.8935546875C457.0771484375 201.89453125 481.7275390625 182.00390625 511.0 182.00390625C539.923828125 182.00390625 564.8466796875 201.560546875 573.1005859375 228.00390625H587.0C597.498046875 228.00390625 605.99609375 236.501953125 605.99609375 247.0ZM605.99609375 47.0C605.99609375 57.498046875 597.498046875 65.99609375 587.0 65.99609375H413.09375C404.8193359375 92.525390625 379.84375 111.99609375 351.0 111.99609375C322.0771484375 111.99609375 297.1533203125 92.4404296875 288.8994140625 65.99609375H81.0C70.501953125 65.99609375 62.00390625 57.498046875 62.00390625 47.0C62.00390625 36.501953125 70.501953125 28.00390625 81.0 28.00390625H288.90625C297.1806640625 1.474609375 322.15625 -17.99609375 351.0 -17.99609375C379.923828125 -17.99609375 404.84765625 1.560546875 413.1005859375 28.00390625H587.0C597.498046875 28.00390625 605.99609375 36.501953125 605.99609375 47.0ZM217.9375 445.1748046875C216.943359375 431.482421875 204.876953125 419.99609375 191.0 419.99609375C177.1962890625 419.99609375 165.1826171875 431.3623046875 164.0791015625 444.9609375C164.150390625 445.630859375 164.1865234375 446.3115234375 164.1865234375 447.0C164.1865234375 447.6884765625 164.150390625 448.3681640625 164.0791015625 449.0380859375C165.1826171875 462.640625 177.1982421875 474.00390625 191.0 474.00390625C204.875 474.00390625 216.943359375 462.5205078125 217.9375 448.8232421875C217.880859375 448.2236328125 217.8515625 447.615234375 217.8515625 447.0C217.8515625 446.384765625 217.880859375 445.775390625 217.9375 445.1748046875ZM537.9228515625 244.9775390625C536.826171875 231.3681640625 524.806640625 219.99609375 511.0 219.99609375C496.5478515625 219.99609375 484.0615234375 232.453125 483.99609375 246.8857421875V246.9306640625V247.0C483.99609375 261.486328125 496.5146484375 274.00390625 511.0 274.00390625C524.8095703125 274.00390625 536.8271484375 262.62890625 537.9228515625 249.0224609375C537.8525390625 248.357421875 537.81640625 247.68359375 537.81640625 247.0C537.81640625 246.3173828125 537.8525390625 245.642578125 537.9228515625 244.9775390625ZM377.9169921875 49.0908203125C377.841796875 48.404296875 377.8037109375 47.70703125 377.8037109375 47.0C377.8037109375 46.2939453125 377.841796875 45.5966796875 377.9169921875 44.9111328125C376.787109375 31.3310546875 364.7841796875 19.99609375 351.0 19.99609375C337.017578125 19.99609375 324.869140625 31.658203125 324.041015625 45.49609375C324.080078125 45.9921875 324.099609375 46.494140625 324.099609375 47.0C324.099609375 47.51171875 324.0791015625 48.01953125 324.0400390625 48.521484375C324.85546875 62.2890625 336.982421875 74.00390625 351.0 74.00390625C364.7880859375 74.00390625 376.7861328125 62.6650390625 377.9169921875 49.0908203125Z"
    },
    /* magnifier.svg (glyph-u1F50D) */
    "search": {
      vb: "57.18 -526.12 547.17 547.17",
      d: "M238.87696838378906 162.7147979736328C282.5114288330078 162.71478271484375 322.4273376464844 177.88890075683594 353.6632385253906 203.2783660888672C396.7949981689453 160.66798400878906 543.6646728515625 12.75921630859375 571.9126434326172 -15.488754272460938C575.6201324462891 -19.196258544921875 580.4839019775391 -21.050003051757812 585.3476715087891 -21.050003051757812C595.8454284667969 -21.050003051757812 604.3439483642578 -12.551589965820312 604.3439483642578 -2.0537261962890625C604.3439483642578 2.8100433349609375 602.4902038574219 7.6738128662109375 598.7826995849609 11.381301879882812C596.6297149658203 13.534286499023438 414.57054138183594 196.5345458984375 380.49571228027344 230.2235565185547C405.5955810546875 261.3692321777344 420.57916259765625 301.054931640625 420.57916259765625 344.416015625C420.57916259765625 445.1826477050781 339.6550598144531 526.1181945800781 238.8779296875 526.1181945800781C138.11129760742188 526.1181945800781 57.175750732421875 445.194091796875 57.175750732421875 344.4169616699219C57.175750732421875 243.65032958984375 138.099853515625 162.71478271484375 238.87698364257812 162.71478271484375ZM95.20584106445312 344.4160919189453C95.20582580566406 424.23651123046875 159.05648803710938 488.0881042480469 238.87704467773438 488.0881042480469C318.6974639892578 488.0881042480469 382.54905700683594 424.23744201660156 382.54905700683594 344.41688537597656C382.54905700683594 264.5964660644531 318.6983947753906 200.744873046875 238.87783813476562 200.744873046875C159.0574188232422 200.744873046875 95.20582580566406 264.5955352783203 95.20582580566406 344.4160919189453Z"
    },
    /* link.svg (glyph-u1F517) */
    "link": {
      vb: "73.86 -511.15 523.27 523.27",
      d: "M550.8486328125 464.58984375C502.4599609375 512.9794921875 446.7431640625 525.4775390625 414.71484375 493.44921875L225.2109375 303.9443359375C191.2001953125 269.9345703125 209.234375 212.60546875 253.9169921875 167.9228515625C263.556640625 158.283203125 274.162109375 149.611328125 285.2578125 142.3759765625C286.4501953125 141.576171875 287.712890625 140.92578125 289.01953125 140.42578125C292.5888671875 139.0556640625 296.466796875 138.8115234375 300.130859375 139.6640625C303.47265625 140.4404296875 306.6455078125 142.130859375 309.251953125 144.7373046875C316.67578125 152.1611328125 316.67578125 164.1796875 309.251953125 171.6025390625C308.1044921875 172.7509765625 306.845703125 173.7216796875 305.51171875 174.5146484375C300.603515625 177.9580078125 292.150390625 183.51953125 280.8544921875 194.814453125C253.591796875 222.078125 234.9580078125 259.9619140625 252.0751953125 277.080078125L441.580078125 466.583984375C458.9248046875 483.9287109375 497.1162109375 464.5751953125 523.9736328125 437.7177734375C548.494140625 413.197265625 570.583984375 373.546875 552.6005859375 355.5634765625L505.005859375 307.9677734375C497.5830078125 300.544921875 497.58203125 288.5263671875 505.005859375 281.1025390625C512.4287109375 273.6796875 524.4462890625 273.6796875 531.8701171875 281.1025390625L579.4658203125 328.6982421875C613.3271484375 362.5595703125 595.64453125 419.794921875 550.8486328125 464.58984375ZM349.3212890625 152.2841796875 229.453125 32.4150390625C211.4697265625 14.431640625 171.818359375 36.5224609375 147.298828125 61.0419921875C120.447265625 87.8935546875 101.083984375 126.0888671875 118.431640625 143.4365234375L168.3876953125 193.392578125C175.8115234375 200.81640625 175.8115234375 212.833984375 168.3876953125 220.2568359375C160.96484375 227.6806640625 148.9462890625 227.6806640625 141.5234375 220.2568359375L91.5673828125 170.3017578125C59.5380859375 138.2724609375 72.0380859375 82.5556640625 120.4267578125 34.16796875C165.2177734375 -10.623046875 222.4541015625 -28.3125 256.318359375 5.55078125L445.822265625 195.0556640625C479.861328125 229.09375 461.7255859375 286.458984375 417.1669921875 331.0166015625C409.212890625 338.970703125 400.603515625 346.267578125 391.61328125 352.6494140625C390.279296875 353.62109375 388.849609375 354.3974609375 387.359375 354.978515625C383.78125 356.3779296875 379.8828125 356.642578125 376.197265625 355.7978515625C372.8330078125 355.0283203125 369.6376953125 353.3330078125 367.0146484375 350.7099609375C359.591796875 343.287109375 359.591796875 331.2685546875 367.0146484375 323.845703125C367.9462890625 322.9140625 368.9501953125 322.099609375 370.0078125 321.4013671875C373.978515625 318.4189453125 380.8369140625 313.537109375 390.125 304.248046875C417.40234375 276.9716796875 436.1044921875 239.06640625 418.9580078125 221.919921875L355.255859375 158.21875C354.0869140625 157.478515625 352.98046875 156.599609375 351.9599609375 155.580078125C350.9404296875 154.5595703125 350.0615234375 153.453125 349.3212890625 152.2841796875Z"
    }
  };
  function icon(name) {
    const def = ICONS[name];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", def ? def.vb : "0 0 24 24");
    svg.setAttribute("class", "rv-icon");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = def ? '<g transform="scale(1,-1)"><path d="' + def.d + '"/></g>' : "";
    return svg;
  }

  // src/sidebar/eol.js
  function detectEol(raw) {
    if (typeof raw !== "string" || raw.indexOf("\r\n") < 0) return "\n";
    return /(^|[^\r])\n/.test(raw) || /\r(?!\n)/.test(raw) ? "\n" : "\r\n";
  }
  function normalizeEol(raw) {
    return typeof raw === "string" ? raw.replace(/\r\n?/g, "\n") : raw;
  }
  function toDiskText(editorText, eol) {
    return eol === "\r\n" ? editorText.replace(/\n/g, "\r\n") : editorText;
  }

  // src/sidebar/fingerprint.js
  var FINGERPRINT_VERSION = "v1";
  function textFingerprint(text) {
    const s = String(text);
    let h1 = 3735928559;
    let h2 = 1103547991;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
    h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
    h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
    const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
    return `${FINGERPRINT_VERSION}:${s.length}:${hex(h2)}${hex(h1)}`;
  }
  function isTextFingerprint(value) {
    return typeof value === "string" && /^v1:\d+:[0-9a-f]{16}$/.test(value);
  }

  // src/sidebar/watcher.js
  var _watchedPath = null;
  function startWatchingFile(filePath) {
    if (_watchedPath) {
      Promise.resolve(window.NativeAPI.unwatchFile(_watchedPath)).catch(() => {
      });
      _watchedPath = null;
    }
    if (!filePath) return;
    Promise.resolve(window.NativeAPI.watchFile(filePath, (eventType) => {
      if (eventType !== "modify") return;
      checkActiveFileOnDisk(filePath).catch((err) => console.warn("[Sidebar] external-change check failed:", err));
    })).catch((err) => {
      console.warn("[Sidebar] Could not watch file for external changes:", err);
      if (typeof window.showStatusWarning === "function") {
        window.showStatusWarning(
          "watch-failed",
          window.t("Changes made to this file by other programs cannot be detected right now."),
          { priority: 15, ttl: 8e3 }
        );
      }
    });
    _watchedPath = filePath;
  }
  async function checkActiveFileOnDisk(filePath) {
    if (filePath !== S.activeFilePath) return null;
    if (S._externalChangeInProgress) return null;
    let verdict;
    try {
      verdict = await _enqueueDiskOp(async () => {
        if (filePath !== S.activeFilePath) return null;
        if (S._externalChangeInProgress) return null;
        const disk = await compareDiskWithBaseline(filePath, editor.value);
        if (disk.kind === "unknown") {
          console.warn("[Sidebar] Could not verify external change content:", disk.error);
          return null;
        }
        if (disk.kind === "same" || disk.kind === "adopted") return { kind: "same" };
        if (disk.kind === "missing" || disk.kind === "unreadable") return { kind: disk.kind };
        S._externalChangeInProgress = true;
        return { kind: "changed" };
      });
    } catch (err) {
      console.warn("[Sidebar] verify lock op rejected:", err);
      return null;
    }
    if (!verdict) return null;
    if (verdict.kind === "same") {
      if (S._conflictHoldPath === filePath && (S._holdReason === "missing" || S._holdReason === "unreadable")) {
        clearAutosaveHold();
        if (S.isDirty) scheduleAutoSave();
      }
      return "same";
    }
    if (verdict.kind === "missing" || verdict.kind === "unreadable") {
      cancelPendingAutoSave();
      setAutosaveHold(filePath, verdict.kind);
      writeDurableSnapshot(filePath, editor.value, noteBackupBase());
      return verdict.kind;
    }
    cancelPendingAutoSave();
    let resolved = false;
    try {
      const dialogButtons = S.isDirty ? ["Reload from disk", "Save my version & reload", "Keep my version"] : ["Reload from disk", "Keep my version"];
      const dialogCancelId = dialogButtons.length - 1;
      const dialogDefaultId = S.isDirty ? dialogButtons.indexOf("Save my version & reload") : 0;
      const result = await window.NativeAPI.showMessageBox({
        type: "question",
        buttons: dialogButtons,
        defaultId: dialogDefaultId,
        cancelId: dialogCancelId,
        title: "File Changed Externally",
        message: `"${filePath.replace(/\\/g, "/").split("/").pop()}" was modified by another program.`,
        detail: S.isDirty ? 'You have unsaved changes. "Reload from disk" discards them. "Save my version & reload" writes your unsaved edits to a new file alongside the original, then loads the latest disk version. "Keep my version" leaves the editor untouched and pauses auto-save for this file \u2014 the disk keeps the external version until you save manually (Ctrl+S), switch files, or close (which writes your version).' : 'Do you want to reload the latest version? "Keep my version" leaves the editor as it is and pauses auto-save for this file until you save it (Ctrl+S).'
      });
      const choice = dialogButtons[result.response];
      if (choice === "Reload from disk") {
        try {
          await _enqueueDiskOp(async () => {
            const fresh = await window.NativeAPI.readFile(filePath);
            if (typeof window.replaceEditorContent === "function") {
              window.replaceEditorContent(fresh);
            } else {
              editor.value = fresh;
              if (typeof render === "function") render();
              if (typeof countWords === "function") countWords();
            }
            S._replaceGeneration++;
            markClean();
            rememberDiskContent(fresh);
            window.NativeAPI.deleteVolatileContent(filePath).catch(() => {
            });
          });
          resolved = true;
        } catch (err) {
          console.error("[Sidebar] reload after external change failed:", err);
        }
      } else if (choice === "Save my version & reload") {
        const copyContent = editor.value;
        let copyPath = null;
        let reloadErr = null;
        let copyErr = null;
        try {
          await _enqueueDiskOp(async () => {
            try {
              copyPath = await saveTextBesideNote(filePath, copyContent, "_local");
            } catch (err) {
              copyErr = err;
              throw err;
            }
            try {
              const fresh = await window.NativeAPI.readFile(filePath);
              if (typeof window.replaceEditorContent === "function") {
                window.replaceEditorContent(fresh);
              } else {
                editor.value = fresh;
                if (typeof render === "function") render();
                if (typeof countWords === "function") countWords();
              }
              S._replaceGeneration++;
              markClean();
              rememberDiskContent(fresh);
            } catch (err) {
              reloadErr = err;
              throw err;
            }
          });
        } catch (_innerErr) {
          if (copyErr) {
            console.error("[Sidebar] save-as-copy failed:", copyErr);
            window.NativeAPI.showMessageBox({
              type: "error",
              title: "Could Not Save Copy",
              message: "Your version could not be saved as a copy.",
              detail: String(copyErr) + "\n\nYour unsaved content is still in the editor; the disk version was NOT loaded. You can copy your work elsewhere or try again.",
              buttons: ["OK"]
            }).catch(() => {
            });
            return;
          }
          console.error("[Sidebar] reload after save-as-copy failed:", reloadErr);
          const copyNameP = copyPath.replace(/\\/g, "/").split("/").pop();
          window.NativeAPI.showMessageBox({
            type: "warning",
            title: "Saved Copy, Could Not Reload",
            message: `Your version was saved as "${copyNameP}", but the original could not be reloaded.`,
            detail: String(reloadErr),
            buttons: ["OK"]
          }).catch(() => {
          });
          return;
        }
        resolved = true;
        window.NativeAPI.deleteVolatileContent(filePath).catch(() => {
        });
        if (typeof renderTree === "function") {
          await renderTree();
        }
        const copyName = copyPath.replace(/\\/g, "/").split("/").pop();
        window.NativeAPI.showMessageBox({
          type: "info",
          title: "Saved as Copy",
          message: `Your version was saved as "${copyName}".`,
          detail: "The latest disk version of the original file is now loaded.",
          buttons: ["OK"]
        }).catch(() => {
        });
      }
    } finally {
      S._externalChangeInProgress = false;
      if (!resolved && S.activeFilePath === filePath) {
        setAutosaveHold(filePath, "conflict");
        writeDurableSnapshot(filePath, editor.value, noteBackupBase());
      }
    }
    return "changed";
  }
  async function stopWatchingFile() {
    const p = _watchedPath;
    _watchedPath = null;
    if (!p) return;
    try {
      await window.NativeAPI.unwatchFile(p);
    } catch (_) {
    }
  }
  function watchedPath() {
    return _watchedPath;
  }

  // src/sidebar/projects.js
  var PROJECTS_KEY = "revery_projects";
  var MAX_PROJECTS = 20;
  var _cachedProjects = null;
  function loadProjects() {
    if (_cachedProjects !== null) return _cachedProjects;
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((p) => p && typeof p.path === "string" && p.path.length > 0);
    } catch {
      return [];
    }
  }
  async function saveProjects(arr) {
    _cachedProjects = arr;
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr));
    } catch {
    }
    if (typeof window.NativeAPI.setProjectHistory === "function") {
      await window.NativeAPI.setProjectHistory(arr).catch(() => {
      });
    }
  }
  async function recordProjectOpen(folderPath) {
    if (!folderPath) return;
    const normPath = folderPath.replace(/\\/g, "/");
    const name = normPath.split("/").pop() || normPath;
    let projects = loadProjects();
    projects = projects.filter((p) => p.path.replace(/\\/g, "/") !== normPath);
    projects.unshift({ path: folderPath, name, lastOpened: Date.now() });
    if (projects.length > MAX_PROJECTS) projects = projects.slice(0, MAX_PROJECTS);
    await saveProjects(projects);
  }
  function showProjectsDropdown(anchorEl) {
    const existing = document.getElementById("revery-projects-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const projects = loadProjects();
    const menu = document.createElement("div");
    menu.id = "revery-projects-menu";
    menu.className = "revery-projects-menu";
    const hdr = document.createElement("div");
    hdr.className = "revery-projects-header";
    hdr.textContent = window.t("Recent Projects");
    menu.appendChild(hdr);
    if (projects.length === 0) {
      const empty = document.createElement("div");
      empty.className = "revery-projects-empty";
      empty.textContent = window.t("No recent projects yet");
      menu.appendChild(empty);
    } else {
      projects.forEach((proj) => {
        const normProj = proj.path.replace(/\\/g, "/");
        const normRoot = (S.rootPath || "").replace(/\\/g, "/");
        const isActive = normProj === normRoot;
        const item = document.createElement("button");
        item.className = "revery-projects-item";
        if (isActive) item.classList.add("revery-projects-active");
        item.title = proj.path;
        const nameEl = document.createElement("span");
        nameEl.className = "revery-projects-item-name";
        nameEl.textContent = proj.name + (isActive ? " \u2713" : "");
        const pathEl = document.createElement("span");
        pathEl.className = "revery-projects-item-path";
        pathEl.textContent = normProj;
        item.append(nameEl, pathEl);
        item.addEventListener("click", async () => {
          menu.remove();
          if (isActive) return;
          await switchProject(proj.path);
        });
        menu.appendChild(item);
      });
    }
    const sep = document.createElement("div");
    sep.className = "revery-projects-sep";
    menu.appendChild(sep);
    const browseBtn = document.createElement("button");
    browseBtn.className = "revery-projects-action";
    browseBtn.replaceChildren(icon("folder-open"), "  " + window.t("Browse for folder\u2026"));
    browseBtn.addEventListener("click", () => {
      menu.remove();
      promptOpenFolder();
    });
    menu.appendChild(browseBtn);
    const manageBtn = document.createElement("button");
    manageBtn.className = "revery-projects-action";
    manageBtn.replaceChildren(icon("sliders"), "  " + window.t("Manage projects\u2026"));
    manageBtn.addEventListener("click", () => {
      menu.remove();
      showManageProjectsModal();
    });
    menu.appendChild(manageBtn);
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const menuW = 300;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = rect.bottom + 4 + "px";
    setTimeout(() => {
      document.addEventListener("click", function closeProjects(e) {
        if (!menu.contains(e.target) && e.target !== anchorEl) {
          menu.remove();
          document.removeEventListener("click", closeProjects);
        }
      });
    }, 0);
  }
  function showManageProjectsModal() {
    if (document.getElementById("revery-manage-projects-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "revery-input-overlay";
    overlay.id = "revery-manage-projects-overlay";
    const box = document.createElement("div");
    box.className = "revery-input-box";
    box.style.cssText = "gap: 0; min-width: 360px; max-width: 520px; width: 90%;";
    const titleEl = document.createElement("p");
    titleEl.style.cssText = "font-weight: 400; font-size: 1rem; margin: 0 0 6px; padding-bottom: 10px; border-bottom: 1px solid var(--border, #444);";
    titleEl.textContent = window.t("Manage Projects");
    box.appendChild(titleEl);
    const hintEl = document.createElement("p");
    hintEl.style.cssText = "font-size: 0.8rem; opacity: 0.6; margin: 8px 0 12px;";
    hintEl.textContent = window.t("Remove folders from the quick-switch list. No files are deleted.");
    box.appendChild(hintEl);
    const listEl = document.createElement("div");
    listEl.style.cssText = "overflow-y: auto; max-height: 55vh; display: flex; flex-direction: column; scrollbar-width: thin;";
    box.appendChild(listEl);
    function rebuildList() {
      listEl.innerHTML = "";
      const projects = loadProjects();
      if (projects.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 20px 0; text-align: center; opacity: 0.5; font-size: 0.85rem;";
        empty.textContent = window.t("No projects in list");
        listEl.appendChild(empty);
        return;
      }
      projects.forEach((proj, idx) => {
        const normProj = proj.path.replace(/\\/g, "/");
        const normRoot = (S.rootPath || "").replace(/\\/g, "/");
        const isActive = normProj === normRoot;
        const row = document.createElement("div");
        row.className = "revery-manage-row";
        const textWrap = document.createElement("div");
        textWrap.className = "revery-manage-text";
        const nameEl = document.createElement("div");
        nameEl.className = "revery-manage-name";
        nameEl.textContent = proj.name + (isActive ? " (current)" : "");
        if (isActive) nameEl.style.color = "var(--accent, #7a8ee0)";
        const pathEl = document.createElement("div");
        pathEl.className = "revery-manage-path";
        pathEl.textContent = normProj;
        pathEl.title = proj.path;
        textWrap.append(nameEl, pathEl);
        const removeBtn = document.createElement("button");
        removeBtn.className = "revery-input-cancel";
        removeBtn.style.cssText = "padding: 3px 10px; font-size: 0.78rem; flex-shrink: 0; cursor: pointer;";
        removeBtn.textContent = window.t("Remove");
        removeBtn.title = window.t("Remove from list (does not delete files)");
        removeBtn.addEventListener("click", () => {
          const current = loadProjects();
          const updated = current.filter(
            (p) => p.path.replace(/\\/g, "/") !== normProj
          );
          saveProjects(updated);
          rebuildList();
        });
        row.append(textWrap, removeBtn);
        listEl.appendChild(row);
      });
    }
    rebuildList();
    const btnRow = document.createElement("div");
    btnRow.className = "revery-input-buttons";
    btnRow.style.marginTop = "14px";
    const doneBtn = document.createElement("button");
    doneBtn.className = "revery-input-ok";
    doneBtn.textContent = window.t("Done");
    doneBtn.addEventListener("click", () => overlay.remove());
    btnRow.appendChild(doneBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }
  function seedProjectsCache(arr) {
    _cachedProjects = arr;
  }
  function initProjects() {
    if (btnProjectsBtn) {
      btnProjectsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showProjectsDropdown(btnProjectsBtn);
      });
    }
  }

  // src/sidebar/save.js
  var _autoSaveTimer = null;
  function autosaveDelayMs() {
    return window.slowHardwareMode ? 4e3 : 1500;
  }
  function autosaveMaxWaitMs() {
    return window.slowHardwareMode ? 2e4 : 1e4;
  }
  var AUTOSAVE_FAILURE_COOLDOWN_MS = 3e4;
  function cancelPendingAutoSave() {
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  var _diskOpsChain = Promise.resolve();
  function _enqueueDiskOp(op) {
    const next = _diskOpsChain.then(() => op(), () => op());
    _diskOpsChain = next.then(() => {
    }, () => {
    });
    return next;
  }
  var _goneActivePaths = /* @__PURE__ */ new Set();
  function markActivePathGone(p) {
    if (p) _goneActivePaths.add(pathKey(p));
  }
  function forgetGonePath(p) {
    if (p) _goneActivePaths.delete(pathKey(p));
  }
  var _firstDirtyTime = 0;
  var _autoSaveCooldownUntil = 0;
  var _scratchpadFailureWarned = false;
  var _scratch = null;
  var SCRATCHPAD_RETRY_MS = 5e3;
  function currentDocGeneration() {
    return typeof window.getEditorDocGeneration === "function" ? window.getEditorDocGeneration() : 0;
  }
  function scratchpadSession() {
    const gen = currentDocGeneration();
    if (_scratch && _scratch.gen === gen) return _scratch;
    if (S._scratchpadVolatileKey && _scratch && _scratch.key === S._scratchpadVolatileKey) {
      S._scratchpadVolatileKey = null;
    }
    _scratch = {
      gen,
      key: ensureScratchpadVolatileKey(),
      latest: "",
      creating: false,
      promise: null,
      retryAfter: 0,
      failed: false,
      lastError: "",
      quiet: false
    };
    return _scratch;
  }
  function releaseScratchSession(session) {
    if (_scratch === session) _scratch = null;
    if (S._scratchpadVolatileKey === session.key) S._scratchpadVolatileKey = null;
  }
  function pendingScratchpad() {
    if (S.activeFilePath || window._showingUnsupportedFile) return null;
    const s = _scratch;
    if (!s || s.gen !== currentDocGeneration()) return null;
    return editor.value.trim() ? s : null;
  }
  function scratchpadCreateFailed(session, err, emptyFileToRemove) {
    console.error("[Sidebar] scratchpad auto-create failed:", err);
    session.creating = false;
    session.retryAfter = Date.now() + SCRATCHPAD_RETRY_MS;
    session.failed = true;
    session.lastError = String(err);
    writeDurableSnapshot(
      session.key,
      currentDocGeneration() === session.gen ? editor.value : session.latest
    );
    if (emptyFileToRemove) window.NativeAPI.deleteNode(emptyFileToRemove).catch(() => {
    });
    if (!session.quiet && !_scratchpadFailureWarned) {
      _scratchpadFailureWarned = true;
      window.NativeAPI.showMessageBox({
        type: "warning",
        title: window.t("Could Not Create File"),
        message: window.t("A file could not be created to save your work."),
        detail: String(err) + "\n\nYour typed content is still visible but has not been saved to disk. The app will retry automatically when you keep typing.",
        buttons: ["OK"],
        defaultId: 0
      }).catch(() => {
      });
    }
  }
  function createNoteFromScratchpad(session, targetDir, baseName) {
    session.creating = true;
    const attached = () => currentDocGeneration() === session.gen && !S.activeFilePath && !window._showingUnsupportedFile;
    session.promise = (async () => {
      let newPath = null;
      try {
        newPath = await uniquePath(targetDir, baseName, "md");
        await window.NativeAPI.createFile(newPath);
      } catch (err) {
        scratchpadCreateFailed(session, err, null);
        return;
      }
      let written;
      let wroteOnce = false;
      try {
        written = attached() ? editor.value : session.latest;
        await window.NativeAPI.writeFile(newPath, written);
        wroteOnce = true;
        if (!attached() && session.latest !== written) {
          written = session.latest;
          await window.NativeAPI.writeFile(newPath, written);
        }
      } catch (err) {
        scratchpadCreateFailed(session, err, wroteOnce ? null : newPath);
        return;
      }
      session.creating = false;
      _scratchpadFailureWarned = false;
      if (!attached()) {
        releaseScratchSession(session);
        window.NativeAPI.deleteVolatileContent(session.key).catch(() => {
        });
        expandedDirs.add(targetDir);
        await renderTree();
        if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
        if (typeof window.showStatusWarning === "function") {
          window.showStatusWarning(
            "scratchpad-detached",
            window.t('Your text was saved as "{name}".').replace("{name}", baseNameOf(newPath)),
            { priority: 30, ttl: 6e3 }
          );
        }
        return;
      }
      S.activeFilePath = newPath;
      forgetGonePath(newPath);
      S.previewMediaPath = null;
      rememberDiskContent(written);
      releaseScratchSession(session);
      let placeholderStillNeeded = false;
      if (editor.value !== written) {
        markDirty();
        scheduleAutoSave();
        try {
          await window.NativeAPI.writeVolatileNow(newPath, editor.value, noteBackupBase());
        } catch (e) {
          console.warn("[Sidebar] note backup after scratchpad create failed (placeholder kept):", e);
          placeholderStillNeeded = true;
        }
      }
      if (!placeholderStillNeeded) {
        window.NativeAPI.deleteVolatileContent(session.key).catch(() => {
        });
      }
      try {
        await window.NativeAPI.setLastOpenedFile(newPath);
      } catch (e) {
        console.warn("[Sidebar] could not persist last-opened pointer (non-fatal):", e);
      }
      if (docTitleEl && S.activeFilePath === newPath) {
        docTitleEl.value = newPath.replace(/\\/g, "/").split("/").pop().replace(/\.(md|txt)$/, "");
      }
      if (S.activeFilePath === newPath) startWatchingFile(newPath);
      expandedDirs.add(targetDir);
      await renderTree();
      if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
    })().catch((err) => {
      console.error("[Sidebar] scratchpad create flow failed unexpectedly:", err);
      session.creating = false;
    });
    return session.promise;
  }
  function startScratchpadCreate(session) {
    const targetDir = pendingNoteDir();
    if (!targetDir) return null;
    let baseName = S.previewMediaPath ? baseNameOf(S.previewMediaPath).replace(/\.[^/.]+$/, "") : "untitled";
    if (checkEntryName(baseName) || checkEntryName(baseName + ".md")) baseName = "untitled";
    return createNoteFromScratchpad(session, targetDir, baseName);
  }
  async function scratchpadToNote(session) {
    session.quiet = true;
    try {
      const creating = session.creating ? session.promise : startScratchpadCreate(session);
      if (creating) await creating;
    } finally {
      session.quiet = false;
    }
    return pendingScratchpad() !== session;
  }
  function tellScratchpadNotSaved(session) {
    return window.NativeAPI.showMessageBox({
      type: "warning",
      title: window.t("Could Not Create File"),
      message: window.t("Your text could not be saved to a file, so it stays open."),
      detail: (session.lastError ? session.lastError + "\n\n" : "") + window.t('Use "Save as..." in the File menu to save it somewhere else. Until then a backup is kept, and Revery offers it again at the next start.'),
      buttons: ["OK"],
      defaultId: 0
    }).catch(() => {
    });
  }
  function resumeScratchpadAfterSwitch() {
    const s = pendingScratchpad();
    if (s && !s.creating) startScratchpadCreate(s);
  }
  var DURABLE_MIRROR_MS = 5e3;
  var _durableMirrorLast = 0;
  var _durableMirrorTimer = null;
  function _durableExposed() {
    return !!S.activeFilePath && (S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath || Date.now() < _autoSaveCooldownUntil);
  }
  function writeDurableSnapshot(path, content, base = null) {
    if (typeof window.NativeAPI.setDurableBackup !== "function") return;
    _durableMirrorLast = Date.now();
    window.NativeAPI.setDurableBackup(path, content, base).catch((e) => console.warn("[Sidebar] durable backup failed (non-fatal):", e));
  }
  function _durableMirrorKey() {
    if (S.activeFilePath) return _durableExposed() && S.isDirty ? S.activeFilePath : null;
    const s = pendingScratchpad();
    return s && (s.failed || !pendingNoteDir()) ? s.key : null;
  }
  function hasTextWithoutProject() {
    return !S.rootPath && !!pendingScratchpad();
  }
  function _fireDurableMirror() {
    const key = _durableMirrorKey();
    if (key) writeDurableSnapshot(key, editor.value, key === S.activeFilePath ? noteBackupBase() : null);
  }
  function mirrorDurableWhileExposed() {
    if (!_durableMirrorKey()) return;
    clearTimeout(_durableMirrorTimer);
    const since = Date.now() - _durableMirrorLast;
    if (since >= DURABLE_MIRROR_MS) {
      _fireDurableMirror();
    } else {
      _durableMirrorTimer = setTimeout(_fireDurableMirror, DURABLE_MIRROR_MS - since);
    }
  }
  function rememberDiskContent(raw) {
    _baselineFp = void 0;
    if (typeof raw !== "string") {
      S._diskBaseline = null;
      S._diskEol = "\n";
      return;
    }
    const api = window.NativeAPI;
    S._diskBaseline = api && typeof api.wellFormedText === "function" ? api.wellFormedText(raw) : raw;
    S._diskEol = detectEol(raw);
  }
  var _baselineFp;
  function noteBackupBase() {
    if (typeof S._diskBaseline !== "string") return null;
    if (_baselineFp === void 0) _baselineFp = textFingerprint(S._diskBaseline);
    return _baselineFp;
  }
  function diskFingerprint(raw) {
    const api = window.NativeAPI;
    return textFingerprint(api && typeof api.wellFormedText === "function" ? api.wellFormedText(raw) : raw);
  }
  async function compareDiskWithBaseline(filePath, bufferText) {
    let content;
    try {
      content = await window.NativeAPI.readFile(filePath);
    } catch (err) {
      const exists = await fileExistsViaListing(filePath);
      if (exists === false) return { kind: "missing" };
      if (exists === true && /not valid UTF-8/.test(String(err))) return { kind: "unreadable" };
      return { kind: "unknown", error: err };
    }
    if (S._diskBaseline !== null && content === S._diskBaseline) return { kind: "same" };
    const api = window.NativeAPI;
    const wellFormed = (s) => api && typeof api.wellFormedText === "function" ? api.wellFormedText(s) : s;
    if (typeof bufferText === "string" && normalizeEol(content) === wellFormed(bufferText)) {
      rememberDiskContent(content);
      return { kind: "adopted" };
    }
    return { kind: "changed" };
  }
  var HOLD_STATUS = "autosave-hold";
  function setAutosaveHold(path, reason) {
    S._conflictHoldPath = path;
    S._holdReason = reason || "conflict";
    if (typeof window.showStatusWarning !== "function") return;
    const msg = S._holdReason === "missing" ? window.t('"{name}" was deleted or moved by another program. Auto-save is paused so it is not recreated. Press Ctrl+S to save it again, or use Save As.') : S._holdReason === "unreadable" ? window.t('"{name}" was changed by another program to a format Revery cannot read. Auto-save is paused. Ctrl+S overwrites it with your version.') : window.t('Auto-save is paused for "{name}" (you kept your version). Press Ctrl+S to save it.');
    window.showStatusWarning(HOLD_STATUS, msg.replace("{name}", baseNameOf(path)), { priority: 70 });
  }
  function clearAutosaveHold() {
    S._conflictHoldPath = null;
    S._holdReason = null;
    if (typeof window.clearStatusWarning === "function") window.clearStatusWarning(HOLD_STATUS);
  }
  function markDirty() {
    if (S.isDirty) return;
    S.isDirty = true;
    document.title = "Revery Notebook \u2022";
    if (docTitleEl) docTitleEl.classList.add("doc-title-dirty");
  }
  function markClean() {
    S.isDirty = false;
    _firstDirtyTime = 0;
    document.title = "Revery Notebook";
    if (docTitleEl) docTitleEl.classList.remove("doc-title-dirty");
    window._sidebarUnsaved = false;
    clearAutosaveHold();
  }
  var _renamePromise = null;
  async function waitForTitleRename() {
    for (let i = 0; i < 10 && _renamePromise; i++) {
      try {
        await _renamePromise;
      } catch (_) {
      }
    }
  }
  async function renameActiveFileFromTitle() {
    if (S._operationLock) return;
    if (!S.activeFilePath || window._showingUnsupportedFile) return;
    const rawName = docTitleEl.value.trim();
    const parts = S.activeFilePath.replace(/\\/g, "/").split("/");
    const oldFullName = parts.pop();
    const oldDir = parts.join("/");
    const lastDot = oldFullName.lastIndexOf(".");
    const ext = lastDot > 0 ? oldFullName.substring(lastDot + 1) : "md";
    const oldBaseName = lastDot > 0 ? oldFullName.substring(0, lastDot) : oldFullName;
    if (!rawName) {
      docTitleEl.value = oldBaseName;
      return;
    }
    const safeName = sanitizeEntryName(rawName);
    if (safeName === oldBaseName) {
      docTitleEl.value = safeName;
      return;
    }
    if (_renamePromise) return _renamePromise;
    const problem = checkEntryName(safeName) || checkEntryName(`${safeName}.${ext}`);
    if (problem) {
      docTitleEl.value = oldBaseName;
      await showNameProblem(problem, safeName);
      return;
    }
    const execRename = async () => {
      S._operationLock = true;
      try {
        const oldPath = S.activeFilePath;
        const finalNewPath = await uniquePath(oldDir, safeName, ext, oldFullName);
        if (!samePath(S.activeFilePath, oldPath)) return;
        await window.NativeAPI.writeVolatileNow(finalNewPath, editor.value, noteBackupBase()).catch(
          (e) => console.warn("[Sidebar] Pre-rename volatile migration failed (non-fatal):", e)
        );
        const journalEntry = { from: oldPath, to: finalNewPath, ts: Date.now() };
        if (typeof window.NativeAPI.setPendingRename === "function") {
          await window.NativeAPI.setPendingRename(journalEntry).catch(
            (e) => console.warn("[Sidebar] Rename journal write failed (non-fatal):", e)
          );
        }
        let followed = false;
        await _enqueueDiskOp(async () => {
          await stopWatchingFile();
          try {
            await window.NativeAPI.renameNode(oldPath, finalNewPath);
            followed = await retargetActiveFile(oldPath, finalNewPath);
          } finally {
            if (!followed && S.activeFilePath) startWatchingFile(S.activeFilePath);
          }
        });
        pushUndo({ type: "rename", records: [{ oldPath, newPath: finalNewPath }], links: "none" });
        if (followed) {
          docTitleEl.value = finalNewPath.replace(/\\/g, "/").split("/").pop().replace(new RegExp(`\\.${ext}$`), "");
        }
        if (typeof window.NativeAPI.setPendingRename === "function") {
          window.NativeAPI.setPendingRename(null).catch(
            (e) => console.warn("[Sidebar] Rename journal clear failed (non-fatal):", e)
          );
        }
        window.NativeAPI.deleteVolatileContent(oldPath).catch(() => {
        });
        await renderTree();
      } catch (err) {
        console.error("[Sidebar] Inline rename failed:", err);
        docTitleEl.value = oldBaseName;
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Rename Failed"),
          message: window.t('Could not rename file to "{name}".').replace("{name}", safeName),
          detail: String(err)
        });
      } finally {
        S._operationLock = false;
        _renamePromise = null;
      }
    };
    _renamePromise = execRename();
    return _renamePromise;
  }
  var _saveChain = Promise.resolve();
  async function saveActiveFile(opts) {
    const auto = !!(opts && opts.auto);
    const report = opts && typeof opts.onOutcome === "function" ? opts.onOutcome : () => {
    };
    if (!S.activeFilePath) {
      report("no-file");
      return false;
    }
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
    const contentToSave = editor.value;
    const enqueueGen = S._replaceGeneration;
    const docGen = currentDocGeneration();
    const savePromise = _saveChain = _saveChain.then(async () => {
      if (typeof _renamePromise !== "undefined" && _renamePromise) {
        await _renamePromise;
      }
      if (!S.activeFilePath) {
        report("no-file");
        return false;
      }
      const typingTitle = auto && docTitleEl && document.activeElement === docTitleEl;
      if (docTitleEl && !typingTitle) {
        const currentBase = S.activeFilePath.replace(/\\/g, "/").split("/").pop().replace(/\.[^/.]+$/, "");
        const inputName = docTitleEl.value.trim();
        if (inputName && inputName !== currentBase && !window._showingUnsupportedFile) {
          await renameActiveFileFromTitle();
          if (!S.activeFilePath) {
            report("no-file");
            return false;
          }
        }
      }
      const pathToSave = S.activeFilePath;
      let writeResult;
      let savedOpenNote = false;
      try {
        writeResult = await _enqueueDiskOp(async () => {
          if (S._externalChangeInProgress) return "deferred-external";
          if (enqueueGen !== S._replaceGeneration) return "deferred-replaced";
          const held = !!S._conflictHoldPath && S._conflictHoldPath === pathToSave;
          if (auto && held) return "deferred-hold";
          const isActive = S.activeFilePath === pathToSave;
          if (isActive && docGen !== currentDocGeneration()) return "deferred-replaced";
          if (!isActive && _goneActivePaths.has(pathKey(pathToSave))) return "deferred-gone";
          if (isActive && !held && S._diskBaseline !== null) {
            const disk = await compareDiskWithBaseline(pathToSave, contentToSave);
            if (disk.kind === "changed" || disk.kind === "unreadable" || disk.kind === "missing" && auto) {
              return "deferred-verify";
            }
            if (disk.kind === "adopted") {
              savedOpenNote = true;
              return "ok";
            }
          }
          const diskText = toDiskText(contentToSave, isActive ? S._diskEol : "\n");
          await window.NativeAPI.writeFile(pathToSave, diskText);
          if (isActive) rememberDiskContent(diskText);
          savedOpenNote = isActive;
          return "ok";
        });
      } catch (err) {
        console.error("[Sidebar] saveActiveFile failed:", err);
        _autoSaveCooldownUntil = Date.now() + AUTOSAVE_FAILURE_COOLDOWN_MS;
        writeDurableSnapshot(
          pathToSave,
          contentToSave,
          pathToSave === S.activeFilePath ? noteBackupBase() : null
        );
        _firstDirtyTime = 0;
        report("error");
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Save Failed"),
          message: window.t("Could not write to:") + "\n" + pathToSave,
          detail: String(err)
        });
        return false;
      }
      if (writeResult !== "ok") {
        report(writeResult);
        if (writeResult === "deferred-gone" && S.activeFilePath && S.isDirty) scheduleAutoSave();
        if (writeResult === "deferred-verify") {
          checkActiveFileOnDisk(pathToSave).then((kind) => {
            if (kind === "same" && S.activeFilePath === pathToSave && S.isDirty) scheduleAutoSave();
          }).catch((e) => console.warn("[Sidebar] disk check after a stopped save failed:", e));
        }
        return false;
      }
      _autoSaveCooldownUntil = 0;
      if (S._conflictHoldPath === pathToSave) clearAutosaveHold();
      if (savedOpenNote && S.activeFilePath === pathToSave && docGen === currentDocGeneration()) {
        if (editor.value === contentToSave) {
          markClean();
          if (typeof showSavedIndicator === "function") showSavedIndicator();
          window.NativeAPI.deleteVolatileContent(pathToSave).catch(() => {
          });
        } else {
          window.NativeAPI.writeVolatileNow(pathToSave, editor.value, noteBackupBase()).catch(
            (err) => console.warn("[Sidebar] post-save volatile refresh failed:", err)
          );
          scheduleAutoSave();
        }
      }
      if (S.sidebarViewMode === "card") {
        const chunk = contentToSave.substring(0, 5e3);
        const previewText = stripMarkdownForPreview(chunk).substring(0, 440);
        _previewCache.set(pathToSave, previewText);
        const card = treeEl.querySelector(`.sidebar-card[data-path="${CSS.escape(pathToSave)}"]`);
        if (card) {
          const previewEl = card.querySelector(".sidebar-card-preview");
          if (previewEl) previewEl.textContent = previewText;
        }
      }
      report("ok");
      return true;
    }).catch((err) => {
      console.error("[Sidebar] Uncaught error in save chain \u2013 recovering:", err);
      report("error");
      return false;
    });
    return savePromise;
  }
  function waitForSaveChainIdle() {
    return _saveChain.then(() => {
    }, () => {
    });
  }
  var SWITCH_CANCELLED = Symbol("switch-cancelled");
  var SWITCH_ATTEMPTS = 5;
  var unsavedNote = () => S.isDirty && !!S.activeFilePath;
  var hasUnsavedWork = () => unsavedNote() || keptVersionOnScreen() || !!pendingScratchpad();
  function keptVersionOnScreen() {
    return !!S.activeFilePath && !S.isDirty && !window._showingUnsupportedFile && S._holdReason === "conflict" && S._conflictHoldPath === S.activeFilePath;
  }
  async function saveKeptVersionCopy() {
    const path = S.activeFilePath;
    const text = editor.value;
    const disk = await compareDiskWithBaseline(path, text);
    if (!keptVersionOnScreen() || S.activeFilePath !== path) return true;
    if (disk.kind === "same" || disk.kind === "adopted") {
      clearAutosaveHold();
      window.NativeAPI.deleteVolatileContent(path).catch(() => {
      });
      return true;
    }
    let copyPath;
    try {
      copyPath = await saveTextBesideNote(path, text, "_local");
    } catch (err) {
      console.error("[Sidebar] saving the kept version as a copy failed:", err);
      await window.NativeAPI.showMessageBox({
        type: "error",
        title: window.t("Could Not Save Copy"),
        message: window.t('The version of "{name}" you kept could not be saved as a copy, so the note stays open.').replace("{name}", baseNameOf(path)),
        detail: String(err) + "\n\n" + window.t('Press Ctrl+S to save it over the file, or use "Save as..." in the File menu.'),
        buttons: ["OK"]
      }).catch(() => {
      });
      return false;
    }
    if (S.activeFilePath === path && !S.isDirty) {
      clearAutosaveHold();
      window.NativeAPI.deleteVolatileContent(path).catch(() => {
      });
    }
    expandedDirs.add(parentPathOf(copyPath));
    try {
      await renderTree();
    } catch (_) {
    }
    if (typeof window.showStatusWarning === "function") {
      window.showStatusWarning(
        "kept-version-copy",
        window.t('The version of "{name}" you kept was saved as "{copy}".').replace("{name}", baseNameOf(path)).replace("{copy}", baseNameOf(copyPath)),
        { priority: 30, ttl: 8e3 }
      );
    }
    return true;
  }
  async function saveOpenDocument() {
    if (unsavedNote()) return saveActiveFile();
    if (keptVersionOnScreen()) return saveKeptVersionCopy();
    const pending = pendingScratchpad();
    if (!pending || await scratchpadToNote(pending)) return true;
    await tellScratchpadNotSaved(pending);
    return false;
  }
  async function saveBeforeLeaving() {
    await waitForTitleRename();
    return saveOpenDocument();
  }
  async function replaceOpenDocument(prepare, apply) {
    if (S._projectSwitch) {
      if (typeof window.showStatusWarning === "function") {
        window.showStatusWarning("fs-busy", window.t("Busy \u2014 try again in a moment."), { priority: 5, ttl: 2500 });
      }
      return false;
    }
    await waitForTitleRename();
    for (let attempt = 0; attempt < SWITCH_ATTEMPTS; attempt++) {
      if (!await saveOpenDocument()) return false;
      const prepared = prepare ? await prepare() : void 0;
      if (prepared === SWITCH_CANCELLED) return false;
      if (hasUnsavedWork()) continue;
      apply(prepared);
      return true;
    }
    if (typeof window.showStatusWarning === "function") {
      window.showStatusWarning(
        "switch-busy",
        window.t("The open note is still being changed. Try again in a moment."),
        { priority: 20, ttl: 4e3 }
      );
    }
    return false;
  }
  async function retargetActiveFile(oldPath, newPath) {
    if (!oldPath || !newPath) return false;
    markActivePathGone(oldPath);
    if (!samePath(S.activeFilePath, oldPath)) return false;
    S.activeFilePath = newPath;
    forgetGonePath(newPath);
    if (S._conflictHoldPath === oldPath) setAutosaveHold(newPath, S._holdReason);
    if (docTitleEl) docTitleEl.value = baseNameOf(newPath).replace(/\.(md|txt)$/, "");
    startWatchingFile(newPath);
    if (S.isDirty || keptVersionOnScreen()) {
      try {
        await window.NativeAPI.writeVolatileNow(newPath, editor.value, noteBackupBase());
        if (_durableExposed()) writeDurableSnapshot(newPath, editor.value, noteBackupBase());
        await window.NativeAPI.deleteVolatileContent(oldPath);
      } catch (e) {
        console.warn("[Sidebar] could not move the crash backup to the new path (old one kept):", e);
      }
    }
    try {
      await window.NativeAPI.setLastOpenedFile(newPath);
    } catch (e) {
      console.warn("[Sidebar] could not persist last-opened pointer (non-fatal):", e);
    }
    return true;
  }
  function scheduleAutoSave() {
    if (!S.activeFilePath) return;
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
    if (S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath) {
      return;
    }
    if (Date.now() < _autoSaveCooldownUntil) {
      return;
    }
    if (_firstDirtyTime === 0) _firstDirtyTime = Date.now();
    if (Date.now() - _firstDirtyTime >= autosaveMaxWaitMs()) {
      _firstDirtyTime = Date.now();
      saveActiveFile({ auto: true });
      return;
    }
    _autoSaveTimer = setTimeout(() => {
      _autoSaveTimer = null;
      saveActiveFile({ auto: true });
    }, autosaveDelayMs());
  }
  function flushPendingAutoSave() {
    if (!_autoSaveTimer) return Promise.resolve(false);
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = null;
    return saveActiveFile({ auto: true });
  }
  function flushPendingWork() {
    const api = window.NativeAPI;
    const backup = api && typeof api.flushVolatileBackup === "function" ? api.flushVolatileBackup() : Promise.resolve();
    return Promise.all([backup, flushPendingAutoSave()]).catch((e) => console.warn("[Sidebar] flush failed:", e));
  }
  function initSaveEngine() {
    if (docTitleEl) {
      docTitleEl.addEventListener("change", renameActiveFileFromTitle);
      docTitleEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          docTitleEl.blur();
          editor.focus();
        }
      });
    }
    window.addEventListener("blur", () => {
      flushPendingWork();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPendingWork();
    });
    if (window.NativeAPI && typeof window.NativeAPI.onFlushRequest === "function") {
      window.NativeAPI.onFlushRequest(() => {
        flushPendingWork();
      });
    }
    window.sidebarSaveActiveFile = saveActiveFile;
    window.sidebarGetActiveFilePath = () => S.activeFilePath;
    window.sidebarGetRootPath = () => S.rootPath;
    window.sidebarIsDirty = () => S.isDirty;
    window.sidebarUnsavedState = () => ({
      path: S.activeFilePath,
      dirty: S.isDirty,
      held: !!S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath
    });
    window.sidebarPivotToNewFile = async function(newPath, newRoot, savedContent) {
      await waitForTitleRename();
      if (newRoot && newRoot !== S.rootPath) {
        try {
          const c = await window.NativeAPI.setRootPath(newRoot);
          if (typeof c === "string" && c) newRoot = c;
        } catch (e) {
          console.warn("[Sidebar] Save As: could not resolve the new root (kept as given):", e);
        }
      }
      try {
        const c = await window.NativeAPI.canonicalEntryPath(newPath);
        if (typeof c === "string" && c) newPath = c;
      } catch (_) {
      }
      const scratch = _scratch && _scratch.gen === currentDocGeneration() && !_scratch.creating && !S.activeFilePath ? _scratch : null;
      if (scratch) releaseScratchSession(scratch);
      S.activeFilePath = newPath;
      forgetGonePath(newPath);
      if (typeof savedContent === "string" && editor.value !== savedContent) {
        markDirty();
        scheduleAutoSave();
      } else {
        markClean();
      }
      rememberDiskContent(typeof savedContent === "string" ? savedContent : null);
      if (scratch) {
        (S.isDirty ? window.NativeAPI.writeVolatileNow(newPath, editor.value, noteBackupBase()) : Promise.resolve()).then(() => window.NativeAPI.deleteVolatileContent(scratch.key)).catch((e) => console.warn("[Sidebar] Save As: scratchpad backup kept:", e));
      }
      await window.NativeAPI.setLastOpenedFile(newPath).catch((e) => console.warn("[Sidebar] could not persist last-opened pointer (non-fatal):", e));
      if (newRoot && newRoot !== S.rootPath) {
        S.rootPath = newRoot;
        clearUndoStack();
        try {
          localStorage.setItem("revery_root_path", S.rootPath);
        } catch (_) {
        }
        if (typeof window.NativeAPI.setLastRootPath === "function") {
          window.NativeAPI.setLastRootPath(S.rootPath).catch(() => {
          });
        }
        const parts = newRoot.replace(/\\/g, "/").split("/");
        if (folderNameEl) folderNameEl.textContent = parts[parts.length - 1] || newRoot;
        S.selectedDirPath = newRoot;
        S.cardViewDir = newRoot;
        expandedDirs.clear();
        expandedDirs.add(newRoot);
        if (typeof recordProjectOpen === "function") {
          await recordProjectOpen(newRoot);
        }
      }
      if (docTitleEl) {
        const base = newPath.replace(/\\/g, "/").split("/").pop();
        docTitleEl.value = base.replace(/\.(md|txt)$/, "");
      }
      startWatchingFile(newPath);
      const dir = newPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      if (dir) expandedDirs.add(dir);
      await renderTree();
      highlightActiveFile(newPath);
    };
    editor.addEventListener("input", () => {
      if (!S.activeFilePath && !window._showingUnsupportedFile) {
        const targetDir = pendingNoteDir();
        if (targetDir) {
          const session2 = scratchpadSession();
          session2.latest = editor.value;
          try {
            window.NativeAPI.setVolatileContent(session2.key, editor.value);
          } catch (e) {
            console.warn("[Sidebar] scratchpad placeholder volatile failed (non-fatal):", e);
          }
          mirrorDurableWhileExposed();
          if (!S._projectSwitch && !session2.creating && Date.now() >= session2.retryAfter) {
            startScratchpadCreate(session2);
          }
          return;
        }
        const session = scratchpadSession();
        session.latest = editor.value;
        try {
          window.NativeAPI.setVolatileContent(session.key, editor.value);
        } catch (e) {
          console.warn("[Sidebar] no-project backup failed (non-fatal):", e);
        }
        mirrorDurableWhileExposed();
        return;
      }
      if (S.activeFilePath) {
        markDirty();
        scheduleAutoSave();
        window.NativeAPI.setVolatileContent(S.activeFilePath, editor.value, noteBackupBase());
        mirrorDurableWhileExposed();
      }
    });
    document.addEventListener("keydown", async (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        if (!S.activeFilePath) return;
        e.preventDefault();
        if (document.activeElement === docTitleEl) {
          docTitleEl.blur();
        }
        await saveActiveFile();
      }
      const key = String(e.key || "").toLowerCase();
      const fileUndo = e.ctrlKey && !e.altKey && !e.shiftKey && key === "z";
      const fileRedo = e.ctrlKey && !e.altKey && (key === "y" && !e.shiftKey || key === "z" && e.shiftKey);
      if (fileUndo || fileRedo) {
        if (!sidebarUndoAllowed(e)) return;
        if (!(fileUndo ? hasUndoOperations() : hasRedoOperations())) return;
        e.preventDefault();
        await (fileUndo ? undoLastOperation() : redoLastOperation());
      }
    });
    const isPanelSurface = (el) => !!(el && el.closest && (sidebarPanel && sidebarPanel.contains(el) || el.closest("#context-menu, #sidebar-sort-menu, .revery-input-overlay")));
    document.addEventListener("pointerdown", (e) => {
      _panelArmed = isPanelSurface(e.target);
    }, true);
    document.addEventListener("dragstart", (e) => {
      if (isPanelSurface(e.target)) _panelArmed = true;
    }, true);
    document.addEventListener("focusin", (e) => {
      if (!isPanelSurface(e.target)) _panelArmed = false;
    }, true);
  }
  var _panelArmed = false;
  function sidebarUndoAllowed(e) {
    if (window.cmView && window.cmView.hasFocus) return false;
    const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
    const t = e.target;
    if (t && t.closest && t.closest(editable)) return false;
    const a = document.activeElement;
    if (a && a !== document.body && a.closest && a.closest(editable)) return false;
    if (document.querySelector(".revery-input-overlay")) return false;
    if (!S.sidebarOpen) return false;
    return _panelArmed;
  }

  // src/sidebar/panel.js
  function openSidebar() {
    S.sidebarOpen = true;
    sidebarPanel.style.display = "flex";
    sidebarDivider.style.display = "block";
    if (window.savedSidebarWidth) {
      sidebarPanel.style.width = window.savedSidebarWidth;
    }
    if (btnSidebar) {
      btnSidebar.classList.add("active");
      btnSidebar.title = window.t("Close project folder");
    }
  }
  function closeSidebar() {
    S.sidebarOpen = false;
    sidebarPanel.style.display = "none";
    sidebarDivider.style.display = "none";
    if (btnSidebar) {
      btnSidebar.classList.remove("active");
      btnSidebar.title = window.t("Open project folder");
    }
  }
  function switchFromMobileSidebar() {
    if (window.innerWidth <= 820 && document.body.getAttribute("data-view") === "sidebar") {
      const toView = document.body.classList.contains("reader-mode-active") ? "preview" : "editor";
      document.body.setAttribute("data-view", toView);
      if (btnSidebarMobile) btnSidebarMobile.classList.remove("active");
    }
  }
  var sbDragging = false;
  var sbStartX = 0;
  var sbStartW = 0;
  var sbMaxW = 0;
  var MIN_SIDEBAR_W = 160;
  var MAX_SIDEBAR_W = 1200;
  function initPanel() {
    if (btnSidebar) btnSidebar.addEventListener("click", () => {
      S.sidebarOpen ? closeSidebar() : openSidebar();
    });
    if (btnSidebarMobile) {
      btnSidebarMobile.addEventListener("click", () => {
        const isSidebar = document.body.getAttribute("data-view") === "sidebar";
        if (isSidebar) {
          const toView = document.body.classList.contains("reader-mode-active") ? "preview" : "editor";
          document.body.setAttribute("data-view", toView);
          btnSidebarMobile.classList.remove("active");
        } else {
          document.body.setAttribute("data-view", "sidebar");
          btnSidebarMobile.classList.add("active");
          if (!S.sidebarOpen) openSidebar();
        }
      });
    }
    if (sidebarDivider) {
      sidebarDivider.addEventListener("mousedown", (e) => {
        sbDragging = true;
        sbStartX = e.clientX;
        sbStartW = sidebarPanel.getBoundingClientRect().width;
        const spare = ["editor-pane", "preview-pane"].reduce((sum, id) => {
          const el = document.getElementById(id);
          const w = el ? el.getBoundingClientRect().width : 0;
          return sum + (w > 0 ? Math.max(0, w - 200) : 0);
        }, 0);
        sbMaxW = Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, sbStartW + spare));
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });
    }
    document.addEventListener("mousemove", (e) => {
      if (!sbDragging) return;
      const dir = window.flipLayout ? -1 : 1;
      const newW = Math.min(sbMaxW, Math.max(MIN_SIDEBAR_W, sbStartW + dir * (e.clientX - sbStartX)));
      sidebarPanel.style.width = newW + "px";
    });
    document.addEventListener("mouseup", () => {
      if (!sbDragging) return;
      sbDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.savedSidebarWidth = sidebarPanel.style.width;
      if (typeof window.saveEditorSettings === "function") window.saveEditorSettings();
    });
  }

  // src/sidebar/link_rewrite.js
  function buildAbsMapper(records) {
    const pairs = records.map((r) => [normalizePath(r.oldPath), normalizePath(r.newPath)]);
    return (abs) => {
      for (const [o, n] of pairs) {
        if (abs === o) return n;
        if (abs.startsWith(o + "/")) return n + abs.slice(o.length);
      }
      return null;
    };
  }
  function invertRecords(records) {
    return records.map((r) => ({ oldPath: r.newPath, newPath: r.oldPath }));
  }
  var LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^()\s]+)(\s+"[^"]*"|\s+'[^']*')?\s*\)/g;
  function rewriteLinksInText(text, opts) {
    const dirBefore = normalizePath(opts.fileDirBefore);
    const dirAfter = normalizePath(opts.fileDirAfter);
    const mapAbs = opts.mapAbs || (() => null);
    const selfMoved = dirBefore !== dirAfter;
    let changes = 0;
    let inFence = false;
    let fenceChar = "";
    const out = text.split("\n").map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const ch = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
        } else if (ch === fenceChar) {
          inFence = false;
        }
        return line;
      }
      if (inFence) return line;
      const spans = [];
      const masked = line.replace(/`[^`]*`/g, (m) => {
        spans.push(m);
        return "\0" + (spans.length - 1) + "\0";
      });
      const rewritten = masked.replace(LINK_RE, (full, bang, label, dest, title) => {
        if (hasUrlScheme(dest) || dest.startsWith("#")) return full;
        const decoded = decodeLinkDest(dest);
        if (hasUrlScheme(decoded) || decoded.startsWith("#")) return full;
        const wasAbsolute = isAbsolutePath(decoded);
        const absOld = resolvePath(dirBefore, decoded);
        const mapped = mapAbs(absOld);
        if (mapped === null && !(selfMoved && !wasAbsolute)) return full;
        const absNew = mapped === null ? absOld : mapped;
        const newDest = encodeLinkDest(wasAbsolute ? absNew : relativePath(dirAfter, absNew));
        if (newDest === dest) return full;
        changes++;
        return `${bang}[${label}](${newDest}${title || ""})`;
      });
      return rewritten.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[+i]);
    });
    return { text: out.join("\n"), changes };
  }

  // src/sidebar/project_scan.js
  var MAX_FILES = 800;
  var LIST_TTL_MS = 15 * 1e3;
  var _cache = { at: 0, root: null, files: null };
  async function listProjectTextFiles(exts) {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return [];
    const wanted = new Set((exts && exts.length ? exts : ["md"]).map((e) => e.toLowerCase()));
    const now = Date.now();
    if (!_cache.files || _cache.root !== S.rootPath || now - _cache.at >= LIST_TTL_MS) {
      const files = [];
      const walk = async (dir) => {
        if (files.length >= MAX_FILES) return;
        let entries;
        try {
          entries = await window.NativeAPI.readDirectory(dir);
        } catch (_) {
          return;
        }
        for (const e of entries) {
          if (files.length >= MAX_FILES) return;
          if (!e || !e.name || e.name.startsWith(".")) continue;
          if (e.type === "dir") {
            await walk(e.path);
          } else {
            files.push({ path: e.path, name: e.name, mtime: e.mtime });
          }
        }
      };
      await walk(S.rootPath);
      _cache = { at: now, root: S.rootPath, files };
    }
    return _cache.files.filter((f) => {
      const dot = f.name.lastIndexOf(".");
      return dot > 0 && wanted.has(f.name.slice(dot + 1).toLowerCase());
    });
  }
  function invalidateProjectScan() {
    _cache = { at: 0, root: null, files: null };
  }

  // src/sidebar/import_text.js
  function decodeImportedText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 4 && b[0] === 255 && b[1] === 254 && b[2] === 0 && b[3] === 0) {
      throw new Error("UTF-32 text is not supported.");
    }
    if (b.length >= 2 && b[0] === 255 && b[1] === 254) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(b);
    }
    if (b.length >= 2 && b[0] === 254 && b[1] === 255) {
      return new TextDecoder("utf-16be", { fatal: true }).decode(b);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);
  }

  // src/sidebar/fileops.js
  function errText(err) {
    return String(err && err.message || err).replace(/^Error invoking remote method '[^']*': /, "").replace(/^Error: /, "");
  }
  function reportBusy() {
    if (typeof window.showStatusWarning === "function") {
      window.showStatusWarning("fs-busy", window.t("Busy \u2014 try again in a moment."), { priority: 5, ttl: 2500 });
    }
  }
  function nameProblemText(reason, name) {
    switch (reason) {
      case "empty":
        return window.t("Please enter a name.");
      case "hidden":
        return window.t("A name that starts with a dot would hide the item from the file panel. Please choose another name.");
      case "edge":
        return window.t("A name cannot start with a space or end with a dot or a space. Please choose another name.");
      case "device":
        return window.t('"{name}" is a reserved name on Windows. Please choose another name.').replace("{name}", name);
      case "internal":
        return window.t("This name ends like one of Revery's own safety files. Please choose another name.");
      case "long":
        return window.t("This name is too long. Please choose a shorter name.");
      default:
        return window.t("This name cannot be used. Please choose another name.");
    }
  }
  async function showNameProblem(reason, name) {
    try {
      await window.NativeAPI.showMessageBox({
        type: "warning",
        title: window.t("Invalid Name"),
        message: nameProblemText(reason, name),
        buttons: [window.t("OK")]
      });
    } catch (_) {
    }
  }
  function activeAffectedBy(paths) {
    if (!S.activeFilePath) return false;
    return paths.some((p) => isInsideRoot(S.activeFilePath, p));
  }
  async function inDiskLock(involvesActive, fn) {
    return _enqueueDiskOp(async () => {
      if (involvesActive) await stopWatchingFile();
      try {
        return await fn();
      } finally {
        if (involvesActive && S.activeFilePath && !samePath(watchedPath(), S.activeFilePath)) {
          startWatchingFile(S.activeFilePath);
        }
      }
    });
  }
  function remapPathState(records) {
    for (const { oldPath, newPath } of records) {
      const f = (p) => remapUnder(p, oldPath, newPath) || p;
      if (S.selectedDirPath) S.selectedDirPath = f(S.selectedDirPath);
      if (S.cardViewDir) S.cardViewDir = f(S.cardViewDir);
      if (S.previewMediaPath) S.previewMediaPath = f(S.previewMediaPath);
      if (S.selectionAnchor) S.selectionAnchor = f(S.selectionAnchor);
      const dirs = [...expandedDirs];
      expandedDirs.clear();
      for (const d of dirs) expandedDirs.add(f(d));
    }
  }
  function forgetDeletedPathState(p) {
    const parent = parentPathOf(p);
    const hit = (q) => q && isInsideRoot(q, p);
    if (hit(S.selectedDirPath)) S.selectedDirPath = parent;
    if (hit(S.cardViewDir)) S.cardViewDir = parent;
    if (hit(S.selectionAnchor)) S.selectionAnchor = null;
    forgetPreviewIfDeleted(p);
    for (const d of [...expandedDirs]) if (hit(d)) expandedDirs.delete(d);
  }
  async function closeDeletedActiveFile() {
    markActivePathGone(S.activeFilePath);
    cancelPendingAutoSave();
    S.activeFilePath = null;
    markClean();
    if (typeof window.replaceEditorContent === "function") {
      window.replaceEditorContent("");
    } else {
      editor.value = "";
      if (typeof render === "function") render();
      if (typeof countWords === "function") countWords();
    }
    await window.NativeAPI.clearLastOpenedFile().catch(() => {
    });
  }
  function withoutNested(items) {
    return items.filter((it) => !items.some((o) => o !== it && !samePath(o.path, it.path) && isInsideRoot(it.path, o.path)));
  }
  function itemInfo(p) {
    const el = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"], .sidebar-card[data-path="${CSS.escape(p)}"]`);
    return {
      type: el ? el.dataset.type : "file",
      link: !!(el && el.dataset.link === "1"),
      known: !!el
    };
  }
  var MAX_UNDO = 30;
  var undoStack = [];
  var redoStack = [];
  var _dirOf = (p) => p.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  var _n = (p) => String(p).replace(/\\/g, "/");
  function applyTextToEditor(oldText, newText) {
    const a = oldText.split("\n");
    const b = newText.split("\n");
    const changes = [];
    if (a.length === b.length) {
      let pos = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) changes.push({ from: pos, to: pos + a[i].length, insert: b[i] });
        pos += a[i].length + 1;
      }
    } else {
      let s = 0;
      while (s < oldText.length && s < newText.length && oldText[s] === newText[s]) s++;
      let e = 0;
      while (e < oldText.length - s && e < newText.length - s && oldText[oldText.length - 1 - e] === newText[newText.length - 1 - e]) e++;
      changes.push({ from: s, to: oldText.length - e, insert: newText.slice(s, newText.length - e) });
    }
    if (!changes.length) return;
    if (typeof window.applyEditorChanges === "function") window.applyEditorChanges(changes);
    else window.insertWithUndo(0, oldText.length, newText);
  }
  async function updateLinksAfterPathChange(records, { confirm = true } = {}) {
    try {
      if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return "none";
      records = (records || []).filter((r) => r && r.oldPath && r.newPath && r.oldPath.replace(/\\/g, "/") !== r.newPath.replace(/\\/g, "/"));
      if (!records.length) return "none";
      invalidateProjectScan();
      const files = await listProjectTextFiles(["md", "txt"]);
      if (!files.length) return "none";
      const mapAbs = buildAbsMapper(records);
      const mapBack = buildAbsMapper(invertRecords(records));
      const isActivePath = (p) => !!S.activeFilePath && _n(S.activeFilePath) === _n(p);
      const plans = [];
      for (const f of files) {
        const postPath = _n(f.path);
        const prePath = mapBack(postPath) || postPath;
        const opts = { fileDirBefore: _dirOf(prePath), fileDirAfter: _dirOf(postPath), mapAbs };
        let content;
        if (isActivePath(f.path)) {
          content = editor.value;
        } else {
          try {
            content = await window.NativeAPI.readFile(f.path);
          } catch (_) {
            continue;
          }
        }
        if (typeof content !== "string") continue;
        const res = rewriteLinksInText(content, opts);
        if (res.changes > 0 && res.text !== content) {
          plans.push({ path: f.path, opts, changes: res.changes });
        }
      }
      if (!plans.length) return "none";
      if (confirm) {
        const total = plans.reduce((a, p) => a + p.changes, 0);
        const names = plans.map((p) => p.path.replace(/\\/g, "/").split("/").pop());
        const shown = names.slice(0, 8);
        if (names.length > shown.length) shown.push(window.t("\u2026and {n} more").replace("{n}", names.length - shown.length));
        const ok = await showConfirmDialog(
          window.t("Update {n} link(s) in {m} file(s) so they keep working?").replace("{n}", total).replace("{m}", plans.length),
          shown,
          window.t("Update links")
        );
        if (!ok) return "declined";
      }
      const errors = [];
      for (const p of plans) {
        try {
          if (isActivePath(p.path)) {
            const cur = editor.value;
            const res = rewriteLinksInText(cur, p.opts);
            if (res.changes > 0 && res.text !== cur) {
              applyTextToEditor(cur, res.text);
              if (typeof render === "function") render();
            }
          } else {
            const cur = await window.NativeAPI.readFile(p.path);
            const res = rewriteLinksInText(cur, p.opts);
            if (res.changes > 0 && res.text !== cur) {
              await window.NativeAPI.writeFile(p.path, res.text);
            }
          }
        } catch (err) {
          errors.push(`${p.path.replace(/\\/g, "/").split("/").pop()}: ${err.message || err}`);
        }
      }
      if (errors.length && window.NativeAPI.showMessageBox) {
        await window.NativeAPI.showMessageBox({
          type: "warning",
          title: window.t("Link Update"),
          message: window.t("{n} file(s) could not be updated (their links are unchanged):").replace("{n}", errors.length),
          detail: errors.join("\n")
        });
      }
      return "updated";
    } catch (err) {
      console.error("[Sidebar] link update failed (files left unchanged):", err);
      return "failed";
    }
  }
  async function followLinksOnReplay(records, choice) {
    if (choice === "declined") return "declined";
    const outcome = await updateLinksAfterPathChange(records, { confirm: choice !== "updated" });
    return outcome === "updated" || outcome === "declined" ? outcome : choice;
  }
  function pushUndo(op) {
    undoStack.push(op);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }
  function hasUndoOperations() {
    return undoStack.length > 0;
  }
  function hasRedoOperations() {
    return redoStack.length > 0;
  }
  async function settleActiveFileBefore(paths) {
    if (!activeAffectedBy(paths)) return true;
    const held = !!S._conflictHoldPath && S._conflictHoldPath === S.activeFilePath;
    if (S.isDirty && !held) return await saveActiveFile();
    await waitForSaveChainIdle();
    return true;
  }
  async function followActiveFile(from, to) {
    if (!S.activeFilePath) return;
    const next = remapUnder(S.activeFilePath, from, to);
    if (next && next !== S.activeFilePath) await retargetActiveFile(S.activeFilePath, next);
  }
  function clearUndoStack() {
    undoStack.length = 0;
    redoStack.length = 0;
  }
  async function stepFileHistory(direction) {
    const redo = direction === "redo";
    const from = redo ? redoStack : undoStack;
    const to = redo ? undoStack : redoStack;
    if (from.length === 0) return;
    if (S._operationLock) {
      reportBusy();
      return;
    }
    S._operationLock = true;
    try {
      const op = from.pop();
      const steps = op.records.map((rec) => redo ? { rec, at: rec.oldPath, dest: rec.newPath } : { rec, at: rec.newPath, dest: rec.oldPath });
      if (!redo) steps.reverse();
      const currentPaths = steps.map((s) => s.at);
      if (!await settleActiveFileBefore(currentPaths)) {
        from.push(op);
        return;
      }
      const errors = [];
      const moved = [];
      const done = /* @__PURE__ */ new Set();
      await inDiskLock(activeAffectedBy(currentPaths), async () => {
        for (const { rec, at, dest } of steps) {
          try {
            await window.NativeAPI.renameNode(at, dest);
          } catch (err) {
            errors.push(`${baseNameOf(at)}: ${errText(err)}`);
            continue;
          }
          const m = { oldPath: at, newPath: dest };
          moved.push(m);
          done.add(rec);
          await followActiveFile(at, dest);
          remapPathState([m]);
        }
      });
      let entry = null;
      if (moved.length) {
        entry = { ...op, records: op.records.filter((r) => done.has(r)) };
        to.push(entry);
        if (to.length > MAX_UNDO) to.shift();
      }
      selectedItems.clear();
      S.selectionAnchor = null;
      await renderTree();
      if (entry) entry.links = await followLinksOnReplay(moved, op.links);
      if (moved.length && typeof window.showStatusWarning === "function") {
        const msg = op.type === "rename" ? redo ? window.t('Redone: rename of "{name}".') : window.t('Undone: rename of "{name}".') : redo ? window.t("Redone: move of {n} item(s).") : window.t("Undone: move of {n} item(s).");
        window.showStatusWarning(
          "fs-undo",
          msg.replace("{name}", baseNameOf(moved[0].newPath)).replace("{n}", moved.length),
          { priority: 20, ttl: 5e3 }
        );
      }
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: "warning",
          title: redo ? window.t("Redo Failed Partially") : window.t("Undo Failed Partially"),
          message: (redo ? window.t("{n} item(s) could not be moved again:") : window.t("{n} item(s) could not be moved back:")).replace("{n}", errors.length),
          detail: errors.join("\n")
        });
      }
    } finally {
      S._operationLock = false;
    }
  }
  var undoLastOperation = () => stepFileHistory("undo");
  var redoLastOperation = () => stepFileHistory("redo");
  async function moveNodes(items, targetDir) {
    if (!items.length || !targetDir) return;
    if (S._operationLock) {
      reportBusy();
      return;
    }
    if (!S.rootPath || !isInsideRoot(targetDir, S.rootPath)) return;
    S._operationLock = true;
    try {
      const plan = withoutNested(items).filter(({ path: src }) => !samePath(src, S.rootPath) && !isInsideRoot(targetDir, src) && !samePath(dirOf(src), targetDir));
      if (!plan.length) return;
      const srcPaths = plan.map((it) => it.path);
      if (!await settleActiveFileBefore(srcPaths)) {
        return;
      }
      const errors = [];
      const movedRecords = [];
      await inDiskLock(activeAffectedBy(srcPaths), async () => {
        for (const { path: srcPath, type } of plan) {
          const name = baseNameOf(srcPath);
          const destPath = await uniqueDestPath(targetDir, name, type);
          try {
            await window.NativeAPI.renameNode(srcPath, destPath);
          } catch (err) {
            errors.push(`${name}: ${errText(err)}`);
            continue;
          }
          const rec = { oldPath: srcPath, newPath: destPath };
          movedRecords.push(rec);
          await followActiveFile(srcPath, destPath);
          remapPathState([rec]);
        }
      });
      if (movedRecords.length) expandedDirs.add(targetDir);
      selectedItems.clear();
      S.selectionAnchor = null;
      const entry = movedRecords.length ? { type: "move", records: movedRecords, links: "none" } : null;
      if (entry) pushUndo(entry);
      await renderTree();
      if (entry) entry.links = await updateLinksAfterPathChange(movedRecords);
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: "warning",
          title: window.t("Move Issues"),
          message: window.t("{n} item(s) could not be moved:").replace("{n}", errors.length),
          detail: errors.join("\n")
        });
      }
    } finally {
      S._operationLock = false;
    }
  }
  function moveUpTarget(paths) {
    if (!paths.length || !S.rootPath) return null;
    const parent = parentPathOf(paths[0]);
    if (!paths.every((p) => samePath(parentPathOf(p), parent))) return null;
    if (samePath(parent, S.rootPath) || !isInsideRoot(parent, S.rootPath)) return null;
    return parentPathOf(parent);
  }
  async function moveItemsUp(items) {
    const target = moveUpTarget(items.map((it) => it.path));
    if (target) await moveNodes(items, target);
  }
  var PICKER_MAX_FOLDERS = 3e3;
  async function listProjectFolders() {
    const folders = [{ path: S.rootPath, name: baseNameOf(S.rootPath) || S.rootPath, rel: "", depth: 0 }];
    let truncated = false;
    const walk = async (dir, rel, depth) => {
      let entries;
      try {
        entries = await window.NativeAPI.readDirectory(dir);
      } catch (_) {
        return;
      }
      const dirs = entries.filter((e) => e.type === "dir" && !e.link && !e.name.startsWith(".")).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      for (const e of dirs) {
        if (folders.length >= PICKER_MAX_FOLDERS) {
          truncated = true;
          return;
        }
        const r = rel ? rel + "/" + e.name : e.name;
        folders.push({ path: e.path, name: e.name, rel: r, depth });
        if (depth < 32) await walk(e.path, r, depth + 1);
      }
    };
    await walk(S.rootPath, "", 1);
    return { folders, truncated };
  }
  async function moveItemsTo(items) {
    if (!items.length || !S.rootPath) return;
    if (S._operationLock) {
      reportBusy();
      return;
    }
    const paths = items.map((it) => it.path);
    const parent = parentPathOf(paths[0]);
    const sameParent = paths.every((p) => samePath(parentPathOf(p), parent));
    const title = items.length === 1 ? window.t('Move "{name}" to\u2026').replace("{name}", baseNameOf(paths[0])) : window.t("Move {n} items to\u2026").replace("{n}", items.length);
    const target = await showFolderPickerDialog({
      title,
      okLabel: window.t("Move here"),
      load: async () => {
        const { folders, truncated } = await listProjectFolders();
        return {
          truncated,
          folders: folders.filter((f) => !paths.some((p) => isInsideRoot(f.path, p))).map((f) => sameParent && samePath(f.path, parent) ? { ...f, disabled: true, note: window.t("(current folder)") } : f)
        };
      }
    });
    if (target) await moveNodes(items, target);
  }
  function forgetPreviewIfDeleted(node) {
    if (S.previewMediaPath && isInsideRoot(S.previewMediaPath, node)) {
      S.previewMediaPath = null;
    }
  }
  async function renameSelectedNodes() {
    if (selectedItems.size === 0) return;
    if (S._operationLock) {
      reportBusy();
      return;
    }
    if (selectedItems.size === 1) {
      const p = [...selectedItems][0];
      await renameNode(p, itemInfo(p).type);
      selectedItems.clear();
      S.selectionAnchor = null;
      return;
    }
    S._operationLock = true;
    try {
      const paths = [...selectedItems];
      const firstName = baseNameOf(paths[0]);
      const defaultBase = firstName.replace(/\.(md|txt)$/, "");
      const baseName = await showInputDialog(
        window.t("Rename {n} items \u2014 enter a base name").replace("{n}", paths.length) + "\n" + window.t("(items will be named: name, name_2, name_3 \u2026):"),
        defaultBase
      );
      if (!baseName) return;
      const safeBase = sanitizeEntryName(baseName);
      const baseProblem = checkEntryName(safeBase);
      if (baseProblem) {
        await showNameProblem(baseProblem, safeBase);
        return;
      }
      const plan = [];
      for (let i = 0; i < paths.length; i++) {
        const srcPath = paths[i];
        const oldName = baseNameOf(srcPath);
        const { type, known } = itemInfo(srcPath);
        const isFile = known ? type === "file" : oldName.lastIndexOf(".") > 0;
        const oldExt = isFile && oldName.lastIndexOf(".") > 0 ? oldName.substring(oldName.lastIndexOf(".")) : "";
        const newName = i === 0 ? `${safeBase}${oldExt}` : `${safeBase}_${i + 1}${oldExt}`;
        if (newName === oldName) continue;
        const problem = checkEntryName(newName);
        if (problem) {
          await showNameProblem(problem, newName);
          return;
        }
        plan.push({ oldPath: srcPath, newPath: joinPath(parentPathOf(srcPath), newName) });
      }
      if (!plan.length) return;
      if (!await settleActiveFileBefore(plan.map((r) => r.oldPath))) return;
      const renamedRecords = [];
      const errors = [];
      await inDiskLock(activeAffectedBy(plan.map((r) => r.oldPath)), async () => {
        for (const rec of plan) {
          try {
            await window.NativeAPI.renameNode(rec.oldPath, rec.newPath);
          } catch (err) {
            errors.push(`${baseNameOf(rec.oldPath)}: ${errText(err)}`);
            continue;
          }
          renamedRecords.push(rec);
          await followActiveFile(rec.oldPath, rec.newPath);
          remapPathState([rec]);
        }
      });
      selectedItems.clear();
      S.selectionAnchor = null;
      const entry = renamedRecords.length ? { type: "rename", records: renamedRecords, links: "none" } : null;
      if (entry) pushUndo(entry);
      await renderTree();
      if (entry) entry.links = await updateLinksAfterPathChange(renamedRecords);
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: "warning",
          title: window.t("Rename Issues"),
          message: window.t("{n} item(s) could not be renamed:").replace("{n}", errors.length),
          detail: errors.join("\n")
        });
      }
    } finally {
      S._operationLock = false;
    }
  }
  function tellDeleteStopped(msg) {
    if (typeof window.showStatusWarning === "function") {
      window.showStatusWarning(
        "action-stopped",
        msg.replace("{name}", baseNameOf(S.activeFilePath || "")),
        { priority: 80, ttl: 9e3 }
      );
    }
  }
  function deleteBlockedByPause(paths) {
    if (!activeAffectedBy(paths) || !S._conflictHoldPath || S._conflictHoldPath !== S.activeFilePath) return false;
    tellDeleteStopped(window.t('Nothing was deleted: auto-save is paused for "{name}", so the version on screen is not on disk. Save it (Ctrl+S) or resolve the message first.'));
    return true;
  }
  async function saveOpenNoteBeforeDelete(paths) {
    if (!activeAffectedBy(paths)) return true;
    if (deleteBlockedByPause(paths)) return false;
    if (S.isDirty) {
      if (!await saveActiveFile()) {
        tellDeleteStopped(window.t('Nothing was deleted: "{name}" could not be saved first, and its latest edits would have been lost.'));
        return false;
      }
      return true;
    }
    await waitForSaveChainIdle();
    return true;
  }
  async function deleteSelectedNodes() {
    if (selectedItems.size === 0) return;
    if (S._operationLock) {
      reportBusy();
      return;
    }
    S._operationLock = true;
    try {
      const items = withoutNested([...selectedItems].map((p) => ({ path: p })));
      if (deleteBlockedByPause(items.map((it) => it.path))) return;
      const n = selectedItems.size;
      const anyLink = [...selectedItems].some((p) => itemInfo(p).link);
      const result = await window.NativeAPI.showMessageBox({
        type: "question",
        buttons: [window.t("Move to Trash"), window.t("Cancel")],
        defaultId: 1,
        title: window.t("Delete {n} item(s)").replace("{n}", n),
        message: window.t("Move {n} item(s) to Trash?").replace("{n}", n),
        detail: window.t("You can restore them from your system trash.") + (anyLink ? "\n" + window.t("Links are removed as links; the items they point to are not changed.") : "")
      });
      if (result.response !== 0) return;
      if (!await saveOpenNoteBeforeDelete(items.map((it) => it.path))) return;
      const errors = [];
      let deletedAny = false;
      await inDiskLock(activeAffectedBy(items.map((it) => it.path)), async () => {
        for (const { path: p } of items) {
          try {
            await window.NativeAPI.deleteNode(p);
          } catch (err) {
            errors.push(`${baseNameOf(p)}: ${errText(err)}`);
            continue;
          }
          deletedAny = true;
          if (S.activeFilePath && isInsideRoot(S.activeFilePath, p)) await closeDeletedActiveFile();
          forgetDeletedPathState(p);
        }
      });
      if (deletedAny) clearUndoStack();
      selectedItems.clear();
      S.selectionAnchor = null;
      await renderTree();
      if (errors.length) {
        await window.NativeAPI.showMessageBox({
          type: "warning",
          title: window.t("Delete Issues"),
          message: window.t("{n} item(s) could not be moved to the trash (nothing else was changed):").replace("{n}", errors.length),
          detail: errors.join("\n")
        });
      }
    } finally {
      S._operationLock = false;
    }
  }
  async function openMediaFile(filePath) {
    const switched = await replaceOpenDocument(null, () => {
      S.activeFilePath = null;
      window._showingUnsupportedFile = false;
      S.previewMediaPath = filePath;
      const mdText = mediaMarkdown(filePath);
      if (typeof window.replaceEditorContent === "function") {
        window.replaceEditorContent(mdText);
      } else {
        editor.value = mdText;
        if (typeof render === "function") render();
      }
      if (docTitleEl) {
        const base = filePath.replace(/\\/g, "/").split("/").pop().replace(/\.[^/.]+$/, "");
        docTitleEl.value = base;
      }
      treeEl.querySelectorAll(".sidebar-media-active").forEach((el) => el.classList.remove("sidebar-media-active"));
      const mediaEl = treeEl.querySelector(`.sidebar-item[data-path="${CSS.escape(filePath)}"]`);
      if (mediaEl) mediaEl.classList.add("sidebar-media-active");
      markClean();
    });
    if (switched) switchFromMobileSidebar();
  }
  async function openUnsupportedFile(filePath) {
    const switched = await replaceOpenDocument(null, () => {
      S.activeFilePath = null;
      S.previewMediaPath = null;
      window._showingUnsupportedFile = true;
      if (typeof window.replaceEditorContent === "function") {
        window.replaceEditorContent("");
      } else {
        editor.value = "";
      }
      if (docTitleEl) {
        docTitleEl.value = filePath.replace(/\\/g, "/").split("/").pop();
      }
      if (typeof window.replaceEditorContent !== "function") {
        if (typeof render === "function") render();
        if (typeof countWords === "function") countWords();
      }
      markClean();
    });
    if (switched) switchFromMobileSidebar();
  }
  async function openFile(filePath) {
    const switched = await replaceOpenDocument(async () => {
      let path = filePath;
      try {
        const c = await window.NativeAPI.canonicalEntryPath(path);
        if (typeof c === "string" && c) path = c;
      } catch (_) {
      }
      try {
        return { path, content: await window.NativeAPI.readFile(path) };
      } catch (err) {
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Open Failed"),
          message: window.t("Could not read:") + "\n" + path,
          detail: String(err)
        });
        return SWITCH_CANCELLED;
      }
    }, ({ path, content }) => {
      filePath = path;
      S.previewMediaPath = null;
      window._showingUnsupportedFile = false;
      if (typeof window.replaceEditorContent === "function") {
        window.replaceEditorContent(content);
      } else {
        editor.value = content;
        if (typeof render === "function") render();
        if (typeof countWords === "function") countWords();
      }
      S.activeFilePath = path;
      forgetGonePath(path);
      markClean();
      rememberDiskContent(content);
      if (docTitleEl) {
        docTitleEl.value = baseNameOf(path).replace(/\.(md|txt)$/, "");
      }
    });
    if (!switched) return;
    await window.NativeAPI.setLastOpenedFile(filePath).catch((e) => console.warn("[Sidebar] could not persist last-opened pointer (non-fatal):", e));
    if (typeof postProcessImages === "function") postProcessImages();
    highlightActiveFile(filePath);
    switchFromMobileSidebar();
    startWatchingFile(filePath);
  }
  async function tellNoFolderOpen() {
    await window.NativeAPI.showMessageBox({
      type: "info",
      title: window.t("No Folder Open"),
      message: window.t("Please open a project folder first.")
    }).catch(() => {
    });
  }
  async function createNewFile(targetDir) {
    if (S._operationLock || S._projectSwitch) {
      reportBusy();
      return;
    }
    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) {
      await tellNoFolderOpen();
      return;
    }
    if (!await saveBeforeLeaving()) return;
    const MAX_CREATE_RETRIES = 5;
    let newPath = null;
    let created = false;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      newPath = await uniquePath(dir, "untitled", "md");
      try {
        await window.NativeAPI.createFile(newPath);
        created = true;
        break;
      } catch (err) {
        const isCollision = String(err).includes("already exists");
        if (isCollision && attempt < MAX_CREATE_RETRIES - 1) {
          continue;
        }
        console.error("[Sidebar] createFile failed:", err);
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Could Not Create File"),
          message: window.t("The file could not be created."),
          detail: String(err)
        });
        return;
      }
    }
    if (!created) return;
    expandedDirs.add(dir);
    await renderTree();
    await openFile(newPath);
    if (docTitleEl) {
      docTitleEl.select();
      docTitleEl.focus();
    }
  }
  async function createNewFolder(targetDir) {
    if (S._operationLock) {
      reportBusy();
      return;
    }
    const dir = targetDir || S.selectedDirPath || S.rootPath;
    if (!dir) return;
    const name = await showInputDialog(window.t("New folder name:"));
    if (!name || !name.trim()) return;
    const safeName = sanitizeEntryName(name);
    const problem = checkEntryName(safeName);
    if (problem) {
      await showNameProblem(problem, safeName);
      return;
    }
    const newPath = joinPath(dir, safeName);
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      if (entries.some((e) => e.name.toLowerCase() === safeName.toLowerCase())) {
        await window.NativeAPI.showMessageBox({
          type: "info",
          title: window.t("Name Already Used"),
          message: window.t('"{name}" already exists in this folder.').replace("{name}", safeName),
          buttons: [window.t("OK")]
        }).catch(() => {
        });
        return;
      }
    } catch (_) {
    }
    try {
      await window.NativeAPI.createDirectory(newPath);
      expandedDirs.add(dir);
      S.selectedDirPath = dir;
      await renderTree();
    } catch (err) {
      console.error("[Sidebar] createDirectory failed:", err);
      await window.NativeAPI.showMessageBox({
        type: "error",
        title: window.t("Could Not Create Folder"),
        message: window.t('Could not create folder "{name}".').replace("{name}", safeName),
        detail: errText(err)
      });
    }
  }
  async function renameNode(nodePath, type) {
    if (S._operationLock) {
      reportBusy();
      return;
    }
    S._operationLock = true;
    try {
      const oldName = baseNameOf(nodePath);
      const typed = await showInputDialog(
        window.t('Rename "{name}" to:').replace("{name}", oldName),
        oldName,
        { selectStem: type === "file" }
      );
      if (!typed) return;
      const safeName = sanitizeEntryName(typed);
      if (safeName === oldName) return;
      const typedProblem = checkEntryName(safeName);
      if (typedProblem) {
        await showNameProblem(typedProblem, safeName);
        return;
      }
      const finalName = type === "file" ? renamedFileName(oldName, safeName) : safeName;
      if (finalName === oldName) return;
      const finalProblem = checkEntryName(finalName);
      if (finalProblem) {
        await showNameProblem(finalProblem, finalName);
        return;
      }
      const newPath = joinPath(parentPathOf(nodePath), finalName);
      if (!await settleActiveFileBefore([nodePath])) return;
      const rec = { oldPath: nodePath, newPath };
      try {
        await inDiskLock(activeAffectedBy([nodePath]), async () => {
          await window.NativeAPI.renameNode(nodePath, newPath);
          await followActiveFile(nodePath, newPath);
          remapPathState([rec]);
        });
      } catch (err) {
        console.error("[Sidebar] renameNode failed:", err);
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Rename Failed"),
          message: window.t('Could not rename file to "{name}".').replace("{name}", finalName),
          detail: errText(err)
        }).catch(() => {
        });
        return;
      }
      const entry = { type: "rename", records: [rec], links: "none" };
      pushUndo(entry);
      await renderTree();
      entry.links = await updateLinksAfterPathChange([rec]);
    } finally {
      S._operationLock = false;
    }
  }
  async function deleteNode(nodePath, type, isLink = false) {
    if (S._operationLock) {
      reportBusy();
      return;
    }
    S._operationLock = true;
    try {
      const name = baseNameOf(nodePath);
      if (deleteBlockedByPause([nodePath])) return;
      const result = await window.NativeAPI.showMessageBox({
        type: "question",
        buttons: [window.t("Move to Trash"), window.t("Cancel")],
        defaultId: 1,
        title: isLink ? window.t("Delete Link") : type === "dir" ? window.t("Delete Folder") : window.t("Delete File"),
        message: (isLink ? window.t('Move the link "{name}" to Trash?') : window.t('Move "{name}" to Trash?')).replace("{name}", name),
        detail: isLink ? window.t("Only the link is removed. The item it points to is not changed.") : type === "dir" ? window.t("The folder and all its contents will be moved to your system trash. You can restore them from there.") : window.t("The file will be moved to your system trash. You can restore it from there.")
      });
      if (result.response !== 0) return;
      if (!await saveOpenNoteBeforeDelete([nodePath])) return;
      let failure = null;
      await inDiskLock(activeAffectedBy([nodePath]), async () => {
        try {
          await window.NativeAPI.deleteNode(nodePath);
        } catch (err) {
          failure = err;
          return;
        }
        if (S.activeFilePath && isInsideRoot(S.activeFilePath, nodePath)) await closeDeletedActiveFile();
        forgetDeletedPathState(nodePath);
      });
      if (!failure) clearUndoStack();
      if (failure) {
        console.error("[Sidebar] deleteNode failed:", failure);
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Delete Failed"),
          message: window.t('"{name}" could not be moved to the trash. Nothing was changed.').replace("{name}", name),
          detail: errText(failure)
        }).catch(() => {
        });
      }
      await renderTree();
    } finally {
      S._operationLock = false;
    }
  }
  async function openFolder(folderPath) {
    const canonical = await window.NativeAPI.setRootPath(folderPath);
    if (typeof canonical === "string" && canonical) folderPath = canonical;
    S.rootPath = folderPath;
    S.selectedDirPath = folderPath;
    restoreCardViewDir(folderPath);
    clearUndoStack();
    try {
      localStorage.setItem("revery_root_path", S.rootPath);
    } catch (e) {
    }
    if (typeof window.NativeAPI.setLastRootPath === "function") {
      await window.NativeAPI.setLastRootPath(S.rootPath).catch(() => {
      });
    }
    await recordProjectOpen(folderPath);
    _previewCache.clear();
    const parts = folderPath.replace(/\\/g, "/").split("/");
    folderNameEl.textContent = parts[parts.length - 1] || folderPath;
    expandedDirs.clear();
    expandedDirs.add(folderPath);
    await renderTree();
    if (!S.sidebarOpen) openSidebar();
  }
  function clearEditorForProjectSwitch() {
    S._projectSwitch = true;
    S.activeFilePath = null;
    S.previewMediaPath = null;
    window._showingUnsupportedFile = false;
    markClean();
    if (typeof window.replaceEditorContent === "function") {
      window.replaceEditorContent("");
    } else {
      editor.value = "";
      if (typeof render === "function") render();
    }
    if (typeof countWords === "function") countWords();
    if (docTitleEl) docTitleEl.value = "";
  }
  async function switchProject(path) {
    const previousNote = S.activeFilePath;
    const previousRoot = S.rootPath;
    let began = false;
    let failure = null;
    try {
      if (hasTextWithoutProject()) {
        if (S._projectSwitch || S._operationLock) {
          reportBusy();
          return;
        }
        began = true;
        S._projectSwitch = true;
      } else if (!await replaceOpenDocument(null, () => {
        began = true;
        clearEditorForProjectSwitch();
      })) {
        return;
      }
      await window.NativeAPI.clearLastOpenedFile().catch((e) => console.warn("[Sidebar] could not persist last-opened pointer (non-fatal):", e));
      await openFolder(path);
    } catch (err) {
      failure = err;
    } finally {
      if (began) S._projectSwitch = false;
    }
    if (!began) {
      if (failure) console.error("[Sidebar] project switch failed before it started:", failure);
      return;
    }
    if (failure) {
      console.error("[Sidebar] project switch failed:", failure);
      if (S.rootPath === previousRoot) {
        await window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Could Not Open Folder"),
          message: (previousRoot ? window.t('"{name}" could not be opened. The current project stays open.') : window.t('"{name}" could not be opened.')).replace("{name}", baseNameOf(path) || path),
          detail: errText(failure)
        }).catch(() => {
        });
        const untouched = !S.activeFilePath && !S.previewMediaPath && !window._showingUnsupportedFile && editor.value === "";
        if (previousNote && untouched) await openFile(previousNote);
      }
    }
    resumeScratchpadAfterSwitch();
  }
  async function promptOpenFolder() {
    try {
      const path = await window.NativeAPI.openFolderDialog();
      if (!path) return;
      await switchProject(path);
    } catch (err) {
      console.error("[Sidebar] openFolderDialog failed:", err);
    }
  }
  function initFileOps() {
    if (btnOpenFolder) btnOpenFolder.addEventListener("click", promptOpenFolder);
    if (btnNewFile) btnNewFile.addEventListener("click", () => createNewFile(S.selectedDirPath || S.rootPath));
    if (btnNewFolder) btnNewFolder.addEventListener("click", () => createNewFolder(S.selectedDirPath || S.rootPath));
    window.sidebarCreateNewFile = () => createNewFile(S.selectedDirPath || S.rootPath);
    window.sidebarImportFile = async function() {
      const dir = S.selectedDirPath || S.rootPath;
      if (!dir) {
        await tellNoFolderOpen();
        return;
      }
      if (!await saveBeforeLeaving()) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.txt";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const tell = (type, title, message, detail) => window.NativeAPI.showMessageBox({
          type,
          title,
          message,
          detail,
          buttons: [window.t("OK")]
        }).catch(() => {
        });
        if (file.size > 20 * 1024 * 1024) {
          await tell("warning", window.t("Import"), window.t("File is too large. Maximum is 20 MB."));
          return;
        }
        let bytes;
        try {
          bytes = await file.arrayBuffer();
        } catch (err) {
          await tell(
            "error",
            window.t("Import Failed"),
            window.t('"{name}" could not be read.').replace("{name}", file.name),
            errText(err)
          );
          return;
        }
        let content;
        try {
          content = decodeImportedText(bytes);
        } catch (_) {
          await tell(
            "warning",
            window.t("Import"),
            window.t('"{name}" was not imported.').replace("{name}", file.name),
            window.t("It is not UTF-8 text (it may use another encoding, such as Windows-1252). Importing it would have replaced some of its characters. Convert it to UTF-8 in another editor, then import it again.")
          );
          return;
        }
        let baseName = sanitizeEntryName(file.name.replace(/\.[^/.]+$/, ""));
        const ext = /\.txt$/i.test(file.name) ? "txt" : "md";
        if (checkEntryName(baseName) || checkEntryName(`${baseName}.${ext}`)) baseName = "imported";
        let destPath = null;
        let created = false;
        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            destPath = await uniquePath(dir, baseName, ext);
            try {
              await window.NativeAPI.createFile(destPath);
              created = true;
              break;
            } catch (err) {
              if (String(err).includes("already exists") && attempt < 4) continue;
              throw err;
            }
          }
          await window.NativeAPI.writeFile(destPath, content);
        } catch (err) {
          console.error("[Sidebar] import write failed:", err);
          if (created) window.NativeAPI.deleteNode(destPath).catch(() => {
          });
          await tell(
            "error",
            window.t("Import Failed"),
            window.t('"{name}" could not be imported.').replace("{name}", file.name),
            errText(err)
          );
          return;
        }
        await renderTree();
        await openFile(destPath);
      };
      input.click();
    };
  }

  // src/sidebar/tree.js
  var _treeRenderGeneration = 0;
  var sortKey = "name";
  var sortDir = "asc";
  try {
    const saved = JSON.parse(localStorage.getItem("revery_sidebar_sort") || "null");
    if (saved && ["name", "modified", "created"].includes(saved.key)) sortKey = saved.key;
    if (saved && ["asc", "desc"].includes(saved.dir)) sortDir = saved.dir;
  } catch {
  }
  function saveSortPref() {
    try {
      localStorage.setItem("revery_sidebar_sort", JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch {
    }
  }
  function sortEntries(entries) {
    const dirs = entries.filter((e) => e.type === "dir");
    const files = entries.filter((e) => e.type === "file");
    function cmp(a, b) {
      if (sortKey === "name") {
        const r = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return sortDir === "asc" ? r : -r;
      }
      const field = sortKey === "modified" ? "mtime" : "ctime";
      const av = a[field] || 0;
      const bv = b[field] || 0;
      return sortDir === "asc" ? av - bv : bv - av;
    }
    dirs.sort(cmp);
    files.sort(cmp);
    return [...dirs, ...files];
  }
  var SORT_OPTIONS = null;
  function getSortOptions() {
    if (!SORT_OPTIONS) {
      SORT_OPTIONS = [
        { group: window.t("Name") },
        { label: window.t("Name A \u2192 Z"), key: "name", dir: "asc" },
        { label: window.t("Name Z \u2192 A"), key: "name", dir: "desc" },
        { group: window.t("Modified") },
        { label: window.t("Newest first"), key: "modified", dir: "desc" },
        { label: window.t("Oldest first"), key: "modified", dir: "asc" },
        { group: window.t("Created") },
        { label: window.t("Newest first"), key: "created", dir: "desc" },
        { label: window.t("Oldest first"), key: "created", dir: "asc" }
      ];
    }
    return SORT_OPTIONS;
  }
  function showSortMenu(anchorEl) {
    const existing = document.getElementById("sidebar-sort-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const menu = document.createElement("div");
    menu.id = "sidebar-sort-menu";
    menu.className = "sidebar-sort-menu";
    getSortOptions().forEach((opt) => {
      if (opt.group !== void 0) {
        if (opt.group !== "Name") {
          const sep = document.createElement("div");
          sep.className = "sidebar-sort-sep";
          menu.appendChild(sep);
        }
        const grp = document.createElement("div");
        grp.className = "sidebar-sort-group";
        grp.textContent = opt.group;
        menu.appendChild(grp);
        return;
      }
      const btn = document.createElement("button");
      btn.className = "sidebar-sort-item";
      const isActive = opt.key === sortKey && opt.dir === sortDir;
      if (isActive) btn.classList.add("sort-active");
      const check = document.createElement("span");
      check.className = "sidebar-sort-check";
      check.textContent = isActive ? "\u2713" : "";
      const label = document.createElement("span");
      label.textContent = opt.label;
      btn.append(check, label);
      btn.addEventListener("click", async () => {
        menu.remove();
        if (sortKey === opt.key && sortDir === opt.dir) return;
        sortKey = opt.key;
        sortDir = opt.dir;
        saveSortPref();
        await renderTree();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    const mw = 200;
    let left = Math.min(rect.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    menu.style.left = left + "px";
    menu.style.top = rect.bottom + 4 + "px";
    setTimeout(() => {
      document.addEventListener("click", function closeSort(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener("click", closeSort);
        }
      });
    }, 0);
  }
  async function expandAllDirs(dirPath, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = await window.NativeAPI.readDirectory(dirPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.type === "dir" && !entry.name.startsWith(".")) {
        expandedDirs.add(entry.path);
        await expandAllDirs(entry.path, depth + 1);
      }
    }
  }
  function collapseAllDirs() {
    expandedDirs.clear();
    if (S.rootPath) expandedDirs.add(S.rootPath);
  }
  function updateToggleAllBtn() {
    if (!btnToggleAll) return;
    const anyExpanded = [...expandedDirs].some((p) => p !== S.rootPath);
    if (anyExpanded) {
      btnToggleAll.textContent = "\u25B4\u25B4";
      btnToggleAll.title = window.t("Collapse all folders");
    } else {
      btnToggleAll.textContent = "\u25BE\u25BE";
      btnToggleAll.title = window.t("Expand all folders");
    }
  }
  function getVisibleItems() {
    return Array.from(treeEl.querySelectorAll(".sidebar-item"));
  }
  function updateMultiSelectHighlight() {
    treeEl.querySelectorAll(".sidebar-item").forEach((el) => {
      el.classList.toggle("multi-selected", selectedItems.has(el.dataset.path));
    });
    treeEl.querySelectorAll(".sidebar-card").forEach((el) => {
      el.classList.toggle("sidebar-card-selected", selectedItems.has(el.dataset.path));
    });
  }
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
      if (type === "dir") {
        S.selectedDirPath = path;
        updateSelectedDirHighlight();
      }
      return;
    }
    if (e.shiftKey && S.selectionAnchor) {
      e.stopPropagation();
      const allPaths = getVisibleItems().map((el) => el.dataset.path);
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
    if (selectedItems.size > 0) {
      selectedItems.clear();
      updateMultiSelectHighlight();
    }
    S.selectionAnchor = path;
    if (type === "dir") {
      S.selectedDirPath = path;
      updateSelectedDirHighlight();
      toggleDir(path, itemEl, containerEl);
    } else {
      openFile(path);
    }
  }
  async function renderNode(containerEl, dirPath, depth, generation = 0) {
    let entries;
    try {
      entries = await window.NativeAPI.readDirectory(dirPath);
    } catch (err) {
      console.warn("[Sidebar] readDirectory failed:", dirPath, err);
      return;
    }
    entries = sortEntries(entries);
    const CHUNK = window.slowHardwareMode ? 40 : 100;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && i % CHUNK === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (_treeRenderGeneration !== generation) return;
      }
      const entry = entries[i];
      if (entry.name.startsWith(".")) continue;
      const itemEl = document.createElement("div");
      const iconEl = document.createElement("span");
      const nameEl = document.createElement("span");
      iconEl.className = "sidebar-icon";
      nameEl.className = "sidebar-name";
      iconEl.draggable = false;
      nameEl.draggable = false;
      nameEl.textContent = entry.name;
      itemEl.className = "sidebar-item";
      itemEl.dataset.path = entry.path;
      itemEl.dataset.type = entry.type;
      if (entry.link) itemEl.dataset.link = "1";
      itemEl.style.paddingLeft = depth * 14 + 10 + "px";
      if (entry.type === "dir") {
        const isExpanded = expandedDirs.has(entry.path);
        iconEl.textContent = isExpanded ? "\u25BE" : "\u25B8";
        itemEl.classList.add("sidebar-dir");
        if (isExpanded) itemEl.classList.add("expanded");
        if (entry.path === S.selectedDirPath) itemEl.classList.add("selected-dir");
        if (selectedItems.has(entry.path)) itemEl.classList.add("multi-selected");
        itemEl.appendChild(iconEl);
        itemEl.appendChild(nameEl);
        containerEl.appendChild(itemEl);
        if (isExpanded) {
          const childrenEl = document.createElement("div");
          childrenEl.className = "sidebar-children";
          childrenEl.dataset.parentPath = entry.path;
          containerEl.appendChild(childrenEl);
          await renderNode(childrenEl, entry.path, depth + 1, generation);
        }
        itemEl.addEventListener("click", (e) => {
          e.stopPropagation();
          handleItemClick(e, entry.path, "dir", itemEl, containerEl);
        });
      } else {
        const category = getFileCategory(entry.name);
        if (entry.link) {
          iconEl.replaceChildren(icon("link"));
          itemEl.classList.add("sidebar-link");
          itemEl.title = window.t("Link");
        } else if (category === "text") {
          iconEl.replaceChildren(icon(entry.name.endsWith(".md") ? "file" : "file-lines"));
        } else if (category === "media") {
          iconEl.replaceChildren(icon("image"));
        } else {
          iconEl.replaceChildren(icon("paperclip"));
        }
        itemEl.classList.add("sidebar-file");
        if (category === "media") itemEl.classList.add("sidebar-media");
        if (category === "other") itemEl.classList.add("sidebar-unsupported");
        if (entry.path === S.activeFilePath) itemEl.classList.add("active");
        if (selectedItems.has(entry.path)) itemEl.classList.add("multi-selected");
        if (S.previewMediaPath === entry.path) {
          itemEl.classList.add("sidebar-media-active");
        }
        itemEl.appendChild(iconEl);
        itemEl.appendChild(nameEl);
        containerEl.appendChild(itemEl);
        itemEl.addEventListener("click", (e) => {
          e.stopPropagation();
          if (category === "text") {
            handleItemClick(e, entry.path, "file", itemEl, containerEl);
          } else if (category === "media") {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleItemClick(e, entry.path, "file", itemEl, containerEl);
            } else {
              selectedItems.clear();
              updateMultiSelectHighlight();
              S.selectionAnchor = entry.path;
              openMediaFile(entry.path);
            }
          } else {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              handleItemClick(e, entry.path, "file", itemEl, containerEl);
            } else {
              selectedItems.clear();
              updateMultiSelectHighlight();
              S.selectionAnchor = entry.path;
              openUnsupportedFile(entry.path);
            }
          }
        });
      }
      itemEl.draggable = true;
      itemEl.addEventListener("dragstart", (e) => {
        if (!selectedItems.has(entry.path)) {
          selectedItems.clear();
          selectedItems.add(entry.path);
          S.selectionAnchor = entry.path;
          updateMultiSelectHighlight();
        }
        S._dragItems = getVisibleItems().filter((el) => selectedItems.has(el.dataset.path)).map((el) => ({ path: el.dataset.path, type: el.dataset.type }));
        setSidebarDragData(e.dataTransfer, S._dragItems);
        requestAnimationFrame(() => {
          treeEl.querySelectorAll(".sidebar-item").forEach((el) => {
            el.classList.toggle("drag-source-active", selectedItems.has(el.dataset.path));
          });
        });
      });
      itemEl.addEventListener("dragend", () => {
        treeEl.querySelectorAll(".drag-source-active, .drop-target").forEach((el) => {
          el.classList.remove("drag-source-active", "drop-target");
        });
        treeEl.classList.remove("drop-target-root");
        S._dragItems = [];
      });
      itemEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, entry.path, entry.type, !!entry.link);
      });
    }
  }
  async function renderTree() {
    if (!S.rootPath) return;
    if (S.sidebarViewMode === "card") {
      const dir = S.cardViewDir || S.rootPath;
      _previewCache.clear();
      await renderCards(dir);
      return;
    }
    const generation = ++_treeRenderGeneration;
    treeEl.classList.remove("sidebar-card-view");
    treeEl.innerHTML = "";
    const loadingEl = document.createElement("div");
    loadingEl.className = "sidebar-loading";
    loadingEl.textContent = "Loading\u2026";
    treeEl.appendChild(loadingEl);
    await renderNode(treeEl, S.rootPath, 0, generation);
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
      itemEl.classList.remove("expanded");
      itemEl.querySelector(".sidebar-icon").textContent = "\u25B8";
    } else {
      expandedDirs.add(dirPath);
      itemEl.classList.add("expanded");
      itemEl.querySelector(".sidebar-icon").textContent = "\u25BE";
      const childrenEl = document.createElement("div");
      childrenEl.className = "sidebar-children";
      childrenEl.dataset.parentPath = dirPath;
      itemEl.insertAdjacentElement("afterend", childrenEl);
      const depth = Math.round((parseInt(itemEl.style.paddingLeft || "10") - 10) / 14) + 1;
      await renderNode(childrenEl, dirPath, depth);
    }
  }
  function updateSelectedDirHighlight() {
    treeEl.querySelectorAll(".sidebar-dir").forEach((el) => {
      el.classList.toggle("selected-dir", el.dataset.path === S.selectedDirPath);
    });
  }
  function showContextMenu(x, y, nodePath, type, isLink = false) {
    const menu = document.getElementById("context-menu");
    if (!menu) return;
    const isMulti = selectedItems.size > 1 && selectedItems.has(nodePath);
    const nodeCategory = type === "file" ? getFileCategory(nodePath.replace(/\\/g, "/").split("/").pop()) : "dir";
    const targets = isMulti ? [...selectedItems].map((p) => ({ path: p, type: itemInfo(p).type })) : [{ path: nodePath, type }];
    const moveItems = [
      { label: window.t("Move to\u2026"), action: () => moveItemsTo(targets) },
      ...moveUpTarget(targets.map((t) => t.path)) ? [{ label: window.t("Move up one level"), action: () => moveItemsUp(targets) }] : []
    ];
    const del = { label: window.t("Delete"), action: () => deleteNode(nodePath, type, isLink), danger: true };
    const explorer = { label: window.t("Show in Explorer"), action: () => window.NativeAPI.showInExplorer(nodePath) };
    const items = isMulti ? [
      { label: window.t("Rename {n} items\u2026").replace("{n}", selectedItems.size), action: () => renameSelectedNodes() },
      ...moveItems,
      { sep: true },
      { label: window.t("Delete {n} items").replace("{n}", selectedItems.size), action: () => deleteSelectedNodes(), danger: true }
    ] : isLink ? [
      { label: window.t("Rename"), action: () => renameNode(nodePath, type) },
      ...moveItems,
      { sep: true },
      explorer,
      del
    ] : type === "dir" ? [
      { label: window.t("New File Here"), action: () => createNewFile(nodePath) },
      { label: window.t("New Folder Here"), action: () => createNewFolder(nodePath) },
      { label: window.t("Rename"), action: () => renameNode(nodePath, "dir") },
      ...moveItems,
      { sep: true },
      explorer,
      del
    ] : nodeCategory === "text" ? [
      { label: window.t("Open"), action: () => openFile(nodePath) },
      { label: window.t("Rename"), action: () => renameNode(nodePath, "file") },
      ...moveItems,
      { sep: true },
      explorer,
      del
    ] : nodeCategory === "media" ? [
      { label: window.t("Preview"), action: () => openMediaFile(nodePath) },
      { label: window.t("Rename"), action: () => renameNode(nodePath, "file") },
      ...moveItems,
      { sep: true },
      explorer,
      del
    ] : (
      /* other/unsupported */
      [
        { label: window.t("Rename"), action: () => renameNode(nodePath, "file") },
        ...moveItems,
        { sep: true },
        explorer,
        del
      ]
    );
    renderContextMenu(x, y, items);
  }
  function renderContextMenu(x, y, items) {
    const menu = document.getElementById("context-menu");
    if (!menu) return;
    menu.innerHTML = "";
    items.forEach((item) => {
      if (item.sep) {
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:var(--border,#3a3a3a);margin:3px 6px;";
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement("button");
      btn.className = "menu-item" + (item.danger ? " menu-danger" : "");
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        menu.style.display = "";
        menu.classList.remove("show");
        item.action();
      });
      menu.appendChild(btn);
    });
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 185;
    const rowCount = items.filter((i) => !i.sep).length;
    const sepCount = items.filter((i) => i.sep).length;
    const mh = rowCount * 32 + sepCount * 7 + 8;
    menu.style.left = Math.min(x, vw - mw - 8) + "px";
    menu.style.top = Math.min(y, vh - mh - 8) + "px";
    menu.style.display = "";
    menu.classList.add("show");
  }
  function showRootContextMenu(x, y) {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return;
    renderContextMenu(x, y, [
      { label: window.t("New File"), action: () => createNewFile(S.rootPath) },
      { label: window.t("New Folder"), action: () => createNewFolder(S.rootPath) },
      { sep: true },
      { label: window.t("Show in Explorer"), action: () => window.NativeAPI.showInExplorer(S.rootPath) }
    ]);
  }
  function highlightActiveFile(filePath) {
    if (S.sidebarViewMode === "card") {
      highlightActiveFileCards(filePath);
      return;
    }
    treeEl.querySelectorAll(".sidebar-file").forEach((el) => {
      el.classList.toggle("active", el.dataset.path === filePath);
    });
  }
  function initTree() {
    if (btnSortBtn) {
      btnSortBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showSortMenu(btnSortBtn);
      });
    }
    if (btnToggleAll) {
      btnToggleAll.addEventListener("click", async () => {
        if (!S.rootPath) return;
        const anyExpanded = [...expandedDirs].some((p) => p !== S.rootPath);
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
    treeEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showRootContextMenu(e.clientX, e.clientY);
    });
    document.addEventListener("click", (e) => {
      const menu = document.getElementById("context-menu");
      if (menu) {
        menu.style.display = "";
        menu.classList.remove("show");
      }
      if (!treeEl.contains(e.target) && selectedItems.size > 0) {
        selectedItems.clear();
        S.selectionAnchor = null;
        updateMultiSelectHighlight();
      }
    });
  }

  // src/sidebar/card_memory.js
  var CARD_DIRS_KEY = "revery_card_view_dirs";
  var MAX_REMEMBERED_PROJECTS = 30;
  function parseCardDirs(raw) {
    let list;
    try {
      list = JSON.parse(raw);
    } catch (_) {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.root === "string" && e.root && typeof e.dir === "string" && e.dir);
  }
  function rememberedCardDir(list, root) {
    if (!root || !Array.isArray(list)) return null;
    const key = pathKey(root);
    const hit = list.find((e) => pathKey(e.root) === key);
    return hit && isInsideRoot(hit.dir, root) ? hit.dir : null;
  }
  function withCardDir(list, root, dir) {
    const key = pathKey(root);
    const rest = (Array.isArray(list) ? list : []).filter((e) => pathKey(e.root) !== key);
    return [{ root, dir }, ...rest].slice(0, MAX_REMEMBERED_PROJECTS);
  }

  // src/sidebar/cards.js
  var _cardGeneration = 0;
  function loadCardDirs() {
    try {
      return parseCardDirs(localStorage.getItem(CARD_DIRS_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }
  function rememberCardDir(root, dir) {
    if (!root || !dir || !isInsideRoot(dir, root)) return;
    const list = loadCardDirs();
    if (rememberedCardDir(list, root) === dir) return;
    try {
      localStorage.setItem(CARD_DIRS_KEY, JSON.stringify(withCardDir(list, root, dir)));
    } catch (_) {
    }
  }
  function restoreCardViewDir(root) {
    if (!root) return;
    const sel = S.selectedDirPath && isInsideRoot(S.selectedDirPath, root) ? S.selectedDirPath : null;
    S.cardViewDir = rememberedCardDir(loadCardDirs(), root) || sel || root;
    if (S.sidebarViewMode === "card") S.selectedDirPath = S.cardViewDir;
  }
  var CARD_SIZE_STEPS = [60, 80, 110, 145, 185];
  var cardSizeIdx = 1;
  try {
    const _savedIdx = parseInt(localStorage.getItem("revery_card_size_idx"), 10);
    if (!isNaN(_savedIdx) && _savedIdx >= 0 && _savedIdx < CARD_SIZE_STEPS.length) {
      cardSizeIdx = _savedIdx;
    }
  } catch {
  }
  function applyCardSize() {
    const grid = treeEl.querySelector(".sidebar-cards-grid");
    if (grid) {
      grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${CARD_SIZE_STEPS[cardSizeIdx]}px, 1fr))`;
    }
    const btnSmaller = document.getElementById("sidebar-card-smaller");
    const btnLarger = document.getElementById("sidebar-card-larger");
    if (btnSmaller) btnSmaller.disabled = cardSizeIdx === 0;
    if (btnLarger) btnLarger.disabled = cardSizeIdx === CARD_SIZE_STEPS.length - 1;
  }
  async function loadCardPreview(filePath, previewEl, generation) {
    if (_previewCache.has(filePath)) {
      if (_cardGeneration !== generation) return;
      previewEl.textContent = _previewCache.get(filePath);
      return;
    }
    let content;
    try {
      content = await window.NativeAPI.readFile(filePath);
    } catch {
      return;
    }
    if (_cardGeneration !== generation) return;
    const preview = stripMarkdownForPreview(content).substring(0, 440);
    _previewCache.set(filePath, preview);
    if (_cardGeneration !== generation) return;
    previewEl.textContent = preview;
  }
  function buildCard(entry, generation) {
    const category = entry.type === "dir" ? "dir" : getFileCategory(entry.name);
    const isActive = entry.path === S.activeFilePath;
    const isMediaPrev = S.previewMediaPath === entry.path;
    const card = document.createElement("div");
    card.className = "sidebar-card";
    card.dataset.path = entry.path;
    card.dataset.type = entry.type;
    if (entry.link) {
      card.dataset.link = "1";
      card.title = entry.name + " \u2014 " + window.t("Link");
    }
    if (entry.type === "dir") card.classList.add("sidebar-card-dir");
    else if (category === "media") card.classList.add("sidebar-card-media");
    else if (category === "other") card.classList.add("sidebar-card-other");
    else if (category === "text") card.classList.add("sidebar-card-text");
    if (isActive || isMediaPrev) card.classList.add("sidebar-card-active");
    const thumb = document.createElement("div");
    thumb.className = "sidebar-card-thumb";
    if (entry.type === "dir") {
      thumb.replaceChildren(icon("folder"));
    } else if (entry.link) {
      thumb.replaceChildren(icon("link"));
    } else if (category === "media" && window.slowHardwareMode) {
      thumb.replaceChildren(icon("image"));
    } else if (category === "media") {
      const img = document.createElement("img");
      img.draggable = false;
      img.alt = entry.name;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      try {
        img.src = window.NativeAPI.toMediaUrl(entry.path);
      } catch {
        thumb.replaceChildren(icon("image"));
      }
      img.onerror = () => {
        thumb.replaceChildren(icon("image"));
      };
      thumb.appendChild(img);
    } else if (category === "text") {
      thumb.replaceChildren(icon(entry.name.endsWith(".md") ? "file" : "file-lines"));
    } else {
      thumb.style.cssText += "opacity:0.4;";
      thumb.textContent = "?";
    }
    const body = document.createElement("div");
    body.className = "sidebar-card-body";
    const titleEl = document.createElement("div");
    titleEl.className = "sidebar-card-title";
    titleEl.textContent = category === "text" ? entry.name.replace(/\.(md|txt)$/i, "") : entry.name;
    titleEl.title = entry.name;
    const previewEl = document.createElement("div");
    previewEl.className = "sidebar-card-preview";
    if (category === "text" && !entry.link && !window.slowHardwareMode) {
      loadCardPreview(entry.path, previewEl, generation);
    } else if (entry.type === "dir") {
      previewEl.textContent = window.t("Folder");
      previewEl.style.fontStyle = "italic";
    }
    body.append(titleEl, previewEl);
    card.append(thumb, body);
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        if (e.ctrlKey || e.metaKey) {
          if (selectedItems.has(entry.path)) selectedItems.delete(entry.path);
          else {
            selectedItems.add(entry.path);
            S.selectionAnchor = entry.path;
          }
        } else if (e.shiftKey && S.selectionAnchor) {
          const allPaths = Array.from(treeEl.querySelectorAll(".sidebar-card")).map((el) => el.dataset.path);
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
        if (entry.type === "dir") S.selectedDirPath = entry.path;
        return;
      }
      if (selectedItems.size > 0) {
        selectedItems.clear();
        updateMultiSelectHighlight();
      }
      S.selectionAnchor = entry.path;
      if (entry.type === "dir") {
        S.cardViewDir = entry.path;
        _previewCache.clear();
        S.selectedDirPath = entry.path;
        renderCards(entry.path);
      } else if (category === "text") {
        openFile(entry.path);
      } else if (category === "media") {
        openMediaFile(entry.path);
      } else {
        openUnsupportedFile(entry.path);
      }
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, entry.path, entry.type, !!entry.link);
    });
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      if (!selectedItems.has(entry.path)) {
        selectedItems.clear();
        selectedItems.add(entry.path);
        S.selectionAnchor = entry.path;
        updateMultiSelectHighlight();
      }
      S._dragItems = Array.from(treeEl.querySelectorAll(".sidebar-card")).filter((el) => selectedItems.has(el.dataset.path)).map((el) => ({ path: el.dataset.path, type: el.dataset.type }));
      setSidebarDragData(e.dataTransfer, S._dragItems);
      requestAnimationFrame(() => {
        treeEl.querySelectorAll(".sidebar-card").forEach((el) => {
          el.classList.toggle("drag-source-active", selectedItems.has(el.dataset.path));
        });
      });
    });
    card.addEventListener("dragend", () => {
      treeEl.querySelectorAll(".drag-source-active, .drop-target").forEach((el) => {
        el.classList.remove("drag-source-active", "drop-target");
      });
      treeEl.classList.remove("drop-target-root");
      S._dragItems = [];
    });
    return card;
  }
  function pathSegments(dirPath) {
    const root = S.rootPath;
    const segs = [{ path: root, label: baseNameOf(root) || root }];
    if (!root || samePath(dirPath, root) || !isInsideRoot(dirPath, root)) return segs;
    const start = normalizePath(root).length;
    for (let i = start + 1; i <= dirPath.length; i++) {
      if (i === dirPath.length || dirPath[i] === "/" || dirPath[i] === "\\") {
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
    const navEl = document.createElement("div");
    navEl.className = "sidebar-card-nav sidebar-card-path";
    const segs = pathSegments(dirPath);
    segs.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sidebar-card-sep";
        sep.textContent = "\u203A";
        navEl.appendChild(sep);
      }
      if (i === segs.length - 1) {
        const cur = document.createElement("span");
        cur.className = "sidebar-card-crumb";
        cur.textContent = seg.label;
        cur.title = seg.path;
        navEl.appendChild(cur);
      } else {
        const b = document.createElement("button");
        b.className = "sidebar-card-seg";
        b.textContent = seg.label;
        b.title = window.t('Go to "{name}" \u2014 or drop items here to move them there').replace("{name}", seg.label);
        b.dataset.dropDir = seg.path;
        b.addEventListener("click", () => navigateTo(seg.path));
        navEl.appendChild(b);
      }
    });
    return navEl;
  }
  function buildCompactNav(dirPath) {
    const navEl = document.createElement("div");
    navEl.className = "sidebar-card-nav";
    const atRoot = !S.rootPath || samePath(dirPath, S.rootPath) || !isInsideRoot(dirPath, S.rootPath);
    if (!atRoot) {
      const parent = parentPathOf(dirPath);
      const backBtn = document.createElement("button");
      backBtn.className = "sidebar-card-back";
      backBtn.textContent = "\u2190 " + window.t("Back");
      backBtn.title = window.t("Go up one level \u2014 or drop items here to move them there");
      backBtn.dataset.dropDir = parent;
      backBtn.addEventListener("click", () => navigateTo(parent));
      navEl.appendChild(backBtn);
    }
    const crumbEl = document.createElement("span");
    crumbEl.className = "sidebar-card-crumb";
    crumbEl.textContent = baseNameOf(dirPath) || dirPath;
    crumbEl.title = dirPath;
    navEl.appendChild(crumbEl);
    return navEl;
  }
  var _navDir = null;
  function buildNav(dirPath) {
    _navDir = dirPath;
    return buildPathBar(dirPath);
  }
  function fitNav() {
    const nav = treeEl.querySelector(".sidebar-card-nav");
    if (!nav || !_navDir) return;
    let bar = nav;
    if (!bar.classList.contains("sidebar-card-path")) {
      bar = buildPathBar(_navDir);
      nav.replaceWith(bar);
    }
    if (bar.scrollWidth > bar.clientWidth + 1) bar.replaceWith(buildCompactNav(_navDir));
  }
  var _navObserver = null;
  var _navLastWidth = -1;
  function observeNavWidth() {
    if (_navObserver || typeof ResizeObserver !== "function") return;
    _navObserver = new ResizeObserver(() => {
      if (S.sidebarViewMode !== "card") return;
      const w = treeEl.clientWidth;
      if (w === _navLastWidth) return;
      _navLastWidth = w;
      fitNav();
    });
    _navObserver.observe(treeEl);
  }
  async function renderCards(dirPath) {
    if (!dirPath) return;
    if (S.rootPath && !isInsideRoot(dirPath, S.rootPath)) {
      dirPath = S.rootPath;
      S.cardViewDir = dirPath;
    }
    const generation = ++_cardGeneration;
    const root = S.rootPath;
    treeEl.innerHTML = "";
    treeEl.scrollTop = 0;
    treeEl.classList.add("sidebar-card-view");
    treeEl.appendChild(buildNav(dirPath));
    fitNav();
    const loadingEl = document.createElement("div");
    loadingEl.className = "sidebar-loading";
    loadingEl.textContent = window.t("Loading\u2026");
    treeEl.appendChild(loadingEl);
    let entries;
    try {
      entries = await window.NativeAPI.readDirectory(dirPath);
    } catch (err) {
      console.warn("[Sidebar] renderCards readDirectory failed:", dirPath, err);
      if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);
      const up = parentPathOf(dirPath);
      if (_cardGeneration === generation && root && S.rootPath === root && !samePath(dirPath, root) && up && isInsideRoot(up, root)) {
        if (samePath(S.cardViewDir, dirPath)) S.cardViewDir = up;
        if (S.selectedDirPath && isInsideRoot(S.selectedDirPath, dirPath)) S.selectedDirPath = up;
        return renderCards(up);
      }
      return;
    }
    if (_cardGeneration !== generation) return;
    if (S.rootPath === root) rememberCardDir(root, dirPath);
    if (treeEl.contains(loadingEl)) treeEl.removeChild(loadingEl);
    entries = sortEntries(entries).filter((e) => !e.name.startsWith("."));
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sidebar-loading";
      empty.textContent = window.t("Empty folder");
      treeEl.appendChild(empty);
      return;
    }
    const gridEl = document.createElement("div");
    gridEl.className = "sidebar-cards-grid";
    for (const entry of entries) {
      gridEl.appendChild(buildCard(entry, generation));
    }
    treeEl.appendChild(gridEl);
    treeEl.scrollTop = 0;
    applyCardSize();
    highlightActiveFileCards(S.activeFilePath);
    updateMultiSelectHighlight();
  }
  function highlightActiveFileCards(filePath) {
    treeEl.querySelectorAll(".sidebar-card").forEach((card) => {
      card.classList.toggle("sidebar-card-active", card.dataset.path === filePath);
    });
  }
  function updateViewBtn() {
    if (!btnViewBtn) return;
    const isCard = S.sidebarViewMode === "card";
    if (btnToggleAll) btnToggleAll.style.display = isCard ? "none" : "";
    if (btnSortBtn) btnSortBtn.style.display = isCard ? "none" : "";
    const btnSmaller = document.getElementById("sidebar-card-smaller");
    const btnLarger = document.getElementById("sidebar-card-larger");
    if (btnSmaller) btnSmaller.style.display = isCard ? "" : "none";
    if (btnLarger) btnLarger.style.display = isCard ? "" : "none";
    if (isCard) {
      btnViewBtn.replaceChildren(icon("view-list"));
      btnViewBtn.title = window.t("Switch to list view");
    } else {
      btnViewBtn.replaceChildren(icon("view-cards"));
      btnViewBtn.title = window.t("Switch to card view");
    }
  }
  async function setViewMode(mode) {
    S.sidebarViewMode = mode;
    try {
      localStorage.setItem("revery_sidebar_view", mode);
    } catch {
    }
    updateViewBtn();
    const isCard = mode === "card";
    if (btnToggleAll) btnToggleAll.style.display = isCard ? "none" : "";
    if (btnSortBtn) btnSortBtn.style.display = isCard ? "none" : "";
    const _btnSmaller = document.getElementById("sidebar-card-smaller");
    const _btnLarger = document.getElementById("sidebar-card-larger");
    if (_btnSmaller) _btnSmaller.style.display = isCard ? "" : "none";
    if (_btnLarger) _btnLarger.style.display = isCard ? "" : "none";
    if (mode === "card") {
      S.cardViewDir = S.selectedDirPath || S.rootPath;
      _previewCache.clear();
      _cardGeneration++;
      await renderCards(S.cardViewDir);
    } else {
      treeEl.classList.remove("sidebar-card-view");
      _cardGeneration++;
      await renderTree();
    }
  }
  function initCardView() {
    observeNavWidth();
    if (btnViewBtn) {
      btnViewBtn.addEventListener("click", async () => {
        await setViewMode(S.sidebarViewMode === "card" ? "tree" : "card");
      });
      updateViewBtn();
    }
    (function() {
      const btnSmaller = document.getElementById("sidebar-card-smaller");
      const btnLarger = document.getElementById("sidebar-card-larger");
      if (btnSmaller) {
        btnSmaller.addEventListener("click", () => {
          if (cardSizeIdx > 0) {
            cardSizeIdx--;
            try {
              localStorage.setItem("revery_card_size_idx", cardSizeIdx);
            } catch {
            }
            applyCardSize();
          }
        });
      }
      if (btnLarger) {
        btnLarger.addEventListener("click", () => {
          if (cardSizeIdx < CARD_SIZE_STEPS.length - 1) {
            cardSizeIdx++;
            try {
              localStorage.setItem("revery_card_size_idx", cardSizeIdx);
            } catch {
            }
            applyCardSize();
          }
        });
      }
    })();
  }

  // src/sidebar/block_insert.js
  function paragraphInsertion(before, after, block) {
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after.startsWith("\n\n") ? "" : after === "" || after.startsWith("\n") ? "\n" : "\n\n";
    return { insert: lead + block + trail, cursor: lead.length + block.length + 1 };
  }

  // src/sidebar/media_ingest.js
  var DROP_MAX_BYTES = 20 * 1024 * 1024;
  var sourceName = (src) => src.kind === "file" ? src.file.name : baseNameOf(src.path);
  var isMediaSource = (src) => getFileCategory(sourceName(src)) === "media";
  var filesToSources = (files) => Array.from(files || []).map((file) => ({ kind: "file", file }));
  var pathsToSources = (paths) => (paths || []).map((path) => ({ kind: "path", path }));
  async function copySources(sources, targetDir) {
    const finals = [];
    const errors = [];
    for (const src of sources) {
      const label = sourceName(src);
      try {
        let res;
        if (src.kind === "file") {
          if (src.file.size > DROP_MAX_BYTES) {
            errors.push(`${label}: too large (${(src.file.size / 1024 / 1024).toFixed(1)} MB, max 20 MB)`);
            continue;
          }
          let b64;
          try {
            b64 = arrayBufferToBase64(await src.file.arrayBuffer());
          } catch (_) {
            errors.push(`${label}: could not read (folders can't be dropped here)`);
            continue;
          }
          res = await window.NativeAPI.copyFileIntoFolder(targetDir, src.file.name, b64);
        } else {
          res = await window.NativeAPI.copyPathIntoFolder(src.path, targetDir);
        }
        finals.push(res.path);
      } catch (err) {
        errors.push(`${label}: ${err && err.message || err}`);
      }
    }
    return { finals, errors };
  }
  async function withOperationLock(fn) {
    if (S._operationLock) {
      if (typeof window.showStatusWarning === "function") {
        window.showStatusWarning("fs-busy", window.t("Busy \u2014 try again in a moment."), { priority: 5, ttl: 2500 });
      }
      return false;
    }
    S._operationLock = true;
    try {
      await fn();
      return true;
    } finally {
      S._operationLock = false;
    }
  }
  function reportCopyIssues(errors, messageKey) {
    if (!errors.length) return;
    window.NativeAPI.showMessageBox({
      type: "warning",
      title: window.t("Copy Issues"),
      message: window.t(messageKey).replace("{n}", errors.length),
      detail: errors.join("\n")
    }).catch(() => {
    });
  }
  function copyIntoFolder(sources, targetDir) {
    if (!sources.length || !targetDir) return Promise.resolve(false);
    return withOperationLock(async () => {
      const { finals, errors } = await copySources(sources, targetDir);
      if (finals.length) {
        expandedDirs.add(targetDir);
        await renderTree();
      }
      reportCopyIssues(errors, "{n} file(s) could not be copied:");
    });
  }
  function docPosAtClient(x, y) {
    try {
      const pos = window.cmView.posAtCoords({ x, y });
      if (pos != null) return pos;
    } catch (_) {
    }
    return editor.selectionStart;
  }
  function dropTargetAt(x, y) {
    const lpPos = typeof window.livePreviewDropPos === "function" ? window.livePreviewDropPos(x, y) : null;
    if (lpPos != null) return { pos: lpPos, paragraph: true };
    return { pos: docPosAtClient(x, y), paragraph: false };
  }
  function insertAtTarget(target, links) {
    if (!target.paragraph) {
      window.insertWithUndo(target.pos, target.pos, links + "\n");
      return;
    }
    const doc = window.cmView.state.doc;
    const pos = Math.max(0, Math.min(target.pos, doc.length));
    const { insert, cursor } = paragraphInsertion(
      doc.sliceString(Math.max(0, pos - 2), pos),
      doc.sliceString(pos, pos + 2),
      links
    );
    window.insertWithUndo(pos, pos, insert, pos + cursor);
  }
  function ingestMediaAt(sources, from, to = from) {
    return ingestMedia(sources, { from, to, paragraph: false });
  }
  function ingestMediaAtDrop(sources, target) {
    return ingestMedia(sources, { from: target.pos, to: target.pos, paragraph: target.paragraph });
  }
  function tellLinksNotInserted(finals) {
    if (typeof window.showStatusWarning !== "function") return;
    window.showStatusWarning(
      "media-link-skipped",
      window.t("Added {names} to the project. The note it was dropped on is no longer open, so no link was inserted.").replace("{names}", finals.map(baseNameOf).join(", ")),
      { priority: 30, ttl: 8e3 }
    );
  }
  function ingestMedia(sources, where) {
    const media = sources.filter(isMediaSource);
    if (!media.length) {
      if (sources.length) explainNonMediaDrop();
      return Promise.resolve(false);
    }
    const dir = pendingNoteDir();
    if (!dir) {
      window.NativeAPI.showMessageBox({
        type: "info",
        title: window.t("Add media"),
        message: window.t("Open a project folder first.")
      }).catch(() => {
      });
      return Promise.resolve(false);
    }
    return withOperationLock(async () => {
      const anchor = window.anchorEditorRange(where.from, where.to);
      try {
        const { finals, errors } = await copySources(media, dir);
        if (finals.length) {
          const links = finals.map((p) => mediaMarkdown(p, dir)).join("\n");
          const at = anchor.take();
          if (!at) tellLinksNotInserted(finals);
          else if (where.paragraph) insertAtTarget({ pos: at.from, paragraph: true }, links);
          else window.insertWithUndo(at.from, at.to, links + "\n");
          expandedDirs.add(dir);
          await renderTree();
        }
        reportCopyIssues(errors, "{n} file(s) could not be added:");
      } finally {
        anchor.release();
      }
    });
  }
  function insertSidebarItems(dataTransfer, target) {
    const media = decodeSidebarPayload(dataTransfer.getData(SIDEBAR_ITEM_MIME)).filter((p) => getFileCategory(baseNameOf(p)) === "media");
    if (!media.length) return;
    insertAtTarget(target, media.map((p) => mediaMarkdown(p)).join("\n"));
  }
  function explainNonMediaDrop() {
    if (typeof window.showStatusWarning === "function") {
      window.showStatusWarning(
        "editor-drop",
        window.t("Only images can be dropped into a note. Drop other files on the file panel to copy them into the project."),
        { priority: 5, ttl: 5e3 }
      );
    }
  }
  function extFromMime(type) {
    const map = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/bmp": "bmp"
    };
    return map[type] || "png";
  }
  function pastedImageName(type) {
    const d = /* @__PURE__ */ new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    return `Pasted image ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${extFromMime(type)}`;
  }
  function initMediaIngest() {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
    const dom = window.cmView && window.cmView.dom;
    if (!dom) return;
    const transport = fileDropTransport();
    dom.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = Array.from(dt.types || []);
      if (types.includes(SIDEBAR_ITEM_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        insertSidebarItems(dt, dropTargetAt(e.clientX, e.clientY));
        return;
      }
      if (!isOsFileDrop(dt)) return;
      e.preventDefault();
      e.stopPropagation();
      if (transport !== "dom") return;
      ingestMediaAtDrop(filesToSources(dt.files), dropTargetAt(e.clientX, e.clientY));
    }, true);
    dom.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const images = Array.from(items).filter((it) => it.kind === "file" && it.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      e.stopPropagation();
      const files = images.map((it) => {
        const f = it.getAsFile();
        return f ? new File([f], pastedImageName(f.type || it.type), { type: f.type }) : null;
      }).filter(Boolean);
      ingestMediaAt(filesToSources(files), editor.selectionStart, editor.selectionEnd);
    }, true);
  }

  // src/sidebar/dnd.js
  function getDropTargetDir(eventTarget) {
    const navTarget = eventTarget.closest && eventTarget.closest("[data-drop-dir]");
    if (navTarget) {
      const dir = navTarget.dataset.dropDir;
      return dir && S.rootPath && isInsideRoot(dir, S.rootPath) ? dir : null;
    }
    const dirCard = eventTarget.closest(".sidebar-card-dir");
    if (dirCard && !selectedItems.has(dirCard.dataset.path)) {
      return dirCard.dataset.path;
    }
    const dirRow = eventTarget.closest(".sidebar-dir");
    if (dirRow && !selectedItems.has(dirRow.dataset.path)) {
      return dirRow.dataset.path;
    }
    const childrenContainer = eventTarget.closest(".sidebar-children");
    if (childrenContainer && childrenContainer.dataset.parentPath) {
      const parentPath = childrenContainer.dataset.parentPath;
      if (!selectedItems.has(parentPath)) return parentPath;
    }
    if (S.sidebarViewMode === "card") {
      return S.cardViewDir || S.rootPath;
    }
    return S.rootPath;
  }
  function getDropTargetEl(eventTarget) {
    const navTarget = eventTarget.closest && eventTarget.closest("[data-drop-dir]");
    if (navTarget) return getDropTargetDir(eventTarget) ? navTarget : null;
    const dirPath = getDropTargetDir(eventTarget);
    if (!dirPath || dirPath === S.rootPath || S.sidebarViewMode === "card" && dirPath === S.cardViewDir) return null;
    if (S.sidebarViewMode === "card") {
      return treeEl.querySelector(`.sidebar-card-dir[data-path="${CSS.escape(dirPath)}"]`);
    }
    return treeEl.querySelector(`.sidebar-dir[data-path="${CSS.escape(dirPath)}"]`);
  }
  function clearDropHighlights() {
    treeEl.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    treeEl.classList.remove("drop-target-root");
  }
  function initDnd() {
    const transport = fileDropTransport();
    treeEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = S._dragItems.length ? "move" : "copy";
      clearDropHighlights();
      const targetEl = getDropTargetEl(e.target);
      if (targetEl) {
        targetEl.classList.add("drop-target");
      } else {
        const targetPath = getDropTargetDir(e.target);
        if (targetPath === S.rootPath) treeEl.classList.add("drop-target-root");
      }
    });
    treeEl.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && treeEl.contains(e.relatedTarget)) return;
      clearDropHighlights();
    });
    treeEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetDir = getDropTargetDir(e.target);
      clearDropHighlights();
      if (!targetDir) {
        S._dragItems = [];
        return;
      }
      if (S._dragItems.length) {
        const itemsToMove = [...S._dragItems];
        S._dragItems = [];
        await moveNodes(itemsToMove, targetDir);
        return;
      }
      if (isOsFileDrop(e.dataTransfer) && transport === "dom") {
        await copyIntoFolder(filesToSources(e.dataTransfer.files), targetDir);
      }
    });
    treeEl.addEventListener("click", (e) => {
      if (!e.target.closest(".sidebar-item") && !e.target.closest(".sidebar-card") && selectedItems.size > 0) {
        selectedItems.clear();
        S.selectionAnchor = null;
        updateMultiSelectHighlight();
      }
    });
    (function installGlobalFileDropGuard() {
      ["dragenter", "dragover"].forEach((type) => {
        window.addEventListener(type, (e) => {
          e.preventDefault();
        });
      });
      window.addEventListener("drop", (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("input, textarea") && !isOsFileDrop(e.dataTransfer)) return;
        e.preventDefault();
      });
    })();
    (function installNativeFileDrop() {
      if (transport !== "native" || !window.NativeAPI || window.NativeAPI.env !== "tauri") return;
      const toClient = (pos) => {
        const dpr = window.devicePixelRatio || 1;
        return { x: pos.x / dpr, y: pos.y / dpr };
      };
      const pointToTarget = (pos) => {
        if (!pos) return null;
        const { x, y } = toClient(pos);
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest || !el.closest("#sidebar-tree")) return null;
        return { el, dir: getDropTargetDir(el) };
      };
      window.NativeAPI.onNativeFileDrop({
        onOver: (pos) => {
          clearDropHighlights();
          const hit = pointToTarget(pos);
          if (!hit) return;
          const targetEl = getDropTargetEl(hit.el);
          if (targetEl) targetEl.classList.add("drop-target");
          else if (hit.dir === S.rootPath) treeEl.classList.add("drop-target-root");
        },
        onLeave: clearDropHighlights,
        onDrop: (pos, paths) => {
          clearDropHighlights();
          if (!paths || !paths.length || !pos) return;
          const hit = pointToTarget(pos);
          if (hit) {
            copyIntoFolder(pathsToSources(paths), hit.dir);
            return;
          }
          const { x, y } = toClient(pos);
          const el = document.elementFromPoint(x, y);
          if (el && el.closest && el.closest("#editor")) {
            ingestMediaAtDrop(pathsToSources(paths), dropTargetAt(x, y));
          }
        }
      }).catch(() => {
      });
    })();
  }

  // src/sidebar/lifecycle.js
  var CLOSE_STUCK_MS = 5e3;
  var _closing = null;
  async function sidebarHandleClose() {
    if (_closing) {
      const saving = _closing.savingSince ? Date.now() - _closing.savingSince : 0;
      if (saving >= CLOSE_STUCK_MS) {
        throw new Error(`Still saving the open note before closing (for ${Math.round(saving / 1e3)} s).`);
      }
      return;
    }
    const closing = _closing = { savingSince: 0 };
    const whileSaving = async (work) => {
      closing.savingSince = Date.now();
      const notice = setTimeout(() => {
        if (typeof window.showStatusWarning === "function") {
          window.showStatusWarning(
            "closing",
            window.t("Saving the open note before closing\u2026 If this takes too long, close again."),
            { priority: 90 }
          );
        }
      }, 1e3);
      try {
        return await work();
      } finally {
        clearTimeout(notice);
        closing.savingSince = 0;
        if (typeof window.clearStatusWarning === "function") window.clearStatusWarning("closing");
      }
    };
    try {
      await handleCloseRequest(whileSaving);
    } finally {
      _closing = null;
    }
  }
  async function handleCloseRequest(whileSaving) {
    cancelPendingAutoSave();
    if (S.activeFilePath) {
      if (S.isDirty) {
        let saved = false;
        let outcome = null;
        for (let attempt = 0; attempt < 3 && S.isDirty; attempt++) {
          try {
            saved = await whileSaving(() => saveActiveFile({ onOutcome: (o) => {
              outcome = o;
            } }));
          } catch (err) {
            console.error("[sidebarHandleClose] Save threw unexpectedly:", err);
            saved = false;
          }
          if (!saved) break;
        }
        if (!saved) {
          if (S.isDirty && typeof window.NativeAPI.writeVolatileNow === "function") {
            try {
              await whileSaving(() => window.NativeAPI.writeVolatileNow(S.activeFilePath, editor.value, noteBackupBase()));
            } catch (_) {
            }
          }
          if (outcome === "deferred-verify") return;
          const baseName = baseNameOf(S.activeFilePath || "") || "this note";
          let proceedWithClose = false;
          try {
            const choice = await window.NativeAPI.showMessageBox({
              type: "warning",
              title: "Unsaved Changes",
              message: `Could not save "${baseName}". Closing now will discard your changes.`,
              detail: "Cancel to keep the window open so you can copy your work elsewhere or fix the underlying problem (e.g. free up disk space, unlock the file).",
              buttons: ["Discard and Quit", "Cancel"],
              defaultId: 1,
              cancelId: 1
            });
            proceedWithClose = choice.response === 0;
          } catch (dialogErr) {
            console.error("[sidebarHandleClose] discard-confirmation dialog failed:", dialogErr);
            proceedWithClose = false;
          }
          if (!proceedWithClose) {
            return;
          }
        }
      }
      if (S.isDirty && typeof window.NativeAPI.writeVolatileNow === "function") {
        try {
          await whileSaving(() => window.NativeAPI.writeVolatileNow(S.activeFilePath, editor.value, noteBackupBase()));
        } catch (_) {
        }
      }
      window.isQuitting = true;
      window.NativeAPI.confirmClose();
      return;
    }
    if (editor.value.trim().length > 0) {
      if (typeof openQuitModal === "function") {
        openQuitModal();
        return;
      }
      window.isQuitting = true;
      window.NativeAPI.confirmClose();
      return;
    }
    window.isQuitting = true;
    window.NativeAPI.confirmClose();
  }
  function initCloseHandler() {
    window.sidebarHandleClose = sidebarHandleClose;
    window.NativeAPI.onWindowClose(sidebarHandleClose);
  }
  async function reconcilePendingRename(journal, lastFile) {
    if (!journal) return lastFile;
    let result = lastFile;
    let keepJournal = false;
    try {
      if (typeof journal.from === "string" && typeof journal.to === "string" && lastFile === journal.from) {
        const fromExists = await fileExistsViaListing(journal.from);
        const toExists = fromExists === false ? await fileExistsViaListing(journal.to) : null;
        if (fromExists === null || fromExists === false && toExists === null) {
          keepJournal = true;
        } else if (fromExists === false && toExists === true) {
          console.info("[Sidebar Boot] Reconciling pending rename: %s \u2192 %s", journal.from, journal.to);
          result = journal.to;
          try {
            await window.NativeAPI.setLastOpenedFile(journal.to);
          } catch (e) {
            console.warn("[Sidebar Boot] Could not persist reconciled lastOpenedFile:", e);
            keepJournal = true;
          }
        }
      }
    } catch (e) {
      console.warn("[Sidebar Boot] Pending-rename reconciliation failed (non-fatal):", e);
      keepJournal = true;
    }
    if (!keepJournal && typeof window.NativeAPI.setPendingRename === "function") {
      window.NativeAPI.setPendingRename(null).catch((e) => console.warn("[Sidebar Boot] Could not clear rename journal:", e));
    }
    return result;
  }
  async function recoverScratchpadBackups() {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
    if (typeof window.NativeAPI.listVolatileBackups !== "function") {
      return;
    }
    let backups = [];
    try {
      backups = await window.NativeAPI.listVolatileBackups(SCRATCHPAD_PREFIX);
    } catch (e) {
      console.warn("[Sidebar Boot] Scratchpad backup scan failed (non-fatal):", e);
      return;
    }
    if (!Array.isArray(backups)) return;
    for (const info of backups) {
      if (!info || typeof info.originalPath !== "string") continue;
      if (info.originalPath === S._scratchpadVolatileKey) continue;
      let backup = null;
      try {
        backup = await window.NativeAPI.getVolatileContent(info.originalPath);
      } catch (_) {
      }
      if (!backup || typeof backup.content !== "string") continue;
      if (backup.content.trim().length === 0) {
        window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {
        });
        continue;
      }
      const ts = new Date(backup.ts || info.ts || Date.now()).toLocaleString();
      let choice;
      try {
        choice = await window.NativeAPI.showMessageBox({
          type: "question",
          title: window.t("Recover unsaved text?"),
          message: window.t("Text typed in a previous session was never saved to a file."),
          detail: `${window.t("Last edited:")} ${ts}

` + window.t("\u201CRecover\u201D writes it into a new file in your project. \u201CDiscard\u201D deletes the backup permanently. \u201CNot now\u201D keeps the backup and asks again next time."),
          buttons: [window.t("Recover"), window.t("Discard"), window.t("Not now")],
          defaultId: 0,
          // Recover — safe default: creates a new file
          cancelId: 2
          // Escape → Not now — never destructive
        });
      } catch (e) {
        console.warn("[Sidebar Boot] Recovery dialog failed (non-fatal):", e);
        return;
      }
      if (choice.response === 2) return;
      if (choice.response === 1) {
        await window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {
        });
        return;
      }
      const dir = S.selectedDirPath || S.rootPath;
      if (!dir) {
        if (typeof window.replaceEditorContent === "function") {
          window.replaceEditorContent(backup.content);
        } else {
          editor.value = backup.content;
          if (typeof render === "function") render();
          if (typeof countWords === "function") countWords();
        }
        S._scratchpadVolatileKey = info.originalPath;
        return;
      }
      try {
        let newPath = null;
        let created = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          newPath = await uniquePath(dir, "recovered", "md");
          try {
            await window.NativeAPI.createFile(newPath);
            created = true;
            break;
          } catch (err) {
            if (String(err).includes("already exists") && attempt < 4) continue;
            throw err;
          }
        }
        if (!created) throw new Error("Could not allocate a unique filename.");
        await window.NativeAPI.writeFile(newPath, backup.content);
        await window.NativeAPI.deleteVolatileContent(info.originalPath).catch(() => {
        });
        expandedDirs.add(dir);
        await renderTree();
        await openFile(newPath);
      } catch (err) {
        console.error("[Sidebar Boot] Scratchpad recovery failed:", err);
        window.NativeAPI.showMessageBox({
          type: "error",
          title: window.t("Recovery Failed"),
          message: window.t("The recovered text could not be written to a new file."),
          detail: String(err) + "\n\n" + window.t("The backup was kept. You will be asked again on the next start."),
          buttons: ["OK"],
          defaultId: 0
        }).catch(() => {
        });
      }
      return;
    }
  }
  async function saveBackupBesideNote(notePath, content) {
    let copyPath;
    try {
      copyPath = await saveTextBesideNote(notePath, content, "_recovered");
    } catch (err) {
      console.error("[Sidebar Boot] Saving the crash backup as a separate file failed:", err);
      await window.NativeAPI.showMessageBox({
        type: "error",
        title: window.t("Recovery Failed"),
        message: "The unsaved changes could not be saved as a separate file.",
        detail: String(err) + "\n\nThe backup was kept. Revery offers it again at the next start, as long as this is still the last note you had open.",
        buttons: ["OK"],
        defaultId: 0
      }).catch(() => {
      });
      return null;
    }
    await window.NativeAPI.deleteVolatileContent(notePath).catch(() => {
    });
    try {
      expandedDirs.add(parentPathOf(copyPath));
      await renderTree();
      if (S.activeFilePath) highlightActiveFile(S.activeFilePath);
      if (typeof window.showStatusWarning === "function") {
        window.showStatusWarning(
          "recovered-copy",
          window.t('The unsaved changes were saved as "{name}".').replace("{name}", baseNameOf(copyPath)),
          { priority: 30, ttl: 8e3 }
        );
      }
    } catch (e) {
      console.warn("[Sidebar Boot] refreshing the tree after recovery failed (the copy is saved):", e);
    }
    return copyPath;
  }
  async function offerBackupOfUnreadableNote(notePath, readErr) {
    let backup = null;
    try {
      backup = await window.NativeAPI.getVolatileContent(notePath);
    } catch (_) {
      return "none";
    }
    if (!backup || typeof backup.content !== "string" || !backup.content.trim()) return "none";
    const reason = String(readErr && readErr.message || readErr || "").replace(/^Error invoking remote method '[^']*': /, "").replace(/^Error: /, "");
    let choice;
    try {
      choice = await window.NativeAPI.showMessageBox({
        type: "warning",
        title: "Recover unsaved changes?",
        message: `"${baseNameOf(notePath)}" could not be opened, but unsaved changes to it from a previous session were found.`,
        detail: `${reason}

Last edited: ${new Date(backup.ts || Date.now()).toLocaleString()}

\u201CSave as a new file\u201D writes them into a new note in this project \u2014 nothing is overwritten. \u201CDiscard\u201D deletes them permanently.`,
        buttons: ["Save as a new file", "Discard"],
        defaultId: 0,
        cancelId: 0
        // Escape keeps the text — never destructive
      });
    } catch (e) {
      console.warn("[Sidebar Boot] Recovery dialog failed (backup kept):", e);
      return "kept";
    }
    if (choice && choice.response === 1) {
      await window.NativeAPI.deleteVolatileContent(notePath).catch(() => {
      });
      return "none";
    }
    const copyPath = await saveBackupBesideNote(notePath, backup.content);
    if (!copyPath) return "kept";
    try {
      await openFile(copyPath);
    } catch (e) {
      console.warn("[Sidebar Boot] opening the recovered note failed (it is saved):", e);
    }
    return S.activeFilePath ? "opened" : "none";
  }
  async function tellProjectUnavailable(folder, err) {
    const reason = String(err && err.message || err || "").replace(/^Error invoking remote method '[^']*': /, "").replace(/^Error: /, "");
    try {
      await window.NativeAPI.showMessageBox({
        type: "warning",
        title: window.t("Could Not Open Project"),
        message: window.t('"{name}" could not be opened. It may be on a drive that is not connected, or it was moved or renamed.').replace("{name}", baseNameOf(folder) || folder),
        detail: reason + "\n\n" + window.t("Nothing in it was changed. When it is available again, restart Revery to continue where you left off, or open a folder from the file panel. Text you type now is kept as a backup and becomes a note in the next folder you open."),
        buttons: [window.t("OK")],
        defaultId: 0
      });
    } catch (e) {
      console.warn("[Sidebar Boot] could not show the missing-project message:", e);
    }
  }
  function runBoot() {
    (async function bootSidebar() {
      let hasLoadedText = false;
      let unavailableRoot = null;
      function injectStarterText() {
        if (hasLoadedText) return;
        hasLoadedText = true;
        const initialText = `# Revery Notebook

A place to write digital notes, free from distractions and to keep the _thoughts-to-computer text_ process in one continuous flow. A markdown editor with the iconic \xBD font.

---

## Quick Guide

In the upper right corner, settings can be personalized. You can adjust the various sizes for the interface elements and tune the performance for your hardware. Press \`CTRL+S\` to download your work as a \`.md\` file, using the name specified in the upper-left corner. In the settings you can also set how the file name prefix/suffix should be named.

More information, click the \xBD logo in the center top of the screen.

---


###### - Harald Revery
`;
        if (typeof window.replaceEditorContent === "function") {
          window.replaceEditorContent(initialText);
        } else {
          editor.value = initialText;
          if (typeof render === "function") render();
          if (typeof countWords === "function") countWords();
        }
      }
      try {
        let lastFile = await window.NativeAPI.getLastOpenedFile();
        let journal = null;
        try {
          journal = typeof window.NativeAPI.getPendingRename === "function" ? await window.NativeAPI.getPendingRename() : null;
        } catch (e) {
          console.warn("[Sidebar Boot] Could not read rename journal (non-fatal):", e);
        }
        let savedRoot = null;
        if (typeof window.NativeAPI.getLastRootPath === "function") {
          try {
            savedRoot = await window.NativeAPI.getLastRootPath();
          } catch {
          }
        }
        if (!savedRoot) {
          try {
            savedRoot = localStorage.getItem("revery_root_path");
          } catch {
          }
        }
        if (savedRoot) {
          try {
            localStorage.setItem("revery_root_path", savedRoot);
          } catch {
          }
        }
        if (typeof window.NativeAPI.getProjectHistory === "function") {
          try {
            const nativeHistory = await window.NativeAPI.getProjectHistory();
            if (Array.isArray(nativeHistory) && nativeHistory.length > 0) {
              seedProjectsCache(nativeHistory);
              try {
                localStorage.setItem(PROJECTS_KEY, JSON.stringify(nativeHistory));
              } catch {
              }
            } else {
              const localHistory = loadProjects();
              if (localHistory.length > 0) {
                window.NativeAPI.setProjectHistory(localHistory).catch(() => {
                });
              }
            }
          } catch {
          }
        }
        if (lastFile || savedRoot) {
          let folder = savedRoot;
          if (!folder && lastFile) {
            const parts = lastFile.replace(/\\/g, "/").split("/");
            parts.pop();
            folder = parts.join("/");
          }
          if (folder) {
            let canonicalRoot;
            try {
              canonicalRoot = await window.NativeAPI.setRootPath(folder);
            } catch (err) {
              unavailableRoot = { folder, err };
              throw err;
            }
            if (typeof canonicalRoot === "string" && canonicalRoot) folder = canonicalRoot;
            S.rootPath = folder;
            lastFile = await reconcilePendingRename(journal, lastFile);
            let canonicalLast = lastFile;
            if (lastFile) {
              try {
                const c = await window.NativeAPI.canonicalEntryPath(lastFile);
                if (typeof c === "string" && c) canonicalLast = c;
              } catch (_) {
              }
            }
            S.selectedDirPath = folder;
            const parts = folder.replace(/\\/g, "/").split("/");
            folderNameEl.textContent = parts[parts.length - 1] || folder;
            expandedDirs.clear();
            expandedDirs.add(folder);
            await recordProjectOpen(folder);
            if (canonicalLast && canonicalLast.replace(/\\/g, "/").startsWith(folder.replace(/\\/g, "/"))) {
              const relPath = canonicalLast.replace(/\\/g, "/").substring(folder.length).replace(/^\//, "");
              const relParts = relPath.split("/");
              relParts.pop();
              let currentPath = folder;
              for (const p of relParts) {
                currentPath = joinPath(currentPath, p);
                expandedDirs.add(currentPath);
              }
              S.selectedDirPath = currentPath;
            }
            restoreCardViewDir(folder);
            openSidebar();
            updateViewBtn();
            await renderTree();
            try {
              await reportBakOrphans(folder, lastFile);
            } catch (e) {
              console.warn("[Sidebar Boot] Bak orphan report failed:", e);
            }
            if (lastFile) {
              let readFailed = false;
              try {
                let diskContent;
                try {
                  diskContent = await window.NativeAPI.readFile(lastFile);
                } catch (readErr) {
                  readFailed = true;
                  throw readErr;
                }
                if (typeof window.replaceEditorContent === "function") {
                  window.replaceEditorContent(diskContent);
                } else {
                  editor.value = diskContent;
                  if (typeof render === "function") render();
                  if (typeof countWords === "function") countWords();
                }
                hasLoadedText = true;
                S.activeFilePath = lastFile;
                markClean();
                rememberDiskContent(diskContent);
                highlightActiveFile(lastFile);
                startWatchingFile(lastFile);
                if (docTitleEl) {
                  const base = lastFile.replace(/\\/g, "/").split("/").pop();
                  docTitleEl.value = base.replace(/\.(md|txt)$/, "");
                }
                try {
                  const backup = await window.NativeAPI.getVolatileContent(lastFile);
                  const diskAsEditor = normalizeEol(diskContent);
                  if (backup && backup.content !== diskAsEditor) {
                    const ts = new Date(backup.ts).toLocaleString();
                    const backupLen = backup.content.length;
                    const diskLen = diskContent.length;
                    const suspicious = backupLen === 0 && diskLen > 0 || diskLen > 200 && backupLen < diskLen * 0.1;
                    const based = isTextFingerprint(backup.base) ? backup.base === diskFingerprint(diskContent) : null;
                    const changed = !suspicious && based === false;
                    let fileMtime = 0;
                    if (based === null) {
                      try {
                        const dirPath = lastFile.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
                        const entries = await window.NativeAPI.readDirectory(dirPath);
                        const norm = (p) => String(p).replace(/\\/g, "/");
                        const me = (entries || []).find((e) => norm(e.path) === norm(lastFile));
                        if (me && typeof me.mtime === "number") fileMtime = me.mtime;
                      } catch (_) {
                      }
                    }
                    const stale = !suspicious && based === null && fileMtime > 0 && backup.ts > 0 && backup.ts < fileMtime;
                    const blank = backup.content.trim().length === 0;
                    const KEEP_BOTH = "\n\nRecommended: \u201CSave backup as a copy\u201D \u2014 the saved file stays as it is and the backup becomes a separate file next to it, so nothing is lost.";
                    let dialog;
                    if (blank) {
                      dialog = {
                        type: "warning",
                        message: "A crash backup was found, but it is empty.",
                        detail: `Last edited: ${ts}

Restoring it would REPLACE your saved file with empty text.

Recommended: keep the saved version.`,
                        choices: [["restore", "Restore empty backup"], ["discard", "Keep saved version"]],
                        defaultAction: "discard",
                        cancelAction: "discard"
                      };
                    } else if (suspicious) {
                      dialog = {
                        type: "warning",
                        message: "A crash backup was found, but it looks incomplete.",
                        detail: `Last edited: ${ts}

The backup is much shorter than the saved file (${backupLen} vs ${diskLen} characters) \u2014 the crash may have damaged it. Restoring it would REPLACE your saved file with this content.` + KEEP_BOTH,
                        choices: [["restore", "Restore incomplete backup"], ["copy", "Save backup as a copy"], ["discard", "Discard backup"]],
                        defaultAction: "copy",
                        cancelAction: "copy"
                      };
                    } else if (changed) {
                      dialog = {
                        type: "warning",
                        message: "Unsaved text from a previous session was found, but the file has changed since.",
                        detail: `Last edited: ${ts}

The file on disk is no longer the version this text was based on \u2014 another program, a sync service or another device changed it afterwards (or you chose \u201CKeep my version\u201D). Restoring would REPLACE that newer version with this text.` + KEEP_BOTH,
                        choices: [["restore", "Restore backup"], ["copy", "Save backup as a copy"], ["discard", "Discard backup"]],
                        defaultAction: "copy",
                        cancelAction: "copy"
                      };
                    } else if (stale) {
                      dialog = {
                        type: "warning",
                        message: "A crash backup was found, but the file has been saved more recently.",
                        detail: `Backup from: ${ts}
File last saved: ${new Date(fileMtime).toLocaleString()}

The saved file is NEWER than this backup \u2014 restoring would replace the newer saved content with this older backup.` + KEEP_BOTH,
                        choices: [["restore", "Restore older backup"], ["copy", "Save backup as a copy"], ["discard", "Discard backup"]],
                        defaultAction: "copy",
                        cancelAction: "copy"
                      };
                    } else {
                      dialog = {
                        type: "question",
                        message: "Unsaved changes from a previous session were found.",
                        detail: `Last edited: ${ts}

\u201CRestore\u201D puts them back into the editor. \u201CSave as a copy\u201D keeps the saved note as it is and writes the unsaved changes into a separate file next to it. \u201CDiscard\u201D deletes them permanently.`,
                        choices: [["restore", "Restore"], ["copy", "Save as a copy"], ["discard", "Discard"]],
                        defaultAction: "restore",
                        cancelAction: "copy"
                      };
                    }
                    const actions = dialog.choices.map((c) => c[0]);
                    const choice = await window.NativeAPI.showMessageBox({
                      title: "Recover unsaved changes?",
                      type: dialog.type,
                      message: dialog.message,
                      detail: dialog.detail,
                      buttons: dialog.choices.map((c) => c[1]),
                      defaultId: actions.indexOf(dialog.defaultAction),
                      cancelId: actions.indexOf(dialog.cancelAction)
                    });
                    const action = actions[choice && choice.response] || dialog.cancelAction;
                    if (action === "restore") {
                      if (typeof window.replaceEditorContent === "function") {
                        window.replaceEditorContent(backup.content);
                      } else {
                        editor.value = backup.content;
                        if (typeof render === "function") render();
                        if (typeof countWords === "function") countWords();
                      }
                      markDirty();
                      scheduleAutoSave();
                      if (typeof window.NativeAPI.writeVolatileNow === "function") {
                        await window.NativeAPI.writeVolatileNow(lastFile, backup.content, noteBackupBase()).catch(
                          (e) => console.warn("[Sidebar] Refreshing backup after restore failed:", e)
                        );
                      }
                    } else if (action === "copy") {
                      await saveBackupBesideNote(lastFile, backup.content);
                    } else {
                      await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {
                      });
                    }
                  } else if (backup) {
                    await window.NativeAPI.deleteVolatileContent(lastFile).catch(() => {
                    });
                  }
                } catch (e) {
                  console.warn("[Sidebar Boot] Crash-recovery check failed (non-fatal):", e);
                }
                if (canonicalLast && canonicalLast !== lastFile && S.activeFilePath === lastFile) {
                  await retargetActiveFile(lastFile, canonicalLast);
                  highlightActiveFile(S.activeFilePath);
                }
              } catch (err) {
                console.warn("[Sidebar Boot] Could not read last file:", err);
                const recovered = readFailed ? await offerBackupOfUnreadableNote(lastFile, err) : "none";
                if (recovered === "opened") {
                  hasLoadedText = true;
                } else {
                  injectStarterText();
                  if (recovered !== "kept") {
                    try {
                      await window.NativeAPI.clearLastOpenedFile();
                    } catch {
                    }
                  }
                }
              }
            } else {
              injectStarterText();
            }
            if (typeof postProcessImages === "function") postProcessImages();
          }
          return;
        }
        let defaultFolder = null;
        try {
          defaultFolder = await window.NativeAPI.getDefaultNotesFolder();
        } catch (e) {
          console.warn("[Sidebar] getDefaultNotesFolder failed:", e);
        }
        if (defaultFolder) {
          const canonicalDefault = await window.NativeAPI.setRootPath(defaultFolder);
          if (typeof canonicalDefault === "string" && canonicalDefault) defaultFolder = canonicalDefault;
          S.rootPath = defaultFolder;
          try {
            localStorage.setItem("revery_root_path", S.rootPath);
          } catch (e) {
          }
          recordProjectOpen(defaultFolder);
          S.selectedDirPath = defaultFolder;
          restoreCardViewDir(defaultFolder);
          const parts = defaultFolder.replace(/\\/g, "/").split("/");
          folderNameEl.textContent = parts[parts.length - 1] || defaultFolder;
          expandedDirs.clear();
          expandedDirs.add(defaultFolder);
          openSidebar();
          updateViewBtn();
          await renderTree();
        }
      } catch (err) {
        console.warn("[Sidebar] Boot failed:", err);
        if (unavailableRoot) {
          injectStarterText();
          await tellProjectUnavailable(unavailableRoot.folder, unavailableRoot.err);
        }
      } finally {
        if (!hasLoadedText) injectStarterText();
        try {
          await recoverScratchpadBackups();
        } catch (e) {
          console.warn("[Sidebar Boot] Scratchpad recovery scan failed (non-fatal):", e);
        }
      }
    })();
  }

  // src/sidebar/yaml_index.js
  var INDEX_TTL_MS = 30 * 1e3;
  var MAX_FILE_BYTES = 1024 * 1024;
  var MAX_KEYS = 200;
  var MAX_VALUES_PER_KEY = 300;
  var READ_BATCH = 8;
  var _fileCache = /* @__PURE__ */ new Map();
  var _built = { at: 0, root: null, agg: null };
  var MAX_VALUE_LEN = 80;
  function parseFrontmatterBlock(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text || "");
    if (!m) return null;
    const Y = window.ReveryYaml;
    if (!Y) return null;
    const keys = [];
    const pairs = /* @__PURE__ */ new Map();
    for (const e of Y.readEntries(m[1], 0)) {
      if (!e.key) continue;
      keys.push(e.key);
      const vals = (e.kind === "list" ? e.value : e.kind === "text" ? [e.value] : []).map((v) => String(v).trim()).filter((v) => v && v.length <= MAX_VALUE_LEN && !v.includes("\n"));
      if (vals.length) pairs.set(e.key, (pairs.get(e.key) || []).concat(vals));
    }
    return { keys, pairs };
  }
  function newAgg() {
    return { keyCounts: /* @__PURE__ */ new Map(), valueCounts: /* @__PURE__ */ new Map() };
  }
  function foldParsed(agg, parsed) {
    if (!parsed) return;
    for (const k of parsed.keys) {
      agg.keyCounts.set(k, (agg.keyCounts.get(k) || 0) + 1);
    }
    for (const [k, vals] of parsed.pairs) {
      let vc = agg.valueCounts.get(k);
      if (!vc) {
        vc = /* @__PURE__ */ new Map();
        agg.valueCounts.set(k, vc);
      }
      for (const v of vals) vc.set(v, (vc.get(v) || 0) + 1);
    }
  }
  async function buildProjectAgg() {
    const agg = newAgg();
    const files = await listProjectTextFiles(["md"]);
    for (let i = 0; i < files.length; i += READ_BATCH) {
      const batch = files.slice(i, i + READ_BATCH);
      await Promise.all(batch.map(async (f) => {
        const cached = _fileCache.get(f.path);
        if (cached && cached.mtime === f.mtime) return;
        let parsed = null;
        try {
          const content = await window.NativeAPI.readFile(f.path);
          if (typeof content === "string" && content.length <= MAX_FILE_BYTES) {
            parsed = parseFrontmatterBlock(content);
          }
        } catch (_) {
        }
        _fileCache.set(f.path, { mtime: f.mtime, parsed });
      }));
    }
    const live = new Set(files.map((f) => f.path));
    for (const [p, entry] of _fileCache) {
      if (!live.has(p)) {
        _fileCache.delete(p);
        continue;
      }
      foldParsed(agg, entry.parsed);
    }
    return agg;
  }
  function serialize(agg) {
    const sortDesc = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([label, count]) => ({ label, count }));
    const keys = sortDesc(agg.keyCounts).slice(0, MAX_KEYS);
    const values = {};
    for (const [k, vc] of agg.valueCounts) {
      values[k] = sortDesc(vc).slice(0, MAX_VALUES_PER_KEY);
    }
    return { keys, values };
  }
  async function getYamlIndex(currentDocFm) {
    const root = window.NativeAPI && window.NativeAPI.isDesktop ? typeof window.sidebarGetRootPath === "function" ? window.sidebarGetRootPath() : null : "(web)";
    const now = Date.now();
    if (!_built.agg || _built.root !== root || now - _built.at >= INDEX_TTL_MS) {
      _built = { at: now, root, agg: await buildProjectAgg() };
    }
    const merged = newAgg();
    for (const [k, c] of _built.agg.keyCounts) merged.keyCounts.set(k, c);
    for (const [k, vc] of _built.agg.valueCounts) merged.valueCounts.set(k, new Map(vc));
    foldParsed(merged, parseFrontmatterBlock(currentDocFm));
    return serialize(merged);
  }

  // src/sidebar/search.js
  var DEBOUNCE_MS = () => window.slowHardwareMode ? 600 : 250;
  var MIN_QUERY = 2;
  var MAX_MATCHES_PER_FILE = 5;
  var MAX_TOTAL_MATCHES = 200;
  var MAX_CACHED_FILE = 256 * 1024;
  var MAX_CACHE_TOTAL = 24 * 1024 * 1024;
  var SNIPPET_RADIUS = 44;
  var _bodyCache = /* @__PURE__ */ new Map();
  var _cacheBytes = 0;
  var _searchToken = 0;
  var _els = null;
  function getTreeEl() {
    return document.getElementById("sidebar-tree");
  }
  function ensureUi() {
    if (_els) return _els;
    const treeEl2 = getTreeEl();
    if (!treeEl2 || !treeEl2.parentNode) return null;
    const row = document.createElement("div");
    row.id = "sidebar-search-row";
    const input = document.createElement("input");
    input.id = "sidebar-search-input";
    input.type = "text";
    input.placeholder = window.t ? window.t("Search project\u2026") : "Search project\u2026";
    input.spellcheck = false;
    input.autocomplete = "off";
    const closeBtn = document.createElement("button");
    closeBtn.id = "sidebar-search-close";
    closeBtn.title = window.t("Close (Escape)");
    closeBtn.textContent = "\u2715";
    row.appendChild(input);
    row.appendChild(closeBtn);
    const results = document.createElement("div");
    results.id = "sidebar-search-results";
    treeEl2.parentNode.insertBefore(row, treeEl2);
    treeEl2.parentNode.insertBefore(results, treeEl2);
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(input.value), DEBOUNCE_MS());
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSearch();
      }
    });
    closeBtn.addEventListener("click", closeSearch);
    _els = { row, input, results };
    return _els;
  }
  function openSearch() {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
    const els = ensureUi();
    if (!els) return;
    els.row.classList.add("active");
    els.results.classList.add("active");
    if (els.input.value.trim().length >= MIN_QUERY) runSearch(els.input.value);
    els.input.focus();
    els.input.select();
  }
  function closeSearch() {
    if (!_els) return;
    _searchToken++;
    _els.row.classList.remove("active");
    _els.results.classList.remove("active");
    _els.results.replaceChildren();
    const treeEl2 = getTreeEl();
    if (treeEl2) treeEl2.classList.remove("search-hidden");
  }
  function toggleSearch() {
    if (_els && _els.row.classList.contains("active")) closeSearch();
    else openSearch();
  }
  async function fileText(f) {
    const hit = _bodyCache.get(f.path);
    if (hit && hit.mtime === f.mtime) return hit.text;
    let text;
    try {
      text = await window.NativeAPI.readFile(f.path);
    } catch (_) {
      return null;
    }
    if (typeof text !== "string") return null;
    if (text.length <= MAX_CACHED_FILE && _cacheBytes + text.length <= MAX_CACHE_TOTAL) {
      const old = _bodyCache.get(f.path);
      if (old) _cacheBytes -= old.text.length;
      _bodyCache.set(f.path, { mtime: f.mtime, text });
      _cacheBytes += text.length;
    }
    return text;
  }
  async function runSearch(rawQuery) {
    const els = ensureUi();
    if (!els) return;
    const query = rawQuery.trim();
    const treeEl2 = getTreeEl();
    if (query.length < MIN_QUERY) {
      _searchToken++;
      els.results.replaceChildren();
      if (treeEl2) treeEl2.classList.remove("search-hidden");
      return;
    }
    const token = ++_searchToken;
    if (treeEl2) treeEl2.classList.add("search-hidden");
    els.results.replaceChildren(statusRow(window.t ? window.t("Searching\u2026") : "Searching\u2026"));
    const needle = query.toLowerCase();
    const files = await listProjectTextFiles(["md", "txt"]);
    const out = [];
    for (const f of files) {
      if (token !== _searchToken) return;
      if (out.length >= MAX_TOTAL_MATCHES) break;
      const text = await fileText(f);
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower.indexOf(needle) === -1) continue;
      let perFile = 0;
      let lineStart = 0;
      const lines = text.split("\n");
      for (let n = 0; n < lines.length && perFile < MAX_MATCHES_PER_FILE && out.length < MAX_TOTAL_MATCHES; n++) {
        const col = lines[n].toLowerCase().indexOf(needle);
        if (col !== -1) {
          out.push({
            path: f.path,
            name: f.name,
            line: n + 1,
            col,
            len: query.length,
            snippet: lines[n]
          });
          perFile++;
        }
        lineStart += lines[n].length + 1;
      }
    }
    if (token !== _searchToken) return;
    renderResults(els.results, out, query);
  }
  function statusRow(text) {
    const el = document.createElement("div");
    el.className = "search-status";
    el.textContent = text;
    return el;
  }
  function renderResults(container, matches, query) {
    container.replaceChildren();
    if (!matches.length) {
      container.appendChild(statusRow(window.t ? window.t("No matches.") : "No matches."));
      return;
    }
    let lastPath = null;
    for (const m of matches) {
      if (m.path !== lastPath) {
        lastPath = m.path;
        const head = document.createElement("div");
        head.className = "search-file";
        head.appendChild(icon("file-lines"));
        const nm = document.createElement("span");
        nm.textContent = m.name;
        head.appendChild(nm);
        container.appendChild(head);
      }
      const row = document.createElement("button");
      row.className = "search-result";
      row.title = `${m.name}:${m.line}`;
      const from = Math.max(0, m.col - SNIPPET_RADIUS);
      const to = Math.min(m.snippet.length, m.col + m.len + SNIPPET_RADIUS);
      const pre = (from > 0 ? "\u2026" : "") + m.snippet.slice(from, m.col);
      const hit = m.snippet.slice(m.col, m.col + m.len);
      const post = m.snippet.slice(m.col + m.len, to) + (to < m.snippet.length ? "\u2026" : "");
      row.appendChild(document.createTextNode(pre));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = hit;
      row.appendChild(mark);
      row.appendChild(document.createTextNode(post));
      row.addEventListener("click", () => jumpToMatch(m));
      container.appendChild(row);
    }
    if (matches.length >= MAX_TOTAL_MATCHES) {
      container.appendChild(statusRow(
        (window.t ? window.t("Showing first") : "Showing first") + ` ${MAX_TOTAL_MATCHES}.`
      ));
    }
  }
  async function jumpToMatch(m) {
    try {
      if (S.activeFilePath !== m.path) await openFile(m.path);
    } catch (_) {
      return;
    }
    const view = window.cmView;
    if (!view) return;
    let pos = -1;
    const doc = view.state.doc;
    if (m.line <= doc.lines) {
      const ln = doc.line(m.line);
      const idx = ln.text.toLowerCase().indexOf(m.snippet.slice(m.col, m.col + m.len).toLowerCase());
      if (idx !== -1) pos = ln.from + idx;
    }
    if (pos === -1) {
      const idx = doc.toString().toLowerCase().indexOf(m.snippet.slice(m.col, m.col + m.len).toLowerCase());
      if (idx === -1) return;
      pos = idx;
    }
    view.dispatch({
      selection: { anchor: pos, head: pos + m.len },
      effects: CM.EditorView.scrollIntoView(pos, { y: "center" })
    });
    view.focus();
  }
  function initSearch() {
    const btn = document.getElementById("sidebar-search-btn");
    if (btn) btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSearch();
    });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        e.stopPropagation();
        openSearchWithSidebar();
      }
    }, true);
    window.sidebarOpenSearch = openSearchWithSidebar;
  }
  function openSearchWithSidebar() {
    if (!S.sidebarOpen) openSidebar();
    openSearch();
  }

  // src/sidebar/link_complete.js
  async function listLinkCompletions(rawDest) {
    if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return null;
    if (typeof rawDest !== "string") return null;
    const lastSlash = rawDest.lastIndexOf("/");
    const rawDir = lastSlash >= 0 ? rawDest.slice(0, lastSlash + 1) : "";
    const rawSeg = rawDest.slice(lastSlash + 1);
    const decDir = decodeLinkDest(rawDir);
    const decSeg = decodeLinkDest(rawSeg);
    if (hasUrlScheme(decDir || decSeg)) return null;
    const baseDir = pendingNoteDir();
    if (!baseDir) return null;
    const absDir = resolvePath(baseDir, decDir);
    if (!isInsideRoot(absDir, S.rootPath)) return null;
    let entries;
    try {
      entries = await window.NativeAPI.readDirectory(absDir);
    } catch (_) {
      return null;
    }
    if (!Array.isArray(entries)) return null;
    const segLower = decSeg.toLowerCase();
    const out = [];
    for (const e of entries) {
      if (!e || !e.name || e.name.startsWith(".")) continue;
      const isDir = e.type === "dir";
      let kind = "folder";
      if (!isDir) {
        const cat = getFileCategory(e.name);
        if (cat !== "media" && cat !== "text") continue;
        kind = cat === "media" ? "image" : "note";
      }
      if (segLower && !e.name.toLowerCase().startsWith(segLower)) continue;
      out.push({ name: e.name, isDir, kind });
    }
    out.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
    return { rawSegLength: rawSeg.length, entries: out.slice(0, 60) };
  }

  // src/sidebar/index.js
  window.sidebarYamlIndex = getYamlIndex;
  window.sidebarListLinkCompletions = listLinkCompletions;
  window.sidebarIcon = icon;
  window.ReveryPaths = Object.freeze({ ...paths_exports });
  window.sidebarGetLinkBaseDir = pendingNoteDir;
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) {
    const btn = document.getElementById("btn-sidebar");
    if (btn) btn.style.display = "none";
    const btnMobile = document.getElementById("btn-sidebar-mobile");
    if (btnMobile) btnMobile.style.display = "none";
  } else {
    initDialogStyles();
    initCardView();
    initProjects();
    initTree();
    initSaveEngine();
    initPanel();
    initFileOps();
    initDnd();
    initMediaIngest();
    initSearch();
    initCloseHandler();
    runBoot();
    setTimeout(
      () => {
        try {
          getYamlIndex("").catch(() => {
          });
        } catch (_) {
        }
      },
      window.slowHardwareMode ? 12e3 : 4e3
    );
  }
})();

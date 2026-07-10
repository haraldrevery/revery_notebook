/**
 * native_api.js — Revery Notebook Desktop Adapter Layer
 *
 * This module exposes a single global `window.NativeAPI` interface that the
 * frontend calls for ALL operating-system interactions. It detects the
 * runtime environment and routes each call to the correct backend.
 *
 * Load order: This script MUST be loaded before any other app scripts
 * (right after markdown_editor_theme.js in the <head>).
 *
 * Environment detection:
 *   Tauri   → window.__TAURI__ is injected by the Tauri runtime
 *   Electron → window.electronAPI is injected by preload.js via contextBridge
 *   Web     → fallback, uses File System Access API where available
 */

(function () {
  'use strict';

  /* ── Environment Detection ───────────────────────────────────────────── */
  const isTauri    = typeof window.__TAURI__      !== 'undefined';
  const isElectron = typeof window.electronAPI    !== 'undefined';
  const ENV        = isTauri ? 'tauri' : isElectron ? 'electron' : 'web';

  /* ── Shared helpers ──────────────────────────────────────────────────── */
  function notSupported(name) {
    return Promise.reject(
      new Error(`NativeAPI.${name}() is not supported in web mode. ` +
                `Open this app via the Electron or Tauri desktop wrapper.`)
    );
  }

  /* ── Volatile content: crash-safe temp backup ────────────────────────
     setVolatileContent(path, content) persists the editor state to a
     temp/backup location in case of crash. … */
  let _volatileTimer        = null;
  let _volatileMaxWaitTimer = null;
  let _volatilePending      = null;   // {path, content} – always the LATEST args
  let _volatileChain = Promise.resolve();
  function _enqueueVolatileOp(op) {
    const run = _volatileChain.then(op, op);
    _volatileChain = run.then(() => {}, () => {});
    return run;
  }
  /* Crash-backup cadence. Slow hardware mode stretches the intervals so a
     spinning disk isn't hit with fsync'd writes every couple of seconds —
     each write keeps the identical atomic + fsync durability; only the
     worst-case lost-typing window on a hard crash grows (~2s → ~5s).
     Read at call time so toggling the mode applies immediately.          */
  function volatileDebounceMs() { return window.slowHardwareMode ? 5000  : 2000; }
  function volatileMaxWaitMs()  { return window.slowHardwareMode ? 30000 : 15000; } // force backup during continuous typing

function flushVolatile() {
    clearTimeout(_volatileTimer);        _volatileTimer = null;
    clearTimeout(_volatileMaxWaitTimer); _volatileMaxWaitTimer = null;

    if (!_volatilePending) return;
    const { path, content } = _volatilePending;
    _volatilePending = null;

    _enqueueVolatileOp(() => window.NativeAPI._writeVolatileNow(path, content)).then(
      ()  => { reportVolatileOutcome(true,  null); },
      err => {
        console.warn('[NativeAPI] Volatile backup failed:', err);
        reportVolatileOutcome(false, err && err.message ? err.message : String(err));
      }
    );
  }

  /* The volatile status badge has two inputs:
       1. The startup directory check (ready/error from getVolatileStatus).
       2. Per-write outcomes from flushVolatile.
     Either one failing is sufficient to show the badge red. A successful
     write after a failure clears it (the dir may have recovered, e.g. a
     full disk freed up). The startup error, if present, is sticky — only
     the user can fix that condition (move the symlink, fix perms, etc.). */
  let _volatileStartupError = null;     // set once at boot, sticky
  let _volatileLastWriteError = null;   // updated on every write

  function reportVolatileOutcome(ok, errMessage) {
    _volatileLastWriteError = ok ? null : errMessage;
    refreshVolatileBadge();
  }

  function refreshVolatileBadge() {
    const badge = document.getElementById('volatile-status');
    if (!badge) return;
    const err = _volatileStartupError || _volatileLastWriteError;
    if (err) {
      const label = (typeof window.t === 'function')
        ? window.t('Crash backup unavailable')
        : 'Crash backup unavailable';
      badge.textContent = '⚠ ' + label;
      badge.title = err;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
      badge.title = '';
    }
  }

  // Run the startup check once the DOM is ready. The badge element may not
  // exist yet when this module loads, so we defer to DOMContentLoaded.
  function checkVolatileStartup() {
    // Web mode has no crash backup by design — never show the warning badge
    // there (the unified index.html contains the badge element on all
    // platforms, so this guard is what keeps it desktop-only).
    if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
    if (typeof window.NativeAPI.getVolatileStatus !== 'function') {
      return;
    }
    Promise.resolve(window.NativeAPI.getVolatileStatus()).then(
      status => {
        _volatileStartupError = (status && status.ready) ? null
          : (status && status.error) ? status.error
          : 'Crash backup directory failed safety check.';
        refreshVolatileBadge();
      },
      err => {
        _volatileStartupError = (err && err.message) ? err.message : String(err);
        refreshVolatileBadge();
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkVolatileStartup, { once: true });
  } else {
    checkVolatileStartup();
  }

  function cancelVolatile() {
    clearTimeout(_volatileTimer);        _volatileTimer = null;
    clearTimeout(_volatileMaxWaitTimer); _volatileMaxWaitTimer = null;
    _volatilePending = null;
  }

function debounceVolatile(path, content) {
    _volatilePending = { path, content };

    clearTimeout(_volatileTimer);
    _volatileTimer = setTimeout(flushVolatile, volatileDebounceMs());

    if (!_volatileMaxWaitTimer) {
      // Does NOT reset on subsequent calls — bounds worst-case backup latency.
      _volatileMaxWaitTimer = setTimeout(flushVolatile, volatileMaxWaitMs());
    }
  }

  /* ── HTML message-box fallback ────────────────────────────────────────
     Tauri v2's native MessageDialog supports at most 2 custom buttons, but
     several flows (notably "File Changed Externally") need 3. This helper
     renders an HTML modal with the same { response: <index> } contract as
     the native dialog so callers don't need to special-case the platform.

     Used in Tauri's showMessageBox when buttons.length > 1. The Rust
     backend still rejects > 2 buttons defensively — if you ever see that
     error in the console it means the JS routing below got bypassed.

     All user-supplied strings go in via .textContent (never innerHTML), so
     this is safe to call with arbitrary content from disk or the network. */
  function showHtmlMessageBox(options) {
    return new Promise((resolve) => {
      const buttons   = (Array.isArray(options.buttons) && options.buttons.length > 0)
                        ? options.buttons : ['OK'];
      const cancelId  = (typeof options.cancelId  === 'number') ? options.cancelId  : buttons.length - 1;
      const defaultId = (typeof options.defaultId === 'number') ? options.defaultId : 0;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay show';
      overlay.style.zIndex = '10000'; // above any other modal

      const content = document.createElement('div');
      content.className = 'modal-content';
      content.style.maxWidth = '500px';

      const titleEl = document.createElement('h3');
      titleEl.textContent = options.title || '';
      content.appendChild(titleEl);

      if (options.message) {
        const msgEl = document.createElement('p');
        msgEl.style.whiteSpace = 'pre-wrap';
        msgEl.textContent = options.message;
        content.appendChild(msgEl);
      }
      if (options.detail) {
        const detailEl = document.createElement('p');
        detailEl.style.whiteSpace = 'pre-wrap';
        detailEl.style.fontSize = '0.9em';
        detailEl.style.opacity = '0.85';
        detailEl.textContent = options.detail;
        content.appendChild(detailEl);
      }

      const btnRow = document.createElement('div');
      btnRow.className = 'modal-buttons';

      let resolved = false;
      const finish = (response) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', escHandler);
        try { document.body.removeChild(overlay); } catch (_) {}
        resolve({ response });
      };

      buttons.forEach((label, idx) => {
        const btn = document.createElement('button');
        btn.className = 'tb-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => finish(idx));
        btnRow.appendChild(btn);
      });
      content.appendChild(btnRow);
      overlay.appendChild(content);
      document.body.appendChild(overlay);

      // Focus the default button so Enter activates it.
      const btnNodes = btnRow.querySelectorAll('.tb-btn');
      if (btnNodes[defaultId]) btnNodes[defaultId].focus();

      // Escape resolves with cancelId (matches native dialog semantics).
      const escHandler = (e) => {
        if (e.key === 'Escape') finish(cancelId);
      };
      document.addEventListener('keydown', escHandler);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     ELECTRON IMPLEMENTATION
     All calls go through window.electronAPI, which is the contextBridge
     defined in preload.js. IPC is handled by main.js.
  ══════════════════════════════════════════════════════════════════════ */
  const electronImpl = {

    openFolderDialog() {
      return window.electronAPI.openFolderDialog();
    },
    setRootPath(dirPath) {
      return window.electronAPI.setRootPath(dirPath);
    },
    readDirectory(path) {
      return window.electronAPI.readDirectory(path);
    },
    readFile(path) {
      return window.electronAPI.readFile(path);
    },

    writeFile(path, content) {
      return window.electronAPI.writeFile(path, content);
    },

    createFile(path) {
      return window.electronAPI.createFile(path);
    },

    createDirectory(path) {
      return window.electronAPI.createDirectory(path);
    },

    renameNode(oldPath, newPath) {
      return window.electronAPI.renameNode(oldPath, newPath);
    },

    deleteNode(path) {
      return window.electronAPI.deleteNode(path);
    },

    copyFileIntoFolder(destDir, filename, contentB64) {
      return window.electronAPI.copyFileIntoFolder(destDir, filename, contentB64);
    },

    /* Electron reads dropped File bytes via the DOM, so path-copy and the
       native drag-drop event are not used. Provide inert stubs so callers
       stay platform-agnostic. */
    copyPathIntoFolder() {
      return Promise.reject(new Error('copyPathIntoFolder is Tauri-only'));
    },
    onNativeFileDrop() {
      return Promise.resolve(() => {}); // no-op; Electron uses the DOM drop path
    },

    /* Debounced — called on every editor keystroke */
    setVolatileContent(path, content) {
      debounceVolatile(path, content);
    },

/* Internal: the actual write, called after debounce */
_writeVolatileNow(path, content) {
  return window.electronAPI.setVolatileContent(path, content);
},
/* Immediate volatile write (bypass debounce, but NOT the ordering chain) */
writeVolatileNow(path, content) {
  return _enqueueVolatileOp(() => window.electronAPI.setVolatileContent(path, content));
},

    getVolatileContent(path) {
      return window.electronAPI.getVolatileContent(path);
    },

    deleteVolatileContent(path) {
      cancelVolatile();
      return _enqueueVolatileOp(() => window.electronAPI.deleteVolatileContent(path));
    },

    getVolatileStatus() {
      return window.electronAPI.getVolatileStatus();
    },

    /* List crash backups whose originalPath starts with `prefix`,
       newest-first: [{ originalPath, ts }]. */
    listVolatileBackups(prefix) {
      return window.electronAPI.listVolatileBackups(prefix);
    },

   showMessageBox(options) {
      return window.electronAPI.showMessageBox(options);
    },
    saveFile(filename, content, options) {
      return window.electronAPI.saveFile(filename, content, options);
    },
    /* Register a callback to run when the OS window close button is pressed.
       The callback receives no arguments. Call NativeAPI.confirmClose() when
       it is safe to actually close (i.e. user confirmed, unsaved work handled). */
    onWindowClose(callback) {
      window.electronAPI.onWindowClose(() => callback());
    },

    /* Tell the main process: "frontend is done, proceed with the close." */
    confirmClose() {
      window.electronAPI.confirmClose();
    },

    /* ── Frameless window controls ─────────────────────────────────── */
    minimizeWindow() {
      return window.electronAPI.minimizeWindow();
    },

    toggleMaximizeWindow() {
      return window.electronAPI.toggleMaximizeWindow();
    },

    /** Export the project folder as a .zip; main owns the save dialog. */
    exportProjectZip() {
      return window.electronAPI.exportProjectZip();
    },

    /** Print a self-contained HTML document to PDF (dialog in main). */
    exportPdf(html, opts) {
      return window.electronAPI.exportPdf(html, opts);
    },

    /** LaTeX project zip: main.tex + images/ + bundled brand fonts (dialog in main). */
    exportLatexZip(tex, images, baseName, bundleFonts) {
      return window.electronAPI.exportLatexZip(tex, images, baseName, bundleFonts);
    },
/* Triggers the existing close-request flow → quit modal appears. */
    closeWindow() {
      return window.electronAPI.closeWindow();
    },

    /** Enter or exit native OS fullscreen. */
    setFullscreen(fullscreen) {
      return window.electronAPI.setFullscreen(fullscreen);
    },

    /* Start watching a file for external changes. callback(eventType, path). */
    watchFile(path, callback) {
      return window.electronAPI.watchFile(path, (event) => callback(event, path));
    },

    unwatchFile(path) {
      return window.electronAPI.unwatchFile(path);
    },
    /* Persistent pointer to the last opened file (stored in app userData). */
    getLastOpenedFile() {
      return window.electronAPI.getLastOpenedFile();
    },

    setLastOpenedFile(path) {
      return window.electronAPI.setLastOpenedFile(path);
    },

    clearLastOpenedFile() {
      return window.electronAPI.setLastOpenedFile(null);
    },

    getPendingRename() {
      return window.electronAPI.getPendingRename();
    },

    setPendingRename(journal) {
      return window.electronAPI.setPendingRename(journal);
    },

    clearAllSettings() {
      return window.electronAPI.clearAllSettings();
    },
    getLastRootPath() {
      return window.electronAPI.getLastRootPath();
    },

    setLastRootPath(dirPath) {
      return window.electronAPI.setLastRootPath(dirPath);
    },

    getProjectHistory() {
      return window.electronAPI.getProjectHistory();
    },

    setProjectHistory(arr) {
      return window.electronAPI.setProjectHistory(arr);
    },
    getAppDataPath() {
      return window.electronAPI.getAppDataPath();
    },

    getDefaultNotesFolder() {
      return window.electronAPI.getDefaultNotesFolder();
    },

    /** Open the OS file manager with the item revealed/selected. */
    showInExplorer(itemPath) {
      return window.electronAPI.showInFolder(itemPath);
    },


    toMediaUrl(absolutePath) {
      // Decode in case it was URI encoded by the markdown relative path generator
      try { absolutePath = decodeURI(absolutePath); } catch (e) {}
      
      let forward = absolutePath.replace(/\\/g, '/');
      
      // Ensure the path starts with exactly one slash for local drives (e.g. /C:/...)
      if (!forward.startsWith('/')) {
        forward = '/' + forward;
      }
      
      // encodeURI ignores '#' and '?', which breaks files containing those characters.
      // We manually encode them so the browser doesn't interpret them as URL fragments/queries.
      return 'file://' + encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F');
    },
  };


  /* ══════════════════════════════════════════════════════════════════════
     TAURI IMPLEMENTATION
     All calls use window.__TAURI__.core.invoke() to call Rust commands
     registered in main.rs via tauri::generate_handler![].
  ══════════════════════════════════════════════════════════════════════ */
const tauriImpl = {
    // path → { active, unlisten } — currently installed watcher per path.
    _watchUnlisteners: new Map(),
    // path → Promise — chains watch/unwatch ops for the same path so they
    // never race at the backend. See _serializeWatchOp below.
    _watchOpsByPath: new Map(),

    _invoke(cmd, args) {
      return window.__TAURI__.core.invoke(cmd, args || {});
    },
    openFolderDialog() {
      return this._invoke('open_folder_dialog');
    },

    setRootPath(dirPath) {
      return this._invoke('set_root_path', { path: dirPath });
    },

    readDirectory(path) {
      return this._invoke('read_directory', { path });
    },

    readFile(path) {
      return this._invoke('read_file', { path });
    },

    writeFile(path, content) {
      return this._invoke('write_file', { path, content });
    },

    createFile(path) {
      return this._invoke('create_file', { path });
    },

    createDirectory(path) {
      return this._invoke('create_directory', { path });
    },

    renameNode(oldPath, newPath) {
      return this._invoke('rename_node', { oldPath, newPath });
    },

    deleteNode(path) {
      return this._invoke('delete_node', { path });
    },

    copyFileIntoFolder(destDir, filename, contentB64) {
      return this._invoke('copy_into_folder', { destDir, filename, contentB64 });
    },

    /* Copy an existing on-disk file (dropped via the native event) by path. */
    copyPathIntoFolder(srcPath, destDir) {
      return this._invoke('copy_path_into_folder', { srcPath, destDir });
    },

    /* Subscribe to Tauri's native OS drag-drop. WebKitGTK can't read dropped
       File bytes via HTML5 DnD, so on Tauri this is the ONLY reliable source
       of dropped files. handlers = { onOver(pos), onDrop(pos, paths), onLeave() };
       `pos` is a PhysicalPosition {x,y}. Resolves to an unlisten function. */
    async onNativeFileDrop(handlers) {
      const T = window.__TAURI__;
      const dispatch = (p) => {
        if (!p) return;
        if (p.type === 'over' || p.type === 'enter') handlers.onOver && handlers.onOver(p.position);
        else if (p.type === 'drop')                  handlers.onDrop && handlers.onDrop(p.position, p.paths || []);
        else if (p.type === 'leave')                 handlers.onLeave && handlers.onLeave();
      };
      // Preferred: the typed webview subscription.
      const wv =
        (T.webview && T.webview.getCurrentWebview && T.webview.getCurrentWebview()) ||
        (T.webviewWindow && T.webviewWindow.getCurrentWebviewWindow && T.webviewWindow.getCurrentWebviewWindow()) ||
        null;
      if (wv && typeof wv.onDragDropEvent === 'function') {
        return await wv.onDragDropEvent((e) => dispatch(e.payload));
      }
      // Fallback: raw event channels (event module is always present).
      const un = [];
      un.push(await T.event.listen('tauri://drag-enter', (e) => dispatch({ type: 'enter', ...e.payload })));
      un.push(await T.event.listen('tauri://drag-over',  (e) => dispatch({ type: 'over',  ...e.payload })));
      un.push(await T.event.listen('tauri://drag-drop',  (e) => dispatch({ type: 'drop',  ...e.payload })));
      un.push(await T.event.listen('tauri://drag-leave', (e) => dispatch({ type: 'leave', ...e.payload })));
      return () => un.forEach((f) => { try { f(); } catch (_) {} });
    },
    setVolatileContent(path, content) {
      debounceVolatile(path, content);
    },

_writeVolatileNow(path, content) {
  return this._invoke('set_volatile_content', { path, content });
},
/* Immediate volatile write (bypass debounce, but NOT the ordering chain) */
writeVolatileNow(path, content) {
  return _enqueueVolatileOp(() => this._invoke('set_volatile_content', { path, content }));
},

getVolatileContent(path) {
      return this._invoke('get_volatile_content', { path });
    },

    deleteVolatileContent(path) {
      cancelVolatile();
      return _enqueueVolatileOp(() => this._invoke('delete_volatile_content', { path }));
    },

    getVolatileStatus() {
      return this._invoke('get_volatile_status');
    },

    /* List crash backups whose originalPath starts with `prefix`,
       newest-first: [{ originalPath, ts }]. */
    listVolatileBackups(prefix) {
      return this._invoke('list_volatile_backups', { prefix });
    },

    showMessageBox(options) {
      // Tauri's native dialog also cannot honor defaultId/cancelId — with
      // OkCancelCustom the FIRST button is always the Enter-default, which
      // inverts safety dialogs designed with a non-destructive default
      // (crash recovery, "Discard and Quit", delete confirmation). Route
      // ALL 2+ button dialogs through the HTML fallback, which focuses
      // buttons[defaultId] and maps Escape to cancelId.
      const buttons = (options && Array.isArray(options.buttons)) ? options.buttons : [];
      if (buttons.length > 1) {
        return showHtmlMessageBox(options);
      }
      return this._invoke('show_message_box', { options });
    },


    /* Open a native OS Save dialog, write the file atomically, and return
       { saved: true, filePath } on success or { saved: false } on cancel. */
    saveFile(filename, content, options) {
    const updateRoot = !!(options && options.updateRoot);
    return this._invoke('save_file', { filename, content, updateRoot });
    },
    onWindowClose(callback) {
  /* Tauri v2: listen to the 'window-close-request' event emitted by Rust.
     listen() returns a Promise — we must let it settle so the listener is
     actually registered before any close event can arrive.               */
  window.__TAURI__.event.listen('window-close-request', () => callback())
    .catch(err => console.error('[NativeAPI] Failed to register close listener:', err));
},

    confirmClose() {
      this._invoke('confirm_close');
    },

    /* ── Frameless window controls ─────────────────────────────────── */
    minimizeWindow() {
      return this._invoke('minimize_window');
    },

    toggleMaximizeWindow() {
      return this._invoke('toggle_maximize_window');
    },

    /** Export the project folder as a .zip; Rust owns the save dialog. */
    exportProjectZip() {
      return this._invoke('export_project_zip');
    },

    /* No direct-to-PDF API in the webview (kept null so the exporter does
       NOT take Electron's direct-save branch). Instead Tauri uses a
       dedicated print window — see exportPdfWindow. */
    exportPdf: null,

    /* Tauri PDF: print a standalone document in a separate WebviewWindow —
       the ONLY approach that has proven reliable on WebKitGTK (the iframe,
       in-app @media print, and native WebKitPrintOperation attempts all
       produced broken output). The full self-contained export HTML is
       staged in localStorage (shared across same-origin windows) and
       pdf_print.html renders + prints it, with none of the live app present
       to pollute the layout.

       Hardened delivery chain:
       - UNIQUE window label per export (pdf-print-<ts>): Tauri's close()
         is async destruction, so a fixed label could collide with a
         still-dying window ("label already exists") on quick re-export.
         Stale windows from earlier exports are closed best-effort.
       - Staging retries once after clearing the previous payload (quota).
       - Rejects with a specific reason; the caller shows it to the user —
         it must NOT silently fall back to a worse renderer. */
    async exportPdfWindow(html) {
      const KEY = '__revery_pdf_payload__';
      try {
        localStorage.setItem(KEY, html);
      } catch (e1) {
        try {
          localStorage.removeItem(KEY);
          localStorage.setItem(KEY, html);
        } catch (e2) {
          throw new Error('The document is too large to hand to the print window (storage full).');
        }
      }

      const T = window.__TAURI__;
      const WW = T && T.webviewWindow && T.webviewWindow.WebviewWindow;
      if (!WW) throw new Error('The print window API is unavailable in this build.');

      /* Best-effort close of print windows from previous exports. Unique
         labels mean a lagging close can never collide with the new one. */
      try {
        const all = await T.webviewWindow.getAllWebviewWindows();
        for (const w of all) {
          if (w.label && w.label.startsWith('pdf-print')) { try { await w.close(); } catch (_) {} }
        }
      } catch (_) { /* enumeration unavailable — harmless */ }

      return await new Promise((resolve, reject) => {
        const w = new WW('pdf-print-' + Date.now(), {
          url: 'pdf_print.html',
          title: 'Export PDF',
          width: 820,
          height: 1040,
          focus: true,
        });
        w.once('tauri://created', () => resolve({ ok: true }));
        w.once('tauri://error', (ev) =>
          reject(new Error('The print window could not be opened: ' + JSON.stringify(ev && ev.payload))));
      });
    },

    /** LaTeX project zip: main.tex + images/ + bundled brand fonts (dialog in Rust). */
    exportLatexZip(tex, images, baseName, bundleFonts) {
      return this._invoke('export_latex_zip', { tex, images, baseName, bundleFonts: bundleFonts || [] });
    },

/* Triggers the existing CloseRequested flow → quit modal appears. */
    closeWindow() {
      return this._invoke('close_window');
    },

    /** Enter or exit native OS fullscreen. */
    setFullscreen(fullscreen) {
      return this._invoke('set_fullscreen', { fullscreen });
    },

/* ── File watching ────────────────────────────────────────────────────
       Per-path serialization: every watchFile and unwatchFile for a given
       path is chained onto _watchOpsByPath.get(path), so the backend's
       HashMap operations always arrive in a consistent order. Without this,
       a fire-and-forget unwatch followed by a fresh watch could race —
       unwatch arrives at the backend AFTER watch and removes the new
       watcher, leaving JS-state and backend-state inconsistent (audit #9).

       The serialization is per-path; different paths run concurrently.
       Electron does not need this layer because Node's single-threaded
       main loop serializes its IPC handlers at the OS level. */

    _serializeWatchOp(path, op) {
      const prev = this._watchOpsByPath.get(path) || Promise.resolve();
      // Continue regardless of previous outcome — pass `op` to both branches.
      const next = prev.then(op, op);
      // Anchor the chain to the SETTLED outcome so a thrown error in one op
      // doesn't poison every subsequent op for this path.
      this._watchOpsByPath.set(path, next.then(() => {}, () => {}));
      return next;
    },

    watchFile(path, callback) {
      return this._serializeWatchOp(path, () => this._installWatcher(path, callback));
    },

    unwatchFile(path) {
      return this._serializeWatchOp(path, () => this._removeWatcher(path));
    },

    /* Internal: install a watcher for `path`. Caller must hold the per-path
       chain lock (i.e. always invoked via _serializeWatchOp). */
    async _installWatcher(path, callback) {
      // If a previous watcher is still installed for this path, tear it down
      // first. Awaited — we MUST NOT race the backend's HashMap.
      if (this._watchUnlisteners.has(path)) {
        try { await this._removeWatcher(path); } catch (_) { /* proceed anyway */ }
      }

      const entry = { active: true, unlisten: null };

      // Subscribe to the event channel BEFORE the backend watcher fires.
      let unlisten;
      try {
        unlisten = await window.__TAURI__.event.listen('file-changed', (event) => {
          if (!entry.active) return;
          if (event.payload.path !== path) return;
          callback(event.payload.eventType, path);
        });
      } catch (err) {
        // listen() rejected — nothing to clean up, just propagate.
        throw err;
      }

      entry.unlisten = unlisten;
      this._watchUnlisteners.set(path, entry);

      try {
        await this._invoke('watch_file', { path });
      } catch (err) {
        // Backend rejected the watcher (e.g. path escapes root). Undo the
        // event subscription and the map entry before propagating.
        try { unlisten(); } catch (_) {}
        entry.active = false;
        if (this._watchUnlisteners.get(path) === entry) {
          this._watchUnlisteners.delete(path);
        }
        throw err;
      }
    },

    /* Internal: remove a watcher for `path`. Caller must hold the per-path
       chain lock (i.e. always invoked via _serializeWatchOp). */
    async _removeWatcher(path) {
      const entry = this._watchUnlisteners.get(path);
      if (entry) {
        entry.active = false;
        this._watchUnlisteners.delete(path);
        if (entry.unlisten) {
          try { entry.unlisten(); } catch (_) {}
        }
      }
      return this._invoke('unwatch_file', { path });
    },
    







    getLastOpenedFile() {
      return this._invoke('get_last_opened_file');
    },

    setLastOpenedFile(path) {
      return this._invoke('set_last_opened_file', { path });
    },

    clearLastOpenedFile() {
      return this._invoke('set_last_opened_file', { path: null });
    },

    getPendingRename() {
      return this._invoke('get_pending_rename');
    },

    setPendingRename(journal) {
      return this._invoke('set_pending_rename', { journal });
    },

    clearAllSettings() {
      return this._invoke('clear_all_settings');
    },
    getLastRootPath() {
      return this._invoke('get_last_root_path');
    },

    setLastRootPath(dirPath) {
      return this._invoke('set_last_root_path', { path: dirPath || null });
    },

    getProjectHistory() {
      return this._invoke('get_project_history');
    },

    setProjectHistory(arr) {
      // Rust receives a JSON string to avoid type-inference issues with serde
      return this._invoke('set_project_history', { history: JSON.stringify(arr) });
    },
    getAppDataPath() {
      return this._invoke('get_app_data_path');
    },

    getDefaultNotesFolder() {
      return this._invoke('get_default_notes_folder');
    },

    /** Open the OS file manager with the item revealed/selected. */
    showInExplorer(itemPath) {
      return this._invoke('show_in_folder', { path: itemPath });
    },

    /**
     * Convert an absolute filesystem path to a URL the Tauri webview can load.
     * Uses window.__TAURI__.core.convertFileSrc which returns an asset://
     * (or https://asset.localhost/) URL depending on platform.
     * The CSP in tauri.conf.json must allow "asset:" for this to work.
     */
    toMediaUrl(absolutePath) {
      // Decode so Tauri gets the actual OS path (spaces intact, not %20)
      try { absolutePath = decodeURI(absolutePath); } catch (e) {}
      
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) {
        return window.__TAURI__.core.convertFileSrc(absolutePath);
      }
      return absolutePath;
    },
  };


  /* ══════════════════════════════════════════════════════════════════════
     WEB FALLBACK IMPLEMENTATION
     Most native FS operations are unavailable. Where the File System
     Access API (FSA) is supported, basic read/write is attempted.
     Anything requiring native OS dialogs throws a clear "not supported"
     error so callers can degrade gracefully.
  ══════════════════════════════════════════════════════════════════════ */
  const webImpl = {

    /* The FSA API gives directory handles but NOT real filesystem paths.
       We maintain a small internal map: pseudo-path → FileSystemHandle. */
    _handles: new Map(),
    _rootHandle: null,
    _rootName: null,

    async openFolderDialog() {
      if (!('showDirectoryPicker' in window)) return notSupported('openFolderDialog');
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this._rootHandle = handle;
      this._rootName   = handle.name;
      this._handles.set(handle.name, handle);
      return handle.name; // The pseudo "path" for the root
    },

    setRootPath(_dirPath) { return Promise.resolve(); },

    async readDirectory(path) {
      if (!this._rootHandle) return notSupported('readDirectory');
      const handle = path === this._rootName
        ? this._rootHandle
        : this._handles.get(path);
      if (!handle) throw new Error(`Unknown path: ${path}`);
      const entries = [];
      for await (const [name, child] of handle.entries()) {
        const childPath = path + '/' + name;
        this._handles.set(childPath, child);
        entries.push({
          name,
          path: childPath,
          type: child.kind === 'directory' ? 'dir' : 'file',
        });
      }
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return entries;
    },

    async readFile(path) {
      const handle = this._handles.get(path);
      if (!handle || handle.kind !== 'file') throw new Error(`Cannot read: ${path}`);
      const file = await handle.getFile();
      return file.text();
    },

    async writeFile(path, content) {
      const handle = this._handles.get(path);
      if (!handle || handle.kind !== 'file') throw new Error(`Cannot write: ${path}`);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },

    createFile: ()      => notSupported('createFile'),
    createDirectory: () => notSupported('createDirectory'),
    renameNode: ()      => notSupported('renameNode'),
    deleteNode: ()      => notSupported('deleteNode'),
    copyFileIntoFolder: () => notSupported('copyFileIntoFolder'),
    copyPathIntoFolder: () => notSupported('copyPathIntoFolder'),
    onNativeFileDrop: () => Promise.resolve(() => {}),

    _writeVolatileNow() { return Promise.resolve(); },
    /* Immediate volatile write (bypass debounce) */
    writeVolatileNow(path, content) {
      try {
        localStorage.setItem('revery_volatile_backup', JSON.stringify({ path, content, ts: Date.now() }));
      } catch (e) { /* ignore */ }
      return Promise.resolve();
    },

    getVolatileContent(_path) {
      try {
        const raw = localStorage.getItem('revery_volatile_backup');
        if (!raw) return Promise.resolve(null);
        const data = JSON.parse(raw);
        if (data.path !== _path) return Promise.resolve(null);
        return Promise.resolve({ content: data.content, ts: data.ts, originalPath: data.path });
      } catch { return Promise.resolve(null); }
    },

    deleteVolatileContent(_path) {
      clearTimeout(_volatileTimer);
      try { localStorage.removeItem('revery_volatile_backup'); } catch { /* ignore */ }
      return Promise.resolve();
    },

    getVolatileStatus() {
      return Promise.resolve({ ready: false, error: 'Browser environment — no crash backup' });
    },

    /* Web keeps at most one backup slot; debounced scratchpad writes are
       no-ops here, so this returns [] in practice. Provided for API parity. */
    async listVolatileBackups(prefix) {
      try {
        const raw = localStorage.getItem('revery_volatile_backup');
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (data && typeof data.path === 'string' && data.path.startsWith(prefix)) {
          return [{ originalPath: data.path, ts: data.ts || 0 }];
        }
      } catch { /* ignore */ }
      return [];
    },
    showMessageBox(options) {
      /* Degrade to browser confirm/alert */
      
      const text    = options.message || '';
      const detail  = options.detail  || '';
      if (options.type === 'question' && options.buttons) {
        const ok = window.confirm(`${text}\n\n${detail}`);
        return Promise.resolve({ response: ok ? 0 : 1 });
      }
      window.alert(`${text}\n\n${detail}`);
      return Promise.resolve({ response: 0 });
    },
    /* Web mode has no cancel-detection for blob downloads; preserve existing
       behaviour by always reporting success (matches the old 500 ms timer). */
    saveFile(_filename, _content) {
      return Promise.resolve({ saved: true });
    },
    onWindowClose(callback) {
      /* In web mode, hook beforeunload as a rough equivalent */
      window.addEventListener('beforeunload', () => callback());
    },

    confirmClose() { /* no-op in web */ },

/* ── Frameless window controls (no-op in web mode) ─────────────── */
    minimizeWindow()       { /* no-op */ },
    toggleMaximizeWindow() { /* no-op */ },
    closeWindow()          { /* no-op */ },
    setFullscreen()        { return Promise.resolve(); },

    watchFile: () => notSupported('watchFile'),
    unwatchFile: () => Promise.resolve(),
    exportProjectZip: () => notSupported('exportProjectZip'),
    exportPdf: null,          // exporter uses the print-iframe path
    exportLatexZip: null,     // exporter falls back to single-.tex download

    async getLastOpenedFile() {
      try {
        const s = JSON.parse(localStorage.getItem('revery_last_file') || 'null');
        return s;
      } catch { return null; }
    },

    async setLastOpenedFile(path) {
      try {
        localStorage.setItem('revery_last_file', JSON.stringify(path));
      } catch { /* ignore */ }
    },

    async clearLastOpenedFile() {
      localStorage.removeItem('revery_last_file');
    },

    async getPendingRename() {
      try {
        const raw = localStorage.getItem('revery_pending_rename');
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (j && typeof j.from === 'string' && typeof j.to === 'string') return j;
        return null;
      } catch { return null; }
    },

    async setPendingRename(journal) {
      try {
        if (journal === null || journal === undefined) {
          localStorage.removeItem('revery_pending_rename');
        } else if (typeof journal === 'object'
                   && typeof journal.from === 'string'
                   && typeof journal.to   === 'string') {
          localStorage.setItem('revery_pending_rename', JSON.stringify({
            from: journal.from,
            to:   journal.to,
            ts:   Number(journal.ts) || Date.now(),
          }));
        }
      } catch { /* ignore */ }
    },

    async clearAllSettings() {
      // Web: clear editor state and recovery data, but preserve the project
      // folder hint (revery_root_path) and the project list (revery_projects,
      // already untouched here) so the user does not have to re-pick their
      // folder after a Total Reset. Mirrors desktop behavior where
      // lastRootPath / projectHistory / trustedRoots are preserved.
      try {
        localStorage.removeItem('revery_md_autosave');
        localStorage.removeItem('revery_md_settings');
        localStorage.removeItem('revery_last_file');
        localStorage.removeItem('revery_pending_rename');
        localStorage.removeItem('revery_volatile_backup');
      } catch { /* ignore */ }
    },
    async getLastRootPath() {
      try { return localStorage.getItem('revery_root_path') || null; } catch { return null; }
    },

    async setLastRootPath(dirPath) {
      try {
        if (dirPath) localStorage.setItem('revery_root_path', dirPath);
        else localStorage.removeItem('revery_root_path');
      } catch { /* ignore */ }
    },

    async getProjectHistory() {
      try {
        const raw = localStorage.getItem('revery_projects');
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch { return []; }
    },

    async setProjectHistory(arr) {
      try { localStorage.setItem('revery_projects', JSON.stringify(arr)); } catch { /* ignore */ }
    },

    async getAppDataPath() {
      return null; /* not applicable */
    },

    async getDefaultNotesFolder() {
      return null; /* not applicable in web mode */
    },

    /** In web mode local images are already relative to the page – return as-is. */
    toMediaUrl(absolutePath) { return absolutePath; },

    showInExplorer() { /* not applicable in web mode */ },
  };


  /* ── Assemble the final NativeAPI object ─────────────────────────────── */
  const impl = isTauri ? tauriImpl : isElectron ? electronImpl : webImpl;

  window.NativeAPI = Object.assign(
    {
      /** Current runtime environment: 'electron' | 'tauri' | 'web' */
      env: ENV,
      /** True when running inside a native desktop wrapper. */
      isDesktop: isTauri || isElectron,
    },
    impl
  );

  console.info(`[NativeAPI] Initialized in "${ENV}" mode.`);

  /* ── Frameless window control wiring ─────────────────────────────────────
     Runs after the DOM is ready.  In web mode isDesktop is false so nothing
     happens.  Avoids any inline <script> that would require a new CSP hash. */
document.addEventListener('DOMContentLoaded', function () {
    if (!window.NativeAPI.isDesktop) return;

    /* Mark body so CSS can activate -webkit-app-region:drag on the topbar */
    document.body.classList.add('desktop-app');

    /* ── Block WebView page-zoom gestures (Tauri only) ──────────────────
       Electron disables pinch / visual zoom by default; WebKitGTK does
       not, so on Tauri a trackpad pinch (and Ctrl + wheel) zooms the
       WHOLE app — annoying when the user only meant to scroll. This is
       WebView chrome, unrelated to the app's own UI-size setting (that's
       CSS on <html>). We suppress ONLY the zoom vectors:
         • Ctrl + wheel  (page zoom; trackpad pinch synthesizes this on
           macOS/Windows) — plain wheel scroll is left untouched;
         • the WebKit gesture events (WKWebView trackpad pinch).
       Nothing in the app uses Ctrl+wheel or gesture events, so there is
       no behaviour to override. Note: on Linux WebKitGTK a trackpad
       pinch may be consumed natively before it reaches JS — verify on
       the built app; if it persists there it needs a webview-level
       (Rust) change instead. */
    if (isTauri) {
      window.addEventListener('wheel', function (e) {
        if (e.ctrlKey) e.preventDefault();
      }, { passive: false, capture: true });
      ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
        window.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
      });
    }

    /* On macOS the native traffic-light buttons handle Min/Max/Close, so we
       hide our custom HTML buttons and keep the topbar draggable only.      */
    if (navigator.userAgent.includes('Macintosh')) {
      document.body.classList.add('is-macos');
    }

    var btnMin   = document.getElementById('win-btn-min');
    var btnMax   = document.getElementById('win-btn-max');
    var btnClose = document.getElementById('win-btn-close');

    if (btnMin)   btnMin.addEventListener('click',   function () { window.NativeAPI.minimizeWindow(); });
    if (btnMax)   btnMax.addEventListener('click',   function () { window.NativeAPI.toggleMaximizeWindow(); });

    /* Double-click the drag bar to toggle maximize. On Electron the
       topbar is a native drag region (-webkit-app-region: drag), so the
       OS handles this gesture already — we only wire it for Tauri, whose
       data-tauri-drag-region does not toggle-maximize on double-click
       here. Gating to isTauri also prevents any double-toggle. Ignore
       double-clicks that land on interactive controls (buttons, inputs,
       menus) — only the bare drag region maximizes, matching a native
       titlebar. */
    if (isTauri) {
      var topbar = document.getElementById('topbar');
      if (topbar) {
        topbar.addEventListener('dblclick', function (e) {
          if (e.target.closest('button, input, select, textarea, a, .menu-container, #doc-title')) return;
          window.NativeAPI.toggleMaximizeWindow();
        });
      }
    }

        if (btnClose) {


btnClose.addEventListener('click', async function () {
        /* Cluster D #8: delegate to the single source of truth for close
           logic, defined in project_sidebar.js as sidebarHandleClose.
           Both the OS-close and in-app-close paths now share that function,
           so they cannot drift out of sync. */
        try {
            if (typeof window.sidebarHandleClose === 'function') {
                await window.sidebarHandleClose();
                return;
            }
            // Fallback for the rare case where sidebar hasn't loaded yet
            // (e.g. user clicks close mid-boot). Best-effort straight close.
            console.warn('[Close] sidebarHandleClose not yet defined — closing without save check.');
            window.isQuitting = true;
            window.NativeAPI.confirmClose();
        } catch (err) {
            console.error('[Close] Unexpected error during close:', err);
            // Last-resort: never leave the user with a window that won't close.
            try {
                window.isQuitting = true;
                window.NativeAPI.confirmClose();
            } catch (_) { /* nothing else we can do */ }
        }
    });


}
    /* ── Fullscreen helpers ───────────────────────────────────────────
       Tracks native fullscreen state and hides the window control buttons
       while fullscreen is active. Exposed as window.NativeAPI.* so the
       keyboard shortcut handler in markdown_editor_actions_cm.js can call
       them without knowing which backend (Tauri/Electron/web) is active. */
    var fsStyle = document.createElement('style');
    fsStyle.id  = 'revery-fullscreen-style';
    fsStyle.textContent =
      'body.is-fullscreen #win-btn-min,' +
      'body.is-fullscreen #win-btn-max,' +
      'body.is-fullscreen #win-btn-close { display: none !important; }';
    document.head.appendChild(fsStyle);

    window.NativeAPI.isFullscreen = false;

    window.NativeAPI.enterFullscreen = function () {
      window.NativeAPI.isFullscreen = true;
      document.body.classList.add('is-fullscreen');
      window.NativeAPI.setFullscreen(true).catch(function (e) {
        console.warn('[NativeAPI] enterFullscreen failed:', e);
      });
    };

    window.NativeAPI.exitFullscreen = function () {
      window.NativeAPI.isFullscreen = false;
      document.body.classList.remove('is-fullscreen');
      window.NativeAPI.setFullscreen(false).catch(function (e) {
        console.warn('[NativeAPI] exitFullscreen failed:', e);
      });
    };

    window.NativeAPI.toggleFullscreen = function () {
      if (window.NativeAPI.isFullscreen) {
        window.NativeAPI.exitFullscreen();
      } else {
        window.NativeAPI.enterFullscreen();
      }
    };
  });
})();

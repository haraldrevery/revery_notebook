/* In-page driver for the file-history E2E. Evaluated by executeJavaScript
   from file_history_e2e_main.js inside the REAL Electron renderer. Must be
   a single expression resolving to a JSON-serializable object. Reports
   FACTS; test/file_history_e2e.test.js holds the assertions. Menus, drags,
   dialogs and keys go through the DOM, as a user's would. */
(async () => {
  const REAL  = __REAL__;
  const OTHER = __OTHER__;
  const MODE  = __MODE__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(40);
    }
    return null;
  };
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const tree = document.getElementById('sidebar-tree');
  const nameOf = (el) => norm(el.dataset.path).split('/').pop();
  const row = (name) => [...document.querySelectorAll('.sidebar-item')].find((el) => nameOf(el) === name);
  const names = async (rel) => {
    try {
      return (await window.NativeAPI.readDirectory(rel ? REAL + '/' + rel : REAL)).map((e) => e.name).sort();
    } catch (_) { return null; }
  };
  const has  = async (rel, name) => ((await names(rel)) || []).includes(name);
  const read = async (rel) => { try { return await window.NativeAPI.readFile(REAL + '/' + rel); } catch (_) { return null; } };

  const drag = async (srcEl, targetEl) => {
    const dt = new DataTransfer();
    srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    srcEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  };
  const menu = async (el, label) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    const btn = [...document.querySelectorAll('#context-menu .menu-item')].find((b) => b.textContent === label);
    if (btn) btn.click(); else document.body.click();
    return !!btn;
  };
  const overlay = () => document.querySelector('.revery-input-overlay');
  const typeInDialog = async (value) => {
    const f = await until(() => document.querySelector('.revery-input-overlay .revery-input-field'));
    if (!f) throw new Error('no input dialog appeared for "' + value + '"');
    f.value = value;
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  /* The "Update N link(s)…?" question (an in-page dialog). */
  const answerLinks = async (ok) => {
    const b = await until(() => document.querySelector('.revery-input-overlay ' + (ok ? '.revery-input-ok' : '.revery-input-cancel')));
    if (b) b.click();
    await until(() => !overlay());
    return !!b;
  };
  const keys = (target, key, extra) => target.dispatchEvent(new KeyboardEvent('keydown',
    Object.assign({ key, ctrlKey: true, bubbles: true, cancelable: true }, extra || {})));
  const ctrlZ      = (t) => keys(t || document.body, 'z');
  const ctrlY      = (t) => keys(t || document.body, 'y');
  const ctrlShiftZ = (t) => keys(t || document.body, 'Z', { shiftKey: true });
  /* Work in the file panel: nothing else focused, last press in the panel. */
  const inPanel = () => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    tree.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  };
  const status = () => (document.getElementById('size-warning') || {}).textContent || '';

  /* Every message box the renderer opens (the main process answers). */
  const boxes = [];
  const origBox = window.NativeAPI.showMessageBox.bind(window.NativeAPI);
  window.NativeAPI.showMessageBox = (opts) => {
    const o = opts || {};
    boxes.push({ title: o.title || '', buttons: o.buttons || [], defaultId: o.defaultId, cancelId: o.cancelId });
    return origBox(opts);
  };

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = { mode: MODE };

  if (MODE === 'noproject') {
    /* ── The last project folder is missing at start ─────────────────── */
    out.booted = !!(await until(() => typeof window.sidebarGetRootPath === 'function'
      && editor.value.includes('# Revery Notebook'), 12000));
    await sleep(1500);
    out.rootAtStart = window.sidebarGetRootPath();
    /* HARD GUARD: only ever act with no project, then in the temp one. */
    if (!out.booted || out.rootAtStart) { out.booted = false; return out; }
    try {
      const PREFIX = '__revery_scratchpad__/';
      const len = window.cmView.state.doc.length;
      window.insertWithUndo(len, len, '\nMY THESIS NOTES');
      await sleep(2800); // the crash backup is debounced (2 s)
      const backups = await window.NativeAPI.listVolatileBackups(PREFIX);
      out.backupCount = backups.length;
      out.backupHasText = false;
      for (const b of backups) {
        const c = await window.NativeAPI.getVolatileContent(b.originalPath);
        if (c && String(c.content).includes('MY THESIS NOTES')) out.backupHasText = true;
      }

      const before = editor.value;
      await window.sidebarImportFile();
      out.importKeptText = editor.value === before;
      await window.sidebarCreateNewFile();
      out.newFileKeptText = editor.value === before;

      document.getElementById('sidebar-open-folder').click();
      out.openedOther = !!(await until(() => norm(window.sidebarGetRootPath()) === norm(OTHER), 8000));
      out.noteCreated = !!(await until(() => window.sidebarGetActiveFilePath(), 8000));
      out.activeAfterOpen = norm(window.sidebarGetActiveFilePath()).replace(norm(OTHER), '');
      out.editorKeptText = editor.value.includes('MY THESIS NOTES');
      await sleep(1200);
      out.noteOnDisk = window.sidebarGetActiveFilePath()
        ? await window.NativeAPI.readFile(window.sidebarGetActiveFilePath()) : null;
      out.backupsAfter = (await window.NativeAPI.listVolatileBackups(PREFIX)).length;
    } catch (err) {
      out.error = String((err && err.stack) || err);
    }
    out.boxes = boxes;
    out.pageErrors = pageErrors;
    return out;
  }

  out.booted = !!(await until(() => window.NativeAPI && typeof window.sidebarGetActiveFilePath === 'function'
    && row('note.md') && norm(window.sidebarGetActiveFilePath()).endsWith('/note.md'), 12000));
  out.root = norm(window.sidebarGetRootPath && window.sidebarGetRootPath());
  /* HARD GUARD: only ever act inside the seeded temp project. */
  if (!out.booted || out.root !== norm(REAL)) { out.booted = false; return out; }
  await sleep(300);
  try {

  out.step = 'A';
  /* ── A. Links declined on a move: undo and redo never touch them ─── */
  if (!row('A').classList.contains('expanded')) row('A').click();
  await until(() => row('n.md'));
  out.A_moveUpOffered = await menu(row('n.md'), 'Move up one level');
  out.A_prompted = await answerLinks(false); // "Cancel": keep every link as it is
  await until(async () => has('', 'n.md'));
  out.A_afterMove = await read('n.md');
  inPanel(); ctrlZ();
  await until(async () => has('A', 'n.md'));
  await sleep(700);
  out.A_promptOnUndo = !!overlay();
  out.A_afterUndo = await read('A/n.md');
  out.A_undoStatus = status();
  inPanel(); ctrlY();
  await until(async () => has('', 'n.md'));
  await sleep(700);
  out.A_promptOnRedo = !!overlay();
  out.A_afterRedo = await read('n.md');
  out.A_redoStatus = status();

  out.step = 'B';
  /* ── B. Links updated on a move: undo and redo follow, unasked ───── */
  await drag(row('mv.md'), row('sub'));
  out.B_prompted = await answerLinks(true);
  await until(async () => (await read('links.md')) === 'See [mv](sub/mv.md).\n');
  out.B_linksAfterMove = await read('links.md');
  inPanel(); ctrlZ();
  await until(async () => (await has('', 'mv.md')) && (await read('links.md')) === 'See [mv](mv.md).\n');
  out.B_promptOnUndo = !!overlay();
  out.B_linksAfterUndo = await read('links.md');
  out.B_undoStatus = status();
  inPanel(); ctrlY();
  await until(async () => (await has('sub', 'mv.md')) && (await read('links.md')) === 'See [mv](sub/mv.md).\n');
  out.B_promptOnRedo = !!overlay();
  out.B_linksAfterRedo = await read('links.md');
  out.B_redoStatus = status();

  out.step = 'C';
  /* ── C. Ctrl+Y / Ctrl+Shift+Z redo only from the file panel ──────── */
  inPanel(); ctrlZ(); // mv.md back at the root: a redo is waiting
  await until(async () => (await has('', 'mv.md')) && (await read('links.md')) === 'See [mv](mv.md).\n');
  const title = document.getElementById('doc-title');
  title.focus(); ctrlY(title); ctrlShiftZ(title);
  await sleep(900);
  out.C_afterKeysInTitle_root = await names('');
  title.blur();
  window.cmView.focus(); ctrlY(window.cmView.contentDOM);
  await sleep(900);
  out.C_afterCtrlYInEditor_root = await names('');
  window.cmView.contentDOM.blur();
  inPanel(); ctrlShiftZ();
  await until(async () => has('sub', 'mv.md'));
  out.C_afterPanelCtrlShiftZ_sub = await names('sub');
  await until(async () => (await read('links.md')) === 'See [mv](sub/mv.md).\n');

  out.step = 'D';
  /* ── D. A new operation ends the redo chain ───────────────────────── */
  inPanel(); ctrlZ(); // mv.md back at the root: a redo is waiting
  await until(async () => (await has('', 'mv.md')) && (await read('links.md')) === 'See [mv](mv.md).\n');
  await menu(row('a.md'), 'Rename');
  await typeInDialog('b');
  await until(async () => has('', 'b.md'));
  await sleep(500);
  inPanel(); ctrlY();
  await sleep(1200);
  out.D_afterCtrlY_root = await names('');
  out.D_afterCtrlY_sub = await names('sub');

  out.step = 'E';
  /* ── E. A delete ends the file history ────────────────────────────── */
  await menu(row('junk.md'), 'Delete');
  await until(async () => !(await has('', 'junk.md')));
  await sleep(400);
  inPanel(); ctrlZ();
  await sleep(1200);
  out.E_afterCtrlZ_root = await names('');

  out.step = 'F';
  /* ── F. Autosave never applies a title that is still being typed ─── */
  out.F_active = norm(window.sidebarGetActiveFilePath()).split('/').pop();
  const len = window.cmView.state.doc.length;
  window.insertWithUndo(len, len, 'typed ');
  title.focus();
  title.value = 'note-final';
  title.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(2800); // autosave (1.5 s) has run meanwhile
  out.F_whileTyping_root = await names('');
  out.F_contentSavedWhileTyping = await read('note.md');
  out.F_titleWhileTyping = title.value;
  title.blur();
  title.dispatchEvent(new Event('change', { bubbles: true })); // leaving the field commits the name
  await until(async () => has('', 'note-final.md'));
  out.F_afterCommit_root = await names('');

  out.step = 'G';
  /* ── G. "File Changed Externally": the default never discards ────── */
  const b0 = boxes.length;
  const l2 = window.cmView.state.doc.length;
  window.insertWithUndo(l2, l2, 'dirty ');
  await window.NativeAPI.writeFile(window.sidebarGetActiveFilePath(), 'EXTERNAL\n'); // another program
  await until(() => boxes.slice(b0).some((b) => b.title === 'File Changed Externally'), 8000);
  out.G_dirtyBox = boxes.slice(b0).find((b) => b.title === 'File Changed Externally') || null;
  await sleep(800);
  row('ext.md').click();
  await until(() => norm(window.sidebarGetActiveFilePath()).endsWith('/ext.md'));
  await sleep(600);
  const b1 = boxes.length;
  await window.NativeAPI.writeFile(window.sidebarGetActiveFilePath(), 'EXTERNAL 2\n');
  await until(() => boxes.slice(b1).some((b) => b.title === 'File Changed Externally'), 8000);
  out.G_cleanBox = boxes.slice(b1).find((b) => b.title === 'File Changed Externally') || null;
  await sleep(500);

  } catch (err) {
    out.error = String((err && err.stack) || err);
  }
  out.pageErrors = pageErrors;
  return out;
})()

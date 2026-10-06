/* In-page driver for the file-operations E2E. Evaluated by
   executeJavaScript from file_ops_e2e_main.js inside the REAL Electron
   renderer. Must be a single expression resolving to a JSON-serializable
   object. Reports FACTS; test/file_ops_e2e.test.js holds the assertions.
   Drags are real DragEvents with a real DataTransfer (as in
   media_e2e_driver.js); menus, dialogs and keys go through the DOM. */
(async () => {
  const PROJECT = __PROJECT__;   // as opened (a symlink in MODE=symlink)
  const REAL    = __REAL__;      // the real folder
  const MODE    = __MODE__;
  const LINKS   = __LINKS__;   // { relative, kind } — see file_ops_e2e_main.js
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
  const find = (sel, name) => [...document.querySelectorAll(sel)].find((el) => nameOf(el) === name);
  const row  = (name) => find('.sidebar-item', name);
  const card = (name) => find('.sidebar-card', name);
  const names = async (rel) => {
    try {
      return (await window.NativeAPI.readDirectory(rel ? REAL + '/' + rel : REAL)).map((e) => e.name).sort();
    } catch (_) { return null; }
  };
  const has = async (rel, name) => ((await names(rel)) || []).includes(name);

  const drag = async (srcEl, targetEl) => {
    const dt = new DataTransfer();
    srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const lit = targetEl.classList.contains('drop-target');
    targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    srcEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return lit;
  };
  const menu = async (el, label) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    const items = [...document.querySelectorAll('#context-menu .menu-item')];
    const labels = items.map((b) => b.textContent);
    const btn = items.find((b) => b.textContent === label);
    if (btn) btn.click(); else document.body.click();
    return { labels, clicked: !!btn };
  };
  const overlay = () => document.querySelector('.revery-input-overlay');
  const typeInDialog = async (value) => {
    const f = await until(() => document.querySelector('.revery-input-overlay .revery-input-field'));
    if (!f) throw new Error('no input dialog appeared for "' + value + '"');
    f.value = value;
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  const lastDialog = (from) => window.__fileOpsDialogs.slice(from);
  const ctrlZ = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  const panelPress = () => tree.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const status = () => (document.getElementById('size-warning') || {}).textContent || '';

  /* Every native message box the file operations open, recorded here
     (the main process answers them — see file_ops_e2e_main.js). */
  window.__fileOpsDialogs = [];
  const origBox = window.NativeAPI.showMessageBox.bind(window.NativeAPI);
  window.NativeAPI.showMessageBox = (opts) => {
    window.__fileOpsDialogs.push({ title: (opts && opts.title) || '', message: (opts && opts.message) || '', detail: (opts && opts.detail) || '' });
    return origBox(opts);
  };

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = { mode: MODE };
  out.booted = !!(await until(() => window.NativeAPI && typeof window.sidebarGetActiveFilePath === 'function'
    && row('note.md') && norm(window.sidebarGetActiveFilePath()).endsWith('/note.md'), 12000));
  /* HARD GUARD: only ever act inside the seeded temp project. */
  out.root = norm(window.sidebarGetRootPath && window.sidebarGetRootPath());
  if (!out.booted || !(out.root === norm(REAL) || out.root === norm(PROJECT))) {
    out.booted = false;
    return out;
  }
  await sleep(300);
  try {

  /* The root the renderer adopted and the open note's spelling. */
  out.rootIsCanonical = out.root === norm(REAL);
  out.activeIsCanonical = norm(window.sidebarGetActiveFilePath()) === norm(REAL) + '/note.md';

  if (MODE === 'symlink') {
    /* A file dropped on empty space of its own folder stays as it is
       (it used to become a_2.md when the root was opened through a link). */
    await drag(row('a.md'), tree);
    await sleep(600);
    out.symRootAfterOwnFolderDrop = await names('');

    /* Card view: no Back / path-bar escape above the project root. */
    document.getElementById('sidebar-view-btn').click();
    await until(() => card('sub'));
    out.symBackAtRoot = !!document.querySelector('.sidebar-card-back');
    out.symSegAtRoot = document.querySelectorAll('.sidebar-card-seg').length;
    card('sub').click();
    await until(() => card('inner.md'));
    const seg = document.querySelector('.sidebar-card-seg');
    out.symRootSegPath = seg ? norm(seg.dataset.dropDir) : null;
    document.getElementById('sidebar-view-btn').click();
    await until(() => row('note.md'));
    out.pageErrors = pageErrors;
    return out;
  }

  out.step = '1';
  /* ── 1. Card view: path bar; drop on the root segment moves up ─────── */
  document.getElementById('sidebar-view-btn').click();
  await until(() => card('sub'));
  card('sub').click();
  await until(() => card('inner.md'));
  const segs = [...document.querySelectorAll('.sidebar-card-seg')];
  out.pathBarSegs = segs.map((s) => s.textContent);
  out.pathBarCrumb = (document.querySelector('.sidebar-card-path .sidebar-card-crumb') || {}).textContent || null;
  out.rootSegLit = await drag(card('inner.md'), segs[0]);
  await until(async () => has('', 'inner.md'));
  out.afterSegDrop_root = await names('');
  out.afterSegDrop_sub  = await names('sub');
  out.cardViewStillSub = norm((document.querySelector('.sidebar-card-path .sidebar-card-crumb, .sidebar-card-crumb') || {}).title).endsWith('/sub');

  out.step = '2';
  /* ── 2. Narrow panel: compact bar, "← Back" is a drop target ──────── */
  card('deep').click();
  await until(() => card('x.md'));
  const panel = document.getElementById('project-sidebar');
  const oldWidth = panel.style.width;
  const oldMin = panel.style.minWidth;
  panel.style.minWidth = '0px';
  panel.style.width = '70px';
  await until(() => document.querySelector('.sidebar-card-back'), 3000);
  const back = document.querySelector('.sidebar-card-back');
  out.compactBack = !!back;
  out.compactBackTarget = back ? norm(back.dataset.dropDir) : null;
  out.compactNoPathBar = !document.querySelector('.sidebar-card-path');
  if (back) {
    out.backLit = await drag(card('x.md'), back);
    await until(async () => has('sub', 'x.md'));
  }
  out.afterBackDrop_sub  = await names('sub');
  out.afterBackDrop_deep = await names('sub/deep');
  panel.style.width = oldWidth;
  panel.style.minWidth = oldMin;
  await sleep(300);

  /* Back to the root: no Back button, no segment above the root. */
  const rootSeg = document.querySelector('.sidebar-card-seg');
  if (rootSeg) rootSeg.click(); else if (document.querySelector('.sidebar-card-back')) document.querySelector('.sidebar-card-back').click();
  await until(() => card('sub') && !card('x.md'));
  if (document.querySelector('.sidebar-card-back')) { document.querySelector('.sidebar-card-back').click(); await sleep(300); }
  await until(() => card('note.md'));
  out.atRootBack = !!document.querySelector('.sidebar-card-back');
  out.atRootSegs = document.querySelectorAll('.sidebar-card-seg').length;

  document.getElementById('sidebar-view-btn').click(); // back to the tree
  await until(() => row('note.md'));

  out.step = '3';
  /* ── 3. "Move to…" (tree): picker, then the link update confirm ───── */
  let d0 = window.__fileOpsDialogs.length;
  const m1 = await menu(row('mv.md'), 'Move to…');
  out.fileMenuLabels = m1.labels;
  const pickerRows = await until(() => {
    const rows = [...document.querySelectorAll('.revery-folder-row')];
    return rows.length ? rows : null;
  });
  out.pickerRowsForFile = (pickerRows || []).map((r) => ({ text: r.textContent, disabled: r.disabled }));
  const subRow = (pickerRows || []).find((r) => r.textContent === 'sub');
  if (subRow) {
    subRow.click();
    document.querySelector('.revery-folder-picker .revery-input-ok').click();
  }
  /* The link update confirmation (in-page) — accept it. */
  const confirmOk = await until(() => {
    const o = overlay();
    return o && !o.querySelector('.revery-input-field') ? o.querySelector('.revery-input-ok') : null;
  });
  if (confirmOk) confirmOk.click();
  await until(async () => has('sub', 'mv.md'));
  await sleep(400);
  out.afterMoveTo_sub = await names('sub');
  out.linksAfterMoveTo = await window.NativeAPI.readFile(REAL + '/links.md');

  /* Picker for a FOLDER: never itself or below; its folder is "current". */
  await until(() => row('sub'));
  await menu(row('sub'), 'Move to…');
  const folderRows = await until(() => {
    const rows = [...document.querySelectorAll('.revery-folder-row')];
    return rows.length ? rows : null;
  });
  out.pickerRowsForFolder = (folderRows || []).map((r) => ({ text: r.textContent, disabled: r.disabled }));
  document.querySelector('.revery-folder-picker .revery-input-cancel').click();
  await until(() => !overlay());

  out.step = '4';
  /* ── 4. Ctrl+Z: never from a text field; yes after working in the panel */
  const title = document.getElementById('doc-title');
  title.focus();
  ctrlZ(title);
  await sleep(700);
  out.afterCtrlZInTitle_sub = await names('sub');
  title.blur();
  panelPress();
  ctrlZ(document.body);
  await until(async () => has('', 'mv.md'));
  await sleep(500);
  out.afterPanelCtrlZ_root = await names('');
  out.undoStatus = status();

  out.step = '5';
  /* ── 5. "Move up one level" ───────────────────────────────────────── */
  expandTo: {
    const subDir = row('sub');
    if (!subDir) break expandTo;
    if (!subDir.classList.contains('expanded')) subDir.click();
    await until(() => row('deep'));
    if (!row('deep').classList.contains('expanded')) row('deep').click();
    await until(() => row('y.md'));
  }
  const up = row('y.md') ? await menu(row('y.md'), 'Move up one level') : { clicked: false, labels: [] };
  out.moveUpOffered = up.clicked;
  await until(async () => has('sub', 'y.md'));
  out.afterMoveUp_sub = await names('sub');
  const rootMenu = await menu(row('note.md'), '__none__');
  out.rootItemMenuLabels = rootMenu.labels;

  out.step = '6';
  /* ── 6. Links: moved as links; relative ones not moved away; delete ── */
  await drag(row('abslink'), row('box'));
  await until(async () => has('box', 'abslink'));
  out.afterAbsLinkMove_box = await names('box');
  if (LINKS.relative) {
    d0 = window.__fileOpsDialogs.length;
    await drag(row('rellink'), row('box'));
    await until(() => lastDialog(d0).length);
    out.relLinkDialogs = lastDialog(d0);
    out.afterRelLinkMove_root = await names('');
  } // else: no relative link here (Windows without symlink rights) — "rellink" is absolute
  out.linkRowMarked = !!(row('rellink') && row('rellink').classList.contains('sidebar-link')
    && row('a.md') && !row('a.md').classList.contains('sidebar-link'));
  d0 = window.__fileOpsDialogs.length;
  const linkMenu = await menu(row('rellink'), 'Delete');
  out.linkMenuLabels = linkMenu.labels;
  await until(async () => !(await has('', 'rellink')));
  out.linkDeleteDialogs = lastDialog(d0);

  out.step = '7';
  /* ── 7. Rename rules (context menu + dialog) ──────────────────────── */
  await menu(row('note.md'), 'Rename');
  await typeInDialog('Meeting 26.09.2026');
  await until(async () => has('', 'Meeting 26.09.2026.md'));
  out.afterDottedRename = await names('');
  out.activeAfterDottedRename = norm(window.sidebarGetActiveFilePath()).split('/').pop();
  await menu(row('README'), 'Rename');
  await typeInDialog('INFO');
  await until(async () => has('', 'INFO'));
  out.afterExtensionlessRename = await names('');
  d0 = window.__fileOpsDialogs.length;
  await menu(row('a.md'), 'Rename');
  await typeInDialog('.secret');
  await until(() => lastDialog(d0).length);
  out.hiddenRenameDialogs = lastDialog(d0);
  await sleep(300); // the refused rename releases the operation lock
  d0 = window.__fileOpsDialogs.length;
  await menu(row('a.md'), 'Rename');
  await typeInDialog('con');
  await until(() => lastDialog(d0).length);
  out.deviceRenameDialogs = lastDialog(d0);
  await sleep(300);
  out.afterRefusedRenames = await names('');

  /* New folder with a name that exists. */
  d0 = window.__fileOpsDialogs.length;
  const newFolderBtn = document.getElementById('sidebar-new-folder');
  tree.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
  const nf = [...document.querySelectorAll('#context-menu .menu-item')].find((b) => b.textContent === 'New Folder');
  if (nf) nf.click(); else if (newFolderBtn) newFolderBtn.click();
  await typeInDialog('SUB');
  await until(() => lastDialog(d0).length);
  out.existingFolderDialogs = lastDialog(d0);
  await sleep(300);

  out.step = '8';
  /* ── 8. The open note's folder moves while a save is queued ─────────
     Open box/active.md, type, queue a save WITHOUT waiting, and move the
     folder at once. The queued save lands before the move (disk lock);
     typing after the move is autosaved to the new place; the old folder
     is never recreated. */
  if (!row('active.md')) { row('box').click(); await until(() => row('active.md')); }
  row('active.md').click();
  await until(() => norm(window.sidebarGetActiveFilePath()).endsWith('/box/active.md'));
  window.insertWithUndo(0, 0, 'FIRST ');
  window.sidebarSaveActiveFile(); // not awaited — queued
  await drag(row('box'), row('sub'));
  await until(async () => has('sub', 'box'));
  out.activeAfterFolderMove = norm(window.sidebarGetActiveFilePath()).replace(norm(REAL), '');
  window.insertWithUndo(0, 0, 'SECOND ');
  await sleep(2600); // autosave
  out.movedNote = await window.NativeAPI.readFile(REAL + '/sub/box/active.md').catch(() => null);
  out.oldBoxRecreated = await has('', 'box');

  out.step = '9';
  /* ── 9. Delete the open note while a save is in flight ───────────── */
  row('del.md').click();
  await until(() => norm(window.sidebarGetActiveFilePath()).endsWith('/del.md'));
  window.insertWithUndo(0, 0, 'EDIT ');
  window.sidebarSaveActiveFile(); // in flight
  await menu(row('del.md'), 'Delete');
  await until(async () => !(await has('', 'del.md')));
  await sleep(2600); // the autosave that 'EDIT' scheduled would fire here
  out.deletedNoteResurrected = await has('', 'del.md');
  out.activeAfterDelete = window.sidebarGetActiveFilePath();

  out.step = '10';
  /* ── 10. Multi-delete wording ─────────────────────────────────────── */
  d0 = window.__fileOpsDialogs.length;
  row('one.md').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  row('two.md').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await menu(row('two.md'), 'Delete 2 items');
  await until(async () => !(await has('', 'one.md')) && !(await has('', 'two.md')));
  out.multiDeleteDialogs = lastDialog(d0);

  } catch (err) {
    out.error = String((err && err.stack) || err);
  }
  out.pageErrors = pageErrors;
  return out;
})()

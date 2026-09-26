/* In-page driver for the save-race E2E. Evaluated by executeJavaScript
   from save_race_e2e_main.js inside the REAL Electron renderer. Must be a
   single expression resolving to a JSON-serializable object. Reports
   FACTS; test/save_race_e2e.test.js holds the assertions. */
(async () => {
  const PROJECT = __PROJECT__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(40);
    }
    return null;
  };
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const activeFile = () => norm(window.sidebarGetActiveFilePath());
  const rel = () => activeFile().replace(norm(PROJECT) + '/', '');
  const row = (p) => document.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"]`);
  const disk = async (name) => {
    try { return await window.NativeAPI.readFile(PROJECT + '/' + name); } catch (_) { return null; }
  };
  const openViaTree = async (name) => {
    const r = await until(() => row(PROJECT + '/' + name));
    if (!r) return false;
    r.click();
    return !!(await until(() => rel() === name));
  };
  const typeAtEnd = (text) => {
    const len = editor.value.length;
    window.insertWithUndo(len, len, text);
  };
  const statusText = () => (document.getElementById('size-warning') || {}).textContent || '';
  const title = () => document.getElementById('doc-title');

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = {};
  out.booted = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'
    && rel() === 'a.md' && editor.value === 'NOTE A: the thesis chapter\n'));
  if (!out.booted) return out;
  await sleep(500);

  /* 1. Rename the open note in the title field, then click another note
        while the rename is still running (the browser fires 'change' when
        the title loses focus, then 'click'). The renamed note used to be
        overwritten: the editor showed x.md, but autosave targeted the
        renamed file. */
  {
    const xRow = await until(() => row(PROJECT + '/x.md'));
    title().value = 'Renamed';
    title().dispatchEvent(new Event('change'));
    xRow.click();
    await until(async () => rel() === 'x.md' && (await disk('Renamed.md')) !== null, 5000);
    await sleep(600);
    const r = { active: rel(), title: title().value, editor: editor.value };
    typeAtEnd('typed after switching\n');
    await until(async () => (await disk('x.md')) === editor.value, 5000);
    await sleep(300);
    r.xDisk = await disk('x.md');
    r.renamedDisk = await disk('Renamed.md');
    r.oldNameGone = (await disk('a.md')) === null;
    out.renameRace = r;
  }

  /* 2. Another program writes the note, and an autosave fires inside the
        watcher's ~300 ms debounce, before the change event is handled. It
        used to overwrite the other program's text without asking. Now the
        save stops and the "File Changed Externally" question comes (the
        stub keeps the user's version: both versions survive, autosave is
        paused); an explicit Ctrl+S then writes the user's version. */
  {
    const opened = await openViaTree('ext.md');
    await sleep(300);
    typeAtEnd('typed in Revery\n');
    await window.NativeAPI.writeFile(PROJECT + '/ext.md', 'ext: EXTERNAL EDIT\n'); // "another program"
    await sleep(100);
    const saved = await window.sidebarSaveActiveFile({ auto: true });            // the autosave timer
    const held = !!(await until(() => statusText().includes('Auto-save is paused'), 5000));
    await sleep(2200); // past any autosave: nothing may be written
    const r = {
      opened, saved, held,
      diskKeptExternal: (await disk('ext.md')) === 'ext: EXTERNAL EDIT\n',
      editorKeptLocal: editor.value === 'ext: my text\ntyped in Revery\n',
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    r.savedByCtrlS = !!(await until(async () => (await disk('ext.md')) === editor.value, 4000));
    out.externalBeforeAutosave = r;
  }

  /* 3. Another program moves the note away, and an autosave fires before
        the watcher reports it. A BACKGROUND save must not recreate it
        (the note would reappear beside its moved copy; on Tauri, which gets
        no delete events, this was the only way it was ever noticed). The
        user is told; an explicit Ctrl+S recreates it on purpose. */
  {
    const opened = await openViaTree('gone.md');
    await sleep(300);
    typeAtEnd('typed before the move\n');
    await window.NativeAPI.renameNode(PROJECT + '/gone.md', PROJECT + '/gone-elsewhere.md'); // "another program"
    const saved = await window.sidebarSaveActiveFile({ auto: true });
    await sleep(2500);
    const r = {
      opened, saved,
      recreated: (await disk('gone.md')) !== null,
      told: statusText().includes('deleted or moved'),
      editorKept: editor.value === 'gone: my text\ntyped before the move\n',
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    r.ctrlSRecreates = !!(await until(async () => (await disk('gone.md')) === editor.value, 4000));
    out.missingBeforeAutosave = r;
  }

  /* 4. An explicit Ctrl+S right after another program's write (before the
        watcher reacts) must not overwrite it unseen either. */
  {
    const opened = await openViaTree('ctrls.md');
    await sleep(300);
    typeAtEnd('my edit\n');
    await window.NativeAPI.writeFile(PROJECT + '/ctrls.md', 'ctrls: EXTERNAL\n'); // "another program"
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    const held = !!(await until(() => statusText().includes('Auto-save is paused'), 5000));
    await sleep(500);
    out.ctrlSAfterExternal = {
      opened, held,
      diskKeptExternal: (await disk('ctrls.md')) === 'ctrls: EXTERNAL\n',
      editorKeptLocal: editor.value === 'ctrls: my text\nmy edit\n',
    };
  }

  /* 5. Closing with unsaved edits right after another program's write: the
        close-time save stops (as in 4). The window must stay open with the
        external-change question — no "discard and quit?" stacked on top,
        and never a close that loses either version. */
  {
    const opened = await openViaTree('close.md');
    await sleep(300);
    typeAtEnd('edit before closing\n');
    await window.NativeAPI.writeFile(PROJECT + '/close.md', 'close: EXTERNAL\n'); // "another program"
    await window.sidebarHandleClose();                                            // the user closes
    const held = !!(await until(() => statusText().includes('Auto-save is paused'), 5000));
    await sleep(300);
    out.closeAfterExternal = {
      opened, held,
      stillOpen: !window.isQuitting,
      diskKeptExternal: (await disk('close.md')) === 'close: EXTERNAL\n',
      editorKeptLocal: editor.value === 'close: my text\nedit before closing\n',
    };
  }

  out.pageErrors = pageErrors;
  return out;
})()

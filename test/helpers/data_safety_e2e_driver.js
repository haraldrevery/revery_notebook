/* In-page driver for the desktop data-safety E2E. Evaluated by
   executeJavaScript from data_safety_e2e_main.js inside the REAL Electron
   renderer. Must be a single expression resolving to a JSON-serializable
   object. Reports FACTS; test/data_safety_e2e.test.js holds the assertions.
   Relies on the classic-script globals of markdown_editor_find_cm.js
   (openFindBar, findInput, findMatches, replaceCurrent, …), exactly like
   find_e2e_driver.js. */
(async () => {
  const PROJECT = __PROJECT__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(50);
    }
    return null;
  };
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const activeFile = () => norm(window.sidebarGetActiveFilePath());
  const row = (p) => document.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"]`);
  const disk = async (rel) => {
    try { return await window.NativeAPI.readFile(PROJECT + '/' + rel); } catch (_) { return null; }
  };
  const listNames = async (rel) =>
    (await window.NativeAPI.readDirectory(rel ? PROJECT + '/' + rel : PROJECT)).map((e) => e.name).sort();
  const openViaTree = async (rel) => {
    const p = PROJECT + '/' + rel;
    const r = await until(() => row(p));
    if (!r) return false;
    r.click();
    return !!(await until(() => activeFile() === norm(p)));
  };
  const setQuery = (q) => { findInput.value = q; findInput.dispatchEvent(new Event('input')); };
  const setRegex = (on) => { if (findUseRegex !== on) findRegexBtn.click(); };
  const statusText = () => (document.getElementById('size-warning') || {}).textContent || '';

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = {};

  out.booted = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'
    && activeFile() === norm(PROJECT + '/note.md')
    && editor.value === 'alpha beta alpha\n'));
  if (!out.booted) return out;
  await sleep(300);

  /* 1. An edit BEFORE the highlighted match shifts every offset. Replace
        must hit the match on screen, not the stale offset. */
  {
    openFindBar();
    setRegex(false);
    window.cmView.dispatch({ selection: { anchor: 0 } });
    setQuery('alpha');
    await until(() => findMatches.length === 2, 2000);
    const found = findMatches.length;
    window.insertWithUndo(0, 0, 'XY ');
    replaceInput.value = 'OMEGA';
    replaceCurrent();
    await sleep(100);
    out.replaceAfterEdit = { found, text: editor.value };
  }

  /* 2. An edit INSIDE the highlighted match: it is no longer a match, so
        nothing may be replaced; results refresh and the user is told. */
  {
    setQuery('beta');
    await until(() => findMatches.length === 1, 2000);
    const at = findMatches.length ? findMatches[0].index : -1;
    window.insertWithUndo(at + 2, at + 2, 'Z'); // beta → beZta
    replaceInput.value = 'B';
    replaceCurrent();
    await sleep(100);
    out.replaceStale = {
      text: editor.value,
      matchesAfter: findMatches.length,
      warned: statusText().includes('changed since the search'),
    };
  }

  /* 3. Regex Replace sees the FULL-text context: a lookbehind and $n. */
  {
    const opened = await openViaTree('look.md');
    setRegex(true);
    window.cmView.dispatch({ selection: { anchor: 0 } });
    setQuery('(?<=foo)bar');
    await until(() => findMatches.length === 1, 3000);
    replaceInput.value = 'BAZ';
    replaceCurrent();
    await sleep(100);
    const afterLookbehind = editor.value;
    setQuery('(fo+)(BAZ)');
    await until(() => findMatches.length === 1, 3000);
    replaceInput.value = '$2-$1';
    replaceCurrent();
    await sleep(100);
    out.regexContext = { opened, afterLookbehind, afterGroups: editor.value };
    setRegex(false);
  }

  /* 4. Switch files with the bar open: Replace must never touch the file
        that was opened (it used to write at the old file's offsets). */
  {
    await openViaTree('note.md');
    setQuery('alpha');
    await until(() => findMatches.length === 1, 2000);
    const opened = await openViaTree('other.md');
    replaceInput.value = 'OMEGA';
    replaceCurrent();
    await sleep(2500); // past the autosave debounce
    out.replaceAfterSwitch = { opened, editor: editor.value, disk: await disk('other.md') };
    closeFindBar();
  }

  /* 5. Scratchpad race: type in the image preview (no note yet), then open
        another file BEFORE the note exists. The typed text must land in the
        new note; the opened file must stay active and untouched. File
        creation is slowed down so the race is deterministic. */
  {
    const realCreate = window.NativeAPI.createFile;
    window.NativeAPI.createFile = async (p) => { await sleep(700); return realCreate.call(window.NativeAPI, p); };
    try {
      const subRow = await until(() => row(PROJECT + '/sub'));
      if (subRow && !subRow.classList.contains('expanded')) subRow.click();
      const picRow = await until(() => row(PROJECT + '/sub/pic.png'));
      if (picRow) picRow.click();
      await until(() => window.sidebarGetActiveFilePath() === null && editor.value.includes('pic.png'));
      const len = editor.value.length;
      window.insertWithUndo(len, len, ' typed');
      const typed = editor.value;
      row(PROJECT + '/other.md').click(); // no await: the create is still in flight
      await until(() => activeFile() === norm(PROJECT + '/other.md'), 4000);
      await sleep(2500);
      out.scratchRace = {
        typed,
        active: activeFile().replace(norm(PROJECT), '<project>'),
        editor: editor.value,
        otherDisk: await disk('other.md'),
        noteDisk: await disk('sub/pic.md'),
        subFiles: await listNames('sub'),
        told: statusText().includes('pic.md'),
      };
    } finally {
      window.NativeAPI.createFile = realCreate;
    }
  }

  /* 6. Sidebar Ctrl+Z undoes a move made in the tree (it used to throw a
        ReferenceError from a variable that only existed in another module). */
  {
    const moveRow = await until(() => row(PROJECT + '/move.md'));
    const subRow  = row(PROJECT + '/sub');
    const dt = new DataTransfer();
    moveRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    subRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    moveRow.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    const moved = !!(await until(async () => (await listNames('sub')).includes('move.md'), 4000));
    const errorsBefore = pageErrors.length;
    window.cmView.contentDOM.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const restored = !!(await until(async () => (await listNames('')).includes('move.md')
      && !(await listNames('sub')).includes('move.md'), 4000));
    out.undoMove = { moved, restored, errors: pageErrors.slice(errorsBefore) };
  }

  /* Sidebar helpers: context-menu Rename through the real HTML dialogs. */
  const renameViaSidebar = async (rel, newName) => {
    const r = await until(() => row(PROJECT + '/' + rel));
    if (!r) return false;
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    const btn = await until(() => Array.from(document.querySelectorAll('#context-menu .menu-item'))
      .find((b) => b.textContent === 'Rename'));
    if (!btn) return false;
    btn.click();
    const input = await until(() => document.querySelector('.revery-input-overlay .revery-input-field'));
    if (!input) return false;
    input.value = newName;
    document.querySelector('.revery-input-overlay .revery-input-ok').click();
    return true;
  };

  /* 7. Sidebar rename of the open note while autosave is paused ("Keep my
        version" after an external change): the unsaved edits must stay
        unsaved AND protected — dirty, backed up under the NEW name, the
        disk left as the other program wrote it — never marked as saved
        (which lost them on close). Ctrl+S then saves them to the new name. */
  {
    await openViaTree('note.md');
    await sleep(2600); // past every save and the watcher's own-write window
    const len = editor.value.length;
    window.insertWithUndo(len, len, 'my local words\n');            // dirty
    await window.NativeAPI.writeFile(PROJECT + '/note.md', 'external version\n'); // "another program"
    const held = !!(await until(async () => window.sidebarIsDirty()
      && (await disk('note.md')) === 'external version\n', 5000));
    await sleep(800);
    const started = await renameViaSidebar('note.md', 'renamed.md');
    const renamed = !!(await until(() => activeFile() === norm(PROJECT + '/renamed.md'), 4000));
    await sleep(2500); // well past the autosave debounce: nothing may be written
    let backup = null;
    try { backup = await window.NativeAPI.getVolatileContent(PROJECT + '/renamed.md'); } catch (_) { /* null */ }
    const r = {
      held, started, renamed,
      dirty: window.sidebarIsDirty(),
      diskStillExternal: (await disk('renamed.md')) === 'external version\n',
      oldNameGone: (await disk('note.md')) === null,
      backupUnderNewName: !!backup && backup.content === editor.value,
      editorKeptLocal: editor.value.includes('my local words'),
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    r.savedByCtrlS = !!(await until(async () => (await disk('renamed.md')) === editor.value, 4000));
    r.cleanAfterSave = !window.sidebarIsDirty();
    out.renameDuringHold = r;
  }

  /* 8. Renaming a file the OPEN note links to updates that link in the open
        note's buffer (it used to be skipped), as a small edit that keeps
        the cursor, and autosave carries it to disk. */
  {
    await openViaTree('links.md');
    await sleep(300);
    window.cmView.dispatch({ selection: { anchor: editor.value.length } });
    const started = await renameViaSidebar('target.md', 'target2.md');
    const confirmOk = await until(() => {
      const ov = document.querySelector('.revery-input-overlay');
      return ov && !ov.querySelector('.revery-input-field') && ov.querySelector('.revery-input-ok');
    }, 4000);
    if (confirmOk) confirmOk.click();
    await until(() => editor.value.includes('(target2.md)'), 3000);
    await sleep(2500);
    out.linkUpdateOpenNote = {
      started,
      confirmShown: !!confirmOk,
      editor: editor.value,
      disk: await disk('links.md'),
      cursorAtEnd: editor.selectionStart === editor.value.length,
    };
  }

  /* 9. A CRLF file keeps its line endings through editing and autosave
        (it used to be rewritten as LF), and another program rewriting
        IDENTICAL content asks nothing and pauses nothing. */
  {
    const opened = await openViaTree('crlf.md');
    await sleep(300);
    const len = editor.value.length;
    window.insertWithUndo(len, len, 'line three\n');
    const want = 'line one\r\nline two\r\nline three\r\n';
    const saved = !!(await until(async () => (await disk('crlf.md')) === want, 5000));
    await sleep(300);
    await window.NativeAPI.writeFile(PROJECT + '/crlf.md', want); // identical rewrite by "another program"
    await sleep(1200);
    out.crlf = {
      opened, saved,
      editorLF: !editor.value.includes('\r'),
      stillClean: !window.sidebarIsDirty(),
      noHold: !statusText().includes('Auto-save is paused'),
    };
  }

  /* 10. Another program writes right AFTER one of our autosaves — inside
         the old 2-second blind spot, where the event used to be ignored and
         the next autosave overwrote it. It must be detected (the stub keeps
         the user's version); the buffer had no unsaved edits at that moment,
         and autosave must STILL stay off: the other program's text stays on
         disk while the user keeps typing, until an explicit Ctrl+S. */
  {
    await openViaTree('other.md');
    await sleep(300);
    const len = editor.value.length;
    window.insertWithUndo(len, len, 'typing here\n');
    const expected = editor.value;
    await until(async () => (await disk('other.md')) === expected, 5000); // our autosave landed
    await window.NativeAPI.writeFile(PROJECT + '/other.md', 'synced from another device\n');
    const asked = !!(await until(() => statusText().includes('Auto-save is paused'), 4000));
    const len2 = editor.value.length;
    window.insertWithUndo(len2, len2, 'more\n');
    await sleep(2500);
    const r = {
      asked,
      diskKeptExternal: (await disk('other.md')) === 'synced from another device\n',
      editorKeptLocal: editor.value.includes('typing here') && editor.value.includes('more'),
    };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    r.savedAfterCtrlS = !!(await until(async () => (await disk('other.md')) === editor.value, 4000));
    r.holdCleared = !statusText().includes('Auto-save is paused');
    out.blindSpot = r;
  }

  /* 11. Another program moves the open note away. Autosave must not
         recreate it under the old name; the user is told; the text stays
         in the editor. */
  {
    await openViaTree('target2.md');
    await sleep(300);
    await window.NativeAPI.renameNode(PROJECT + '/target2.md', PROJECT + '/sub/moved-away.md'); // "another program"
    const told = !!(await until(() => statusText().includes('deleted or moved'), 4000));
    const len = editor.value.length;
    window.insertWithUndo(len, len, 'still typing\n');
    await sleep(2500);
    out.movedAway = {
      told,
      notRecreated: (await disk('target2.md')) === null,
      movedCopyIntact: (await disk('sub/moved-away.md')) === 'target\n',
      editorKept: editor.value.includes('still typing'),
    };
  }

  out.pageErrors = pageErrors;
  return out;
})()

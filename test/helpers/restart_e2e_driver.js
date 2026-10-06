/* In-page driver for the multi-session E2Es (restart_e2e_main.js). Runs in
   the REAL Electron renderer once per session, after each (re)load; the
   main process decides how a session ends (restart or crash) and answers
   the native dialogs. Reports FACTS; the test files hold the assertions.
   Must be a single expression resolving to a JSON-serializable object. */
(async () => {
  const PROJECT = __PROJECT__;
  const PROJECT2 = __PROJECT2__;
  const SCENARIO = __SCENARIO__;
  const SESSION = __SESSION__;
  const TEXT = __TEXT__;
  const HOUR = __HOUR__;

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
  const inRoot = (root, rel) => (rel ? [root, ...String(rel).split('/')].join(root.includes('\\') ? '\\' : '/') : root);
  const inProject = (rel) => inRoot(PROJECT, rel);
  const relOf = (p) => {
    const n = norm(p);
    if (!p) return null;
    if (n === norm(PROJECT)) return '';
    if (n.startsWith(norm(PROJECT) + '/')) return n.slice(norm(PROJECT).length + 1);
    if (n === norm(PROJECT2)) return 'P2:';
    if (n.startsWith(norm(PROJECT2) + '/')) return 'P2:' + n.slice(norm(PROJECT2).length + 1);
    return n;
  };
  const active = () => relOf(window.sidebarGetActiveFilePath && window.sidebarGetActiveFilePath());
  const disk = async (rel) => {
    try { return await window.NativeAPI.readFile(inProject(rel)); } catch (_) { return null; }
  };
  const backupOf = async (rel) => {
    try { return await window.NativeAPI.getVolatileContent(inProject(rel)); } catch (_) { return null; }
  };
  const statusText = () => (document.getElementById('size-warning') || {}).textContent || '';
  /* Change a file the way another program would (done by the main process). */
  const external = (req) => console.log('E2E-FS: ' + JSON.stringify(req));
  const typeAtEnd = (s) => {
    const n = window.cmView.state.doc.length;
    window.cmView.dispatch({ changes: { from: n, insert: s }, userEvent: 'input.type' });
  };
  /* The real close flow (sidebarHandleClose), with the final "close the
     window" step captured: the session then restarts like a closed app. */
  const closeApp = async () => {
    let closed = false;
    window.NativeAPI.confirmClose = () => { closed = true; };
    await window.sidebarHandleClose();
    return closed;
  };
  const row = (p) => document.querySelector(`.sidebar-item[data-path="${CSS.escape(p)}"]`);
  const card = (p) => document.querySelector(`.sidebar-card[data-path="${CSS.escape(p)}"]`);
  const crumb = () => {
    const tree = document.getElementById('sidebar-tree');
    if (!tree || !tree.classList.contains('sidebar-card-view')) return null;
    const c = tree.querySelector('.sidebar-card-crumb');
    return c ? c.textContent : null;
  };
  const cardNames = () => Array.from(document.querySelectorAll('#sidebar-tree .sidebar-card'))
    .map((c) => (c.querySelector('.sidebar-card-title') || {}).title).filter(Boolean).sort();
  const renameViaSidebar = async (rel, newName) => {
    const r = await until(() => row(inProject(rel)));
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

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = { session: SESSION };
  out.sidebar = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'));

  /* Session 0 of every backup scenario: note.md open with V1, no edits. */
  const bootedOnNote = async () => !!(await until(() => active() === 'note.md' && editor.value === TEXT.V1, 10000));
  /* Another program (a sync service) replaces note.md with V2, keeping a
     modification time from an hour ago — older than anything Revery wrote. */
  const syncReplacesNote = () => external({ op: 'write', rel: 'note.md', text: TEXT.V2, mtimeAgoMs: HOUR });
  const held = () => until(() => statusText().includes('Auto-save is paused'), 8000);

  const steps = {
    /* "Keep my version" with NO unsaved edits, then the app is closed.
       The next start must not overwrite the newer file by default. */
    'keep-clean-close': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        syncReplacesNote();
        out.held = !!(await held());
        await sleep(800); // the reboot-safe snapshot lands
        const b = await backupOf('note.md');
        out.snapshot = b ? { content: b.content, hasBase: typeof b.base === 'string' } : null;
        out.closed = await closeApp();
        out.diskAtClose = await disk('note.md');
      },
      async () => {
        out.booted = !!(await until(() => active() === 'note.md', 10000));
        out.copied = !!(await until(async () => (await disk('note_recovered.md')) !== null, 8000));
        await sleep(800);
      },
    ],

    /* "Keep my version" with NO unsaved edits, then another note is
       opened: the kept version goes into a copy first. */
    'keep-clean-switch': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        syncReplacesNote();
        out.held = !!(await held());
        await sleep(800);
        const r = await until(() => row(inProject('other.md')));
        if (r) r.click();
        out.switched = !!(await until(() => active() === 'other.md', 8000));
        out.copied = !!(await until(async () => (await disk('note_local.md')) !== null, 5000));
        out.statusAfterSwitch = statusText();
        out.backupAfterSwitch = await backupOf('note.md');
        await sleep(500);
      },
      async () => {
        out.booted = !!(await until(() => active() === 'other.md', 10000));
        await sleep(2500);
      },
    ],

    /* Like keep-clean-switch, but the other program puts the kept version
       back before the switch: nothing to copy. */
    'keep-clean-reverted': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        syncReplacesNote();
        out.held = !!(await held());
        await sleep(800);
        external({ op: 'write', rel: 'note.md', text: TEXT.V1 });
        out.reverted = !!(await until(async () => (await disk('note.md')) === TEXT.V1, 5000));
        await sleep(800);
        const r = await until(() => row(inProject('other.md')));
        if (r) r.click();
        out.switched = !!(await until(() => active() === 'other.md', 8000));
        await sleep(1500);
        out.copyMade = (await disk('note_local.md')) !== null;
      },
      async () => {
        out.booted = !!(await until(() => active() === 'other.md', 10000));
        await sleep(2500);
      },
    ],

    /* "Keep my version" WITH unsaved edits, then a crash: both versions
       must survive the next start's default answer. */
    'keep-dirty-crash': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        typeAtEnd('A paragraph I typed and kept.\n');
        await sleep(150);
        syncReplacesNote();
        out.held = !!(await held());
        await sleep(2600); // the snapshot and the debounced backup land
        const b = await backupOf('note.md');
        out.snapshot = b ? { content: b.content, hasBase: typeof b.base === 'string' } : null;
        out.diskBeforeCrash = await disk('note.md');
      },
      async () => {
        out.booted = !!(await until(() => active() === 'note.md', 10000));
        out.copied = !!(await until(async () => (await disk('note_recovered.md')) !== null, 8000));
        await sleep(800);
      },
    ],

    /* "Keep my version" (no edits), the note is renamed in the file panel,
       the app is closed: the kept version must follow the new name. */
    'rename-kept': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        syncReplacesNote();
        out.held = !!(await held());
        await sleep(800);
        out.renameStarted = await renameViaSidebar('note.md', 'renamed.md');
        out.renamed = !!(await until(() => active() === 'renamed.md', 8000));
        await sleep(1200);
        const b = await backupOf('renamed.md');
        out.snapshotUnderNewName = b ? b.content : null;
        out.snapshotUnderOldName = !!(await backupOf('note.md'));
        out.closed = await closeApp();
      },
      async () => {
        out.booted = !!(await until(() => active() === 'renamed.md', 10000));
        out.copied = !!(await until(async () => (await disk('renamed_recovered.md')) !== null, 8000));
        await sleep(800);
      },
    ],

    /* Unsaved edits, another program changes the file, the user answers
       "Reload from disk" (after the edits' backup was written), then the
       app crashes: the discarded edits must not come back. */
    'reload-discard': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        typeAtEnd('Words I will throw away.\n');
        await sleep(150);
        external({ op: 'write', rel: 'note.md', text: TEXT.V2 });
        out.reloaded = !!(await until(() => editor.value === TEXT.V2, 12000));
        await sleep(600);
        out.backupAfterReload = await backupOf('note.md');
      },
      async () => {
        out.booted = !!(await until(() => active() === 'note.md', 10000));
        await sleep(2500);
      },
    ],

    /* "Save my version & reload" (rewritten onto the shared copy writer). */
    'save-mine-reload': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        typeAtEnd('My own paragraph.\n');
        await sleep(150);
        external({ op: 'write', rel: 'note.md', text: TEXT.V2 });
        out.reloaded = !!(await until(() => editor.value === TEXT.V2, 8000));
        out.copied = !!(await until(async () => (await disk('note_local.md')) !== null, 5000));
        await sleep(800);
        out.backupAfter = await backupOf('note.md');
      },
      async () => {
        out.booted = !!(await until(() => active() === 'note.md', 10000));
        await sleep(2500);
      },
    ],

    /* Typing while a (slow) save is in flight, then the disk stops
       answering and the app crashes. The backup must name the version that
       save wrote as its base — a debounced backup taken during the write
       used to land afterwards with the older base — so the next start
       sees plain unsaved edits (Restore), not a "changed" file. */
    'slow-save-crash': [
      async () => {
        out.booted = await bootedOnNote();
        await sleep(800);
        const realWrite = window.NativeAPI.writeFile.bind(window.NativeAPI);
        window.NativeAPI.writeFile = async (p, t) => { await sleep(600); return realWrite(p, t); };
        typeAtEnd(' first');
        const saving = window.sidebarSaveActiveFile();
        await sleep(150);
        typeAtEnd(' during');
        await sleep(150);
        typeAtEnd(' save');
        out.saved = await saving;
        window.NativeAPI.writeFile = () => new Promise(() => {}); // the disk stops answering
        await sleep(3000); // past the 2 s backup debounce
        out.diskBeforeCrash = await disk('note.md');
        const b = await backupOf('note.md');
        out.backup = b ? b.content : null;
      },
      async () => {
        out.booted = !!(await until(() => active() === 'note.md', 10000));
        const want = TEXT.V1 + ' first during save';
        out.restoredAndSaved = !!(await until(async () => (await disk('note.md')) === want, 8000));
        await sleep(500);
      },
    ],

    /* ── Card view: the folder is remembered per project ─────────────── */
    'card-restore': [
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        document.getElementById('sidebar-view-btn').click();
        out.cardAtStart = await until(() => crumb(), 5000);
        const b = await until(() => card(inProject('a/b')));
        if (b) b.click();
        out.crumbBeforeRestart = await until(() => crumb() === 'b' && crumb(), 5000);
        await sleep(400);
      },
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        out.crumb = await until(() => crumb(), 5000);
        await until(() => cardNames().length > 0, 3000);
        out.cards = cardNames();
        window.sidebarCreateNewFile();
        out.newFileIn = !!(await until(async () => (await disk('a/b/untitled.md')) !== null, 5000)) ? 'a/b' : null;
        await sleep(400);
      },
    ],

    'card-gone': [
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        document.getElementById('sidebar-view-btn').click();
        await until(() => crumb(), 5000);
        const b = await until(() => card(inProject('a/b')));
        if (b) b.click();
        out.crumbBeforeRestart = await until(() => crumb() === 'b' && crumb(), 5000);
        external({ op: 'rmdir', rel: 'a/b' }); // another program removes the folder
        out.folderGone = !!(await until(async () => {
          try { await window.NativeAPI.readDirectory(inProject('a/b')); return false; } catch (_) { return true; }
        }, 5000));
        await sleep(300);
      },
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        out.crumb = await until(() => crumb(), 5000);
        await sleep(300);
        out.crumb = crumb();
        out.cards = cardNames();
        window.sidebarCreateNewFile();
        out.newFileIn = !!(await until(async () => (await disk('a/untitled.md')) !== null, 5000)) ? 'a' : null;
        await sleep(400);
      },
    ],

    'card-default': [
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        document.getElementById('sidebar-view-btn').click();
        out.cardAtStart = await until(() => crumb(), 5000);
        localStorage.removeItem('revery_card_view_dirs'); // nothing remembered
      },
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        out.crumb = await until(() => crumb(), 5000);
      },
    ],

    'card-switch': [
      async () => {
        out.booted = !!(await until(() => active() === 'a/n.md', 10000));
        document.getElementById('sidebar-view-btn').click();
        await until(() => crumb() === 'a', 5000);
        /* Up to the project root (path bar, or "← Back" when it is compact). */
        const up = document.querySelector('#sidebar-tree .sidebar-card-seg, #sidebar-tree .sidebar-card-back');
        if (up) up.click();
        const c = await until(() => card(inProject('c')));
        if (c) c.click();
        out.inC = await until(() => crumb() === 'c' && crumb(), 5000);
        document.getElementById('sidebar-open-folder').click();                 // → second project
        const p2Name = norm(PROJECT2).split('/').pop();
        out.inP2 = await until(() => crumb() === p2Name && crumb(), 8000);
        const s = await until(() => card(inRoot(PROJECT2, 'sub2')));
        if (s) s.click();
        out.inSub2 = await until(() => crumb() === 'sub2' && crumb(), 5000);
        document.getElementById('sidebar-open-folder').click();                 // → back to the first
        out.backInP1 = await until(() => window.sidebarGetRootPath && norm(window.sidebarGetRootPath()) === norm(PROJECT)
          && crumb(), 8000);
        await sleep(300);
        out.backInP1 = crumb();
      },
    ],
  };

  try {
    const step = (steps[SCENARIO] || [])[SESSION];
    if (!step) throw new Error(`no driver step for ${SCENARIO} session ${SESSION}`);
    await step();
  } catch (err) {
    out.driverError = String((err && err.stack) || err);
  }

  out.active = active();
  out.editor = editor.value;
  out.dirty = window.sidebarIsDirty ? window.sidebarIsDirty() : null;
  out.status = statusText();
  out.pageErrors = pageErrors;
  return out;
})()

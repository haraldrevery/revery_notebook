/* In-page driver for the deferred-edits E2E. Evaluated by executeJavaScript
   from deferred_edits_e2e_main.js inside the REAL Electron renderer. Reports
   FACTS; test/deferred_edits_e2e.test.js holds the assertions.
   Paths are built with the project root's own separator, so the driver
   runs on Windows as well as Linux/macOS. Timing is made deterministic by
   wrapping one NativeAPI call at a time (a slow copy, a slow read, a
   picker during which an edit arrives) — the wrapped call still runs. */
(async () => {
  const PROJECT2_NAME = __PROJECT2__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(40);
    }
    return null;
  };
  const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
  const active = () => nameOf(window.sidebarGetActiveFilePath());
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  const out = {};
  out.booted = !!(await until(() => active() === 'a.md' && document.querySelector('.sidebar-item')));
  if (!out.booted) return out;
  const ROOT = window.sidebarGetRootPath();
  const SEP = ROOT.includes('\\') ? '\\' : '/';
  const disk = async (n) => { try { return await window.NativeAPI.readFile(ROOT + SEP + n); } catch (_) { return null; } };
  const names = async () => (await window.NativeAPI.readDirectory(ROOT)).map((e) => e.name);
  const row = (n) => [...document.querySelectorAll('.sidebar-item')].find((e) => nameOf(e.dataset.path) === n);
  const status = () => (document.getElementById('size-warning') || {}).textContent || '';
  const settled = async () => { await until(() => !window.sidebarIsDirty()); await sleep(250); };
  const png = (name) => {
    const b = new Uint8Array(64 * 1024);
    b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    return new File([b], name, { type: 'image/png' });
  };
  const withFile = (file) => { const dt = new DataTransfer(); dt.items.add(file); return dt; };
  const dropOnEditor = (file) => {
    const r = window.cmView.contentDOM.getBoundingClientRect();
    window.cmView.contentDOM.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: withFile(file), clientX: r.left + 30, clientY: r.top + 10,
    }));
  };
  const pasteInEditor = (file) => window.cmView.contentDOM.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true, cancelable: true, clipboardData: withFile(file),
  }));
  const setDoc = (text) => window.cmView.dispatch({
    changes: { from: 0, to: window.cmView.state.doc.length, insert: text }, userEvent: 'input',
  });
  const select = (needle) => {
    const f = editor.value.indexOf(needle);
    window.cmView.dispatch({ selection: { anchor: f, head: f + needle.length } });
  };
  const typeAt = (pos, text) => window.cmView.dispatch({ changes: { from: pos, insert: text }, userEvent: 'input.type' });
  const typeOverSelection = (text) => window.cmView.dispatch({ ...window.cmView.state.replaceSelection(text), userEvent: 'input.type' });
  const hasPastedLink = () => /!\[Pasted image [^\]]+\]\([^)]+\)/.test(editor.value);

  /* 1. An image dropped on a.md, then b.md opened before its copy finished:
        the link must not go into b.md. */
  {
    const api = window.NativeAPI;
    const realCopy = api.copyFileIntoFolder;
    api.copyFileIntoFolder = async (...args) => { await sleep(700); return realCopy.apply(api, args); };
    dropOnEditor(png('dropped.png'));
    row('b.md').click();
    const switched = !!(await until(() => active() === 'b.md'));
    const copied = !!(await until(async () => (await names()).includes('dropped.png')));
    api.copyFileIntoFolder = realCopy;
    await sleep(300);
    await settled();
    out.dropThenSwitch = {
      switched, copied, active: active(),
      editorHasLink: editor.value.includes('dropped.png'),
      a: await disk('a.md'), b: await disk('b.md'), status: status(),
    };
  }

  /* 2. An image pasted over a selection; the user types elsewhere before the
        link lands: exactly the selection is replaced, nothing else. */
  {
    setDoc('KEEP-THIS-SENTENCE. REPLACE-ME.\n');
    await settled();
    select('REPLACE-ME.');
    pasteInEditor(png('ignored-name.png'));
    typeAt(0, 'NEW-INTRO ');
    const typedFirst = !hasPastedLink();
    await until(hasPastedLink);
    await settled();
    out.pasteThenTypeElsewhere = { typedFirst, editor: editor.value, disk: await disk('b.md') };
  }

  /* 3. An image pasted over a selection that the user then types over:
        the link is inserted, the typed text is kept. */
  {
    setDoc('KEEP-THIS-SENTENCE. REPLACE-ME.\n');
    await settled();
    select('REPLACE-ME.');
    pasteInEditor(png('ignored-name.png'));
    typeOverSelection('TYPED');
    const typedFirst = !hasPastedLink();
    await until(hasPastedLink);
    await settled();
    out.pasteThenTypeOver = { typedFirst, editor: editor.value, disk: await disk('b.md') };
  }

  /* 4. An edit lands in b.md while c.md is being read for the switch: it
        is saved into b.md before c.md is shown. */
  {
    setDoc('Note B edited\n');
    await settled();
    const api = window.NativeAPI;
    const realRead = api.readFile;
    let hooked = false;
    api.readFile = async (p) => {
      if (!hooked && nameOf(p) === 'c.md') {
        hooked = true;
        await sleep(80);
        const n = editor.value.length;
        window.insertWithUndo(n, n, 'LATE-EDIT\n');
        await sleep(80);
      }
      return realRead.call(api, p);
    };
    row('c.md').click();
    const switched = !!(await until(() => active() === 'c.md'));
    api.readFile = realRead;
    await sleep(300);
    out.editDuringSwitch = {
      hooked, switched, active: active(), editor: editor.value, dirty: window.sidebarIsDirty(),
      b: await disk('b.md'), c: await disk('c.md'),
    };
  }

  /* 5. A note that cannot be read: the open note stays. */
  {
    row('bad.md').click();
    await sleep(1200);
    out.openFailure = { active: active(), editor: editor.value };
  }

  /* 6. Another project picked while an edit to the open note arrives: the
        edit is saved into the OLD project before the switch. */
  {
    setDoc('Note C before switch\n');
    await settled();
    const api = window.NativeAPI;
    const realPick = api.openFolderDialog;
    api.openFolderDialog = async () => {
      const picked = await realPick.call(api);
      const n = editor.value.length;
      window.insertWithUndo(n, n, 'DURING-PICKER\n');
      return picked;
    };
    document.getElementById('sidebar-open-folder').click();
    const switched = !!(await until(() => nameOf(window.sidebarGetRootPath()) === PROJECT2_NAME));
    api.openFolderDialog = realPick;
    await sleep(300);
    out.projectSwitch = {
      switched, activeFile: window.sidebarGetActiveFilePath(), editor: editor.value,
      dirty: window.sidebarIsDirty(),
    };
  }

  out.pageErrors = errors;
  return out;
})();

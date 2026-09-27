/* In-page driver (phase 1) for the user-operations E2E. Evaluated by
   executeJavaScript from user_ops_e2e_main.js inside the REAL Electron
   renderer. Reports FACTS; test/user_ops_e2e.test.js holds the
   assertions. Ends by starting a Total Reset (after returning), which
   reloads the page into user_ops_after_reset_driver.js. */
(async () => {
  const PROJECT = __PROJECT__;
  const READONLY_TESTABLE = __READONLY_TESTABLE__;
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
  const rel = () => {
    const a = window.sidebarGetActiveFilePath();
    return a ? norm(a).replace(norm(PROJECT) + '/', '') : null;
  };
  const row = (name) => document.querySelector(`.sidebar-item[data-path="${CSS.escape(PROJECT + '/' + name)}"]`);
  const disk = async (name) => {
    try { return await window.NativeAPI.readFile(PROJECT + '/' + name); } catch (_) { return null; }
  };
  const names = async (sub) =>
    (await window.NativeAPI.readDirectory(sub ? PROJECT + '/' + sub : PROJECT)).map((e) => e.name).sort();
  const openViaTree = async (name) => {
    const r = await until(() => row(name));
    if (!r) return false;
    r.click();
    return !!(await until(() => rel() === name));
  };
  const typeAtEnd = (text) => { const n = editor.value.length; window.insertWithUndo(n, n, text); };
  const statusText = () => (document.getElementById('size-warning') || {}).textContent || '';
  const menu = async (name, label) => {
    const r = await until(() => row(name));
    if (!r) return false;
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    const item = await until(() => [...document.querySelectorAll('#context-menu .menu-item')]
      .find((b) => b.textContent === label));
    if (!item) return false;
    item.click();
    return true;
  };

  /* The OS file picker cannot be driven: a queued File is handed to the
     import's <input type=file> instead of opening the picker. */
  const importQueue = [];
  const realClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && importQueue.length) {
      const dt = new DataTransfer();
      dt.items.add(importQueue.shift());
      this.files = dt.files;
      this.dispatchEvent(new Event('change'));
      return undefined;
    }
    return realClick.call(this);
  };

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = {};
  out.booted = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'
    && rel() === 'del.md' && editor.value === 'del: saved\n'));
  if (!out.booted) return out;
  await sleep(500);

  /* 1. Delete the open note with edits autosave has not written yet: the
        note is saved first, so the copy in the Trash holds them. */
  {
    typeAtEnd('edit before delete\n');
    const started = await menu('del.md', 'Delete');
    const gone = !!(await until(async () => !(await names('')).includes('del.md'), 5000));
    await sleep(300);
    out.deleteDirty = { started, gone, active: rel(), editor: editor.value };
  }

  /* 2. Delete a note while auto-save is paused for it (another program
        changed it; the user kept their version): nothing is deleted. */
  {
    const opened = await openViaTree('held.md');
    await sleep(300);
    typeAtEnd('my edit\n');
    await window.NativeAPI.writeFile(PROJECT + '/held.md', 'held: EXTERNAL\n'); // "another program"
    const held = !!(await until(() => statusText().includes('Auto-save is paused'), 5000));
    const started = await menu('held.md', 'Delete');
    const told = !!(await until(() => statusText().includes('Nothing was deleted'), 4000));
    await sleep(300);
    out.deleteHeld = {
      opened, held, started, told,
      stillOnDisk: (await disk('held.md')) === 'held: EXTERNAL\n',
      editorKept: editor.value === 'held: saved\nmy edit\n',
    };
  }

  /* 3. Total Reset while that pause lasts: stopped, the editor stays, the
        page is NOT reloaded. */
  {
    openQuitModal();
    document.getElementById('quit-btn-nosave').click();
    await sleep(100);
    document.getElementById('quit-btn-total-reset').click();
    const told = !!(await until(() => statusText().includes('Total Reset stopped'), 4000));
    await sleep(300);
    out.resetHeld = {
      told,
      modalClosed: !document.getElementById('quit-modal').classList.contains('show'),
      quitting: window.isQuitting,
      editorKept: editor.value === 'held: saved\nmy edit\n',
    };
    // Resolve the pause the documented way: Ctrl+S writes the user's version.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    out.resetHeld.savedByCtrlS = !!(await until(async () => (await disk('held.md')) === editor.value, 4000));
  }

  /* 4. Import: a Windows-1252 file is refused (it used to be imported with
        U+FFFD in place of its accents), UTF-16 with a BOM is converted, a
        folder that cannot be written reports the failure. */
  {
    importQueue.push(new File([new Uint8Array([0x63, 0x61, 0x66, 0xE9, 0x20, 0x63, 0x72, 0xE8, 0x6D, 0x65, 0x0A])], 'legacy.md'));
    await window.sidebarImportFile();
    await sleep(1200);
    const legacyCreated = (await names('')).includes('legacy.md');

    const text = 'Café 📝 wide\n';
    const bytes = [0xFF, 0xFE];
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes.push(c & 0xFF, c >> 8); }
    importQueue.push(new File([new Uint8Array(bytes)], 'wide.md'));
    await window.sidebarImportFile();
    const wideOpened = !!(await until(() => rel() === 'wide.md', 5000));
    const wideDisk = await disk('wide.md');

    let roFiles = null;
    if (READONLY_TESTABLE) {
      const roRow = await until(() => document.querySelector(`.sidebar-item[data-path="${CSS.escape(PROJECT + '/ro')}"]`));
      if (roRow) roRow.click(); // the import goes into the selected folder
      await sleep(300);
      importQueue.push(new File(['plain text\n'], 'fail.md'));
      await window.sidebarImportFile();
      await sleep(1500);
      roFiles = await names('ro');
    }
    out.imports = { legacyCreated, wideOpened, wideDisk, roFiles };
  }

  /* 5. "Export & Continue" with the save dialog cancelled: stays on the
        first step (it used to move on to "Engine Stopped"). */
  {
    openQuitModal();
    document.getElementById('quit-btn-save').click();
    await sleep(1200);
    out.exportCancelled = {
      stillStep1: document.getElementById('quit-step-1').style.display !== 'none'
        && document.getElementById('quit-step-2').style.display === 'none',
      quitting: window.isQuitting,
    };
    document.getElementById('quit-btn-cancel').click();
  }

  /* 6. Total Reset with unsaved edits: saved first, then the reset reloads
        the page (phase 2 checks the disk). Started after returning, so this
        result reaches the harness before the reload. */
  {
    out.resetOpened = await openViaTree('reset.md');
    await sleep(300);
    typeAtEnd('typed right before the reset\n');
    out.resetDirty = window.sidebarIsDirty();
    // A key only Total Reset removes (desktop never uses it otherwise).
    try { localStorage.setItem('revery_md_autosave', 'reset marker'); } catch (_) { /* checked later */ }
    setTimeout(() => {
      openQuitModal();
      document.getElementById('quit-btn-nosave').click();
      setTimeout(() => document.getElementById('quit-btn-total-reset').click(), 100);
    }, 100);
  }

  out.pageErrors = pageErrors;
  return out;
})()

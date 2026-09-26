/* In-page driver for the crash-recovery E2E. Evaluated by executeJavaScript
   from recovery_e2e_main.js inside the REAL Electron renderer. Reports
   FACTS after the boot's recovery question was answered;
   test/recovery_e2e.test.js holds the assertions. */
(async () => {
  const PROJECT = __PROJECT__;
  const SCENARIO = __SCENARIO__;
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
  const rel = () => {
    const a = window.sidebarGetActiveFilePath && window.sidebarGetActiveFilePath();
    return a ? norm(a).replace(norm(PROJECT) + '/', '') : null;
  };
  const disk = async (name) => {
    try { return await window.NativeAPI.readFile(PROJECT + '/' + name); } catch (_) { return null; }
  };

  const pageErrors = [];
  window.addEventListener('error', (e) => pageErrors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => pageErrors.push(String((e.reason && e.reason.message) || e.reason)));

  const out = {};
  out.sidebar = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'));
  if (SCENARIO === 'missing') await until(() => rel() === 'note_recovered.md');
  else if (!SCENARIO.startsWith('missing')) await until(() => rel() === 'note.md');
  await sleep(2500); // the answer is applied: copy written, tree redrawn, backup gone
  if (SCENARIO === 'restore') await until(async () => (await disk('note.md')) === editor.value, 5000);

  out.active = rel();
  out.editor = editor.value;
  out.dirty = window.sidebarIsDirty();
  out.status = (document.getElementById('size-warning') || {}).textContent || '';
  out.pageErrors = pageErrors;
  return out;
})()

'use strict';

/* Electron main for the save-race E2E (test/save_race_e2e.test.js). Same
   pattern as data_safety_e2e_main.js: boots the REAL electron/main.js
   against a temporary profile, project AND crash-backup folder, runs
   save_race_e2e_driver.js in the renderer and prints one
   `E2E-RESULT: {...}` line.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-race-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-race-e2e-project-'));
app.setPath('userData', userData);
app.setPath('documents', userData);

fs.writeFileSync(path.join(project, 'a.md'), 'NOTE A: the thesis chapter\n');
fs.writeFileSync(path.join(project, 'x.md'), 'NOTE X: a shopping list\n');
fs.writeFileSync(path.join(project, 'ext.md'), 'ext: my text\n');
fs.writeFileSync(path.join(project, 'gone.md'), 'gone: my text\n');
fs.writeFileSync(path.join(project, 'ctrls.md'), 'ctrls: my text\n');
fs.writeFileSync(path.join(project, 'close.md'), 'close: my text\n');

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: path.join(project, 'a.md'),
  projectHistory: [],
}));

/* A native dialog would block a headless run. Record every one; the
   external-change question is answered "Keep my version" (the answer that
   keeps BOTH versions: the other program's on disk, the user's in the
   editor), anything else the first button. */
const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  const title = (opts && opts.title) || '(untitled)';
  dialogs.push(title);
  if (title === 'File Changed Externally' && Array.isArray(opts.buttons)) {
    /* Answer like a person, not instantly: the watcher's own (debounced)
       event for the same write then arrives while the question is still
       open and is coalesced into it — exactly what happens for real. */
    await new Promise((r) => setTimeout(r, 700));
    const keep = opts.buttons.indexOf('Keep my version');
    if (keep >= 0) return { response: keep, checkboxChecked: false };
  }
  return { response: 0, checkboxChecked: false };
};

function snapshot() {
  const out = {};
  for (const n of fs.readdirSync(project).sort()) {
    const full = path.join(project, n);
    if (fs.statSync(full).isFile()) out[n] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

function cleanup() {
  for (const d of [project, userData, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  cleanup();
  app.exit(1);
}, 60000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'save_race_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project));
      const result = await win.webContents.executeJavaScript(driver, true);
      result.dialogs = dialogs;
      result.disk = snapshot();
      console.log('E2E-RESULT: ' + JSON.stringify(result));
      cleanup();
      app.exit(0);
    } catch (err) {
      console.error('E2E-FAIL: ' + ((err && err.message) || String(err)));
      cleanup();
      app.exit(1);
    }
  });
});

/* electron/main.js keeps its crash backups under os.tmpdir() and purges
   the ones older than 7 days 5 s after start: a test run must never list,
   write or purge the REAL folder. Point it at one of our own (removed with
   the rest). Chromium keeps using the real temp dir (TMPDIR untouched). */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-tmp-'));
os.tmpdir = () => tmpRoot;

/* A main-process exception must fail the run at once, with its stack in
   the output — Electron's default handler shows a MODAL error box instead,
   which blocks the process (and pops up on the developer's desktop). */
process.on('uncaughtException', (err) => {
  console.error('E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
  try { cleanup(); } catch (_) { /* best effort */ }
  app.exit(1);
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

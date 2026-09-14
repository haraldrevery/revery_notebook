'use strict';

/* Electron main for the DESKTOP data-safety E2E. Same pattern as
   media_e2e_main.js: boots the REAL electron/main.js (preload, IPC, path
   validation, atomic writes, sidebar in desktop mode) against a temporary
   profile and project, runs data_safety_e2e_driver.js in the renderer and
   prints one `E2E-RESULT: {...}` line for test/data_safety_e2e.test.js.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

/* Fresh profile AND project: the run never touches the user's data, and the
   single-instance lock (keyed on userData) cannot collide with a running
   copy of the app. userData must be set before main.js loads. */
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-safety-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-safety-e2e-project-'));
app.setPath('userData', userData);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

const notePath = path.join(project, 'note.md');
fs.mkdirSync(path.join(project, 'sub'));
fs.writeFileSync(notePath, 'alpha beta alpha\n');
fs.writeFileSync(path.join(project, 'other.md'), 'nothing to see here\n');
fs.writeFileSync(path.join(project, 'look.md'), 'foobar and foo bar\n');
fs.writeFileSync(path.join(project, 'move.md'), 'move me\n');
fs.writeFileSync(path.join(project, 'links.md'), 'See [target](target.md) here.\nSecond line.\n');
fs.writeFileSync(path.join(project, 'target.md'), 'target\n');
fs.writeFileSync(path.join(project, 'crlf.md'), 'line one\r\nline two\r\n');
fs.writeFileSync(path.join(project, 'sub', 'pic.png'), PNG);

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: notePath,
  projectHistory: [],
}));

/* A native dialog would block a headless run. Record every title (the test
   asserts the exact list). The external-change dialog is answered with
   "Keep my version" — the scenario that pauses autosave; anything else gets
   the first button. */
const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  const title = (opts && opts.title) || '(untitled)';
  dialogs.push(title);
  if (title === 'File Changed Externally' && Array.isArray(opts.buttons)) {
    const keep = opts.buttons.indexOf('Keep my version');
    if (keep >= 0) return { response: keep, checkboxChecked: false };
  }
  return { response: 0, checkboxChecked: false };
};

function walk(dir, rel, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), r, out);
    else out[r] = /\.(md|txt)$/.test(entry.name) ? fs.readFileSync(path.join(dir, entry.name), 'utf8') : null;
  }
  return out;
}

function cleanup() {
  for (const d of [project, userData]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  cleanup();
  app.exit(1);
}, 75000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|Error|\[Sidebar\]/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'data_safety_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project));
      const result = await win.webContents.executeJavaScript(driver, true);
      result.dialogs = dialogs;
      result.disk = walk(project, '', {});
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

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

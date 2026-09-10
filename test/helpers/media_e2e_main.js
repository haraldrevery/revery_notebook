'use strict';

/* Electron main for the DESKTOP media E2E. find_e2e_main.js runs the app
   in web mode (no preload); this one boots the REAL electron/main.js —
   preload, IPC handlers, path validation, atomic writes, the sidebar in
   desktop mode — against a temporary project folder, then drives the
   renderer with media_e2e_driver.js. Prints one `E2E-RESULT: {...}` line
   for the node:test runner to parse.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

/* Fresh profile AND project, so the run never touches the user's data and
   the single-instance lock (keyed on userData) cannot collide with a
   running copy of the app. userData must be set before main.js loads. */
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-media-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-media-e2e-project-'));
app.setPath('userData', userData);

/* A valid 1x1 PNG — enough for the copy path and the preview <img>. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

const notePath = path.join(project, 'note.md');
fs.mkdirSync(path.join(project, 'sub'));
fs.writeFileSync(notePath, '# Note\n\n');
fs.writeFileSync(path.join(project, 'sub', 'pic.png'), PNG);

/* Seed settings so boot restores this project and note without a dialog.
   trustedRoots is what fs:set-root-path checks; the migration flag keeps
   main.js from rewriting the list on first run. */
fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: notePath,
  projectHistory: [],
}));

/* A native dialog would block a headless run. The driver never takes a
   path that needs one; if some regression does, answer the first button
   and report the title so the test can fail on it. */
const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  dialogs.push((opts && opts.title) || '(untitled)');
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
}, 60000);

app.on('browser-window-created', (_event, win) => {
  win.hide(); // the real createWindow() shows it; keep the run off-screen
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|Error|\[Sidebar\]/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'media_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project))
        .replace(/__PNG_B64__/g, JSON.stringify(PNG.toString('base64')));
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

/* Boot the real main process: single-instance lock, IPC handlers,
   whenReady → createWindow (frameless, preload, sandbox). */
require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

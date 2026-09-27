'use strict';

/* Electron main for the user-operations E2E (test/user_ops_e2e.test.js):
   deleting the open note, importing, "Export & Continue" and Total Reset —
   operations that used to drop or damage text. Boots the REAL
   electron/main.js against a temporary profile, project and crash-backup
   folder. shell.trashItem is replaced by a move into a private folder (the
   real Trash is never touched) and the save dialog is answered "cancel".
   Two driver phases: user_ops_e2e_driver.js, then — after the Total Reset
   it ends with has reloaded the page — user_ops_after_reset_driver.js.
   Prints one `E2E-RESULT: {...}` line.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-userops-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-userops-e2e-project-'));
const trash    = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-userops-e2e-trash-'));
app.setPath('userData', userData);
app.setPath('documents', userData);

fs.writeFileSync(path.join(project, 'del.md'), 'del: saved\n');
fs.writeFileSync(path.join(project, 'held.md'), 'held: saved\n');
fs.writeFileSync(path.join(project, 'reset.md'), 'reset: saved\n');
/* A folder the import cannot write into (not testable as root or on Windows). */
const roDir = path.join(project, 'ro');
fs.mkdirSync(roDir);
const readOnlyTestable = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;
if (readOnlyTestable) fs.chmodSync(roDir, 0o555);

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: path.join(project, 'del.md'),
  projectHistory: [],
}));

const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  const title = (opts && opts.title) || '(untitled)';
  dialogs.push(title);
  if (title === 'File Changed Externally' && Array.isArray(opts.buttons)) {
    await new Promise((r) => setTimeout(r, 700)); // answer like a person
    const keep = opts.buttons.indexOf('Keep my version');
    if (keep >= 0) return { response: keep, checkboxChecked: false };
  }
  return { response: 0, checkboxChecked: false }; // delete confirmations: "Move to Trash"
};
dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });

let trashCount = 0;
shell.trashItem = async (p) => {
  fs.renameSync(p, path.join(trash, `${++trashCount}-${path.basename(p)}`));
};

function readTree(dir) {
  const out = {};
  for (const n of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, n);
    out[n] = fs.statSync(full).isDirectory() ? readTree(full) : fs.readFileSync(full, 'utf8');
  }
  return out;
}

function cleanup() {
  try { fs.chmodSync(roDir, 0o755); } catch (_) { /* gone already */ }
  for (const d of [project, userData, trash, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung, or the reset never reloaded)');
  cleanup();
  app.exit(1);
}, 70000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });
  let phase = 0;
  let first = null;
  win.webContents.on('did-finish-load', async () => {
    phase++;
    try {
      if (phase === 1) {
        const driver = fs.readFileSync(path.join(__dirname, 'user_ops_e2e_driver.js'), 'utf8')
          .replace(/__PROJECT__/g, JSON.stringify(project))
          .replace(/__READONLY_TESTABLE__/g, JSON.stringify(readOnlyTestable));
        first = await win.webContents.executeJavaScript(driver, true);
        return; // the driver ends by starting a Total Reset, which reloads the page
      }
      const driver = fs.readFileSync(path.join(__dirname, 'user_ops_after_reset_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project));
      const afterReset = await win.webContents.executeJavaScript(driver, true);
      const settings = JSON.parse(fs.readFileSync(path.join(userData, 'revery_settings.json'), 'utf8'));
      const result = {
        ...first,
        afterReset,
        readOnlyTestable,
        dialogs,
        disk: readTree(project),
        trash: readTree(trash),
        lastOpenedAfterReset: settings.lastOpenedFile === undefined ? null : settings.lastOpenedFile,
      };
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
   write or purge the REAL folder. */
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

'use strict';

/* Electron main for the FILE-HISTORY E2E (test/file_history_e2e.test.js).
   Boots the REAL electron/main.js against a temporary profile and project,
   runs file_history_e2e_driver.js in the renderer and prints one
   `E2E-RESULT: {...}` line.

   MODE=history   — undo/redo of moves and renames and what they do to
                    links; the autosave/title rule; the default button of
                    "File Changed Externally".
   MODE=noproject — the last project folder is missing at start (a drive
                    that is not connected): the message, the backup of what
                    is typed, New File / Import, and Open Folder keeping it.

   Never touches the user's data: userData AND documents point into the
   temp profile, the crash-backup folder is redirected (os.tmpdir), the
   system trash is replaced by a recorder, and the driver aborts unless
   the open project is the temp one.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const MODE = process.env.REVERY_E2E_MODE === 'noproject' ? 'noproject' : 'history';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-history-e2e-profile-'));
app.setPath('userData', userData);
app.setPath('documents', userData);
if (app.getPath('userData') !== userData) {
  console.error('E2E-FAIL: userData override did not apply');
  process.exit(1);
}

const base    = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revery-history-e2e-base-')));
const real    = path.join(base, 'Notes');
const other   = path.join(base, 'Other');   // noproject: the folder "Open Folder" picks
const missing = path.join(base, 'Stick');   // noproject: never created — "not connected"
const trashed = path.join(base, 'trash');
fs.mkdirSync(trashed);
fs.mkdirSync(other);
const w = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(real, rel)), { recursive: true });
  fs.writeFileSync(path.join(real, rel), text);
};
w('note.md', 'note\n');
w('other.md', 'other\n');
w('img.png', 'png');
w('A/n.md', 'See [other](../other.md) and ![img](../img.png)\n');
w('mv.md', 'move me\n');
w('links.md', 'See [mv](mv.md).\n');
w('a.md', 'a\n');
w('junk.md', 'junk\n');
w('ext.md', 'ext\n');
w('sub/keep.md', 'keep\n');

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify(MODE === 'noproject'
  ? { trustedRoots: [missing], trustedRootsMigrated: true, lastRootPath: missing,
      lastOpenedFile: path.join(missing, 'thesis.md'), projectHistory: [] }
  : { trustedRoots: [real], trustedRootsMigrated: true, lastRootPath: real,
      lastOpenedFile: path.join(real, 'note.md'), projectHistory: [] }));

/* Native dialogs would block: record them and answer. "File Changed
   Externally" is answered with its cancel button ("Keep my version"),
   everything else with the first button ("Move to Trash", "OK"). */
const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  const o = opts || {};
  dialogs.push({ title: o.title || '', message: o.message || '', buttons: o.buttons || [],
                 defaultId: o.defaultId, cancelId: o.cancelId });
  if (o.title === 'File Changed Externally') {
    await new Promise((r) => setTimeout(r, 300));
    return { response: o.cancelId, checkboxChecked: false };
  }
  return { response: 0, checkboxChecked: false };
};
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [other] });
dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });

const trashCalls = [];
shell.trashItem = async (p) => {
  trashCalls.push(p);
  fs.renameSync(p, path.join(trashed, `${trashCalls.length}-${path.basename(p)}`));
};

function walk(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + '/' + e.name : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, r, out);
    else out[r] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

function cleanup() {
  for (const d of [base, userData, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  cleanup();
  app.exit(1);
}, 110000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|TypeError|ReferenceError/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'file_history_e2e_driver.js'), 'utf8')
        .replace(/__REAL__/g, JSON.stringify(real))
        .replace(/__OTHER__/g, JSON.stringify(other))
        .replace(/__MODE__/g, JSON.stringify(MODE));
      const result = await win.webContents.executeJavaScript(driver, true);
      result.dialogs = dialogs;
      result.trashCalls = trashCalls.map((p) => path.relative(base, p));
      result.disk = walk(real, '', {});
      result.otherDisk = walk(other, '', {});
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
   old ones 5 s after start: a test run must never list, write or purge the
   REAL folder. Chromium keeps using the real temp dir (TMPDIR untouched). */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-tmp-'));
os.tmpdir = () => tmpRoot;

/* A main-process exception must fail the run at once, with its stack —
   Electron's default handler shows a MODAL error box instead. */
process.on('uncaughtException', (err) => {
  console.error('E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
  try { cleanup(); } catch (_) { /* best effort */ }
  app.exit(1);
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

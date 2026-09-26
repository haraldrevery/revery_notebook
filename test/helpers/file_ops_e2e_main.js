'use strict';

/* Electron main for the FILE-OPERATIONS E2E (test/file_ops_e2e.test.js).
   Boots the REAL electron/main.js (preload, IPC, entry validation, rename
   and trash handlers, sidebar in desktop mode) against a temporary
   profile and project, runs file_ops_e2e_driver.js in the renderer and
   prints one `E2E-RESULT: {...}` line.

   MODE=plain   — the project is opened by its real path;
   MODE=symlink — it is opened through a symlink (a root reached via a
                  linked path, as on some Linux/macOS setups).

   Never touches the user's data: userData AND documents point into the
   temp profile (with documents left alone, a boot that found no project
   would create ~/Documents/revery_notebook_notes), and the driver aborts
   unless the open project is the temp one. shell.trashItem is replaced by
   a recorder that moves the entry into a temp "trash" folder (lstat
   semantics: a link moves as a link), so the system trash is never used.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const MODE = process.env.REVERY_E2E_MODE === 'symlink' ? 'symlink' : 'plain';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-fileops-e2e-profile-'));
app.setPath('userData', userData);
app.setPath('documents', userData);
if (app.getPath('userData') !== userData) {
  console.error('E2E-FAIL: userData override did not apply');
  process.exit(1);
}

const base    = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'revery-fileops-e2e-base-')));
const real    = path.join(base, 'Notes');
const trashed = path.join(base, 'trash');
fs.mkdirSync(trashed);
const w = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(real, rel)), { recursive: true });
  fs.writeFileSync(path.join(real, rel), text);
};
w('note.md', 'note\n');
w('README', 'readme\n');
w('mv.md', 'move me\n');
w('links.md', 'See [mv](mv.md).\n');
w('a.md', 'a\n');
w('del.md', 'delete me\n');
w('one.md', 'one\n');
w('two.md', 'two\n');
w('box/active.md', 'active\n');
w('sub/inner.md', 'inner\n');
w('sub/deep/x.md', 'x\n');
w('sub/deep/y.md', 'y\n');
w('realfolder/inside.md', 'inside\n');
fs.symlinkSync(path.join(real, 'realfolder'), path.join(real, 'abslink')); // absolute
fs.symlinkSync('realfolder', path.join(real, 'rellink'));                  // relative

let project = real;
if (MODE === 'symlink') {
  project = path.join(base, 'NotesLink');
  fs.symlinkSync(real, project);
}

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: path.join(project, 'note.md'),
  projectHistory: [],
}));

/* Native dialogs would block: record them, answer with the first button
   ("Move to Trash" for delete confirmations, OK otherwise). */
const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  dialogs.push({ title: (opts && opts.title) || '', message: (opts && opts.message) || '', detail: (opts && opts.detail) || '' });
  return { response: 0, checkboxChecked: false };
};

const trashCalls = [];
shell.trashItem = async (p) => {
  trashCalls.push(p);
  fs.renameSync(p, path.join(trashed, `${trashCalls.length}-${path.basename(p)}`));
};

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + '/' + e.name : e.name;
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) { out[r] = '-> ' + fs.readlinkSync(full); continue; }
    if (e.isDirectory()) walk(full, r, out);
    else out[r] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

function cleanup() {
  for (const d of [base, userData]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  cleanup();
  app.exit(1);
}, 100000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|TypeError|ReferenceError/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'file_ops_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project))
        .replace(/__REAL__/g, JSON.stringify(real))
        .replace(/__MODE__/g, JSON.stringify(MODE));
      const result = await win.webContents.executeJavaScript(driver, true);
      result.dialogs = dialogs;
      result.trashCalls = trashCalls.map((p) => path.relative(base, p));
      result.disk = walk(real, '', {});
      result.trash = walk(trashed, '', {});
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

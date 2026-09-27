'use strict';

/* Electron main for the deferred-edits E2E (test/deferred_edits_e2e.test.js):
   edits that are aimed at the open note but land after an await — a dropped
   or pasted image's link (its copy runs first), an edit arriving while the
   next note is read or while the folder picker is open. Boots the REAL
   electron/main.js against a temporary profile and two temporary projects.
   The folder picker answers with the second project; message boxes are
   recorded and answered with their first button. Prints one
   `E2E-RESULT: {...}` line.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-deferred-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-deferred-e2e-project-'));
const project2 = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-deferred-e2e-second-'));
/* A recent project whose folder is gone (never created). */
const missingProject = path.join(userData, 'gone-project');
app.setPath('userData', userData);
app.setPath('documents', userData);

fs.writeFileSync(path.join(project, 'a.md'), 'Note A\n');
fs.writeFileSync(path.join(project, 'b.md'), 'Note B\n');
fs.writeFileSync(path.join(project, 'c.md'), 'Note C\n');
fs.writeFileSync(path.join(project, 'bad.md'), Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x0a])); // Latin-1, not UTF-8
fs.writeFileSync(path.join(project2, 'other.md'), 'In the second project\n');

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: path.join(project, 'a.md'),
  projectHistory: [{ path: missingProject, name: 'gone-project', lastOpened: 1 }],
}));

/* Every reboot-safe (durable) backup the page asks for, as the handler in
   electron/main.js receives it — the handler itself still runs. */
const durableWrites = [];
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => realHandle(channel, channel !== 'fs:set-durable-backup' ? fn
  : (event, key, content) => { durableWrites.push({ key: String(key), content: String(content) }); return fn(event, key, content); });

/* The original paths of the durable backups still on disk. */
function durableLeft() {
  const dir = path.join(userData, 'crash-backups');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.filter((n) => n.endsWith('.meta.json'))
    .map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).originalPath; } catch (_) { return '?'; } });
}

const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  dialogs.push((opts && opts.title) || '(untitled)');
  return { response: 0, checkboxChecked: false };
};
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project2] });

function readTree(dir) {
  const out = {};
  for (const n of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, n);
    out[n] = fs.statSync(full).isDirectory() ? readTree(full)
      : /\.md$/.test(n) ? fs.readFileSync(full, 'utf8') : `<${fs.statSync(full).size} bytes>`;
  }
  return out;
}

/* electron/main.js keeps its crash backups under os.tmpdir() and purges
   old ones 5 s after start: a test run must never touch the REAL folder. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-tmp-'));
os.tmpdir = () => tmpRoot;

let finished = false;
function finish(code, line) {
  if (finished) return;
  finished = true;
  console.log(line);
  /* Windows first: the page must not write crash backups into folders
     that are being removed. */
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch (_) { /* gone */ } }
  for (const d of [project, project2, userData, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  app.exit(code);
}

setTimeout(() => finish(1, 'E2E-FAIL: global deadline reached (renderer hung?)'), 90000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'deferred_edits_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT2__/g, JSON.stringify(path.basename(project2)))
        .replace(/__MISSING_PROJECT__/g, JSON.stringify(missingProject));
      const facts = await win.webContents.executeJavaScript(driver, true);
      finish(0, 'E2E-RESULT: ' + JSON.stringify({
        ...facts,
        dialogs,
        durableWrites,
        durableLeft: durableLeft(),
        disk: readTree(project),
        disk2: readTree(project2),
      }));
    } catch (err) {
      finish(1, 'E2E-FAIL: ' + ((err && err.message) || String(err)));
    }
  });
});

/* A main-process exception must fail the run at once, with its stack in
   the output — Electron's default handler shows a MODAL error box instead. */
process.on('uncaughtException', (err) => {
  finish(1, 'E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

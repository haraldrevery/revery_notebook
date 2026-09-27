'use strict';

/* Electron main for the crash-recovery E2E (test/recovery_e2e.test.js).
   Boots the REAL electron/main.js against a temporary profile, project AND
   crash-backup folder, with a crash backup already waiting for the last
   opened note — the state a crash, a kill or a power cut leaves behind.
   SCENARIO (env RECOVERY_SCENARIO) says how the recovery question is
   answered:
     escape          Escape on "Recover unsaved changes?"
     restore         "Restore"
     discard         an explicit click on "Discard"
     stale           Enter on a backup OLDER than the saved file
     missing         the note was deleted while the app was closed; Escape
     missing-discard the same, an explicit click on "Discard"
   Prints one `E2E-RESULT: {...}` line.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SCENARIO = process.env.RECOVERY_SCENARIO || 'escape';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-recovery-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-recovery-e2e-project-'));
app.setPath('userData', userData);
app.setPath('documents', userData);

/* electron/main.js keeps its crash backups under os.tmpdir() and purges
   the ones older than 7 days 5 s after start: never touch the REAL folder.
   Set before the backup is seeded, so both use the same private folder. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-tmp-'));
os.tmpdir = () => tmpRoot;

const core = require(path.join(__dirname, '..', '..', 'electron', 'fs_core.js'));
const VOLATILE_DIR = path.join(tmpRoot, 'revery-volatile'); // = main.js VOLATILE_DIR
const notePath = path.join(project, 'note.md');
const SAVED  = 'Saved chapter text.\n';
const BACKUP = 'Saved chapter text.\nAn unsaved paragraph typed before the crash.\n';

core.ensureVolatileDir(VOLATILE_DIR);
if (SCENARIO === 'stale') {
  core.setVolatileContent(VOLATILE_DIR, notePath, BACKUP);
  const t = Date.now() + 5000; // the file was saved AFTER the backup was written
  fs.writeFileSync(notePath, SAVED);
  fs.utimesSync(notePath, t / 1000, t / 1000);
} else {
  if (!SCENARIO.startsWith('missing')) fs.writeFileSync(notePath, SAVED);
  core.setVolatileContent(VOLATILE_DIR, notePath, BACKUP);
}
fs.writeFileSync(path.join(project, 'other.md'), 'another note\n');

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: notePath,
  projectHistory: [],
}));

const dialogs = [];
dialog.showMessageBox = async (_win, opts) => {
  const d = {
    title: (opts && opts.title) || '(untitled)',
    buttons: opts.buttons, defaultId: opts.defaultId, cancelId: opts.cancelId,
  };
  dialogs.push(d);
  if (d.title !== 'Recover unsaved changes?') return { response: 0, checkboxChecked: false };
  const at = (label) => opts.buttons.indexOf(label);
  const response = {
    escape:            opts.cancelId,
    restore:           at('Restore'),
    discard:           at('Discard'),
    stale:             opts.defaultId,
    missing:           opts.cancelId,
    'missing-discard': at('Discard'),
  }[SCENARIO];
  return { response, checkboxChecked: false };
};

function snapshot() {
  const out = {};
  for (const n of fs.readdirSync(project).sort()) out[n] = fs.readFileSync(path.join(project, n), 'utf8');
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
}, 45000);

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const driver = fs.readFileSync(path.join(__dirname, 'recovery_e2e_driver.js'), 'utf8')
        .replace(/__PROJECT__/g, JSON.stringify(project))
        .replace(/__SCENARIO__/g, JSON.stringify(SCENARIO));
      const result = await win.webContents.executeJavaScript(driver, true);
      result.scenario = SCENARIO;
      result.dialogs = dialogs;
      result.disk = snapshot();
      const b = core.getVolatileContent(VOLATILE_DIR, notePath);
      result.backupLeft = b ? b.content : null;
      const last = JSON.parse(fs.readFileSync(path.join(userData, 'revery_settings.json'), 'utf8')).lastOpenedFile;
      result.lastOpened = typeof last === 'string' ? path.relative(project, last).split(path.sep).join('/') : last;
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

/* A main-process exception must fail the run at once, with its stack in
   the output — Electron's default handler shows a MODAL error box instead,
   which blocks the process (and pops up on the developer's desktop). */
process.on('uncaughtException', (err) => {
  console.error('E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
  try { cleanup(); } catch (_) { /* best effort */ }
  app.exit(1);
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

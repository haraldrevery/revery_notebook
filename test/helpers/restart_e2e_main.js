'use strict';

/* Electron main for MULTI-SESSION E2Es (test/backup_safety_e2e.test.js,
   test/card_restore_e2e.test.js). Boots the REAL electron/main.js against
   a temporary profile, project and crash-backup folder, then drives the
   app through several SESSIONS: between two sessions the page is either
   reloaded (a restart — the whole boot runs again) or its renderer process
   is killed (a crash — main.js then offers "Reload editor", answered with
   its default). Profile, project and backup folders stay the same
   throughout: what one session leaves behind is what the next one finds.

   RESTART_SCENARIO (env) picks a scenario from SCENARIOS below: the files,
   the last opened note, and per session the dialog answers and how the
   session ends. What each session DOES is in restart_e2e_driver.js. The
   driver can ask this process to change files the way another program
   would — e.g. keeping an old modification time, as sync tools do — with a
   console line `E2E-FS: {...}`. Prints one `E2E-RESULT: {...}` line.

   Guard: node's test runner may execute every .js under test/ in some
   discovery modes — bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SCENARIO = process.env.RESTART_SCENARIO || '';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-restart-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-restart-e2e-project-'));
const project2 = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-restart-e2e-second-'));
app.setPath('userData', userData);
app.setPath('documents', userData);

/* electron/main.js keeps its crash backups under os.tmpdir() and purges
   old ones 5 s after start: never touch the REAL folder. */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-tmp-'));
os.tmpdir = () => tmpRoot;
const BACKUP_DIRS = {
  volatile: path.join(tmpRoot, 'revery-volatile'),   // = main.js VOLATILE_DIR
  durable:  path.join(userData, 'crash-backups'),    // = main.js getDurableDir()
};

const TEXT = {
  V1:    'My latest chapter, saved on this computer.\n',
  V2:    'An older chapter that a sync service brought from another device.\n',
  OTHER: 'another note\n',
};
const HOUR = 60 * 60 * 1000;

const BACKUP_FILES = { 'note.md': TEXT.V1, 'other.md': TEXT.OTHER };
const CARD_FILES = {
  'notes.md': 'root note\n',
  'a/n.md': 'note in a\n',
  'a/b/deep.md': 'deep note\n',
  'c/other.md': 'note in c\n',
};

/* sessions[i].answers: dialog title → button label, '$default', '$cancel',
   or { answer, delayMs } (answered after a delay, as a user would).
   sessions[i].end: 'reload' | 'crash' | 'finish'.
   sessions[i].openFolders: what the folder picker returns, in order
   ('P1' = the project, 'P2' = the second project). */
const KEEP = { 'File Changed Externally': 'Keep my version' };
const ENTER_ON_RECOVERY = { 'Recover unsaved changes?': '$default' };
const SCENARIOS = {
  'keep-clean-close':  { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: KEEP, end: 'reload' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'keep-clean-switch': { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: KEEP, end: 'reload' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'keep-clean-reverted': { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: KEEP, end: 'reload' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'keep-dirty-crash':  { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: KEEP, end: 'crash' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'rename-kept':       { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: KEEP, end: 'reload' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'reload-discard':    { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: { 'File Changed Externally': { answer: 'Reload from disk', delayMs: 2600 } }, end: 'crash' },
    { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'save-mine-reload':  { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: { 'File Changed Externally': 'Save my version & reload' }, end: 'reload' },
    { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'slow-save-crash':   { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: {}, end: 'crash' }, { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  /* Typing reaches the disk before the computer goes down (save.js FLUSH). */
  'flush-blur':        { files: BACKUP_FILES, last: 'note.md', sessions: [{ answers: {}, end: 'finish' }] },
  'flush-session-end': { files: BACKUP_FILES, last: 'note.md', sessions: [{ answers: {}, end: 'finish' }] },
  'flush-hold':        { files: BACKUP_FILES, last: 'note.md', sessions: [{ answers: KEEP, end: 'finish' }] },
  /* Close (as at logout) while the file was just changed by another
     program: nobody answers the questions, then the app is gone. */
  'close-external-change': { files: BACKUP_FILES, last: 'note.md', sessions: [
    { answers: {
      'File Changed Externally': { answer: 'Keep my version', delayMs: 20000 },
      'Unsaved Changes': { answer: 'Cancel', delayMs: 20000 },
    }, end: 'crash' },
    { answers: ENTER_ON_RECOVERY, end: 'finish' }] },
  'card-restore': { files: CARD_FILES, last: 'a/n.md', sessions: [
    { answers: {}, end: 'reload' }, { answers: {}, end: 'finish' }] },
  'card-gone':    { files: CARD_FILES, last: 'a/n.md', sessions: [
    { answers: {}, end: 'reload' }, { answers: {}, end: 'finish' }] },
  'card-default': { files: CARD_FILES, last: 'a/n.md', sessions: [
    { answers: {}, end: 'reload' }, { answers: {}, end: 'finish' }] },
  'card-switch':  { files: CARD_FILES, last: 'a/n.md', files2: { 'p2.md': 'second\n', 'sub2/x.md': 'x\n' },
    sessions: [{ answers: {}, end: 'finish', openFolders: ['P2', 'P1'] }] },
};

const plan = SCENARIOS[SCENARIO];
if (!plan) {
  console.error('E2E-FAIL: unknown RESTART_SCENARIO ' + JSON.stringify(SCENARIO));
  process.exit(2);
}

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files || {})) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}
writeTree(project, plan.files);
writeTree(project2, plan.files2);

fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project, project2],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: path.join(project, ...plan.last.split('/')),
  projectHistory: [],
}));

/* ── Native dialogs: recorded, answered per session ──────────────────── */
let session = 0;
const dialogs = [];
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

dialog.showMessageBox = async (_win, opts) => {
  const d = {
    session, title: (opts && opts.title) || '(untitled)', message: opts.message || '',
    buttons: opts.buttons, defaultId: opts.defaultId, cancelId: opts.cancelId,
  };
  dialogs.push(d);
  /* A person needs a moment to read a dialog. An answer given in the same
     turn as main.js's renderer-gone event made its immediate reload bring
     the whole Electron process down here (exit by SIGTRAP) — a stub
     artifact: a real "Reload editor" click always comes later. */
  if (d.title === 'Revery Notebook stopped') await sleep(300);
  const want = ((plan.sessions[session] || {}).answers || {})[d.title];
  if (want === undefined) return { response: 0, checkboxChecked: false };
  const label = typeof want === 'object' ? want.answer : want;
  if (typeof want === 'object' && want.delayMs) await sleep(want.delayMs);
  let response;
  if (label === '$default') response = opts.defaultId || 0;
  else if (label === '$cancel') response = opts.cancelId || 0;
  else response = (opts.buttons || []).indexOf(label);
  if (response < 0) {
    problems.push(`session ${session}: "${label}" is not a button of "${d.title}" (${opts.buttons})`);
    response = 0;
  }
  d.answered = (opts.buttons || [])[response];
  return { response, checkboxChecked: false };
};

let folderPicks = 0;
dialog.showOpenDialog = async () => {
  const pick = ((plan.sessions[session] || {}).openFolders || [])[folderPicks++];
  if (!pick) return { canceled: true, filePaths: [] };
  return { canceled: false, filePaths: [pick === 'P2' ? project2 : project] };
};

/* ── Files changed "by another program" on the driver's request ─────── */
function fsAction(req) {
  const root = req.root === 2 ? project2 : project;
  const p = path.join(root, ...String(req.rel).split('/'));
  if (req.op === 'write') {
    fs.writeFileSync(p, req.text);
    if (req.mtimeAgoMs) {
      const t = (Date.now() - req.mtimeAgoMs) / 1000; // a sync tool keeps the other device's time
      fs.utimesSync(p, t, t);
    }
  } else if (req.op === 'rmdir') {
    fs.rmSync(p, { recursive: true, force: true });
  } else if (req.op === 'session-end') {
    /* What Windows sends when it shuts down, restarts or logs off. */
    for (const w of BrowserWindow.getAllWindows()) w.emit('query-session-end', { preventDefault() {} });
  } else {
    problems.push('unknown E2E-FS op ' + JSON.stringify(req));
  }
}

/* ── Reports ─────────────────────────────────────────────────────────── */
function snapshot(root) {
  const out = {};
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out[r] = fs.readFileSync(path.join(dir, e.name), 'utf8');
    }
  };
  walk(root, '');
  return out;
}

function backupsLeft() {
  const out = [];
  for (const [where, dir] of Object.entries(BACKUP_DIRS)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const n of names.filter((x) => x.endsWith('.meta.json')).sort()) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
        const data = fs.readFileSync(path.join(dir, n.replace('.meta.json', '.revery_volatile')), 'utf8');
        const rel = path.relative(project, meta.originalPath).split(path.sep).join('/');
        out.push({ where, path: rel, content: data, hasBase: typeof meta.base === 'string' });
      } catch (_) { /* a half pair: not ours to judge here */ }
    }
  }
  return out;
}

function cleanup() {
  for (const d of [project, project2, userData, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

function finish(code, result) {
  if (result) console.log('E2E-RESULT: ' + JSON.stringify(result));
  cleanup();
  app.exit(code);
}

setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?) in session ' + session);
  finish(1);
}, 100000);

/* ── Sessions ────────────────────────────────────────────────────────── */
const results = [];
const driverSource = fs.readFileSync(path.join(__dirname, 'restart_e2e_driver.js'), 'utf8');

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (e, _level, legacyMessage) => {
    const m = String(e && typeof e.message === 'string' ? e.message : legacyMessage);
    if (m.startsWith('E2E-FS: ')) {
      try { fsAction(JSON.parse(m.slice('E2E-FS: '.length))); } catch (err) { problems.push('E2E-FS failed: ' + err.message); }
      return;
    }
    if (/Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });
  win.webContents.on('did-finish-load', async () => {
    const current = session;
    try {
      const driver = driverSource
        .replace(/__PROJECT__/g, JSON.stringify(project))
        .replace(/__PROJECT2__/g, JSON.stringify(project2))
        .replace(/__SCENARIO__/g, JSON.stringify(SCENARIO))
        .replace(/__SESSION__/g, JSON.stringify(current))
        .replace(/__TEXT__/g, JSON.stringify(TEXT))
        .replace(/__HOUR__/g, String(HOUR));
      results[current] = await win.webContents.executeJavaScript(driver, true);
    } catch (err) {
      console.error(`E2E-FAIL: session ${current}: ${(err && err.message) || err}`);
      return finish(1);
    }
    const end = plan.sessions[current].end;
    session = current + 1; // the next session's dialogs (also those of its boot) are answered by its own plan
    if (end === 'reload') {
      await win.webContents.executeJavaScript('window.isQuitting = true; true').catch(() => {});
      win.webContents.reload();
    } else if (end === 'crash') {
      /* Out of this callback first: crashing the renderer from inside the
         executeJavaScript reply took the main process down with it. */
      setTimeout(() => win.webContents.forcefullyCrashRenderer(), 200); // main.js: "Reload editor" (its default)
    } else {
      finish(0, {
        scenario: SCENARIO, sessions: results, dialogs, problems,
        disk: snapshot(project), disk2: snapshot(project2), backups: backupsLeft(), TEXT,
      });
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
  try { cleanup(); } catch (_) { /* best effort */ }
  app.exit(1);
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

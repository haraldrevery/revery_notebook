'use strict';
/* Electron main for spellcheck_offline_e2e.test.js: boots the REAL app
   (electron/main.js) with a temporary profile while the OS reports the
   language(s) the test chose (LANGUAGE / LANG, read by Chromium on Linux),
   then reports what the spell checker did — its session events, whether
   it is on and for which languages, whether a misspelled word typed into
   the editor is flagged — and every http(s) request of the whole run,
   from Chromium's own network log. Prints one line: E2E-RESULT: {json}. */
const { app, session, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-spell-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-spell-e2e-project-'));
const tmpRoot  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-spell-e2e-tmp-'));
app.setPath('userData', userData);
app.setPath('documents', userData);
os.tmpdir = () => tmpRoot; // main.js keeps crash backups under the temp dir
const netLog = path.join(tmpRoot, 'net-log.json');
app.commandLine.appendSwitch('log-net-log', netLog);

fs.writeFileSync(path.join(project, 'note.md'), 'start\n');
fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project], trustedRootsMigrated: true, lastRootPath: project,
  lastOpenedFile: path.join(project, 'note.md'), projectHistory: [],
}));

const events = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(code, result) {
  if (result) console.log('E2E-RESULT: ' + JSON.stringify(result));
  for (const d of [project, userData, tmpRoot]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
  app.exit(code);
}

setTimeout(() => { console.error('E2E-FAIL: global deadline reached'); finish(1); }, 60000);

/* Observe sessions as they are created — never create one here: Chromium
   looks for its dictionaries the moment a session exists, and the app must
   set up the spell checker before that (spellcheck.js). */
app.on('session-created', (ses) => {
  for (const name of ['spellcheck-dictionary-initialized', 'spellcheck-dictionary-download-begin',
                      'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure']) {
    ses.on(name, (_e, lang) => events.push(`${name.replace('spellcheck-dictionary-', '')} ${lang}`));
  }
});

app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const ses = win.webContents.session;
      /* Type a misspelled word into the editor, then right-click it: the
         context-menu event names the misspelled word only when a loaded
         dictionary flags it. */
      win.show();
      win.focus();
      await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 200 && !(window.cmView && window.sidebarGetActiveFilePath && window.sidebarGetActiveFilePath()); i++) await sleep(50);
        const v = window.cmView;
        v.focus();
        v.dispatch({ selection: { anchor: v.state.doc.length } });
        return true;
      })()`, true);
      /* Typed key by key, as the keyboard delivers it: Chromium checks a
         word when it is completed. (Inserting the whole string at once let
         the editor redraw the line and drop the spelling marks.) */
      for (const ch of 'Thiss word ') {
        const keyCode = ch === ' ' ? 'Space' : ch;
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await sleep(40);
      }
      await sleep(2000);
      const at = await win.webContents.executeJavaScript(`(() => {
        const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.data.indexOf('Thiss');
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(n, i + 1); r.setEnd(n, i + 3);
          const b = r.getBoundingClientRect();
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
        }
        return null;
      })()`, true);
      let flagged = null;
      if (at) {
        const menu = new Promise((res) => win.webContents.once('context-menu', (_e, p) => res(p.misspelledWord)));
        win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'right', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'right', clickCount: 1 });
        flagged = await Promise.race([menu, sleep(3000).then(() => '(no context-menu event)')]);
      }
      await sleep(500);
      let raw = '';
      try { raw = fs.readFileSync(netLog, 'utf8'); } catch (_) { /* written on exit only */ }
      const dictDir = path.join(userData, 'Dictionaries');
      finish(0, {
        preferred: app.getPreferredSystemLanguages(),
        enabled: ses.isSpellCheckerEnabled(),
        languages: ses.getSpellCheckerLanguages(),
        events,
        flagged,
        dictionaries: fs.existsSync(dictDir) ? fs.readdirSync(dictDir).sort() : null,
        netLogRead: raw.length > 0,
        httpRequests: [...new Set(raw.match(/https?:\/\/[^"\\\s]+/g) || [])],
        windows: BrowserWindow.getAllWindows().length,
      });
    } catch (err) {
      console.error('E2E-FAIL: ' + ((err && err.stack) || err));
      finish(1);
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('E2E-FAIL: main-process exception: ' + ((err && err.stack) || err));
  app.exit(1);
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

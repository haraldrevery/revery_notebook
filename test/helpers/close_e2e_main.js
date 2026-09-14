'use strict';

/* Electron main for the close-watchdog E2E. Boots the REAL electron/main.js
   (preload, IPC, the close interception) against a temporary profile and
   project, then drives one scenario from the MAIN process (a hung or
   crashed renderer cannot drive itself):

     normal           close → the page acknowledges, saves, confirms → closed,
                      no question asked;
     close-failed     the page's close flow throws → the main process asks
                      "could not close normally" → Close anyway → closed;
     crash-then-hang  the renderer is killed → "stopped" → Reload editor →
                      the page boots again; then the page hangs and close is
                      requested → after the watchdog timeout "not responding"
                      → Force close → closed.

   Native dialogs are stubbed (they would block a headless run): every title
   is logged with a timestamp and answered from ANSWERS. Prints one
   `E2E-RESULT: {...}` line when the window closes.

   Guard: bail out unless running under Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SCENARIO = process.env.REVERY_CLOSE_SCENARIO || 'normal';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-close-e2e-profile-'));
const project  = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-close-e2e-project-'));
app.setPath('userData', userData);

const notePath = path.join(project, 'note.md');
fs.writeFileSync(notePath, '# Close test\n');
fs.writeFileSync(path.join(userData, 'revery_settings.json'), JSON.stringify({
  trustedRoots: [project],
  trustedRootsMigrated: true,
  lastRootPath: project,
  lastOpenedFile: notePath,
  projectHistory: [],
}));

const t0 = Date.now();
const events = [];
const log = (what) => events.push({ t: Date.now() - t0, what });

const ANSWERS = {
  'Revery Notebook stopped': 0,                   // Reload editor
  'Revery Notebook is not responding': 1,         // Force close
  'Revery Notebook could not close normally': 1,  // Close anyway
};
dialog.showMessageBox = async (_win, opts) => {
  const title = (opts && opts.title) || '(untitled)';
  log('dialog:' + title);
  return { response: Object.prototype.hasOwnProperty.call(ANSWERS, title) ? ANSWERS[title] : 0, checkboxChecked: false };
};

function cleanup() {
  for (const d of [project, userData]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

setTimeout(() => {
  console.log('E2E-RESULT: ' + JSON.stringify({ scenario: SCENARIO, events, timedOut: true }));
  cleanup();
  app.exit(1);
}, 45000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitBoot(win) {
  for (let i = 0; i < 160; i++) {
    try {
      const ok = await win.webContents.executeJavaScript(
        "typeof window.sidebarGetActiveFilePath === 'function' && !!window.sidebarGetActiveFilePath()", true);
      if (ok) return true;
    } catch (_) { /* not yet */ }
    await sleep(50);
  }
  return false;
}

let loads = 0;
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.on('closed', () => {
    log('closed');
    console.log('E2E-RESULT: ' + JSON.stringify({ scenario: SCENARIO, events }));
    cleanup();
  });
  win.webContents.on('did-finish-load', async () => {
    loads++;
    log('load' + loads);
    if (!(await waitBoot(win))) { log('boot-failed'); return; }
    await sleep(300);
    log('booted' + loads);

    if (SCENARIO === 'normal') {
      log('close');
      win.close();
    } else if (SCENARIO === 'close-failed') {
      await win.webContents.executeJavaScript(
        "window.NativeAPI.confirmClose = () => { throw new Error('simulated close failure'); }; 1", true);
      log('close');
      win.close();
    } else if (SCENARIO === 'crash-then-hang') {
      if (loads === 1) {
        /* Deliver the renderer-gone event the way Electron reports a crash.
           (A REAL crash via forcefullyCrashRenderer() / CDP Page.crash was
           tried: on some Linux setups the dying renderer is held by the
           system crash handler and the event never arrives — the test must
           not depend on that. A genuinely dead page is covered anyway: it
           cannot acknowledge a close, so the watchdog below catches it.) */
        log('crash');
        /* A dead page runs no beforeunload handler; this one is alive, and
           its "unsaved text" guard would veto the reload the main process
           performs — lift it the way a gone renderer would. */
        await win.webContents.executeJavaScript('window.isQuitting = true; 1', true);
        win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 139 });
      } else {
        // Hang the page's only thread, then ask to close.
        await win.webContents.executeJavaScript(
          'setTimeout(() => { const s = Date.now(); while (Date.now() - s < 30000) {} }, 20); 1', true);
        await sleep(300);
        log('close');
        win.close();
      }
    }
  });
});

require(path.join(__dirname, '..', '..', 'electron', 'main.js'));

'use strict';

/* Electron main for the find/replace E2E check. Loads the real app HTML
   (web mode — no preload, so NativeAPI runs its browser fallback) in a
   hidden window and drives the find bar with the driver script. Prints
   one `E2E-RESULT: {...}` line for the node:test runner to parse.

   Guard: node's test runner executes every .js file under test/ in some
   discovery modes — bail out unless invoked with the marker argument.  */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-')));

/* The renderer freezing is the exact failure mode under test; the main
   process stays responsive, so a global deadline can always fire. */
setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  app.exit(1);
}, 45000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700 });

  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    /* Surface find-worker readiness plus anything that helps diagnose a
       hung driver (live-preview warnings, uncaught errors). */
    if (/\[Find\]|\[LivePreview\]|Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });

  try {
    await win.loadFile(path.join(__dirname, '..', '..', 'www', 'index.html'));
    const driver = fs.readFileSync(path.join(__dirname, 'find_e2e_driver.js'), 'utf8');
    const result = await win.webContents.executeJavaScript(driver, true);
    console.log('E2E-RESULT: ' + JSON.stringify(result));
    app.exit(0);
  } catch (err) {
    console.error('E2E-FAIL: ' + ((err && err.message) || String(err)));
    app.exit(1);
  }
});

'use strict';

/* Generic Electron main for WEB-MODE driver scripts (no preload, so
   NativeAPI runs its browser fallback). Loads the real www/index.html in
   a hidden window, evaluates the driver file named on the command line
   and prints one `E2E-RESULT: {...}` line for the node:test runner.

     electron test/helpers/web_e2e_main.js <driver.js> [deadlineMs]

   The driver must be a single expression resolving to a plain
   serializable object (see find_e2e_driver.js, lp_e2e_driver.js). The
   desktop suites (media_e2e_main.js) need the real preload/IPC instead.

   Guard: node's test runner executes every .js file under test/ in some
   discovery modes -- bail out unless running inside Electron. */

if (!process.versions.electron) {
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const driverPath = process.argv[2];
const deadlineMs = Number(process.argv[3]) || 60000;
if (!driverPath) {
  console.error('E2E-FAIL: usage: electron web_e2e_main.js <driver.js> [deadlineMs]');
  process.exit(2);
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'revery-e2e-')));

/* A hung renderer is a failure mode under test; the main process stays
   responsive, so a global deadline can always fire. Keep it below the
   node:test timeout so this message, not a bare timeout, is reported. */
setTimeout(() => {
  console.error('E2E-FAIL: global deadline reached (renderer hung?)');
  app.exit(1);
}, deadlineMs);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700 });
  /* Hidden windows throttle requestAnimationFrame, which CodeMirror's
     measure cycle (scroll effects, layout reads) depends on. */
  win.webContents.setBackgroundThrottling(false);

  win.webContents.on('console-message', (_e, _level, message) => {
    const m = String(message);
    if (/\[LivePreview\]|\[Find\]|Uncaught|Error/.test(m)) console.log('RENDERER: ' + m);
  });

  try {
    await win.loadFile(path.join(__dirname, '..', '..', 'www', 'index.html'));
    const driver = fs.readFileSync(path.resolve(driverPath), 'utf8');
    const result = await win.webContents.executeJavaScript(driver, true);
    console.log('E2E-RESULT: ' + JSON.stringify(result));
    app.exit(0);
  } catch (err) {
    console.error('E2E-FAIL: ' + ((err && err.message) || String(err)));
    app.exit(1);
  }
});

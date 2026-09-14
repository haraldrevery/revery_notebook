'use strict';

/* Close watchdog E2E (electron/main.js + preload.js). The window is
   frameless and every close is handed to the page; these runs pin that the
   app can ALWAYS be closed, and never silently:
     1. normal close: the page answers, no question is asked;
     2. the page's close flow throws: the main process asks, and closes on
        "Close anyway";
     3. the renderer is reported gone (crash): the main process offers a
        reload and the page boots again; then the page hangs and close is
        requested: after the watchdog timeout (5 s) the main process offers
        "Force close". (The crash report is a delivered event — see the
        harness for why a real crash is not used.)
   Each run is a separate real Electron app (helpers/close_e2e_main.js).
   Skipped when no display server is available (same rule as media_e2e). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

function runScenario(scenario) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'close_e2e_main.js');
  const env = { ...process.env, REVERY_CLOSE_SCENARIO: scenario };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', () => {
      const line = out.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
      if (!line) return reject(new Error(`no E2E-RESULT for ${scenario}:\n${out}`));
      resolve(JSON.parse(line.slice('E2E-RESULT: '.length)));
    });
  });
}

const whats = (r) => r.events.map((e) => e.what);
const at = (r, what) => (r.events.find((e) => e.what === what) || {}).t;

test('close watchdog: the app can always be closed, never silently', { skip: !hasDisplay, timeout: 150000 }, async () => {
  const normal = await runScenario('normal');
  let why = JSON.stringify(normal, null, 2);
  assert.ok(!normal.timedOut, 'normal close must finish\n' + why);
  assert.deepEqual(whats(normal), ['load1', 'booted1', 'close', 'closed'],
    'a normal close asks nothing\n' + why);
  assert.ok(at(normal, 'closed') - at(normal, 'close') < 4000, 'a normal close is prompt\n' + why);

  const failed = await runScenario('close-failed');
  why = JSON.stringify(failed, null, 2);
  assert.ok(!failed.timedOut, 'a failing close flow must not leave the window stuck\n' + why);
  assert.deepEqual(whats(failed),
    ['load1', 'booted1', 'close', 'dialog:Revery Notebook could not close normally', 'closed'],
    'a failing close flow is reported and "Close anyway" closes\n' + why);

  const crash = await runScenario('crash-then-hang');
  why = JSON.stringify(crash, null, 2);
  assert.ok(!crash.timedOut, 'a crashed or hung page must not leave the window stuck\n' + why);
  assert.deepEqual(whats(crash), [
    'load1', 'booted1', 'crash',
    'dialog:Revery Notebook stopped',
    'load2', 'booted2', 'close',
    'dialog:Revery Notebook is not responding',
    'closed',
  ], 'crash → reload offered and done; hang → force close offered after the timeout\n' + why);
  const waited = at(crash, 'dialog:Revery Notebook is not responding') - at(crash, 'close');
  assert.ok(waited >= 4500 && waited < 9000,
    `the watchdog waits ~5 s for the page before asking (waited ${waited} ms)\n` + why);
});

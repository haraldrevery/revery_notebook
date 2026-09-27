'use strict';

/* E2E for the web version's autosave (localStorage) when the page is
   hidden or unloaded: the real app in web mode
   (test/helpers/web_autosave_e2e_driver.js via web_e2e_main.js).

   The write rides the render debounce, which the CPU-delay setting can
   stretch to seconds, and a phone may discard a backgrounded tab before
   it fires: that typing was lost. A pending write is now flushed on
   visibilitychange→hidden and pagehide. Only a pending one: an idle tab
   must never overwrite another tab's newer autosave. Skipped when no
   display is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('web autosave: pending typing is written on hide, an idle tab writes nothing', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'web_autosave_e2e_driver.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VSCode terminals leak this; it breaks require('electron') in the child

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript, driver, '60000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`electron exited ${code}\n${out}`));
    });
  });
  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));

  assert.equal(r.debounceStillPending, true, 'setup: the debounced write must not have happened yet');
  assert.equal(r.pagehideWritesPending, true, 'pagehide must write typing the debounce has not written yet');
  assert.equal(r.hiddenWritesPending, true, 'a hidden page must write typing the debounce has not written yet');
  assert.equal(r.idleTabWritesNothing, true, 'a tab with nothing pending must not overwrite another tab\'s autosave');
  assert.equal(r.oldTimerWritesNothing, true, 'a debounce timer after a flush must not overwrite another tab\'s autosave');
  assert.equal(r.debounceStillWrites, true, 'normal typing still autosaves through the debounce');
});

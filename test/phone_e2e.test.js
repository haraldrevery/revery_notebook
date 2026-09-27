'use strict';

/* E2E check for the phone layout (≤ 820px): the real app in web mode at
   390px (test/helpers/phone_e2e_driver.js via web_e2e_main.js). Each
   assertion failed before the phone-layout pass: a dead sidebar button in
   the web version, a view toggle whose label went backwards, a title
   capped at 40vw, and reader mode that showed a blank screen (entered
   from the editor view) or had no Exit button (from the preview view).
   The last four failed before the mobile-audit fixes: status warnings
   hidden in every view, submenus a tap could not open, a stale HTML
   export, and an About dialog with no way out on a short screen.
   Skipped when no display is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('phone layout: views, toggle label, reader mode', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'phone_e2e_driver.js');

  const env = { ...process.env, E2E_WINDOW_SIZE: '390x780' };
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

  assert.ok(r.width <= 820, `window must be in the phone layout (innerWidth ${r.width})`);
  assert.equal(r.noSidebarButton, true, 'the web version has no project sidebar, so no sidebar button');
  assert.equal(r.toggleLabels, 'Preview/Editor/Preview', 'the view toggle names the view it switches to');
  assert.equal(r.toggleSwitchesView, true, 'the toggle shows one pane at a time');
  assert.equal(r.titleFillsRow, true, 'the document title takes the rest of its row');
  assert.equal(r.readerShowsPreview, true, 'reader mode from the editor view must show the preview, not a blank screen');
  assert.equal(r.readerHasExit, true, 'reader mode must offer Exit Reader Mode');
  assert.equal(r.readerOneRow, true, 'reader mode uses a single header row');
  assert.equal(r.readerExits, true, 'Exit Reader Mode returns to the preview view with its toggle');
  assert.equal(r.warningsVisible, true, 'status warnings (storage full, tab conflict, save held) must show in every phone view');
  assert.equal(r.tapOpensSubmenu, true, 'a tap must open a submenu (its mouseenter must not open it for the click to shut)');
  assert.equal(r.htmlExportFresh, true, 'Export as .html must carry the latest text, not the last rendered preview');
  assert.equal(r.aboutClosable, true, 'About must be closable: Close on screen, Escape, backdrop tap');
  assert.equal(r.noHorizontalOverflow, true, 'nothing may be wider than the phone');
});

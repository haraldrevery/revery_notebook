'use strict';

/* E2E check for text typography — Settings → Editor font… / Preview
   font…, the popup, the pane −/+ buttons — in the real app in web mode
   (test/helpers/typography_e2e_driver.js via web_e2e_main.js), at a
   desktop, a phone and a short landscape window size.
   The click checks failed before typography changes re-measured the
   editor: after three −/+ steps the first click in the classic editor
   landed 4 lines below the pointer, after a font change 6, and live
   preview's height map was 426px off.
   Skipped when no display is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

async function runDriver(windowSize) {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'typography_e2e_driver.js');
  const env = { ...process.env };
  if (windowSize) env.E2E_WINDOW_SIZE = windowSize;
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
  return JSON.parse(line.slice('E2E-RESULT: '.length));
}

test('typography: the editor follows changes; the font popup applies, saves and closes', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const r = await runDriver();

  for (const k of ['classicClickAfterSize', 'classicClickAfterFont', 'lpClickAfterSize']) {
    assert.equal(typeof r[k].clicked, 'number', `${k}: no paragraph was clicked (${JSON.stringify(r[k])})`);
  }
  assert.equal(r.classicClickAfterSize.landed, r.classicClickAfterSize.clicked,
    'after −/+ the first click must land on the line under the pointer');
  assert.equal(r.classicClickAfterFont.landed, r.classicClickAfterFont.clicked,
    'after a font change the first click must land on the line under the pointer');
  assert.ok(r.lpMapDriftAfterSize <= 2,
    `live preview: the height map must match the drawn blocks after −/+ (off by ${r.lpMapDriftAfterSize}px)`);
  assert.equal(r.lpClickAfterSize.landed, r.lpClickAfterSize.clicked,
    'live preview: after −/+ the first click must land on the block under the pointer');

  assert.equal(r.settingsRows, true, 'Settings has Editor font… and Preview font…, and no font type / text size submenus');
  assert.equal(r.editorPopupOpens, true, 'Editor font… opens the Editor popup showing the current font and size');
  assert.equal(r.sizeFromList, true, 'a size picked in the list applies and is saved');
  assert.equal(r.plusMinusUpdatesPopup, true, 'the −/+ buttons keep the popup open and it shows their size');
  assert.equal(r.fontFromList, true, 'a font picked in the list applies and is saved');
  assert.equal(r.lineSlider, true, 'line height applies while dragged and is saved on release');
  assert.equal(r.letterSlider, true, 'letter spacing applies and is saved');
  assert.equal(r.valuesShown, true, 'the slider shows its value');
  assert.equal(r.noLeakOutsideText, true, 'editor spacing must not reach the menus or page-level elements (PDF print root)');
  assert.equal(r.resetDefaults, true, 'Reset restores and saves the defaults, clearing the CSS variables');
  assert.equal(r.escapeCloses, true, 'Escape closes the popup');
  assert.equal(r.previewSpacing, true, 'the Preview popup scales the preview paragraphs');
  assert.equal(r.dblclickResets, true, 'a double click on a slider puts it back to its default, saved');
  assert.equal(r.doubleTapResets, true, 'a double tap resets a slider; two slow presses do not');
  assert.equal(r.typedValues, true, `a typed value applies (comma decimals, clamped, on a step), junk changes nothing, Escape undoes it: ${JSON.stringify(r.typedValuesDetail || {})}`);
  assert.equal(r.previewNoLeak, true, 'preview spacing must not reach the menus or page-level elements (PDF print root)');
  assert.equal(r.outsideClickCloses, true, 'a click elsewhere closes the popup; a −/+ click does not');
  assert.equal(r.customFontsInPopup, true, 'the importer opens over the popup; an added font is listed and chosen; its ✕ deletes it');
  assert.equal(r.lpOpensPreview, true, 'in live preview, Editor font… opens the Preview popup, with a note');
  assert.equal(r.loadRejectsDamage, true, 'damaged stored values keep their defaults');
  assert.equal(r.loadSnapsToGrid, true, 'stored spacing values snap onto the slider steps');
});

test('typography: the font popup is a bottom panel on a phone', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const r = await runDriver('390x780');
  assert.ok(r.width <= 820, `window must be in the phone layout (innerWidth ${r.width})`);
  assert.equal(r.phonePanel, true, 'a full-width panel at the bottom, at most about half the screen');
  assert.equal(r.phoneCloseReachable, true, 'with the font list open the panel scrolls and Close is reachable');
  assert.equal(r.keyboardLifts, true, 'an on-screen keyboard lifts the panel above it, and it drops back after');
  assert.equal(r.phoneToggleKeepsOpen, true, 'the view toggle keeps the panel open');
  assert.equal(r.phoneEscapeCloses, true, 'Escape closes the open list, then the panel');
  assert.equal(r.noHorizontalOverflow, true, 'nothing may be wider than the phone');
});

test('typography: the font popup fits a short window', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const r = await runDriver('844x390');
  assert.ok(r.width > 820 && r.height < 500, `window must be short and in the desktop layout (${r.width}x${r.height})`);
  assert.equal(r.shortFits, true, 'the docked panel stays inside the window');
  assert.equal(r.shortCloseReachable, true, 'Close is reachable by scrolling the panel');
  assert.equal(r.shortEscapeCloses, true, 'Escape closes the open list, then the panel');
});

'use strict';

/* E2E check for the theme palettes: spawns the real Electron binary with
   the generic web-mode main once per OS color scheme and measures the
   rendered colors (test/helpers/theme_e2e_driver.js). Guards the rule that
   every light/dark-dependent style follows the APP palette (html.dark),
   never the OS setting or a theme name. Each assertion below failed on the
   code before that rule: Paper's selection was white-on-cream (1.03:1),
   Forest's editor code kept light-theme token colors (1.37:1), and with
   the OS in dark mode Light/Paper footnotes turned white (1.05:1).
   Skipped when no display is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

async function runDriver(colorScheme) {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'theme_e2e_driver.js');

  const env = { ...process.env, E2E_COLOR_SCHEME: colorScheme };
  delete env.ELECTRON_RUN_AS_NODE;

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript, driver, '100000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

/* Readability floor shared by every palette, built-in or custom. */
function assertReadable(name, m) {
  assert.equal(m.darkClass, m.bgIsDark,
    `${name}: html.dark must match the palette's actual background lightness`);
  assert.ok(m.body >= 7, `${name}: body text contrast ${m.body} < 7`);
  assert.ok(m.footnoteRef >= 4.5, `${name}: footnote reference contrast ${m.footnoteRef} < 4.5`);
  assert.ok(m.footnoteText >= 4.5, `${name}: footnote text contrast ${m.footnoteText} < 4.5`);
  assert.ok(m.footnoteMarker >= 3, `${name}: footnote number contrast ${m.footnoteMarker} < 3`);
  assert.ok(m.selection >= 1.3, `${name}: editor selection is invisible (${m.selection}:1 against the background)`);
  assert.ok(m.editorCodeMin >= 4.5, `${name}: lowest editor code-token contrast ${m.editorCodeMin} < 4.5`);
  assert.equal(m.overlayMatchesBg, true, `${name}: background-image overlay must be tinted with the palette's --bg`);
}

for (const scheme of ['light', 'dark']) {
  test(`theme palettes follow the app theme, not the OS (OS ${scheme})`,
    { skip: !hasDisplay, timeout: 150000 }, async () => {
      const r = await runDriver(scheme);
      assert.equal(r.osDark, scheme === 'dark', 'the harness must emulate the requested OS color scheme');
      for (const [name, m] of Object.entries(r.builtIn)) {
        assert.equal(m.dataTheme, name);
        assertReadable(name, m);
        assert.equal(m.editorFlash, '255,200,60', `${name}: the editor click flash stays yellow`);
        assert.equal(m.previewFlash, '255,200,60', `${name}: the preview click flash stays yellow`);
      }
      /* Custom palettes are held to the same floor in the real page (the
         unit test covers every slider combination on the raw colors). */
      for (const [name, m] of Object.entries(r.custom)) {
        assertReadable(`custom ${name}`, m);
        assert.equal(m.oneTextColor, true, `custom ${name}: every text must use the picked text color`);
        assert.notEqual(m.flashVar, '255,200,60');
        assert.equal(m.editorFlash, m.flashVar, `custom ${name}: the editor click flash follows the highlight`);
        assert.equal(m.previewFlash, m.flashVar, `custom ${name}: the preview click flash follows the highlight`);
      }

      /* In-app PDF print renders inside the themed page; an unscoped dark
         footnote rule once printed gray-300 on white (1.47:1). */
      for (const [name, min] of Object.entries(r.print)) {
        assert.ok(typeof min === 'number' && min >= 4.5,
          `in-app print under ${name}: lowest text contrast on paper ${min} < 4.5`);
      }

      assert.deepEqual(r.dialog, {
        opens: true,
        startsOnScreenBase: true,
        textSlidersApply: true,
        bgSlidersApply: true,
        escapeRestores: true,
        outsideClickRestores: true,
        saves: true,
        menuMarksCustom: true,
        opacityIndependent: true,
        reopensWithSaved: true,
        resetKeepsBase: true,
        cancelRestoresSavedCustom: true,
        builtInClearsCustom: true,
      }, 'custom theme dialog flow');
    });
}

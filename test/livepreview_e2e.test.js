'use strict';

/* E2E check for the live preview's POINTER model: spawns the real
   Electron binary with the generic web-mode main and drives the actual
   editor with DOM mouse events (test/helpers/lp_e2e_driver.js). The
   properties asserted are the user-facing ones that were reported broken:
   clicks landing on the wrong line/column, drags that select nothing or
   flip blocks under the pointer. Skipped when no display is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('live preview pointer model end-to-end', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'lp_e2e_driver.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript, driver, '75000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

  assert.deepEqual(r.clickWord,
    { found: true, revealed: true, onLine: true, inWord: true, collapsed: true, rowUnderPointer: true },
    'clicking a rendered word must reveal its block with the cursor ON that word, row kept under the pointer');
  assert.deepEqual(r.clickListItem, { found: true, onLine: true, inWord: true },
    'clicking a list item must land on that item line, inside the clicked word');
  assert.deepEqual(r.clickCodeLine, { found: true, onLine: true, inWord: true },
    'clicking inside a fenced code block must land on that code line, inside the clicked token');
  assert.deepEqual(r.clickTableCell, { found: true, onLine: true, inWord: true },
    'clicking a table cell must land on that row line, inside the cell text');
  assert.deepEqual(r.clickWrappedRow, { found: true, lowerRow: true, inWord: true, rowUnderPointer: true },
    'clicking a lower visual row of a wrapped paragraph must land on that word and keep the row under the pointer');
  assert.deepEqual(r.dragFromWidget,
    { found: true, targetVisible: true, nonEmpty: true, anchorInFirst: true, headInInside: true, blockRaw: true },
    'a drag starting on a rendered block must select text inside it');
  assert.deepEqual(r.dragAcross, {
    ready: true, thirdStillRendered: true, thirdMarkedSelected: true, bandCoversThird: true,
    coversThird: true, anchorKept: true, stableHead: true, overWidgetPartial: true,
    midHighlightPrefix: true, midBandStopsAtBlock: true, endHighlightCleared: true, secondStaysRaw: true,
  }, 'dragging across a rendered block must extend into it character by character (rendered, covered prefix painted), then select it whole (marked, band drawn) with a stable head');
  assert.deepEqual(r.dragUpOverFirst, {
    ready: true, headInHeadingWord: true, titleTailPainted: true,
    headInTitle: true, stableHead: true, titleStaysRendered: true, titleWholeAtEdge: true,
  }, 'dragging upward into the heading must land on the word under the pointer with its tail painted; at the block edge it must rest at offset 0 with the heading rendered and selected whole');
  assert.deepEqual(r.dragIntoWord,
    { ready: true, headInWord: true, thirdRendered: true, paintedUpToPointer: true, anchorKept: true },
    'a drag into a rendered paragraph must land on the word under the pointer and paint exactly the text up to it');
  assert.deepEqual(r.keyboardPartial,
    { headAfterFive: true, thirdRendered: true, painted: true, typedOver: true },
    'Shift+Arrow into a rendered paragraph must paint exactly the selected characters and typing must replace them in the source');
  assert.deepEqual(r.dblClickWord, { found: true, selectsWord: true },
    'double-clicking a rendered word must select that word in the source');
  assert.deepEqual(r.shiftClick,
    { found: true, anchorKept: true, headInThird: true, thirdRendered: true, prefixPainted: true, firstRaw: true },
    'shift-clicking a rendered block must extend the selection into it while it stays rendered with the covered prefix painted');
  assert.deepEqual(r.rightClick, { found: true, placesCursor: true, noDrag: true },
    'right-clicking a rendered block must place the cursor there and never drag');
  assert.deepEqual(r.selectAll, { firstRendered: true, thirdRendered: true, textUnchanged: true },
    'select-all must keep spanned blocks rendered and marked, without touching the text');
  assert.equal(r.arrowReveals, true, 'ArrowDown into a rendered block must still reveal it');
  assert.deepEqual(r.checkboxNoReveal, { found: true, stillRendered: true, docUntouched: true },
    'a mousedown on a task checkbox must neither reveal the block nor edit the document');
  assert.deepEqual(r.yamlPill, { found: true, onStatusLine: true, revealed: true },
    'clicking a YAML pill must reveal the frontmatter with the cursor on that key line');
  assert.equal(r.offClean, true, 'toggling live preview off must remove every widget');
});

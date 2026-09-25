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

test('live preview pointer model end-to-end', { skip: !hasDisplay, timeout: 180000 }, async () => {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const driver = path.join(__dirname, 'helpers', 'lp_e2e_driver.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript, driver, '160000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    { found: true, revealed: true, onLine: true, inWord: true, collapsed: true, topKept: true },
    'clicking a rendered word must reveal its block with the cursor ON that word, the block\'s top edge kept in place');
  assert.deepEqual(r.clickListItem, { found: true, onLine: true, inWord: true },
    'clicking a list item must land on that item line, inside the clicked word');
  assert.deepEqual(r.clickCodeLine, { found: true, onLine: true, inWord: true },
    'clicking inside a fenced code block must land on that code line, inside the clicked token');
  assert.deepEqual(r.clickTableCell, { found: true, onLine: true, inWord: true },
    'clicking a table cell must land on that row line, inside the cell text');
  assert.deepEqual(r.clickWrappedRow, { found: true, lowerRow: true, inWord: true, topKept: true },
    'clicking a lower visual row of a wrapped paragraph must land on that word and keep the paragraph\'s top edge in place');
  assert.deepEqual(r.clickJitter,
    { found: true, renderedWhilePressed: true, noSelection: true, revealedOnRelease: true, inWord: true },
    'the layout must not change while the button is down, and a few px of pointer jitter during a click must not select anything');
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
    'clicking a YAML row must reveal the frontmatter with the cursor on that key line');
  assert.deepEqual(r.yamlSheet, {
    openCursorAfterYaml: true, openShowsSheet: true, readsShapes: true, keyNotSqueezed: true, previewParity: true,
    folds: true, foldDisplayOnly: true, foldKeepsHeader: true, foldHeightExact: true, foldPersisted: true,
    foldedMarginClickOutside: true, foldIsGlobal: true, cursorInsideShowsRaw: true, foldReturns: true, unfolds: true,
  }, 'the Properties sheet must show on open, read lists/maps/block scalars, and fold through its toggle as a persisted, display-only choice that never hides the raw YAML from a cursor inside it');
  assert.deepEqual(r.yamlExport, { captured: true, listJoined: true, mapJoined: true },
    'the HTML export metadata table must keep list and nested values separated');
  assert.deepEqual(r.fmStraddle, { dotsCloser: true, fenceInScalar: true },
    'the body below a frontmatter the markdown parser misreads must still render');
  assert.deepEqual(r.readerFold, {
    toggleInReader: true, folds: true, noEditorSelection: true, exportKeepsRows: true,
    sharedWithLivePreview: true, splitPaneNeverFolds: true, unfoldShared: true,
  }, 'reader mode must fold the sheet with the same stored choice as live preview, without touching the editor, the HTML export or the split-view preview');
  assert.equal(r.sheetFollowsPreviewSize, true, 'the Properties sheet must scale with the preview text size');
  assert.deepEqual(r.staleGesture, { pressed: true, editOk: true, screenMatchesDoc: true, noErrors: true },
    'a mouse press still held when the document is swapped must not corrupt the next edit (screen and saved text must agree)');
  assert.deepEqual(r.yamlAutocomplete, { opens: true, typedFilters: true, tabTakesTyped: true, quotesSpecial: true, unicodeKey: true },
    'frontmatter autocomplete must filter by what is typed after a click, quote values YAML cannot hold plain, and suggest for any-letter keys');
  assert.deepEqual(r.yamlTemplates, {
    mergesMissing: true, oneUndo: true, nothingMissingNoop: true, mdBelowFrontmatter: true,
    yamlOnTopWithoutFm: true, fenceLessRefused: true,
  }, 'templates must never break the frontmatter: YAML merges missing keys, markdown goes below it, fence-less YAML templates are refused');
  assert.deepEqual(r.exportMeta, { foldedTitle: true, emptyAuthor: true },
    'export metadata must read the frontmatter like the sheet does');
  assert.ok(r.heightMap.widgets >= 8 && r.heightMap.maxDrift <= 1,
    `CodeMirror's height map must match the screen for every rendered block, even below lists and quotes (widgets must contain their margins): ${JSON.stringify(r.heightMap)}`);
  assert.deepEqual(r.edgeAbove, { found: true, onBlankLine: true, stillRendered: true, noScroll: true },
    'a click on the blank line just above a rendered block must land on that line: no reveal, no scroll');
  assert.deepEqual(r.edgeBelow, { found: true, onBlankLine: true, stillRendered: true, noScroll: true },
    'a click on the blank line just below a rendered block must land on that line: no reveal, no scroll');
  assert.deepEqual(r.sideClick, { found: true, targetIsPadding: true, onLine: true, lowerRow: true, topKept: true },
    'a click in the padding beside a lower row of a rendered paragraph must land on that row, the top edge kept in place');
  assert.deepEqual(r.shiftSoftLow, { found: true, revealed: true, aboveKept: true, belowKept: false },
    'a block clicked low on the screen must change height downward only (less visible text below it)');
  assert.deepEqual(r.shiftSoftHigh, { found: true, revealed: true, aboveKept: false, belowKept: true },
    'a block clicked high on the screen must change height upward only (less visible text above it)');
  assert.deepEqual(r.shiftTableLow, { found: true, revealed: true, aboveKept: true, belowKept: false },
    'a table (shorter raw) clicked low on the screen must shrink from below');
  assert.deepEqual(r.tallRowPin, { found: true, bothEdgesOff: true, onRow: true, underPointer: true },
    'a block taller than the screen must keep the clicked row under the pointer');
  assert.deepEqual(r.typingMerge, { revealed: true, caretKept: true },
    'typing that merges the caret line into the block above must not move the caret line');
  assert.deepEqual(r.arrowLeave, { onBlank: true, rerendered: true, kept: true },
    'ArrowDown out of a revealed block must keep the line the caret lands on in place');
  assert.deepEqual(r.arrowUpTall, { onPara: true, lastRow: true, noJump: true, caretVisible: true },
    'ArrowUp into a tall paragraph must land on its last row without jumping the view');
  assert.deepEqual(r.mediaImage, { rendered: true, sourceShown: true, previewBelow: true },
    'an edited image must show its source with the rendered image still below it');
  assert.deepEqual(r.mediaMath, { previewBelow: true, followsTyping: true, imageBackToRendered: true },
    'an edited $$ block must show its rendered formula below the source, updated while typing');
  assert.ok(r.heightEstimate.drift <= Math.max(40, r.heightEstimate.total * 0.01),
    `rendered blocks CodeMirror has not drawn must keep their measured heights: ${JSON.stringify(r.heightEstimate)}`);
  for (const key of ['rawParity', 'rawParitySmall']) {
    for (const [kind, diff] of Object.entries(r[key])) {
      assert.ok(Math.abs(diff) <= 2,
        `${key}.${kind}: the edited block's raw lines must keep its rendered height (diff ${diff} px): ${JSON.stringify(r[key])}`);
    }
  }
  assert.deepEqual(r.collapseAbove, { found: true, firstRevealed: true, firstRerendered: true, aboveKept: true },
    'when the block being edited re-renders above, the newly clicked block must keep its place');
  assert.deepEqual(r.collapseOffscreen, { found: true, firstRevealed: true, firstRerendered: true, aboveKept: true },
    'when the block being edited re-renders out of view above, the clicked block must keep its place (no double compensation with CodeMirror\'s scroll anchoring)');
  assert.equal(r.offClean, true, 'toggling live preview off must remove every widget');
});

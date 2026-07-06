'use strict';

/* E2E check for the worker-based regex search: spawns the real Electron
   binary with test/helpers/find_e2e_main.js, which loads www/index.html
   and drives the actual find bar. Verifies the three properties Stage 5
   promised:
     1. safe patterns the old heuristic rejected (e.g. `(alpha|beta)`) work;
     2. a catastrophic pattern is aborted by the worker timeout without
        freezing the page;
     3. the worker is rebuilt afterwards and Replace All (incl. `$&`
        substitution) runs through it.
   Skipped when no display server is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('find/replace regex worker end-to-end', { skip: !hasDisplay, timeout: 60000 }, async () => {
  const electronBin = require('electron'); // path string under plain node
  const mainScript  = path.join(__dirname, 'helpers', 'find_e2e_main.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VSCode terminals leak this; it breaks require('electron') in the child

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`electron exited ${code}\n${out}`));
    });
  });

  assert.match(output, /\[Find\] Regex search worker ready\./,
    'the worker must actually construct in Electron — otherwise the sync fallback silently took over');

  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));

  // 1. (alpha|beta) on 'alpha beta gamma alpha beta' → 4 matches, "1 / 4"
  assert.equal(r.safeCount, 4, 'heuristic-rejected pattern must now find its matches');
  assert.match(r.safeLabel, /4/);

  // 2. catastrophic pattern: aborted (0 matches), page alive, took ≥ timeout
  assert.equal(r.redosCount, 0);
  assert.ok(r.redosElapsed >= 1400, `expected to wait out the worker timeout, elapsed ${r.redosElapsed}ms`);

  // 3. fresh worker afterwards: [a-z]\d on 'x1 y2 z3' → 3 matches
  assert.equal(r.recoveredCount, 3, 'worker must be rebuilt after a timeout kill');

  // 4. Replace All through the worker with $& substitution
  assert.equal(r.replacedText, '<x1> <y2> <z3>');

  // 5. closing the bar mid-flight invalidates the search — no ghost results
  assert.equal(r.ghostCount, 0, 'in-flight result must not apply after closeFindBar');
  assert.equal(r.barHidden, true);

  // 6. superseding a catastrophic search gets a fresh worker immediately
  assert.equal(r.supersededCount, 4, 'search after superseding must not queue behind the old job');

  // 7. slow hardware mode: flag, body class, background suppression, persistence
  assert.deepEqual(r.slowOn,  { flag: true,  bodyClass: true,  bgGone: true,     persisted: true },
    'enabling slow hardware mode must apply and persist');
  // (off-state fields are success-booleans: flag/persisted verify `=== false`)
  assert.deepEqual(r.slowOff, { flag: true, bodyClass: false, bgRestored: true, persisted: true },
    'disabling slow hardware mode must restore the user background and persist');

  // 8. background customization: opacity override + custom image roundtrip
  assert.equal(r.opSet, true, 'setBackgroundOpacity must set the CSS var and persist');
  assert.equal(r.opCleared, true, 'clearing opacity must fall back to the per-theme default');
  assert.equal(r.bgApplied, true, 'custom background must apply from a data URL and persist');
  assert.equal(r.bgRemoved, true, 'removing the custom background must clean storage and fall back');

  // 9. full import pipeline: File → decode → downscale → store → COMPUTED style
  assert.deepEqual(r.pipeline, { stored: true, selected: true, rendered: true, opacityBumped: true },
    'a real picked image must decode under the CSP and visibly render on #preview');

  // 10. live preview v2: rendered blocks, reveal-on-selection (block
  //     granularity), fresh-state survival, clean off
  assert.deepEqual(r.lpOnState, {
    paneHidden: true, headingClass: true, marksHidden: true, boldStyled: true,
    marksRevealed: true, survivedReplace: true,
  }, 'live preview must render blocks, reveal raw markdown on the edited block, and survive file switches');
  assert.deepEqual(r.lpOffState, { decorationsGone: true, paneBack: true, persistedOff: true },
    'toggling live preview off must fully restore the classic editor');

  // 11. v2 preview-parity: same renderer, same prose CSS, computed-style
  //     EQUALITY with #preview (the assertions the user reports are about)
  assert.deepEqual(r.lpV2, {
    hrWidget: true, bullet: true, imageWidget: true,
    headingUpper: true, texture: true, imageParity: true, hrRevealsRaw: true,
    strikeRendered: true, copyButton: true, copyClickSafe: true,
    fenceHidden: true, fenceColored: true, fenceColorReal: true, codeFontParity: true, copyNoReveal: true,
    taskBoxes: true, taskDoneStyled: true, taskToggled: true,
    mathInline: true, mathBlock: true, mathMultiline: true,
    currencySafe: true, codeMathRaw: true,
    fmProtected: true, fmReveals: true, fmPillsReturn: true, mathRevealsRaw: true,
    sizeMatchesPreview: true, h1Parity: true, sizeNotEditorBound: true,
    familyFollows: true, familyRestores: true, katexSizeParity: true,
    tableRendered: true, tableParity: true, tableClickReveals: true, tableReturns: true,
    clickUnderPointer: true, outlineScrollOnly: true, readerOutlineScrolls: true,
    edgeClickNoSteal: true, outlineSyncs: true, paddingParity: true,
    readerPadding: true, readerPaddingResets: true,
  }, 'v2 blocks must render through the preview pipeline with computed-style parity: headers, code font+colors, hidden fences, image sizing, tables, multi-line math');

  // 12. zip export is desktop-only — absent from the File menu in web mode
  assert.equal(r.zipEntryHidden, true, 'Zip Project Export must be hidden in web mode');

  // 13. YAML frontmatter autocomplete: keys, click-to-open, accept, gated
  assert.deepEqual(r.yamlComplete, {
    keyMenu: true, keySuggests: true,
    clickOpens: true, valueSuggests: true,
    accepts: true, bodyQuiet: true, midTokenClean: true,
    pillOpensMenu: true, pillValueMenu: true, commaListValues: true,
  }, 'frontmatter autocomplete must suggest keys/values, open on click (incl. LP pills), accept via arrows+enter, replace whole tokens, index comma lists, and stay silent outside frontmatter');

  // 13b. export suite: LaTeX templates/engines/TOC + PDF options, menu entries
  assert.deepEqual(r.exportSuite, {
    reportClass: true, chapterPromotion: true, xelatexFontspec: true, tocOn: true,
    articleSection: true, pdflatexInputenc: true, noTitleNoToc: true,
    pdfFrontPage: true, pdfTocLinks: true, pdfPageOpts: true, pdfDefaultsClean: true,
    pdfMenuEntry: true, latexMenuEntry: true,
    a5Size: true, a6Size: true, newPageHeaders: true, noHeaderBreaks: true,
    coverNamedPage: true, fontApplied: true, assetBase: true, latexTocClearpage: true,
    nativeInvoked: true, nativeRootDuringCall: true, nativeCleanedAfter: true,
    fallbackOnError: true, fallbackCleaned: true,
  }, 'export builders + the Tauri native-print branch (inject→invoke→cleanup, fallback to window.print on error) and LaTeX/@page/font/asset options');

  // 14. outline +/- buttons scale only the outline font, persisted
  assert.equal(r.outlineFontButtons, true, 'outline font buttons must step and persist the existing setting');
});

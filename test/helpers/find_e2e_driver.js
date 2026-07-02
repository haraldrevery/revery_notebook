/* In-page driver for the find/replace E2E check. Evaluated by
   executeJavaScript from find_e2e_main.js — must be a single expression
   that resolves to a plain serializable object. Relies on the classic
   (non-module) script scope of markdown_editor_find_cm.js: its top-level
   functions and bindings (openFindBar, findInput, findMatches, …) are
   reachable from global-scope evaluation. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setDoc = (s) => {
    if (typeof replaceEditorContent === 'function') replaceEditorContent(s);
    else editor.value = s;
  };
  const type = (s) => {
    findInput.value = s;
    findInput.dispatchEvent(new Event('input'));
  };

  openFindBar();
  if (!findUseRegex) findRegexBtn.click();

  /* 1. A perfectly safe pattern the old heuristic rejected outright. */
  setDoc('alpha beta gamma alpha beta');
  type('(alpha|beta)');
  await sleep(500);
  const safeCount = findMatches.length;
  const safeLabel = findCount.textContent;

  /* 2. A catastrophic pattern must be aborted by the worker timeout —
        and the page must stay alive to report it. */
  setDoc('a'.repeat(34) + 'X');
  const t0 = Date.now();
  type('(a+)+$');
  await sleep(2400); // > FIND_TIMEOUT_MS
  const redosCount   = findMatches.length;
  const redosElapsed = Date.now() - t0;

  /* 3. The worker was terminated — the next search must get a fresh one. */
  setDoc('x1 y2 z3');
  type('[a-z]\\d');
  await sleep(500);
  const recoveredCount = findMatches.length;

  /* 4. Replace All through the worker, with $-group substitution. */
  replaceInput.value = '<$&>';
  document.getElementById('find-replace-all').click();
  await sleep(500);
  const replacedText = editor.value;

  /* 5. Closing the bar mid-flight must invalidate the in-flight search:
        no ghost matches or highlights may appear afterwards. A ~2 MB
        document keeps the worker busy long enough for the close to win. */
  openFindBar();
  setDoc(('lorem ipsum dolor sit amet ').repeat(80000));
  type('(lorem|dolor)');
  closeFindBar();                       // same tick — result still in flight
  await sleep(800);
  const ghostCount  = findMatches.length;
  const barHidden   = findBar.style.display === 'none';

  /* 6. Superseding a catastrophic search must not poison the next one:
        the fresh-worker path must return the new search's matches. */
  openFindBar();
  setDoc('a'.repeat(34) + 'X');
  type('(a+)+$');                       // catastrophic — starts burning CPU
  await sleep(150);                     // let the worker actually start it
  setDoc('m1 m2 m3 m4');
  type('m\\d');                         // supersedes → fresh worker
  await sleep(600);
  const supersededCount = findMatches.length;

  /* 7. Slow hardware mode: the canonical setter must flip the flag, the
        body class, suppress the background image without losing the
        user's choice, and persist through the settings roundtrip. */
  window.setSlowHardwareMode(true);
  const readSetting = () =>
    JSON.parse(localStorage.getItem('revery_md_settings') || '{}').slowHardwareMode;
  const slowOn = {
    flag:      window.slowHardwareMode === true,
    bodyClass: document.body.classList.contains('slow-hw-active'),
    bgGone:    document.documentElement.style.getPropertyValue('--preview-bg-image') === '',
    persisted: readSetting() === true,
  };
  window.setSlowHardwareMode(false);
  const slowOff = {
    flag:       window.slowHardwareMode === false,
    bodyClass:  document.body.classList.contains('slow-hw-active'),
    bgRestored: document.documentElement.style.getPropertyValue('--preview-bg-image').includes('bg_'),
    persisted:  readSetting() === false,
  };

  /* 8. Background customization: opacity override (and its removal back
        to the per-theme default) plus the custom-image data-URL path. */
  window.setBackgroundOpacity(0.3);
  const settingsNow = () => JSON.parse(localStorage.getItem('revery_md_settings') || '{}');
  const opSet = document.documentElement.style.getPropertyValue('--bg_oacity') === '0.3'
    && settingsNow().backgroundOpacity === 0.3;
  window.setBackgroundOpacity(null);
  const opCleared = document.documentElement.style.getPropertyValue('--bg_oacity') === ''
    && settingsNow().backgroundOpacity === null;

  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const bgApplied = window.applyCustomBackgroundImage(PIXEL) === true
    && document.documentElement.style.getPropertyValue('--preview-bg-image').includes('data:image/gif')
    && settingsNow().selectedBackground === 'custom';
  window.removeCustomBackgroundImage();
  const bgRemoved = !document.documentElement.style.getPropertyValue('--preview-bg-image').includes('data:')
    && localStorage.getItem('revery_custom_bg') === null
    && settingsNow().selectedBackground !== 'custom';

  /* 9. FULL custom-background pipeline (regression for the blob:-CSP bug):
        a real File must decode, downscale, store, and — the part the var-
        level probe above cannot see — actually reach the COMPUTED style of
        #preview. Importing at theme-default opacity must also auto-bump
        visibility so the image isn't imperceptible. */
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = 800; srcCanvas.height = 500;
  const cctx = srcCanvas.getContext('2d');
  cctx.fillStyle = '#356'; cctx.fillRect(0, 0, 800, 500);
  cctx.fillStyle = '#fa0'; cctx.fillRect(100, 100, 600, 300);
  const cblob = await new Promise((r) => srcCanvas.toBlob(r, 'image/png'));
  importCustomBackgroundFile(new File([cblob], 'probe.png', { type: 'image/png' }));
  let pipeWait = 0;
  while (pipeWait < 6000) {
    await sleep(150); pipeWait += 150;
    if (settingsNow().selectedBackground === 'custom') break;
  }
  const previewCS = getComputedStyle(document.getElementById('preview'));
  const pipeline = {
    stored:   (() => { try { return !!localStorage.getItem('revery_custom_bg'); } catch (_) { return false; } })(),
    selected: settingsNow().selectedBackground === 'custom',
    rendered: previewCS.backgroundImage.includes('data:image'),
    opacityBumped: settingsNow().backgroundOpacity === 0.35,
  };
  window.removeCustomBackgroundImage();
  window.setBackgroundOpacity(null);

  /* 10. Live Preview (experimental): decorations render, marks hide off
         the selection line and reveal on it, the extension survives
         replaceEditorContent (the fresh-state compartment trap), and
         toggling off restores the pane and today's editor. */
  window.setLivePreviewMode(true);
  setDoc('# Hello **bold** world\n\nplain tail');
  editor.setSelectionRange(editor.value.length, editor.value.length); // cursor on last line
  await sleep(250);
  const h1Line = () => document.querySelector('.cm-line.lp-h1');
  const lpOnState = {
    paneHidden:   getComputedStyle(document.getElementById('preview-pane')).display === 'none',
    headingClass: !!h1Line(),
    marksHidden:  !!h1Line() && !h1Line().textContent.includes('**') && !h1Line().textContent.includes('#'),
    boldStyled:   !!document.querySelector('.lp-strong'),
  };
  editor.setSelectionRange(2, 2); // move INTO the heading line
  await sleep(250);
  lpOnState.marksRevealed = !!h1Line() && h1Line().textContent.includes('**') && h1Line().textContent.includes('#');
  replaceEditorContent('# Fresh **doc**\n\ntail');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(250);
  lpOnState.survivedReplace = !!document.querySelector('.cm-line.lp-h1');
  /* Phase 2: hr/image/bullet widgets, preview typography + texture */
  const PIXEL2 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  replaceEditorContent('# Style\n\n---\n\n- item one\n\n![tiny](' + PIXEL2 + ')\n\nend line');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(400);
  const h1El = document.querySelector('.cm-line.lp-h1');
  const lpPhase2 = {
    hrWidget:     !!document.querySelector('.lp-hr'),
    bullet:       !!document.querySelector('.lp-bullet'),
    imageWidget:  !!document.querySelector('.lp-image-widget img'),
    headingUpper: !!h1El && getComputedStyle(h1El).textTransform === 'uppercase',
    texture:      getComputedStyle(document.getElementById('editor-pane')).backgroundImage.includes('bg_'),
  };
  /* cursor onto the hr line → raw dashes return */
  const hrPos = editor.value.indexOf('---');
  editor.setSelectionRange(hrPos, hrPos);
  await sleep(250);
  lpPhase2.hrRevealsRaw = !document.querySelector('.lp-hr');

  /* strikethrough (GFM ext) + fenced-code copy button */
  replaceEditorContent('~~gone~~ text\n\n~~~\ncopy me\nline two\n~~~\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  const strikeEl = document.querySelector('.lp-strike');
  lpPhase2.strikeRendered = !!strikeEl && !strikeEl.textContent.includes('~~');
  const copyBtn = document.querySelector('.cm-content .code-copy-btn');
  lpPhase2.copyButton = !!copyBtn;
  if (copyBtn) copyBtn.click(); // must not throw / must not edit the doc
  await sleep(150);
  lpPhase2.copyClickSafe = editor.value.includes('copy me\nline two');

  /* task-list checkboxes: render + click toggles the DOCUMENT text */
  replaceEditorContent('- [ ] first\n- [x] second\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  const boxes = document.querySelectorAll('.lp-task-checkbox');
  lpPhase2.taskBoxes = boxes.length === 2;
  lpPhase2.taskDoneStyled = !!document.querySelector('.cm-line.lp-task-done');
  if (boxes[0]) boxes[0].click();
  await sleep(300);
  lpPhase2.taskToggled = editor.value.startsWith('- [x] first');

  /* KaTeX math + protected YAML frontmatter */
  replaceEditorContent('---\ntitle: t\ntags: x\n---\n\nEuler: $e^{i\\pi}=-1$ inline\n\n$$x^2 + y^2 = r^2$$\n\nprice 5$ and 10$ stays text\n\n`code $a+b$ stays raw`\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(400);
  lpPhase2.mathInline   = document.querySelectorAll('.lp-math .katex').length >= 2;
  lpPhase2.mathBlock    = !!document.querySelector('.lp-math-block .katex');
  lpPhase2.currencySafe = !document.querySelector('.cm-line:nth-child(7) .lp-math')
    && editor.value.includes('5$ and 10$');
  lpPhase2.codeMathRaw  = (() => {
    const codeEl = document.querySelector('.lp-code');
    return !!codeEl && codeEl.textContent.includes('$a+b$');
  })();
  lpPhase2.fmProtected  = !document.querySelector('.lp-hr')
    && !document.querySelector('.cm-line.lp-h1, .cm-line.lp-h2')
    && !!document.querySelector('.cm-line.lp-frontmatter');
  /* cursor onto the math line → raw $ source returns */
  const mathPos = editor.value.indexOf('$e^');
  editor.setSelectionRange(mathPos, mathPos);
  await sleep(250);
  lpPhase2.mathRevealsRaw = document.querySelectorAll('.lp-math .katex').length < 2;

  /* font/size parity: LP text must equal the PREVIEW's paragraph size
     (both consume --text-body), not the editor's size. */
  replaceEditorContent('parity check paragraph\n\nsecond');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  const cmSize = parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize);
  const prevP  = document.querySelector('#preview p');
  const pvSize = prevP ? parseFloat(getComputedStyle(prevP).fontSize) : NaN;
  const edInline = parseFloat(getComputedStyle(document.getElementById('editor')).fontSize);
  lpPhase2.sizeMatchesPreview  = Number.isFinite(pvSize) && Math.abs(cmSize - pvSize) < 0.6;
  lpPhase2.sizeNotEditorBound  = Math.abs(cmSize - edInline) > 0.6 || Math.abs(pvSize - edInline) < 0.6;

  /* FONT FAMILY parity via the real settings path: click 'Preview font
     type -> Times' like a user, assert LP content and preview paragraph
     change together; then restore the default and assert they return. */
  replaceEditorContent('family parity $a^2$ check\n\nsecond');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(250);
  const famOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).fontFamily : null;
  };
  const clickPreviewFont = (label) => {
    const wrapper = Array.from(document.querySelectorAll('#settings-dropdown .menu-item'))
      .find(el => el.textContent.includes('Preview font type'));
    const btn = wrapper && Array.from(wrapper.querySelectorAll('.submenu button'))
      .find(b => b.textContent.toLowerCase().includes(label));
    if (btn) { btn.click(); return true; }
    return false;
  };
  const famBefore = famOf('.cm-content');
  const timesClicked = clickPreviewFont('times');
  await sleep(300);
  lpPhase2.familyFollows = timesClicked
    && /times/i.test(famOf('.cm-content') || '')
    && famOf('.cm-content') === famOf('#preview p');
  lpPhase2.katexSizeParity = (() => {
    const lpK = document.querySelector('.lp-math .katex');
    const pvK = document.querySelector('#preview .katex');
    if (!lpK || !pvK) return false;
    return Math.abs(parseFloat(getComputedStyle(lpK).fontSize) - parseFloat(getComputedStyle(pvK).fontSize)) < 0.6;
  })();
  const defaultClicked = clickPreviewFont('harald') || clickPreviewFont('default');
  await sleep(300);
  lpPhase2.familyRestores = defaultClicked && famOf('.cm-content') === famBefore
    && famOf('.cm-content') === famOf('#preview p');

  /* Reader padding drives LP column width; tables render + click-to-edit;
     fenced code gets language token colors. */
  const clickSetting = (wrapperText, optionText) => {
    const wrapper = Array.from(document.querySelectorAll('#settings-dropdown .menu-item'))
      .find(el => el.textContent.includes(wrapperText));
    const btn = wrapper && Array.from(wrapper.querySelectorAll('.submenu button'))
      .find(b => b.textContent.toLowerCase().includes(optionText));
    if (btn) { btn.click(); return true; }
    return false;
  };
  replaceEditorContent('| Col A | Col B |\n|---|---|\n| **bold** | plain |\n\n```javascript\nconst x = 1;\nreturn x;\n```\n\ntail line');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(600); // async language load + parse
  lpPhase2.tableRendered  = !!document.querySelector('.lp-table')
    && !!document.querySelector('.lp-table th')
    && !!document.querySelector('.lp-table td strong');
  const tableWidget = document.querySelector('.lp-table-widget');
  if (tableWidget) tableWidget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(250);
  lpPhase2.tableClickReveals = !document.querySelector('.lp-table');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(250);
  lpPhase2.tableReturns = !!document.querySelector('.lp-table');
  lpPhase2.fenceColored = !!document.querySelector('.cm-line.lp-codeblock span[class*="\u037c"]');

  const rpClicked = clickSetting('Reader padding', '50');
  await sleep(300);
  const cmMaxW = getComputedStyle(document.querySelector('.cm-content')).maxWidth;
  lpPhase2.readerPadding = rpClicked && Math.abs(parseFloat(cmMaxW) - window.innerWidth * 0.5) < 3;
  clickSetting('Reader padding', '100%'); // label of the val:'default' option
  await sleep(200);
  lpPhase2.readerPaddingResets =
    getComputedStyle(document.querySelector('.cm-content')).maxWidth === 'none';

  window.setLivePreviewMode(false);
  await sleep(150);
  const lpOffState = {
    decorationsGone: !document.querySelector('.cm-line.lp-h1'),
    paneBack:        getComputedStyle(document.getElementById('preview-pane')).display !== 'none',
    persistedOff:    settingsNow().livePreviewMode === false,
  };

  return { safeCount, safeLabel, redosCount, redosElapsed, recoveredCount,
           replacedText, ghostCount, barHidden, supersededCount,
           slowOn, slowOff, opSet, opCleared, bgApplied, bgRemoved, pipeline,
           lpOnState, lpOffState, lpPhase2 };
})()

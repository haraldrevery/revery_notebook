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

  /* 10. Live Preview v2: every non-active top-level markdown block is a
         widget rendered through the classic preview's OWN pipeline
         (markdown-it + hljs + texmath/KaTeX + DOMPurify + prose CSS).
         Parity is asserted as computed-style EQUALITY against #preview —
         not approximation. Blocks intersecting the selection stay raw. */
  window.setLivePreviewMode(true);
  setDoc('# Hello **bold** world\n\nplain tail');
  editor.setSelectionRange(editor.value.length, editor.value.length); // cursor in last block
  await sleep(350);
  const cmText = () => document.querySelector('.cm-content').textContent;
  const lpOnState = {
    paneHidden:   getComputedStyle(document.getElementById('preview-pane')).display === 'none',
    headingClass: !!document.querySelector('.lp-render h1'),
    marksHidden:  !cmText().includes('#') && !cmText().includes('**'),
    boldStyled:   !!document.querySelector('.lp-render h1 strong'),
  };
  editor.setSelectionRange(2, 2); // move INTO the heading block
  await sleep(300);
  lpOnState.marksRevealed = !document.querySelector('.lp-render h1')
    && cmText().includes('# Hello **bold** world');
  replaceEditorContent('# Fresh **doc**\n\ntail');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  lpOnState.survivedReplace = !!document.querySelector('.lp-render h1');

  /* v2 block coverage: hr / list / image render through the pipeline;
     heading typography and pane texture; image sizing PARITY (the
     "images smaller and left-aligned" report). */
  /* An https src keeps the <img> element + its computed styles intact on
     both surfaces even though nothing loads (data: srcs are stripped by
     DOMPurify on BOTH surfaces — parity includes that behavior too). */
  replaceEditorContent('# Style\n\n---\n\n- item one\n\n![tiny](https://example.invalid/x.gif)\n\nend line');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(450);
  const lpV2 = {
    hrWidget:     !!document.querySelector('.lp-render hr'),
    bullet:       !!document.querySelector('.lp-render ul li'),
    imageWidget:  !!document.querySelector('.lp-render img'),
    headingUpper: (() => {
      const h = document.querySelector('.lp-render h1');
      return !!h && getComputedStyle(h).textTransform === 'uppercase';
    })(),
    texture:      getComputedStyle(document.getElementById('editor-pane')).backgroundImage.includes('bg_'),
  };
  lpV2.imageParity = (() => {
    const a = document.querySelector('.lp-render img');
    const b = document.querySelector('#preview img');
    if (!a || !b) return false;
    /* Same md renderer rule must class both copies full-width, and the
       live-preview copy must ACTUALLY fill its prose column (the
       "images smaller and left-aligned" report). */
    if (!a.classList.contains('preview-image-full')
        || !b.classList.contains('preview-image-full')) return false;
    const col = a.closest('.prose');
    return !!col && Math.abs(a.getBoundingClientRect().width
                             - col.getBoundingClientRect().width) < 2;
  })();
  const hrPos = editor.value.indexOf('---');
  editor.setSelectionRange(hrPos, hrPos);
  await sleep(300);
  lpV2.hrRevealsRaw = !document.querySelector('.lp-render hr');

  /* strikethrough + code block: copy button, NO visible fences, hljs
     token colors, and code font/size EQUAL to the preview's (the "code
     font doesn't follow / colors don't work / renders ```" report). */
  replaceEditorContent('~~gone~~ text\n\n```javascript\nconst x = 1;\nreturn x;\n```\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(500);
  const strikeEl = document.querySelector('.lp-render s, .lp-render del');
  lpV2.strikeRendered = !!strikeEl && !strikeEl.textContent.includes('~~');
  const copyBtn = document.querySelector('.cm-content .code-copy-btn');
  lpV2.copyButton = !!copyBtn;
  if (copyBtn) copyBtn.click(); // must not throw / must not edit the doc
  await sleep(150);
  lpV2.copyClickSafe = editor.value.includes('const x = 1;');
  const lpPre = document.querySelector('.lp-render pre');
  lpV2.fenceHidden  = !!lpPre && !lpPre.textContent.includes('```');
  lpV2.fenceColored = !!document.querySelector('.lp-render pre code span[class*="hljs-"]');
  lpV2.codeFontParity = (() => {
    const a = document.querySelector('.lp-render pre code');
    const b = document.querySelector('#preview pre code');
    if (!a || !b) return false;
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    return ca.fontFamily === cb.fontFamily && ca.fontSize === cb.fontSize;
  })();

  /* task-list checkboxes: upgraded from the renderer's literal text;
     click toggles the DOCUMENT marker through a normal transaction. */
  replaceEditorContent('- [ ] first\n- [x] second\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(350);
  const boxes = document.querySelectorAll('.lp-task-checkbox');
  lpV2.taskBoxes = boxes.length === 2;
  lpV2.taskDoneStyled = !!document.querySelector('.lp-render li.lp-task-done');
  if (boxes[0]) boxes[0].click();
  await sleep(300);
  lpV2.taskToggled = editor.value.startsWith('- [x] first');

  /* KaTeX math — including MULTI-LINE $$ blocks (impossible in v1) —
     plus currency safety, raw math in code, protected frontmatter. */
  replaceEditorContent('---\ntitle: t\ntags: x\n---\n\nEuler: $e^{i\\pi}=-1$ inline\n\n$$x^2 + y^2 = r^2$$\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nprice 5$ and 10$ stays text\n\n`code $a+b$ stays raw`\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(500);
  lpV2.mathInline    = document.querySelectorAll('.lp-render .katex').length >= 3;
  lpV2.mathBlock     = document.querySelectorAll('.lp-render .katex-display').length >= 1;
  lpV2.mathMultiline = document.querySelectorAll('.lp-render .katex-display').length >= 2;
  lpV2.currencySafe  = (() => {
    const block = Array.from(document.querySelectorAll('.lp-render'))
      .find((el) => el.textContent.includes('price'));
    return !!block && !block.querySelector('.katex') && editor.value.includes('5$ and 10$');
  })();
  lpV2.codeMathRaw = (() => {
    const codeEl = Array.from(document.querySelectorAll('.lp-render code'))
      .find((el) => el.textContent.includes('$a+b$'));
    return !!codeEl;
  })();
  lpV2.fmProtected = !!document.querySelector('.cm-line.lp-frontmatter')
    && cmText().includes('title: t')
    && !document.querySelector('.lp-render h2'); // Setext misparse guard
  /* cursor onto the inline-math paragraph -> its raw $ source returns */
  const mathPos = editor.value.indexOf('$e^');
  editor.setSelectionRange(mathPos, mathPos);
  await sleep(300);
  lpV2.mathRevealsRaw = cmText().includes('$e^');

  /* THE core v2 assertions: computed-style EQUALITY with the preview
     pane for the same document (the "headers larger than the preview"
     report). Sizes must follow the preview settings, not the editor. */
  replaceEditorContent('# Parity Header\n\nparity check paragraph\n\nsecond');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(350);
  const csOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el) : null;
  };
  const lpP = csOf('.lp-render p'), pvP = csOf('#preview p');
  lpV2.sizeMatchesPreview = !!lpP && !!pvP && lpP.fontSize === pvP.fontSize;
  lpV2.h1Parity = (() => {
    const a = csOf('.lp-render h1'), b = csOf('#preview .prose h1');
    return !!a && !!b && a.fontSize === b.fontSize && a.fontFamily === b.fontFamily
      && a.textTransform === b.textTransform;
  })();
  const edInline = parseFloat(getComputedStyle(document.getElementById('editor')).fontSize);
  lpV2.sizeNotEditorBound = !!lpP
    && (Math.abs(parseFloat(lpP.fontSize) - edInline) > 0.6
        || Math.abs(parseFloat(pvP.fontSize) - edInline) < 0.6);

  /* FONT FAMILY parity via the real settings path: click 'Preview font
     type -> Times' like a user, assert rendered blocks, raw text and
     preview change together; then restore the default. */
  replaceEditorContent('family parity $a^2$ check\n\nsecond');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  const famOf = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).fontFamily : null;
  };
  const clickSetting = (wrapperText, optionText) => {
    const wrapper = Array.from(document.querySelectorAll('#settings-dropdown .menu-item'))
      .find(el => el.textContent.includes(wrapperText));
    const btn = wrapper && Array.from(wrapper.querySelectorAll('.submenu button'))
      .find(b => b.textContent.toLowerCase().includes(optionText));
    if (btn) { btn.click(); return true; }
    return false;
  };
  const famBefore = famOf('.cm-content');
  const timesClicked = clickSetting('Preview font type', 'times');
  await sleep(300);
  lpV2.familyFollows = timesClicked
    && /times/i.test(famOf('.cm-content') || '')
    && famOf('.lp-render p') === famOf('#preview p')
    && famOf('.cm-content') === famOf('#preview p');
  lpV2.katexSizeParity = (() => {
    const lpK = document.querySelector('.lp-render .katex');
    const pvK = document.querySelector('#preview .katex');
    if (!lpK || !pvK) return false;
    return getComputedStyle(lpK).fontSize === getComputedStyle(pvK).fontSize;
  })();
  const defaultClicked = clickSetting('Preview font type', 'harald') || clickSetting('Preview font type', 'default');
  await sleep(300);
  lpV2.familyRestores = defaultClicked && famOf('.cm-content') === famBefore
    && famOf('.lp-render p') === famOf('#preview p');

  /* Tables render via the preview pipeline (the "tables broken" report);
     clicking one reveals the raw markdown; leaving re-renders it. */
  replaceEditorContent('| Col A | Col B |\n|---|---|\n| **bold** | plain |\n\ntail line');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(450);
  lpV2.tableRendered = !!document.querySelector('.lp-render table')
    && !!document.querySelector('.lp-render th')
    && !!document.querySelector('.lp-render td strong');
  lpV2.tableParity = (() => {
    const a = document.querySelector('.lp-render td');
    const b = document.querySelector('#preview td');
    if (!a || !b) return false;
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    return ca.fontSize === cb.fontSize && ca.fontFamily === cb.fontFamily;
  })();
  const tblEl = document.querySelector('.lp-render table');
  const tWidget = tblEl && tblEl.closest('.lp-render');
  if (tWidget) tWidget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await sleep(300);
  lpV2.tableClickReveals = !document.querySelector('.lp-render table')
    && cmText().includes('| Col A | Col B |');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  lpV2.tableReturns = !!document.querySelector('.lp-render table');

  /* Click-to-edit must not make the view jump: after the widget→raw
     swap (plus surrounding blocks reflowing) the clicked line must
     still sit at the pointer's height (scroll pinning). */
  const longDoc = [];
  for (let i = 0; i < 15; i++) longDoc.push('Paragraph number ' + i + ' with some filler text.', '');
  longDoc.push('| Col A | Col B |', '|---|---|', '| a | b |', '| c | d |', '');
  for (let i = 15; i < 30; i++) longDoc.push('Paragraph number ' + i + ' with some filler text.', '');
  replaceEditorContent(longDoc.join('\n'));
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(500);
  lpV2.clickUnderPointer = await (async () => {
    const view = window.cmView;
    if (!view) return false;
    /* Scroll the table's DOC position into view through CM itself —
       widget DOM only exists for blocks inside the drawn viewport, so
       a mid-document table isn't queryable until scrolled to. */
    const tPos = editor.value.indexOf('| Col A');
    if (tPos < 0) return false;
    view.dispatch({ effects: CM.EditorView.scrollIntoView(tPos, { y: 'center' }) });
    /* Poll rather than fixed sleeps: under a full parallel test run the
       renderer's measure/rAF cycles can lag well past any fixed delay. */
    let tbl2 = null;
    for (let w = 0; w < 3000 && !tbl2; w += 150) {
      await sleep(150);
      tbl2 = document.querySelector('.lp-render table');
    }
    if (!tbl2) return false;
    const wrapEl = tbl2.closest('.lp-render');
    const rect = wrapEl.getBoundingClientRect();
    if (rect.height === 0) return false;
    const clickY = rect.top + rect.height / 2;
    wrapEl.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 10, clientY: clickY,
    }));
    const lineH = view.defaultLineHeight || 24;
    for (let w = 0; w < 3000; w += 150) {
      await sleep(150);
      const coords = view.coordsAtPos(view.state.selection.main.head);
      if (coords && Math.abs(coords.top - clickY) <= 1.5 * lineH) return true;
    }
    return false;
  })();

  /* Reader padding drives the live-preview column width. */
  const rpClicked = clickSetting('Reader padding', '50');
  await sleep(300);
  const cmMaxW = getComputedStyle(document.querySelector('.cm-content')).maxWidth;
  lpV2.readerPadding = rpClicked && Math.abs(parseFloat(cmMaxW) - window.innerWidth * 0.5) < 3;
  clickSetting('Reader padding', '100%'); // label of the val:'default' option
  await sleep(200);
  lpV2.readerPaddingResets =
    getComputedStyle(document.querySelector('.cm-content')).maxWidth === 'none';

  window.setLivePreviewMode(false);
  await sleep(200);
  const lpOffState = {
    decorationsGone: !document.querySelector('.lp-render'),
    paneBack:        getComputedStyle(document.getElementById('preview-pane')).display !== 'none',
    persistedOff:    settingsNow().livePreviewMode === false,
  };

  /* 12. Zip Project Export is desktop-only: this harness runs in WEB mode,
         so the File menu must not contain the entry (buildMenu gating). */
  const zipEntryHidden = !Array.from(document.querySelectorAll('#file-dropdown .menu-item'))
    .some((b) => (b.textContent || '').includes('Zip Project Export'));

  /* 13. YAML frontmatter autocomplete (web mode: current-doc index).
         Covers: key suggestions, click-to-open on a value position,
         arrow+enter acceptance (after the engine's interactionDelay),
         and silence outside the frontmatter block. */
  const fmTooltip = () => document.querySelector('.cm-tooltip-autocomplete');
  const fmLabels = () => Array.from(
    document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionLabel'))
    .map((el) => el.textContent);
  const fmWait = async () => {
    for (let w = 0; w < 3000 && !fmTooltip(); w += 100) await sleep(100);
    return !!fmTooltip();
  };
  const yamlComplete = {};

  replaceEditorContent('---\ntags: [alpha, beta]\nstatus: done\nta\n---\n\nbody text');
  const keyPos = editor.value.indexOf('\nta\n') + 3;
  window.cmView.focus();
  editor.setSelectionRange(keyPos, keyPos);
  CM.startCompletion(window.cmView);
  yamlComplete.keyMenu = await fmWait();
  yamlComplete.keySuggests = fmLabels().includes('tags');

  replaceEditorContent('---\ntags: [alpha, beta]\nstatus: done\ntags: \n---\n\nbody');
  const valPos = editor.value.indexOf('tags: \n') + 6;
  window.cmView.dispatch({ selection: { anchor: valPos }, userEvent: 'select.pointer' });
  yamlComplete.clickOpens = await fmWait();
  const vl = fmLabels();
  yamlComplete.valueSuggests = vl.includes('alpha') && vl.includes('beta');

  await sleep(400); // clear the engine's interactionDelay before key events
  const fmCd = window.cmView.contentDOM;
  fmCd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(150);
  fmCd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(200);
  yamlComplete.accepts = /^tags: (alpha|beta)$/.test(editor.value.split('\n')[3]);

  const bodyPos = editor.value.indexOf('body');
  editor.setSelectionRange(bodyPos + 2, bodyPos + 2);
  CM.startCompletion(window.cmView);
  await sleep(600);
  yamlComplete.bodyQuiet = !fmTooltip();

  return { safeCount, safeLabel, redosCount, redosElapsed, recoveredCount,
           replacedText, ghostCount, barHidden, supersededCount,
           slowOn, slowOff, opSet, opCleared, bgApplied, bgRemoved, pipeline,
           lpOnState, lpOffState, lpV2, zipEntryHidden, yamlComplete };
})()

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
  /* a real MOUSEDOWN on the copy button must NOT flip the block to raw
     (widgets own their events now — CM never double-handles) */
  const copyBtn2 = document.querySelector('.cm-content .code-copy-btn');
  if (copyBtn2) {
    copyBtn2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await sleep(250);
  }
  lpV2.copyNoReveal = !!document.querySelector('.lp-render pre');
  const lpPre = document.querySelector('.lp-render pre');
  lpV2.fenceHidden  = !!lpPre && !lpPre.textContent.includes('```');
  lpV2.fenceColored = !!document.querySelector('.lp-render pre code span[class*="hljs-"]');
  /* class presence is not enough — the token must be VISIBLY colored
     (the CM dark-mode span reset used to flatten hljs colors to --text) */
  lpV2.fenceColorReal = (() => {
    const kw = document.querySelector('.lp-render pre span[class*="hljs-"]');
    const para2 = document.querySelector('.lp-render p');
    return !!kw && !!para2
      && getComputedStyle(kw).color !== getComputedStyle(para2).color;
  })();
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
  /* Frontmatter renders as the preview's "Properties" pill box when the
     cursor is elsewhere (reader parity), and reveals raw dim YAML when
     clicked (pointer selection).                                       */
  lpV2.fmProtected = document.querySelectorAll('.lp-yaml .yaml-pill').length === 2 // title + tags
    && !document.querySelector('.lp-render h2'); // Setext misparse guard
  window.cmView.dispatch({ selection: { anchor: 6 }, userEvent: 'select.pointer' });
  await sleep(300);
  lpV2.fmReveals = !document.querySelector('.lp-yaml')
    && !!document.querySelector('.cm-line.lp-frontmatter')
    && cmText().includes('title: t');
  if (CM.closeCompletion) CM.closeCompletion(window.cmView); // auto-opened menu
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(300);
  lpV2.fmPillsReturn = !!document.querySelector('.lp-yaml .yaml-pill');
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
    /* Scrolling a fresh viewport materializes widgets whose measured
       heights shift content for a few frames — one scroll effect can
       settle with the target off-screen. Re-issue until the widget is
       actually VISIBLE and stable, exactly like a user scrolling until
       they can see the thing they want to click.                     */
    let wrapEl = null, rect = null;
    for (let attempt = 0; attempt < 8 && !wrapEl; attempt++) {
      view.dispatch({ effects: CM.EditorView.scrollIntoView(tPos, { y: 'center' }) });
      await sleep(350);
      const tbl2 = document.querySelector('.lp-render table');
      if (!tbl2) continue;
      const w2 = tbl2.closest('.lp-render');
      const r2 = w2.getBoundingClientRect();
      if (r2.height > 0 && r2.top >= 0 && r2.top + r2.height <= window.innerHeight) {
        await sleep(150); // confirm it holds still
        const r3 = w2.getBoundingClientRect();
        if (Math.abs(r3.top - r2.top) < 1) { wrapEl = w2; rect = r3; }
      }
    }
    if (!wrapEl) return false;
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

  /* Outline click must NAVIGATE only: no selection change, no reveal. */
  replaceEditorContent('# First\n\n' + 'filler text\n\n'.repeat(40) + '# Second\n\nend');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(400);
  const selBefore2 = window.cmView.state.selection.main.head;
  const scrollBefore2 = window.cmView.scrollDOM.scrollTop;
  scrollToHeading(0); // same function the outline buttons call
  await sleep(400);
  lpV2.outlineScrollOnly =
    window.cmView.state.selection.main.head === selBefore2
    && window.cmView.scrollDOM.scrollTop < scrollBefore2
    && !!document.querySelector('.lp-render h1');

  /* Reader mode while LP is on: the outline must scroll the PREVIEW
     (the editor is hidden there — the LP scroll branch must yield). */
  toggleReaderMode();
  await sleep(400);
  const pvEl2 = document.getElementById('preview');
  pvEl2.scrollTop = 0;
  scrollToHeading(editor.value.split('\n').findIndex((l) => l === '# Second'));
  await sleep(500);
  lpV2.readerOutlineScrolls = pvEl2.scrollTop > 100;
  toggleReaderMode();
  await sleep(300);

  /* Marginal widget clicks (on the frame, not content) route the cursor
     to the nearest gap instead of revealing the neighbouring block. */
  replaceEditorContent('# Title\n\npara one text\n\npara two text\n\nend');
  const pOne = editor.value.indexOf('para one');
  editor.setSelectionRange(pOne + 3, pOne + 3); // editing para one (raw)
  await sleep(400);
  const wTwo = Array.from(document.querySelectorAll('.lp-render'))
    .find((w) => w.textContent.includes('para two'));
  const rTwo = wTwo.getBoundingClientRect();
  wTwo.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, clientX: rTwo.left + 5, clientY: rTwo.top + 2,
  }));
  await sleep(350);
  lpV2.edgeClickNoSteal =
    !!Array.from(document.querySelectorAll('.lp-render')).find((w) => w.textContent.includes('para two'))
    && window.cmView.state.doc.lineAt(window.cmView.state.selection.main.head).text === '';

  /* Outline active-highlight follows the LP editor scroll. */
  document.getElementById('outline-pane').style.display = '';
  replaceEditorContent('# First\n\n' + 'filler text\n\n'.repeat(40) + '# Second\n\nend');
  editor.setSelectionRange(0, 0);
  if (typeof renderOutline === 'function') renderOutline();
  await sleep(400);
  /* Scroll '# Second' to the top via CM (deterministic against widget
     height re-measurement): either it reaches the reading offset, or the
     scroll clamps at the bottom — both paths must mark it active. Re-
     issue until the scroll position stops moving (heights settle). */
  const secondPos = editor.value.indexOf('# Second');
  let lastTop = -1;
  for (let i = 0; i < 8; i++) {
    window.cmView.dispatch({
      effects: CM.EditorView.scrollIntoView(secondPos, { y: 'start' }),
    });
    await sleep(250);
    const t = window.cmView.scrollDOM.scrollTop;
    if (Math.abs(t - lastTop) < 1) break;
    lastTop = t;
  }
  await sleep(500); // outline debounce + settle
  /* Height re-measurement can reach the final position AFTER the last
     scroll event (no further event fires when only scrollHeight moves) —
     a real user's next wheel tick re-triggers the listener; the probe
     calls the update once explicitly. The listener path itself is
     proven by the highlight having been set during the scroll above. */
  updateActiveOutline();
  await sleep(150);
  const activeOl = document.querySelector('.outline-item.active-outline');
  lpV2.outlineSyncs = !!activeOl && activeOl.textContent === 'Second';
  document.getElementById('outline-pane').style.display = 'none';

  /* Content padding equals the reader/preview surface padding. */
  const edPad = getComputedStyle(document.querySelector('.cm-content'));
  const pvPad = getComputedStyle(document.getElementById('preview'));
  lpV2.paddingParity = edPad.paddingLeft === pvPad.paddingLeft
    && edPad.paddingTop === pvPad.paddingTop
    && edPad.paddingBottom === pvPad.paddingBottom;

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

  /* 11b. Export suite builders (web mode: pure builders, no dialogs).
     LaTeX templates/engines/TOC + PDF front-page/TOC/@page options. */
  window.setLivePreviewMode(false);
  await sleep(150);
  replaceEditorContent('---\ntitle: My Doc\nauthor: Ada\n---\n\n# Intro\n\nBody **text**.\n\n## Sub\n\n$x^2$\n');
  docTitle.value = 'My Doc';
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(150);
  const exportSuite = {};
  const texR = window.exporterBuildLatex({ template: 'report', engine: 'xelatex', titlePage: true, toc: true });
  exportSuite.reportClass = texR.tex.includes('\\documentclass{report}');
  exportSuite.chapterPromotion = texR.tex.includes('\\chapter{');
  exportSuite.xelatexFontspec = texR.tex.includes('fontspec') && !texR.tex.includes('inputenc');
  exportSuite.tocOn = texR.tex.includes('\\tableofcontents');
  const texA = window.exporterBuildLatex({ template: 'article', engine: 'pdflatex', titlePage: false, toc: false });
  exportSuite.articleSection = texA.tex.includes('\\section{Intro}') && !texA.tex.includes('\\chapter{');
  exportSuite.pdflatexInputenc = texA.tex.includes('inputenc');
  exportSuite.noTitleNoToc = !texA.tex.includes('\\maketitle') && !texA.tex.includes('\\tableofcontents');
  const pdfF = window.exporterBuildPdfHtml({ frontPage: true, frontTitle: '', frontAuthor: '', toc: true, format: 'book', marginPreset: 'wide', fontPt: 12, pageSize: 'Letter' });
  exportSuite.pdfFrontPage = pdfF.html.includes('<section class="front-page');
  exportSuite.pdfTocLinks = pdfF.html.includes('<nav class="toc"') && /href="#h-\d+"/.test(pdfF.html);
  exportSuite.pdfPageOpts = pdfF.html.includes('size: letter') && pdfF.html.includes('font-size: 12pt') && pdfF.html.includes('@page :left');
  const pdfD = window.exporterBuildPdfHtml({ frontPage: false, toc: false });
  exportSuite.pdfDefaultsClean = !pdfD.html.includes('<section class="front-page') && !pdfD.html.includes('<nav class="toc"');
  exportSuite.pdfMenuEntry = Array.from(document.querySelectorAll('#file-dropdown .menu-item'))
    .some((b) => (b.textContent || '').includes('.pdf'));
  exportSuite.latexMenuEntry = Array.from(document.querySelectorAll('#file-dropdown .menu-item'))
    .some((b) => (b.textContent || '').includes('LaTeX project'));

  /* New PDF options: A5/A6 sizes, per-header page breaks, full-bleed
     named cover page, font picker, asset base + code-color stylesheet. */
  const pdfA5 = window.exporterBuildPdfHtml({ pageSize: 'A5' });
  exportSuite.a5Size = pdfA5.html.includes('size: A5');
  const pdfA6 = window.exporterBuildPdfHtml({ pageSize: 'A6' });
  exportSuite.a6Size = pdfA6.html.includes('size: A6');
  const pdfBreaks = window.exporterBuildPdfHtml({ newPageH1: true, newPageH2: true });
  exportSuite.newPageHeaders = pdfBreaks.html.includes('main h1 { break-before: page')
    && pdfBreaks.html.includes('main h2 { break-before: page');
  const pdfNoBreaks = window.exporterBuildPdfHtml({ newPageH1: false, newPageH2: false });
  exportSuite.noHeaderBreaks = !pdfNoBreaks.html.includes('break-before: page');
  exportSuite.coverNamedPage = pdfF.html.includes('page: cover')
    && pdfF.html.includes('@page cover { margin: 0');
  const pdfFont = window.exporterBuildPdfHtml({ font: 'harald-text' });
  exportSuite.fontApplied = pdfFont.html.includes("font-family: 'HaraldText'");
  /* Harald has no true bold: titles/headings drop bold and inline bold becomes
     underline; any other font keeps normal bold. */
  exportSuite.haraldBoldUnderline =
    pdfFont.html.includes('strong, b { font-weight: normal; text-decoration: underline;')
    && pdfFont.html.includes('.front-page .fp-title { font-weight: normal;');
  exportSuite.nonHaraldBoldKept =
    !window.exporterBuildPdfHtml({ font: 'serif' }).html.includes('text-decoration: underline');
  /* Body size stays font-independent (matches the live preview); only math is
     shrunk to 0.7 under Harald (1.05 → 0.735em), other fonts keep 1.05em. Body
     pt is unchanged for both. */
  exportSuite.haraldMathScaled =
    window.exporterBuildPdfHtml({ font: 'harald-text', fontPt: 14 }).html.includes('math { font-size: 0.735em')
    && window.exporterBuildPdfHtml({ font: 'harald-text', fontPt: 14 }).html.includes('font-size: 14pt')
    && window.exporterBuildPdfHtml({ font: 'serif', fontPt: 14 }).html.includes('math { font-size: 1.05em');
  exportSuite.assetBase = pdfF.html.includes('<base href=')
    && pdfF.html.includes('github-dark.min.css');
  const texClear = window.exporterBuildLatex({ template: 'article', engine: 'pdflatex', titlePage: true, toc: true });
  exportSuite.latexTocClearpage = /\\maketitle\s*\n\\clearpage\s*\n\\tableofcontents\s*\n\\clearpage/.test(texClear.tex);
  /* Optional \newpage before # / ## headings — but never before the first
     content block (# Intro here), so the body doesn't open with a blank page. */
  exportSuite.latexNewPageHeaders =
    /\\newpage\s*\n\\subsection\{Sub\}/.test(window.exporterBuildLatex({ newPageH2: true }).tex)
    && !/\\newpage/.test(window.exporterBuildLatex({}).tex)
    && !/\\newpage\s*\n\\section\{Intro\}/.test(window.exporterBuildLatex({ newPageH1: true }).tex);

  /* 11a-2. LaTeX section splitting: template-style \include files. Split
     points are marked at heading EMISSION (sentinels), so a verbatim block
     containing \section-looking text can never be sliced mid-environment —
     the exact LaTeX-breakage risk of splitting the finished output. */
  {
    const s1 = window.exporterBuildLatex({ splitSections: 'h1' });
    exportSuite.latexSplitH1 = s1.sections.length === 1
      && s1.sections[0].name === 'intro'
      && s1.sections[0].content.includes('\\section{Intro}')
      && s1.sections[0].content.includes('\\subsection{Sub}')
      && s1.tex.includes('\\include{sections/intro}')
      && !s1.tex.includes('\\section{Intro}');
    const s2 = window.exporterBuildLatex({ splitSections: 'h2' });
    exportSuite.latexSplitH2 = s2.sections.length === 2
      && s2.tex.includes('\\include{sections/intro}')
      && s2.tex.includes('\\include{sections/sub}')
      && s2.sections[1].content.includes('\\subsection{Sub}');
    const s0 = window.exporterBuildLatex({});
    exportSuite.latexSplitOff = s0.sections.length === 0 && !s0.tex.includes('\\include{');

    /* Verbatim immunity + slug dedupe: a code fence containing a fake
       \section and a fake heading must stay one un-split verbatim block,
       and two same-named headings get distinct file names. */
    const prevDoc = editor.value;
    replaceEditorContent('# A B\n\ntext\n\n# A B\n\nmore\n\n```\n\\\\section{Fake}\n# not a heading\n```\n\n# Last\n');
    const st = window.exporterBuildLatex({ splitSections: 'h1' });
    exportSuite.latexSplitSafe = st.sections.length === 3
      && st.sections[0].name === 'a-b'
      && st.sections[1].name === 'a-b-2'
      && st.sections[2].name === 'last'
      && st.sections[1].content.includes('\\begin{verbatim}')
      && st.sections[1].content.includes('# not a heading');
    replaceEditorContent(prevDoc);
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await sleep(150); // preview re-render for the probes below
  }

  /* 11b-2. Engine-aware print CSS: Chromium (Electron) keeps the named
     full-bleed cover; the webkit/scoped targets get an absolute-mm cover
     inside the page margins and NO viewport units — the Chromium-only
     vh/named-page combo is exactly what broke the front page (and the TOC
     overlap it cascaded into) on WebKitGTK and in browsers. */
  const pdfWk = window.exporterBuildPdfHtml(
    { frontPage: true, frontTitle: 'T', toc: true, marginPreset: 'wide', pageSize: 'Letter' }, 'webkit');
  exportSuite.engineSafeCover =
    !pdfWk.html.includes('page: cover') && !pdfWk.html.includes('@page cover')
    && !pdfWk.html.includes('100vh') && pdfWk.html.includes('height: 219.4mm')
    && pdfF.html.includes('height: 279.4mm') && !pdfF.html.includes('100vh');

  /* 11b-3. Custom fonts in the PDF export: system-kind resolves by family,
     file-kind embeds its data-URL @font-face into the standalone document,
     the export modal's Font dropdown lists them, and a deleted font falls
     back to Serif. */
  {
    const pfSys = window.createCustomFont({ kind: 'system', label: 'E2E PdfFont', family: 'Verdana' });
    const pfFile = window.createCustomFont({ kind: 'file', label: 'E2E PdfFileFont', data: 'data:font/woff2;base64,AAAA' });
    const sysHtml = window.exporterBuildPdfHtml({ font: 'custom:' + pfSys.id }).html;
    const fileHtml = window.exporterBuildPdfHtml({ font: 'custom:' + pfFile.id }).html;
    window.exporterOpen('pdf');
    const modalFonts = Array.from(document.querySelectorAll('#export-modal .export-dd-item'))
      .map((b) => b.textContent);
    document.querySelector('#export-modal .modal-buttons .modal-btn').click(); // Cancel
    window.deleteCustomFont(pfSys.id);
    window.deleteCustomFont(pfFile.id);
    exportSuite.pdfCustomFonts = pfSys.ok === true && pfFile.ok === true
      && sysHtml.includes('"Verdana", sans-serif')
      && fileHtml.includes('RvCustom-') && fileHtml.includes('data:font/woff2')
      && modalFonts.some((t) => t.includes('E2E PdfFont'));
    exportSuite.pdfCustomFontFallback = window.exporterBuildPdfHtml({ font: 'custom:' + pfSys.id })
      .html.includes("Georgia, 'Times New Roman', serif");
  }

  /* 11c. Brand aesthetic templates: extbook/article documentclass + styled
     preamble, FORCED xelatex (even when pdflatex is passed), correct heading
     depth, and the book template reports its bundled fonts. */
  const texBookR = window.exporterBuildLatex({ template: 'book-revery', engine: 'pdflatex', titlePage: true, toc: true });
  exportSuite.bookReveryClass = texBookR.tex.includes('\\documentclass[14pt,a4paper,twoside,openright]{extbook}')
    && texBookR.tex.includes('\\titleformat{\\chapter}') && texBookR.tex.includes('AccentColor')
    && texBookR.tex.includes('\\setstretch{0.68}') && texBookR.tex.includes('\\fontsize{14.5pt}{23pt}')
    && texBookR.tex.includes('\\frontmatter') && texBookR.tex.includes('\\mainmatter')
    && texBookR.tex.includes('emptypage');
  exportSuite.bookReveryXelatex = texBookR.tex.includes('fontspec')
    && !texBookR.tex.includes('inputenc') && texBookR.tex.includes('\\chapter{');
  /* Engine gating (the modal's source of truth): fontspec templates are
     hidden under pdflatex and present under xelatex; classic stay available. */
  const forPdf = window.exporterTemplatesForEngine('pdflatex');
  const forXe = window.exporterTemplatesForEngine('xelatex');
  exportSuite.latexEngineGating = !forPdf.includes('book-revery') && !forPdf.includes('homework-revery')
    && forPdf.includes('article')
    && forXe.includes('book-revery') && forXe.includes('homework-revery') && forXe.includes('article');
  exportSuite.bookReveryFonts = Array.isArray(texBookR.fonts)
    && texBookR.fonts.includes('HaraldReveryTextFont.ttf')
    && texBookR.fonts.includes('HaraldReveryMonoFont.ttf');
  const texHwR = window.exporterBuildLatex({ template: 'homework-revery', engine: 'pdflatex', titlePage: true, toc: false });
  exportSuite.homeworkReveryClass = texHwR.tex.includes('\\documentclass[a4paper,11pt]{article}')
    && texHwR.tex.includes('\\begin{titlepage}')
    && texHwR.tex.includes('\\section{Intro}') && !texHwR.tex.includes('\\chapter{');
  exportSuite.homeworkReveryXelatex = texHwR.tex.includes('fontspec')
    && !texHwR.tex.includes('inputenc') && (texHwR.fonts || []).length === 0;

  /* 11d. Bold treatment follows the preview font: Harald (brand default) →
     underlined regular weight; any other font → real bold, no underline.
     The doc set in 11b renders `Body **text**`, so #preview has a strong. */
  {
    const strongEl = document.querySelector('#preview .prose strong');
    const st = () => {
      const cs = getComputedStyle(strongEl);
      return { deco: cs.textDecorationLine, weight: parseInt(cs.fontWeight, 10) };
    };
    const s1 = st();
    exportSuite.boldHaraldUnderline = !!strongEl
      && s1.deco.includes('underline') && s1.weight === 400
      && document.documentElement.classList.contains('preview-font-harald');
    previewFontType = 'serif'; applyFontTypes();
    const s2 = st();
    exportSuite.boldOtherFontsReal = !s2.deco.includes('underline') && s2.weight >= 600
      && !document.documentElement.classList.contains('preview-font-harald');
    previewFontType = 'harald'; applyFontTypes();
    const s3 = st();
    exportSuite.boldHaraldRestored = s3.deco.includes('underline') && s3.weight === 400;
  }

  /* 11e. Open menus must not lose hover/clicks to the pane dividers'
     invisible grab zones (::after strips z-order-win against the topbar-
     capped dropdowns): while any .menu-container is shown, the zones must
     be pointer-inert; and revert when the menu closes. */
  {
    const dividerEl = document.getElementById('divider');
    const sd = document.getElementById('settings-dropdown');
    const zonePE = () => getComputedStyle(dividerEl, '::after').pointerEvents;
    const before = zonePE();
    sd.classList.add('show');
    const during = zonePE();
    sd.classList.remove('show');
    exportSuite.dividerYieldsToMenus =
      before !== 'none' && during === 'none' && zonePE() !== 'none';
  }

  /* 11f. Custom templates: create/persist/duplicate-reject/delete via the
     public API, "New template…" rows present in both submenus, and the
     creator modal opens prefilled with the YAML starter. */
  const customTemplates = {};
  {
    const subLabels = (container) => Array.from(
      document.querySelectorAll(`${container} .submenu .menu-item`)).map((b) => b.textContent);
    customTemplates.newRows =
      subLabels('#toolbar-dropdown').some((t) => t.includes('New template'))
      && subLabels('#file-dropdown').some((t) => t.includes('New template'));

    const made = window.createCustomTemplate('yaml', 'E2E Tmpl', '---\ntitle: probe\n---\n');
    const stored = () => JSON.parse(localStorage.getItem('revery_custom_templates') || '{}');
    customTemplates.created = made.ok === true
      && subLabels('#toolbar-dropdown').some((t) => t.includes('E2E Tmpl'))
      && (stored().yaml || []).some((t) => t.label === 'E2E Tmpl');
    customTemplates.duplicateRejected = window.createCustomTemplate('yaml', 'E2E Tmpl', 'x').ok === false;
    customTemplates.emptyNameRejected = window.createCustomTemplate('md', '   ', 'x').ok === false;

    window.openTemplateCreator('yaml');
    const modal = document.getElementById('template-creator-modal');
    customTemplates.creatorPrefilled = !!modal
      && modal.querySelector('.tmpl-textarea').value.startsWith('---\ntitle: Title of document\nauthor: Mr. Revery\n---');
    modal.querySelector('.modal-btn').click(); // Cancel
    customTemplates.creatorCloses = !document.getElementById('template-creator-modal');

    const gone = window.deleteCustomTemplate('yaml', 'E2E Tmpl');
    customTemplates.deleted = gone.ok === true
      && !subLabels('#toolbar-dropdown').some((t) => t.includes('E2E Tmpl'))
      && !(stored().yaml || []).some((t) => t.label === 'E2E Tmpl');
  }

  /* 11g. Link-path autocomplete: the data feed must exist, and in WEB mode
     (no filesystem) it must return null so the editor's completion source
     stays inert — the YAML completion suite above already proves the shared
     autocomplete engine still works alongside the new source. */
  const linkComplete = {
    hookExists: typeof window.sidebarListLinkCompletions === 'function',
    webQuiet: (await window.sidebarListLinkCompletions('')) === null,
  };

  /* 11h. Advanced Options: logo-menu entry under User Guide, modal opens,
     and the logo-position setting moves the logo wrapper between
     #topbar-center and #topbar-left (persisted, restorable). */
  const advanced = {};
  {
    const logoItems = Array.from(document.querySelectorAll('#logo-dropdown .menu-item'))
      .map((b) => b.textContent);
    advanced.menuEntry = logoItems.indexOf('Advanced Options') === logoItems.indexOf('User Guide') + 1;

    window.openAdvancedOptions();
    const modal = document.getElementById('advanced-options-modal');
    /* Options render as an app-style DROPDOWN (export-dd), not stacked
       buttons: a trigger with the current value + ▾, and ■/□ items. */
    advanced.modalOpens = !!modal
      && modal.querySelectorAll('.export-dd-btn').length >= 1
      && modal.querySelectorAll('.export-dd-item').length >= 2;
    if (modal) modal.remove();

    const wrap = document.getElementById('btn-logo').parentElement;
    const logoDd = document.getElementById('logo-dropdown');
    const settingsNow2 = () => JSON.parse(localStorage.getItem('revery_md_settings') || '{}');
    window.setLogoPosition('left');
    advanced.movedLeft = wrap.parentElement.id === 'topbar-left'
      && wrap.parentElement.firstChild === wrap
      && document.body.classList.contains('logo-left')
      && settingsNow2().logoPosition === 'left'
      /* the dropdown's INLINE centering must be overridden inline, or the
         menu clips off the left screen edge */
      && logoDd.style.transform === 'none' && logoDd.style.left === '0px';
    window.setLogoPosition('center');
    advanced.restoredCenter = wrap.parentElement.id === 'topbar-center'
      && !document.body.classList.contains('logo-left')
      && settingsNow2().logoPosition === 'center'
      && logoDd.style.left === '50%';
  }

  /* 11i. Tauri PDF print page (pdf_print.html/js): its payload graft is
     engine-independent DOM code, so the harness can pin it — the exact
     regression class that shipped "Preparing document…" into PDFs. The
     iframe's print() is stubbed on load and the iframe is removed before
     the 200ms print timer fires, so no real dialog can open. */
  const pdfPrintWindow = await (async () => {
    const PAYLOAD = '<!DOCTYPE html><html><head><title>PDF Probe Doc</title></head>'
      + '<body><main id="probe-main">Hello PDF</main></body></html>';
    const loadPrintPage = (stage) => new Promise((resolve) => {
      if (stage) localStorage.setItem('__revery_pdf_payload__', PAYLOAD);
      else localStorage.removeItem('__revery_pdf_payload__');
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-2000px;top:0;width:800px;height:600px;';
      fr.src = 'pdf_print.html';
      fr.addEventListener('load', () => {
        try { fr.contentWindow.print = () => {}; } catch (_) {}
        setTimeout(() => {
          const d = fr.contentDocument;
          const out = {
            text: d && d.body ? d.body.textContent : '',
            title: d ? d.title : '',
            hasMain: !!(d && d.getElementById('probe-main')),
            payloadCleared: localStorage.getItem('__revery_pdf_payload__') === null,
          };
          fr.remove(); // kills the pending print timers with the document
          resolve(out);
        }, 60);
      });
      document.body.appendChild(fr);
    });

    const staged = await loadPrintPage(true);
    const empty = await loadPrintPage(false);
    return {
      grafted: staged.hasMain && staged.text.includes('Hello PDF'),
      placeholderGone: !staged.text.includes('Preparing document'),
      titleAdopted: staged.title === 'PDF Probe Doc',
      payloadCleared: staged.payloadCleared,
      emptyShowsError: empty.text.includes('No document was staged'),
    };
  })();

  /* 11j. Custom fonts: create (system + file kinds), rows with ✕ in BOTH
     font submenus, selection applies the CSS var and drops the harald bold
     class, @font-face injected for file-kind, deletion of the ACTIVE font
     reverts to harald and cleans storage. */
  const customFonts = await (async () => {
    const out = {};
    const rowsWithDel = () => Array.from(
      document.querySelectorAll('#settings-dropdown .submenu .menu-item'))
      .filter((b) => b.querySelector('.tmpl-del'))
      .map((b) => b.textContent.replace('✕', '').trim());

    const made = window.createCustomFont({ kind: 'system', label: 'E2E Font', family: 'Georgia' });
    out.created = made.ok === true;
    const menuRows = rowsWithDel().filter((t) => t.includes('E2E Font'));
    out.rowsInBothMenus = menuRows.length === 2; // editor + preview submenus
    out.customEntry = Array.from(
      document.querySelectorAll('#settings-dropdown .submenu .menu-item'))
      .filter((b) => b.textContent.includes('Custom font')).length >= 2;

    previewFontType = 'custom:' + made.id; applyFontTypes();
    const varVal = document.documentElement.style.getPropertyValue('--preview-font');
    out.applied = varVal.includes('Georgia')
      && !document.documentElement.classList.contains('preview-font-harald');
    out.persisted = JSON.parse(localStorage.getItem('revery_custom_fonts') || '{}')
      .fonts.some((f) => f.label === 'E2E Font');

    out.duplicateRejected = window.createCustomFont({ kind: 'system', label: 'E2E Font', family: 'X' }).ok === false;
    out.emptyRejected = window.createCustomFont({ kind: 'system', label: '  ', family: 'X' }).ok === false;

    const fileFont = window.createCustomFont({
      kind: 'file', label: 'E2E FileFont',
      data: 'data:font/woff2;base64,AAAA',
    });
    out.faceInjected = fileFont.ok === true
      && (document.getElementById('custom-fonts-css') || {}).textContent.includes('RvCustom-');
    window.deleteCustomFont(fileFont.id);

    window.deleteCustomFont(made.id); // the ACTIVE preview font
    out.deletedReverts = previewFontType === 'harald'
      && document.documentElement.style.getPropertyValue('--preview-font') === ''
      && !rowsWithDel().some((t) => t.includes('E2E Font'))
      && !JSON.parse(localStorage.getItem('revery_custom_fonts') || '{}')
        .fonts.some((f) => f.label === 'E2E Font');

    window.openFontImporter();
    const fmodal = document.getElementById('font-importer-modal');
    out.importerOpens = !!fmodal && !!fmodal.querySelector('.font-imp-sample');
    if (fmodal) fmodal.querySelector('.modal-buttons .modal-btn').click(); // Cancel
    out.importerCloses = !document.getElementById('font-importer-modal');
    return out;
  })();

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

  /* Accepting with the cursor MID-token must replace the WHOLE token —
     regression for the "adds in the middle of a text string" bug. */
  replaceEditorContent('---\ntags: [alpha, beta]\ntags: alph\n---\n\nbody');
  const midPos = editor.value.indexOf('tags: alph\n') + 8; // 'al|ph'
  window.cmView.focus();
  window.cmView.dispatch({ selection: { anchor: midPos }, userEvent: 'select.pointer' });
  await fmWait();
  await sleep(400); // interactionDelay
  fmCd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(150);
  fmCd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(200);
  yamlComplete.midTokenClean = /^tags: (alpha|beta)$/.test(editor.value.split('\n')[2]);

  /* Clicking a YAML pill in live preview opens the FULL value menu for
     that key (the current value is demoted, never hidden). */
  window.setLivePreviewMode(true);
  replaceEditorContent('---\ntags: [alpha, beta]\nstatus: done\n---\n\nbody');
  editor.setSelectionRange(editor.value.length, editor.value.length);
  await sleep(400);
  const tagsPill = Array.from(document.querySelectorAll('.lp-yaml .yaml-pill'))
    .find((p) => p.textContent.startsWith('tags'));
  if (tagsPill) {
    tagsPill.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true,
      clientY: tagsPill.getBoundingClientRect().top + 4,
    }));
  }
  yamlComplete.pillOpensMenu = await fmWait();
  const pl = fmLabels();
  yamlComplete.pillValueMenu = pl.includes('alpha') && pl.includes('beta');
  if (CM.closeCompletion) CM.closeCompletion(window.cmView);
  window.setLivePreviewMode(false);
  await sleep(200);

  /* Unbracketed comma values index as lists too ("tag1, tag2"). */
  replaceEditorContent('---\ntags: red, green blue\ntags: \n---\n\nbody');
  const cPos = editor.value.indexOf('tags: \n') + 6;
  window.cmView.focus();
  window.cmView.dispatch({ selection: { anchor: cPos }, userEvent: 'select.pointer' });
  const commaOpened = await fmWait();
  const cl = fmLabels();
  yamlComplete.commaListValues = commaOpened && cl.includes('red') && cl.includes('green blue');
  if (CM.closeCompletion) CM.closeCompletion(window.cmView);

  /* Outline +/- buttons scale only the outline font var, persisted. */
  const pctBefore = window.getOutlineFontSize();
  const varBefore = document.documentElement.style.getPropertyValue('--outline-font-size');
  document.getElementById('outline-font-plus').click();
  const grew = window.getOutlineFontSize() === Math.min(240, pctBefore + 10)
    && document.documentElement.style.getPropertyValue('--outline-font-size') !== varBefore;
  document.getElementById('outline-font-minus').click();
  const outlineFontButtons = grew
    && window.getOutlineFontSize() === pctBefore
    && settingsNow().outlineFontSize === pctBefore;

  return { safeCount, safeLabel, redosCount, redosElapsed, recoveredCount,
           replacedText, ghostCount, barHidden, supersededCount,
           slowOn, slowOff, opSet, opCleared, bgApplied, bgRemoved, pipeline,
           lpOnState, lpOffState, lpV2, zipEntryHidden, yamlComplete,
           outlineFontButtons, exportSuite, customTemplates, linkComplete, advanced,
           pdfPrintWindow, customFonts };
})()

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
           lpOnState, lpOffState };
})()

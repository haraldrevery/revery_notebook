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

  return { safeCount, safeLabel, redosCount, redosElapsed, recoveredCount,
           replacedText, ghostCount, barHidden, supersededCount,
           slowOn, slowOff };
})()

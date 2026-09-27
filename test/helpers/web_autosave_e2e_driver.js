/* Web autosave on hide (see web_autosave_e2e.test.js). A single
   expression, per web_e2e_main.js. */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const KEY = 'revery_md_autosave';
  const stored = () => localStorage.getItem(KEY) || '';
  const out = {};
  await sleep(600);

  /* A slow CPU-delay setting: the debounced write is seconds away. */
  renderDelay = 4000;
  const cm = window.cmView;
  const type = (s) => cm.dispatch({ changes: { from: cm.state.doc.length, insert: s }, userEvent: 'input.type' });

  /* Typing still waiting for the debounce is written when the page goes. */
  type(' MARK_PAGEHIDE');
  await sleep(200);
  out.debounceStillPending = !stored().includes('MARK_PAGEHIDE');
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  out.pagehideWritesPending = stored().includes('MARK_PAGEHIDE');

  type(' MARK_HIDDEN');
  await sleep(200);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  out.hiddenWritesPending = stored().includes('MARK_HIDDEN');

  /* Nothing pending: this tab must not overwrite what another tab wrote
     since, neither on hide nor when its old debounce timer fires. */
  localStorage.setItem(KEY, 'OTHER TAB');
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  out.idleTabWritesNothing = localStorage.getItem(KEY) === 'OTHER TAB';
  delete document.visibilityState;
  await sleep(4300);
  out.oldTimerWritesNothing = localStorage.getItem(KEY) === 'OTHER TAB';

  /* Normal typing still autosaves through the debounce. */
  renderDelay = 50;
  type(' MARK_DEBOUNCE');
  await sleep(400);
  out.debounceStillWrites = stored().includes('MARK_DEBOUNCE');
  return out;
})()

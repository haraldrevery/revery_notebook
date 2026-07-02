// editor-find.js
// ── Find / Replace Bar ────────────────────────────────────────────────────

/* Internal state */
/* Internal state */
let findMatches    = [];   // Array of objects {index, length}
let findCurrentIdx = -1;   // Index into findMatches for the active match
let findCaseSensitive = false;
let findUseRegex = false;


/* ── Regex search worker ────────────────────────────────────────────────
   User-supplied regular expressions run in a dedicated Web Worker with a
   hard time budget: a catastrophic pattern (ReDoS) can never freeze the
   UI, because on timeout the worker THREAD is terminated outright and a
   fresh worker is created for the next search. This replaces the old
   isSafeRegex heuristic as the primary defence — the heuristic rejected
   perfectly safe patterns like (a|b)+ — but the heuristic is kept below
   as the guard for environments where Workers are unavailable (then the
   old fully-synchronous code path runs instead).                        */
const FIND_WORKER_URL  = 'jvscrpt_and_css_extra/find_worker.js';
const FIND_TIMEOUT_MS  = 1500;

let _findWorker    = null;   // lazily (re)created after construction/timeout
let _workerBroken  = false;  // Worker unusable on this platform → sync fallback
let _workerReqId   = 0;
let _workerPending = null;   // { id, resolve, timer } — one request in flight

function _getFindWorker() {
  if (_workerBroken) return null;
  if (_findWorker) return _findWorker;
  try {
    _findWorker = new Worker(FIND_WORKER_URL);
  } catch (err) {
    console.warn('[Find] Web Worker unavailable — regex search uses the sync fallback with the conservative pattern guard:', err);
    _workerBroken = true;
    return null;
  }
  _findWorker.addEventListener('message', (e) => {
    const p = _workerPending;
    if (!p || !e.data || e.data.id !== p.id) return; // stale or probe reply
    clearTimeout(p.timer);
    _workerPending = null;
    p.resolve(e.data);
  });
  _findWorker.addEventListener('error', (err) => {
    /* Script failed to load or crashed — permanent fallback. */
    console.warn('[Find] Worker failed — regex search uses the sync fallback:', (err && err.message) || err);
    _workerBroken = true;
    _settlePending({ ok: false, error: 'worker-error' });
    try { _findWorker.terminate(); } catch (_) {}
    _findWorker = null;
  });
  return _findWorker;
}

function _settlePending(result) {
  const p = _workerPending;
  if (!p) return;
  clearTimeout(p.timer);
  _workerPending = null;
  p.resolve(result);
}

/* Post one job to the worker. A previous in-flight job is superseded (its
   promise resolves { ok:false, error:'superseded' } and its eventual reply
   is ignored). On timeout the worker is killed and rebuilt on next use.  */
function workerRequest(payload) {
  let w = _getFindWorker();
  if (!w) return Promise.resolve({ ok: false, error: 'unavailable' });
  if (_workerPending) {
    /* The superseded JOB may still be running inside the single-threaded
       worker; a new job would queue behind it and burn its own time budget
       waiting (a slow-but-legitimate old search could then falsely time out
       a fast new one). Kill the worker and post to a fresh one instead —
       startup cost is negligible (same-origin file, cached).             */
    _settlePending({ ok: false, error: 'superseded' });
    try { _findWorker.terminate(); } catch (_) {}
    _findWorker = null;
    w = _getFindWorker();
    if (!w) return Promise.resolve({ ok: false, error: 'unavailable' });
  }
  return new Promise((resolve) => {
    const id = ++_workerReqId;
    const timer = setTimeout(() => {
      _workerPending = null;
      try { _findWorker.terminate(); } catch (_) {}
      _findWorker = null;
      resolve({ ok: false, error: 'timeout' });
    }, FIND_TIMEOUT_MS);
    _workerPending = { id, resolve, timer };
    w.postMessage(Object.assign({ id }, payload));
  });
}

/* Eager availability probe: constructing the worker at startup surfaces
   platform support in the console once and removes first-search latency.
   The probe reply (id 0) is ignored by the pending-request listener.    */
(function probeFindWorker() {
  const w = _getFindWorker();
  if (!w) return;
  const onProbe = (e) => {
    if (e.data && e.data.id === 0) {
      console.info('[Find] Regex search worker ready.');
      w.removeEventListener('message', onProbe);
    }
  };
  w.addEventListener('message', onProbe);
  w.postMessage({ id: 0, op: 'ping' });
})();

/* ── Fallback guard: ReDoS heuristic (sync path only) ─────────────────── */
function isSafeRegex(query) {
  // 1. Absolute length limit – anything longer than 100 chars is rejected
  if (query.length > 100) return false;

  // 2. Simple linear scan – no nested regexes that could themselves cause ReDoS
  let parenDepth = 0;
  let inEscape = false;
  let lastChar = '';

  for (let i = 0; i < query.length; i++) {
    const c = query[i];

    if (inEscape) {
      inEscape = false;
      continue;
    }
    if (c === '\\') {
      inEscape = true;
      lastChar = c;
      continue;
    }

    // Detect empty group: ()
    if (c === '(' && i + 1 < query.length && query[i + 1] === ')') {
      return false;
    }

    // Detect nested quantifiers: +, *, ? directly after another quantifier
    if ((c === '+' || c === '*' || c === '?') &&
        (lastChar === '+' || lastChar === '*' || lastChar === '?')) {
      return false;
    }

    // Track parentheses depth to later detect quantified groups with alternations
    if (c === '(') parenDepth++;
    if (c === ')') parenDepth--;

    // Detect a group containing '|' that is immediately followed by a quantifier
    // Example: (a|b)+ , (?:a|b)*
    if (c === '|') {
      // Look backwards for an unclosed '(' and forwards for a quantifier after ')'
      let j = i + 1;
      while (j < query.length && query[j] !== ')') j++;
      if (j < query.length) {
        let k = j + 1;
        while (k < query.length && (query[k] === '+' || query[k] === '*' || query[k] === '?' || query[k] === '{')) {
          k++;
        }
        if (k > j + 1) return false; // quantifier found after group containing '|'
      }
    }

    lastChar = c;
  }

  // 3. Additional heuristic: reject patterns with repeated nested groups like ((a+)+)
  //    Simple check: count of '(' and ')' exceeding 3 levels in a short span
  let maxDepth = 0, currentDepth = 0;
  for (let i = 0; i < query.length; i++) {
    if (query[i] === '(') {
      currentDepth++;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
      if (maxDepth > 4) return false; // deeper than 4 nested groups -> risky
    } else if (query[i] === ')') {
      currentDepth--;
    }
  }

  return true;
}



/* ── DOM refs (resolved once the DOM is ready) ── */
const findBar      = document.getElementById('find-bar');
const findInput    = document.getElementById('find-input');
const findCaseBtn  = document.getElementById('find-case-btn');
const findRegexBtn = document.getElementById('find-regex-btn');
const findCount    = document.getElementById('find-count');
const replaceInput = document.getElementById('replace-input');
const findPrevBtn  = document.getElementById('find-prev');
const findNextBtn  = document.getElementById('find-next');
const replaceOneBtn= document.getElementById('find-replace-one');
const replaceAllBtn= document.getElementById('find-replace-all');
const findCloseBtn = document.getElementById('find-close');

// Visual find highlights are now rendered natively by CodeMirror (cm_setup.js → setFindHighlights)





// Highlights are auto-updated via the CM updateListener in cm_setup.js

/* ── Open & Close ─────────────────────────────────────────────────────── */
function openFindBar() {
  findBar.style.display = 'flex';
  /* If text is already selected, seed the find field with it */
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  if (sel && !sel.includes('\n')) {
    findInput.value = sel;
  }
  findInput.focus();
  findInput.select();
  runFind();
}

function closeFindBar() {
  /* Invalidate any in-flight worker search — its result must not repaint
     highlights or repopulate findMatches after the bar is closed. */
  _findGeneration++;
  findBar.style.display = 'none';
  findMatches    = [];
  findCurrentIdx = -1;
  if (typeof window.clearFindHighlights === 'function') window.clearFindHighlights();
  updateFindCount(); // clear count label
  editor.focus();
}




/* ── Core search ──────────────────────────────────────────────────────── */

/* Generation counter: worker results arriving after the user has already
   typed more (or toggled a mode) are stale and must not touch the UI.   */
let _findGeneration = 0;

/* Shared tail of every search: store matches, pick the one nearest the
   cursor, update counter + CM decorations.                              */
function _applyFindResults(matches) {
  findMatches    = matches;
  findCurrentIdx = -1;

  if (findMatches.length > 0) {
    /* Start at whichever match is closest to the current cursor position */
    const cursor = editor.selectionStart;
    findCurrentIdx = 0;
    for (let i = 0; i < findMatches.length; i++) {
      if (findMatches[i].index >= cursor) { findCurrentIdx = i; break; }
    }
    highlightMatch(findCurrentIdx);
  }

  updateFindCount();
  /* Sync all match positions to the CM decoration layer */
  if (typeof window.setFindHighlights === "function") {
    window.setFindHighlights(findMatches, findCurrentIdx);
  }
}

function runFind() {
  const query = findInput.value;
  findMatches    = [];
  findCurrentIdx = -1;
  const gen = ++_findGeneration;

  if (!query) {
    updateFindCount();
    return;
  }

  const text = editor.value;
  let flags = 'g';
  if (!findCaseSensitive) flags += 'i';

  /* ── Regex mode: run in the worker under a hard timeout ── */
  if (findUseRegex && !_workerBroken) {
    workerRequest({ op: 'find', text, query, flags }).then((res) => {
      if (gen !== _findGeneration) return;          // superseded by newer input
      if (!res.ok) {
        if (res.error === 'timeout') {
          if (typeof window.showStatusWarning === 'function') {
            window.showStatusWarning('regex-abort',
              'Search took too long – aborted.',
              { priority: 20, ttl: 2000 }); // expiry reveals any sticky warning beneath
          }
          _applyFindResults([]);
        } else if (res.error === 'syntax') {
          _applyFindResults([]);                    // invalid regex — same as before
        } else if (res.error === 'unavailable' || res.error === 'worker-error') {
          runFind();                                // _workerBroken now set → sync path
        }
        /* 'superseded': a newer runFind owns the UI — do nothing */
        return;
      }
      _applyFindResults(res.matches);
    });
    return;
  }

  /* ── Sync path: literal search, or regex when Workers are unavailable ── */
  let searchRegex;
    if (findUseRegex) {
    // ── MITIGATION: ReDoS Heuristic Guard (no worker to terminate here) ──
    if (!isSafeRegex(query)) {
      // Optionally show a brief non‑blocking warning
    if (typeof window.showStatusWarning === 'function') {
        window.showStatusWarning('regex-abort',
          'Regex too complex – search aborted.',
          { priority: 20, ttl: 2000 }); // expiry reveals any sticky warning beneath
      }
      updateFindCount(); // Abort search to prevent UI freeze
      return;
    }

    try {
      searchRegex = new RegExp(query, flags);
    } catch (e) {
      updateFindCount(); // Invalid regex, abort search
      return;
    }
  } else {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchRegex = new RegExp(escapedQuery, flags);
  }

  // Prevent infinite loops with zero-length matches
  if (searchRegex.test("")) {
    updateFindCount();
    return;
  }

  searchRegex.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = searchRegex.exec(text)) !== null) {
    if (match[0].length > 0) {
      matches.push({ index: match.index, length: match[0].length });
    }
    if (searchRegex.lastIndex === match.index) {
      searchRegex.lastIndex++;
    }
  }

  _applyFindResults(matches);
}





/* ── Navigation ───────────────────────────────────────────────────────── */
function findNext() {
  if (!findMatches.length) { runFind(); return; }
  findCurrentIdx = (findCurrentIdx + 1) % findMatches.length;
  highlightMatch(findCurrentIdx);
  updateFindCount();
  if (typeof window.setFindHighlights === "function") window.setFindHighlights(findMatches, findCurrentIdx);
}

function findPrev() {
  if (!findMatches.length) { runFind(); return; }
  findCurrentIdx = (findCurrentIdx - 1 + findMatches.length) % findMatches.length;
  highlightMatch(findCurrentIdx);
  updateFindCount();
  if (typeof window.setFindHighlights === "function") window.setFindHighlights(findMatches, findCurrentIdx);
}



/* ── Scroll editor to a match and select it ── */
function highlightMatch(idx) {
  if (idx < 0 || idx >= findMatches.length) return;
  const start = findMatches[idx].index;
  const end   = start + findMatches[idx].length;

  /* Scroll the textarea so the match sits ~40% down the visible area */
  const lineCount = (editor.value.match(/\n/g) || []).length + 1;
  const lineH     = editor.scrollHeight / lineCount;
  const matchLine = (editor.value.substring(0, start).match(/\n/g) || []).length;
  editor.scrollTop = Math.max(0, matchLine * lineH - editor.clientHeight * 0.4);

  /* Render find highlights natively in CodeMirror */
  if (typeof window.setFindHighlights === 'function') {
    window.setFindHighlights(findMatches, idx);
  }

  // Remember what is currently focused so we don't interrupt typing
  const currentFocus = document.activeElement;
  
  editor.focus();
  editor.setSelectionRange(start, end);
  
  // Restore focus to the input or button the user was interacting with
  if (currentFocus && currentFocus !== editor) {
    currentFocus.focus();
  }
}

/* ── Match counter label ── */
function updateFindCount() {
  if (!findInput.value) {
    findCount.textContent = '';
    findCount.className   = 'find-count';
    return;
  }
  if (findMatches.length === 0) {
    findCount.textContent = window.t('No results');
    findCount.className   = 'find-count find-no-results';
  } else {
    findCount.textContent = `${findCurrentIdx + 1} / ${findMatches.length}`;
    findCount.className   = 'find-count';
  }
}


/* ── Replace ──────────────────────────────────────────────────────────── */
function replaceCurrent() {
  if (!findMatches.length) return;
  const matchObj = findMatches[findCurrentIdx];
  const start = matchObj.index;
  const end = start + matchObj.length;
  let replacement = replaceInput.value;

  if (findUseRegex) {
    /* Re-executing the pattern on a string it already matched (within the
       worker's time budget) is bounded work, so this stays synchronous.
       The heuristic guard only applies on the no-worker fallback path,
       where nothing else protects the UI thread.                        */
    if (_workerBroken && !isSafeRegex(findInput.value)) return;

    const matchedStr = editor.value.substring(start, end);
    let flags = '';
    if (!findCaseSensitive) flags += 'i';
    try {
      const localRegex = new RegExp(findInput.value, flags);
      replacement = matchedStr.replace(localRegex, replacement);
    } catch (e) {}
  }

  insertWithUndo(start, end, replacement);
  clearTimeout(renderTimer); // ← cancel the debounced render that execCommand's input event just queued
  render();
  countWords();

  /* Re-index matches after the edit, keeping cursor near the same spot */
  runFind();
}

/* Shared tail of Replace All: swap the text, move the cursor to the end,
   re-render, persist (web mode) and re-index the matches.               */
function _applyReplaceAllResult(newText) {
  editor.value = newText;

  const newCursorPos = editor.value.length;
  editor.setSelectionRange(newCursorPos, newCursorPos);

  render();
  countWords();
  if (!(window.NativeAPI && window.NativeAPI.isDesktop)) {
    try {
      localStorage.setItem(AUTOSAVE_KEY, editor.value);
    } catch (e) { }
  }

  runFind();
}

function replaceAll() {
  const query = findInput.value;
  const replacement = replaceInput.value;
  if (!query) return;
  if (findMatches.length === 0) return;

  let flags = 'g';
  if (!findCaseSensitive) flags += 'i';

  /* ── Regex mode: full-text replace runs in the worker (hard timeout) ── */
  if (findUseRegex && !_workerBroken) {
    const textBefore = editor.value;
    workerRequest({ op: 'replaceAll', text: textBefore, query, flags, replacement }).then((res) => {
      if (!res.ok) {
        if (res.error === 'timeout' && typeof window.showStatusWarning === 'function') {
          window.showStatusWarning('regex-abort',
            'Replace took too long – aborted.',
            { priority: 20, ttl: 2000 });
        } else if (res.error === 'unavailable' || res.error === 'worker-error') {
          replaceAll();                            // _workerBroken now set → sync path
        }
        return;
      }
      /* The user kept typing while the worker ran — applying the result
         would silently destroy those keystrokes. Drop it; they can click
         Replace All again.                                              */
      if (editor.value !== textBefore) return;
      if (res.text === textBefore) return;         // nothing matched
      _applyReplaceAllResult(res.text);
    });
    return;
  }

  /* ── Sync path: literal replace, or regex when Workers are unavailable ── */
  let globalRegex;
  if (findUseRegex) {
    if (!isSafeRegex(query)) return;
    try {
      globalRegex = new RegExp(query, flags);
    } catch (e) { return; }
  } else {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    globalRegex = new RegExp(escapedQuery, flags);
  }

  const safeReplacement = findUseRegex ? replacement : replacement.replace(/\$/g, '$$$$');

  const newText = editor.value.replace(globalRegex, safeReplacement);

  if (newText === editor.value) return;

  _applyReplaceAllResult(newText);
}





/* ── Event wiring ────────────────────────────────────────────────────── */
findInput.addEventListener('input',   runFind);

if (findCaseBtn) {
  findCaseBtn.addEventListener('click', () => {
    findCaseSensitive = !findCaseSensitive;
    findCaseBtn.classList.toggle('active', findCaseSensitive);
    runFind();
  });
}

if (findRegexBtn) {
  findRegexBtn.addEventListener('click', () => {
    findUseRegex = !findUseRegex;
    findRegexBtn.classList.toggle('active', findUseRegex);
    runFind();
  });
}
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.shiftKey ? findPrev() : findNext(); e.preventDefault(); }
  if (e.key === 'Escape') { closeFindBar(); e.preventDefault(); }
});

replaceInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { replaceCurrent(); e.preventDefault(); }
  if (e.key === 'Escape') { closeFindBar();   e.preventDefault(); }
});

findPrevBtn  .addEventListener('click', findPrev);
findNextBtn  .addEventListener('click', findNext);
replaceOneBtn.addEventListener('click', replaceCurrent);
replaceAllBtn.addEventListener('click', replaceAll);
findCloseBtn .addEventListener('click', closeFindBar);

/* ── Ctrl+F global shortcut ── */
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault(); // Suppress the browser's native find dialog
    if (findBar.style.display === 'none' || findBar.style.display === '') {
      openFindBar();
    } else {
      /* Ctrl+F again while open → focus the find field */
      findInput.focus();
      findInput.select();
    }
  }
});

/* ── Close when Escape is pressed anywhere (even in the editor) ── */
editor.addEventListener('keydown', e => {
  if (e.key === 'Escape' && findBar.style.display !== 'none') {
    closeFindBar();
    e.preventDefault();
  }
});

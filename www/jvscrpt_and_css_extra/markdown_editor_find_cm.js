// editor-find.js
// ── Find / Replace Bar ────────────────────────────────────────────────────

/* Internal state */
/* Internal state */
let findMatches    = [];   // Array of objects {index, length}
let findCurrentIdx = -1;   // Index into findMatches for the active match
let findCaseSensitive = false;
let findUseRegex = false;


/* ── Security: ReDoS Guard (synchronous, no nested regexes) ───────────── */
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
  findBar.style.display = 'none';
  findMatches    = [];
  findCurrentIdx = -1;
  if (typeof window.clearFindHighlights === 'function') window.clearFindHighlights();
  updateFindCount(); // clear count label
  editor.focus();
}




/* ── Core search ──────────────────────────────────────────────────────── */
function runFind() {
  const query = findInput.value;
  findMatches    = [];
  findCurrentIdx = -1;

  if (!query) {
    updateFindCount();
    return;
  }

  const text = editor.value;
  let flags = 'g';
  if (!findCaseSensitive) flags += 'i';

let searchRegex;
    if (findUseRegex) {
    // ── MITIGATION: ReDoS Heuristic Guard ──
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
  let match;
  while ((match = searchRegex.exec(text)) !== null) {
    if (match[0].length > 0) {
      findMatches.push({ index: match.index, length: match[0].length });
    }
    if (searchRegex.lastIndex === match.index) {
      searchRegex.lastIndex++;
    }
  }

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
    // ── MITIGATION: ReDoS Heuristic Guard ──
    if (!isSafeRegex(findInput.value)) return;
    
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

function replaceAll() {
  const query = findInput.value;
  const replacement = replaceInput.value;
  if (!query) return;
  if (findMatches.length === 0) return;

  let flags = 'g';
  if (!findCaseSensitive) flags += 'i';

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

/* search.js — project-wide text search in the sidebar.
 *
 * CLAUDE.md future feature ("Maybe a search bar for the project folder?
 * ... don't want to clutter the UI"). Anti-clutter design: one header
 * button (the 🔍 glyph extracted from the Harald Revery Mono font); the
 * input row and results list exist only while searching, and closing
 * restores the file tree exactly as it was.
 *
 * File enumeration REUSES src/sidebar/project_scan.js — the shared,
 * capped, TTL-cached primitive built (and documented) for exactly this.
 * File bodies are cached per-path BY MTIME (same trick as yaml_index.js)
 * with a total-bytes lid, so repeat searches only re-read changed files.
 *
 * Matching is plain case-insensitive substring — deliberately NOT regex:
 * the in-document find bar covers regex (with its worker + timeout), and
 * a project-wide scan must never need a ReDoS story. Read-only feature.
 */

import { S } from './state.js';
import { listProjectTextFiles } from './project_scan.js';
import { openFile } from './fileops.js';
import { icon } from './icons.js';
import { openSidebar } from './panel.js';

const DEBOUNCE_MS = () => (window.slowHardwareMode ? 600 : 250);
const MIN_QUERY = 2;
const MAX_MATCHES_PER_FILE = 5;
const MAX_TOTAL_MATCHES = 200;
const MAX_CACHED_FILE = 256 * 1024;      // don't hold huge files in memory
const MAX_CACHE_TOTAL = 24 * 1024 * 1024;
const SNIPPET_RADIUS = 44;

const _bodyCache = new Map(); // path -> { mtime, text }
let _cacheBytes = 0;
let _searchToken = 0;
let _els = null; // { row, input, results }

function getTreeEl() { return document.getElementById('sidebar-tree'); }

/* ── UI skeleton (created lazily, lives above the tree) ───────────────── */
function ensureUi() {
  if (_els) return _els;
  const treeEl = getTreeEl();
  if (!treeEl || !treeEl.parentNode) return null;

  const row = document.createElement('div');
  row.id = 'sidebar-search-row';
  const input = document.createElement('input');
  input.id = 'sidebar-search-input';
  input.type = 'text';
  input.placeholder = window.t ? window.t('Search project…') : 'Search project…';
  input.spellcheck = false;
  input.autocomplete = 'off';
  const closeBtn = document.createElement('button');
  closeBtn.id = 'sidebar-search-close';
  closeBtn.title = 'Close (Escape)';
  closeBtn.textContent = '✕';
  row.appendChild(input);
  row.appendChild(closeBtn);

  const results = document.createElement('div');
  results.id = 'sidebar-search-results';

  treeEl.parentNode.insertBefore(row, treeEl);
  treeEl.parentNode.insertBefore(results, treeEl);

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), DEBOUNCE_MS());
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  });
  closeBtn.addEventListener('click', closeSearch);

  _els = { row, input, results };
  return _els;
}

export function openSearch() {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
  const els = ensureUi();
  if (!els) return;
  els.row.classList.add('active');
  els.results.classList.add('active');
  if (els.input.value.trim().length >= MIN_QUERY) runSearch(els.input.value);
  els.input.focus();
  els.input.select();
}

export function closeSearch() {
  if (!_els) return;
  _searchToken++; // abandon any in-flight scan
  _els.row.classList.remove('active');
  _els.results.classList.remove('active');
  _els.results.replaceChildren();
  const treeEl = getTreeEl();
  if (treeEl) treeEl.classList.remove('search-hidden');
}

function toggleSearch() {
  if (_els && _els.row.classList.contains('active')) closeSearch();
  else openSearch();
}

/* ── Body cache (mtime-keyed, byte-capped) ────────────────────────────── */
async function fileText(f) {
  const hit = _bodyCache.get(f.path);
  if (hit && hit.mtime === f.mtime) return hit.text;
  let text;
  try { text = await window.NativeAPI.readFile(f.path); } catch (_) { return null; }
  if (typeof text !== 'string') return null;
  if (text.length <= MAX_CACHED_FILE && _cacheBytes + text.length <= MAX_CACHE_TOTAL) {
    const old = _bodyCache.get(f.path);
    if (old) _cacheBytes -= old.text.length;
    _bodyCache.set(f.path, { mtime: f.mtime, text });
    _cacheBytes += text.length;
  }
  return text;
}

/* ── The scan ─────────────────────────────────────────────────────────── */
async function runSearch(rawQuery) {
  const els = ensureUi();
  if (!els) return;
  const query = rawQuery.trim();
  const treeEl = getTreeEl();

  if (query.length < MIN_QUERY) {
    _searchToken++;
    els.results.replaceChildren();
    if (treeEl) treeEl.classList.remove('search-hidden');
    return;
  }

  const token = ++_searchToken;
  if (treeEl) treeEl.classList.add('search-hidden');
  els.results.replaceChildren(statusRow(window.t ? window.t('Searching…') : 'Searching…'));

  const needle = query.toLowerCase();
  const files = await listProjectTextFiles(['md', 'txt']);
  const out = [];

  for (const f of files) {
    if (token !== _searchToken) return; // superseded by newer input
    if (out.length >= MAX_TOTAL_MATCHES) break;
    const text = await fileText(f);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower.indexOf(needle) === -1) continue;

    let perFile = 0;
    let lineStart = 0;
    const lines = text.split('\n');
    for (let n = 0; n < lines.length && perFile < MAX_MATCHES_PER_FILE
         && out.length < MAX_TOTAL_MATCHES; n++) {
      const col = lines[n].toLowerCase().indexOf(needle);
      if (col !== -1) {
        out.push({
          path: f.path, name: f.name,
          line: n + 1, col, len: query.length,
          snippet: lines[n],
        });
        perFile++;
      }
      lineStart += lines[n].length + 1;
    }
  }

  if (token !== _searchToken) return;
  renderResults(els.results, out, query);
}

function statusRow(text) {
  const el = document.createElement('div');
  el.className = 'search-status';
  el.textContent = text;
  return el;
}

/* ── Results (DOM-built — file names and snippets are untrusted text,
      so no innerHTML anywhere here) ─────────────────────────────────── */
function renderResults(container, matches, query) {
  container.replaceChildren();
  if (!matches.length) {
    container.appendChild(statusRow(window.t ? window.t('No matches.') : 'No matches.'));
    return;
  }

  let lastPath = null;
  for (const m of matches) {
    if (m.path !== lastPath) {
      lastPath = m.path;
      const head = document.createElement('div');
      head.className = 'search-file';
      head.appendChild(icon('file-lines'));
      const nm = document.createElement('span');
      nm.textContent = m.name;
      head.appendChild(nm);
      container.appendChild(head);
    }
    const row = document.createElement('button');
    row.className = 'search-result';
    row.title = `${m.name}:${m.line}`;

    /* trimmed snippet with the hit wrapped in <mark> */
    const from = Math.max(0, m.col - SNIPPET_RADIUS);
    const to = Math.min(m.snippet.length, m.col + m.len + SNIPPET_RADIUS);
    const pre = (from > 0 ? '…' : '') + m.snippet.slice(from, m.col);
    const hit = m.snippet.slice(m.col, m.col + m.len);
    const post = m.snippet.slice(m.col + m.len, to) + (to < m.snippet.length ? '…' : '');
    row.appendChild(document.createTextNode(pre));
    const mark = document.createElement('mark');
    mark.className = 'search-hit';
    mark.textContent = hit;
    row.appendChild(mark);
    row.appendChild(document.createTextNode(post));

    row.addEventListener('click', () => jumpToMatch(m));
    container.appendChild(row);
  }

  if (matches.length >= MAX_TOTAL_MATCHES) {
    container.appendChild(statusRow(
      (window.t ? window.t('Showing first') : 'Showing first') + ` ${MAX_TOTAL_MATCHES}.`));
  }
}

/* ── Open the file and land on the match ──────────────────────────────── */
async function jumpToMatch(m) {
  try {
    if (S.activeFilePath !== m.path) await openFile(m.path);
  } catch (_) { return; }

  const view = window.cmView;
  if (!view) return;
  /* Re-locate by line/col, falling back to a fresh search if the file
     changed since the scan (never a stale-offset jump). */
  let pos = -1;
  const doc = view.state.doc;
  if (m.line <= doc.lines) {
    const ln = doc.line(m.line);
    const idx = ln.text.toLowerCase().indexOf(m.snippet.slice(m.col, m.col + m.len).toLowerCase());
    if (idx !== -1) pos = ln.from + idx;
  }
  if (pos === -1) {
    const idx = doc.toString().toLowerCase()
      .indexOf(m.snippet.slice(m.col, m.col + m.len).toLowerCase());
    if (idx === -1) return;
    pos = idx;
  }
  view.dispatch({
    selection: { anchor: pos, head: pos + m.len },
    effects: CM.EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

export function initSearch() {
  const btn = document.getElementById('sidebar-search-btn');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); toggleSearch(); });

  /* Ctrl+Shift+F — the project-search convention (Ctrl+F stays the
     in-document find bar). Capture phase so the editor never sees it. */
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      e.stopPropagation();
      openSearchWithSidebar();
    }
  }, true);

  window.sidebarOpenSearch = openSearchWithSidebar; // probe/test hook
}

function openSearchWithSidebar() {
  if (!S.sidebarOpen) openSidebar();
  openSearch();
}

/* yaml_index.js — project-wide YAML frontmatter index for autocomplete.
 *
 * Collects the keys and values used in every note's frontmatter so the
 * editor can suggest them (window.sidebarYamlIndex, consumed by the
 * completion source in markdown_editor_cm_setup.js). Read-only.
 *
 * Performance model (also the pattern a future search feature can copy):
 *   - file listing comes from the shared project_scan.js primitive;
 *   - each file's parse result is cached BY MTIME — a rebuild re-reads
 *     only files that actually changed since last time;
 *   - the aggregated index has a short TTL so keystrokes never re-walk;
 *   - reads run in small concurrent batches, never blocking the editor
 *     (the CM completion source awaits this asynchronously).
 *
 * Web mode: no project scan is possible; the index is built from the
 * current document's frontmatter alone (passed in by the caller), so the
 * feature still works on the demo page.
 */

import { listProjectTextFiles } from './project_scan.js';

const INDEX_TTL_MS = 30 * 1000;
const MAX_FILE_BYTES = 1024 * 1024; // frontmatter lives at the top of small notes
const MAX_KEYS = 200;
const MAX_VALUES_PER_KEY = 300;
const READ_BATCH = 8;

const _fileCache = new Map(); // path -> { mtime, parsed: {keys, pairs} | null }
let _built = { at: 0, root: null, agg: null };

/* ── Parsing ──────────────────────────────────────────────────────────────
   Deliberately the same dialect the preview understands (simple
   "key: value" lines): scalars, inline [a, b] arrays, and "- item" block
   lists under a key. Not a YAML parser — never throws, never surprises. */
export function parseFrontmatterBlock(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text || '');
  if (!m) return null;
  const keys = [];
  const pairs = new Map(); // key -> [values]
  let currentKey = null;

  const addVals = (key, vals) => {
    if (!vals.length) return;
    const arr = pairs.get(key) || [];
    arr.push(...vals);
    pairs.set(key, arr);
  };

  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const kv = /^([A-Za-z0-9_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      keys.push(currentKey);
      addVals(currentKey, splitYamlValues(kv[2]));
      continue;
    }
    const li = /^\s*-\s+(.+)$/.exec(line);
    if (li && currentKey) addVals(currentKey, splitYamlValues(li[1]));
  }
  return { keys, pairs };
}

/* Comma-separated values are treated as LISTS in both spellings —
   "tags: a, b" and "tags: [a, b]" index identically. This matches the
   editor-side completion, which already segments values at commas, so
   the two dialects behave the same everywhere. (Strict YAML calls the
   unbracketed form a single string, but for tag-like metadata the list
   reading is what users mean — and consistency beats pedantry.)      */
function splitYamlValues(raw) {
  let v = (raw || '').trim();
  if (!v) return [];
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s && s.length <= 80);
}

/* ── Aggregation ────────────────────────────────────────────────────── */
function newAgg() {
  return { keyCounts: new Map(), valueCounts: new Map() }; // valueCounts: key -> Map(value->count)
}

function foldParsed(agg, parsed) {
  if (!parsed) return;
  for (const k of parsed.keys) {
    agg.keyCounts.set(k, (agg.keyCounts.get(k) || 0) + 1);
  }
  for (const [k, vals] of parsed.pairs) {
    let vc = agg.valueCounts.get(k);
    if (!vc) { vc = new Map(); agg.valueCounts.set(k, vc); }
    for (const v of vals) vc.set(v, (vc.get(v) || 0) + 1);
  }
}

async function buildProjectAgg() {
  const agg = newAgg();
  const files = await listProjectTextFiles(['md']);

  for (let i = 0; i < files.length; i += READ_BATCH) {
    const batch = files.slice(i, i + READ_BATCH);
    await Promise.all(batch.map(async (f) => {
      const cached = _fileCache.get(f.path);
      if (cached && cached.mtime === f.mtime) return; // unchanged since last scan
      let parsed = null;
      try {
        const content = await window.NativeAPI.readFile(f.path);
        if (typeof content === 'string' && content.length <= MAX_FILE_BYTES) {
          parsed = parseFrontmatterBlock(content);
        }
      } catch (_) { /* unreadable → no frontmatter from this file */ }
      _fileCache.set(f.path, { mtime: f.mtime, parsed });
    }));
  }

  /* Fold from the cache so unchanged files contribute without re-reading. */
  const live = new Set(files.map((f) => f.path));
  for (const [p, entry] of _fileCache) {
    if (!live.has(p)) { _fileCache.delete(p); continue; } // deleted/renamed files drop out
    foldParsed(agg, entry.parsed);
  }
  return agg;
}

function serialize(agg) {
  const sortDesc = (m) => Array.from(m.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([label, count]) => ({ label, count }));
  const keys = sortDesc(agg.keyCounts).slice(0, MAX_KEYS);
  const values = {};
  for (const [k, vc] of agg.valueCounts) {
    values[k] = sortDesc(vc).slice(0, MAX_VALUES_PER_KEY);
  }
  return { keys, values };
}

/**
 * The completion source's data feed. `currentDocFm` is the (unsaved)
 * frontmatter slice of the open document — merged on top of the project
 * index so just-typed keys/values suggest immediately.
 */
export async function getYamlIndex(currentDocFm) {
  const root = (window.NativeAPI && window.NativeAPI.isDesktop)
    ? (typeof window.sidebarGetRootPath === 'function' ? window.sidebarGetRootPath() : null)
    : '(web)';

  const now = Date.now();
  if (!_built.agg || _built.root !== root || now - _built.at >= INDEX_TTL_MS) {
    _built = { at: now, root, agg: await buildProjectAgg() };
  }

  /* Merge the current document without mutating the cached aggregate. */
  const merged = newAgg();
  for (const [k, c] of _built.agg.keyCounts) merged.keyCounts.set(k, c);
  for (const [k, vc] of _built.agg.valueCounts) merged.valueCounts.set(k, new Map(vc));
  foldParsed(merged, parseFrontmatterBlock(currentDocFm));

  return serialize(merged);
}

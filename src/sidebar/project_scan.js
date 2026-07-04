/* project_scan.js — shared "enumerate the project's text files" primitive.
 *
 * Built for reuse: the YAML frontmatter index consumes it today, and a
 * future project-wide search bar can consume the exact same listing +
 * cache instead of growing its own walker. Read-only by construction.
 *
 * The listing is cached briefly (LIST_TTL_MS) per project root so several
 * consumers asking in quick succession — e.g. autocomplete keystrokes —
 * cost one walk, not many. Dot-directories (.git, .obsidian, …) are
 * skipped, as is anything beyond MAX_FILES (defensive cap: an enormous
 * folder should degrade to "partial index", never to a frozen UI).
 */

import { S } from './state.js';

const MAX_FILES = 800;
const LIST_TTL_MS = 15 * 1000;

let _cache = { at: 0, root: null, files: null };

/**
 * List text files under the project root: [{ path, name, mtime }].
 * `exts` — lowercase extensions without dots, e.g. ['md'] (default).
 * Returns [] in web mode or when no folder is open.
 */
export async function listProjectTextFiles(exts) {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return [];
  const wanted = new Set((exts && exts.length ? exts : ['md']).map((e) => e.toLowerCase()));

  const now = Date.now();
  if (!_cache.files || _cache.root !== S.rootPath || now - _cache.at >= LIST_TTL_MS) {
    const files = [];
    const walk = async (dir) => {
      if (files.length >= MAX_FILES) return;
      let entries;
      try { entries = await window.NativeAPI.readDirectory(dir); } catch (_) { return; }
      for (const e of entries) {
        if (files.length >= MAX_FILES) return;
        if (!e || !e.name || e.name.startsWith('.')) continue; // skip dot-entries (.git…)
        if (e.type === 'dir') {
          await walk(e.path);
        } else {
          files.push({ path: e.path, name: e.name, mtime: e.mtime });
        }
      }
    };
    await walk(S.rootPath);
    _cache = { at: now, root: S.rootPath, files };
  }

  return _cache.files.filter((f) => {
    const dot = f.name.lastIndexOf('.');
    return dot > 0 && wanted.has(f.name.slice(dot + 1).toLowerCase());
  });
}

/** Drop the cached listing (e.g. after big tree changes). Cheap to call. */
export function invalidateProjectScan() {
  _cache = { at: 0, root: null, files: null };
}

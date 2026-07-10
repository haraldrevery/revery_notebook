/* link_complete.js — directory listing for the editor's link-path
   autocomplete (VS-Code-style path IntelliSense inside `![...](here)` /
   `[...](here)` destinations).

   The editor side (markdown_editor_cm_setup.js, a CodeMirror completion
   source) detects the link context and calls
   window.sidebarListLinkCompletions(rawTypedDest); this module does the
   path math and filesystem listing, because it owns the same primitives
   the renderer and the rename-link-rewriter use: resolveRel (identical
   resolution semantics — suggestions always match what will render),
   getFileCategory (folders + media + notes only), and the project-root
   containment rule (paths outside the root list nothing).

   Read-only by construction: this module only ever calls readDirectory.
   In web mode (no filesystem) it returns null and the completion source
   stays inert. */

import { S } from './state.js';
import { getFileCategory } from './helpers.js';
import { resolveRel } from './link_rewrite.js';

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

const dirOf = (p) => p.replace(/\\/g, '/').split('/').slice(0, -1).join('/');

/**
 * @param {string} rawDest  the typed destination text before the cursor,
 *                          exactly as it appears in the document (may be
 *                          percent-encoded — links usually are).
 * @returns {Promise<null | { rawSegLength: number,
 *                            entries: Array<{name: string, isDir: boolean}> }>}
 *   rawSegLength — length of the segment after the last '/', in RAW text
 *   (the completion source replaces exactly that range).
 */
export async function listLinkCompletions(rawDest) {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return null;
  if (typeof rawDest !== 'string') return null;

  const lastSlash = rawDest.lastIndexOf('/');
  const rawDir = lastSlash >= 0 ? rawDest.slice(0, lastSlash + 1) : '';
  const rawSeg = rawDest.slice(lastSlash + 1);
  let decDir = rawDir;
  let decSeg = rawSeg;
  try { decDir = decodeURIComponent(rawDir); } catch (_) { /* keep raw */ }
  try { decSeg = decodeURIComponent(rawSeg); } catch (_) { /* keep raw */ }

  /* URLs (https:, data:, …) are not project paths — stay quiet. */
  if (SCHEME_RE.test(decDir || decSeg)) return null;

  const baseDir = S.activeFilePath
    ? dirOf(S.activeFilePath)
    : S.rootPath.replace(/\\/g, '/');
  const absDir = resolveRel(baseDir, decDir);

  /* Same containment rule as the renderer: never list outside the root. */
  const root = S.rootPath.replace(/\\/g, '/').replace(/\/$/, '');
  if (absDir !== root && !absDir.startsWith(root + '/')) return null;

  let entries;
  try { entries = await window.NativeAPI.readDirectory(absDir); } catch (_) { return null; }
  if (!Array.isArray(entries)) return null;

  const segLower = decSeg.toLowerCase();
  const out = [];
  for (const e of entries) {
    if (!e || !e.name || e.name.startsWith('.')) continue;
    const isDir = e.type === 'dir';
    if (!isDir) {
      const cat = getFileCategory(e.name);
      if (cat !== 'media' && cat !== 'text') continue; // folders + media + notes
    }
    if (segLower && !e.name.toLowerCase().startsWith(segLower)) continue;
    out.push({ name: e.name, isDir });
  }
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  return { rawSegLength: rawSeg.length, entries: out.slice(0, 60) };
}

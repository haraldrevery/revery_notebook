/* link_complete.js — directory listing for the editor's link-path
   autocomplete (VS-Code-style path IntelliSense inside `![...](here)` /
   `[...](here)` destinations).

   The editor side (markdown_editor_cm_setup.js, a CodeMirror completion
   source) detects the link context and calls
   window.sidebarListLinkCompletions(rawTypedDest); this module does the
   listing with the app's shared path rules (paths.js — suggestions always
   match what will render), getFileCategory (folders + media + notes
   only), and the project-root containment rule (paths outside the root
   list nothing). The base folder is pendingNoteDir(): the active note's
   folder, else where the next keystroke creates the note.

   Read-only by construction: this module only ever calls readDirectory.
   In web mode (no filesystem) it returns null and the completion source
   stays inert. */

import { S, pendingNoteDir } from './state.js';
import { getFileCategory } from './helpers.js';
import { resolvePath, isInsideRoot, hasUrlScheme, decodeLinkDest } from './paths.js';

/**
 * @param {string} rawDest  the typed destination text before the cursor,
 *                          exactly as it appears in the document (may be
 *                          percent-encoded — links usually are).
 * @returns {Promise<null | { rawSegLength: number,
 *                            entries: Array<{name: string, isDir: boolean,
 *                                            kind: 'folder'|'image'|'note'}> }>}
 *   rawSegLength — length of the segment after the last '/', in RAW text
 *   (the completion source replaces exactly that range).
 *   kind         — what the row is, for the menu's glyph; derived from the
 *                  same getFileCategory the sidebar tree uses.
 */
export async function listLinkCompletions(rawDest) {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop || !S.rootPath) return null;
  if (typeof rawDest !== 'string') return null;

  const lastSlash = rawDest.lastIndexOf('/');
  const rawDir = lastSlash >= 0 ? rawDest.slice(0, lastSlash + 1) : '';
  const rawSeg = rawDest.slice(lastSlash + 1);
  const decDir = decodeLinkDest(rawDir);
  const decSeg = decodeLinkDest(rawSeg);

  /* URLs (https:, data:, …) are not project paths — stay quiet. */
  if (hasUrlScheme(decDir || decSeg)) return null;

  const baseDir = pendingNoteDir();
  if (!baseDir) return null;
  const absDir = resolvePath(baseDir, decDir);

  /* Same containment rule as the renderer: never list outside the root. */
  if (!isInsideRoot(absDir, S.rootPath)) return null;

  let entries;
  try { entries = await window.NativeAPI.readDirectory(absDir); } catch (_) { return null; }
  if (!Array.isArray(entries)) return null;

  const segLower = decSeg.toLowerCase();
  const out = [];
  for (const e of entries) {
    if (!e || !e.name || e.name.startsWith('.')) continue;
    const isDir = e.type === 'dir';
    let kind = 'folder';
    if (!isDir) {
      const cat = getFileCategory(e.name);
      if (cat !== 'media' && cat !== 'text') continue; // folders + media + notes
      kind = cat === 'media' ? 'image' : 'note';
    }
    if (segLower && !e.name.toLowerCase().startsWith(segLower)) continue;
    out.push({ name: e.name, isDir, kind });
  }
  out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  return { rawSegLength: rawSeg.length, entries: out.slice(0, 60) };
}

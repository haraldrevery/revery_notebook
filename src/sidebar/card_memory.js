/* card_memory.js — which folder the card view showed, per project.
   PURE (no DOM, no storage access): unit-tested in test/card_memory.test.js.
   cards.js keeps the list in localStorage (per-viewer UI state, like the
   view mode and the card size) and asks here what to restore.

   The list is newest-first and bounded: one entry per project root,
   compared with pathKey (Windows spellings ignore case). A remembered
   folder is only ever offered INSIDE its project root; whether it still
   exists is the renderer's question (cards.js falls back to the nearest
   folder that does). */
import { pathKey, isInsideRoot } from './paths.js';

export const CARD_DIRS_KEY = 'revery_card_view_dirs';
export const MAX_REMEMBERED_PROJECTS = 30;

/** Stored text → [{ root, dir }]; anything malformed is dropped. */
export function parseCardDirs(raw) {
  let list;
  try { list = JSON.parse(raw); } catch (_) { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e.root === 'string' && e.root
    && typeof e.dir === 'string' && e.dir);
}

/** The folder remembered for `root`, or null (none, or not inside it). */
export function rememberedCardDir(list, root) {
  if (!root || !Array.isArray(list)) return null;
  const key = pathKey(root);
  const hit = list.find((e) => pathKey(e.root) === key);
  return hit && isInsideRoot(hit.dir, root) ? hit.dir : null;
}

/** `list` with `dir` remembered for `root` — newest first, bounded. */
export function withCardDir(list, root, dir) {
  const key = pathKey(root);
  const rest = (Array.isArray(list) ? list : []).filter((e) => pathKey(e.root) !== key);
  return [{ root, dir }, ...rest].slice(0, MAX_REMEMBERED_PROJECTS);
}

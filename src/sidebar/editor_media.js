/* editor_media.js — drop or paste media straight into the document.
 *
 * CLAUDE.md QoL item ("make it easier for users to work with images"):
 * dropping an image onto the EDITOR (not just the sidebar) or pasting a
 * screenshot copies the media file into the project — next to the active
 * note, falling back to the project root — and inserts the same
 * `![name](relative)` link a sidebar drag produces (mediaMarkdown).
 *
 * Reuses the sidebar's proven copy machinery: NativeAPI.copyFileIntoFolder
 * (bytes → unique name, 20 MB cap, root-contained on the backend) and, for
 * Tauri's native drop path, copyPathIntoFolder. Only NEW files are ever
 * written; the insert is a normal undoable editor transaction.
 *
 * Desktop-only: web mode has no project folder, so everything here no-ops.
 */

import { S } from './state.js';
import { getFileCategory, mediaMarkdown, arrayBufferToBase64 } from './helpers.js';
import { renderTree } from './tree.js';

const MEDIA_MAX_BYTES = 20 * 1024 * 1024; // matches the backend copy cap

/* Media lands next to the file that will reference it (shortest relative
   link), falling back to the project root. */
function destDirForMedia() {
  if (S.activeFilePath) {
    return S.activeFilePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  }
  return S.rootPath || null;
}

async function requireDestDir() {
  const dir = destDirForMedia();
  if (!dir) {
    await window.NativeAPI.showMessageBox({
      type: 'info',
      title: window.t ? window.t('Add media') : 'Add media',
      message: window.t ? window.t('Open a project folder first.') : 'Open a project folder first.',
    });
    return null;
  }
  return dir;
}

/* Insert the links for the copied files at the cursor — a normal undoable
   edit that flows through autosave like any keystroke. */
function insertMediaLinks(finalPaths) {
  if (!finalPaths.length) return;
  const links = finalPaths.map((p) => mediaMarkdown(p)).join('\n');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  window.insertWithUndo(start, end, links + '\n');
  const cur = start + links.length + 1;
  editor.setSelectionRange(cur, cur);
  if (typeof render === 'function') render();
  if (typeof countWords === 'function') countWords();
}

function notifyIssues(errors) {
  if (!errors.length) return;
  window.NativeAPI.showMessageBox({
    type: 'warning',
    title: 'Copy Issues',
    message: `${errors.length} file(s) could not be added:`,
    detail: errors.join('\n'),
  });
}

/* ── Entry point 1: File objects (Electron DOM drop + clipboard paste) ── */
async function handleEditorMediaFiles(files) {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return false;
  const media = Array.from(files || []).filter((f) => getFileCategory(f.name) === 'media');
  if (!media.length) return false;
  if (S._operationLock) return true;

  const dir = await requireDestDir();
  if (!dir) return true;

  S._operationLock = true;
  try {
    const finals = [];
    const errors = [];
    for (const f of media) {
      if (f.size > MEDIA_MAX_BYTES) {
        errors.push(`${f.name}: too large (${(f.size / 1024 / 1024).toFixed(1)} MB, max 20 MB)`);
        continue;
      }
      try {
        const b64 = arrayBufferToBase64(await f.arrayBuffer());
        const res = await window.NativeAPI.copyFileIntoFolder(dir, f.name, b64);
        finals.push(res.path);
      } catch (err) {
        errors.push(`${f.name}: ${(err && err.message) || err}`);
      }
    }
    insertMediaLinks(finals);
    if (finals.length) await renderTree();
    notifyIssues(errors);
  } finally {
    S._operationLock = false;
  }
  return true;
}

/* ── Entry point 2: absolute paths (Tauri native OS drop) ─────────────── */
async function handleEditorMediaPaths(paths) {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return false;
  const media = (paths || []).filter((p) =>
    getFileCategory(p.replace(/\\/g, '/').split('/').pop()) === 'media');
  if (!media.length) return false;
  if (S._operationLock) return true;

  const dir = await requireDestDir();
  if (!dir) return true;

  S._operationLock = true;
  try {
    const finals = [];
    const errors = [];
    for (const p of media) {
      try {
        const res = await window.NativeAPI.copyPathIntoFolder(p, dir);
        finals.push(res.path);
      } catch (err) {
        errors.push(`${p}: ${(err && err.message) || err}`);
      }
    }
    insertMediaLinks(finals);
    if (finals.length) await renderTree();
    notifyIssues(errors);
  } finally {
    S._operationLock = false;
  }
  return true;
}

/* Screenshots arrive from the clipboard as an unnamed 'image.png' — give
   them a timestamped name like Obsidian does. */
function extFromMime(type) {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  };
  return map[type] || 'png';
}
function pastedImageName(type) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `Pasted image ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
    + `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${extFromMime(type)}`;
}

export function initEditorMedia() {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
  const dom = window.cmView && window.cmView.dom;
  if (!dom) return;

  /* Capture phase on both: CodeMirror's own handlers sit on contentDOM,
     and must never also act on a drop/paste we consume (double-handling). */
  dom.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return; // sidebar text drags etc. — not ours
    const anyMedia = Array.from(files).some((f) => getFileCategory(f.name) === 'media');
    if (!anyMedia) return; // non-media OS files: sidebar drop handles those
    e.preventDefault();
    e.stopPropagation();
    /* Put the cursor where the user dropped, so the link lands there. */
    try {
      const pos = window.cmView.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos != null) editor.setSelectionRange(pos, pos);
    } catch (_) { /* keep current cursor */ }
    handleEditorMediaFiles(files);
  }, true);

  dom.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imgs = Array.from(items).filter(
      (it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imgs.length) return; // normal text paste — CodeMirror handles it
    e.preventDefault();
    e.stopPropagation();
    const files = imgs
      .map((it) => {
        const f = it.getAsFile();
        return f ? new File([f], pastedImageName(f.type || it.type), { type: f.type }) : null;
      })
      .filter(Boolean);
    handleEditorMediaFiles(files);
  }, true);

  /* Test/probe hook — same internals the drop and paste listeners use. */
  window.sidebarEditorMediaFiles = handleEditorMediaFiles;
}

export { handleEditorMediaFiles, handleEditorMediaPaths };

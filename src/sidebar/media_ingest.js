/* media_ingest.js — the single path by which files enter the project from
   a drop or a paste, and by which media links enter a note.

   Sources are platform-neutral: { kind: 'file', file } is a DOM File whose
   bytes we read (Electron, WebView2), { kind: 'path', path } is an
   absolute source path from the wrapper's native drop event (Tauri on
   Linux/macOS). drop_transport.js decides which one is live; this module
   never asks — it copies whatever it is handed, through the backend's
   root-contained, never-overwriting copy commands (unique names, 20 MB).

   Destination and link base are the SAME folder, chosen once per ingest:
   pendingNoteDir() — the active note's folder, else the folder in which
   the first keystroke would create the note. The inserted link is a normal
   undoable transaction, so it flows through autosave and, when no note is
   open yet, through the scratchpad auto-create — which reads the same
   pendingNoteDir(), so the link is still correct once the note exists.

   Editor drops are owned here, in the capture phase on the CodeMirror
   wrapper: CodeMirror's own drop handler (on the content DOM below) would
   otherwise insert a dropped text file's contents or a file:// URL, and a
   sidebar row's text/plain payload twice. Sidebar rows announce themselves
   with SIDEBAR_ITEM_MIME (tree.js / cards.js dragstart).

   In live preview a drop cannot aim at a character — the blocks are
   rendered HTML — so markdown_editor_livepreview.js maps the point to a
   source line and the media goes in as its own paragraph after it
   (dropTargetAt + block_insert.js). The classic editor keeps inserting
   at the character under the pointer.

   Desktop-only: in web mode there is no project folder and nothing here
   attaches. */

import { S, expandedDirs, pendingNoteDir } from './state.js';
import { getFileCategory, mediaMarkdown, arrayBufferToBase64 } from './helpers.js';
import { baseNameOf } from './paths.js';
import { renderTree } from './tree.js';
import { fileDropTransport, isOsFileDrop, SIDEBAR_ITEM_MIME } from './drop_transport.js';
import { paragraphInsertion } from './block_insert.js';

export const DROP_MAX_BYTES = 20 * 1024 * 1024; // matches both backends' copy cap

const sourceName = (src) => (src.kind === 'file' ? src.file.name : baseNameOf(src.path));
const isMediaSource = (src) => getFileCategory(sourceName(src)) === 'media';

export const filesToSources = (files) => Array.from(files || []).map((file) => ({ kind: 'file', file }));
export const pathsToSources = (paths) => (paths || []).map((path) => ({ kind: 'path', path }));

/* ── Copying ─────────────────────────────────────────────────────────── */

/** Copy every source into targetDir. Resolves to { finals, errors } —
    absolute paths of the files written, and one message per failure.
    Never throws; a failing source never stops the others. */
export async function copySources(sources, targetDir) {
  const finals = [];
  const errors = [];
  for (const src of sources) {
    const label = sourceName(src);
    try {
      let res;
      if (src.kind === 'file') {
        if (src.file.size > DROP_MAX_BYTES) {
          errors.push(`${label}: too large (${(src.file.size / 1024 / 1024).toFixed(1)} MB, max 20 MB)`);
          continue;
        }
        let b64;
        try {
          b64 = arrayBufferToBase64(await src.file.arrayBuffer());
        } catch (_) {
          errors.push(`${label}: could not read (folders can't be dropped here)`);
          continue;
        }
        res = await window.NativeAPI.copyFileIntoFolder(targetDir, src.file.name, b64);
      } else {
        res = await window.NativeAPI.copyPathIntoFolder(src.path, targetDir);
      }
      finals.push(res.path);
    } catch (err) {
      errors.push(`${label}: ${(err && err.message) || err}`);
    }
  }
  return { finals, errors };
}

/* Copies are FS mutations like move/rename/delete: serialize them behind
   the same lock. A drop that arrives mid-operation is refused with a
   visible reason instead of being silently eaten. */
async function withOperationLock(fn) {
  if (S._operationLock) {
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('fs-busy', window.t('Busy — try again in a moment.'), { priority: 5, ttl: 2500 });
    }
    return false;
  }
  S._operationLock = true;
  try {
    await fn();
    return true;
  } finally {
    S._operationLock = false;
  }
}

function reportCopyIssues(errors, messageKey) {
  if (!errors.length) return;
  window.NativeAPI.showMessageBox({
    type: 'warning',
    title: window.t('Copy Issues'),
    message: window.t(messageKey).replace('{n}', errors.length),
    detail: errors.join('\n'),
  }).catch(() => {});
}

/** Sidebar drop: copy the sources into a folder and show the result. */
export function copyIntoFolder(sources, targetDir) {
  if (!sources.length || !targetDir) return Promise.resolve(false);
  return withOperationLock(async () => {
    const { finals, errors } = await copySources(sources, targetDir);
    if (finals.length) {
      expandedDirs.add(targetDir);
      await renderTree();
    }
    reportCopyIssues(errors, '{n} file(s) could not be copied:');
  });
}

/* ── Inserting into the note ─────────────────────────────────────────── */

/** Document offset under a client point, else the current cursor. */
export function docPosAtClient(x, y) {
  try {
    const pos = window.cmView.posAtCoords({ x, y });
    if (pos != null) return pos;
  } catch (_) { /* fall back to the cursor */ }
  return editor.selectionStart;
}

/** Where a drop at a client point inserts: { pos, paragraph }. Live
    preview answers with a line end and the media goes in as its own
    paragraph there; otherwise the character under the pointer. */
export function dropTargetAt(x, y) {
  const lpPos = typeof window.livePreviewDropPos === 'function' ? window.livePreviewDropPos(x, y) : null;
  if (lpPos != null) return { pos: lpPos, paragraph: true };
  return { pos: docPosAtClient(x, y), paragraph: false };
}

/* Insert media markdown (one or more link lines, no trailing newline) at
   a drop target. The paragraph form re-reads its neighbours at insertion
   time, so it never glues onto text even if the document changed while
   the files were being copied. */
function insertAtTarget(target, links) {
  if (!target.paragraph) {
    window.insertWithUndo(target.pos, target.pos, links + '\n'); // cursor lands after the links
    return;
  }
  const doc = window.cmView.state.doc;
  const pos = Math.max(0, Math.min(target.pos, doc.length));
  const { insert, cursor } = paragraphInsertion(
    doc.sliceString(Math.max(0, pos - 2), pos), doc.sliceString(pos, pos + 2), links);
  window.insertWithUndo(pos, pos, insert, pos + cursor);
}

/** Media pasted on the EDITOR: replace [from, to) with the links. */
export function ingestMediaAt(sources, from, to = from) {
  return ingestMedia(sources, (links) => window.insertWithUndo(from, to, links + '\n')); // cursor lands after the links
}

/** Media dropped on the EDITOR at a dropTargetAt() target. */
export function ingestMediaAtDrop(sources, target) {
  return ingestMedia(sources, (links) => insertAtTarget(target, links));
}

/* Copy into the folder the link will live in, then hand one
   `![name](relative)` line per file to `insert`. Non-media sources are
   ignored here by design — the editor takes images; other files are
   copied by dropping them on the file panel. */
function ingestMedia(sources, insert) {
  const media = sources.filter(isMediaSource);
  if (!media.length) {
    if (sources.length) explainNonMediaDrop(); // same answer on every transport
    return Promise.resolve(false);
  }
  const dir = pendingNoteDir();
  if (!dir) {
    window.NativeAPI.showMessageBox({
      type: 'info',
      title: window.t('Add media'),
      message: window.t('Open a project folder first.'),
    }).catch(() => {});
    return Promise.resolve(false);
  }
  return withOperationLock(async () => {
    const { finals, errors } = await copySources(media, dir);
    if (finals.length) {
      insert(finals.map((p) => mediaMarkdown(p, dir)).join('\n'));
      expandedDirs.add(dir);
      await renderTree();
    }
    reportCopyIssues(errors, '{n} file(s) could not be added:');
  });
}

/** A sidebar row dropped on the editor: media inserts its link relative
    to the note; notes and other files insert nothing. */
function insertSidebarItem(dataTransfer, target) {
  const itemPath = dataTransfer.getData(SIDEBAR_ITEM_MIME);
  if (!itemPath) return;
  if (getFileCategory(baseNameOf(itemPath)) !== 'media') return;
  insertAtTarget(target, mediaMarkdown(itemPath));
}

function explainNonMediaDrop() {
  if (typeof window.showStatusWarning === 'function') {
    window.showStatusWarning('editor-drop',
      window.t('Only images can be dropped into a note. Drop other files on the file panel to copy them into the project.'),
      { priority: 5, ttl: 5000 });
  }
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

export function initMediaIngest() {
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;
  const dom = window.cmView && window.cmView.dom;
  if (!dom) return;
  const transport = fileDropTransport();

  dom.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const types = Array.from(dt.types || []);

    if (types.includes(SIDEBAR_ITEM_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      insertSidebarItem(dt, dropTargetAt(e.clientX, e.clientY));
      return;
    }
    if (!isOsFileDrop(dt)) return; // plain text drags stay CodeMirror's

    /* OS files never reach CodeMirror: it would insert a text file's
       contents (Chromium) or the file's URL (WebKitGTK). */
    e.preventDefault();
    e.stopPropagation();
    if (transport !== 'dom') return; // the native event delivers this drop (dnd.js)
    ingestMediaAtDrop(filesToSources(dt.files), dropTargetAt(e.clientX, e.clientY));
  }, true);

  dom.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const images = Array.from(items).filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!images.length) return; // ordinary text paste — CodeMirror handles it
    e.preventDefault();
    e.stopPropagation();
    const files = images
      .map((it) => {
        const f = it.getAsFile();
        return f ? new File([f], pastedImageName(f.type || it.type), { type: f.type }) : null;
      })
      .filter(Boolean);
    ingestMediaAt(filesToSources(files), editor.selectionStart, editor.selectionEnd);
  }, true);
}

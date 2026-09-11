'use strict';

/* Unit tests for src/sidebar/link_complete.js — the directory listing
   behind the editor's link-path autocomplete (`![...](here)`). Pins the
   rules the editor relies on: desktop-only, project-root containment
   (`..` may climb but never leave the root, absolute paths and URLs list
   nothing), folders + images + notes only (dot-entries and other files
   hidden), case-insensitive prefix filtering, percent-encoded segments
   decoded before matching, rawSegLength measured in RAW text, folders
   first, a `kind` per row for the menu glyph, and the size cap.

   state.js touches the DOM at import time, so a minimal document stub is
   installed first; the filesystem is an in-memory readDirectory. */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

globalThis.document = { getElementById: () => null };
globalThis.window = globalThis;

const modUrl = (f) => pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', f)).href;

/* In-memory project. Keys are absolute directory paths (forward slashes,
   exactly as paths.js resolves them); values are readDirectory entries. */
const ROOT = '/p';
const FS = {
  '/p': [
    { name: 'images', type: 'dir' }, { name: 'docs', type: 'dir' }, { name: '.git', type: 'dir' },
    { name: 'note.md', type: 'file' }, { name: 'README.txt', type: 'file' },
    { name: 'archive.zip', type: 'file' }, { name: '.hidden.png', type: 'file' },
  ],
  '/p/images': [
    { name: 'work stuff', type: 'dir' }, { name: 'vacation', type: 'dir' },
    { name: 'logo.png', type: 'file' }, { name: 'clip.mp4', type: 'file' },
  ],
  '/p/images/vacation': [{ name: 'beach.png', type: 'file' }, { name: 'Sunset.JPG', type: 'file' }],
  '/p/images/work stuff': [{ name: 'chart (v2).png', type: 'file' }, { name: 'chart%.png', type: 'file' }],
  '/p/docs': [{ name: 'readme.md', type: 'file' }],
  '/p/big': Array.from({ length: 100 }, (_, i) => ({ name: `f${String(i).padStart(3, '0')}.png`, type: 'file' })),
};
const calls = [];
globalThis.NativeAPI = {
  isDesktop: true,
  async readDirectory(dir) {
    calls.push(dir);
    if (!(dir in FS)) throw new Error('ENOENT ' + dir);
    return FS[dir].map((e) => ({ ...e, path: dir + '/' + e.name, mtime: 0 }));
  },
};

let S, listLinkCompletions;
beforeEach(async () => {
  ({ S } = await import(modUrl('state.js')));
  ({ listLinkCompletions } = await import(modUrl('link_complete.js')));
  S.rootPath = ROOT;
  S.activeFilePath = ROOT + '/note.md';
  S.previewMediaPath = null;
  S.selectedDirPath = null;
  globalThis.NativeAPI.isDesktop = true;
  calls.length = 0;
});

const names = (r) => r.entries.map((e) => e.name + (e.isDir ? '/' : ''));

test('inert without a filesystem: web mode, no root, bad input', async () => {
  globalThis.NativeAPI.isDesktop = false;
  assert.equal(await listLinkCompletions(''), null);
  globalThis.NativeAPI.isDesktop = true;
  S.rootPath = null;
  assert.equal(await listLinkCompletions(''), null);
  S.rootPath = ROOT;
  assert.equal(await listLinkCompletions(undefined), null);
  assert.deepEqual(calls, [], 'nothing may touch the filesystem');
});

test('root listing: folders first, then notes and images; dot-entries and other files hidden', async () => {
  const r = await listLinkCompletions('');
  assert.deepEqual(names(r), ['docs/', 'images/', 'note.md', 'README.txt']);
  assert.deepEqual(r.entries.map((e) => e.kind), ['folder', 'folder', 'note', 'note']);
  assert.equal(r.rawSegLength, 0);
  assert.deepEqual(calls, ['/p']);
});

test('prefix filter is case-insensitive; rawSegLength is the typed segment', async () => {
  const r = await listLinkCompletions('IM');
  assert.deepEqual(names(r), ['images/']);
  assert.equal(r.rawSegLength, 2);
  assert.deepEqual(names(await listLinkCompletions('n')), ['note.md']);
  assert.deepEqual(names(await listLinkCompletions('zzz')), []);
});

test('descending: images and folders, videos are not markdown images', async () => {
  const r = await listLinkCompletions('images/');
  assert.deepEqual(names(r), ['vacation/', 'work stuff/', 'logo.png']);
  assert.deepEqual(r.entries.map((e) => e.kind), ['folder', 'folder', 'image']);
  assert.equal(r.rawSegLength, 0);
  assert.deepEqual(names(await listLinkCompletions('images/vacation/s')), ['Sunset.JPG']);
});

test('percent-encoded folders and segments are decoded before matching; rawSegLength stays raw', async () => {
  const r = await listLinkCompletions('images/work%20stuff/chart%20');
  assert.deepEqual(names(r), ['chart (v2).png']);
  assert.equal(r.rawSegLength, 'chart%20'.length);
  assert.deepEqual(calls, ['/p/images/work stuff']);
  /* A malformed escape must not throw — it matches nothing rather than crashing. */
  const bad = await listLinkCompletions('images/work%20stuff/chart%');
  assert.ok(bad === null || Array.isArray(bad.entries));
});

test('`..` climbs from a subfolder note but never leaves the root', async () => {
  S.activeFilePath = ROOT + '/docs/readme.md';
  const r = await listLinkCompletions('../');
  assert.deepEqual(names(r), ['docs/', 'images/', 'note.md', 'README.txt']);
  assert.deepEqual(calls, ['/p']);
  assert.equal(await listLinkCompletions('../../'), null, 'above the root → nothing');
  assert.equal(calls.length, 1, 'containment is decided before any readDirectory');
  /* A round trip that lands back inside the root is fine — the renderer
     resolves it the same way, so such a link would render. */
  assert.deepEqual(names(await listLinkCompletions('../../p/')), ['docs/', 'images/', 'note.md', 'README.txt']);
});

test('absolute paths outside the root and URLs are quiet; an absolute path INSIDE the root lists (as the renderer resolves it)', async () => {
  assert.equal(await listLinkCompletions('/'), null, 'a leading slash is the filesystem root here, not the project root');
  assert.equal(await listLinkCompletions('/etc/'), null);
  assert.equal(await listLinkCompletions('https://example.com/'), null);
  assert.equal(await listLinkCompletions('mailto:a'), null);
  assert.equal(await listLinkCompletions('C:/x/'), null);
  assert.deepEqual(calls, [], 'containment and scheme checks happen before any readDirectory');
  assert.deepEqual(names(await listLinkCompletions('/p/images/')), ['vacation/', 'work stuff/', 'logo.png']);
});

test('base folder follows pendingNoteDir: preview media and selected folder when no note is open', async () => {
  S.activeFilePath = null;
  S.previewMediaPath = ROOT + '/images/logo.png';
  assert.deepEqual(names(await listLinkCompletions('')), ['vacation/', 'work stuff/', 'logo.png']);
  S.previewMediaPath = null;
  S.selectedDirPath = ROOT + '/docs';
  assert.deepEqual(names(await listLinkCompletions('')), ['readme.md']);
});

test('Windows spellings: backslash note paths, case-insensitive root containment', async () => {
  FS['C:/Users/h/notes'] = [{ name: 'Docs', type: 'dir' }, { name: 'a.png', type: 'file' }];
  FS['C:/Users/h/notes/Docs'] = [{ name: 'b.md', type: 'file' }];
  S.rootPath = 'C:/Users/h/notes';
  S.activeFilePath = 'C:\\Users\\h\\notes\\Docs\\x.md';
  assert.deepEqual(names(await listLinkCompletions('')), ['b.md']);
  assert.deepEqual(names(await listLinkCompletions('../')), ['Docs/', 'a.png']);
  S.rootPath = 'c:/users/H/NOTES';
  assert.deepEqual(names(await listLinkCompletions('../')), ['Docs/', 'a.png'], 'drive/case differences still count as inside');
  assert.equal(await listLinkCompletions('../../'), null);
});

test('unreadable directory → null, never a throw', async () => {
  assert.equal(await listLinkCompletions('nope/'), null);
});

test('size cap keeps huge folders from flooding the menu', async () => {
  const r = await listLinkCompletions('big/');
  assert.equal(r.entries.length, 60);
  assert.equal(r.entries[0].name, 'f000.png');
});

'use strict';

/* Unit tests for src/sidebar/paths.js — the single definition of how the
   renderer resolves, relativises, encodes and contains paths. Every rule
   here is shared by the preview, the LaTeX export, the link rewriter,
   the link-path autocomplete and the media ingest, so a change that
   breaks one of them breaks this file first. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', 'paths.js')).href;
const P = () => import(MOD_URL);

test('normalizePath: separators, trailing slash, roots', async () => {
  const { normalizePath } = await P();
  assert.equal(normalizePath('C:\\Users\\h\\notes\\'), 'C:/Users/h/notes');
  assert.equal(normalizePath('/home/u/notes/'), '/home/u/notes');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath(null), '');
});

test('dirOf / baseNameOf', async () => {
  const { dirOf, baseNameOf } = await P();
  assert.equal(dirOf('/p/sub/a.png'), '/p/sub');
  assert.equal(dirOf('C:\\p\\a.png'), 'C:/p');
  assert.equal(dirOf('/a.png'), '/');
  assert.equal(dirOf('a.png'), '');
  assert.equal(baseNameOf('/p/sub/a b (1).png'), 'a b (1).png');
  assert.equal(baseNameOf('C:\\p\\a.png'), 'a.png');
});

test('isAbsolutePath / isWindowsPath / hasUrlScheme', async () => {
  const { isAbsolutePath, isWindowsPath, hasUrlScheme } = await P();
  assert.equal(isAbsolutePath('/p/a.png'), true);
  assert.equal(isAbsolutePath('C:/p/a.png'), true);
  assert.equal(isAbsolutePath('c:\\p'), true);
  assert.equal(isAbsolutePath('//server/share/a.png'), true);
  assert.equal(isAbsolutePath('sub/a.png'), false);
  assert.equal(isWindowsPath('C:/p'), true);
  assert.equal(isWindowsPath('//server/share'), true);
  assert.equal(isWindowsPath('/home/u'), false);
  assert.equal(hasUrlScheme('https://x/y.png'), true);
  assert.equal(hasUrlScheme('data:image/png;base64,AA=='), true);
  assert.equal(hasUrlScheme('mailto:x@y.se'), true);
  assert.equal(hasUrlScheme('file:///tmp/a.png'), true);
  assert.equal(hasUrlScheme('C:/p/a.png'), false, 'a drive letter is not a scheme');
  assert.equal(hasUrlScheme('sub/a.png'), false);
});

test('resolvePath: traversal, dots, absolutes, URLs, windows bases', async () => {
  const { resolvePath } = await P();
  assert.equal(resolvePath('/p/notes', 'img.png'), '/p/notes/img.png');
  assert.equal(resolvePath('/p/notes', '../img/x.png'), '/p/img/x.png');
  assert.equal(resolvePath('/p/notes', './a/./b.png'), '/p/notes/a/b.png');
  assert.equal(resolvePath('/p/notes', 'a//b.png'), '/p/notes/a/b.png');
  assert.equal(resolvePath('/', 'a.png'), '/a.png');
  assert.equal(resolvePath('/p', '/abs/x.png'), '/abs/x.png');
  assert.equal(resolvePath('/p', 'https://x/y.png'), 'https://x/y.png');
  assert.equal(resolvePath('C:\\Users\\h\\notes', 'sub\\a.png'), 'C:/Users/h/notes/sub/a.png');
  assert.equal(resolvePath('C:/p', 'D:/other/x.png'), 'D:/other/x.png');
});

test('relativePath: same dir, down, up, root, case-insensitive on windows', async () => {
  const { relativePath } = await P();
  assert.equal(relativePath('/p/notes', '/p/notes/a.png'), 'a.png');
  assert.equal(relativePath('/p/notes', '/p/notes/sub/a.png'), 'sub/a.png');
  assert.equal(relativePath('/p/notes', '/p/img/a.png'), '../img/a.png');
  assert.equal(relativePath('/p/notes/', '/p/notes/a.png'), 'a.png');
  assert.equal(relativePath('/', '/a.png'), 'a.png');
  assert.equal(relativePath('C:\\Users\\h\\notes', 'c:\\users\\H\\Notes\\sub\\a.png'), 'sub/a.png',
    'the drive letter and folder case must never produce ../ chains on Windows');
  assert.equal(relativePath('/p/Notes', '/p/notes/a.png'), '../notes/a.png', 'POSIX stays case-sensitive');
});

test('encodeLinkDest / decodeLinkDest round-trip', async () => {
  const { encodeLinkDest, decodeLinkDest } = await P();
  assert.equal(encodeLinkDest('shot from desk (1).png'), 'shot%20from%20desk%20%281%29.png');
  assert.equal(encodeLinkDest('50%.png'), '50%25.png');
  assert.equal(decodeLinkDest('shot%20from%20desk%20%281%29.png'), 'shot from desk (1).png');
  assert.equal(decodeLinkDest('50%25.png'), '50%.png');
  assert.equal(decodeLinkDest('bad%zz.png'), 'bad%zz.png', 'malformed sequences stay raw');
  for (const name of ['a b.png', '100% (final).png', 'bild-å.png', 'x%20y.png']) {
    assert.equal(decodeLinkDest(encodeLinkDest(name)), name);
  }
});

test('isInsideRoot: equality, children, sibling-prefix attack, windows case, root "/"', async () => {
  const { isInsideRoot } = await P();
  assert.equal(isInsideRoot('/p/notes', '/p/notes'), true);
  assert.equal(isInsideRoot('/p/notes/a.png', '/p/notes'), true);
  assert.equal(isInsideRoot('/p/notes/a.png', '/p/notes/'), true);
  assert.equal(isInsideRoot('/p/notes2/a.png', '/p/notes'), false, 'prefix of a sibling folder is outside');
  assert.equal(isInsideRoot('/p/a.png', '/p/notes'), false);
  assert.equal(isInsideRoot('/anything', '/'), true);
  assert.equal(isInsideRoot('c:/users/h/notes/a.png', 'C:\\Users\\H\\Notes'), true);
  assert.equal(isInsideRoot('/p/Notes/a.png', '/p/notes'), false, 'POSIX stays case-sensitive');
  assert.equal(isInsideRoot('/p/a.png', ''), false);
  assert.equal(isInsideRoot('//?/C:/Users/h/notes/a.png', 'C:/Users/h/notes'), false,
    'a verbatim-prefixed path is not inside a plain root — the backend must strip it');
});

test('mediaLinkMarkdown builds the encoded relative link', async () => {
  const { mediaLinkMarkdown } = await P();
  assert.equal(mediaLinkMarkdown('/p/notes/shot (1).png', '/p/notes'), '![shot (1).png](shot%20%281%29.png)');
  assert.equal(mediaLinkMarkdown('/p/img/a.png', '/p/notes'), '![a.png](../img/a.png)');
  assert.equal(mediaLinkMarkdown('C:\\p\\notes\\a.png', 'C:/p/notes'), '![a.png](a.png)');
  assert.equal(mediaLinkMarkdown('/p/a.png', null), '![a.png](a.png)');
});

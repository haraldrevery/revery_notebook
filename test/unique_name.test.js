'use strict';

/* Unique names for new, renamed, imported and moved files
   (src/sidebar/paths.js uniqueName — used by helpers.uniquePath and
   helpers.uniqueDestPath). */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/sidebar/paths.js');

test('a free name is used exactly as asked', async () => {
  const { uniqueName } = await load();
  assert.equal(uniqueName(['a.md'], 'untitled', '.md'), 'untitled.md');
  assert.equal(uniqueName([], 'x', '.md'), 'x.md');
});

test('taken names count up: _2, _3, …', async () => {
  const { uniqueName } = await load();
  assert.equal(uniqueName(['untitled.md'], 'untitled', '.md'), 'untitled_2.md');
  assert.equal(uniqueName(['untitled.md', 'untitled_2.md'], 'untitled', '.md'), 'untitled_3.md');
});

test('collisions ignore case (Windows/macOS: one file)', async () => {
  const { uniqueName } = await load();
  assert.equal(uniqueName(['Untitled.md'], 'untitled', '.md'), 'untitled_2.md');
  assert.equal(uniqueName(['UNTITLED_2.MD', 'untitled.md'], 'untitled', '.md'), 'untitled_3.md');
});

test('a trailing _<number> is part of the name, never stripped', async () => {
  // Renaming a note to "meeting_2024" used to produce "meeting.md".
  const { uniqueName } = await load();
  assert.equal(uniqueName(['other.md'], 'meeting_2024', '.md'), 'meeting_2024.md');
  assert.equal(uniqueName(['notes_2023.md'], 'notes_2023', '.md'), 'notes_2023_2.md');
});

test('the file being renamed does not block its own new spelling', async () => {
  const { uniqueName } = await load();
  assert.equal(uniqueName(['notes.md'], 'Notes', '.md', 'notes.md'), 'Notes.md', 'case-only rename');
  // …but it hides only itself: a real second file still counts.
  assert.equal(uniqueName(['notes.md', 'Notes.md'], 'Notes', '.md', 'notes.md'), 'Notes_2.md');
});

test('folders (no suffix) and junk entries', async () => {
  const { uniqueName } = await load();
  assert.equal(uniqueName(['img', 'img_2'], 'img'), 'img_3');
  assert.equal(uniqueName([null, undefined, 42, 'a.md'], 'a', '.md'), 'a_2.md');
  assert.equal(uniqueName(undefined, 'a', '.md'), 'a.md');
});

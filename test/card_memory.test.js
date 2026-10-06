'use strict';

/* Which folder the card view showed, per project (src/sidebar/card_memory.js).
   It used to be forgotten at every start — the card view opened at the
   project root while the editor reopened the last note. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/sidebar/card_memory.js');

test('parse: anything malformed is dropped, never thrown', async () => {
  const { parseCardDirs } = await load();
  assert.deepEqual(parseCardDirs('not json'), []);
  assert.deepEqual(parseCardDirs('{"a":1}'), []);
  assert.deepEqual(parseCardDirs('null'), []);
  assert.deepEqual(parseCardDirs(JSON.stringify([
    { root: '/p', dir: '/p/a' },
    { root: '', dir: '/x' },
    { root: '/q' },
    null,
    'str',
    { root: '/r', dir: 5 },
  ])), [{ root: '/p', dir: '/p/a' }]);
});

test('remembered: the folder for that project, only inside it', async () => {
  const { rememberedCardDir } = await load();
  const list = [
    { root: '/home/u/notes', dir: '/home/u/notes/a/b' },
    { root: '/home/u/other', dir: '/home/u/elsewhere' },   // outside its root
    { root: 'C:\\Users\\U\\Notes', dir: 'C:\\Users\\U\\Notes\\Sub' },
  ];
  assert.equal(rememberedCardDir(list, '/home/u/notes'), '/home/u/notes/a/b');
  assert.equal(rememberedCardDir(list, '/home/u/other'), null, 'never a folder outside the project');
  assert.equal(rememberedCardDir(list, '/home/u/NOTES'), null, 'POSIX spellings compare exactly');
  assert.equal(rememberedCardDir(list, 'c:\\users\\u\\notes'), 'C:\\Users\\U\\Notes\\Sub',
    'Windows spellings ignore case');
  assert.equal(rememberedCardDir(list, '/unknown'), null);
  assert.equal(rememberedCardDir(list, null), null);
  assert.equal(rememberedCardDir(null, '/home/u/notes'), null);
});

test('remember: one entry per project, newest first, bounded', async () => {
  const { withCardDir, rememberedCardDir, MAX_REMEMBERED_PROJECTS } = await load();
  let list = [];
  list = withCardDir(list, '/p1', '/p1/a');
  list = withCardDir(list, '/p2', '/p2');
  list = withCardDir(list, '/p1', '/p1/a/b');
  assert.deepEqual(list, [{ root: '/p1', dir: '/p1/a/b' }, { root: '/p2', dir: '/p2' }]);
  assert.equal(rememberedCardDir(list, '/p1'), '/p1/a/b');

  for (let i = 0; i < MAX_REMEMBERED_PROJECTS + 10; i++) list = withCardDir(list, `/q${i}`, `/q${i}/d`);
  assert.equal(list.length, MAX_REMEMBERED_PROJECTS);
  assert.equal(list[0].root, `/q${MAX_REMEMBERED_PROJECTS + 9}`, 'newest first');
  assert.equal(rememberedCardDir(list, '/p1'), null, 'the oldest project is forgotten first');
});

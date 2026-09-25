'use strict';

/* The app's one YAML frontmatter reader (www/jvscrpt_and_css_extra/
   markdown_editor_yaml.js), loaded exactly as it ships — a classic
   script that sets window.ReveryYaml — into a bare context. The sheet,
   the exports and the autocomplete index all read through it, so these
   cases are what every surface shows for a given way of writing YAML. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'jvscrpt_and_css_extra', 'markdown_editor_yaml.js'), 'utf8'), ctx);
const Y = ctx.ReveryYaml;

/* key → { kind, value, warn } for a one-key frontmatter. */
const read = (yml) => {
  const out = {};
  for (const e of Y.readEntries(yml, 0)) out[e.key] = { kind: e.kind, value: JSON.parse(JSON.stringify(e.value)), warn: e.warn || null };
  return out;
};
const one = (yml) => Object.values(read(yml))[0];

test('writing styles of the same value read the same', () => {
  for (const yml of ['author: "Forename_Surname"', "author: 'Forename_Surname'", 'author: Forename_Surname']) {
    assert.deepEqual(one(yml), { kind: 'text', value: 'Forename_Surname', warn: null }, yml);
  }
  const tags = { kind: 'list', value: ['tag_1', 'tag_2', 'tag_3', 'tag_3'], warn: null };
  for (const yml of [
    'tags: [tag_1, tag_2, tag_3, tag_3]',
    'tags: tag_1, tag_2, tag_3, tag_3',          // list key: a plain comma value is the list
    'tags:\n  - tag_1\n  - tag_2\n  - tag_3\n  - tag_3',
    'tags:\n- tag_1\n- tag_2\n- tag_3\n- tag_3',
    'tags: [ "tag_1", \'tag_2\', tag_3,\n  tag_3 ]',
  ]) assert.deepEqual(one(yml), tags, yml);
  assert.deepEqual(one('tags: tag_1'), { kind: 'list', value: ['tag_1'], warn: null });
  assert.deepEqual(one('Categories: a, b'), { kind: 'list', value: ['a', 'b'], warn: null });
});

test('only list keys split a plain comma value', () => {
  assert.deepEqual(one('title: Hello, world'), { kind: 'text', value: 'Hello, world', warn: null });
  assert.deepEqual(one('title: "Hello, world"'), { kind: 'text', value: 'Hello, world', warn: null });
  assert.deepEqual(one('tags: "one, tag"'), { kind: 'text', value: 'one, tag', warn: null }); // quoted: one string
});

test('empty spellings read as empty', () => {
  for (const yml of ['tags:', 'tags: ""', "tags: ''", 'tags: ~', 'tags: null']) {
    assert.equal(one(yml).kind, 'empty', yml);
  }
  assert.deepEqual(one('tags: []'), { kind: 'list', value: [], warn: null });
});

test('block scalars, nested maps, quotes and non-ASCII keys', () => {
  assert.equal(one('summary: |\n  line one\n  line two').value, 'line one\nline two');
  assert.equal(one('summary: >\n  folded one\n  two').value, 'folded one two');
  assert.deepEqual(one('author:\n  name: Harald\n  url: https://example.com'),
    { kind: 'map', value: [['name', 'Harald'], ['url', 'https://example.com']], warn: null });
  assert.equal(one("title: 'It''s mine'").value, "It's mine");
  assert.equal(one('title: "Say \\"hi\\""').value, 'Say "hi"');
  assert.deepEqual(read('författare: Harald'), { 'författare': { kind: 'text', value: 'Harald', warn: null } });
});

test('YAML traps are flagged, ordinary values are not', () => {
  const warn = (yml) => one(yml).warn;
  assert.equal(warn('title:foo'), 'no-space');
  assert.equal(one('title:foo').value, 'foo');
  assert.equal(warn('title: Note: part 2'), 'colon');
  assert.equal(warn('title: Ends with:'), 'colon');
  assert.equal(warn('title: Issue #5'), 'comment-tail');
  assert.equal(warn('tags: #a #b'), 'comment-all');
  assert.equal(warn('title: @handle'), 'symbol');
  assert.equal(warn('title: *bold* text'), 'symbol');
  assert.equal(warn('title: "unclosed'), 'unclosed');
  assert.equal(warn('tags: [a, b'), 'unclosed');
  assert.equal(warn('tags:\n\t- a'), 'tab');
  const dup = Y.readEntries('title: a\ntitle: b', 0);
  assert.equal(dup.map((e) => e.warn).join(), 'duplicate,duplicate');

  for (const yml of [
    'title: "Note: part 2"', "title: 'Issue #5'", 'url: https://example.com/a:b', 'time: 12:30',
    'title: C# tips', 'date: 2026-09-25', 'draft: false', 'title: 100% sure', 'color: "#fff"',
    'tags: [a, "b, c"]', 'summary: |\n  a: b # c', 'author:\n  name: Harald', 'title: plain words',
  ]) assert.equal(warn(yml), null, yml);
});

test('source spans map every entry back to its lines', () => {
  const yml = 'title: T\ntags:\n  - a\n  - b\ndraft: true';
  const [t, g, d] = Y.readEntries(yml, 4);
  assert.equal(('---\n' + yml).slice(t.start, t.end), 'title: T');
  assert.equal(('---\n' + yml).slice(g.start, g.end), 'tags:\n  - a\n  - b');
  assert.equal(('---\n' + yml).slice(d.start, d.end), 'draft: true');
});

test('entryText gives one plain line per value', () => {
  const [tags, author, empty] = Y.readEntries('tags: [a, b]\nauthor:\n  name: H\n  url: x\ne:', 0);
  assert.equal(Y.entryText(tags), 'a, b');
  assert.equal(Y.entryText(author), 'name: H; url: x');
  assert.equal(Y.entryText(empty), '');
  assert.equal(Y.entryText(undefined), '');
});

test('quoteValue quotes exactly what plain YAML cannot hold', () => {
  for (const v of ['alpha', 'Hello, world', 'C# tips', 'https://x.y/a:b', '12:30', '-5', 'two words']) {
    assert.equal(Y.quoteValue(v, false), v, v);
  }
  assert.equal(Y.quoteValue('Note: part 2', false), '"Note: part 2"');
  assert.equal(Y.quoteValue('Issue #5', false), '"Issue #5"');
  assert.equal(Y.quoteValue('#tag', false), '"#tag"');
  assert.equal(Y.quoteValue('@me', false), '"@me"');
  assert.equal(Y.quoteValue('- item', false), '"- item"');
  assert.equal(Y.quoteValue('say "hi"', false), 'say "hi"');
  assert.equal(Y.quoteValue('"quoted"', false), '"\\"quoted\\""');
  assert.equal(Y.quoteValue('Hello, world', true), '"Hello, world"'); // in a list, the comma would split it
  assert.equal(Y.quoteValue('a]b', true), '"a]b"');
  /* Whatever it writes reads back as the value it was given. */
  for (const v of ['Note: part 2', 'Issue #5', 'x "y" z\\', 'Hello, world']) {
    assert.equal(one('title: ' + Y.quoteValue(v, false)).value, v, v);
  }
});

test('the sheet escapes everything and marks traps', () => {
  const html = Y.buildSheetHtml('title: <img src=x onerror=alert(1)>\n"<b>": v\ntitle2: Note: part 2', 4);
  assert.ok(!html.includes('<img') && !html.includes('<b>'), html);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(/class="yaml-row yaml-row-warn"[^>]*>.*title2.*class="yaml-warn"/.test(html), 'trap row carries the marker');
  assert.equal(Y.buildSheetHtml('# only a comment', 4), '');
  const folded = Y.buildSheetHtml('a: 1\nb: 2', 4, { collapsible: true, collapsed: true });
  assert.ok(folded.includes('yaml-collapsed') && folded.includes('aria-expanded="false"') && !folded.includes('yaml-row'));
  assert.ok(!Y.buildSheetHtml('a: 1', 4, { collapsed: true }).includes('yaml-collapsed'), 'only a collapsible sheet folds');
});

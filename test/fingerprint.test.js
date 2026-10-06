'use strict';

/* Text fingerprints (src/sidebar/fingerprint.js). Every crash backup
   records the fingerprint of the disk version its text was edited from;
   start-up recovery compares it with the file to tell "unsaved edits on
   top of this file" (Restore is safe) from "the file changed since"
   (keep both). So the fingerprint must be stable for equal text and
   differ for every kind of change a note can see. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/sidebar/fingerprint.js');

test('equal text → equal fingerprint, in a versioned format', async () => {
  const { textFingerprint, isTextFingerprint } = await load();
  const a = textFingerprint('# Chapter\n\nSome text.\n');
  assert.equal(a, textFingerprint('# Chapter\n\nSome text.\n'));
  assert.match(a, /^v1:\d+:[0-9a-f]{16}$/);
  assert.ok(isTextFingerprint(a));
  assert.equal(a.split(':')[1], String('# Chapter\n\nSome text.\n'.length), 'the length is part of it');
});

test('every kind of change a note can see gives another fingerprint', async () => {
  const { textFingerprint } = await load();
  const base = 'Line one\nLine two\n';
  const variants = [
    'Line one\nLine two',            // trailing newline removed
    'Line one\nLine two\n\n',        // one more newline
    'Line one\r\nLine two\r\n',      // CRLF instead of LF
    '\uFEFFLine one\nLine two\n', // a BOM added
    'Line One\nLine two\n',          // one letter's case
    'Line two\nLine one\n',          // lines swapped (same characters)
    'Line one\nLine tw0\n',          // one character replaced
    'Line one \nLine two\n',         // one space
    '',                              // emptied
    'Line one\nLine two\n😀',        // an astral character
  ];
  const seen = new Set([textFingerprint(base)]);
  for (const v of variants) {
    const fp = textFingerprint(v);
    assert.ok(!seen.has(fp), `collision for ${JSON.stringify(v)}`);
    seen.add(fp);
  }
});

test('no collisions across many similar notes', async () => {
  const { textFingerprint } = await load();
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const fp = textFingerprint(`note ${i}\n` + 'x'.repeat(i % 97));
    assert.ok(!seen.has(fp), `collision at ${i}`);
    seen.add(fp);
  }
});

test('only this version\'s fingerprints are accepted', async () => {
  const { isTextFingerprint } = await load();
  for (const v of [null, undefined, 42, '', 'v1:', 'v2:5:0123456789abcdef', 'v1:5:0123',
                   'v1:x:0123456789abcdef', 'v1:5:0123456789ABCDEF', 'v1:5:0123456789abcdef '] ) {
    assert.equal(isTextFingerprint(v), false, JSON.stringify(v));
  }
  assert.equal(isTextFingerprint('v1:5:0123456789abcdef'), true);
});

test('a large note is fingerprinted quickly and synchronously', async () => {
  const { textFingerprint } = await load();
  const big = 'Lorem ipsum dolor sit amet, ä ö å — 😀\n'.repeat(250000); // ~10 M code units
  const t0 = Date.now();
  const fp = textFingerprint(big);
  const ms = Date.now() - t0;
  assert.match(fp, /^v1:\d+:[0-9a-f]{16}$/);
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.notEqual(fp, textFingerprint(big.slice(0, -1)), 'the last character counts');
});

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSettingsStore } = require('../electron/fs_core.js');

describe('createSettingsStore', () => {
  let dir, file, bakFile, store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-settings-'));
    file = path.join(dir, 'revery_settings.json');
    bakFile = file + '.bak';
    store = createSettingsStore(() => file);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function quarantineFiles() {
    return fs.readdirSync(dir).filter(n => n.includes('.corrupt-'));
  }

  test('absent file reads as empty object', () => {
    assert.deepEqual(store.readSettings(), {});
    assert.equal(store.readSettingsRaw().state, 'absent');
  });

  test('write creates the file and refreshes the .bak with identical bytes', () => {
    store.writeSettings({ a: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
    assert.equal(fs.readFileSync(bakFile, 'utf8'), fs.readFileSync(file, 'utf8'));
    assert.equal(store.readSettingsRaw().state, 'ok');
  });

  test('writes merge with existing keys instead of replacing the file', () => {
    store.writeSettings({ a: 1 });
    store.writeSettings({ b: 2 });
    assert.deepEqual(store.readSettings(), { a: 1, b: 2 });
  });

  test('null values are stored, not dropped (Total Reset wipes keys with null)', () => {
    store.writeSettings({ a: 1, b: 2 });
    store.writeSettings({ a: null });
    assert.deepEqual(store.readSettings(), { a: null, b: 2 });
  });

  test('corrupt main + valid .bak: reads recover from .bak', () => {
    store.writeSettings({ a: 1, b: 2 });          // also creates .bak
    fs.writeFileSync(file, 'NOT { JSON');
    assert.deepEqual(store.readSettings(), { a: 1, b: 2 });
    assert.equal(store.readSettingsRaw().state, 'corrupt');
  });

  test('corrupt main + valid .bak: write merges onto .bak base and quarantines', () => {
    store.writeSettings({ a: 1, b: 2 });
    fs.writeFileSync(file, 'NOT { JSON');
    store.writeSettings({ c: 3 });
    assert.deepEqual(store.readSettings(), { a: 1, b: 2, c: 3 });
    const q = quarantineFiles();
    assert.equal(q.length, 1, 'corrupt bytes must be quarantined, not deleted');
    assert.equal(fs.readFileSync(path.join(dir, q[0]), 'utf8'), 'NOT { JSON');
  });

  test('zero-byte main file is treated as corrupt and recovered from .bak', () => {
    store.writeSettings({ a: 1 });
    fs.writeFileSync(file, '');
    assert.deepEqual(store.readSettings(), { a: 1 });
  });

  test('JSON array in main file is treated as corrupt', () => {
    store.writeSettings({ a: 1 });
    fs.writeFileSync(file, '[1,2,3]');
    assert.equal(store.readSettingsRaw().state, 'corrupt');
    assert.deepEqual(store.readSettings(), { a: 1 }); // from .bak
  });

  test('corrupt main + corrupt .bak: reads fall back to empty, write starts fresh', () => {
    fs.writeFileSync(file, '###');
    fs.writeFileSync(bakFile, 'also broken');
    assert.deepEqual(store.readSettings(), {});
    store.writeSettings({ x: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 1 });
    assert.equal(quarantineFiles().length, 1);
  });

  test('no temp files are left behind after writes', () => {
    store.writeSettings({ a: 1 });
    store.writeSettings({ b: 2 });
    const leftovers = fs.readdirSync(dir).filter(
      n => n.includes('.revery_settings_tmp') || n.includes('.bak_tmp')
    );
    assert.deepEqual(leftovers, []);
  });
});

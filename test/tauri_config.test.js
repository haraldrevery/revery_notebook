'use strict';

/* Pins the per-platform file-drop transport to the Tauri configuration.
   Windows Tauri needs dragDropEnabled:false — with it on, wry replaces
   WebView2's OLE drop target and swallows every HTML5 drag inside the
   page (sidebar→editor links, drag-to-move). Linux/macOS keep the native
   event because WebKitGTK cannot read dropped File bytes. The runtime rule
   (src/sidebar/drop_transport.js) must agree with the config, and the
   Windows override must mirror the base window exactly except for that
   flag: Tauri merges platform files with RFC 7396, which replaces the
   whole `windows` array, so the override has to restate the window. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TAURI = path.join(__dirname, '..', 'tauri');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(TAURI, f), 'utf8'));
const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', 'drop_transport.js')).href;

test('windows override mirrors the base main window except dragDropEnabled', () => {
  const base = readJson('tauri.conf.json').app.windows;
  const win  = readJson('tauri.windows.conf.json').app.windows;
  assert.equal(base.length, 1);
  assert.equal(win.length, 1);
  const strip = (w) => { const { dragDropEnabled, ...rest } = w; void dragDropEnabled; return rest; };
  assert.deepEqual(strip(win[0]), strip(base[0]), 'edit both files when the main window changes');
  assert.equal(base[0].dragDropEnabled, true,  'Linux/macOS: wry native drop stays on');
  assert.equal(win[0].dragDropEnabled,  false, 'Windows: WebView2 must own drag-and-drop');
});

test('drop transport follows the config: dom wherever wry drag-drop is off', async () => {
  const { decideFileDropTransport } = await import(MOD_URL);
  const base = readJson('tauri.conf.json').app.windows[0];
  const win  = readJson('tauri.windows.conf.json').app.windows[0];
  const expected = (dragDropEnabled) => (dragDropEnabled ? 'native' : 'dom');
  assert.equal(decideFileDropTransport('tauri', 'Win32'),        expected(win.dragDropEnabled));
  assert.equal(decideFileDropTransport('tauri', 'Linux x86_64'), expected(base.dragDropEnabled));
  assert.equal(decideFileDropTransport('tauri', 'MacIntel'),     expected(base.dragDropEnabled));
  assert.equal(decideFileDropTransport('electron', 'Win32'), 'dom');
  assert.equal(decideFileDropTransport('electron', 'Linux x86_64'), 'dom');
  assert.equal(decideFileDropTransport('web', 'Linux x86_64'), 'dom');
  assert.equal(decideFileDropTransport('tauri', undefined), 'native', 'unknown platform stays on the documented default');
});

test('isOsFileDrop recognises Chromium and WebKitGTK drop shapes', async () => {
  const { isOsFileDrop } = await import(MOD_URL);
  assert.equal(isOsFileDrop({ files: { length: 1 }, types: ['Files'] }), true);
  assert.equal(isOsFileDrop({ files: { length: 0 }, types: ['Files'] }), true);
  assert.equal(isOsFileDrop({
    files: { length: 0 }, types: ['text/uri-list', 'text/plain'],
    getData: (t) => (t === 'text/uri-list' ? 'file:///home/u/a.png\r\n' : ''),
  }), true);
  assert.equal(isOsFileDrop({ files: { length: 0 }, types: ['text/plain'], getData: () => '![a](a.png)' }), false);
  assert.equal(isOsFileDrop({ files: { length: 0 }, types: ['text/uri-list'], getData: () => 'https://example.com/' }), false);
  assert.equal(isOsFileDrop(null), false);
});

'use strict';

/* Pins the per-platform file-drop transport to the Tauri configuration.
   Windows Tauri needs dragDropEnabled:false — with it on, wry replaces
   WebView2's OLE drop target and swallows every HTML5 drag inside the
   page (sidebar→editor links, drag-to-move). Linux/macOS keep the native
   event because WebKitGTK cannot read dropped File bytes. The runtime rule
   (src/sidebar/drop_transport.js) must agree with the config, and the
   Windows override must mirror the base window exactly except for that
   flag: Tauri merges platform files with RFC 7396, which replaces the
   whole `windows` array, so the override has to restate the window.

   The files alone are not the build: the CLI forwards every `--config`
   argument as TAURI_CONFIG, and tauri-build / tauri-codegen merge it AFTER
   the platform file. `tauri build --config tauri/tauri.conf.json` therefore
   re-applied the base window over the Windows override and shipped
   dragDropEnabled:true — so the npm scripts are evaluated here too. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const TAURI = path.join(ROOT, 'tauri');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(TAURI, f), 'utf8'));
const MOD_URL = pathToFileURL(path.join(ROOT, 'src', 'sidebar', 'drop_transport.js')).href;

/* RFC 7396 merge patch — what json_patch::merge does in tauri-build and
   tauri-codegen (objects merge key by key; arrays and scalars replace). */
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/* The `--config` / `-c` values of one tauri CLI command line: paths
   (relative to the repo root, where npm runs) or inline JSON. */
function configArgs(script) {
  const argv = script.trim().split(/\s+/);
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    let v = null;
    if (argv[i] === '--config' || argv[i] === '-c') v = argv[++i];
    else if (argv[i].startsWith('--config=')) v = argv[i].slice('--config='.length);
    if (v == null) continue;
    const file = path.join(ROOT, v);
    try {
      values.push(JSON.parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : v));
    } catch (err) {
      assert.fail(`cannot evaluate --config ${v} in "${script}" — teach this test to read it (${err.message})`);
    }
  }
  return values;
}

test('the npm tauri scripts build the per-platform window the config files describe', () => {
  const scripts = Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts)
    .filter(([, s]) => /\btauri\s+(build|dev)\b/.test(s));
  assert.ok(scripts.length >= 2, 'expected the start:tauri and build:tauri scripts');
  const base = readJson('tauri.conf.json');
  const win  = readJson('tauri.windows.conf.json');
  const mainWindow = (cfg) => cfg.app.windows.find((w) => w.label === 'main');
  for (const [name, script] of scripts) {
    const extra = configArgs(script);
    /* tauri-codegen get_config: tauri.conf.json → platform file → TAURI_CONFIG */
    const effective = (platformFile) => extra.reduce(mergePatch, platformFile ? mergePatch(base, platformFile) : base);
    assert.equal(mainWindow(effective(win)).dragDropEnabled, false,
      `${name} ("${script}"): a --config merged after tauri.windows.conf.json replaces its windows array — `
      + 'wry would own the Windows drop target and swallow every HTML5 drag in the page');
    assert.equal(mainWindow(effective(null)).dragDropEnabled, true,
      `${name} ("${script}"): Linux/macOS need the native drop event`);
  }
});

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

test('sidebar drag payload carries every dragged file in order', async () => {
  const { encodeSidebarPayload, decodeSidebarPayload } = await import(MOD_URL);
  const paths = ['/p/sub/a one.png', 'C:\\p\\b[1].png', '/p/"q".png'];
  assert.deepEqual(decodeSidebarPayload(encodeSidebarPayload(paths)), paths);
  assert.deepEqual(decodeSidebarPayload(encodeSidebarPayload([])), []);
  assert.deepEqual(decodeSidebarPayload('/p/sub/pic.png'), ['/p/sub/pic.png'], 'a bare path is one item');
  assert.deepEqual(decodeSidebarPayload(''), []);
  assert.deepEqual(decodeSidebarPayload('[not json'), []);
  assert.deepEqual(decodeSidebarPayload('["/a.png", 3, null, ""]'), ['/a.png']);
});

/* drop_transport.js — which channel delivers OS file drops on this platform.
   Pure module (no DOM at import time) so the rule is unit-testable and
   pinned to the Tauri configuration by test/tauri_config.test.js.

   'dom'    HTML5 drop events carry File objects whose bytes are readable:
            Electron everywhere, and Tauri on Windows — where
            tauri/tauri.windows.conf.json sets dragDropEnabled:false. With
            that flag on, wry replaces WebView2's OLE drop target, so NO
            HTML5 drag-and-drop of any kind reaches the page on Windows;
            that is what broke sidebar→editor links and drag-to-move there.
   'native' The wrapper's drag-drop event carries absolute source paths:
            Tauri on Linux/macOS, where WebKitGTK cannot read dropped File
            bytes. WebKitGTK still fires the DOM drop for the same gesture,
            so on this transport the DOM listeners swallow OS file drops
            (or CodeMirror inserts a file:// URL) and copy nothing.

   Exactly one channel copies files; the other only prevents defaults. */

export function decideFileDropTransport(env, platform) {
  if (env !== 'tauri') return 'dom';
  return /^win/i.test(String(platform || '')) ? 'dom' : 'native';
}

/** The transport for this session. Evaluated at call time, never at
    import time, so the module stays inert in web mode and in node. */
export function fileDropTransport() {
  const env = window.NativeAPI ? window.NativeAPI.env : 'web';
  return decideFileDropTransport(env, navigator.platform);
}

/** True when a DOM drop carries OS files. Chromium exposes File objects;
    WebKitGTK may expose only the 'Files' type or file: URIs in
    text/uri-list — all three shapes count. */
export function isOsFileDrop(dt) {
  if (!dt) return false;
  if (dt.files && dt.files.length) return true;
  const types = Array.from(dt.types || []);
  if (types.includes('Files')) return true;
  if (types.includes('text/uri-list')) {
    let list = '';
    try { list = dt.getData('text/uri-list') || ''; } catch (_) { /* protected mode */ }
    return /^file:/im.test(list);
  }
  return false;
}

/** DataTransfer type set by the sidebar's dragstart (tree rows and cards)
    carrying the dragged files' absolute paths, so the editor can recognise
    its own rows on drop. text/plain still carries the markdown for
    external targets. */
export const SIDEBAR_ITEM_MIME = 'application/x-revery-path';

/** SIDEBAR_ITEM_MIME payload: every dragged file, in tree order, as a JSON
    array — a multi-selection travels as one drag. A bare path decodes as
    a single item; anything malformed decodes as nothing. */
export function encodeSidebarPayload(paths) {
  return JSON.stringify(paths);
}

export function decodeSidebarPayload(raw) {
  if (!raw) return [];
  if (raw[0] !== '[') return [raw];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && p) : [];
  } catch (_) {
    return [];
  }
}

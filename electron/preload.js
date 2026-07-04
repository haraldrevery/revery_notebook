/**
 * electron/preload.js — Revery Notebook Electron Preload Script
 *
 * Runs in an isolated world (contextIsolation: true). Uses contextBridge
 * to safely expose exactly the IPC surface that native_api.js needs as
 * `window.electronAPI`. NO Node.js APIs leak into the renderer.
 *
 * Naming convention:
 *   ipcMain channel       → 'namespace:action-name'  (kebab-case)
 *   contextBridge method  → camelCase matching NativeAPI method names
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setRootPath: (dirPath) =>
    ipcRenderer.invoke('fs:set-root-path', dirPath),

  /* ── Folder dialog ──────────────────────────────────────────────── */
  openFolderDialog: () =>
    ipcRenderer.invoke('dialog:open-folder'),

  /* ── File system ────────────────────────────────────────────────── */
  readDirectory: (dirPath) =>
    ipcRenderer.invoke('fs:read-directory', dirPath),

  readFile: (filePath) =>
    ipcRenderer.invoke('fs:read-file', filePath),

  writeFile: (filePath, content) =>
    ipcRenderer.invoke('fs:write-file', filePath, content),

  createFile: (filePath) =>
    ipcRenderer.invoke('fs:create-file', filePath),

  createDirectory: (dirPath) =>
    ipcRenderer.invoke('fs:create-directory', dirPath),

  renameNode: (oldPath, newPath) =>
    ipcRenderer.invoke('fs:rename-node', oldPath, newPath),

  deleteNode: (targetPath) =>
    ipcRenderer.invoke('fs:delete-node', targetPath),

  copyFileIntoFolder: (destDir, filename, contentB64) =>
    ipcRenderer.invoke('fs:copy-into-folder', destDir, filename, contentB64),

  setVolatileContent: (originalPath, content) =>
    ipcRenderer.invoke('fs:set-volatile-content', originalPath, content),

  getVolatileContent: (originalPath) =>
    ipcRenderer.invoke('fs:get-volatile-content', originalPath),

  deleteVolatileContent: (originalPath) =>
    ipcRenderer.invoke('fs:delete-volatile-content', originalPath),

  getVolatileStatus: () =>
    ipcRenderer.invoke('fs:get-volatile-status'),

  listVolatileBackups: (prefix) =>
    ipcRenderer.invoke('fs:list-volatile-backups', prefix),
  /* ── Dialogs ────────────────────────────────────────────────────── */
  showMessageBox: (options) =>
    ipcRenderer.invoke('dialog:show-message-box', options),

  /* Triggers a native OS Save-As dialog, writes the file, and returns
     { saved: true } on success or { saved: false } if the user cancelled. */

  saveFile: (defaultFilename, content, options) =>
    ipcRenderer.invoke('dialog:save-file', defaultFilename, content, options),

  /* ── Window lifecycle ───────────────────────────────────────────── */
  /**
   * Registers a one-time callback that fires when the OS window-close
   * button is clicked. The callback should show the quit-confirmation UI
   * and eventually call confirmClose() if the user agrees.
   * Multiple calls to onWindowClose replace the previous listener.
   */
  onWindowClose: (callback) => {
    /* Remove any previously registered listener to avoid stacking */
    ipcRenderer.removeAllListeners('window:close-request');
    ipcRenderer.on('window:close-request', () => callback());
  },

  confirmClose: () =>
    ipcRenderer.invoke('window:confirm-close'),

  /* ── Frameless window controls ──────────────────────────────────── */
  /** Minimize the window to the taskbar / dock. */
  minimizeWindow: () =>
    ipcRenderer.invoke('window:minimize'),

  /** Toggle between maximized and restored. */
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('window:toggle-maximize'),

  /** Export the whole project folder as a .zip (save dialog lives in main). */
  exportProjectZip: () =>
    ipcRenderer.invoke('project:export-zip'),

/**
   * Request a close.  Triggers the existing 'window:close-request' flow
   * so the quit-confirmation modal appears — same as clicking the OS button.
   */
  closeWindow: () =>
    ipcRenderer.invoke('window:close'),

  setFullscreen: (fullscreen) =>
    ipcRenderer.invoke('window:set-fullscreen', fullscreen),

  /* ── File watcher ───────────────────────────────────────────────── */
  /**
   * watchFile(path, callback)
   * callback is invoked with (eventType: string, path: string)
   * when main.js detects a change on `path`.
   * Replaces any previous listener for this path.
   */
  watchFile: (filePath, callback) => {
    ipcRenderer.removeAllListeners('fs:file-changed');
    ipcRenderer.on('fs:file-changed', (_event, payload) => {
      if (payload.path === filePath) {
        callback(payload.eventType, payload.path);
      }
    });
    return ipcRenderer.invoke('fs:watch-file', filePath);
  },

  unwatchFile: (filePath) =>
    ipcRenderer.invoke('fs:unwatch-file', filePath),

  /* ── Last opened file pointer ───────────────────────────────────── */
  getLastOpenedFile: () =>
    ipcRenderer.invoke('settings:get-last-opened-file'),

  setLastOpenedFile: (filePath) =>
    ipcRenderer.invoke('settings:set-last-opened-file', filePath),

  getPendingRename: () =>
    ipcRenderer.invoke('settings:get-pending-rename'),

  setPendingRename: (journal) =>
    ipcRenderer.invoke('settings:set-pending-rename', journal),

  clearAllSettings: () =>
    ipcRenderer.invoke('settings:clear-all'),

  getLastRootPath: () =>
    ipcRenderer.invoke('settings:get-last-root-path'),
  
  setLastRootPath: (dirPath) =>
    ipcRenderer.invoke('settings:set-last-root-path', dirPath),

  getProjectHistory: () =>
    ipcRenderer.invoke('settings:get-project-history'),

  setProjectHistory: (arr) =>
    ipcRenderer.invoke('settings:set-project-history', arr),

  /* ── App info ───────────────────────────────────────────────────── */
  getAppDataPath: () =>
    ipcRenderer.invoke('app:get-data-path'),

  getDefaultNotesFolder: () =>
    ipcRenderer.invoke('app:get-default-notes-folder'),

  showInFolder: (itemPath) =>
    ipcRenderer.invoke('shell:show-in-folder', itemPath),
});

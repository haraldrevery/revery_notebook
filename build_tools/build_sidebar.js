// build_sidebar.js
// Run: node build_tools/build_sidebar.js   (or: npm run build:sidebar)
// Bundles src/sidebar/index.js → www/jvscrpt_and_css_extra/project_sidebar.js
// as a single classic script, so the HTML keeps loading exactly one file.

const esbuild = require('esbuild');
const path    = require('path');

const BANNER = `/**
 * project_sidebar.js — GENERATED FILE, DO NOT EDIT DIRECTLY.
 * Source modules: src/sidebar/   Build: npm run build:sidebar
 *
 * Revery Notebook Project File Sidebar (Obsidian/Logseq-style file management).
 * Exposes on window: sidebarSaveActiveFile, sidebarGetActiveFilePath,
 * sidebarGetRootPath, sidebarPivotToNewFile, sidebarCreateNewFile,
 * sidebarImportFile, sidebarHandleClose.
 */`;

esbuild.build({
  entryPoints: [path.join(__dirname, '..', 'src', 'sidebar', 'index.js')],
  bundle:      true,
  format:      'iife',
  outfile:     path.join(__dirname, '..', 'www', 'jvscrpt_and_css_extra', 'project_sidebar.js'),
  minify:      false,      // keep the shipped file readable/debuggable
  platform:    'browser',
  target:      ['es2020'],
  banner:      { js: BANNER },
  logLevel:    'info',
}).then(() => {
  console.log('\n✓ project_sidebar.js bundled from src/sidebar/.');
}).catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

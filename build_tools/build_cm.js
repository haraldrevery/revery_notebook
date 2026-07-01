// build_cm.js
// Run: node build_cm.js
// Output: codemirror-bundle.js  (expose as global CM.*)
// Then copy codemirror-bundle.js to your jvscrpt_and_css_extra/ directory.

const esbuild = require('esbuild');
const path    = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, 'cm_entry_slim.js')],
  bundle:      true,
  format:      'iife',
  globalName:  'CM',
  outfile:     path.join(__dirname, 'codemirror-bundle.js'),
  minify:      true,
  platform:    'browser',
  target:      ['es2020'],
  logLevel:    'info',
}).then(() => {
  console.log('\n✓ codemirror-bundle.js built successfully.');
  console.log('  → Copy it to:  /revery_notebook/jvscrpt_and_css_extra/codemirror-bundle.js\n');
}).catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

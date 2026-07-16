// build_css.js
// Run: node build_tools/build_css.js   (or: npm run build:css)
// One-shot Tailwind builds of the shipped stylesheets:
//   www/css_aesthetics/input.css       → www/main_rn.css   (minified, shipped)
//                                      → www/css_aesthetics/main_max.css  (debug twin)
//   www/css_aesthetics/input_prose.css → www/prose_rn.css  (minified, shipped)
//                                      → www/css_aesthetics/prose_max.css (debug twin)
// Sources scanned for class names are declared with @source inside the
// input files themselves (automatic detection is disabled there with
// `source(none)`), so builds are deterministic.
// Always commit the inputs and the regenerated outputs together.

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW  = path.join(ROOT, 'www');
const TW   = path.join(__dirname,
  process.platform === 'win32' ? 'tw.exe' : 'tailwindcss-linux-x64');

if (!fs.existsSync(TW)) {
  console.error(`Tailwind binary not found at ${TW}`);
  console.error('Download the standalone CLI for your platform from');
  console.error('https://github.com/tailwindlabs/tailwindcss/releases');
  console.error('and place it in build_tools/ (it is gitignored).');
  process.exit(1);
}

const JOBS = [
  ['css_aesthetics/input.css',       'main_rn.css',                  true ],
  ['css_aesthetics/input.css',       'css_aesthetics/main_max.css',  false],
  ['css_aesthetics/input_prose.css', 'prose_rn.css',                 true ],
  ['css_aesthetics/input_prose.css', 'css_aesthetics/prose_max.css', false],
];

for (const [input, output, minify] of JOBS) {
  const args = ['-i', input, '-o', output];
  if (minify) args.push('--minify');
  execFileSync(TW, args, { cwd: WWW, stdio: 'inherit' });
  console.log(`✓ ${output}`);
}

console.log('\n✓ CSS rebuilt from css_aesthetics/. Commit inputs + outputs together.');

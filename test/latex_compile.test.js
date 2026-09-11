'use strict';

/* The LaTeX export must COMPILE, not merely look right: builds every
   document in helpers/latex_cases.js through the real exporter (web-mode
   Electron, like find_e2e) and runs pdflatex on each. This is the test
   that catches raw "## " or "&" reaching TeX, false math spans, footnotes
   in headings, [bracket] list items, too-deep nesting and Unicode that
   inputenc cannot encode. Skipped without a display server or pdflatex. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { CASES } = require('./helpers/latex_cases.js');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');
const hasPdflatex = (() => { try { return spawnSync('pdflatex', ['--version']).status === 0; } catch (_) { return false; } })();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

test('LaTeX export compiles under pdflatex for every tricky document', { skip: !hasDisplay || !hasPdflatex, timeout: 300000 }, async () => {
  const electronBin = require('electron');
  const mainScript = path.join(__dirname, 'helpers', 'web_e2e_main.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-latex-'));
  const driverPath = path.join(tmp, 'driver.js');
  fs.writeFileSync(driverPath,
    fs.readFileSync(path.join(__dirname, 'helpers', 'latex_cases_driver.js'), 'utf8')
      .replace('__CASES__', () => JSON.stringify(CASES))); // function form: JSON may contain $-patterns

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript, driverPath, '60000'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`electron exited ${code}\n${out}`))));
  });
  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const built = JSON.parse(line.slice('E2E-RESULT: '.length));
  assert.deepEqual(Object.keys(built).sort(), Object.keys(CASES).sort(), 'every case must build');

  const failures = [];
  for (const [name, tex] of Object.entries(built)) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'main.tex'), tex);
    fs.writeFileSync(path.join(dir, 'pic.png'), PNG); // the figure case references it
    const res = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'main.tex'], { cwd: dir, timeout: 90000 });
    if (res.status !== 0) {
      let err = `exit ${res.status}`;
      try { err = (fs.readFileSync(path.join(dir, 'main.log'), 'utf8').match(/^!.*$/m) || [err])[0]; } catch (_) { /* no log */ }
      failures.push(`${name}: ${err}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(failures, [], 'pdflatex must accept the export of every case');
});

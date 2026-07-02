'use strict';

/* E2E check for the worker-based regex search: spawns the real Electron
   binary with test/helpers/find_e2e_main.js, which loads www/index.html
   and drives the actual find bar. Verifies the three properties Stage 5
   promised:
     1. safe patterns the old heuristic rejected (e.g. `(alpha|beta)`) work;
     2. a catastrophic pattern is aborted by the worker timeout without
        freezing the page;
     3. the worker is rebuilt afterwards and Replace All (incl. `$&`
        substitution) runs through it.
   Skipped when no display server is available. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('find/replace regex worker end-to-end', { skip: !hasDisplay, timeout: 60000 }, async () => {
  const electronBin = require('electron'); // path string under plain node
  const mainScript  = path.join(__dirname, 'helpers', 'find_e2e_main.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VSCode terminals leak this; it breaks require('electron') in the child

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`electron exited ${code}\n${out}`));
    });
  });

  assert.match(output, /\[Find\] Regex search worker ready\./,
    'the worker must actually construct in Electron — otherwise the sync fallback silently took over');

  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));

  // 1. (alpha|beta) on 'alpha beta gamma alpha beta' → 4 matches, "1 / 4"
  assert.equal(r.safeCount, 4, 'heuristic-rejected pattern must now find its matches');
  assert.match(r.safeLabel, /4/);

  // 2. catastrophic pattern: aborted (0 matches), page alive, took ≥ timeout
  assert.equal(r.redosCount, 0);
  assert.ok(r.redosElapsed >= 1400, `expected to wait out the worker timeout, elapsed ${r.redosElapsed}ms`);

  // 3. fresh worker afterwards: [a-z]\d on 'x1 y2 z3' → 3 matches
  assert.equal(r.recoveredCount, 3, 'worker must be rebuilt after a timeout kill');

  // 4. Replace All through the worker with $& substitution
  assert.equal(r.replacedText, '<x1> <y2> <z3>');

  // 5. closing the bar mid-flight invalidates the search — no ghost results
  assert.equal(r.ghostCount, 0, 'in-flight result must not apply after closeFindBar');
  assert.equal(r.barHidden, true);

  // 6. superseding a catastrophic search gets a fresh worker immediately
  assert.equal(r.supersededCount, 4, 'search after superseding must not queue behind the old job');
});

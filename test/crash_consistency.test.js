'use strict';

/* Crash-consistency test for atomicWriteFile.
 *
 * A child process rewrites the same file in a tight loop (payload A ↔ B,
 * ~1.5 MB each, fsync'd). The parent SIGKILLs it at a random moment and then
 * checks the invariant the whole save path is built on:
 *
 *   after a hard crash, the target file contains EXACTLY one complete
 *   payload — never a truncated, empty, or interleaved mix.
 *
 * SIGKILL at a random point in the write loop lands inside writeSync/fsync/
 * rename often enough across the iterations to exercise every window.
 * Leftover *.revery_tmp files ARE expected after a kill (cleanup code never
 * ran) — they are droppings, not corruption; the renderer never reads them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makePayload } = require('./helpers/payload.js');

const WRITER = path.join(__dirname, 'helpers', 'crash_writer.js');
const SIZE = 1.5 * 1024 * 1024;
const ITERATIONS = 12;

const payloadA = makePayload('A', SIZE);
const payloadB = makePayload('B', SIZE);

function spawnWriter(target) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRITER, '--crash-writer', target, String(SIZE)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('started')) resolve(child);
    });
    child.once('exit', (code) => {
      reject(new Error(`crash_writer exited early (code ${code}) — it should run until killed`));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test(`target file survives ${ITERATIONS} SIGKILLs mid-write intact`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revery-crash-'));
  const target = path.join(dir, 'note.md');

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const child = await spawnWriter(target);
      // Random kill delay: spans several full write cycles, so the SIGKILL
      // lands at a different phase of write→fsync→rename every iteration.
      await sleep(20 + Math.random() * 150);
      child.removeAllListeners('exit'); // the early-exit guard no longer applies
      child.kill('SIGKILL');
      await new Promise((r) => child.once('exit', r));

      const content = fs.readFileSync(target, 'utf8');
      const intact = content === payloadA || content === payloadB;
      assert.ok(
        intact,
        `iteration ${i}: target is neither payload A nor B ` +
        `(length ${content.length}, expected ${payloadA.length}) — ` +
        `file was truncated or interleaved by the crash`
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

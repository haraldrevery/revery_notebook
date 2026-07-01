'use strict';

/* Child process for the crash-consistency test. Writes alternating payloads
   to the target file in a tight loop via atomicWriteFile until the parent
   SIGKILLs it. The parent then verifies the target contains exactly one
   complete payload — never a truncated or interleaved mix.

   Guard: node's test runner executes every .js file under test/, so bail out
   immediately unless invoked with the explicit marker argument. */

if (process.argv[2] !== '--crash-writer') {
  process.exit(0);
}

const target = process.argv[3];
const sizeBytes = parseInt(process.argv[4], 10);
if (!target || !Number.isFinite(sizeBytes)) {
  console.error('usage: node crash_writer.js --crash-writer <target> <sizeBytes>');
  process.exit(2);
}

const { atomicWriteFile } = require('../../electron/fs_core.js');
const { makePayload } = require('./payload.js');

const payloadA = makePayload('A', sizeBytes);
const payloadB = makePayload('B', sizeBytes);

/* First write completes before we tell the parent we're running, so the
   parent always has a valid baseline file to check against. */
atomicWriteFile(target, payloadA);
process.stdout.write('started\n');

let flip = false;
for (;;) {
  atomicWriteFile(target, flip ? payloadA : payloadB);
  flip = !flip;
}

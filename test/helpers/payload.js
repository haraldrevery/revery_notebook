'use strict';

/* Shared between crash_writer.js (child) and the crash-consistency test
   (parent) so both sides agree byte-for-byte on what a complete payload
   looks like. Header and footer let a corrupted file fail fast, the exact
   length + body fill catch truncation and interleaving. */
function makePayload(tag, sizeBytes) {
  const header = `<<<START:${tag}>>>\n`;
  const footer = `\n<<<END:${tag}>>>`;
  const bodyLen = Math.max(0, sizeBytes - header.length - footer.length);
  return header + tag.repeat(bodyLen) + footer;
}

module.exports = { makePayload };

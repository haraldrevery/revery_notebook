'use strict';

/* Desktop E2E for the media workflow: boots the REAL Electron main
   (preload, IPC, path validation, atomic writes) on a temporary project
   and drives real DragEvent / ClipboardEvent drops through the editor.
   Pins the properties the media rewrite promised:
     1. an OS image dropped on the editor is copied next to the active note,
        exactly one percent-encoded link is inserted, the preview resolves it;
     2. a non-media OS file is never copied into the project;
     3. a sidebar row's payload inserts exactly one link (no double insert
        from CodeMirror's own drop handler), cursor collapsed after it;
     4. clicking an image in a subfolder previews it without creating a file;
     5. a drop while previewing puts the media NEXT TO the note that the
        drop creates, and every link in that note resolves from its folder
        (destination and link base agree);
     6. pasting a screenshot works the same way;
     7. typing afterwards reaches disk through the normal autosave path;
     8. no native dialog was needed at any point;
     9. in live preview, a drop on a rendered block goes in as its own
        paragraph after the source line under the pointer (after a whole
        code fence, never inside it);
     10. in card view the media card owns the drag — its thumbnail <img> is
        not draggable, so grabbing the picture carries the card payload.
   Skipped when no display server is available (same rule as find_e2e). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('media drop/paste/preview end-to-end in the real Electron app', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const electronBin = require('electron'); // path string under plain node
  const mainScript  = path.join(__dirname, 'helpers', 'media_e2e_main.js');

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

  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));
  const why = JSON.stringify(r, null, 2);

  assert.equal(r.booted, true, 'desktop boot must restore the seeded project and note\n' + why);

  // 1. OS image drop
  assert.equal(r.osDrop.linkInserted, true, why);
  assert.equal(r.osDrop.linkCount, 1, 'exactly one link per dropped image\n' + why);
  assert.equal(r.osDrop.fileCopied, true, why);
  assert.equal(r.osDrop.noStrayText, true, 'no file:// URL or verbatim prefix may leak into the note\n' + why);
  assert.equal(r.osDrop.previewResolved, true, 'preview must resolve the encoded relative link\n' + why);

  // 2. non-media file
  assert.equal(r.txtDrop.notCopied, true, why);
  assert.equal(r.txtDrop.editorUnchanged, true, 'the editor takes images only; other files are left to the file panel\n' + why);

  // 3. sidebar payload
  assert.equal(r.sidebarDrop.inserted, true, why);
  assert.equal(r.sidebarDrop.linkCount, 1, 'sidebar drag must insert the link exactly once\n' + why);
  assert.equal(r.sidebarDrop.selectionCollapsed, true, why);
  assert.equal(r.sidebarDrop.noStrayText, true, why);

  // 4. media click in a subfolder
  assert.equal(r.mediaPreview.rowFound, true, why);
  assert.equal(r.mediaPreview.editorText, '![pic.png](pic.png)', why);
  assert.equal(r.mediaPreview.activeIsNull, true, why);
  assert.equal(r.mediaPreview.previewResolvedToSubfolder, true, 'preview base must be the folder the note will be created in\n' + why);
  assert.equal(r.mediaPreview.noteNotCreatedYet, true, why);
  assert.equal(r.mediaPreview.rowHighlighted, true, why);

  // 5. destination/link-base coherence
  assert.equal(r.coherence.noteCreated, true, why);
  assert.equal(r.coherence.notePath, '<project>/sub/pic.md', 'the note takes the image name, next to the image\n' + why);
  assert.equal(r.coherence.mediaNextToNote, true, 'dropped media must land in the note\'s own folder\n' + why);
  assert.equal(r.coherence.allLinksResolve, true, 'every link in the new note must resolve from its folder\n' + why);
  assert.equal(r.coherence.linkCount, 1, why);
  assert.equal(r.coherence.contentMatchesDisk, true, why);

  // 6. paste
  assert.equal(r.paste.linkInserted, true, why);
  assert.equal(r.paste.fileCreated, true, why);
  assert.equal(r.paste.allLinksResolve, true, why);

  // 7. autosave still flows
  assert.equal(r.autosave.savedAfterTyping, true, why);

  // 8. no dialogs
  assert.deepEqual(r.dialogs, [], 'no native dialog may be needed for a normal media flow\n' + why);

  // 9. link-path completion (desktop wiring: bundle feed + IPC + editor source)
  assert.equal(r.linkComplete.opened, true, 'typing inside ![](…) must open the path menu\n' + why);
  assert.deepEqual(r.linkComplete.firstLabels, ['sub/'], '`..` climbs to the root; only the matching folder is offered\n' + why);
  assert.equal(r.linkComplete.glyph, true, 'rows carry the app icon glyph\n' + why);
  assert.equal(r.linkComplete.fontMatches, true, 'the menu must inherit the editor font\n' + why);
  assert.equal(r.linkComplete.afterFolder, '![](../sub/', 'Tab accepts the folder and appends the slash\n' + why);
  assert.equal(r.linkComplete.reopened, true, 'a folder accept re-opens the menu one level down\n' + why);
  assert.ok(r.linkComplete.secondLabels.includes('pic.png') && r.linkComplete.secondLabels.includes('pic.md'), why);
  assert.equal(r.linkComplete.afterFile, '![](../sub/pic.png', 'Tab accepts the file with the app\'s link encoding\n' + why);
  assert.equal(r.linkComplete.closed, true, why);

  // 10. live preview drops: own paragraph after the pointed source line
  assert.deepEqual(r.lpDrop.listItem, { found: true, count: 1, before: ['- beta item', ''], after: ['', '- gamma item'] },
    'a drop on a rendered list item goes in as its own paragraph right after that item\n' + why);
  assert.deepEqual(r.lpDrop.codeLine, { found: true, count: 1, before: ['```', ''], after: ['', 'tail text'] },
    'a drop on a rendered code line goes after the whole fence, never inside it\n' + why);
  assert.deepEqual(r.lpDrop.paragraph, { found: true, count: 1, before: ['intro paragraph here', ''], after: ['', '- alpha item'] },
    'a drop on a rendered paragraph goes in as its own paragraph right after it\n' + why);

  // 11. card view: the card owns the drag, picture included
  assert.deepEqual(r.cardDrag, { found: true, imgDraggable: false, cardDraggable: true, payloadIsCard: true },
    'grabbing a media card by its picture must drag the CARD (non-draggable <img>) with the card payload\n' + why);
});

# Live Preview — Design (pre-implementation)

Obsidian-style live preview: formatting renders inside the editor pane
itself, markdown syntax marks hide except where you are editing, and the
side-by-side preview pane becomes optional. From CLAUDE.md:

> Obsidian-style Live Preview, instead of a raw text and a live preview
> side by side, they can be in the same panel. This mode can be toggled
> on/off in the settings for users who prefer the old (current) way.

This document is the agreed design. **No code until it is approved.**
The feature touches the editor core, so the design's first duty is a
containment story: everything lives behind one default-off toggle, in one
new module, wired through one CodeMirror compartment — toggling off must
reproduce today's editor exactly.

---

## 1. Why this is safe to build at all

CodeMirror 6 decorations are the right tool because they are **display
only**: a `Decoration.replace` that hides `**` never edits the document.
Saving, autosave, crash backups, find/replace, undo — everything operates
on the unchanged text. The failure modes are visual (mis-hidden marks,
odd cursor motion near widgets), not data loss. That is what makes an
experimental editor feature acceptable in this codebase.

## 2. UX

- **Settings → "Live Preview (experimental)"** — persisted
  (`livePreviewMode` in `revery_md_settings`), default **off**, canonical
  setter `window.setLivePreviewMode(on)` following the exact
  slow-hardware-mode pattern in markdown_editor_menus.js.
- When ON: the preview pane and its divider are hidden (the user's own
  `previewVisible` preference is saved and restored on toggle-off — same
  approach reader mode uses). The editor renders formatting inline.
- **Reveal rule**: syntax marks are visible on any line that intersects a
  selection range (cursor counts); everywhere else they are hidden. This
  is the Obsidian behavior users expect and it degrades gracefully — when
  in doubt, show the marks.
- Reader mode outranks live preview visually (it hides the editor);
  toggles stay independent.

## 3. What renders, in phases

**Phase 1 — pure mark/line decorations, zero widgets (lowest risk):**
| Markdown | Rendering |
|---|---|
| `# … ######` headings | line class `lp-h1…lp-h6` (size/weight from existing theme vars); `#` marks hidden off-line |
| `**bold**` / `*italic*` / `~~strike~~` | content styled; `EmphasisMark`/`StrikethroughMark` hidden off-line |
| `` `inline code` `` | code styling; backtick `CodeMark`s hidden off-line |
| `> quote` | line class with the existing blockquote bar styling; `QuoteMark` hidden off-line |
| `[text](url)` | link-colored text; `[`,`]`,`(url)` hidden off-line. **Clicking does nothing** — app link policy |
| fenced code blocks | block background via line class; fences visible (cheap, honest) |

**Phase 2 — widgets (only after phase 1 ships and soaks):**
`---` horizontal rule as a line widget; images as inline widgets reusing
`postProcessImages`' path resolution + `NativeAPI.toMediaUrl`.

**Explicitly out of scope:** KaTeX in-editor, tables layout, footnote
popovers. The preview pane remains available for full fidelity — live
preview does not have to be the whole renderer.

## 4. Architecture

New classic script `www/jvscrpt_and_css_extra/markdown_editor_livepreview.js`
loaded after cm_setup.js. No sidebar-bundle involvement.

- **Phase 0 (enabler):** add `ViewPlugin`, `WidgetType` (@codemirror/view)
  and `syntaxTree` (@codemirror/language) to build_tools/cm_entry_slim.js
  and rebuild the CM bundle. Verify off-state pixel parity afterward —
  the bundle is shared by everything.
- **cm_setup.js** grows one compartment, mirroring lineNumbersCompartment:
  `livePreviewCompartment.of([])` in `_editorExtensions`, plus
  `window.setLivePreviewExtension(ext)` that (a) stores the current value
  and (b) dispatches a reconfigure.
  ⚠ Known trap, handled explicitly: `replaceEditorContent` builds a FRESH
  EditorState from `_editorExtensions`, which snapshots the compartment's
  initial (empty) value — after every `setState` it must re-dispatch the
  stored current value, or live preview silently dies on file switch.
  This gets a dedicated E2E assertion.
- **The extension** (livepreview module): one `ViewPlugin` computing a
  `DecorationSet` via `RangeSetBuilder` over `view.visibleRanges` only
  (viewport-bounded work — cheap even on slow hardware), recomputed on
  doc/viewport/selection changes. Node names from the lezer markdown tree
  (`HeaderMark`, `EmphasisMark`, `CodeMark`, `QuoteMark`, `Link`, …).
  Styling classes go in revery_notebook_style.css using existing theme
  variables so all four themes work without new colors.

## 5. Interactions audited up front

| Existing feature | Interaction | Verdict |
|---|---|---|
| Find/replace | operates on raw text; selecting a match reveals its line's marks (selection rule) | works, pleasant |
| findHighlightField decorations | separate decoration sets compose; order via `Prec` if needed | fine |
| Outline / sync-scroll / word count | read raw text & lines | unaffected |
| Forced preview sync | targets the hidden pane; guard with `livePreviewMode` check like `previewVisible` | small guard |
| YAML pill / preview-click-to-source | preview pane hidden while ON | acceptable, documented |
| Slow hardware mode | orthogonal; decorations are viewport-only. If real machines disagree, LP can defer to slow-hw in a follow-up | measure first |
| IME/composition | replace decorations near composition ranges can glitch; reveal-on-selection already keeps the active line undecorated | verify manually |
| Undo/History | decorations never touch the document | safe by construction |

## 6. Verification plan

1. E2E (existing electron driver pattern): enable via
   `setLivePreviewMode(true)`; assert heading line gets `lp-h1`, `**`
   marks absent from rendered content off-line and present when the
   cursor moves onto the line; `replaceEditorContent` keeps LP active
   (the compartment trap); toggle off restores.
2. **Off-state pixel parity**: fresh-profile screenshot with the feature
   merged but toggled off vs current baseline — must be identical (the
   1-pixel methodology from stage 4).
3. Full suite + boot smoke on Electron; one Tauri release boot.
4. Hands-on soak by the user with real notes before this leaves
   "experimental" labeling.

## 6b. Phase 2 — delivered

Visual convergence with the classic preview shipped: preview typography
(`--preview-font` + the prose uppercase/tracking/weight-400 heading scale)
on the editor content, the per-theme background-texture overlay recipe on
the editor pane (opacity setting and slow-hardware suppression apply
automatically via the shared variables), horizontal rules and unordered
bullets as inline widgets, and real inline image widgets using the same
path resolution AND root-containment guard as postProcessImages. Center
Headers parity included. Note: CodeMirror forbids block decorations from
view plugins, so image widgets are inline (the line grows) — equivalent
for the common image-on-its-own-line case. Follow-up fixes after user
soak: GFM strikethrough enabled (markdown({ extensions: [Strikethrough] })
— note this also makes the CLASSIC editor strike ~~text~~ through, at
parity with how bold/italic were always highlighted) and the fenced-code
copy button (CopyWidget on the opening fence line, reusing the preview's
.code-copy-btn styling and clipboard fallback chain). Task-list checkboxes also
delivered (TaskList parser extension + a checkbox that toggles
[ ]<->[x] through a normal editor transaction — user-initiated, undoable,
flows through autosave; the marker is re-validated at click time via
posAtDOM before any edit). KaTeX math also delivered: a
conservative scanner (code contexts and frontmatter excluded, texmath
whitespace rules so currency stays text) renders $…$ and single-line
$$…$$ through the globally loaded KaTeX with throwOnError:false and a
raw-text fallback; multi-line $$ blocks stay raw (replace decorations
cannot cross lines from a view plugin — the classic preview covers
them). YAML frontmatter became a protected region (CommonMark would
misparse the fences as a thematic break and 'key: value' + '---' as a
Setext heading): no decorations inside, dim mono styling instead.
Phase 3 delivered: fence syntax
highlighting via a curated 23-language set of @codemirror/legacy-modes
stream parsers (+155 KB bundle, not the multi-MB language-data pack) —
colors apply in the classic editor too; TABLES render via a StateField
(block decorations are forbidden from view plugins — the field caches
table ranges so selection-only changes outside tables cost nothing),
cells go through the same markdown-it + DOMPurify pipeline as the
preview, and clicking a table places the cursor inside to edit raw;
the 'Reader padding' setting now drives the live-preview column width
(--reader-max-width, centered) exactly like reader mode.

## 7. Order of work

Phase 0 bundle exports → cm_setup compartment + setState re-dispatch →
livepreview module (headings+emphasis first, then code/quote/links) →
menus toggle + pane hiding → CSS → E2E + parity screenshot → commit per
step, each independently revertable. Phase 2 only after user soak.

## 8. v2 — block-widget renderer (the current architecture)

User soak on the phase 1–3 engine surfaced systematic parity failures:
headers larger than the preview, code blocks in the wrong font with no
language colors and visible ``` fences, images not filling the column,
tables inconsistently rendered. Root cause, not a bug list: the
decoration engine RE-IMPLEMENTED the preview's look rule by rule, but
the preview's appearance comes from 31 `#preview`-scoped override rules
PLUS a dynamic stylesheet (`applyUiSizeProseCompensation`) that rescales
prose sizes by 1/uiScale×textScale. Hand-mirrored approximations can
never track that — the parity tail was unbounded. The v1 inline
decoration engine is retired.

**v2 (per Harald's proposal, generalized per-block):** every top-level
markdown block NOT intersecting the selection is replaced by a
`Decoration.replace({block:true})` widget — one StateField, since block
decorations are forbidden from view plugins — whose DOM is
`div.lp-render > div.prose.prose-lg.max-w-none.mx-auto` filled by
`DOMPurify.sanitize(md.render(blockText))`: the classic preview's OWN
markdown-it instance (hljs highlight hook, footnote, texmath/KaTeX) and
its OWN container classes. The `#preview`-scoped parity rules and the
dynamic compensation stylesheet were swept to `:is(#preview, .lp-render)`
(same specificity — id-level — so preview pixel-parity holds; verified:
editor pane 0 px vs main, preview computed styles byte-identical).
Result: parity BY CONSTRUCTION — tables, github-dark fence colors, the
image full-width class, exact heading sizes, and multi-line $$ math
(v1's hard gap) all render because they are the same HTML under the
same CSS. Blocks the user edits stay raw text (reveal at block
granularity); blank lines between blocks stay raw as cursor targets;
YAML frontmatter keeps its protected dim-raw region; clicking a
rendered block dispatches the cursor into it. Widget post-processing
REUSES the preview's own postProcessImages/postProcessCodeBlocks
(parameterized by root) and upgrades task-list `[ ]` text to real
checkboxes that toggle the document through a validated transaction.
Widget `eq` on block source text means typing in the active block never
re-renders the others.

Found during the rewrite: cm_entry_slim.js resolved fence languages to
a bare StreamLanguage, but lang-markdown's nesting reads
`desc.support.language.parser` — an uncaught TypeError that broke fence
colors intermittently in BOTH editors. Fixed by resolving a
LanguageSupport wrapper (bundle rebuilt).

Click-to-edit scroll pinning (v2 follow-up after user soak): a plain
`scrollIntoView: true` made the view jump when a widget swapped to raw
text (heights reflow above and below). The mousedown now dispatches an
`EditorView.scrollIntoView(pos, { y: 'start', yMargin })` effect with
yMargin = the pointer's offset from the scroller top, so the clicked
source line stays exactly under the pointer after the reflow. E2E
`clickUnderPointer` asserts the property (polls — measure/rAF lags
under a parallel test run; also note widget DOM only exists inside the
drawn viewport, so probes must scroll via CM before querying it).

Known v2 limits (accepted): footnote refs and definitions render
per-block; a whole list/table flips to raw while being edited
(Typora-style); reference-style links resolve only within their own
block. The E2E suite asserts computed-style EQUALITY between
`.lp-render` and `#preview` (h1 font, paragraph size, code font+size,
table cells, KaTeX size, image full-width) — the regression class the
user reports were about.

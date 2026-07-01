// Slim entry: skip the full language-data pack (lazy-loaded code-fence highlighting)
export { EditorView, keymap, Decoration, drawSelection, placeholder, lineNumbers } from '@codemirror/view';
export { EditorState, StateField, StateEffect, Compartment, RangeSetBuilder, Prec } from '@codemirror/state';
export { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
export { markdown } from '@codemirror/lang-markdown';
export { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
// language-data is intentionally omitted to keep the bundle small;
// fenced code blocks still render, just without per-language token colours.

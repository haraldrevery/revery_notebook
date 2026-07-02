// Slim entry: skip the full language-data pack (lazy-loaded code-fence highlighting)
export { EditorView, keymap, Decoration, ViewPlugin, WidgetType, drawSelection, placeholder, lineNumbers } from '@codemirror/view';
export { EditorState, StateField, StateEffect, Compartment, RangeSetBuilder, Prec } from '@codemirror/state';
export { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
export { markdown } from '@codemirror/lang-markdown';
export { Strikethrough, TaskList, Table } from '@lezer/markdown'; // GFM parser extensions

/* ── Fenced-code syntax colors ─────────────────────────────────────────
   Curated language set built on @codemirror/legacy-modes stream parsers:
   hljs-grade token coloring at a few KB per language, instead of the
   multi-MB language-data pack this bundle deliberately omits.          */
import { StreamLanguage, LanguageDescription } from '@codemirror/language';
import { javascript as m_js, json as m_json, typescript as m_ts } from '@codemirror/legacy-modes/mode/javascript';
import { python as m_py } from '@codemirror/legacy-modes/mode/python';
import { c as m_c, cpp as m_cpp, java as m_java, csharp as m_cs, kotlin as m_kotlin } from '@codemirror/legacy-modes/mode/clike';
import { shell as m_shell } from '@codemirror/legacy-modes/mode/shell';
import { rust as m_rust } from '@codemirror/legacy-modes/mode/rust';
import { go as m_go } from '@codemirror/legacy-modes/mode/go';
import { standardSQL as m_sql } from '@codemirror/legacy-modes/mode/sql';
import { css as m_css, sCSS as m_scss } from '@codemirror/legacy-modes/mode/css';
import { xml as m_xml, html as m_html } from '@codemirror/legacy-modes/mode/xml';
import { yaml as m_yaml } from '@codemirror/legacy-modes/mode/yaml';
import { ruby as m_ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua as m_lua } from '@codemirror/legacy-modes/mode/lua';
import { swift as m_swift } from '@codemirror/legacy-modes/mode/swift';
import { toml as m_toml } from '@codemirror/legacy-modes/mode/toml';
import { perl as m_perl } from '@codemirror/legacy-modes/mode/perl';

const lang = (name, alias, mode) => LanguageDescription.of({
  name, alias, load: async () => StreamLanguage.define(mode),
});
export const codeLanguages = [
  lang('javascript', ['js', 'jsx', 'node'], m_js),
  lang('typescript', ['ts', 'tsx'], m_ts),
  lang('json', ['json5'], m_json),
  lang('python', ['py'], m_py),
  lang('c', ['h'], m_c),
  lang('cpp', ['c++', 'cc', 'hpp'], m_cpp),
  lang('java', [], m_java),
  lang('csharp', ['cs', 'c#'], m_cs),
  lang('kotlin', ['kt'], m_kotlin),
  lang('shell', ['bash', 'sh', 'zsh'], m_shell),
  lang('rust', ['rs'], m_rust),
  lang('go', ['golang'], m_go),
  lang('sql', [], m_sql),
  lang('css', [], m_css),
  lang('scss', ['sass'], m_scss),
  lang('xml', ['svg'], m_xml),
  lang('html', ['htm'], m_html),
  lang('yaml', ['yml'], m_yaml),
  lang('ruby', ['rb'], m_ruby),
  lang('lua', [], m_lua),
  lang('swift', [], m_swift),
  lang('toml', [], m_toml),
  lang('perl', ['pl'], m_perl),
];
export { syntaxHighlighting, defaultHighlightStyle, syntaxTree } from '@codemirror/language';
// language-data is intentionally omitted to keep the bundle small;
// fenced code blocks still render, just without per-language token colours.

'use strict';

/* Markdown documents that used to break (or silently mangle) the LaTeX
   export. Shared by test/latex_compile.test.js — which builds each one
   through the real exporter and compiles it with pdflatex — and readable
   as a catalogue of what the exporter must survive. Every case must
   compile; the compile test reports the first LaTeX error per case. */

const CASES = {
  table_then_heading:   '| a | b |\n|---|---|\n| 1 | 2 |\n## After table\n\ntext',
  code_then_heading:    '```js\nx = 1\n```\n## After code\n\ntext',
  math_then_heading:    '$$\na = b\n$$\n## After math\n\ntext',
  image_then_heading:   '![alt](pic.png)\n## After image\n\ntext',
  para_then_heading:    'Some paragraph\n## Interrupting heading\n\ntext',
  list_then_heading:    '- item one\n- item two\n## After list\n\ntext',
  heading_specials:     '## Q&A: 100% of #1 items_here {braces} ~ ^\n\ntext',
  heading_inline:       '### Use `a & b` and **bold & co**\n\ntext',
  heading_footnote:     '## Heading with note[^a]\n\n[^a]: the note & more',
  quote_heading:        '> ## Quoted & heading\n> body & text',
  crlf:                 '# Title\r\n\r\n## Sub & more\r\n\r\ntext & more\r\n',
  false_inline_math:    'It costs $5 today.\n\n## Prices & taxes\n\nAnd $10 tomorrow, R&D says 50% more.',
  stray_display:        'Intro\n\n$$\n\n## Heading after stray\n\ntext R&D',
  multiline_dollars:    'Start $a\nb$ end — not math on screen either.',
  dollars_prose:        'Only one $ sign here, and 100$ there. Also $ 5 and 5 $ spaced.',
  math_keeps_amp:       '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nInline $x_1 + y$ stays. And $a \\% b$.',
  math_unicode:         'Inline $a ≤ b$ and display\n\n$$\nα → β ≠ γ\n$$\n',
  entities:             'Fish &amp; chips, 3 &lt; 4 &gt; 2, &quot;quoted&quot;, a&nbsp;b, &#8212; dash, `&amp;` literal',
  amp_everywhere:       'Prose R&D & more.\n\n| Col & 1 | Col 2 |\n|---|---|\n| a & b | **c & d** |\n\n- item & thing\n\n1. num & thing\n\n> quote & text\n\n[link & text](https://example.com/?a=1&b=2#frag)\n\nFoot[^1] and `code & x`.\n\n[^1]: note & ref',
  item_bracket:         '- [note] text after\n- [x] done task\n- [ ] open task\n- [link](https://x.y) start',
  nested_lists:         '- a\n  - b & c\n    1. d\n    2. e\n  - f\n- g\n  continuation line\n\n1. one\n   - sub bullet\n2. two',
  nested_too_deep:      '- 1\n  - 2\n    - 3\n      - 4\n        - 5\n          - 6\n            - 7',
  url_specials:         'See [docs](https://example.com/a_b%20c#sec) and [q](https://e.com/?x=1&y=2).\n\n| L |\n|---|\n| [in cell](https://e.com/?x=1&y=2#f) |\n\n## Heading [with link](https://e.com/?a=1&b=2)\n\n- [item link](https://e.com/?a=1&b=2)',
  emphasis_edges:       '**bold with `code` inside** and *it & al* and ~~gone & out~~, 5 * 3 * 2, snake_case_name, \\*literal\\* \\# \\_ back\\\\slash',
  backslash_prose:      'Path C:\\Users\\x and a \\newpage command in prose <b> tags \'quotes\' "dq" | pipe',
  frontmatter_specials: '---\ntitle: R&D Report #1 (50%)\nauthor: A & B_C\ndate: 2026-09-11 (50% done & counting)\n---\n\n# Body\n\ntext',
  unterminated_fence:   '```\ncode line\n# not a heading & stuff\n\n## still code',
  setext:               'Title line\n===\n\nSub line\n---\n\nParagraph\n\n---\n\nAfter rule',
  hash_no_space:        '##Not a heading\n\n#hashtag here',
  unicode_prose:        'Greek α β Ω, compare ≤ ≥ ≠ ≈, check ✓ ✗, star ★ ☆, box ■ □, emoji 🎉 🚀, arrows → ← ⇒, zero\u200Bwidth, prime 5′ 10″, minus −3, dash — quote “x” … € ™ ½ °C',
  escaped_bracket:      'Not math: \\[just brackets\\] in prose and \\(parens\\).',
};

module.exports = { CASES };

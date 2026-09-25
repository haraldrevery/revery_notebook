/* markdown_editor_yaml.js — the app's ONE reading of YAML frontmatter.
 *
 * Every surface that shows or uses a note's properties reads them here,
 * so they all agree on what the note says:
 *   • the Properties sheet (preview, reader mode, the live preview widget);
 *   • the export metadata (LaTeX builder, PDF front page, HTML export);
 *   • the frontmatter autocomplete — its project index (sidebar bundle,
 *     src/sidebar/yaml_index.js) and the quoting of what it inserts
 *     (markdown_editor_cm_setup.js).
 * Display only: nothing here ever writes the document. No DOM access, so
 * the Node tests load this file as it ships (test/yaml_reader.test.js).
 * Exposed as window.ReveryYaml.
 */
(function () {
  'use strict';

  /* ── Reading ─────────────────────────────────────────────────────────
     The usual frontmatter shapes, read the way their writer means them:
       key: value            → text (surrounding quotes dropped)
       key: [a, "b, c"]      → list (flow sequence, may continue on more lines)
       key:\n  - a\n  - b    → list (block sequence)
       tags: a, b            → list, for LIST KEYS only (below)
       key:\n  sub: value    → map  (one level; deeper lines join their parent)
       key: |  /  key: >     → text (block scalar; | keeps its line breaks)
       key: first\n  more    → text (a plain value continued on indented lines)
       key: ~ / null / ""    → empty
     Comment lines are skipped; any other line shows as keyless text, so
     nothing written in the frontmatter disappears. Each entry carries the
     doc offsets of its source lines (start/end, counted from baseOffset)
     so a click can map back to them, and `warn` when a real YAML parser
     would read the line differently from how it shows (TRAPS). */

  /* Keys that hold lists by convention: a plain comma value under them
     reads as the list its writer means, exactly like `[a, b]` or a block
     list. Every other key keeps its value whole, so a title such as
     `Hello, world` never splits. */
  const LIST_KEYS = ['tags', 'tag', 'categories', 'category', 'keywords', 'aliases', 'authors'];
  const isListKey = (key) => LIST_KEYS.includes(String(key || '').toLowerCase());

  const KEY_LINE = /^(?!-(?:\s|$))("[^"]*"|'[^']*'|[^\s#][^:]*?)\s*:(?:\s+(.*?))?\s*$/;
  const KEY_NO_SPACE = /^([^\s#:'"-][^\s:]*):(\S.*?)\s*$/;   // `key:value`
  const CHILD_LINE = /^(?:\s+\S|-(?:\s|$))/;                  // indented, or a sequence item
  const BLOCK_SCALAR = /^[|>](?:[+-]?\d*|\d+[+-])$/;         // |, >-, |2, >2- …
  const NULL_VALUE = /^(?:~|null|Null|NULL)$/;

  function unquote(s) {
    s = String(s).trim();
    if (s.length > 1 && s[0] === '"' && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
    if (s.length > 1 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    return s;
  }
  const isQuoted = (s) => s.length > 1 && (s[0] === '"' || s[0] === "'") && s.endsWith(s[0]);

  /* Items of a comma list ("a, 'b, c'") — commas inside quotes stay. */
  function listItems(inner) {
    const items = [];
    let cur = '', quote = null;
    for (const c of inner) {
      if (quote) { cur += c; if (c === quote) quote = null; }
      else if (c === '"' || c === "'") { quote = c; cur += c; }
      else if (c === ',') { items.push(cur); cur = ''; }
      else cur += c;
    }
    items.push(cur);
    return items.map(unquote).filter((v) => v !== '');
  }

  /* ── Traps: lines a YAML parser reads differently from how they look ──
     The sheet flags them (display only); the file is never touched. */
  const WARNINGS = {
    'no-space': 'YAML needs a space after the colon: this line is not read as a property.',
    'unclosed': 'Unclosed quote or bracket: YAML rejects this line.',
    'colon': 'A colon followed by a space must be quoted: YAML rejects this line.',
    'comment-all': 'In YAML # starts a comment, so this value reads as empty. Quote it to keep it.',
    'comment-tail': 'In YAML " #" starts a comment, so the rest of this value is dropped. Quote it to keep it.',
    'symbol': 'A value that starts with @ ` % * & or ! must be quoted in YAML.',
    'tab': 'YAML does not allow tabs for indentation.',
    'duplicate': 'This key appears more than once: YAML keeps only one of them, and some tools reject the file.',
  };

  /* The trap in a key line's own value, if any (`raw` = the text after
     "key: ", trimmed; `more` = its continuation lines). */
  function valueTrap(raw, more) {
    if (!raw || BLOCK_SCALAR.test(raw)) return null;
    const q = raw[0];
    if (q === '"' || q === "'") return isQuoted(raw) ? null : 'unclosed';
    if (q === '[') return [raw, ...more].join(' ').trim().endsWith(']') ? null : 'unclosed';
    if (q === '{') return [raw, ...more].join(' ').trim().endsWith('}') ? null : 'unclosed';
    if (q === '#') return 'comment-all';
    if (/^[@`%*&!]/.test(raw)) return 'symbol';
    if (/:(?:\s|$)/.test(raw)) return 'colon';
    if (/\s#/.test(raw)) return 'comment-tail';
    return null;
  }

  /* An entry's child lines → its value, for a key whose own line is empty. */
  function nestedValue(kids) {
    const lines = kids.filter((l) => l.trim() && !/^\s*#/.test(l));
    if (!lines.length) return { kind: 'empty', value: '' };
    const indent = (l) => l.length - l.trimStart().length;
    const base = Math.min(...lines.map(indent));
    const top = lines.filter((l) => indent(l) === base);
    const isList = top.every((l) => /^-(?:\s|$)/.test(l.trimStart()));
    const out = [];
    for (const l of lines) {
      const t = l.trim();
      if (indent(l) > base && out.length) {       // continues the item above
        const last = out[out.length - 1];
        if (isList) out[out.length - 1] = last + ' ' + t;
        else last[1] = (last[1] ? last[1] + ' ' : '') + t;
        continue;
      }
      if (isList) { out.push(unquote(t.replace(/^-\s*/, ''))); continue; }
      const m = KEY_LINE.exec(t);
      out.push(m ? [unquote(m[1]), unquote(m[2] || '')] : ['', t]);
    }
    return isList ? { kind: 'list', value: out.filter((v) => v !== '') } : { kind: 'map', value: out };
  }

  function entryValue(key, raw, kids) {
    if (BLOCK_SCALAR.test(raw)) {
      const base = Math.min(...kids.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
      const body = kids.map((l) => l.slice(Number.isFinite(base) ? base : 0));
      const text = raw[0] === '|' ? body.join('\n') : body.map((l) => l || '\n').join(' ').replace(/ ?\n ?/g, '\n');
      return { kind: 'text', value: text.trim() };
    }
    const more = kids.filter((l) => l.trim() && !/^\s*#/.test(l)).map((l) => l.trim());
    if (raw.startsWith('[')) {                      // flow sequence
      const s = [raw, ...more].join(' ').trim();
      if (s.endsWith(']')) return { kind: 'list', value: listItems(s.slice(1, -1)) };
      return { kind: 'text', value: s };
    }
    if (!raw) return nestedValue(kids);
    const whole = [raw, ...more].join(' ');
    if (NULL_VALUE.test(whole)) return { kind: 'empty', value: '' };
    if (isListKey(key) && !isQuoted(raw)) return { kind: 'list', value: listItems(whole) };
    const text = unquote(whole);
    return text ? { kind: 'text', value: text } : { kind: 'empty', value: '' };
  }

  function readEntries(yamlContent, baseOffset) {
    const lines = String(yamlContent || '').replace(/\r\n?/g, '\n').split('\n');
    const starts = [];
    let off = baseOffset || 0;
    for (const l of lines) { starts.push(off); off += l.length + 1; }
    const entries = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
      /* The entry's child lines: indented or sequence items, blank lines
         included only when more child lines follow (block scalars). */
      let j = i + 1;
      while (j < lines.length) {
        if (CHILD_LINE.test(lines[j])) { j++; continue; }
        let k = j;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k > j && k < lines.length && CHILD_LINE.test(lines[k])) { j = k; continue; }
        break;
      }
      const kids = lines.slice(i + 1, j);
      const entry = { key: '', start: starts[i], end: starts[j - 1] + lines[j - 1].length };
      const top = /^\S/.test(line);
      const m = top ? KEY_LINE.exec(line) : null;
      const loose = top && !m ? KEY_NO_SPACE.exec(line) : null;
      if (m) {
        const raw = (m[2] || '').trim();
        entry.key = unquote(m[1]);
        Object.assign(entry, entryValue(entry.key, raw, kids));
        const more = kids.filter((l) => l.trim() && !/^\s*#/.test(l)).map((l) => l.trim());
        const trap = valueTrap(raw, more);
        if (trap) entry.warn = trap;
      } else if (loose) {
        entry.key = loose[1];
        Object.assign(entry, entryValue(entry.key, loose[2], kids));
        entry.warn = 'no-space';
      } else {
        Object.assign(entry, { kind: 'text', value: [line, ...kids].map((l) => l.trim()).join('\n') });
      }
      if (!entry.warn && kids.some((l) => /^ *\t/.test(l))) entry.warn = 'tab';
      entries.push(entry);
      i = j;
    }
    const seen = new Map();
    for (const e of entries) if (e.key) seen.set(e.key, (seen.get(e.key) || 0) + 1);
    for (const e of entries) if (e.key && seen.get(e.key) > 1 && !e.warn) e.warn = 'duplicate';
    return entries;
  }

  /* An entry's value as one line of plain text (export metadata, the
     autocomplete index): list items joined by ", ", nested lines by "; ". */
  function entryText(e) {
    if (!e) return '';
    if (e.kind === 'list') return e.value.join(', ');
    if (e.kind === 'map') return e.value.map(([k, v]) => (k ? `${k}: ${v}` : v)).join('; ');
    return e.kind === 'empty' ? '' : String(e.value);
  }

  /* ── Writing a value back (autocomplete) ─────────────────────────────
     A suggestion is stored unquoted (it was read), so inserting it as-is
     could write YAML that no longer parses: "Note: part 2" taken from a
     quoted title elsewhere became `title: Note: part 2`. Quote it when
     plain YAML cannot hold it; `inList` = it goes into a comma list,
     where , [ ] { } would split or end the list. */
  function quoteValue(v, inList) {
    v = String(v);
    const plainOk = v !== '' && v === v.trim()
      && !/^(?:[,\[\]{}#&*!|>'"%@`]|[-?:](?:\s|$))/.test(v)
      && !/:(?:\s|$)/.test(v) && !/\s#/.test(v)
      && !(inList && /[,\[\]{}]/.test(v));
    return plainOk ? v : '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  /* ── The Properties sheet ────────────────────────────────────────────
     A key column beside a value column, list values as chips, a ⚠ on a
     row a YAML parser reads differently (its tooltip says how).
     `opts.collapsible` makes the header a fold toggle (live preview and
     reader mode); `opts.collapsed` then renders the header alone, with
     the entry count. Every key/value is HTML-escaped — frontmatter is
     untrusted. Returns '' when there is nothing to show. */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const tr = (s) => (typeof window.t === 'function' ? window.t(s) : s);
  const CHEVRON = '<svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><path d="M3.5 1.5 7 5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function valueHtml(e) {
    const none = '<span class="yaml-empty">—</span>';
    if (e.kind === 'list') {
      return e.value.length ? e.value.map((v) => `<span class="yaml-chip">${esc(v)}</span>`).join('') : none;
    }
    if (e.kind === 'map') {
      return e.value.map(([k, v]) =>
        `<span class="yaml-sub">${k ? `<span class="yaml-subkey">${esc(k)}</span>` : ''}${esc(v)}</span>`).join('');
    }
    if (e.kind === 'empty' || !e.value) return none;
    return `<span class="yaml-text">${esc(e.value)}</span>`;
  }

  function buildSheetHtml(yamlContent, baseOffset, opts = {}) {
    const entries = readEntries(yamlContent, baseOffset);
    if (!entries.length) return '';
    const label = esc(tr('Properties'));
    const collapsed = !!(opts.collapsible && opts.collapsed);
    let head;
    if (opts.collapsible) {
      const tip = esc(tr(collapsed ? 'Show properties' : 'Hide properties'));
      head = `<button type="button" class="yaml-head yaml-toggle" aria-expanded="${!collapsed}" title="${tip}">`
        + `<span class="yaml-chevron">${CHEVRON}</span><span class="yaml-render-title">${label}</span>`
        + `<span class="yaml-count">${entries.length}</span></button>`;
    } else {
      head = `<div class="yaml-head"><span class="yaml-render-title">${label}</span></div>`;
    }
    const rows = collapsed ? '' : '<div class="yaml-rows">' + entries.map((e) => {
      const key = esc(e.key);
      const warn = e.warn
        ? `<span class="yaml-warn" role="img" aria-label="${esc(tr(WARNINGS[e.warn]))}" title="${esc(tr(WARNINGS[e.warn]))}">⚠</span>`
        : '';
      return `<div class="yaml-row${e.warn ? ' yaml-row-warn' : ''}" data-start="${e.start}" data-end="${e.end}">`
        + `<span class="yaml-key" title="${key}">${key}</span><span class="yaml-value">${valueHtml(e)}${warn}</span></div>`;
    }).join('') + '</div>';
    return `<div class="yaml-render${collapsed ? ' yaml-collapsed' : ''}">${head}${rows}</div>`;
  }

  window.ReveryYaml = {
    LIST_KEYS: LIST_KEYS.slice(),
    WARNINGS: Object.assign({}, WARNINGS),
    isListKey, unquote, readEntries, entryText, quoteValue, buildSheetHtml,
  };
})();

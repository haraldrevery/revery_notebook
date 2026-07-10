// yaml_template_list.js
const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const yamlTemplates = [
  {
    label: 'Blog Post',
    content: `---\ntitle: Blog Title\ndate: ${getTodayStr()}\ntags: [tag_1, tag_2]\nimage: /notebook_thumbnails/default.jpg\ndescription: Blog description.\ndraft: true\n---\n\n`
  },
  {
    label: 'LLM Entry',
    content: `---\ntitle: "Title of post"\nllm_Model: "Model name"\nprompt_version: 4\ncategory: [category_1, category_2]\ntags: [tag_1, tag_2, tag_3, tag_4]\ndate: ${getTodayStr()}\ndescription: "A short description of the post."\n---\n\n`
  }
  // Add as many as you want here!
];


const mdTemplates = [
  {
    label: 'Recipe',
    content: `# Recipe Name\n\n## Ingredients\n- \n- \n- \n## Instructions\n1. \n2. \n3. \n## Notes\n\n`
  },
  {
    label: 'To do',
    content: `# To Do List\n\n## High Priority\n- [ ] \n- [ ] \n## Normal\n- [ ] \n- [ ] \n## Low Priority\n- [ ] \n- [ ] \n\n`
  },
  {
    label: 'Workout program',
    content: `# Workout Program\n\n## Monday: Chest & Triceps\n- Bench Press: 3x8-12\n- Tricep Extensions: 3x10-15 \n## Wednesday: Back & Biceps\n- Pull-ups: 3xAMRAP\n- Bicep Curls: 3x10-15\n\n## Friday: Legs & Core\n- Squats: 3x8-12\n- Planks: 3x60s\n\n`
  },
  {
    label: 'Grocery list',
    content: `# Grocery List\n\n## Produce\n- [ ] \n- [ ] \n\n## Dairy / Meat\n- [ ] \n- [ ] \n\n## Pantry\n- [ ] \n- [ ] \n\n`
  }
];

/* ── Custom user templates ────────────────────────────────────────────────
   User-created templates live in localStorage under ONE key and are merged
   into the arrays above (marked custom:true, so the menus can offer a ✕).
   The submenu action defs hold references to these arrays, so push/splice +
   rebuildAllMenus() updates the open UI immediately. Everything is
   validated/capped so malformed or oversized storage can degrade only to
   "template skipped" or a returned error — never a thrown exception. */
const CUSTOM_TMPL_KEY = 'revery_custom_templates';
const CUSTOM_TMPL_MAX_EACH = 50;        // templates per kind
const CUSTOM_TMPL_MAX_LABEL = 60;       // chars
const CUSTOM_TMPL_MAX_CONTENT = 20000;  // chars

const _tmplArrayFor = (kind) => (kind === 'yaml' ? yamlTemplates : mdTemplates);

function _validCustomTmpl(t) {
  return t && typeof t.label === 'string' && t.label.trim()
    && t.label.length <= CUSTOM_TMPL_MAX_LABEL
    && typeof t.content === 'string' && t.content.length <= CUSTOM_TMPL_MAX_CONTENT;
}

function _loadCustomTmplStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_TMPL_KEY) || '{}');
    return {
      yaml: (Array.isArray(raw.yaml) ? raw.yaml : []).filter(_validCustomTmpl),
      md:   (Array.isArray(raw.md)   ? raw.md   : []).filter(_validCustomTmpl),
    };
  } catch (e) {
    console.warn('[templates] custom-template storage unreadable, starting empty:', e);
    return { yaml: [], md: [] };
  }
}

function _saveCustomTmplStore(store) {
  try {
    localStorage.setItem(CUSTOM_TMPL_KEY, JSON.stringify({ v: 1, yaml: store.yaml, md: store.md }));
    return null;
  } catch (e) {
    return (typeof window.t === 'function' ? window.t('Could not save template (storage full?).')
                                           : 'Could not save template (storage full?).');
  }
}

/* Merge persisted customs into the live arrays at load. */
(function () {
  const store = _loadCustomTmplStore();
  store.yaml.forEach((t) => yamlTemplates.push({ label: t.label, content: t.content, custom: true }));
  store.md.forEach((t) => mdTemplates.push({ label: t.label, content: t.content, custom: true }));
})();

/** Create a custom template. kind: 'yaml' | 'md'. Returns {ok} or {ok:false, error}. */
window.createCustomTemplate = function (kind, label, content) {
  const T = (s) => (typeof window.t === 'function' ? window.t(s) : s);
  const arr = _tmplArrayFor(kind);
  label = String(label || '').trim();
  content = String(content || '');
  if (!label) return { ok: false, error: T('Template name is required.') };
  if (label.length > CUSTOM_TMPL_MAX_LABEL) return { ok: false, error: T('Template name is too long.') };
  if (content.length > CUSTOM_TMPL_MAX_CONTENT) return { ok: false, error: T('Template content is too long.') };
  if (arr.some((t) => t.label === label)) return { ok: false, error: T('A template with this name already exists.') };

  const store = _loadCustomTmplStore();
  const list = kind === 'yaml' ? store.yaml : store.md;
  if (list.length >= CUSTOM_TMPL_MAX_EACH) return { ok: false, error: T('Too many custom templates.') };

  list.push({ label, content });
  const err = _saveCustomTmplStore(store);
  if (err) return { ok: false, error: err };

  arr.push({ label, content, custom: true });
  if (typeof rebuildAllMenus === 'function') rebuildAllMenus();
  return { ok: true };
};

/** Delete a custom template by label (built-ins are never touched). */
window.deleteCustomTemplate = function (kind, label) {
  const arr = _tmplArrayFor(kind);
  const idx = arr.findIndex((t) => t.custom && t.label === label);
  if (idx === -1) return { ok: false, error: 'not found' };

  const store = _loadCustomTmplStore();
  const list = kind === 'yaml' ? store.yaml : store.md;
  const sIdx = list.findIndex((t) => t.label === label);
  if (sIdx !== -1) list.splice(sIdx, 1);
  const err = _saveCustomTmplStore(store);
  if (err) return { ok: false, error: err };

  arr.splice(idx, 1);
  if (typeof rebuildAllMenus === 'function') rebuildAllMenus();
  return { ok: true };
};
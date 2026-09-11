/* In-page driver for test/latex_compile.test.js: builds the LaTeX for
   every document in latex_cases.js (spliced in by the test) through the
   real exporter, with title page + TOC on so headings run through LaTeX's
   moving arguments. Returns { caseName: texSource }. */
(async () => {
  const cases = __CASES__;
  const out = {};
  for (const [name, doc] of Object.entries(cases)) {
    replaceEditorContent(doc);
    await new Promise((r) => setTimeout(r, 20));
    out[name] = window.exporterBuildLatex({ template: 'article', engine: 'pdflatex', titlePage: true, toc: true }).tex;
  }
  return out;
})()

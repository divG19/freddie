const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { transformSync } = require("next/dist/build/swc");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Compile the actual component in memory; no additional test runtime dependency.
const filename = path.join(__dirname, "results-panel.tsx");
const compiled = transformSync(readFileSync(filename, "utf8"), {
  filename,
  jsc: {
    parser: { syntax: "typescript", tsx: true },
    transform: { react: { runtime: "automatic" } },
  },
  module: { type: "commonjs" },
}).code;
const component = new Module(filename, module);
component.filename = filename;
component.paths = module.paths;
component._compile(compiled, filename);
const { ResultsPanel } = component.exports;
const result = {
  id: "dynamic",
  kind: "query",
  title: "Industry totals",
  columns: [
    { key: "industry_name", label: "Industry name" },
    { key: "customer_total", label: "Customer total" },
  ],
  rows: [{ industry_name: "Fashion & retail", customer_total: 7 }],
  downloadUrl: "/api/rooms/demo/results/dynamic.csv",
  presentation: "table",
  chartMetric: "customer_total",
  summary: "Synthetic totals",
  truncated: true,
};
const render = (data) =>
  renderToStaticMarkup(
    React.createElement(ResultsPanel, { result: data, isLatest: true, onLatest() {} }),
  );

test("dynamic columns, cells, CSV and truncation render", () => {
  const html = render(result);
  assert.match(html, /Industry name/);
  assert.match(html, /Customer total/);
  assert.match(html, /Fashion &amp; retail/);
  assert.match(html, /<td>7<\/td>/);
  assert.match(html, /dynamic.csv/);
  assert.match(html, /Truncated to 500 rows/);
  assert.match(html, /SQL ANALYTICS/);
});

test("dynamic bar and line charts use supplied columns", () => {
  const bar = render({ ...result, presentation: "bar" });
  assert.match(bar, /Industry totals: Customer total/);
  assert.match(bar, /Fashion &amp; retail/);
  const line = render({ ...result, presentation: "line" });
  assert.match(line, /<polyline/);
  assert.match(line, /Fashion &amp; retail: 7/);
});

test("empty dynamic results retain headers and text summaries", () => {
  assert.match(render({ ...result, rows: [] }), /Customer total/);
  assert.match(render({ ...result, presentation: "text" }), /Synthetic totals/);
});

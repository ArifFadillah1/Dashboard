// Smoke test: executes the real app source (with the sample CSV substituted the
// same way scripts/build.py does) under stubbed browser globals, then checks the
// embedded dataset's classification against a known snapshot. Guards against
// regressions in the engine/app wiring and in threshold behavior on real data.
// Run with:  node --test tests/
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Snapshot of the embedded dataset's status distribution. If you change THRESH
// or classifier logic intentionally, re-derive these counts and update them.
const EXPECTED_STATUS_COUNTS = {
  "Idle/Standby": 3996,
  "Tripping In/Out": 744,
  "Connection": 138,
  "Circulating": 1889,
  "Drilling": 221,
  "Critical Anomaly/High Pressure Warning": 342,
};

test("app source executes under stubs and classifies the embedded dataset as expected", () => {
  global.RigEngine = require("../assets/engine.js");
  global.document = {
    documentElement: { lang: "id" },
    addEventListener: () => {},
  };
  global.getComputedStyle = () => ({ getPropertyValue: () => "#000" });
  global.Chart = { defaults: { font: {}, color: null, borderColor: null } };

  let src = fs.readFileSync(path.join(ROOT, "assets", "app.src.js"), "utf8");
  const csv = fs.readFileSync(path.join(ROOT, "assets", "sample-data.csv"), "utf8");
  assert.ok(src.includes("__SAMPLE_CSV__"), "sample CSV marker present in app.src.js");
  src = src.replace("__SAMPLE_CSV__", csv.replace(/\n$/, ""));

  // Expose the app's state for assertions, then run the module-scope code
  // (CSV parse, classification, state init) — init() itself needs a full DOM.
  const anchor = 'document.addEventListener("DOMContentLoaded", init);';
  assert.ok(src.includes(anchor), "init anchor present");
  src = src.replace(anchor, anchor + "\nglobal.__appState = state;");
  eval(src);

  const rows = global.__appState.rows;
  assert.equal(rows.length, 7330);

  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  assert.deepEqual(counts, EXPECTED_STATUS_COUNTS);

  // Filters were initialized to the dataset's full range
  assert.ok(global.__appState.startDate instanceof Date);
  assert.ok(global.__appState.endDate > global.__appState.startDate);
  assert.equal(global.__appState.intervalHours, 1 / 60);
});

// Unit tests for the pure detection/CSV engine. Run with:  node --test tests/
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../assets/engine.js");

const MIN = 1 / 60; // 1-minute sampling interval, in hours

/** A quiet baseline row; override only the fields a test cares about. */
function row(over) {
  return Object.assign({
    ts: new Date("2026-01-01T10:00:00"), rig: "R1",
    wob: 0, rpm: 0, torque: 0, spp: 0, flow: 0,
    bitDepth: 1000, holeDepth: 1000, blockPosition: 0, hookload: 50, flowOutPct: 0, rop: 0,
  }, over);
}

/* ------------------------------------------------------------------ classify */

test("classify: SPP at the critical threshold is a Critical Anomaly (reason spp)", () => {
  const c = E.classify(row({ spp: E.THRESH.SPP_CRITICAL }), null, MIN);
  assert.equal(c.status, "Critical Anomaly/High Pressure Warning");
  assert.equal(c.reason, "spp");
});

test("classify: SPP just below the threshold is not critical", () => {
  const c = E.classify(row({ spp: E.THRESH.SPP_CRITICAL - 0.1 }), null, MIN);
  assert.notEqual(c.status, "Critical Anomaly/High Pressure Warning");
});

test("classify: high torque with low WOB is a Critical Anomaly (reason torque)", () => {
  const c = E.classify(row({ torque: E.THRESH.TORQUE_CRITICAL, wob: E.THRESH.WOB_ON - 0.1 }), null, MIN);
  assert.equal(c.status, "Critical Anomaly/High Pressure Warning");
  assert.equal(c.reason, "torque");
});

test("classify: high torque with normal WOB is NOT critical (drilling can be torquey)", () => {
  const c = E.classify(row({ torque: E.THRESH.TORQUE_CRITICAL, wob: 10, rpm: 60, flow: 400 }), null, MIN);
  assert.notEqual(c.status, "Critical Anomaly/High Pressure Warning");
});

test("classify: priority — a row that is both critical and drilling-active classifies Critical", () => {
  const c = E.classify(row({ spp: 4000, wob: 10, rpm: 60, torque: 500, flow: 400 }), null, MIN);
  assert.equal(c.status, "Critical Anomaly/High Pressure Warning");
});

test("classify: all drilling parameters on + bit at bottom = Drilling", () => {
  const c = E.classify(row({ wob: 2, rpm: 20, torque: 150, flow: 200, bitDepth: 1000, holeDepth: 1002 }), null, MIN);
  assert.equal(c.status, "Drilling");
});

test("classify: drilling parameters on but bit off bottom is NOT Drilling", () => {
  const c = E.classify(row({ wob: 2, rpm: 20, torque: 150, flow: 200, bitDepth: 900, holeDepth: 1000 }), null, MIN);
  assert.notEqual(c.status, "Drilling");
});

test("classify: pumps on without WOB/RPM = Circulating", () => {
  const c = E.classify(row({ flow: 200, wob: 0, rpm: 0 }), null, MIN);
  assert.equal(c.status, "Circulating");
});

test("classify: tripping threshold scales with the sampling interval", () => {
  // At a 1-minute interval the per-sample threshold is 32/60 ≈ 0.533 ft.
  // (Values sit clearly above/below the threshold: exact-boundary equality is
  // not meaningful for a float rate computed from subtracted depths.)
  const prev = row({ bitDepth: 1000 });
  const enough = E.classify(row({ bitDepth: 1000.6, hookload: prev.hookload }), prev, MIN);
  assert.equal(enough.status, "Tripping In/Out");
  assert.equal(enough.direction, "in");
  const notEnough = E.classify(row({ bitDepth: 1000.4, hookload: prev.hookload }), prev, MIN);
  assert.notEqual(notEnough.status, "Tripping In/Out");
  // At a 1-hour interval the same 0.6 ft/sample is far below 32 ft/hr.
  const hourly = E.classify(row({ bitDepth: 1000.6, hookload: prev.hookload }), prev, 1);
  assert.notEqual(hourly.status, "Tripping In/Out");
});

test("classify: upward bit movement is Tripping out", () => {
  const prev = row({ bitDepth: 1000 });
  const c = E.classify(row({ bitDepth: 990, hookload: prev.hookload }), prev, MIN);
  assert.equal(c.status, "Tripping In/Out");
  assert.equal(c.direction, "out");
});

test("classify: hookload swing without depth movement = Connection", () => {
  const prev = row({ hookload: 50 });
  const c = E.classify(row({ hookload: 55 }), prev, MIN);
  assert.equal(c.status, "Connection");
});

test("classify: quiet row with no prev = Idle/Standby", () => {
  assert.equal(E.classify(row({}), null, MIN).status, "Idle/Standby");
});

/* ------------------------------------------------------- inferIntervalHours */

test("inferIntervalHours: 1-minute data -> 1/60 h; single row -> fallback 1 h", () => {
  const rows = [0, 1, 2, 3].map((m) => ({ rig: "R1", ts: new Date(1700000000000 + m * 60000) }));
  assert.equal(E.inferIntervalHours(rows), 1 / 60);
  assert.equal(E.inferIntervalHours([rows[0]]), 1);
});

test("inferIntervalHours: median is robust against a large data gap", () => {
  const base = 1700000000000;
  const minutes = [0, 1, 2, 3, 4, 60 * 24]; // five 1-min gaps, one 1-day gap
  const rows = minutes.map((m) => ({ rig: "R1", ts: new Date(base + m * 60000) }));
  assert.equal(E.inferIntervalHours(rows), 1 / 60);
});

/* ----------------------------------------------------------------- parseCsv */

const HDR = "timestamp,wob,rpm,torque,spp,flow,bit depth,hole depth";

test("parseCsv: tolerant header aliases and unit suffixes", () => {
  const csv = "Date time server,WOB (klb),Surface RPM,Rotary Torque (kft-lb),Standpipe Pressure (psi),Mud Flow In (gpm),Bit Depth (ftMD),Hole Depth (ftMD)\n" +
    "2026-01-01T10:00:00,5,60,500,1500,400,999,1000\n";
  const rows = E.parseCsv(csv, "X");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Drilling");
  assert.equal(rows[0].rig, "X"); // no rig column -> default rig label
});

test("parseCsv: quoted fields containing commas", () => {
  const csv = HDR + ",rig id\n" + '2026-01-01T10:00:00,0,0,0,0,0,100,100,"Rig A, Unit 7"\n';
  assert.equal(E.parseCsv(csv, "X")[0].rig, "Rig A, Unit 7");
});

test("parseCsv: missing required column throws a bilingual error", () => {
  assert.throws(() => E.parseCsv("timestamp,wob\n2026-01-01,1\n", "X"), (err) => {
    assert.match(err.i18n.en, /Required column not found/);
    assert.match(err.i18n.id, /Kolom wajib tidak ditemukan/);
    return true;
  });
});

test("parseCsv: empty input and all-invalid timestamps throw", () => {
  assert.throws(() => E.parseCsv("", "X"), (err) => !!err.i18n);
  assert.throws(() => E.parseCsv(HDR + "\nnot-a-date,0,0,0,0,0,1,1\n", "X"), (err) => !!err.i18n);
});

test("parseCsv: missing optional columns default to 0, invalid rows are skipped", () => {
  const csv = HDR + "\n2026-01-01T10:00:00,0,0,0,0,0,100,100\nbogus,0,0,0,0,0,1,1\n";
  const rows = E.parseCsv(csv, "X");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hookload, 0);
  assert.equal(rows[0].rop, 0);
});

test("parseCsv: unordered input comes out chronologically sorted", () => {
  const csv = HDR + "\n" +
    "2026-01-02T10:00:00,0,0,0,0,0,100,100\n" +
    "2026-01-01T10:00:00,0,0,0,0,0,100,100\n" +
    "2026-01-03T10:00:00,0,0,0,0,0,100,100\n";
  assert.deepEqual(E.parseCsv(csv, "X").map((r) => r.ts.getDate()), [1, 2, 3]);
});

test("parseCsv: second-precision rows resample to 1/minute, last reading wins", () => {
  const csv = HDR + "\n" +
    "2026-01-01T10:00:02,1,0,0,0,0,100,100\n" +
    "2026-01-01T10:00:30,2,0,0,0,0,100,100\n" +
    "2026-01-01T10:00:58,3,0,0,0,0,100,100\n" +
    "2026-01-01T10:01:10,4,0,0,0,0,100,100\n";
  const rows = E.parseCsv(csv, "X");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].wob, 3); // last reading within minute 10:00
  assert.equal(rows[0].ts.getSeconds(), 0); // timestamp truncated to the minute
  assert.equal(rows[1].wob, 4);
});

test("serializeCsv: output round-trips through parseCsv", () => {
  const csv = HDR + "\n2026-01-01T10:00:00,5,60,500,1500,400,999,1000\n";
  const rows = E.parseCsv(csv, "X");
  const reparsed = E.parseCsv(E.serializeCsv(rows), "Y");
  assert.equal(reparsed.length, rows.length);
  assert.equal(reparsed[0].wob, rows[0].wob);
  assert.equal(reparsed[0].status, rows[0].status);
});

/* ---------------------------------------------------------------- utilities */

test("parseInputDate: date-input value parses as LOCAL midnight", () => {
  const d = E.parseInputDate("2026-09-09");
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 9);
  // The regression this guards: a 03:00 local row must fall inside a range
  // starting that day (bare "YYYY-MM-DD" via new Date() parses as UTC midnight).
  assert.ok(new Date("2026-09-09T03:00:00").getTime() >= d.getTime());
});

test("tsExtent: single pass min/max, handles 600k rows without stack overflow", () => {
  const rows = Array.from({ length: 600000 }, (_, i) => ({ ts: new Date(1700000000000 + i * 60000) }));
  const ext = E.tsExtent(rows);
  assert.equal(ext.min, 1700000000000);
  assert.equal(ext.max, 1700000000000 + 599999 * 60000);
});

test("decimate: passthrough under the cap; keeps first and last point above it", () => {
  const small = [1, 2, 3].map((n) => ({ n }));
  assert.equal(E.decimate(small, 400).step, 1);
  const big = Array.from({ length: 1000 }, (_, i) => ({ i }));
  const { rows, step } = E.decimate(big, 400);
  assert.ok(step > 1 && rows.length <= 402);
  assert.equal(rows[0].i, 0);
  assert.equal(rows[rows.length - 1].i, 999);
});

test("groupConsecutive: merges runs sharing a key into segments", () => {
  const t = (m) => new Date(1700000000000 + m * 60000);
  const rows = [
    { rig: "R1", ts: t(0), status: "A" }, { rig: "R1", ts: t(1), status: "A" },
    { rig: "R1", ts: t(2), status: "B" }, { rig: "R1", ts: t(3), status: "A" },
  ];
  const segs = E.groupConsecutive(rows, (r) => r.status);
  assert.deepEqual(segs.map((s) => [s.key, s.rows.length]), [["A", 2], ["B", 1], ["A", 1]]);
  assert.equal(segs[0].end.getTime(), t(1).getTime());
});

test("normalizeHeader: strips unit suffixes, %, and extra whitespace", () => {
  assert.equal(E.normalizeHeader("Bit Depth (ftMD)"), "bit depth");
  assert.equal(E.normalizeHeader("Mud Flow Out %"), "mud flow out");
  assert.equal(E.normalizeHeader("  Surface   RPM "), "surface rpm");
});

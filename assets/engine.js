/* Rig status detection engine + CSV import/export.
 *
 * Pure data logic only — no DOM, no UI state:
 *   - in the browser it is inlined before app.src.js by scripts/build.py and
 *     exposed as the global `RigEngine`;
 *   - in Node it can be require()'d directly (module.exports).
 *
 * Errors thrown by parseCsv carry an `i18n` property with {id, en} message
 * pairs; the UI layer picks the active language (engine code must not depend
 * on the UI's language state).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RigEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function i18nError(pair) {
    const e = new Error(pair.id);
    e.i18n = pair;
    return e;
  }

  /* =========================================================================
   * UTILITIES (pure)
   * ====================================================================== */
  /** Parses a date-input value ("YYYY-MM-DD") as LOCAL midnight. A bare date string
   *  passed to new Date() parses as UTC midnight, which would shift the filter
   *  boundary by the timezone offset relative to the locally-parsed data timestamps. */
  function parseInputDate(value) { return new Date(value + "T00:00:00"); }

  /** Stride-based decimation: keeps the array bounded for smooth chart rendering
   *  on large time-series while preserving the first/last point. */
  function decimate(rows, maxPoints) {
    if (rows.length <= maxPoints) return { rows, step: 1 };
    const step = Math.ceil(rows.length / maxPoints);
    const out = [];
    for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
    if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
    return { rows: out, step };
  }

  /** Min/max timestamp over rows in a single pass — spreading into Math.min/max
   *  (Math.min(...arr)) overflows the call stack on large uploads (~125k+ rows). */
  function tsExtent(rows) {
    let min = Infinity, max = -Infinity;
    for (const r of rows) {
      const t = r.ts.getTime();
      if (t < min) min = t;
      if (t > max) max = t;
    }
    return { min, max };
  }

  /** Groups consecutive rows (already sorted by ts within a rig) that share the
   *  same classification into contiguous segments — used by both the status
   *  timeline and the anomaly log table.
   *  `maxGapMs` (optional): a new segment is started when the time gap to the
   *  previous row exceeds it, so segments never visually span holes in the data;
   *  omitted = no gap splitting (merge regardless of gaps). */
  function groupConsecutive(rows, keyFn, maxGapMs) {
    const gapLimit = maxGapMs == null ? Infinity : maxGapMs;
    const segs = [];
    for (const r of rows) {
      const k = keyFn(r);
      const last = segs[segs.length - 1];
      if (last && last.key === k && r.ts - last.end <= gapLimit) {
        last.rows.push(r);
        last.end = r.ts;
      } else {
        segs.push({ key: k, rig: r.rig, start: r.ts, end: r.ts, rows: [r] });
      }
    }
    return segs;
  }

  /* =========================================================================
   * DETECTION ENGINE (rule-based thresholds)
   * ====================================================================== */
  const THRESH = {
    WOB_ON: 2,               // klbs — minimum weight-on-bit that indicates bit/formation contact
    RPM_ON: 20,              // rpm  — minimum rotary speed considered "rotating"
    TORQUE_ON: 150,          // kft-lb — minimum torque considered "loaded" (calibrated from real telemetry percentiles, see docs/technical-summary.md)
    FLOW_ON: 200,            // gpm  — minimum mud flow considered "pumps on"
    SPP_CRITICAL: 3500,      // psi  — standpipe pressure breach -> possible pack-off/kick
    TORQUE_CRITICAL: 3000,   // kft-lb — torque spike while WOB is low -> possible stuck pipe
    DEPTH_EPS: 3,            // ft   — bit considered "at bottom" within this tolerance of hole depth
    TRIP_MIN_RATE_FT_PER_HR: 32, // ft/hr — minimum bit-depth movement rate to call it tripping (scaled by sampling interval, so it works for any CSV's logging frequency)
    CONNECTION_HKLD_DELTA: 5,     // klbs — minimum hookload swing between samples to flag a pipe-handling "connection" pause
  };

  /**
   * classify(curr, prev, intervalHours) -> { status, reason?, direction? }
   * Priority order matters: Critical Anomaly is checked first (safety first),
   * then Drilling, Circulating, Tripping, Connection, and finally Idle/Standby
   * as the default "nothing is happening" state. `intervalHours` is the sampling
   * interval of the dataset in view — inferred from timestamps so uploaded
   * CSVs logged at a different frequency than the embedded sample still classify correctly.
   */
  function classify(curr, prev, intervalHours) {
    if (curr.spp >= THRESH.SPP_CRITICAL || (curr.torque >= THRESH.TORQUE_CRITICAL && curr.wob < THRESH.WOB_ON)) {
      return {
        status: "Critical Anomaly/High Pressure Warning",
        reason: curr.spp >= THRESH.SPP_CRITICAL ? "spp" : "torque",
      };
    }
    const atBottom = Math.abs(curr.bitDepth - curr.holeDepth) <= THRESH.DEPTH_EPS;
    const drillingActive =
      curr.wob >= THRESH.WOB_ON && curr.rpm >= THRESH.RPM_ON &&
      curr.torque >= THRESH.TORQUE_ON && curr.flow >= THRESH.FLOW_ON;
    if (drillingActive && atBottom) return { status: "Drilling" };

    if (curr.flow >= THRESH.FLOW_ON && curr.wob < THRESH.WOB_ON && curr.rpm < THRESH.RPM_ON) {
      return { status: "Circulating" };
    }
    const depthDelta = prev ? curr.bitDepth - prev.bitDepth : 0;
    const tripThresholdFt = THRESH.TRIP_MIN_RATE_FT_PER_HR * intervalHours;
    const isTripping = Math.abs(depthDelta) >= tripThresholdFt && curr.wob < THRESH.WOB_ON && curr.flow < THRESH.FLOW_ON;
    if (isTripping) {
      return { status: "Tripping In/Out", direction: depthDelta > 0 ? "in" : "out" };
    }
    const hkldDelta = prev ? Math.abs(curr.hookload - prev.hookload) : 0;
    if (curr.wob < THRESH.WOB_ON && curr.flow < THRESH.FLOW_ON && hkldDelta >= THRESH.CONNECTION_HKLD_DELTA) {
      return { status: "Connection" };
    }
    return { status: "Idle/Standby" };
  }

  /** Infers the dominant sampling interval (in hours) from consecutive same-rig
   *  timestamps, so KPI/duration math scales to whatever frequency a CSV was logged at. */
  function inferIntervalHours(rows) {
    const byRig = {};
    for (const r of rows) (byRig[r.rig] = byRig[r.rig] || []).push(r.ts.getTime());
    const diffs = [];
    for (const rig in byRig) {
      const ts = byRig[rig].slice().sort((a, b) => a - b);
      for (let i = 1; i < ts.length; i++) {
        const d = ts[i] - ts[i - 1];
        if (d > 0) diffs.push(d);
      }
    }
    if (!diffs.length) return 1;
    diffs.sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];
    return median / 3600000;
  }

  function classifySeries(rows, intervalHours) {
    const byRig = {};
    for (const r of rows) (byRig[r.rig] = byRig[r.rig] || []).push(r);
    for (const rig in byRig) {
      byRig[rig].sort((a, b) => a.ts - b.ts);
      let prev = null;
      for (const r of byRig[rig]) {
        const cls = classify(r, prev, intervalHours);
        r.status = cls.status;
        r.direction = cls.direction;
        r.reason = cls.reason;
        prev = r;
      }
    }
    return rows;
  }

  const STATUS_LIST = [
    "Drilling", "Circulating", "Tripping In/Out", "Connection", "Idle/Standby",
    "Critical Anomaly/High Pressure Warning",
  ];

  /* =========================================================================
   * CSV IMPORT / EXPORT
   * ====================================================================== */
  const CSV_HEADERS = ["Date time server", "Bit Depth (ftMD)", "Hole Depth (ftMD)", "Block Position (ft)", "ROP (ft/h)", "Hookload (klb)", "WOB (klb)", "Rotary Torque (kft-lb)", "Surface RPM", "Standpipe Pressure (psi)", "Mud Flow Out %", "Mud Flow In (gpm)"];
  // Header matching is tolerant of unit suffixes in parentheses/percent signs (e.g. "Bit Depth (ftMD)" -> "bit depth"),
  // so real telemetry exports and simpler hand-made CSVs both work without renaming columns.
  function normalizeHeader(h) {
    return h.toLowerCase().replace(/\([^)]*\)/g, "").replace(/%/g, "").trim().replace(/\s+/g, " ");
  }
  const HEADER_ALIASES = {
    ts: ["date time server", "timestamp", "time", "datetime", "date time"],
    wob: ["wob", "weight on bit"],
    rpm: ["surface rpm", "rpm"],
    torque: ["rotary torque", "torque"],
    spp: ["standpipe pressure", "spp"],
    flow: ["mud flow in", "mud flow rate", "flow", "mudflow"],
    bitDepth: ["bit depth", "bitdepth"],
    holeDepth: ["hole depth", "holedepth"],
  };
  // Optional fields: default to 0 (or "" for rig) when the column is absent, instead of
  // rejecting the file — real telemetry exports have no Rig ID column at all, for example.
  const OPTIONAL_HEADER_ALIASES = {
    rig: ["rig id", "rig_id", "rigid", "rig"],
    blockPosition: ["block position", "bpos"],
    hookload: ["hookload", "hkla"],
    flowOutPct: ["mud flow out", "mfop"],
    rop: ["rop"],
  };

  function parseCsvLine(line) {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  /** Resamples raw rows to one sample per (rig, minute), keeping the LAST reading
   *  of each minute (assumes within-minute row order reflects arrival order).
   *  Timestamps are truncated to minute precision, so high-frequency logs
   *  (e.g. one reading every ~2 s) collapse to 1 row/minute as documented in the
   *  README; rows already logged at >= 1-minute intervals pass through unchanged. */
  function bucketToMinute(rows) {
    const map = new Map();
    for (const r of rows) {
      const minuteMs = Math.floor(r.ts.getTime() / 60000) * 60000;
      if (r.ts.getTime() !== minuteMs) r.ts = new Date(minuteMs);
      map.set(r.rig + "|" + minuteMs, r);
    }
    return [...map.values()];
  }

  function parseCsv(text, defaultRig) {
    const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw i18nError({ id: "File CSV kosong atau tidak memiliki baris data.", en: "CSV file is empty or has no data rows." });
    const headerCells = parseCsvLine(lines[0]).map(normalizeHeader);
    const colIndex = {};
    for (const field in HEADER_ALIASES) {
      const idx = headerCells.findIndex((h) => HEADER_ALIASES[field].includes(h));
      if (idx === -1) throw i18nError({
        id: `Kolom wajib tidak ditemukan: "${field}". Header yang diterima: ${HEADER_ALIASES[field].join(" / ")}`,
        en: `Required column not found: "${field}". Accepted headers: ${HEADER_ALIASES[field].join(" / ")}`,
      });
      colIndex[field] = idx;
    }
    for (const field in OPTIONAL_HEADER_ALIASES) {
      const idx = headerCells.findIndex((h) => OPTIONAL_HEADER_ALIASES[field].includes(h));
      colIndex[field] = idx;
    }
    const rows = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const ts = new Date(cells[colIndex.ts]);
      if (isNaN(ts.getTime())) { skipped++; continue; }
      rows.push({
        ts, rig: colIndex.rig === -1 ? defaultRig : String(cells[colIndex.rig] || defaultRig).trim(),
        wob: parseFloat(cells[colIndex.wob]) || 0,
        rpm: parseFloat(cells[colIndex.rpm]) || 0,
        torque: parseFloat(cells[colIndex.torque]) || 0,
        spp: parseFloat(cells[colIndex.spp]) || 0,
        flow: parseFloat(cells[colIndex.flow]) || 0,
        bitDepth: parseFloat(cells[colIndex.bitDepth]) || 0,
        holeDepth: parseFloat(cells[colIndex.holeDepth]) || 0,
        blockPosition: colIndex.blockPosition === -1 ? 0 : parseFloat(cells[colIndex.blockPosition]) || 0,
        hookload: colIndex.hookload === -1 ? 0 : parseFloat(cells[colIndex.hookload]) || 0,
        flowOutPct: colIndex.flowOutPct === -1 ? 0 : parseFloat(cells[colIndex.flowOutPct]) || 0,
        rop: colIndex.rop === -1 ? 0 : parseFloat(cells[colIndex.rop]) || 0,
      });
    }
    if (!rows.length) throw i18nError({ id: "Tidak ada baris data valid yang dapat diproses.", en: "No valid data rows could be processed." });
    // Sort chronologically once so every downstream consumer (KPI "latest status"
    // per rig, timeline, alerts) can rely on row order even for unordered CSVs.
    const bucketed = bucketToMinute(rows).sort((a, b) => a.ts - b.ts);
    const result = classifySeries(bucketed, inferIntervalHours(bucketed));
    // Carried as a property so callers can report dropped lines without
    // changing the return shape for every consumer of the rows array.
    result.skippedRows = skipped;
    return result;
  }

  function serializeCsv(rows) {
    const lines = [CSV_HEADERS.join(",")];
    for (const r of rows) {
      lines.push([
        r.ts.toISOString(), r.bitDepth.toFixed(2), r.holeDepth.toFixed(2), r.blockPosition.toFixed(2),
        r.rop.toFixed(1), r.hookload.toFixed(2), r.wob.toFixed(2), r.torque.toFixed(2),
        r.rpm.toFixed(1), r.spp.toFixed(0), r.flowOutPct.toFixed(0), r.flow.toFixed(0),
      ].join(","));
    }
    return lines.join("\n");
  }

  return {
    THRESH, STATUS_LIST,
    classify, classifySeries, inferIntervalHours,
    CSV_HEADERS, HEADER_ALIASES, OPTIONAL_HEADER_ALIASES,
    normalizeHeader, parseCsvLine, bucketToMinute, parseCsv, serializeCsv,
    parseInputDate, decimate, tsExtent, groupConsecutive,
  };
});

(function () {
  "use strict";

  /* =========================================================================
   * 0. UTILITIES
   * ====================================================================== */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(rng, min, max) { return min + rng() * (max - min); }
  function debounce(fn, wait) {
    let h;
    return function (...args) { clearTimeout(h); h = setTimeout(() => fn.apply(this, args), wait); };
  }
  function fmtNum(v, d) { return Number(v).toLocaleString("id-ID", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function fmtDateTime(d) {
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateShort(d) {
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short" });
  }
  function toInputDate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
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
  /** Groups consecutive rows (already sorted by ts within a rig) that share the
   *  same classification into contiguous segments — used by both the status
   *  timeline and the anomaly log table. */
  function groupConsecutive(rows, keyFn) {
    const segs = [];
    for (const r of rows) {
      const k = keyFn(r);
      const last = segs[segs.length - 1];
      if (last && last.key === k) {
        last.rows.push(r);
        last.end = r.ts;
      } else {
        segs.push({ key: k, rig: r.rig, start: r.ts, end: r.ts, rows: [r] });
      }
    }
    return segs;
  }

  /* =========================================================================
   * 1. DETECTION ENGINE (rule-based thresholds)
   * ====================================================================== */
  const SAMPLE_INTERVAL_HOURS = 0.25; // sample interval used to synthesize the embedded sample dataset (15 min)
  const THRESH = {
    WOB_ON: 2,               // klbs — minimum weight-on-bit that indicates bit/formation contact
    RPM_ON: 20,              // rpm  — minimum rotary speed considered "rotating"
    TORQUE_ON: 3,            // kft-lb — minimum torque considered "loaded"
    FLOW_ON: 200,            // gpm  — minimum mud flow considered "pumps on"
    SPP_CRITICAL: 3500,      // psi  — standpipe pressure breach -> possible pack-off/kick
    TORQUE_CRITICAL: 28,     // kft-lb — torque spike while WOB is low -> possible stuck pipe
    DEPTH_EPS: 3,            // ft   — bit considered "at bottom" within this tolerance of hole depth
    TRIP_MIN_RATE_FT_PER_HR: 32, // ft/hr — minimum bit-depth movement rate to call it tripping (scaled by sampling interval, so it works for any CSV's logging frequency)
  };

  /**
   * classify(curr, prev, intervalHours) -> { status, reason?, direction? }
   * Priority order matters: Critical Anomaly is checked first (safety first),
   * then Drilling, Circulating, Tripping, and finally Idle/Standby as the
   * default "nothing is happening" state. `intervalHours` is the sampling
   * interval of the dataset in view — inferred from timestamps so uploaded
   * CSVs logged at a different frequency than the 15-min sample still classify correctly.
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
    if (Math.abs(depthDelta) >= tripThresholdFt && curr.wob < THRESH.WOB_ON && curr.flow < THRESH.FLOW_ON) {
      return { status: "Tripping In/Out", direction: depthDelta > 0 ? "in" : "out" };
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
    "Drilling", "Circulating", "Tripping In/Out", "Idle/Standby",
    "Critical Anomaly/High Pressure Warning",
  ];
  function statusColorVar(status) {
    switch (status) {
      case "Drilling": return "--s1-blue";
      case "Circulating": return "--s3-aqua";
      case "Tripping In/Out": return "--s2-orange";
      case "Idle/Standby": return "--s7-violet";
      case "Critical Anomaly/High Pressure Warning": return "--status-critical";
      default: return "--text-muted";
    }
  }

  /* =========================================================================
   * 2. SAMPLE DATA GENERATOR (seeded — fully reproducible across runs)
   * ====================================================================== */
  const PHASE_PARAMS = {
    idle:        { wob: [0, 0.4],   rpm: [0, 0],    torque: [0, 0.3],   spp: [0, 15],      flow: [0, 0],     rop: [0, 0] },
    tripIn:      { wob: [0.2, 0.8], rpm: [0, 0],    torque: [0.5, 1.5], spp: [0, 10],      flow: [0, 0],     rop: [130, 190] },
    tripOut:     { wob: [0.2, 0.8], rpm: [0, 0],    torque: [0.5, 1.5], spp: [0, 10],      flow: [0, 0],     rop: [-170, -110] },
    drilling:    { wob: [8, 22],    rpm: [60, 140], torque: [8, 18],    spp: [2200, 3000], flow: [550, 750], rop: [20, 70] },
    circulating: { wob: [0, 1],     rpm: [0, 8],    torque: [0.5, 2.5], spp: [1800, 2600], flow: [500, 650], rop: [0, 0] },
  };
  const CYCLE = ["idle", "tripIn", "drilling", "circulating", "drilling", "tripOut"];
  const DURATION_RANGE = { idle: [2, 6], tripIn: [2, 6], tripOut: [2, 6], drilling: [10, 28], circulating: [2, 5] };

  function buildPlan(rng, targetHours) {
    const plan = [];
    let hours = 0, i = 0;
    while (hours < targetHours) {
      const type = CYCLE[i % CYCLE.length];
      const [lo, hi] = DURATION_RANGE[type];
      let dur = Math.round(rand(rng, lo, hi));
      if (hours + dur > targetHours) dur = targetHours - hours;
      if (dur <= 0) break;
      plan.push({ type, hours: dur });
      hours += dur; i++;
    }
    return plan;
  }

  function buildRigSeries(rigMeta, startDate, rng, targetHours) {
    const plan = buildPlan(rng, targetHours);
    const rows = [];
    let bitDepth = rigMeta.startHole - rand(rng, 600, 900);
    let holeDepth = rigMeta.startHole;
    let t = new Date(startDate);
    const samplesPerHour = 1 / SAMPLE_INTERVAL_HOURS;

    for (const phase of plan) {
      const p = PHASE_PARAMS[phase.type];
      const nSamples = Math.round(phase.hours * samplesPerHour);
      for (let s = 0; s < nSamples; s++) {
        const wob = Math.max(0, rand(rng, p.wob[0], p.wob[1]));
        const rpm = Math.max(0, rand(rng, p.rpm[0], p.rpm[1]));
        const torque = Math.max(0, rand(rng, p.torque[0], p.torque[1]));
        const spp = Math.max(0, rand(rng, p.spp[0], p.spp[1]));
        const flow = Math.max(0, rand(rng, p.flow[0], p.flow[1]));
        const ropHr = rand(rng, p.rop[0], p.rop[1]);
        const deltaDepth = ropHr * SAMPLE_INTERVAL_HOURS;

        if (phase.type === "drilling") {
          bitDepth += deltaDepth;
          holeDepth = Math.max(holeDepth, bitDepth);
        } else if (phase.type === "tripIn") {
          bitDepth = Math.min(holeDepth, bitDepth + deltaDepth);
        } else if (phase.type === "tripOut") {
          bitDepth = Math.max(50, bitDepth + deltaDepth);
        }

        rows.push({
          ts: new Date(t), rig: rigMeta.id, wob, rpm, torque, spp, flow,
          bitDepth, holeDepth, _phase: phase.type,
        });
        t = new Date(t.getTime() + SAMPLE_INTERVAL_HOURS * 3600 * 1000);
      }
    }
    return rows;
  }

  function injectAnomaly(rows, rng, mode) {
    const drillingIdx = [];
    for (let i = Math.floor(rows.length * 0.2); i < Math.floor(rows.length * 0.8); i++) {
      if (rows[i]._phase === "drilling") drillingIdx.push(i);
    }
    if (!drillingIdx.length) return;
    const start = drillingIdx[Math.floor(rand(rng, 0, drillingIdx.length - 4))];
    for (let k = 0; k < 4 && start + k < rows.length; k++) {
      const r = rows[start + k];
      if (mode === "spp") {
        r.spp = rand(rng, 3700, 4300);
        r.flow = rand(rng, 100, 250);
        r.wob = rand(rng, 0.5, 1.5);
      } else {
        r.torque = rand(rng, 29, 34);
        r.wob = rand(rng, 0.5, 1.5);
      }
    }
  }

  const RIG_META = [
    { id: "RIG-01", name: "PDSI Rig-07", startHole: 2500, seed: 111, anomaly: "spp" },
    { id: "RIG-02", name: "PDSI Rig-12", startHole: 4200, seed: 222, anomaly: "torque" },
    { id: "RIG-03", name: "PDSI Rig-15", startHole: 1500, seed: 333, anomaly: null },
  ];
  const SAMPLE_START_DATE = new Date("2026-09-10T00:00:00");
  const SAMPLE_TARGET_HOURS = 150;

  function generateSampleRows() {
    let all = [];
    for (const meta of RIG_META) {
      const rng = mulberry32(meta.seed);
      const rows = buildRigSeries(meta, SAMPLE_START_DATE, rng, SAMPLE_TARGET_HOURS);
      if (meta.anomaly) injectAnomaly(rows, rng, meta.anomaly);
      all = all.concat(rows);
    }
    return classifySeries(all, SAMPLE_INTERVAL_HOURS);
  }

  /* =========================================================================
   * 3. CSV IMPORT / EXPORT
   * ====================================================================== */
  const CSV_HEADERS = ["Timestamp", "Rig ID", "Weight on Bit", "RPM", "Torque", "Standpipe Pressure", "Mud Flow Rate", "Bit Depth", "Hole Depth"];
  const HEADER_ALIASES = {
    ts: ["timestamp", "time", "datetime", "date_time", "date time"],
    rig: ["rig id", "rig_id", "rigid", "rig"],
    wob: ["weight on bit", "wob", "weight_on_bit"],
    rpm: ["rpm"],
    torque: ["torque"],
    spp: ["standpipe pressure", "spp", "standpipe_pressure"],
    flow: ["mud flow rate", "flow", "mud_flow_rate", "mudflow", "mud flow"],
    bitDepth: ["bit depth", "bitdepth", "bit_depth"],
    holeDepth: ["hole depth", "holedepth", "hole_depth"],
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

  function parseCsv(text) {
    const lines = text.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("File CSV kosong atau tidak memiliki baris data.");
    const headerCells = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const colIndex = {};
    for (const field in HEADER_ALIASES) {
      const idx = headerCells.findIndex((h) => HEADER_ALIASES[field].includes(h));
      if (idx === -1) throw new Error(`Kolom wajib tidak ditemukan: "${field}". Header yang diterima: ${HEADER_ALIASES[field].join(" / ")}`);
      colIndex[field] = idx;
    }
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const ts = new Date(cells[colIndex.ts]);
      if (isNaN(ts.getTime())) continue;
      rows.push({
        ts, rig: String(cells[colIndex.rig] || "UNKNOWN").trim(),
        wob: parseFloat(cells[colIndex.wob]) || 0,
        rpm: parseFloat(cells[colIndex.rpm]) || 0,
        torque: parseFloat(cells[colIndex.torque]) || 0,
        spp: parseFloat(cells[colIndex.spp]) || 0,
        flow: parseFloat(cells[colIndex.flow]) || 0,
        bitDepth: parseFloat(cells[colIndex.bitDepth]) || 0,
        holeDepth: parseFloat(cells[colIndex.holeDepth]) || 0,
      });
    }
    if (!rows.length) throw new Error("Tidak ada baris data valid yang dapat diproses.");
    return classifySeries(rows, inferIntervalHours(rows));
  }

  function serializeCsv(rows) {
    const lines = [CSV_HEADERS.join(",")];
    for (const r of rows) {
      lines.push([
        r.ts.toISOString(), r.rig, r.wob.toFixed(2), r.rpm.toFixed(1), r.torque.toFixed(2),
        r.spp.toFixed(0), r.flow.toFixed(0), r.bitDepth.toFixed(1), r.holeDepth.toFixed(1),
      ].join(","));
    }
    return lines.join("\n");
  }

  /* =========================================================================
   * 4. APP STATE
   * ====================================================================== */
  const SAMPLE_ROWS = generateSampleRows();
  const PARAM_META = [
    { key: "wob", label: "Weight on Bit", unit: "klbs", colorVar: "--s1-blue" },
    { key: "rpm", label: "RPM", unit: "rpm", colorVar: "--s2-orange" },
    { key: "torque", label: "Torque", unit: "kft-lb", colorVar: "--s3-aqua" },
    { key: "spp", label: "Standpipe Pressure", unit: "psi", colorVar: "--s4-yellow" },
    { key: "flow", label: "Mud Flow Rate", unit: "gpm", colorVar: "--s5-magenta" },
    { key: "bitDepth", label: "Bit Depth", unit: "ft", colorVar: "--s6-green" },
    { key: "holeDepth", label: "Hole Depth", unit: "ft", colorVar: "--s7-violet" },
  ];

  const state = {
    rows: SAMPLE_ROWS,
    rigs: [...new Set(SAMPLE_ROWS.map((r) => r.rig))].sort(),
    selectedRigs: new Set(),
    startDate: null,
    endDate: null,
    focusRig: null,
    visibleParams: new Set(["wob", "spp", "bitDepth"]),
    sourceLabel: "Data Sample (Sintetis)",
    sortCol: "start",
    sortDir: "desc",
    intervalHours: SAMPLE_INTERVAL_HOURS,
  };

  function resetFiltersToFullRange() {
    state.selectedRigs = new Set(state.rigs);
    const ts = state.rows.map((r) => r.ts.getTime());
    state.startDate = new Date(Math.min(...ts));
    state.endDate = new Date(Math.max(...ts));
    state.focusRig = state.rigs[0] || null;
    state.intervalHours = inferIntervalHours(state.rows);
  }
  resetFiltersToFullRange();

  function getFilteredRows() {
    const startMs = state.startDate.getTime();
    const endMs = state.endDate.getTime() + 24 * 3600 * 1000 - 1;
    return state.rows.filter((r) => state.selectedRigs.has(r.rig) && r.ts.getTime() >= startMs && r.ts.getTime() <= endMs);
  }
  function getFocusRows() {
    const startMs = state.startDate.getTime();
    const endMs = state.endDate.getTime() + 24 * 3600 * 1000 - 1;
    return state.rows.filter((r) => r.rig === state.focusRig && r.ts.getTime() >= startMs && r.ts.getTime() <= endMs);
  }

  /* =========================================================================
   * 5. CHART.JS INSTANCES
   * ====================================================================== */
  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = cssVar("--text-secondary");
  Chart.defaults.borderColor = cssVar("--gridline");

  let trendChart = null;
  let donutChart = null;

  function renderTrendChart() {
    const rowsAll = getFocusRows();
    const { rows, step } = decimate(rowsAll, 400);
    document.getElementById("decimationNote").textContent =
      step > 1 ? `Menampilkan ${rows.length} dari ${rowsAll.length} titik data (downsampling 1:${step}) untuk menjaga performa render.` : "";
    document.getElementById("focusRigLabel").textContent = state.focusRig ? `— ${state.focusRig}` : "";

    const labels = rows.map((r) => fmtDateTime(r.ts));
    const datasets = PARAM_META.filter((p) => state.visibleParams.has(p.key)).map((p) => {
      const values = rows.map((r) => r[p.key]);
      const min = Math.min(...values), max = Math.max(...values);
      const norm = values.map((v) => (max > min ? ((v - min) / (max - min)) * 100 : 50));
      const color = cssVar(p.colorVar);
      return {
        label: `${p.label} (${p.unit})`,
        data: norm,
        _raw: values,
        borderColor: color,
        backgroundColor: color,
        pointRadius: rows.length > 150 ? 0 : 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.25,
        spanGaps: true,
      };
    });

    const cfg = {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => {
                const ds = item.dataset;
                const raw = ds._raw[item.dataIndex];
                return `${ds.label}: ${fmtNum(raw, raw < 10 ? 2 : 0)}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: cssVar("--text-muted"), maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: cssVar("--gridline") } },
          y: { min: 0, max: 100, ticks: { callback: (v) => v + "%", color: cssVar("--text-muted") }, grid: { color: cssVar("--gridline") }, title: { display: true, text: "Normalized (% of range)", color: cssVar("--text-muted") } },
        },
      },
    };

    if (trendChart) { trendChart.data = cfg.data; trendChart.options = cfg.options; trendChart.update("none"); }
    else trendChart = new Chart(document.getElementById("trendChart").getContext("2d"), cfg);
  }

  function renderDonut(filteredRows) {
    const hoursByStatus = {};
    for (const s of STATUS_LIST) hoursByStatus[s] = 0;
    for (const r of filteredRows) hoursByStatus[r.status] = (hoursByStatus[r.status] || 0) + state.intervalHours;
    const totalHours = filteredRows.length * state.intervalHours;

    const labels = STATUS_LIST;
    const data = labels.map((s) => hoursByStatus[s] || 0);
    const colors = labels.map((s) => cssVar(statusColorVar(s)));

    const cfg = {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: cssVar("--surface-1"), borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const hrs = item.raw; const pct = totalHours > 0 ? (hrs / totalHours) * 100 : 0;
                return `${item.label}: ${fmtNum(hrs, 1)} jam (${fmtNum(pct, 1)}%)`;
              },
            },
          },
        },
        cutout: "62%",
      },
    };
    if (donutChart) { donutChart.data = cfg.data; donutChart.update("none"); }
    else donutChart = new Chart(document.getElementById("donutChart").getContext("2d"), cfg);

    const legend = document.getElementById("donutLegend");
    legend.innerHTML = "";
    labels.forEach((s) => {
      const hrs = hoursByStatus[s] || 0;
      const pct = totalHours > 0 ? (hrs / totalHours) * 100 : 0;
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="dot" style="background:${cssVar(statusColorVar(s))}"></span>
        <span class="name">${s}</span>
        <span class="pct">${fmtNum(pct, 1)}%</span>
        <span class="hrs">${fmtNum(hrs, 1)} j</span>`;
      legend.appendChild(row);
    });

    const tableWrap = document.getElementById("donutTableWrap");
    tableWrap.innerHTML = `<table class="alert-table"><thead><tr><th>Status</th><th>Jam</th><th>%</th></tr></thead><tbody>${
      labels.map((s) => `<tr><td>${s}</td><td class="tabular">${fmtNum(hoursByStatus[s] || 0, 1)}</td><td class="tabular">${fmtNum(totalHours > 0 ? ((hoursByStatus[s] || 0) / totalHours) * 100 : 0, 1)}%</td></tr>`).join("")
    }</tbody></table>`;
  }

  /* =========================================================================
   * 6. TIMELINE (custom lightweight DOM — no chart lib needed for a Gantt-style swimlane)
   * ====================================================================== */
  let timelineTooltipEl = null;
  function renderTimeline(filteredRows) {
    const root = document.getElementById("timelineRoot");
    root.innerHTML = "";
    if (!filteredRows.length) {
      root.innerHTML = `<div class="empty-state">Tidak ada data pada filter saat ini.</div>`;
      return;
    }
    const rangeStart = state.startDate.getTime();
    const rangeEnd = state.endDate.getTime() + 24 * 3600 * 1000 - 1;
    const span = rangeEnd - rangeStart;

    const rigsSorted = [...state.selectedRigs].sort();
    for (const rig of rigsSorted) {
      const rows = filteredRows.filter((r) => r.rig === rig).sort((a, b) => a.ts - b.ts);
      if (!rows.length) continue;
      const segs = groupConsecutive(rows, (r) => r.status);

      const rowEl = document.createElement("div");
      rowEl.className = "timeline-rig-row";
      const label = document.createElement("div");
      label.className = "rig-label"; label.textContent = rig;
      const track = document.createElement("div");
      track.className = "timeline-track";

      segs.forEach((seg) => {
        const segStart = seg.start.getTime();
        const segEndExclusive = seg.end.getTime() + state.intervalHours * 3600 * 1000;
        const left = Math.max(0, ((segStart - rangeStart) / span) * 100);
        const width = Math.max(0.3, ((segEndExclusive - segStart) / span) * 100);
        const div = document.createElement("div");
        div.className = "timeline-seg";
        div.style.left = left + "%";
        div.style.width = width + "%";
        div.style.background = cssVar(statusColorVar(seg.key));
        const durHrs = seg.rows.length * state.intervalHours;
        div.addEventListener("mouseenter", (ev) => showTimelineTooltip(ev, `<strong>${seg.key}</strong><br>${rig} · ${fmtDateTime(seg.start)} – ${fmtDateTime(seg.end)}<br>Durasi: ${fmtNum(durHrs, 2)} jam`));
        div.addEventListener("mousemove", moveTimelineTooltip);
        div.addEventListener("mouseleave", hideTimelineTooltip);
        track.appendChild(div);
      });

      rowEl.appendChild(label); rowEl.appendChild(track);
      root.appendChild(rowEl);
    }

    const axisRow = document.createElement("div");
    axisRow.className = "timeline-axis";
    const axisLabel = document.createElement("div");
    const ticksWrap = document.createElement("div"); ticksWrap.className = "ticks";
    const N_TICKS = 6;
    for (let i = 0; i <= N_TICKS; i++) {
      const tMs = rangeStart + (span * i) / N_TICKS;
      const span2 = document.createElement("span");
      span2.style.left = (i / N_TICKS) * 100 + "%";
      span2.textContent = fmtDateShort(new Date(tMs));
      ticksWrap.appendChild(span2);
    }
    axisRow.appendChild(axisLabel); axisRow.appendChild(ticksWrap);
    root.appendChild(axisRow);

    const defList = document.getElementById("statusDefList");
    defList.innerHTML = STATUS_LIST.map((s) => `<div class="item"><span class="dot" style="background:${cssVar(statusColorVar(s))}"></span><span>${s}</span></div>`).join("");
  }
  function showTimelineTooltip(ev, html) {
    hideTimelineTooltip();
    timelineTooltipEl = document.createElement("div");
    timelineTooltipEl.className = "timeline-tooltip";
    timelineTooltipEl.innerHTML = html;
    document.body.appendChild(timelineTooltipEl);
    moveTimelineTooltip(ev);
  }
  function moveTimelineTooltip(ev) {
    if (!timelineTooltipEl) return;
    timelineTooltipEl.style.left = ev.clientX + 14 + "px";
    timelineTooltipEl.style.top = ev.clientY + 14 + "px";
  }
  function hideTimelineTooltip() {
    if (timelineTooltipEl) { timelineTooltipEl.remove(); timelineTooltipEl = null; }
  }

  /* =========================================================================
   * 7. KPI PANEL
   * ====================================================================== */
  function renderKpis(filteredRows) {
    const grid = document.getElementById("kpiGrid");
    const totalHours = filteredRows.length * state.intervalHours;
    const byRig = {};
    for (const r of filteredRows) (byRig[r.rig] = byRig[r.rig] || []).push(r);

    let activeCount = 0;
    for (const rig in byRig) {
      const last = byRig[rig][byRig[rig].length - 1];
      if (last && ["Drilling", "Circulating", "Tripping In/Out"].includes(last.status)) activeCount++;
    }
    const totalRigsInFilter = Object.keys(byRig).length;

    let productiveHours = 0, idleHours = 0, criticalHours = 0;
    for (const r of filteredRows) {
      if (["Drilling", "Circulating", "Tripping In/Out"].includes(r.status)) productiveHours += state.intervalHours;
      else if (r.status === "Idle/Standby") idleHours += state.intervalHours;
      else if (r.status.startsWith("Critical")) criticalHours += state.intervalHours;
    }
    const efficiencyPct = totalHours > 0 ? (productiveHours / totalHours) * 100 : 0;
    const downtimeHours = idleHours + criticalHours;
    const downtimePct = totalHours > 0 ? (downtimeHours / totalHours) * 100 : 0;

    const tiles = [
      { label: "Total Jam Termonitor", value: fmtNum(totalHours, 0), unit: "jam", sub: `${totalRigsInFilter} rig pada rentang terpilih` },
      { label: "Active Rig Count", value: `${activeCount}`, unit: `/ ${totalRigsInFilter}`, sub: "rig sedang beroperasi (bukan Idle) di titik waktu terakhir" },
      { label: "Fleet Operational Efficiency", value: fmtNum(efficiencyPct, 1), unit: "%", sub: `${fmtNum(productiveHours, 0)} jam produktif`, cls: efficiencyPct >= 70 ? "good" : (efficiencyPct < 40 ? "bad" : "") },
      { label: "Downtime (Idle + Anomaly)", value: fmtNum(downtimeHours, 0), unit: "jam", sub: `${fmtNum(downtimePct, 1)}% dari total · ${fmtNum(criticalHours, 1)} jam anomali kritikal`, cls: criticalHours > 0 ? "bad" : "" },
    ];
    grid.innerHTML = tiles.map((t) => `
      <div class="card kpi-tile">
        <div class="label">${t.label}</div>
        <div class="value tabular">${t.value}<small>${t.unit}</small></div>
        <div class="sub ${t.cls || ""}">${t.sub}</div>
      </div>`).join("");
  }

  /* =========================================================================
   * 8. ALERT & LOG TABLE
   * ====================================================================== */
  function computeAlerts(filteredRows) {
    const alerts = [];
    const byRig = {};
    for (const r of filteredRows) (byRig[r.rig] = byRig[r.rig] || []).push(r);
    for (const rig in byRig) {
      const rows = byRig[rig].sort((a, b) => a.ts - b.ts);
      const segs = groupConsecutive(rows, (r) => r.status).filter((s) => s.key.startsWith("Critical"));
      for (const seg of segs) {
        const peakSpp = Math.max(...seg.rows.map((r) => r.spp));
        const peakTorque = Math.max(...seg.rows.map((r) => r.torque));
        const minWob = Math.min(...seg.rows.map((r) => r.wob));
        const durHrs = seg.rows.length * state.intervalHours;
        const causeSpp = peakSpp >= THRESH.SPP_CRITICAL;
        alerts.push({
          rig, start: seg.start, end: seg.end, duration: durHrs,
          peakSpp, peakTorque, minWob,
          cause: causeSpp
            ? `Standpipe pressure melewati ambang ${THRESH.SPP_CRITICAL} psi — indikasi pack-off / restriction pada annulus.`
            : `Torque melewati ambang ${THRESH.TORQUE_CRITICAL} kft-lb saat WOB < ${THRESH.WOB_ON} klbs — indikasi stuck pipe / differential sticking.`,
        });
      }
    }
    return alerts;
  }

  function renderAlerts(filteredRows) {
    let alerts = computeAlerts(filteredRows);
    const dirMul = state.sortDir === "asc" ? 1 : -1;
    const colMap = { rig: "rig", start: "start", end: "end", duration: "duration", peakSpp: "peakSpp", peakTorque: "peakTorque", minWob: "minWob" };
    const key = colMap[state.sortCol] || "start";
    alerts.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av instanceof Date) return (av - bv) * dirMul;
      if (typeof av === "string") return av.localeCompare(bv) * dirMul;
      return (av - bv) * dirMul;
    });

    document.getElementById("alertCountHint").textContent = alerts.length ? `— ${alerts.length} kejadian` : "";
    const tbody = document.getElementById("alertTableBody");
    const emptyState = document.getElementById("alertEmptyState");
    if (!alerts.length) { tbody.innerHTML = ""; emptyState.hidden = false; return; }
    emptyState.hidden = true;

    tbody.innerHTML = alerts.map((a) => `
      <tr>
        <td>${a.rig}</td>
        <td class="tabular">${fmtDateTime(a.start)}</td>
        <td class="tabular">${fmtDateTime(a.end)}</td>
        <td class="tabular">${fmtNum(a.duration, 2)} j</td>
        <td class="tabular">${fmtNum(a.peakSpp, 0)} psi</td>
        <td class="tabular">${fmtNum(a.peakTorque, 1)} kft-lb</td>
        <td class="tabular">${fmtNum(a.minWob, 1)} klbs</td>
        <td>${a.cause}</td>
        <td><span class="badge critical">⚠ Critical</span></td>
      </tr>`).join("");
  }

  /* =========================================================================
   * 9. FILTER UI (rig chips, dates, presets, param chips, focus rig select)
   * ====================================================================== */
  function renderRigChips() {
    const wrap = document.getElementById("rigChips");
    wrap.innerHTML = "";
    state.rigs.forEach((rig, i) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip";
      chip.setAttribute("aria-pressed", state.selectedRigs.has(rig));
      const dotColors = ["--s1-blue", "--s2-orange", "--s3-aqua", "--s5-magenta", "--s7-violet"];
      chip.innerHTML = `<span class="dot" style="background:${cssVar(dotColors[i % dotColors.length])}"></span>${rig}`;
      chip.addEventListener("click", () => {
        if (state.selectedRigs.has(rig)) state.selectedRigs.delete(rig); else state.selectedRigs.add(rig);
        renderRigChips(); syncFocusRigSelect(); scheduleRender();
      });
      wrap.appendChild(chip);
    });
  }

  function syncFocusRigSelect() {
    const sel = document.getElementById("focusRigSelect");
    const selected = [...state.selectedRigs].sort();
    sel.innerHTML = selected.map((r) => `<option value="${r}">${r}</option>`).join("");
    if (!selected.includes(state.focusRig)) state.focusRig = selected[0] || null;
    sel.value = state.focusRig || "";
  }

  function renderParamChips() {
    const wrap = document.getElementById("paramChips");
    wrap.innerHTML = "";
    PARAM_META.forEach((p) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip";
      chip.setAttribute("aria-pressed", state.visibleParams.has(p.key));
      chip.innerHTML = `<span class="dot" style="background:${cssVar(p.colorVar)}"></span>${p.label}`;
      chip.addEventListener("click", () => {
        if (state.visibleParams.has(p.key)) state.visibleParams.delete(p.key); else state.visibleParams.add(p.key);
        renderParamChips(); renderTrendChart();
      });
      wrap.appendChild(chip);
    });
  }

  function bindFilterControls() {
    document.getElementById("startDate").addEventListener("change", debounce((e) => {
      state.startDate = new Date(e.target.value); scheduleRender();
    }, 150));
    document.getElementById("endDate").addEventListener("change", debounce((e) => {
      state.endDate = new Date(e.target.value); scheduleRender();
    }, 150));
    document.getElementById("focusRigSelect").addEventListener("change", (e) => {
      state.focusRig = e.target.value; renderTrendChart();
    });
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset;
        const dataEnd = new Date(Math.max(...state.rows.filter(r=>state.selectedRigs.has(r.rig)).map((r) => r.ts.getTime())));
        const dataStart = new Date(Math.min(...state.rows.filter(r=>state.selectedRigs.has(r.rig)).map((r) => r.ts.getTime())));
        if (preset === "all") { state.startDate = dataStart; state.endDate = dataEnd; }
        else {
          const days = preset === "24h" ? 1 : preset === "3d" ? 3 : 7;
          state.startDate = new Date(dataEnd.getTime() - days * 24 * 3600 * 1000);
          state.endDate = dataEnd;
        }
        syncDateInputs(); scheduleRender();
      });
    });
    document.getElementById("donutTableToggle").addEventListener("click", (e) => {
      const wrap = document.getElementById("donutTableWrap");
      wrap.hidden = !wrap.hidden;
      e.target.textContent = wrap.hidden ? "Tampilkan tabel" : "Sembunyikan tabel";
    });
    document.querySelectorAll("#alertTable th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (state.sortCol === col) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortCol = col; state.sortDir = "desc"; }
        renderAlerts(getFilteredRows());
      });
    });
  }

  function syncDateInputs() {
    document.getElementById("startDate").value = toInputDate(state.startDate);
    document.getElementById("endDate").value = toInputDate(state.endDate);
  }

  /* =========================================================================
   * 10. CSV UPLOAD / DOWNLOAD / RESET
   * ====================================================================== */
  function showBanner(msg, type) {
    const el = document.getElementById("uploadBanner");
    el.textContent = msg; el.hidden = false; el.className = type ? type : "";
  }
  function loadDataset(rows, label) {
    state.rows = rows;
    state.rigs = [...new Set(rows.map((r) => r.rig))].sort();
    state.sourceLabel = label;
    resetFiltersToFullRange();
    renderRigChips(); syncFocusRigSelect(); syncDateInputs(); renderParamChips();
    fullRender();
  }
  function bindDataControls() {
    document.getElementById("csvInput").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = parseCsv(reader.result);
          loadDataset(rows, `Upload: ${file.name}`);
          showBanner(`Berhasil memuat ${rows.length} baris dari ${state.rigs.length} rig (${file.name}).`, "ok");
        } catch (err) {
          showBanner(`Gagal memproses CSV: ${err.message}`, "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
    document.getElementById("downloadSampleBtn").addEventListener("click", () => {
      downloadBlob("sample_rig_data.csv", serializeCsv(SAMPLE_ROWS));
    });
    document.getElementById("resetSampleBtn").addEventListener("click", () => {
      loadDataset(SAMPLE_ROWS, "Data Sample (Sintetis)");
      document.getElementById("uploadBanner").hidden = true;
    });
    document.getElementById("themeToggle").addEventListener("click", () => {
      const root = document.documentElement;
      const current = root.getAttribute("data-theme");
      const next = current === "dark" ? "light" : current === "light" ? null : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
      if (next) root.setAttribute("data-theme", next); else root.removeAttribute("data-theme");
      Chart.defaults.color = cssVar("--text-secondary");
      Chart.defaults.borderColor = cssVar("--gridline");
      trendChart = null; donutChart = null;
      document.getElementById("trendChart").replaceWith(Object.assign(document.createElement("canvas"), { id: "trendChart" }));
      document.getElementById("donutChart").replaceWith(Object.assign(document.createElement("canvas"), { id: "donutChart" }));
      fullRender();
    });
  }

  /* =========================================================================
   * 11. ENGINE EXPLAINER (mirrors README classification matrix)
   * ====================================================================== */
  function renderEngineExplainer() {
    document.getElementById("engineExplainerBody").innerHTML = `
      <table class="alert-table">
        <thead><tr><th>Status</th><th>Kondisi Ambang Batas</th></tr></thead>
        <tbody>
          <tr><td>Critical Anomaly/High Pressure Warning</td><td>SPP ≥ ${THRESH.SPP_CRITICAL} psi, ATAU (Torque ≥ ${THRESH.TORQUE_CRITICAL} kft-lb DAN WOB &lt; ${THRESH.WOB_ON} klbs)</td></tr>
          <tr><td>Drilling</td><td>WOB ≥ ${THRESH.WOB_ON} klbs DAN RPM ≥ ${THRESH.RPM_ON} DAN Torque ≥ ${THRESH.TORQUE_ON} kft-lb DAN Flow ≥ ${THRESH.FLOW_ON} gpm DAN |Bit Depth − Hole Depth| ≤ ${THRESH.DEPTH_EPS} ft</td></tr>
          <tr><td>Circulating</td><td>Flow ≥ ${THRESH.FLOW_ON} gpm DAN WOB &lt; ${THRESH.WOB_ON} klbs DAN RPM &lt; ${THRESH.RPM_ON}</td></tr>
          <tr><td>Tripping In/Out</td><td>Perubahan Bit Depth antar sampel ≥ ${THRESH.TRIP_DEPTH_RATE} ft DAN WOB &lt; ${THRESH.WOB_ON} klbs DAN Flow &lt; ${THRESH.FLOW_ON} gpm</td></tr>
          <tr><td>Idle/Standby</td><td>Kondisi default jika tidak ada aturan di atas yang terpenuhi</td></tr>
        </tbody>
      </table>`;
  }

  /* =========================================================================
   * 12. RENDER PIPELINE
   * ====================================================================== */
  function fullRender() {
    const filtered = getFilteredRows();
    renderKpis(filtered);
    renderTrendChart();
    renderDonut(filtered);
    renderTimeline(filtered);
    renderAlerts(filtered);
  }
  const scheduleRender = debounce(fullRender, 120);

  function init() {
    renderRigChips();
    syncFocusRigSelect();
    syncDateInputs();
    renderParamChips();
    renderEngineExplainer();
    bindFilterControls();
    bindDataControls();
    fullRender();
  }
  document.addEventListener("DOMContentLoaded", init);
})();

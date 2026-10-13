(function () {
  "use strict";

  /* Pure data logic (classification engine, CSV parsing, array utilities) lives
   * in assets/engine.js, which scripts/build.py inlines before this file. */
  const {
    THRESH, STATUS_LIST, inferIntervalHours, parseCsv, serializeCsv,
    decimate, tsExtent, groupConsecutive, parseInputDate,
  } = RigEngine;

  /* =========================================================================
   * 0. UI UTILITIES
   * ====================================================================== */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function debounce(fn, wait) {
    let h;
    return function (...args) { clearTimeout(h); h = setTimeout(() => fn.apply(this, args), wait); };
  }
  function locale() { return state.lang === "en" ? "en-US" : "id-ID"; }
  function fmtNum(v, d) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function escapeAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmtDateTime(d) {
    return d.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateShort(d) {
    return d.toLocaleString(locale(), { day: "2-digit", month: "short" });
  }
  /** Picks the active-language string from a {id, en} pair — the single mechanism
   *  used throughout the app for both static UI text and data-table descriptions. */
  function tr(pair) { return pair[state.lang] || pair.id; }
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
  /** Maps an engine status to its CSS color variable (UI concern, stays here). */
  function statusColorVar(status) {
    switch (status) {
      case "Drilling": return "--s1-blue";
      case "Circulating": return "--s3-aqua";
      case "Tripping In/Out": return "--s2-orange";
      case "Connection": return "--s5-magenta";
      case "Idle/Standby": return "--s7-violet";
      case "Critical Anomaly/High Pressure Warning": return "--status-critical";
      default: return "--text-muted";
    }
  }

  /* =========================================================================
   * 1. APP STATE
   * ====================================================================== */
  // Minute-resampled excerpt of real drilling telemetry, stored in
  // assets/sample-data.csv and inlined into the marker below by scripts/build.py
  // (this file is therefore not runnable unbuilt). Rig identity is not present
  // in the source data, so it's labeled generically below.
  const EMBEDDED_SAMPLE_CSV = `__SAMPLE_CSV__`;

  const SAMPLE_ROWS = parseCsv(EMBEDDED_SAMPLE_CSV, "Rig (Data Riil)");
  const PARAM_META = [
    { key: "wob", label: "Weight on Bit", unit: "klbs", colorVar: "--s1-blue",
      desc: { id: "Weight on Bit — seberapa berat mata bor menekan dasar sumur. Naik saat mata bor benar-benar 'menggigit' batuan.",
              en: "Weight on Bit — how hard the bit is pressing into the bottom of the well. Rises when the bit is actually 'biting' into rock." } },
    { key: "rpm", label: "RPM", unit: "rpm", colorVar: "--s2-orange",
      desc: { id: "RPM — kecepatan putar rangkaian pipa bor (putaran per menit).",
              en: "RPM — rotation speed of the drill string (revolutions per minute)." } },
    { key: "torque", label: "Torque", unit: "kft-lb", colorVar: "--s3-aqua",
      desc: { id: "Torque — besarnya gaya puntir/tahanan saat memutar rangkaian bor. Melonjak tinggi bisa jadi tanda pipa terjepit.",
              en: "Torque — the twisting force/resistance while rotating the drill string. A high spike can indicate a stuck pipe." } },
    { key: "spp", label: "Standpipe Pressure", unit: "psi", colorVar: "--s4-yellow",
      desc: { id: "Standpipe Pressure — tekanan lumpur bor di pipa sebelum masuk sumur. Melonjak tinggi bisa jadi tanda tekanan balik dari formasi (kick).",
              en: "Standpipe Pressure — drilling mud pressure in the pipe before entering the well. A high spike can indicate formation kickback (a kick)." } },
    { key: "flow", label: "Mud Flow In", unit: "gpm", colorVar: "--s5-magenta",
      desc: { id: "Mud Flow In — seberapa deras lumpur bor dipompa masuk untuk mengangkat serpihan bor keluar dari lubang.",
              en: "Mud Flow In — how fast drilling mud is pumped in to carry cuttings out of the hole." } },
    { key: "bitDepth", label: "Bit Depth", unit: "ft", colorVar: "--s6-green",
      desc: { id: "Bit Depth — posisi kedalaman mata bor saat ini di dalam sumur.",
              en: "Bit Depth — the current depth position of the drill bit inside the well." } },
    { key: "holeDepth", label: "Hole Depth", unit: "ft", colorVar: "--s7-violet",
      desc: { id: "Hole Depth — kedalaman lubang sumur yang sudah terbentuk sejauh ini.",
              en: "Hole Depth — the depth of the wellbore that has been drilled so far." } },
    { key: "hookload", label: "Hookload", unit: "klbs", colorVar: "--s8-red",
      desc: { id: "Hookload — berat rangkaian pipa yang tergantung di hook. Berubah tajam saat sambungan pipa (connection) sedang dilakukan.",
              en: "Hookload — the weight of the pipe string hanging on the hook. Changes sharply while a pipe connection is being made." } },
    { key: "blockPosition", label: "Block Position", unit: "ft", colorVar: "--s2-orange",
      desc: { id: "Block Position — ketinggian traveling block di menara bor, indikator gerakan naik/turun rangkaian pipa.",
              en: "Block Position — the height of the traveling block on the derrick, an indicator of the pipe string moving up/down." } },
    { key: "flowOutPct", label: "Mud Flow Out", unit: "%", colorVar: "--s4-yellow",
      desc: { id: "Mud Flow Out — persentase lumpur bor yang keluar relatif terhadap yang dipompa masuk; selisih besar dapat mengindikasikan loss/kick.",
              en: "Mud Flow Out — the percentage of drilling mud returning out relative to what was pumped in; a large gap can indicate loss/a kick." } },
    { key: "rop", label: "Rate of Penetration", unit: "ft/h", colorVar: "--s1-blue",
      desc: { id: "Rate of Penetration (ROP) — kecepatan mata bor menembus formasi.",
              en: "Rate of Penetration (ROP) — the speed at which the bit penetrates the formation." } },
  ];

  const STATUS_DEFS = {
    "Drilling": { id: "Mata bor sedang aktif menembus lapisan tanah/batuan baru — kondisi kerja produktif utama.",
                  en: "The bit is actively penetrating new formation — the main productive work." },
    "Circulating": { id: "Lumpur bor sedang dipompa berputar untuk membersihkan lubang, tapi belum menembus lapisan baru.",
                     en: "Mud is being pumped/circulated to clean the hole, but no new formation is being penetrated yet." },
    "Tripping In/Out": { id: "Rangkaian pipa sedang ditarik naik atau diturunkan dari dalam sumur, misalnya untuk ganti mata bor.",
                          en: "The pipe string is being pulled up or run down the well, e.g. for a bit change." },
    "Connection": { id: "Rangkaian pipa berhenti sejenak untuk menyambung/melepas stand pipa baru — ditandai perubahan hookload tanpa pergerakan kedalaman.",
                    en: "The pipe string briefly pauses to make/break a new pipe stand — marked by a hookload change without depth movement." },
    "Idle/Standby": { id: "Rig sedang tidak melakukan aktivitas apa pun — menunggu, atau maintenance.",
                      en: "The rig is not performing any activity — waiting, or under maintenance." },
    "Critical Anomaly/High Pressure Warning": { id: "Tanda bahaya — tekanan atau tahanan tidak wajar terdeteksi, perlu dicek segera oleh operator.",
                                                 en: "A danger signal — abnormal pressure or torque detected, needs immediate operator attention." },
  };

  const KPI_DEFS = {
    totalHours: { label: { id: "Total Jam Termonitor", en: "Total Hours Monitored" },
      desc: { id: "Total jam data yang tercatat pada rentang waktu dan rig yang sedang difilter.",
              en: "Total hours of data recorded within the currently filtered time range and rigs." } },
    activeRigs: { label: { id: "Active Rig Count", en: "Active Rig Count" },
      desc: { id: "Jumlah rig yang sedang aktif bekerja (Drilling/Circulating/Tripping) pada data terbaru, dari total rig yang difilter.",
              en: "Number of rigs actively working (Drilling/Circulating/Tripping) at the latest data point, out of the filtered rigs." } },
    efficiency: { label: { id: "Fleet Operational Efficiency", en: "Fleet Operational Efficiency" },
      desc: { id: "Persentase waktu rig benar-benar bekerja produktif (Drilling/Circulating/Tripping) dibanding total waktu termonitor. Makin tinggi, makin sedikit waktu terbuang.",
              en: "Percentage of time rigs are actually working productively (Drilling/Circulating/Tripping) versus total monitored time. Higher means less wasted time." } },
    downtime: { label: { id: "Downtime (Idle + Anomaly)", en: "Downtime (Idle + Anomaly)" },
      desc: { id: "Total jam rig dalam kondisi Idle (menganggur) atau Critical Anomaly (bahaya) — waktu yang tidak digunakan untuk bekerja.",
              en: "Total hours rigs spent Idle or in a Critical Anomaly — time not used for productive work." } },
  };

  const state = {
    rows: SAMPLE_ROWS,
    rigs: [...new Set(SAMPLE_ROWS.map((r) => r.rig))].sort(),
    selectedRigs: new Set(),
    startDate: null,
    endDate: null,
    focusRig: null,
    visibleParams: new Set(["wob", "spp", "bitDepth"]),
    sourceLabel: "Sampel Data Riil (Bawaan)",
    sortCol: "start",
    sortDir: "desc",
    intervalHours: 1 / 60,
    alertCauseFilter: new Set(["spp", "torque"]),
    lang: (function () {
      try { return localStorage.getItem("lang") === "en" ? "en" : "id"; } catch (e) { return "id"; }
    })(),
  };

  const ALERT_CAUSE_META = [
    { key: "spp", label: { id: "Tekanan (SPP)", en: "Pressure (SPP)" },
      desc: { id: "Anomali yang dipicu oleh Standpipe Pressure melewati ambang batas — indikasi kick/pack-off.",
              en: "An anomaly triggered by Standpipe Pressure exceeding the threshold — indicates a kick/pack-off." } },
    { key: "torque", label: { id: "Torque/Stuck Pipe", en: "Torque/Stuck Pipe" },
      desc: { id: "Anomali yang dipicu oleh Torque tinggi bersamaan WOB rendah — indikasi pipa terjepit (stuck pipe).",
              en: "An anomaly triggered by high Torque combined with low WOB — indicates a stuck pipe." } },
  ];

  function resetFiltersToFullRange() {
    state.selectedRigs = new Set(state.rigs);
    const ext = tsExtent(state.rows);
    state.startDate = new Date(ext.min);
    state.endDate = new Date(ext.max);
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
   * 2. CHART.JS INSTANCES
   * ====================================================================== */
  Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  Chart.defaults.color = cssVar("--text-secondary");
  Chart.defaults.borderColor = cssVar("--gridline");

  let trendChart = null;
  let donutChart = null;

  /** Destroys the existing chart instances (releasing Chart.js registry entries and
   *  ResizeObservers) and re-reads theme-dependent defaults from CSS variables.
   *  fullRender() recreates the charts on the same canvases afterwards. */
  function resetCharts() {
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    if (donutChart) { donutChart.destroy(); donutChart = null; }
    Chart.defaults.color = cssVar("--text-secondary");
    Chart.defaults.borderColor = cssVar("--gridline");
  }

  function renderTrendChart() {
    const rowsAll = getFocusRows();
    const { rows, step } = decimate(rowsAll, 400);
    document.getElementById("decimationNote").textContent =
      step > 1 ? tr({ id: `Menampilkan ${rows.length} dari ${rowsAll.length} titik data (downsampling 1:${step}) untuk menjaga performa render.`,
                       en: `Showing ${rows.length} of ${rowsAll.length} data points (1:${step} downsampling) to keep rendering fast.` }) : "";
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
          y: { min: 0, max: 100, ticks: { callback: (v) => v + "%", color: cssVar("--text-muted") }, grid: { color: cssVar("--gridline") }, title: { display: true, text: tr({ id: "Dinormalisasi (% dari rentang)", en: "Normalized (% of range)" }), color: cssVar("--text-muted") } },
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
                return `${item.label}: ${fmtNum(hrs, 1)} ${tr({ id: "jam", en: "hr" })} (${fmtNum(pct, 1)}%)`;
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
        <span class="name has-tip" title="${escapeAttr(STATUS_DEFS[s] ? tr(STATUS_DEFS[s]) : "")}">${s}</span>
        <span class="pct">${fmtNum(pct, 1)}%</span>
        <span class="hrs">${fmtNum(hrs, 1)} ${tr({ id: "j", en: "hr" })}</span>`;
      legend.appendChild(row);
    });

    const tableWrap = document.getElementById("donutTableWrap");
    tableWrap.innerHTML = `<table class="alert-table"><thead><tr><th>${tr({ id: "Status", en: "Status" })}</th><th>${tr({ id: "Jam", en: "Hours" })}</th><th>%</th></tr></thead><tbody>${
      labels.map((s) => `<tr><td>${s}</td><td class="tabular">${fmtNum(hoursByStatus[s] || 0, 1)}</td><td class="tabular">${fmtNum(totalHours > 0 ? ((hoursByStatus[s] || 0) / totalHours) * 100 : 0, 1)}%</td></tr>`).join("")
    }</tbody></table>`;
  }

  function updateDonutToggleText() {
    const btn = document.getElementById("donutTableToggle");
    const wrap = document.getElementById("donutTableWrap");
    btn.textContent = wrap.hidden ? tr({ id: "Tampilkan tabel", en: "Show table" }) : tr({ id: "Sembunyikan tabel", en: "Hide table" });
  }

  /* =========================================================================
   * 3. TIMELINE (custom lightweight DOM — no chart lib needed for a Gantt-style swimlane)
   * ====================================================================== */
  let timelineTooltipEl = null;
  function renderTimeline(filteredRows) {
    const root = document.getElementById("timelineRoot");
    root.innerHTML = "";
    if (!filteredRows.length) {
      root.innerHTML = `<div class="empty-state">${tr({ id: "Tidak ada data pada filter saat ini.", en: "No data for the current filter." })}</div>`;
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
        div.addEventListener("mouseenter", (ev) => showTimelineTooltip(ev, `<strong>${seg.key}</strong><br>${STATUS_DEFS[seg.key] ? tr(STATUS_DEFS[seg.key]) : ""}<br>${escapeAttr(rig)} · ${fmtDateTime(seg.start)} – ${fmtDateTime(seg.end)}<br>${tr({ id: "Durasi", en: "Duration" })}: ${fmtNum(durHrs, 2)} ${tr({ id: "jam", en: "hr" })}`));
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
    defList.innerHTML = STATUS_LIST.map((s) => `<div class="item"><span class="dot" style="background:${cssVar(statusColorVar(s))}"></span><span class="has-tip" title="${escapeAttr(STATUS_DEFS[s] ? tr(STATUS_DEFS[s]) : "")}">${s}</span></div>`).join("");
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
   * 4. KPI PANEL
   * ====================================================================== */
  function renderKpis(filteredRows) {
    const grid = document.getElementById("kpiGrid");
    const totalHours = filteredRows.length * state.intervalHours;
    const byRig = {};
    for (const r of filteredRows) (byRig[r.rig] = byRig[r.rig] || []).push(r);

    let activeCount = 0;
    for (const rig in byRig) {
      const last = byRig[rig][byRig[rig].length - 1];
      if (last && ["Drilling", "Circulating", "Tripping In/Out", "Connection"].includes(last.status)) activeCount++;
    }
    const totalRigsInFilter = Object.keys(byRig).length;

    let productiveHours = 0, idleHours = 0, criticalHours = 0;
    for (const r of filteredRows) {
      if (["Drilling", "Circulating", "Tripping In/Out", "Connection"].includes(r.status)) productiveHours += state.intervalHours;
      else if (r.status === "Idle/Standby") idleHours += state.intervalHours;
      else if (r.status.startsWith("Critical")) criticalHours += state.intervalHours;
    }
    const efficiencyPct = totalHours > 0 ? (productiveHours / totalHours) * 100 : 0;
    const downtimeHours = idleHours + criticalHours;
    const downtimePct = totalHours > 0 ? (downtimeHours / totalHours) * 100 : 0;

    const tiles = [
      { key: "totalHours", value: fmtNum(totalHours, 0), unit: tr({ id: "jam", en: "hr" }), sub: tr({ id: `${totalRigsInFilter} rig pada rentang terpilih`, en: `${totalRigsInFilter} rigs in selected range` }) },
      { key: "activeRigs", value: `${activeCount}`, unit: `/ ${totalRigsInFilter}`, sub: tr({ id: "rig sedang beroperasi (bukan Idle) di titik waktu terakhir", en: "rigs currently operating (not Idle) at the latest time point" }) },
      { key: "efficiency", value: fmtNum(efficiencyPct, 1), unit: "%", sub: tr({ id: `${fmtNum(productiveHours, 0)} jam produktif`, en: `${fmtNum(productiveHours, 0)} productive hours` }), cls: efficiencyPct >= 70 ? "good" : (efficiencyPct < 40 ? "bad" : "") },
      { key: "downtime", value: fmtNum(downtimeHours, 0), unit: tr({ id: "jam", en: "hr" }), sub: tr({ id: `${fmtNum(downtimePct, 1)}% dari total · ${fmtNum(criticalHours, 1)} jam anomali kritikal`, en: `${fmtNum(downtimePct, 1)}% of total · ${fmtNum(criticalHours, 1)} hr critical anomaly` }), cls: criticalHours > 0 ? "bad" : "" },
    ];
    grid.innerHTML = tiles.map((t) => `
      <div class="card kpi-tile">
        <div class="label has-tip" title="${escapeAttr(tr(KPI_DEFS[t.key].desc))}">${tr(KPI_DEFS[t.key].label)}</div>
        <div class="value tabular">${t.value}<small>${t.unit}</small></div>
        <div class="sub ${t.cls || ""}">${t.sub}</div>
      </div>`).join("");
  }

  /* =========================================================================
   * 5. ALERT & LOG TABLE
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
          causeKey: causeSpp ? "spp" : "torque",
          cause: causeSpp
            ? tr({ id: `Standpipe pressure melewati ambang ${THRESH.SPP_CRITICAL} psi — indikasi pack-off / restriction pada annulus.`,
                   en: `Standpipe pressure exceeded the ${THRESH.SPP_CRITICAL} psi threshold — indicates pack-off / restriction in the annulus.` })
            : tr({ id: `Torque melewati ambang ${THRESH.TORQUE_CRITICAL} kft-lb saat WOB < ${THRESH.WOB_ON} klbs — indikasi stuck pipe / differential sticking.`,
                   en: `Torque exceeded the ${THRESH.TORQUE_CRITICAL} kft-lb threshold while WOB < ${THRESH.WOB_ON} klbs — indicates stuck pipe / differential sticking.` }),
        });
      }
    }
    return alerts;
  }

  function renderAlerts(filteredRows) {
    let alerts = computeAlerts(filteredRows).filter((a) => state.alertCauseFilter.has(a.causeKey));
    const dirMul = state.sortDir === "asc" ? 1 : -1;
    const colMap = { rig: "rig", start: "start", end: "end", duration: "duration", peakSpp: "peakSpp", peakTorque: "peakTorque", minWob: "minWob" };
    const key = colMap[state.sortCol] || "start";
    alerts.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av instanceof Date) return (av - bv) * dirMul;
      if (typeof av === "string") return av.localeCompare(bv) * dirMul;
      return (av - bv) * dirMul;
    });

    document.getElementById("alertCountHint").textContent = alerts.length ? `— ${alerts.length} ${tr({ id: "kejadian", en: "events" })}` : "";
    const tbody = document.getElementById("alertTableBody");
    const emptyState = document.getElementById("alertEmptyState");
    if (!alerts.length) { tbody.innerHTML = ""; emptyState.hidden = false; return; }
    emptyState.hidden = true;

    tbody.innerHTML = alerts.map((a) => `
      <tr>
        <td>${escapeAttr(a.rig)}</td>
        <td class="tabular">${fmtDateTime(a.start)}</td>
        <td class="tabular">${fmtDateTime(a.end)}</td>
        <td class="tabular">${fmtNum(a.duration, 2)} ${tr({ id: "j", en: "hr" })}</td>
        <td class="tabular">${fmtNum(a.peakSpp, 0)} psi</td>
        <td class="tabular">${fmtNum(a.peakTorque, 1)} kft-lb</td>
        <td class="tabular">${fmtNum(a.minWob, 1)} klbs</td>
        <td>${a.cause}</td>
        <td><span class="badge critical">⚠ Critical</span></td>
      </tr>`).join("");
  }

  /* =========================================================================
   * 6. FILTER UI (rig chips, dates, presets, param chips, focus rig select)
   * ====================================================================== */
  function renderRigChips() {
    const wrap = document.getElementById("rigChips");
    wrap.innerHTML = "";
    state.rigs.forEach((rig, i) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip has-tip";
      chip.setAttribute("aria-pressed", state.selectedRigs.has(rig));
      chip.title = tr({ id: `Tampilkan/sembunyikan data dari rig "${rig}". Klik untuk mengaktifkan atau menonaktifkan filter ini.`,
                        en: `Show/hide data from rig "${rig}". Click to toggle this filter on or off.` });
      const dotColors = ["--s1-blue", "--s2-orange", "--s3-aqua", "--s5-magenta", "--s7-violet"];
      chip.innerHTML = `<span class="dot" style="background:${cssVar(dotColors[i % dotColors.length])}"></span>${escapeAttr(rig)}`;
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
    sel.innerHTML = selected.map((r) => `<option value="${escapeAttr(r)}">${escapeAttr(r)}</option>`).join("");
    if (!selected.includes(state.focusRig)) state.focusRig = selected[0] || null;
    sel.value = state.focusRig || "";
  }

  function renderParamChips() {
    const wrap = document.getElementById("paramChips");
    wrap.innerHTML = "";
    PARAM_META.forEach((p) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip has-tip";
      chip.setAttribute("aria-pressed", state.visibleParams.has(p.key));
      chip.title = tr(p.desc);
      chip.innerHTML = `<span class="dot" style="background:${cssVar(p.colorVar)}"></span>${p.label}`;
      chip.addEventListener("click", () => {
        if (state.visibleParams.has(p.key)) state.visibleParams.delete(p.key); else state.visibleParams.add(p.key);
        renderParamChips(); renderTrendChart();
      });
      wrap.appendChild(chip);
    });
  }

  function renderAlertCauseChips() {
    const wrap = document.getElementById("alertCauseChips");
    if (!wrap) return;
    wrap.innerHTML = "";
    ALERT_CAUSE_META.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button"; chip.className = "chip has-tip";
      chip.setAttribute("aria-pressed", state.alertCauseFilter.has(c.key));
      chip.title = tr(c.desc);
      chip.textContent = tr(c.label);
      chip.addEventListener("click", () => {
        if (state.alertCauseFilter.has(c.key)) state.alertCauseFilter.delete(c.key); else state.alertCauseFilter.add(c.key);
        renderAlertCauseChips(); renderAlerts(getFilteredRows());
      });
      wrap.appendChild(chip);
    });
  }

  function bindFilterControls() {
    document.getElementById("startDate").addEventListener("change", debounce((e) => {
      state.startDate = parseInputDate(e.target.value); scheduleRender();
    }, 150));
    document.getElementById("endDate").addEventListener("change", debounce((e) => {
      state.endDate = parseInputDate(e.target.value); scheduleRender();
    }, 150));
    document.getElementById("focusRigSelect").addEventListener("change", (e) => {
      state.focusRig = e.target.value; renderTrendChart();
    });
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset;
        const ext = tsExtent(state.rows.filter((r) => state.selectedRigs.has(r.rig)));
        const dataStart = new Date(ext.min);
        const dataEnd = new Date(ext.max);
        if (preset === "all") { state.startDate = dataStart; state.endDate = dataEnd; }
        else {
          const days = preset === "24h" ? 1 : preset === "3d" ? 3 : 7;
          state.startDate = new Date(dataEnd.getTime() - days * 24 * 3600 * 1000);
          state.endDate = dataEnd;
        }
        syncDateInputs(); scheduleRender();
      });
    });
    document.getElementById("donutTableToggle").addEventListener("click", () => {
      const wrap = document.getElementById("donutTableWrap");
      wrap.hidden = !wrap.hidden;
      updateDonutToggleText();
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
   * 7. CSV UPLOAD / DOWNLOAD / RESET
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
          const defaultRig = file.name.replace(/\.[^.]+$/, "");
          const rows = parseCsv(reader.result, defaultRig);
          loadDataset(rows, `Upload: ${file.name}`);
          showBanner(tr({ id: `Berhasil memuat ${rows.length} baris dari ${state.rigs.length} rig (${file.name}).`,
                          en: `Successfully loaded ${rows.length} rows from ${state.rigs.length} rig(s) (${file.name}).` }), "ok");
        } catch (err) {
          const detail = err.i18n ? tr(err.i18n) : err.message;
          showBanner(tr({ id: `Gagal memproses CSV: ${detail}`, en: `Failed to process CSV: ${detail}` }), "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
    document.getElementById("downloadSampleBtn").addEventListener("click", () => {
      downloadBlob("sample_rig_data.csv", serializeCsv(SAMPLE_ROWS));
    });
    document.getElementById("resetSampleBtn").addEventListener("click", () => {
      loadDataset(SAMPLE_ROWS, "Sampel Data Riil (Bawaan)");
      document.getElementById("uploadBanner").hidden = true;
    });
    document.getElementById("themeToggle").addEventListener("click", () => {
      const root = document.documentElement;
      const current = root.getAttribute("data-theme");
      const next = current === "dark" ? "light" : current === "light" ? null : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
      if (next) root.setAttribute("data-theme", next); else root.removeAttribute("data-theme");
      resetCharts();
      fullRender();
    });
    document.getElementById("langId").addEventListener("click", () => setLanguage("id"));
    document.getElementById("langEn").addEventListener("click", () => setLanguage("en"));
  }

  /* =========================================================================
   * 8. STATIC TEXT I18N
   * ====================================================================== */
  const STATIC_I18N = {
    subtitle: { id: "Deteksi status operasional rig (Drilling, Circulating, Tripping In/Out, Idle/Standby, Critical Anomaly) berbasis rule-engine ambang batas parameter sensor pemboran.",
                en: "Detects rig operational status (Drilling, Circulating, Tripping In/Out, Idle/Standby, Critical Anomaly) using a threshold rule-engine over drilling sensor parameters." },
    themeToggleBtn: { id: "🌓 Tema", en: "🌓 Theme" },
    themeToggleTip: { id: "Ganti tema terang/gelap", en: "Toggle light/dark theme" },
    downloadSampleBtn: { id: "⬇️ Unduh Contoh CSV", en: "⬇️ Download Sample CSV" },
    resetSampleBtn: { id: "↺ Reset ke Data Sample", en: "↺ Reset to Sample Data" },
    rigIdTip: { id: "Pilih satu atau lebih rig untuk ditampilkan. Semua chart & KPI akan otomatis menyesuaikan ke rig yang dipilih.",
                en: "Select one or more rigs to display. All charts & KPIs will automatically adjust to the selected rigs." },
    timeRangeLabel: { id: "Rentang Waktu", en: "Time Range" },
    timeRangeTip: { id: "Batasi data yang ditampilkan ke rentang tanggal tertentu.", en: "Limit the displayed data to a specific date range." },
    presetLabel: { id: "Preset", en: "Preset" },
    presetTip: { id: "Pilihan cepat untuk mengisi rentang tanggal di sebelah kiri.", en: "Quick shortcuts to fill in the date range on the left." },
    preset24h: { id: "24 Jam", en: "24 Hours" },
    preset24hTip: { id: "Tampilkan hanya 24 jam terakhir dari data.", en: "Show only the last 24 hours of data." },
    preset3d: { id: "3 Hari", en: "3 Days" },
    preset3dTip: { id: "Tampilkan hanya 3 hari terakhir dari data.", en: "Show only the last 3 days of data." },
    preset7d: { id: "7 Hari", en: "7 Days" },
    preset7dTip: { id: "Tampilkan hanya 7 hari terakhir dari data.", en: "Show only the last 7 days of data." },
    presetAll: { id: "Semua", en: "All" },
    presetAllTip: { id: "Tampilkan seluruh data tanpa batasan tanggal.", en: "Show all data with no date restriction." },
    trendHeading: { id: "Tren Gabungan Sensor Operasional", en: "Combined Operational Sensor Trend" },
    trendHeadingTip: { id: "Grafik garis waktu yang menampilkan beberapa parameter sensor sekaligus (WOB, RPM, Torque, dll.), dinormalisasi ke satu skala agar mudah dibandingkan.",
                        en: "A time-series chart showing several sensor parameters at once (WOB, RPM, Torque, etc.), normalized to one scale for easy comparison." },
    trendFootnote: { id: "Nilai dinormalisasi 0–100% dari rentang aktual masing-masing parameter (satu sumbu Y) agar sensor dengan satuan berbeda dapat dibandingkan tren-nya secara adil tanpa dual-axis. Arahkan kursor ke titik untuk melihat nilai asli.",
                      en: "Values are normalized 0–100% of each parameter's actual range (single Y-axis) so sensors with different units can be fairly compared without a dual-axis. Hover over a point to see the original value." },
    focusRigSelectAria: { id: "Rig untuk grafik tren", en: "Rig for trend chart" },
    donutHeading: { id: "Distribusi Status Operasional", en: "Operational Status Distribution" },
    donutHeadingTip: { id: "Diagram lingkaran yang menunjukkan proporsi waktu rig berada di setiap status operasional, pada rentang data yang sedang difilter.",
                        en: "A pie chart showing the proportion of time rigs spent in each operational status, over the currently filtered data range." },
    timelineHeading: { id: "Timeline Status Rig", en: "Rig Status Timeline" },
    engineExplainerSummary: { id: "Bagaimana engine menentukan status ini?", en: "How does the engine determine this status?" },
    alertHeading: { id: "Alert &amp; Log Kejadian Anomali Operasional", en: "Alert &amp; Operational Anomaly Event Log" },
    causeFilterLabel: { id: "Filter Penyebab", en: "Cause Filter" },
    causeFilterTip: { id: "Tampilkan hanya kejadian anomali dengan penyebab tertentu.", en: "Show only anomaly events with a specific cause." },
    thRigIdTip: { id: "ID rig tempat anomali ini terjadi.", en: "The rig ID where this anomaly occurred." },
    thMulai: { id: "Mulai", en: "Start" },
    thMulaiTip: { id: "Waktu anomali mulai terdeteksi.", en: "When the anomaly was first detected." },
    thSelesai: { id: "Selesai", en: "End" },
    thSelesaiTip: { id: "Waktu anomali berakhir (kembali ke status normal).", en: "When the anomaly ended (returned to normal status)." },
    thDurasi: { id: "Durasi", en: "Duration" },
    thDurasiTip: { id: "Berapa lama kejadian anomali ini berlangsung.", en: "How long this anomaly event lasted." },
    thPeakSppTip: { id: "Standpipe Pressure (tekanan lumpur bor di pipa) tertinggi yang tercatat selama kejadian ini. Melonjak tinggi bisa jadi tanda tekanan balik dari formasi (kick).",
                     en: "The highest Standpipe Pressure (drilling mud pressure in the pipe) recorded during this event. A high spike may indicate formation pressure kicking back (a kick)." },
    thPeakTorqueTip: { id: "Torque (gaya puntir saat memutar rangkaian bor) tertinggi yang tercatat selama kejadian ini. Melonjak tinggi bisa jadi tanda pipa terjepit.",
                        en: "The highest Torque (twisting force while rotating the drill string) recorded during this event. A high spike may indicate a stuck pipe." },
    thMinWobTip: { id: "Weight on Bit (tekanan mata bor ke dasar sumur) terendah yang tercatat selama kejadian ini.",
                    en: "The lowest Weight on Bit (pressure of the drill bit against the well bottom) recorded during this event." },
    thPenyebab: { id: "Kemungkinan Penyebab", en: "Likely Cause" },
    thPenyebabTip: { id: "Dugaan penyebab anomali berdasarkan pola sensor yang terekam.", en: "The suspected cause of the anomaly based on the recorded sensor pattern." },
    thSeverityTip: { id: "Tingkat keparahan kejadian.", en: "The severity level of the event." },
    alertEmptyState: { id: "Tidak ada anomali kritikal pada rig/rentang waktu yang dipilih.", en: "No critical anomalies for the selected rig(s)/time range." },
    footer1: { id: "Dataset bawaan adalah <strong>data telemetri riil</strong> (di-resample ke interval 1 menit); identitas rig tidak disertakan pada sumber data asli.",
               en: "The default dataset is <strong>real telemetry data</strong> (resampled to a 1-minute interval); rig identity is not present in the original source data." },
    footer2: { id: `Chart rendering menggunakan <a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a> (MIT License, disematkan inline di file ini).`,
               en: `Chart rendering uses <a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a> (MIT License, embedded inline in this file).` },
  };
  function applyStaticTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = tr(STATIC_I18N[el.dataset.i18n]); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = tr(STATIC_I18N[el.dataset.i18nTitle]); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", tr(STATIC_I18N[el.dataset.i18nAria])); });
  }
  function setLanguage(lang) {
    state.lang = lang;
    try { localStorage.setItem("lang", lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.getElementById("langId").setAttribute("aria-pressed", lang === "id");
    document.getElementById("langEn").setAttribute("aria-pressed", lang === "en");
    resetCharts();
    applyStaticTranslations();
    renderRigChips();
    renderParamChips();
    renderAlertCauseChips();
    renderEngineExplainer();
    updateDonutToggleText();
    fullRender();
  }

  /* =========================================================================
   * 9. ENGINE EXPLAINER (mirrors README classification matrix)
   * ====================================================================== */
  const ENGINE_ROWS = [
    { status: "Critical Anomaly/High Pressure Warning",
      cond: { id: `SPP ≥ ${THRESH.SPP_CRITICAL} psi, ATAU (Torque ≥ ${THRESH.TORQUE_CRITICAL} kft-lb DAN WOB &lt; ${THRESH.WOB_ON} klbs)`,
              en: `SPP ≥ ${THRESH.SPP_CRITICAL} psi, OR (Torque ≥ ${THRESH.TORQUE_CRITICAL} kft-lb AND WOB &lt; ${THRESH.WOB_ON} klbs)` } },
    { status: "Drilling",
      cond: { id: `WOB ≥ ${THRESH.WOB_ON} klbs DAN RPM ≥ ${THRESH.RPM_ON} DAN Torque ≥ ${THRESH.TORQUE_ON} kft-lb DAN Flow ≥ ${THRESH.FLOW_ON} gpm DAN |Bit Depth − Hole Depth| ≤ ${THRESH.DEPTH_EPS} ft`,
              en: `WOB ≥ ${THRESH.WOB_ON} klbs AND RPM ≥ ${THRESH.RPM_ON} AND Torque ≥ ${THRESH.TORQUE_ON} kft-lb AND Flow ≥ ${THRESH.FLOW_ON} gpm AND |Bit Depth − Hole Depth| ≤ ${THRESH.DEPTH_EPS} ft` } },
    { status: "Circulating",
      cond: { id: `Flow ≥ ${THRESH.FLOW_ON} gpm DAN WOB &lt; ${THRESH.WOB_ON} klbs DAN RPM &lt; ${THRESH.RPM_ON}`,
              en: `Flow ≥ ${THRESH.FLOW_ON} gpm AND WOB &lt; ${THRESH.WOB_ON} klbs AND RPM &lt; ${THRESH.RPM_ON}` } },
    { status: "Tripping In/Out",
      cond: { id: `Laju perubahan Bit Depth ≥ ${THRESH.TRIP_MIN_RATE_FT_PER_HR} ft/jam DAN WOB &lt; ${THRESH.WOB_ON} klbs DAN Flow &lt; ${THRESH.FLOW_ON} gpm`,
              en: `Bit Depth rate of change ≥ ${THRESH.TRIP_MIN_RATE_FT_PER_HR} ft/hr AND WOB &lt; ${THRESH.WOB_ON} klbs AND Flow &lt; ${THRESH.FLOW_ON} gpm` } },
    { status: "Connection",
      cond: { id: `WOB &lt; ${THRESH.WOB_ON} klbs DAN Flow &lt; ${THRESH.FLOW_ON} gpm DAN perubahan Hookload antar sampel ≥ ${THRESH.CONNECTION_HKLD_DELTA} klbs (bukan Tripping)`,
              en: `WOB &lt; ${THRESH.WOB_ON} klbs AND Flow &lt; ${THRESH.FLOW_ON} gpm AND Hookload change between samples ≥ ${THRESH.CONNECTION_HKLD_DELTA} klbs (not Tripping)` } },
    { status: "Idle/Standby",
      cond: { id: "Kondisi default jika tidak ada aturan di atas yang terpenuhi",
              en: "Default condition when none of the rules above are met" } },
  ];
  function renderEngineExplainer() {
    document.getElementById("engineExplainerBody").innerHTML = `
      <table class="alert-table">
        <thead><tr><th>Status</th><th>${tr({ id: "Kondisi Ambang Batas", en: "Trigger Condition" })}</th></tr></thead>
        <tbody>
          ${ENGINE_ROWS.map((r) => `<tr><td>${r.status}</td><td>${tr(r.cond)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  /* =========================================================================
   * 10. RENDER PIPELINE
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
    document.documentElement.lang = state.lang;
    document.getElementById("langId").setAttribute("aria-pressed", state.lang === "id");
    document.getElementById("langEn").setAttribute("aria-pressed", state.lang === "en");
    applyStaticTranslations();
    renderRigChips();
    syncFocusRigSelect();
    syncDateInputs();
    renderParamChips();
    renderAlertCauseChips();
    renderEngineExplainer();
    updateDonutToggleText();
    bindFilterControls();
    bindDataControls();
    fullRender();
  }
  document.addEventListener("DOMContentLoaded", init);
})();

🇮🇩 [Bahasa Indonesia](README.md) | 🇬🇧 English (this page)

# Rig Operational Status Dashboard

An interactive dashboard that detects and visualizes **upstream drilling rig operational status** from drilling sensor data, using a rule-based threshold logic engine.

Built as a **single-file HTML** app that opens directly in a browser — no installation required.

---

## How It Works (Summary)

Rig sensors report numbers every few seconds/minutes — how hard the bit is pressing, how fast it's rotating, pipe pressure, mud flow rate, and current depth. **This dashboard reads those numbers and automatically infers "what is the rig doing right now?"**, classifying every data row into one of 6 statuses:

| Icon | Status | Meaning |
|---|---|---|
| 🔵 | **Drilling** | Bit actively penetrating new formation — the main productive work |
| 🟢 | **Circulating** | Mud is being pumped/circulated to clean the hole, no new penetration yet |
| 🟠 | **Tripping In/Out** | Pipe string being pulled up/run down the well (e.g. bit change) |
| 🟣 | **Connection** | Brief pause to make/break a pipe connection during tripping |
| ⚪ | **Idle/Standby** | No activity — waiting or maintenance |
| 🔴 | **Critical Anomaly** | Danger signal (abnormal pressure/torque) — needs immediate attention |

### Current capabilities

- **Automatic status classification** per data row, per rig, driven by a threshold rule engine (see the matrix below).
- **KPI panel**: Total Hours Monitored, Active Rig Count, Fleet Operational Efficiency (% productive time), and Downtime (Idle + Anomaly).
- **Multi-sensor trend chart** (Chart.js) for one focus rig, with 11 toggleable parameters normalized to 0–100% on a single Y-axis so different units stay comparable; automatically downsampled to a maximum of 400 points.
- **Status distribution donut** plus a legend and a collapsible hours/percentage table.
- **Per-rig Gantt timeline** (plain DOM, no chart library) with duration tooltips; segments are split where the data has gaps.
- **Critical anomaly alert table**, sortable by column and filterable by cause (SPP / Torque-Stuck Pipe), showing peak SPP, peak Torque and min WOB per event.
- **Filters** for rigs (multi-select chips), date range, and 1/3/7-day or all-data presets.
- **Upload your own CSV**, **download a sample CSV**, and reset back to the built-in dataset.
- **Bilingual (ID/EN)** with the language choice persisted in `localStorage`, plus a **light/dark theme**.

---

## Architecture & Build Process

The app shipped to users is **a single `index.html` with no dependencies at all** — no `package.json`, no `node_modules`, no network calls, and **no build step is required to *run* it**.

That single file is **not hand-edited**; it is a **generated artifact**:

```
index.template.html            (markup + CSS + 3 marker <script> blocks)
  ├── /*__CHARTJS_INLINE__*/  ← assets/vendor/chart.umd.min.js
  ├── /*__ENGINE_JS__*/       ← assets/engine.js
  └── /*__APP_JS__*/          ← assets/app.src.js
                                   └── __SAMPLE_CSV__ ← assets/sample-data.csv
                        │
                        ▼  python3 scripts/build.py
                   index.html   (artifact — do not hand-edit)
```

`scripts/build.py` copies each source file into its marker position in `index.template.html` (the CSV is substituted into `app.src.js` first), then writes the result to `index.html`.

> ⚠️ **Never edit `index.html` by hand.** Any change to `index.template.html` or to a file under `assets/` **must** be followed by re-running `python3 scripts/build.py`, otherwise `index.html` goes stale and your change is lost on the next build.

Keeping the pure logic (`assets/engine.js`) separate from the UI code (`assets/app.src.js`) keeps the classification and CSV parsing readable, diffable, and reusable outside the browser (see [Public API](#public-api-assetsenginejs)).

---

## Dataset

The default dataset is **real telemetry data** (`assets/sample-data.csv`, 7,330 data rows), not synthetic data. Because the source file logs a reading every ~1.5–2 seconds (30–50 rows/minute) but timestamps are only minute-precision, the engine resamples the data to **1 row per minute** — taking the last reading within that minute as the representative value (assumption: row order within a minute reflects arrival order). Rig identity is not present in the source file, so it's shown as a single generic label ("Rig (Data Riil)").

You can upload your own CSV — see the format below.

> **Technical constraint on `assets/sample-data.csv`:** this file's contents are inlined into a JavaScript *template literal* at build time, so it **must not contain a backtick (`` ` ``), the sequence `${`, or a backslash (`\`)**. `scripts/build.py` asserts all three and fails the build (rather than emitting a corrupt file) if one is found.

---

## Quick Start

**No installation required.**

1. Clone or download this repository.
2. Open [`index.html`](index.html) in a browser (double-click is enough).
3. The dashboard immediately shows the built-in real dataset. Use the date/preset filters to explore.

### Rebuilding (development only)

Requires `python3` (no third-party packages):

```bash
python3 scripts/build.py           # regenerate index.html from the template + assets
python3 scripts/build.py --check   # verify index.html is not stale; exit code 1 + a "STALE" message if it is
```

`--check` writes nothing — it suits a pre-commit hook: run it after changing `index.template.html`, `assets/engine.js`, `assets/app.src.js`, `assets/sample-data.csv`, or `assets/vendor/chart.umd.min.js`.

### Using your own data

1. Click **⬆️ Upload CSV** in the header and pick your CSV file.
2. The first line must be a header row. Column matching is case-insensitive, and unit suffixes in parentheses or a `%` sign are stripped automatically (`Bit Depth (ftMD)` → `bit depth`).

   **Required** columns:

   | Column | Accepted aliases | Unit |
   |---|---|---|
   | Timestamp | `date time server`, `timestamp`, `time`, `datetime`, `date time` | any format recognized by JS `Date()` |
   | Weight on Bit | `wob`, `weight on bit` | klbs |
   | RPM | `surface rpm`, `rpm` | rpm |
   | Torque | `rotary torque`, `torque` | kft-lb |
   | Standpipe Pressure | `standpipe pressure`, `spp` | psi |
   | Mud Flow In | `mud flow in`, `mud flow rate`, `flow`, `mudflow` | gpm |
   | Bit Depth | `bit depth`, `bitdepth` | ft |
   | Hole Depth | `hole depth`, `holedepth` | ft |

   **Optional** columns (default to `0`, or the file name for the rig, when missing — they never fail the upload):

   | Column | Accepted aliases | Unit |
   |---|---|---|
   | Rig ID | `rig id`, `rig_id`, `rigid`, `rig` | text |
   | Block Position | `block position`, `bpos` | ft |
   | Hookload | `hookload`, `hkla` | klbs |
   | Mud Flow Out | `mud flow out`, `mfop` | % |
   | ROP | `rop` | ft/h |

   Without a `hookload` column the **Connection** status is never detected (it safely falls back to Idle/Standby). Without a `rig id` column, every row is labeled with the uploaded file's name.
3. Rows with an unparseable timestamp are **skipped** (the count is reported in the banner after upload) rather than failing the whole file.
4. Column order is free — matching is by header name, not position.

The exact header used by the built-in dataset (and produced by the **⬇️ Download Sample CSV** button) is:

```csv
Date time server,Bit Depth (ftMD),Hole Depth (ftMD),Block Position (ft),ROP (ft/h),Hookload (klb),WOB (klb),Rotary Torque (kft-lb),Surface RPM,Standpipe Pressure (psi),Mud Flow Out %,Mud Flow In (gpm)
2026-09-09T03:00:00,526.42,794.79,65.79,2.7,21.32,0,0,0,0,0,0
```

---

## Rig Status Classification Matrix

The engine evaluates each row **in priority order** (the first matching rule determines the status; safety is checked first). The threshold values below are the actual values of the `THRESH` constant in `assets/engine.js`:

| # | Status | Trigger Condition | Interpretation |
|---|---|---|---|
| 1 | **Critical Anomaly/High Pressure Warning** | `SPP ≥ 3500 psi` **OR** (`Torque ≥ 3000 kft-lb` **AND** `WOB < 2 klbs`) | Indicates a kick/pack-off or stuck pipe |
| 2 | **Drilling** | `WOB ≥ 2` **AND** `RPM ≥ 20` **AND** `Torque ≥ 150` **AND** `Flow ≥ 200 gpm` **AND** `|Bit Depth − Hole Depth| ≤ 3 ft` | Bit actively penetrating formation at a new depth |
| 3 | **Circulating** | `Flow ≥ 200 gpm` **AND** `WOB < 2` **AND** `RPM < 20` | Pump active without penetration |
| 4 | **Tripping In/Out** | `|ΔBit Depth| ≥ 32 ft/hr × sampling interval` **AND** `WOB < 2` **AND** `Flow < 200 gpm` | Pipe being run in/out of the well (`in`/`out` from the sign of Δ) |
| 5 | **Connection** | Not Tripping, **AND** `WOB < 2` **AND** `Flow < 200` **AND** Hookload change between samples ≥ `5 klbs` | Brief pause to make/break a connection |
| 6 | **Idle/Standby** | *(default)* | No productive activity |

Full constant set (`RigEngine.THRESH`):

| Constant | Value | Unit | Role |
|---|---|---|---|
| `WOB_ON` | 2 | klbs | Minimum WOB taken as bit/formation contact |
| `RPM_ON` | 20 | rpm | Minimum rotary speed considered "rotating" |
| `TORQUE_ON` | 150 | kft-lb | Minimum torque considered "loaded" |
| `FLOW_ON` | 200 | gpm | Minimum mud flow considered "pumps on" |
| `SPP_CRITICAL` | 3500 | psi | Critical standpipe-pressure threshold |
| `TORQUE_CRITICAL` | 3000 | kft-lb | Critical torque threshold (while WOB is low) |
| `DEPTH_EPS` | 3 | ft | Tolerance for "bit at bottom" |
| `TRIP_MIN_RATE_FT_PER_HR` | 32 | ft/hr | Minimum bit-depth movement rate to call it tripping |
| `CONNECTION_HKLD_DELTA` | 5 | klbs | Minimum hookload swing between samples to call it a connection |

The tripping threshold is expressed as a **rate (ft/hr)** and multiplied by the sampling interval inferred from the data (`inferIntervalHours`) — so it stays valid for a CSV logged at any frequency.

> **Torque calibration note:** the source data header states units of kft-lb, but the value range (p50=0, p90≈1690, p99≈4380 in the raw data) is more consistent with an ft-lb scale when compared against the Daily Drilling Report narrative ("Torque ON/OFF Bottom = 1000/800 ft-lb"). The `TORQUE_ON`/`TORQUE_CRITICAL` thresholds above are calibrated against this real value scale (not against the unit label), and are documented as an explicit assumption — not a verified unit conversion. Other thresholds were chosen from percentile ranges of the real data and remain configurable per rig/formation. The same matrix is also shown inside the app (Timeline card → "How does the engine determine this status?").

---

## Public API `assets/engine.js`

`assets/engine.js` is a pure module (no DOM, no UI state). In Node it is exported via `module.exports`; in the browser it is attached as the global **`RigEngine`**.

**Data row shape** used by every function below:
`{ ts: Date, rig: string, wob, rpm, torque, spp, flow, bitDepth, holeDepth, blockPosition, hookload, flowOutPct, rop: number }` — after classification each row also carries `status` (plus `reason`/`direction` where applicable).

### CSV import/export

#### `parseCsv(text, defaultRig)`
- **Purpose:** the full pipeline from raw CSV text to classified rows — header and row parsing, resampling to 1 row/minute, chronological sorting, interval inference, then status classification.
- **Parameters:** `text` (CSV contents string), `defaultRig` (string label used when the rig column is missing or empty).
- **Returns:** an array of sorted, classified data rows, carrying the extra property `rows.skippedRows` (how many lines were dropped for an invalid timestamp).
- **Side effects:** mutates the row objects it creates (writes `status`, `reason`, `direction`, and truncates `ts` to the minute).
- **Errors:** throws an `Error` carrying an `i18n = { id, en }` property with a bilingual message, for three conditions: the file is empty / has no data rows, a required column is missing, and no valid data rows could be processed.

#### `serializeCsv(rows)`
- **Purpose:** turn an array of rows back into CSV text using the `CSV_HEADERS` column order (used by the "Download Sample CSV" button).
- **Parameters:** `rows` (array of data rows).
- **Returns:** a CSV string (timestamps in ISO format, numeric values rounded per column).
- **Side effects / errors:** none.

#### `parseCsvLine(line)`
- **Purpose:** split a single CSV line, honouring double quotes and the `""` escape.
- **Parameters:** `line` (string).
- **Returns:** an array of trimmed strings.
- **Side effects / errors:** none.

#### `normalizeHeader(h)`
- **Purpose:** normalize a header name so it can be matched against the alias tables (lowercase, strip `(...)` and `%`, collapse whitespace).
- **Parameters:** `h` (header string).
- **Returns:** the normalized string.
- **Side effects / errors:** none.

#### `bucketToMinute(rows)`
- **Purpose:** resample to one row per (rig, minute), keeping the **last** reading in that minute.
- **Parameters:** `rows` (array of data rows).
- **Returns:** the resampled row array (chronological order not guaranteed).
- **Side effects:** mutates `r.ts` to the start of its minute.
- **Errors:** none.

### Detection engine

#### `classify(curr, prev, intervalHours)`
- **Purpose:** decide a single row's status according to the priority matrix above.
- **Parameters:** `curr` (current row), `prev` (previous row for the same rig, may be `null`), `intervalHours` (sampling interval in hours).
- **Returns:** `{ status }`, plus `reason` (`"spp"` or `"torque"`) for a Critical Anomaly, or `direction` (`"in"`/`"out"`) for Tripping.
- **Side effects / errors:** none (pure function).

#### `classifySeries(rows, intervalHours)`
- **Purpose:** run `classify` over every row, grouped and sorted per rig so that `prev` is always the preceding sample of the same rig.
- **Parameters:** `rows` (array of rows), `intervalHours` (number).
- **Returns:** the same `rows` array (not a copy).
- **Side effects:** **mutates rows in place** — writes `status`, `direction`, `reason`, and sorts each rig's rows by `ts`.
- **Errors:** none.

#### `inferIntervalHours(rows)`
- **Purpose:** infer the dominant sampling interval from the median gap between consecutive same-rig timestamps.
- **Parameters:** `rows` (array of rows).
- **Returns:** a number of hours; `1` when no gap can be computed.
- **Side effects / errors:** none.

### Utilities

#### `parseInputDate(value)`
- **Purpose:** parse an `<input type="date">` value (`"YYYY-MM-DD"`) as **local midnight**, avoiding the timezone shift of `new Date("YYYY-MM-DD")`, which parses as UTC.
- **Parameters:** `value` (string `"YYYY-MM-DD"`). **Returns:** a `Date`. **Side effects / errors:** none.

#### `decimate(rows, maxPoints)`
- **Purpose:** stride-based decimation that bounds the number of chart points while always keeping the first and last point.
- **Parameters:** `rows` (array), `maxPoints` (number). **Returns:** `{ rows, step }` (`step = 1` when nothing was dropped). **Side effects / errors:** none.

#### `tsExtent(rows)`
- **Purpose:** find the minimum and maximum timestamp in one pass (avoids the `Math.min(...arr)` stack overflow on large datasets).
- **Parameters:** `rows` (array). **Returns:** `{ min, max }` in epoch milliseconds (`Infinity`/`-Infinity` for an empty array). **Side effects / errors:** none.

#### `groupConsecutive(rows, keyFn, maxGapMs)`
- **Purpose:** merge consecutive rows sharing the same key into segments — used by both the status timeline and the anomaly log table.
- **Parameters:** `rows` (array, sorted per rig), `keyFn` (a `row -> key` function), `maxGapMs` (optional; a new segment starts when the time gap exceeds it, `null`/omitted = no gap splitting).
- **Returns:** an array of `{ key, rig, start, end, rows }` segments. **Side effects / errors:** none.

### Exported constants

| Name | Contents |
|---|---|
| `THRESH` | All rule-engine thresholds (table above) |
| `STATUS_LIST` | The six status names, in display order |
| `CSV_HEADERS` | The 12 column names used by `serializeCsv` |
| `HEADER_ALIASES` | Header aliases for the required columns |
| `OPTIONAL_HEADER_ALIASES` | Header aliases for the optional columns |

---

## Project Directory Structure

```
rig-status-dashboard/
├── index.html                 # ⭐ MAIN FILE — open in a browser. GENERATED ARTIFACT, do not hand-edit
├── index.template.html        # Source HTML/CSS template + script inlining markers
├── assets/
│   ├── engine.js              # Pure engine: status classification + CSV parse/serialize + utilities
│   ├── app.src.js             # App UI JavaScript source (charts, timeline, KPIs, filters, i18n)
│   ├── sample-data.csv        # Real-telemetry sample dataset (inlined into index.html at build time)
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js v4.4.4 (MIT License) — embedded inline so the dashboard is 100% offline
├── scripts/
│   └── build.py               # Build script: template + Chart.js + engine + app + sample CSV → index.html
├── docs/
│   ├── technical-summary.md   # Technical approach & decisions summary
│   └── reflection.md          # Reflection points on further development
├── README.md                  # Documentation (Bahasa Indonesia)
└── README.en.md               # Documentation (English — this page)
```

**For end users:** just use `index.html` — all code (CSS, Chart.js, app logic, and the sample dataset) is already bundled in, with no external dependencies or network calls.

**For further development:** edit `index.template.html` (markup/style), `assets/engine.js` (classification/CSV logic), or `assets/app.src.js` (UI logic), then run `python3 scripts/build.py`. The build is only needed to **regenerate** `index.html`, never to *run* the dashboard.

---

## Dependencies

- **[Chart.js](https://www.chartjs.org/) v4.4.4** (MIT License) — the only third-party dependency, vendored as `assets/vendor/chart.umd.min.js` and embedded inline into `index.html`. It renders the line trend chart and the status-distribution donut. Because it is embedded, the dashboard runs fully offline with no CDN.
- **The Gantt timeline is built from plain DOM elements**, not a chart library.
- **Build-time:** only `python3` from the standard library (`argparse`, `pathlib`, `sys`). There is no `package.json`, no `node_modules`, and no package manager.

---

## Known Limitations

- **Historical data only.** The dashboard loads data once (built-in dataset or upload) and filters it; there is no real-time streaming.
- **All processing happens in browser memory.** Very large datasets are bounded by tab memory; charts are decimated to 400 points, but parsing and classification still touch every row.
- **Resampling to 1 row/minute discards intra-minute variance** — the signal needed for torque-based stick-slip detection is no longer available.
- **Thresholds are global and static**, calibrated against a single real dataset; a different rig/formation will likely need recalibration (see the Torque calibration note above).
- **The Connection status depends on the Hookload column**; without it that status never appears.
- **Rig identity** is absent from the source data; a CSV without a rig column is treated as a single rig labeled with the file name.
- **Timestamp parsing relies on JavaScript `Date()`**, so it depends on the browser's local timezone, and unrecognized formats cause rows to be skipped.
- **No persistence**: only the language preference is stored in `localStorage`; uploaded data is lost on page reload.
- **Out of scope (stretch, not implemented):** stick-slip detection from intra-minute torque variance, historical bound overlay from `offset_wells_master.csv`, and correlation with `daily_drilling_reports.csv` narratives. See [docs/reflection.md](docs/reflection.md) for further development plans.

---

## License & Attribution

- Chart rendering uses [Chart.js](https://www.chartjs.org/) v4.4.4 (MIT License), embedded directly inside `index.html`.
- The default dataset is real telemetry data, resampled to a 1-minute interval for demonstration purposes.

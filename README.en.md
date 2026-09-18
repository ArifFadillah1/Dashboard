🇮🇩 [Bahasa Indonesia](README.md) | 🇬🇧 English (this page)

# Rig Operational Status Dashboard

An interactive dashboard that detects and visualizes **upstream drilling rig operational status** from drilling sensor data, using a rule-based threshold logic engine.

Built as a **single-file HTML** app that opens directly in a browser — no installation required.

> Built as part of the **Junior Performance Engineer** technical test — Pertamina.

---

## How It Works (Summary)

Rig sensors report numbers every few minutes — how hard the bit is pressing, how fast it's rotating, pipe pressure, mud flow rate, and current depth. **This dashboard reads those numbers and automatically infers "what is the rig doing right now?"**, classifying every minute of data into one of 6 statuses:

| Icon | Status | Meaning |
|---|---|---|
| 🔵 | **Drilling** | Bit actively penetrating new formation — the main productive work |
| 🟢 | **Circulating** | Mud is being pumped/circulated to clean the hole, no new penetration yet |
| 🟠 | **Tripping In/Out** | Pipe string being pulled up/run down the well (e.g. bit change) |
| 🟣 | **Connection** | Brief pause to make/break a pipe connection during tripping |
| ⚪ | **Idle/Standby** | No activity — waiting or maintenance |
| 🔴 | **Critical Anomaly** | Danger signal (abnormal pressure/torque) — needs immediate attention |

The dashboard presents this as a trend chart, a per-status Gantt timeline, summary KPIs (productive hours vs. downtime), and an alert table — so rig conditions can be understood at a glance without reading raw sensor data row by row.

---

## Dataset

The default dataset is **real telemetry data** from the case-study data pack provided for this technical test (`realtime_rig_telemetry.csv`), not synthetic data. Because the source file logs a reading every ~1.5–2 seconds (30–50 rows/minute) but timestamps are only minute-precision, the dashboard resamples the data to **1 row per minute** — taking the last reading within that minute as the representative value (assumption: row order within a minute reflects arrival order). Rig identity is not present in the source file, so it's shown as a single generic label.

You can upload your own CSV — see the format below.

---

## Quick Start

**No installation required.**

1. Clone or download this repository.
2. Open [`index.html`](index.html) in a browser.
3. The dashboard immediately shows the built-in real dataset. Use the date/preset filters to explore.

### Using your own data

1. Click **⬆️ Upload CSV** in the header and pick your CSV file.
2. **Required** columns (flexible header names — common aliases accepted, unit suffixes in parentheses/`%` are stripped automatically):

   | Column | Accepted aliases | Unit |
   |---|---|---|
   | Timestamp | `date time server`, `timestamp`, `time`, `datetime` | any format recognized by JS `Date()` |
   | Weight on Bit | `wob`, `weight on bit` | klbs |
   | RPM | `surface rpm`, `rpm` | rpm |
   | Torque | `rotary torque`, `torque` | kft-lb |
   | Standpipe Pressure | `standpipe pressure`, `spp` | psi |
   | Mud Flow In | `mud flow in`, `mud flow rate`, `flow` | gpm |
   | Bit Depth | `bit depth`, `bitdepth` | ft |
   | Hole Depth | `hole depth`, `holedepth` | ft |

   **Optional** columns (default to 0 if missing, won't fail the upload): `rig id`, `block position`/`bpos`, `hookload`/`hkla`, `mud flow out`/`mfop`, `rop`. Without `hookload`, the **Connection** status will never be detected (safely falls back to Idle).
3. Click **⬇️ Download Sample CSV** to see an example file with the correct format.
4. Click **↺ Reset to Sample Data** anytime to return to the built-in real dataset.

---

## Rig Status Classification Matrix

The engine evaluates each row **in priority order** (the first matching rule determines the status; safety is checked first):

| # | Status | Trigger Condition | Interpretation |
|---|---|---|---|
| 1 | **Critical Anomaly/High Pressure Warning** | `SPP ≥ 3500 psi` **OR** (`Torque ≥ 3000 kft-lb` **AND** `WOB < 2 klbs`) | Indicates a kick/pack-off or stuck pipe |
| 2 | **Drilling** | `WOB ≥ 2` **AND** `RPM ≥ 20` **AND** `Torque ≥ 150` **AND** `Flow ≥ 200 gpm` **AND** `|Bit Depth − Hole Depth| ≤ 3 ft` | Bit actively penetrating formation at a new depth |
| 3 | **Circulating** | `Flow ≥ 200 gpm` **AND** `WOB < 2` **AND** `RPM < 20` | Pump active without penetration |
| 4 | **Tripping In/Out** | Bit Depth rate of change ≥ `32 ft/hr` **AND** `WOB < 2` **AND** `Flow < 200 gpm` | Pipe being run in/out of the well |
| 5 | **Connection** | Not Tripping, **AND** `WOB < 2` **AND** `Flow < 200` **AND** Hookload change between samples ≥ `5 klbs` | Brief pause to make/break a connection |
| 6 | **Idle/Standby** | *(default)* | No productive activity |

> **Torque calibration note:** the source data header states units of kft-lb, but the value range (p50=0, p90≈1690, p99≈4380 in the raw data) is more consistent with an ft-lb scale when compared against the Daily Drilling Report narrative ("Torque ON/OFF Bottom = 1000/800 ft-lb"). The `TORQUE_ON`/`TORQUE_CRITICAL` thresholds above are calibrated against this real value scale (not against the unit label), and are documented as an explicit assumption — not a verified unit conversion. Other thresholds were chosen from percentile ranges of the real data and remain configurable per rig/formation. The same matrix is also shown inside the app (Timeline card → "How does the engine determine this status?").

**Out of scope (stretch, not implemented):** stick-slip detection from intra-minute torque variance (this variance is lost during resampling to 1 row/minute), historical bound overlay from `offset_wells_master.csv`, and correlation with `daily_drilling_reports.csv` narratives. See [docs/reflection.md](docs/reflection.md) for further development plans.

---

## Project Directory Structure

```
rig-status-dashboard/
├── index.html                 # ⭐ MAIN DELIVERABLE — open this file in a browser, no install needed
├── index.template.html        # Source HTML/CSS template + 2 script placeholders (for maintainability)
├── assets/
│   ├── app.src.js             # App JavaScript source (readable, inlined into index.html at build time)
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js v4.4.4 (MIT License) — embedded inline so the dashboard is 100% offline
├── scripts/
│   └── build.py                # Build script: merges template + app.src.js + chart.umd.min.js → index.html
├── docs/
│   ├── technical-summary.md   # Technical approach & decisions summary (deliverable #3)
│   └── reflection.md          # 3 reflection points on further development (deliverable #4)
└── README.md
```

**For end users:** just use `index.html` — all code (CSS, Chart.js, and app logic) is already bundled in, no external dependencies or network calls.

**For further development:** edit `index.template.html` (markup/style) or `assets/app.src.js` (app logic), then run:

```bash
python3 scripts/build.py
```

to regenerate `index.html`. This build step is purely an optional developer convenience — it isn't required to *run* the dashboard.

---

## License & Attribution

- Chart rendering uses [Chart.js](https://www.chartjs.org/) v4.4.4 (MIT License), embedded directly inside `index.html`.
- The default dataset is real telemetry data from the case-study data pack provided for this technical test, resampled to a 1-minute interval for demonstration purposes.

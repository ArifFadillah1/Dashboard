#!/usr/bin/env python3
"""Builds the single-file index.html app.

Inlines assets/vendor/chart.umd.min.js and assets/app.src.js into
index.template.html, replacing the two placeholder markers. This keeps the
application source and the vendored chart library readable/diffable in
version control while still shipping one dependency-free HTML file that can
be opened directly in a browser (no build step required to *run* it).

Usage:
    python3 scripts/build.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

template = (ROOT / "index.template.html").read_text(encoding="utf-8")
chartjs = (ROOT / "assets" / "vendor" / "chart.umd.min.js").read_text(encoding="utf-8")
appjs = (ROOT / "assets" / "app.src.js").read_text(encoding="utf-8")

CHARTJS_MARKER = "/*__CHARTJS_INLINE__*/"
APPJS_MARKER = "/*__APP_JS__*/"

assert CHARTJS_MARKER in template, f"marker not found: {CHARTJS_MARKER}"
assert APPJS_MARKER in template, f"marker not found: {APPJS_MARKER}"

output = template.replace(CHARTJS_MARKER, chartjs, 1)
output = output.replace(APPJS_MARKER, appjs, 1)

out_path = ROOT / "index.html"
out_path.write_text(output, encoding="utf-8")
print(f"Wrote {out_path} ({len(output):,} bytes)")

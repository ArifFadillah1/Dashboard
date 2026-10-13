#!/usr/bin/env python3
"""Builds the single-file index.html app.

Inlines, in order:
  - assets/vendor/chart.umd.min.js  -> /*__CHARTJS_INLINE__*/  (in the template)
  - assets/engine.js                -> /*__ENGINE_JS__*/       (in the template)
  - assets/app.src.js               -> /*__APP_JS__*/          (in the template)
  - assets/sample-data.csv          -> __SAMPLE_CSV__          (inside app.src.js)

This keeps the application source, the pure detection/CSV engine, the sample
dataset, and the vendored chart library each readable/diffable in version
control while still shipping one dependency-free HTML file that can be opened
directly in a browser (no build step required to *run* it).

Usage:
    python3 scripts/build.py          # (re)write index.html
    python3 scripts/build.py --check  # exit 1 if index.html is stale (for CI/pre-commit)
"""
import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

CHARTJS_MARKER = "/*__CHARTJS_INLINE__*/"
ENGINE_MARKER = "/*__ENGINE_JS__*/"
APPJS_MARKER = "/*__APP_JS__*/"
SAMPLE_CSV_MARKER = "__SAMPLE_CSV__"


def build() -> str:
    template = (ROOT / "index.template.html").read_text(encoding="utf-8")
    chartjs = (ROOT / "assets" / "vendor" / "chart.umd.min.js").read_text(encoding="utf-8")
    enginejs = (ROOT / "assets" / "engine.js").read_text(encoding="utf-8")
    appjs = (ROOT / "assets" / "app.src.js").read_text(encoding="utf-8")
    sample_csv = (ROOT / "assets" / "sample-data.csv").read_text(encoding="utf-8")

    # The CSV is inserted into a JS template literal: it must not contain
    # characters that the literal would interpret.
    for forbidden in ("`", "${", "\\"):
        assert forbidden not in sample_csv, f"sample-data.csv must not contain {forbidden!r}"

    for marker, haystack, name in [
        (CHARTJS_MARKER, template, "index.template.html"),
        (ENGINE_MARKER, template, "index.template.html"),
        (APPJS_MARKER, template, "index.template.html"),
        (SAMPLE_CSV_MARKER, appjs, "assets/app.src.js"),
    ]:
        assert marker in haystack, f"marker not found in {name}: {marker}"

    appjs = appjs.replace(SAMPLE_CSV_MARKER, sample_csv.rstrip("\n"), 1)
    output = template.replace(CHARTJS_MARKER, chartjs, 1)
    output = output.replace(ENGINE_MARKER, enginejs, 1)
    output = output.replace(APPJS_MARKER, appjs, 1)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify index.html matches the sources instead of writing it")
    args = parser.parse_args()

    output = build()
    out_path = ROOT / "index.html"

    if args.check:
        current = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        if current != output:
            print(f"STALE: {out_path} does not match the sources — run: python3 scripts/build.py")
            return 1
        print(f"OK: {out_path} is up to date ({len(output):,} bytes)")
        return 0

    out_path.write_text(output, encoding="utf-8")
    print(f"Wrote {out_path} ({len(output):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

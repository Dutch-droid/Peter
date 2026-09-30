"""CLI: python -m prodmgr {template,mock,run}"""
from __future__ import annotations

import argparse
import sys

import pandas as pd

from . import schema
from .analysis import analyse
from .exporters import export_all
from .mockdata import AS_OF, write_mock
from .report_pdf import build_pdf


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="prodmgr", description="AI Production Manager reporting tool")
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("template", help="write blank input templates + data dictionary")
    t.add_argument("--out", default="templates")
    m = sub.add_parser("mock", help="generate synthetic mock input data")
    m.add_argument("--out", default="data/mock"); m.add_argument("--seed", type=int, default=42)
    r = sub.add_parser("run", help="analyse input and write PDF/XLSX/CSV/JSON")
    r.add_argument("--input", required=True, help="folder of CSVs, .xlsx workbook, or .json")
    r.add_argument("--out", default="outputs")
    r.add_argument("--as-of", default=None, help="reporting timestamp (default: now; mock data uses 2026-09-30 09:00)")
    a = ap.parse_args(argv)

    if a.cmd == "template":
        schema.write_templates(a.out); print(f"Templates written to {a.out}/"); return 0
    if a.cmd == "mock":
        write_mock(a.out, a.seed); print(f"Mock data written to {a.out}/"); return 0
    tables, problems = schema.validate(schema.load(a.input))
    for p in problems:
        print("VALIDATION:", p, file=sys.stderr)
    if any("missing" in p and "required" in p or p.endswith("table is missing") for p in problems):
        return 2
    as_of = pd.Timestamp(a.as_of) if a.as_of else (AS_OF if "mock" in str(a.input) else pd.Timestamp.now())
    res = analyse(tables, as_of)
    paths = export_all(res, a.out)
    paths["pdf"] = build_pdf(res, f"{a.out}/report.pdf")
    for k, v in paths.items():
        print(f"{k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

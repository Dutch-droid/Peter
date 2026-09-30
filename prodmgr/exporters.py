"""Write one computed result set to CSV, XLSX and JSON so every format carries identical numbers."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

FILLS = {"Critical": "F4B6B6", "High": "F9D7A8", "Medium": "FFF2B3", "Low": "D5E8D4",
         "Breached": "F4B6B6", "At Risk": "F9D7A8", "Overloaded": "F4B6B6", "Under-utilised": "DDEBF7"}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in df.columns:
        if str(df[c].dtype).startswith("datetime"):
            df[c] = df[c].dt.strftime("%Y-%m-%d %H:%M")
    return df


def export_all(result: dict, out_dir: str | Path) -> dict[str, Path]:
    out = Path(out_dir)
    (out / "csv").mkdir(parents=True, exist_ok=True)
    tables = {k: _clean(v) for k, v in result["tables"].items()}
    summary = result["summary"]
    paths: dict[str, Path] = {}

    for name, df in tables.items():
        df.to_csv(out / "csv" / f"{name}.csv", index=False)
    flat = {k: v for k, v in summary.items() if not isinstance(v, (dict, list))}
    pd.DataFrame([{"metric": k, "value": v} for k, v in flat.items()]).to_csv(out / "csv" / "summary.csv", index=False)
    paths["csv"] = out / "csv"

    payload = {"summary": summary,
               "tables": {k: json.loads(v.to_json(orient="records", date_format="iso")) for k, v in tables.items()}}
    (out / "report.json").write_text(json.dumps(payload, indent=2, default=str))
    paths["json"] = out / "report.json"

    xlsx = out / "report.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as xw:
        rows = [(k, v) for k, v in flat.items()]
        rows += [(f"priority_{k}", v) for k, v in summary["priority_counts"].items()]
        rows += [(f"sla_{k}", v) for k, v in summary["sla_counts"].items()]
        rows += [(f"immediate_action_{i + 1}", a) for i, a in enumerate(summary["immediate_actions"])]
        pd.DataFrame(rows, columns=["metric", "value"]).to_excel(xw, sheet_name="summary", index=False)
        for name, df in tables.items():
            df.to_excel(xw, sheet_name=name[:31], index=False)
        for ws in xw.book.worksheets:
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for cell in ws[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="1F3A5F")
                cell.alignment = Alignment(vertical="center", wrap_text=True)
            for col in ws.columns:
                width = min(60, max(len(str(c.value)) if c.value is not None else 0 for c in col[:200]) + 2)
                ws.column_dimensions[get_column_letter(col[0].column)].width = max(10, width)
            for row in ws.iter_rows(min_row=2):
                for cell in row:
                    if isinstance(cell.value, str) and cell.value in FILLS:
                        cell.fill = PatternFill("solid", fgColor=FILLS[cell.value])
    paths["xlsx"] = xlsx
    return paths

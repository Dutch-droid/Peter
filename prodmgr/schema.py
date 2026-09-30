"""Input template definition: tables, columns, validation and template generation."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

OPEN_STATUSES = ["New", "In Progress", "Pending Review", "Pending Approval", "Escalated", "Rework"]
STATUSES = OPEN_STATUSES + ["Completed"]
RISK_LEVELS = ["Low", "Medium", "High"]

# (name, dtype, required, allowed values or None, description, example)
TABLES: dict[str, list[tuple]] = {
    "tasks": [
        ("task_id", "text", True, None, "Unique work item ID", "T-000123"),
        ("task_type", "text", True, None, "Work type, e.g. KYC Review, Credit Assessment", "KYC Review"),
        ("team", "text", True, None, "Owning team / department", "Compliance"),
        ("branch", "text", True, None, "Branch or location", "Amsterdam"),
        ("assigned_to", "text", False, None, "staff_id of the assignee (blank = unassigned)", "S007"),
        ("status", "text", True, STATUSES, "Current workflow status", "In Progress"),
        ("created_at", "datetime", True, None, "When the item entered the queue (ISO 8601)", "2026-09-20T09:15:00"),
        ("due_at", "datetime", True, None, "SLA deadline (ISO 8601)", "2026-09-22T09:15:00"),
        ("completed_at", "datetime", False, None, "Completion time (required when status = Completed)", ""),
        ("customer_id", "text", False, None, "Customer identifier (anonymised is fine)", "C0042"),
        ("customer_risk", "text", True, RISK_LEVELS, "Customer risk rating", "Medium"),
        ("amount", "number", False, None, "Exposure / revenue value in EUR", "125000"),
        ("regulatory_flag", "text", True, ["Y", "N"], "Y if the item has a regulatory deadline or requirement", "N"),
        ("est_hours", "number", True, None, "Estimated effort (open) in hours", "2.5"),
        ("actual_hours", "number", False, None, "Actual effort in hours (completed items)", ""),
        ("rework_count", "number", False, None, "Times the item was returned for rework", "0"),
        ("handoff_count", "number", False, None, "Number of handoffs between people/teams", "1"),
        ("error_flag", "text", False, ["Y", "N"], "Y if a quality error was found on the item", "N"),
        ("approved_by", "text", False, None, "staff_id of the approver (required for completed regulated items)", ""),
        ("source_system", "text", False, None, "CRM, Loan Mgmt, Core Banking, NAV, ...", "CRM"),
    ],
    "staff": [
        ("staff_id", "text", True, None, "Unique staff ID", "S007"),
        ("name", "text", True, None, "Display name (use a pseudonym if preferred)", "Sam de Vries"),
        ("team", "text", True, None, "Team / department", "Compliance"),
        ("branch", "text", True, None, "Branch or location", "Amsterdam"),
        ("role", "text", False, None, "Job role", "Analyst"),
        ("capacity_hours_week", "number", True, None, "Productive hours available per week", "32"),
        ("skills", "text", False, None, "Semicolon-separated task_types the person can handle", "KYC Review;AML Alert Review"),
        ("approval_authority", "text", True, ["Y", "N"], "Y if authorised to approve", "N"),
    ],
    "compliance": [
        ("item_id", "text", True, None, "Unique compliance item ID", "K-0001"),
        ("check_type", "text", True, ["KYC", "AML", "Risk Review", "Approval", "Policy"], "Type of check", "KYC"),
        ("customer_id", "text", False, None, "Customer identifier", "C0042"),
        ("status", "text", True, ["Open", "Cleared", "Escalated"], "Current status", "Open"),
        ("severity", "text", True, RISK_LEVELS, "Severity", "High"),
        ("due_at", "datetime", True, None, "Deadline (ISO 8601)", "2026-09-25T00:00:00"),
        ("related_task_id", "text", False, None, "Linked task_id", ""),
        ("description", "text", False, None, "Short description", "Beneficial owner documents missing"),
    ],
}
OPTIONAL_TABLES = {"compliance"}


def _coerce(df: pd.DataFrame, table: str) -> pd.DataFrame:
    for name, dtype, *_ in TABLES[table]:
        if name not in df.columns:
            df[name] = pd.NA
        if dtype == "datetime":
            df[name] = pd.to_datetime(df[name], errors="coerce")
        elif dtype == "number":
            df[name] = pd.to_numeric(df[name], errors="coerce")
        else:
            df[name] = df[name].astype("string").str.strip()
            df.loc[df[name] == "", name] = pd.NA
    return df


def validate(tables: dict[str, pd.DataFrame]) -> tuple[dict[str, pd.DataFrame], list[str]]:
    """Coerce types and return (clean tables, list of human-readable problems)."""
    problems: list[str] = []
    out: dict[str, pd.DataFrame] = {}
    for table, cols in TABLES.items():
        if table not in tables:
            if table not in OPTIONAL_TABLES:
                problems.append(f"[{table}] table is missing")
            else:
                out[table] = _coerce(pd.DataFrame(), table)
            continue
        raw = tables[table].copy()
        for name, _, required, *_ in cols:
            if required and name not in raw.columns:
                problems.append(f"[{table}] required column '{name}' is missing")
        df = _coerce(raw, table)
        for name, dtype, required, allowed, *_ in cols:
            if required:
                n = int(df[name].isna().sum())
                if n:
                    problems.append(f"[{table}] {n} row(s) have blank/invalid required value in '{name}'")
            if allowed:
                bad = df[name].dropna()
                bad = bad[~bad.isin(allowed)]
                if len(bad):
                    problems.append(f"[{table}] {len(bad)} row(s) have '{name}' outside {allowed}: {sorted(set(bad))[:5]}")
        key = TABLES[table][0][0]
        dup = int(df[key].duplicated().sum())
        if dup:
            problems.append(f"[{table}] {dup} duplicate '{key}' value(s)")
        out[table] = df
    if "tasks" in out:
        t = out["tasks"]
        n = int(((t["status"] == "Completed") & t["completed_at"].isna()).sum())
        if n:
            problems.append(f"[tasks] {n} Completed row(s) have no completed_at")
        n = int((t["due_at"] < t["created_at"]).sum())
        if n:
            problems.append(f"[tasks] {n} row(s) have due_at before created_at")
        if "staff" in out:
            unknown = set(t["assigned_to"].dropna()) - set(out["staff"]["staff_id"].dropna())
            if unknown:
                problems.append(f"[tasks] assigned_to references unknown staff_id(s): {sorted(unknown)[:5]}")
    return out, problems


def load(path: str | Path) -> dict[str, pd.DataFrame]:
    """Load from a folder of CSVs, an .xlsx workbook (one sheet per table), or a .json file."""
    p = Path(path)
    tables: dict[str, pd.DataFrame] = {}
    if p.is_dir():
        for t in TABLES:
            f = p / f"{t}.csv"
            if f.exists():
                tables[t] = pd.read_csv(f, dtype=str, keep_default_na=False)
    elif p.suffix.lower() in (".xlsx", ".xlsm"):
        book = pd.read_excel(p, sheet_name=None, dtype=str, keep_default_na=False)
        tables = {k.lower(): v for k, v in book.items() if k.lower() in TABLES}
    elif p.suffix.lower() == ".json":
        data = json.loads(p.read_text())
        tables = {k: pd.DataFrame(v).astype(str) for k, v in data.items() if k in TABLES}
    else:
        raise ValueError(f"Unsupported input: {p}")
    return tables


def write_templates(out_dir: str | Path) -> None:
    """Write blank CSV templates (header + one example row), an XLSX template and a data dictionary."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    dd_rows = []
    sheets = {}
    for table, cols in TABLES.items():
        example = pd.DataFrame([{c[0]: c[5] for c in cols}])
        example.to_csv(out / f"{table}.csv", index=False)
        sheets[table] = example
        for name, dtype, required, allowed, desc, ex in cols:
            dd_rows.append({"table": table, "column": name, "type": dtype,
                            "required": "Yes" if required else "No",
                            "allowed_values": ", ".join(allowed) if allowed else "",
                            "description": desc, "example": ex})
    dd = pd.DataFrame(dd_rows)
    dd.to_csv(out / "data_dictionary.csv", index=False)
    with pd.ExcelWriter(out / "input_template.xlsx", engine="openpyxl") as xw:
        for name, df in sheets.items():
            df.to_excel(xw, sheet_name=name, index=False)
        dd.to_excel(xw, sheet_name="data_dictionary", index=False)
        for ws in xw.book.worksheets:
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(
                    45, max(len(str(c.value or "")) for c in col) + 2)

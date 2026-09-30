# Peter - AI Production Manager reporting tool

Reads operational data (work queues, staff, compliance items) and produces a management
report as **PDF**, plus the same data as **XLSX**, **CSV** and **JSON**.

It only *recommends*. Credit approvals and other regulated decisions stay with authorised staff,
and anything with confidence below 85% is flagged `human_review_required`.

## Quick start

    pip install -r requirements.txt
    python -m prodmgr template --out templates      # blank input templates + data_dictionary.csv
    python -m prodmgr mock --out data/mock          # synthetic sample data (seeded)
    python -m prodmgr run --input data/mock --out outputs
    python -m pytest tests

`--input` accepts a folder of CSVs (`tasks.csv`, `staff.csv`, `compliance.csv`), an `.xlsx` workbook
with those sheet names, or a `.json` file keyed by table. `compliance` is optional.
Use `--as-of "2026-09-30 09:00"` to fix the reporting timestamp (default: now).

## Input template

See `templates/data_dictionary.csv` (types, required flags, allowed values) and
`templates/input_template.xlsx`. Tables: **tasks** (20 columns), **staff** (8), **compliance** (8).
Validation problems are printed before analysis runs.

## Outputs (`outputs/`)

| File | Content |
|---|---|
| `report.pdf` | Executive summary, charts, priorities, bottlenecks, reassignments, compliance & risk, performance & quality, automation |
| `report.xlsx` | `summary` plus one sheet per table (filters, colour-coded priority/SLA) |
| `csv/*.csv` | One flat file per table |
| `report.json` | `{summary, tables}` with identical numbers |

## Method (all tunable in `prodmgr/analysis.py` `CONFIG`)

- **SLA:** Breached (past due) / At Risk (<25% of SLA window or <8h left) / On Track.
- **Priority score (0-100):** SLA urgency 40 + customer risk 25 + regulatory flag 20 + value 15 + escalation 5.
  Critical ≥70, High ≥50, Medium ≥30. Breached regulated items are always Critical.
- **Workload ratio:** open estimated hours / weekly capacity (>1.0 overloaded). Under-utilised = ratio <0.3 and <50% of capacity worked in last 7 days.
- **Automation savings** use assumed automation shares per process type (`AUTOMATION_POTENTIAL`). They are planning assumptions, always flagged for human validation.
- Root causes are rule-based hypotheses to be confirmed by the team lead.

## Mock data

`prodmgr/mockdata.py` plants known problems so results can be sanity-checked: understaffed and slow
Credit Risk, few approvers for Loan Origination, KYC rework, slower Rotterdam branch, one staff member with a high error rate,
idle Customer Service capacity, duplicates, unassigned items and missing approvals. Figures are synthetic.

## Not yet covered

Incident management (needs an incidents table), customer complaints data, live system connectors.

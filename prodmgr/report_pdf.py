"""Management PDF report (reportlab + matplotlib charts)."""
from __future__ import annotations

import io
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

NAVY = colors.HexColor("#1F3A5F")
PRIO = {"Critical": "#C0392B", "High": "#E67E22", "Medium": "#F1C40F", "Low": "#7FB77E"}
SLA = {"Breached": "#C0392B", "At Risk": "#E67E22", "On Track": "#7FB77E"}
ROW_TINT = {"Critical": "#F9DADA", "High": "#FCE8D0", "Medium": "#FFF6CC", "Low": "#E6F2E5"}

ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], textColor=NAVY, fontSize=16, spaceBefore=10, spaceAfter=6)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("B", parent=ss["BodyText"], fontSize=9, leading=12)
CELL = ParagraphStyle("C", parent=ss["BodyText"], fontSize=7, leading=8.5)
CELLH = ParagraphStyle("CH", parent=CELL, textColor=colors.white, fontName="Helvetica-Bold")
NOTE = ParagraphStyle("N", parent=BODY, fontSize=8, textColor=colors.HexColor("#555555"))


def _table(df: pd.DataFrame, widths: list[float], tint_col: str | None = None, max_rows: int = 15) -> Table:
    df = df.head(max_rows)
    data = [[Paragraph(str(c).replace("_", " "), CELLH) for c in df.columns]]
    for _, r in df.iterrows():
        data.append([Paragraph("" if pd.isna(v) else (f"{v:,.1f}" if isinstance(v, float) else str(v)), CELL) for v in r])
    total = sum(widths)
    t = Table(data, colWidths=[w / total * 267 * mm for w in widths], repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CCCCCC")),
             ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if tint_col and tint_col in df.columns:
        for i, v in enumerate(df[tint_col], start=1):
            if v in ROW_TINT:
                style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor(ROW_TINT[v])))
    t.setStyle(TableStyle(style))
    return t


def _fig(fig) -> Image:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=125 * mm, height=70 * mm, kind="proportional")


def _style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.tick_params(labelsize=8)


def _charts(res: dict) -> list[Image]:
    T, S = res["tables"], res["summary"]
    imgs = []
    fig, ax = plt.subplots(figsize=(5.4, 3))
    pc = S["priority_counts"]
    ax.bar(pc.keys(), pc.values(), color=[PRIO[k] for k in pc])
    for i, v in enumerate(pc.values()):
        ax.text(i, v, str(v), ha="center", va="bottom", fontsize=8)
    ax.set_title("Open work by priority", fontsize=10, loc="left"); _style(ax)
    imgs.append(_fig(fig))

    op = T["prioritised_tasks"]
    ct = pd.crosstab(op.team, op.sla_status).reindex(columns=["Breached", "At Risk", "On Track"], fill_value=0)
    ct = ct.loc[ct.sum(axis=1).sort_values().index]
    fig, ax = plt.subplots(figsize=(5.4, 3))
    left = pd.Series(0, index=ct.index)
    for c in ct.columns:
        ax.barh(ct.index, ct[c], left=left, color=SLA[c], label=c)
        left += ct[c]
    ax.legend(fontsize=7, frameon=False, loc="lower right"); ax.set_title("SLA status of open work by team", fontsize=10, loc="left"); _style(ax)
    imgs.append(_fig(fig))

    tw = T["team_workload"].sort_values("workload_ratio")
    fig, ax = plt.subplots(figsize=(5.4, 3))
    ax.barh(tw.team, tw.workload_ratio, color=["#C0392B" if r > 1 else "#5B8DB8" for r in tw.workload_ratio])
    ax.axvline(1, color="#333", lw=0.8, ls="--"); ax.set_title("Backlog vs weekly capacity (1.0 = one week of work)", fontsize=10, loc="left"); _style(ax)
    imgs.append(_fig(fig))

    pt = T["performance_team"].sort_values("sla_on_time_pct")
    fig, ax = plt.subplots(figsize=(5.4, 3))
    ax.barh(pt.team, pt.sla_on_time_pct, color="#5B8DB8")
    ax.set_xlim(0, 100); ax.set_title("Completed on time (% within SLA)", fontsize=10, loc="left"); _style(ax)
    imgs.append(_fig(fig))
    return imgs


def build_pdf(res: dict, out_path: str | Path, title: str = "Production Management Report") -> Path:
    S, T = res["summary"], res["tables"]
    doc = SimpleDocTemplate(str(out_path), pagesize=landscape(A4), leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm, title=title)

    def footer(c, d):
        c.setFont("Helvetica", 7); c.setFillColor(colors.grey)
        c.drawString(15 * mm, 8 * mm, f"{title} | as of {S['as_of']} | Recommendations only - final decisions rest with authorised staff")
        c.drawRightString(282 * mm, 8 * mm, f"Page {d.page}")

    el = [Paragraph(title, ParagraphStyle("T", parent=H1, fontSize=22)), Paragraph(f"As of {S['as_of']} · analysis window {S['period_days']} days", NOTE), Spacer(1, 6)]
    # KPI strip
    kpis = [("Open cases", S["open_cases"]), ("Pending approvals", S["pending_approvals"]), ("Escalated", S["escalated"]),
            ("Past SLA (open)", f"{S['overdue_items']}"), ("Completed on time", f"{S['sla_completed_on_time_pct']}%"),
            ("Avg turnaround", f"{S['avg_turnaround_hours']}h"), ("Utilisation (7d)", f"{S['staff_utilisation_pct']}%"),
            ("Compl. exceptions", S["compliance_exceptions"]), ("AML overdue", f"{S['aml_overdue']}/{S['aml_open']}")]
    cells = [[Paragraph(f"<font size=13><b>{v}</b></font><br/><font size=7 color='#555555'>{k}</font>", BODY) for k, v in kpis]]
    kt = Table(cells, colWidths=[267 * mm / len(kpis)] * len(kpis))
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, NAVY), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CCCCCC")),
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F6FA")), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    el += [kt, Paragraph("1. Executive summary", H1)]
    el.append(Paragraph(
        f"<b>{S['open_cases']}</b> cases are open, of which <b>{S['overdue_items']}</b> are past SLA and <b>{S['at_risk_items']}</b> at risk. "
        f"<b>{S['priority_counts']['Critical']}</b> items rank Critical. Completed work met SLA in <b>{S['sla_completed_on_time_pct']}%</b> of cases "
        f"with average turnaround of <b>{S['avg_turnaround_hours']}h</b> against <b>{S['avg_processing_hours']}h</b> of actual handling time, "
        f"so most elapsed time is waiting, not working. {S['overloaded_staff']} staff are overloaded while {S['underutilised_staff']} are under-utilised. "
        f"Automation could free an estimated <b>{S['potential_hours_saved_per_week']}h/week</b> (assumption-based, needs validation).", BODY))
    el.append(Paragraph("Immediate actions", H2))
    for a in S["immediate_actions"]:
        el.append(Paragraph("• " + a, BODY))
    el.append(PageBreak())
    el.append(Paragraph("Key charts", H1))
    imgs = _charts(res)
    ch = Table([[imgs[0], imgs[1]], [imgs[2], imgs[3]]], colWidths=[133 * mm, 133 * mm])
    ch.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [ch, PageBreak()]

    el.append(Paragraph("2. Workload and priorities", H1))
    el.append(Paragraph("Priority score (0-100) = SLA urgency (max 40) + customer risk (25) + regulatory flag (20) + value (15) + escalation (5). "
                        "Breached regulated items are always Critical. Top 15 by execution rank:", NOTE))
    op = T["prioritised_tasks"][["execution_rank", "task_id", "task_type", "team", "assigned_to", "status", "customer_risk", "amount", "hours_to_due", "sla_status", "priority_score", "priority"]]
    el.append(_table(op, [5, 8, 15, 11, 7, 10, 8, 8, 8, 8, 7, 7], "priority"))
    el.append(Paragraph("Team workload", H2))
    el.append(_table(T["team_workload"][["team", "staff_count", "capacity_hours_week", "open_tasks", "open_hours", "workload_ratio", "utilisation_7d_pct", "approvers", "load_status"]],
                     [14, 7, 9, 8, 8, 8, 9, 7, 10]))
    el.append(PageBreak())

    el.append(Paragraph("3. Bottlenecks", H1))
    el.append(_table(T["bottlenecks"][["priority", "problem", "root_cause", "business_impact", "recommended_solution", "confidence", "human_review_required"]],
                     [6, 24, 20, 20, 24, 6, 7], "priority", max_rows=14))
    el.append(Paragraph("Confidence below 85% is flagged for human review. Root causes are data-driven hypotheses to be validated by the team lead.", NOTE))
    el.append(PageBreak())

    el.append(Paragraph("4. Resource optimisation - recommended reassignments", H1))
    ra = T["reassignments"]
    if len(ra):
        el.append(_table(ra[["task_id", "task_type", "priority", "sla_status", "est_hours", "from_staff", "from_team", "to_staff", "to_name", "to_team", "cross_team", "reason", "human_review_required"]],
                         [7, 14, 6, 7, 5, 7, 9, 6, 10, 9, 5, 12, 7], "priority", max_rows=14))
        el.append(Paragraph(f"{len(ra)} reassignments proposed in total (full list in XLSX / CSV). Cross-team moves require a skills and authority check by the team lead.", NOTE))
    el.append(Paragraph("Staff at or above capacity", H2))
    sw = T["staff_workload"].sort_values("workload_ratio", ascending=False).head(8)
    el.append(_table(sw, [6, 12, 11, 9, 8, 7, 7, 8, 8, 9, 9], max_rows=8))
    el.append(PageBreak())

    el.append(Paragraph("5. Compliance and risk", H1))
    el.append(Paragraph("Risk register", H2))
    el.append(_table(T["risk_register"][["category", "risk_description", "likelihood_1_5", "impact_1_5", "risk_score", "rating", "mitigation", "escalation_required", "confidence"]],
                     [8, 24, 5, 5, 5, 6, 24, 12, 5], "rating"))
    el.append(Paragraph("Compliance exceptions (top 15 of %d)" % len(T["compliance_exceptions"]), H2))
    el.append(_table(T["compliance_exceptions"], [40, 12, 8, 6, 6, 22], "severity" if False else None))
    el.append(PageBreak())

    el.append(Paragraph("6. Performance and quality", H1))
    pcols = ["team", "completed", "open_tasks", "breached", "throughput_per_day", "avg_tat_hours", "avg_processing_hours", "sla_on_time_pct", "completion_rate_pct", "error_rate_pct", "rework_rate_pct"]
    el.append(Paragraph("By team", H2)); el.append(_table(T["performance_team"][pcols], [12] + [7] * 10))
    el.append(Paragraph("By branch", H2)); el.append(_table(T["performance_branch"][["branch"] + pcols[1:]], [12] + [7] * 10))
    el.append(Paragraph("Quality findings", H2))
    if len(T["quality"]):
        el.append(_table(T["quality"][["priority", "type", "finding", "recommended_action", "confidence", "human_review_required"]], [6, 9, 30, 30, 6, 7], "priority"))
    el.append(PageBreak())

    el.append(Paragraph("7. Process optimisation and automation", H1))
    el.append(Paragraph("Automation candidates", H2))
    el.append(_table(T["automation"][["process", "team", "volume_per_week", "manual_hours_per_week", "assumed_automation_share", "est_hours_saved_per_week", "automation_recommendation", "confidence"]],
                     [14, 11, 6, 7, 7, 7, 34, 5], max_rows=12))
    el.append(Paragraph("Automation shares are planning assumptions (see analysis.AUTOMATION_POTENTIAL), not measurements; validate with process owners before committing. "
                        "Regulated decisions (credit approval etc.) stay with authorised staff.", NOTE))
    el.append(Paragraph("Other process improvements", H2))
    el.append(_table(T["process_optimisation"][["opportunity", "detail", "estimated_hours_saved", "recommendation", "confidence"]], [12, 40, 8, 30, 5]))
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return Path(out_path)

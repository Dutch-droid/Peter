"""Rule-based operational analysis. Every result is a DataFrame so all export formats stay consistent.

All thresholds and assumptions live in CONFIG so managers can review and tune them.
Nothing here approves, declines or decides: outputs are recommendations for authorised staff.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .schema import OPEN_STATUSES

CONFIG = {
    "at_risk_pct_remaining": 0.25,   # <25% of SLA window left => At Risk
    "at_risk_hours": 8,              # or fewer than 8h left
    "band_critical": 70, "band_high": 50, "band_medium": 30,
    "overload_ratio": 1.0,           # open hours / weekly capacity
    "idle_ratio": 0.30,
    "idle_util_pct": 50,             # and < 50% of capacity actually worked in the last 7 days
    "review_confidence": 0.85,       # below => human review required
    "min_bottleneck_items": 5,
    "rework_rate_flag": 0.20,
    "error_multiple_flag": 1.5,
    "min_sample": 8,
}
# Assumed share of manual effort automation could remove. Assumptions, not measurements:
# they are shown in the output and always flagged for human validation.
AUTOMATION_POTENTIAL = {
    "Document Check": (0.60, "Automated document completeness / expiry validation"),
    "Data Entry / Reconciliation": (0.70, "Automated cross-system reconciliation (CRM / Loan Mgmt / NAV)"),
    "Management Reporting": (0.80, "Scheduled auto-generated SLA / workload reports"),
    "KYC Review": (0.35, "Pre-populated KYC checklist with automated screening; analyst reviews exceptions"),
    "AML Alert Review": (0.25, "Alert triage scoring to auto-close clear false positives (sampled by humans)"),
    "Customer Request": (0.45, "Templated responses and status self-service for routine requests"),
    "Collections Follow-up": (0.50, "Automated reminder sequences with escalation triggers"),
    "Loan Application Intake": (0.45, "Automated intake validation and routing"),
    "Complaint Handling": (0.20, "Auto-classification and routing of complaints"),
    "Credit Assessment": (0.20, "Automated data gathering / spreading; credit decision stays human"),
    "Risk Review": (0.25, "Scheduled review triggers and pre-filled review packs"),
    "Loan Approval Recommendation": (0.10, "Pack assembly only; approval stays with authorised staff"),
}


def _conf(n: int, cap: float = 0.95, floor: float = 0.55, full_at: int = 25) -> float:
    return round(min(cap, floor + (cap - floor) * min(1.0, n / full_at)), 2)


def _review(df: pd.DataFrame) -> pd.DataFrame:
    df["human_review_required"] = np.where(df["confidence"] < CONFIG["review_confidence"], "Yes", "No")
    return df


def analyse(tables: dict[str, pd.DataFrame], as_of: pd.Timestamp) -> dict:
    tasks, staff, comp = tables["tasks"].copy(), tables["staff"].copy(), tables["compliance"].copy()
    C = CONFIG
    for c in ("rework_count", "handoff_count", "est_hours", "actual_hours", "amount"):
        tasks[c] = pd.to_numeric(tasks[c], errors="coerce")
    tasks["rework_count"] = tasks["rework_count"].fillna(0)
    tasks["handoff_count"] = tasks["handoff_count"].fillna(0)
    done = tasks[tasks.status == "Completed"].copy()
    op = tasks[tasks.status.isin(OPEN_STATUSES)].copy()

    # ---------------- SLA + priority
    op["age_hours"] = ((as_of - op.created_at) / pd.Timedelta(hours=1)).round(1)
    op["hours_to_due"] = ((op.due_at - as_of) / pd.Timedelta(hours=1)).round(1)
    window = ((op.due_at - op.created_at) / pd.Timedelta(hours=1)).clip(lower=1)
    op["pct_remaining"] = (op.hours_to_due / window)
    op["sla_status"] = np.select(
        [op.hours_to_due < 0,
         (op.pct_remaining < C["at_risk_pct_remaining"]) | (op.hours_to_due < C["at_risk_hours"])],
        ["Breached", "At Risk"], "On Track")
    sla_pts = np.select([op.sla_status == "Breached", op.sla_status == "At Risk"],
                        [40, 30], (1 - op.pct_remaining.clip(0, 1)) * 20)
    risk_pts = op.customer_risk.map({"High": 25, "Medium": 13, "Low": 3}).fillna(3)
    reg_pts = np.where(op.regulatory_flag == "Y", 20, 0)
    p90 = max(op.amount.quantile(0.9), 1) if op.amount.notna().any() else 1
    rev_pts = (op.amount.fillna(0) / p90 * 15).clip(0, 15)
    esc_pts = np.where(op.status == "Escalated", 5, 0)
    op["priority_score"] = (sla_pts + risk_pts + reg_pts + rev_pts + esc_pts).clip(0, 100).round(1)
    band = np.select([op.priority_score >= C["band_critical"], op.priority_score >= C["band_high"],
                      op.priority_score >= C["band_medium"]], ["Critical", "High", "Medium"], "Low")
    op["priority"] = band
    op.loc[(op.sla_status == "Breached") & (op.regulatory_flag == "Y"), "priority"] = "Critical"
    prio_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    op = op.sort_values(["priority", "priority_score"], key=lambda s: s.map(prio_order) if s.name == "priority" else -s)
    op["execution_rank"] = range(1, len(op) + 1)

    # ---------------- workload / utilisation
    cap = staff.set_index("staff_id")
    load = op.groupby("assigned_to").est_hours.sum()
    staff["open_tasks"] = staff.staff_id.map(op.groupby("assigned_to").size()).fillna(0).astype(int)
    staff["open_hours"] = staff.staff_id.map(load).fillna(0).round(1)
    staff["workload_ratio"] = (staff.open_hours / staff.capacity_hours_week).round(2)
    recent = done[done.completed_at >= as_of - pd.Timedelta(days=7)]
    staff["hours_worked_7d"] = staff.staff_id.map(recent.groupby("assigned_to").actual_hours.sum()).fillna(0).round(1)
    staff["utilisation_7d_pct"] = (staff.hours_worked_7d / staff.capacity_hours_week * 100).round(0)
    staff["load_status"] = np.select(
        [staff.workload_ratio > C["overload_ratio"],
         (staff.workload_ratio < C["idle_ratio"]) & (staff.utilisation_7d_pct < C["idle_util_pct"])],
        ["Overloaded", "Under-utilised"], "Balanced")
    tw = staff.groupby("team").agg(staff_count=("staff_id", "count"), capacity_hours_week=("capacity_hours_week", "sum"),
                                   open_hours=("open_hours", "sum"), open_tasks=("open_tasks", "sum"),
                                   hours_worked_7d=("hours_worked_7d", "sum")).reset_index()
    tw["workload_ratio"] = (tw.open_hours / tw.capacity_hours_week).round(2)
    tw["utilisation_7d_pct"] = (tw.hours_worked_7d / tw.capacity_hours_week * 100).round(0)
    tw["approvers"] = tw.team.map(staff[staff.approval_authority == "Y"].groupby("team").size()).fillna(0).astype(int)
    tw["load_status"] = np.select([tw.workload_ratio > C["overload_ratio"],
                                   (tw.workload_ratio < C["idle_ratio"]) & (tw.utilisation_7d_pct < C["idle_util_pct"])],
                                  ["Overloaded", "Under-utilised"], "Balanced")
    unassigned = op[op.assigned_to.isna()]

    # ---------------- reassignment recommendations (greedy, recommendation only)
    sim = staff.set_index("staff_id")[["team", "capacity_hours_week", "open_hours", "skills", "approval_authority", "name"]].copy()
    recs = []
    cand = op[(op.priority.isin(["Critical", "High", "Medium"])) & (op.status != "Pending Approval")]
    cand = cand[(cand.assigned_to.isna()) | (cand.assigned_to.map(sim.open_hours / sim.capacity_hours_week) > C["overload_ratio"])]
    for _, t in cand.iterrows():
        cur = t.assigned_to if pd.notna(t.assigned_to) else None
        pool = sim[(sim.skills.fillna("").str.contains(t.task_type, regex=False)) & (sim.index != cur)]
        pool = pool[(pool.open_hours + t.est_hours) <= pool.capacity_hours_week * 0.9]
        if pool.empty:
            continue
        ratio = pool.open_hours / pool.capacity_hours_week
        pick = ratio.idxmin()
        recs.append({"task_id": t.task_id, "task_type": t.task_type, "priority": t.priority, "sla_status": t.sla_status,
                     "est_hours": t.est_hours, "from_staff": cur or "(unassigned)", "from_team": t.team,
                     "to_staff": pick, "to_name": sim.loc[pick, "name"], "to_team": sim.loc[pick, "team"],
                     "cross_team": "Yes" if sim.loc[pick, "team"] != t.team else "No",
                     "to_ratio_before": round(float(ratio[pick]), 2),
                     "reason": "Assignee overloaded" if cur else "Unassigned open item",
                     "confidence": 0.9 if sim.loc[pick, "team"] == t.team else 0.8})
        sim.loc[pick, "open_hours"] += t.est_hours
        if cur:
            sim.loc[cur, "open_hours"] -= t.est_hours
        if len(recs) >= 40:
            break
    reassign = _review(pd.DataFrame(recs, columns=["task_id", "task_type", "priority", "sla_status", "est_hours", "from_staff",
                       "from_team", "to_staff", "to_name", "to_team", "cross_team", "to_ratio_before", "reason", "confidence"]))

    # ---------------- performance
    span_days = max((as_of - tasks.created_at.min()).days, 1)
    done["tat_hours"] = (done.completed_at - done.created_at) / pd.Timedelta(hours=1)
    done["on_time"] = done.completed_at <= done.due_at

    def perf(by: str) -> pd.DataFrame:
        d = done.groupby(by).agg(completed=("task_id", "count"), avg_tat_hours=("tat_hours", "mean"),
                                 avg_processing_hours=("actual_hours", "mean"),
                                 sla_on_time_pct=("on_time", "mean"),
                                 error_rate=("error_flag", lambda s: (s == "Y").mean()),
                                 rework_rate=("rework_count", lambda s: (s > 0).mean())).reset_index()
        o = op.groupby(by).agg(open_tasks=("task_id", "count"), breached=("sla_status", lambda s: (s == "Breached").sum())).reset_index()
        d = d.merge(o, on=by, how="outer").fillna(0)
        d["throughput_per_day"] = (d.completed / span_days).round(2)
        d["completion_rate"] = (d.completed / (d.completed + d.open_tasks).replace(0, np.nan))
        for c in ("avg_tat_hours", "avg_processing_hours"):
            d[c] = d[c].round(1)
        for c in ("sla_on_time_pct", "error_rate", "rework_rate", "completion_rate"):
            d[c] = (d[c] * 100).round(1)
        return d.rename(columns={"sla_on_time_pct": "sla_on_time_pct", "error_rate": "error_rate_pct",
                                 "rework_rate": "rework_rate_pct", "completion_rate": "completion_rate_pct"})
    perf_team, perf_branch, perf_type = perf("team"), perf("branch"), perf("task_type")
    perf_staff = perf("assigned_to").rename(columns={"assigned_to": "staff_id"})
    perf_staff = perf_staff.merge(staff[["staff_id", "name", "team", "workload_ratio"]], on="staff_id", how="left")

    # ---------------- bottlenecks
    bn = []
    for team, g in op[op.status.isin(["Pending Approval", "Escalated", "Rework", "Pending Review"])].groupby(["team", "status"]):
        n = len(g)
        if n < C["min_bottleneck_items"]:
            continue
        team_n, status = team
        breach = (g.sla_status == "Breached").mean()
        others = op[(op.status == status) & (op.team != team_n)]
        base_age = others.age_hours.median() if len(others) else g.age_hours.median()
        if breach < 0.4 and g.age_hours.median() < 1.5 * base_age:
            continue
        appr = int(tw.loc[tw.team == team_n, "approvers"].iloc[0])
        if status == "Pending Approval":
            cause = (f"{n} items wait on {appr} approver(s) ({n / max(appr, 1):.0f} items per approver)"
                     if appr else "No staff with approval authority in the team")
            sol = "Delegate approval authority (within policy) or add a temporary approver; batch daily approval slots"
            conf = _conf(n, cap=0.9) if appr <= 2 else _conf(n, cap=0.8)
        elif status == "Rework":
            cause = "Items returned for missing/incorrect inputs; see rework hot-spots"
            sol = "Add upfront completeness checks; feedback loop to the originating step"
            conf = _conf(n, cap=0.8)
        elif status == "Escalated":
            cause = "Items overrun SLA and escalate without a clear owner"
            sol = "Define escalation owners and a daily escalation stand-up"
            conf = _conf(n, cap=0.8)
        else:
            cause = "Reviewer capacity below inflow"
            sol = "Rebalance reviews to under-used staff with matching skills"
            conf = _conf(n, cap=0.8)
        bn.append({"problem": f"{team_n}: {n} items stuck in '{status}' (median age {g.age_hours.median():.0f}h, {breach:.0%} breached)",
                   "category": "Stalled workflow", "team": team_n, "root_cause": cause,
                   "business_impact": f"{int((g.sla_status == 'Breached').sum())} SLA breaches; ~{g.est_hours.sum():.0f}h of work and €{g.amount.sum():,.0f} of value delayed",
                   "recommended_solution": sol,
                   "priority": "Critical" if breach >= 0.7 and status == "Pending Approval" else "High" if breach >= 0.4 else "Medium",
                   "confidence": conf})
    for _, r in tw[tw.load_status == "Overloaded"].iterrows():
        helpers = staff[(staff.load_status == "Under-utilised") & (staff.team != r.team)]
        bn.append({"problem": f"{r.team} overloaded: {r.open_hours:.0f}h open vs {r.capacity_hours_week:.0f}h weekly capacity ({r.workload_ratio:.2f}x)",
                   "category": "Overloaded team", "team": r.team,
                   "root_cause": f"Inflow exceeds capacity of {int(r.staff_count)} staff",
                   "business_impact": f"{int(r.open_tasks)} open items, backlog ≈ {r.workload_ratio:.1f} weeks of work",
                   "recommended_solution": ("Cross-skill/redeploy under-used staff (" + ", ".join(helpers.staff_id.head(3)) + ") after skills check; consider temporary staffing or overtime"
                                            if len(helpers) else "Temporary staffing or overtime; reprioritise low-value work"),
                   "priority": "Critical" if r.workload_ratio > 1.5 else "High",
                   "confidence": _conf(int(r.open_tasks), cap=0.92)})
    for _, r in staff[(staff.workload_ratio > 1.5)].iterrows():
        bn.append({"problem": f"{r['name']} ({r.staff_id}, {r.team}) at {r.workload_ratio:.2f}x capacity",
                   "category": "Overloaded individual", "team": r.team,
                   "root_cause": "Uneven task assignment within the team",
                   "business_impact": f"{r.open_tasks} open items ({r.open_hours:.0f}h)",
                   "recommended_solution": "Rebalance via reassignment table; consider auto-routing by capacity",
                   "priority": "High", "confidence": _conf(int(r.open_tasks), cap=0.9)})
    idle = staff[staff.load_status == "Under-utilised"]
    for team, g in idle.groupby("team"):
        if len(g) >= 2:
            bn.append({"problem": f"{team}: {len(g)} staff under-utilised (low backlog and <{C['idle_util_pct']}% of capacity worked in 7 days)",
                       "category": "Idle resources", "team": team,
                       "root_cause": "Demand below capacity or skewed assignment",
                       "business_impact": f"~{(g.capacity_hours_week - g.open_hours).sum():.0f}h/week spare capacity",
                       "recommended_solution": "Cross-train and lend capacity to overloaded teams",
                       "priority": "Medium", "confidence": _conf(len(g), cap=0.85, full_at=6)})
    rw = done.groupby("task_type").agg(n=("task_id", "count"), rate=("rework_count", lambda s: (s > 0).mean()))
    for ttype, r in rw[(rw.rate >= C["rework_rate_flag"]) & (rw.n >= C["min_sample"])].iterrows():
        bn.append({"problem": f"Repeated rework on '{ttype}' ({r.rate:.0%} of {int(r.n)} completed items)",
                   "category": "Repeated failure", "team": TEAM_OF(tasks, ttype),
                   "root_cause": "Incomplete inputs at intake or unclear acceptance criteria (hypothesis)",
                   "business_impact": "Extra handling time and longer turnaround",
                   "recommended_solution": "Introduce intake checklist / automated completeness check; review top rework reasons",
                   "priority": "High", "confidence": _conf(int(r.n), cap=0.8)})
    bottlenecks = _review(pd.DataFrame(bn, columns=["problem", "category", "team", "root_cause", "business_impact",
                                                   "recommended_solution", "priority", "confidence"]))
    bottlenecks["priority"] = pd.Categorical(bottlenecks.priority, ["Critical", "High", "Medium", "Low"], ordered=True)
    bottlenecks = bottlenecks.sort_values(["priority", "confidence"], ascending=[True, False]).reset_index(drop=True)
    bottlenecks["priority"] = bottlenecks.priority.astype(str)

    # ---------------- quality
    qual = []
    overall_err = (done.error_flag == "Y").mean() if len(done) else 0
    for sid, g in done.groupby("assigned_to"):
        if len(g) >= C["min_sample"]:
            er = (g.error_flag == "Y").mean()
            if er >= C["error_multiple_flag"] * max(overall_err, 0.02):
                nm = staff.loc[staff.staff_id == sid, "name"].iloc[0]
                qual.append({"finding": f"{nm} ({sid}) error rate {er:.0%} vs {overall_err:.0%} average ({len(g)} items)",
                             "type": "Training gap", "scope": sid, "recommended_action": "Targeted coaching and 100% peer review for 2 weeks",
                             "priority": "High", "confidence": _conf(len(g), cap=0.85, full_at=30)})
    for ttype, r in rw[(rw.rate >= C["rework_rate_flag"]) & (rw.n >= C["min_sample"])].iterrows():
        qual.append({"finding": f"'{ttype}' rework rate {r.rate:.0%}", "type": "Process failure", "scope": ttype,
                     "recommended_action": "Root-cause top rework reasons; add checklist at intake", "priority": "High",
                     "confidence": _conf(int(r.n), cap=0.8)})
    reg_done = done[done.regulatory_flag == "Y"]
    miss = reg_done[reg_done.approved_by.isna()]
    if len(miss):
        qual.append({"finding": f"{len(miss)} completed regulated items have no recorded approver ({len(miss) / len(reg_done):.1%})",
                     "type": "Compliance gap", "scope": "regulated items", "recommended_action": "Audit sample; enforce approver field in workflow",
                     "priority": "Critical", "confidence": 0.9})
    quality = _review(pd.DataFrame(qual, columns=["finding", "type", "scope", "recommended_action", "priority", "confidence"]))

    # ---------------- compliance exceptions
    ce = []
    c_open = comp[comp.status != "Cleared"]
    for _, r in c_open[c_open.due_at < as_of].iterrows():
        ce.append({"exception": f"Overdue {r.check_type} ({r.item_id}): {r.description}", "type": r.check_type, "reference": r.item_id,
                   "severity": r.severity, "days_overdue": int((as_of - r.due_at).days), "action": "Assign owner and clear or escalate"})
    for _, r in op[(op.status == "Pending Approval") & (op.assigned_to.map(cap.approval_authority) != "Y")].iterrows():
        ce.append({"exception": f"Approval pending with non-approver ({r.assigned_to}) on {r.task_id}", "type": "Policy violation",
                   "reference": r.task_id, "severity": "High", "days_overdue": 0, "action": "Route to authorised approver"})
    for _, r in miss.iterrows():
        ce.append({"exception": f"Missing approval on completed regulated item {r.task_id}", "type": "Missing approval",
                   "reference": r.task_id, "severity": "High", "days_overdue": 0, "action": "Retrospective approval / audit review"})
    for _, r in op[(op.regulatory_flag == "Y") & (op.sla_status == "Breached")].iterrows():
        ce.append({"exception": f"Regulated item {r.task_id} ({r.task_type}) past SLA by {abs(r.hours_to_due):.0f}h", "type": "Regulatory SLA breach",
                   "reference": r.task_id, "severity": "High" if r.customer_risk == "High" else "Medium",
                   "days_overdue": int(abs(r.hours_to_due) // 24), "action": "Prioritise and notify compliance"})
    exceptions = pd.DataFrame(ce, columns=["exception", "type", "reference", "severity", "days_overdue", "action"])
    exceptions["severity"] = pd.Categorical(exceptions.severity, ["High", "Medium", "Low"], ordered=True)
    exceptions = exceptions.sort_values(["severity", "days_overdue"], ascending=[True, False]).reset_index(drop=True)
    exceptions["severity"] = exceptions.severity.astype(str)
    aml_open = int(((comp.check_type == "AML") & (comp.status != "Cleared")).sum())
    aml_overdue = int(((comp.check_type == "AML") & (comp.status != "Cleared") & (comp.due_at < as_of)).sum())

    # ---------------- risk register
    def rating(s: int) -> str:
        return "Critical" if s >= 15 else "High" if s >= 10 else "Medium" if s >= 5 else "Low"
    breached = op[op.sla_status == "Breached"]
    hr_breach = breached[breached.customer_risk == "High"]
    coll_breach = breached[breached.task_type == "Collections Follow-up"]
    risks = [
        ("Operational", f"{len(breached)} open items past SLA ({len(breached) / max(len(op), 1):.0%} of backlog)",
         5 if len(breached) / max(len(op), 1) > 0.4 else 4 if len(breached) / max(len(op), 1) > 0.2 else 3, 4,
         "Reprioritise using execution ranking; redeploy capacity to breached queues", 0.9),
        ("Compliance", f"{len(exceptions)} compliance exceptions incl. {aml_overdue} overdue AML reviews",
         4 if aml_overdue else 3, 5 if aml_overdue else 4, "Clear overdue AML/KYC first; weekly compliance stand-up", 0.85),
        ("Capacity", "Overloaded teams: " + (", ".join(tw[tw.load_status == "Overloaded"].team) or "none"),
         5 if (tw.workload_ratio > 1.5).any() else 3, 4, "Redeploy, cross-skill, temporary staffing / overtime", 0.85),
        ("Customer service", f"{len(hr_breach)} breached items belong to High-risk customers",
         4 if len(hr_breach) else 2, 4, "Named owner and daily review of High-risk customer items", 0.85),
        ("Financial", f"€{coll_breach.amount.sum():,.0f} exposure with collections follow-ups past SLA ({len(coll_breach)} items)",
         4 if len(coll_breach) else 2, 3 if coll_breach.amount.sum() < 5e6 else 4, "Automated reminders with escalation ladder", 0.75),
    ]
    risk_df = pd.DataFrame(risks, columns=["category", "risk_description", "likelihood_1_5", "impact_1_5", "mitigation", "confidence"])
    risk_df["risk_score"] = risk_df.likelihood_1_5 * risk_df.impact_1_5
    risk_df["rating"] = risk_df.risk_score.map(rating)
    risk_df["escalation_required"] = np.where(risk_df.risk_score >= 15, "Yes - senior management now",
                                              np.where(risk_df.risk_score >= 10, "Yes - department head", "No"))
    risk_df = _review(risk_df[["category", "risk_description", "likelihood_1_5", "impact_1_5", "risk_score", "rating",
                               "mitigation", "escalation_required", "confidence"]].sort_values("risk_score", ascending=False))

    # ---------------- automation + process optimisation
    weeks = max(span_days / 7, 1)
    auto = []
    for ttype, g in tasks.groupby("task_type"):
        hrs = g.actual_hours.fillna(g.est_hours).sum()
        per_week = hrs / weeks
        pot, rec = AUTOMATION_POTENTIAL.get(ttype, (0.15, "Review for automation"))
        rework_hrs = (g.rework_count.clip(lower=0) * g.est_hours * 0.4).sum() / weeks
        auto.append({"process": ttype, "team": g.team.iloc[0], "volume_per_week": round(len(g) / weeks, 1),
                     "manual_hours_per_week": round(per_week, 1), "assumed_automation_share": pot,
                     "est_hours_saved_per_week": round(per_week * pot, 1),
                     "est_rework_hours_per_week": round(rework_hrs, 1),
                     "automation_recommendation": rec,
                     "business_benefit": "Faster turnaround, fewer errors, capacity freed for backlog",
                     "confidence": 0.7})
    automation = pd.DataFrame(auto).sort_values("est_hours_saved_per_week", ascending=False).reset_index(drop=True)
    automation["human_review_required"] = "Yes"  # potentials are assumptions until validated

    po = []
    dup = op.groupby(["customer_id", "task_type"]).filter(lambda g: len(g) > 1 and g.customer_id.notna().all())
    for (cid, tt), g in dup.groupby(["customer_id", "task_type"]):
        po.append({"opportunity": "Duplicate work", "detail": f"{len(g)} open '{tt}' items for customer {cid}: {', '.join(g.task_id)}",
                   "estimated_hours_saved": round(g.est_hours.iloc[1:].sum(), 1), "recommendation": "Merge duplicates; add duplicate check at intake",
                   "confidence": 0.9})
    long_chain = tasks[tasks.handoff_count >= 4]
    if len(long_chain):
        by_type = long_chain.groupby("task_type").size().sort_values(ascending=False)
        po.append({"opportunity": "Long handoff chains", "detail": f"{len(long_chain)} items with 4+ handoffs; most in {by_type.index[0]} ({by_type.iloc[0]})",
                   "estimated_hours_saved": round(len(long_chain) * 0.25, 1), "recommendation": "Map the flow; remove non-value handoffs; single owner per case",
                   "confidence": 0.7})
    loops = tasks[tasks.rework_count >= 2]
    if len(loops):
        po.append({"opportunity": "Rework loops", "detail": f"{len(loops)} items returned 2+ times", "estimated_hours_saved": round(loops.est_hours.sum() * 0.4, 1),
                   "recommendation": "Fix at source: intake checklist, clear acceptance criteria", "confidence": 0.75})
    if len(unassigned):
        po.append({"opportunity": "Unassigned work", "detail": f"{len(unassigned)} open items without an owner", "estimated_hours_saved": 0.0,
                   "recommendation": "Auto-routing by skill, capacity and SLA", "confidence": 0.95})
    process_opt = _review(pd.DataFrame(po, columns=["opportunity", "detail", "estimated_hours_saved", "recommendation", "confidence"]))

    # ---------------- summary
    sla_counts = op.sla_status.value_counts().to_dict()
    prio_counts = op.priority.value_counts().to_dict()
    summary = {
        "as_of": str(as_of), "open_cases": int(len(op)), "completed_in_period": int(len(done)), "period_days": int(span_days),
        "pending_approvals": int((op.status == "Pending Approval").sum()), "escalated": int((op.status == "Escalated").sum()),
        "overdue_items": int(sla_counts.get("Breached", 0)), "at_risk_items": int(sla_counts.get("At Risk", 0)),
        "sla_open_breach_pct": round(sla_counts.get("Breached", 0) / max(len(op), 1) * 100, 1),
        "sla_completed_on_time_pct": round(done.on_time.mean() * 100, 1) if len(done) else None,
        "avg_turnaround_hours": round(done.tat_hours.mean(), 1) if len(done) else None,
        "avg_processing_hours": round(done.actual_hours.mean(), 1) if len(done) else None,
        "error_rate_pct": round(overall_err * 100, 1),
        "rework_rate_pct": round((done.rework_count > 0).mean() * 100, 1) if len(done) else None,
        "staff_utilisation_pct": round(staff.hours_worked_7d.sum() / staff.capacity_hours_week.sum() * 100, 1),
        "overloaded_staff": int((staff.load_status == "Overloaded").sum()), "underutilised_staff": int((staff.load_status == "Under-utilised").sum()),
        "unassigned_open": int(len(unassigned)),
        "compliance_exceptions": int(len(exceptions)), "aml_open": aml_open, "aml_overdue": aml_overdue,
        "high_risk_customer_open_items": int((op.customer_risk == "High").sum()),
        "priority_counts": {k: int(prio_counts.get(k, 0)) for k in ["Critical", "High", "Medium", "Low"]},
        "sla_counts": {k: int(sla_counts.get(k, 0)) for k in ["Breached", "At Risk", "On Track"]},
        "potential_hours_saved_per_week": round(float(automation.est_hours_saved_per_week.sum()), 1),
        "items_needing_human_review": int((bottlenecks.human_review_required == "Yes").sum() + (risk_df.human_review_required == "Yes").sum()
                                          + (reassign.human_review_required == "Yes").sum() + len(automation)),
    }
    top_actions = []
    if not bottlenecks.empty:
        for _, b in bottlenecks[bottlenecks.priority.isin(["Critical", "High"])].head(4).iterrows():
            top_actions.append(f"[{b.priority}] {b.problem} → {b.recommended_solution}")
    if aml_overdue:
        top_actions.append(f"[Critical] {aml_overdue} AML reviews overdue → clear or escalate to Compliance head today")
    summary["immediate_actions"] = top_actions

    open_cols = ["execution_rank", "task_id", "task_type", "team", "branch", "assigned_to", "status", "customer_risk",
                 "regulatory_flag", "amount", "est_hours", "age_hours", "hours_to_due", "sla_status", "priority_score", "priority"]
    tables_out = {
        "prioritised_tasks": op[open_cols].reset_index(drop=True),
        "sla_status": op[op.sla_status != "On Track"][open_cols].reset_index(drop=True),
        "reassignments": reassign,
        "team_workload": tw,
        "staff_workload": staff[["staff_id", "name", "team", "branch", "capacity_hours_week", "open_tasks", "open_hours", "workload_ratio", "hours_worked_7d", "utilisation_7d_pct", "load_status"]],
        "bottlenecks": bottlenecks,
        "quality": quality,
        "compliance_exceptions": exceptions,
        "risk_register": risk_df,
        "automation": automation,
        "process_optimisation": process_opt,
        "performance_team": perf_team, "performance_branch": perf_branch,
        "performance_task_type": perf_type, "performance_staff": perf_staff,
    }
    return {"summary": summary, "tables": tables_out}


def TEAM_OF(tasks: pd.DataFrame, ttype: str) -> str:
    return str(tasks.loc[tasks.task_type == ttype, "team"].iloc[0])

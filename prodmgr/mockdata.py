"""Seeded synthetic data generator with deliberately planted operational problems."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

AS_OF = pd.Timestamp("2026-09-30 09:00")
BRANCHES = ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven"]

# team -> (headcount, weekly task share, speed multiplier (>1 = slower))
TEAMS = {
    "Loan Origination": (6, 0.22, 1.5),
    "Credit Risk": (4, 0.20, 2.0),      # planted: understaffed and slow
    "Compliance": (6, 0.18, 1.2),
    "Customer Service": (8, 0.12, 0.5),  # planted: spare capacity
    "Collections": (4, 0.10, 1.1),
    "Operations": (6, 0.18, 0.9),
}
# task_type: (team, sla_hours, base_hours, regulatory prob, share within team)
TYPES = {
    "Loan Application Intake": ("Loan Origination", 24, 1.5, 0.2, 0.5),
    "Loan Approval Recommendation": ("Loan Origination", 48, 3.0, 1.0, 0.5),
    "Credit Assessment": ("Credit Risk", 72, 5.0, 0.8, 0.6),
    "Risk Review": ("Credit Risk", 120, 4.0, 1.0, 0.4),
    "KYC Review": ("Compliance", 48, 2.5, 1.0, 0.6),
    "AML Alert Review": ("Compliance", 24, 3.0, 1.0, 0.4),
    "Customer Request": ("Customer Service", 24, 0.8, 0.0, 0.6),
    "Complaint Handling": ("Customer Service", 72, 2.0, 0.3, 0.4),
    "Collections Follow-up": ("Collections", 96, 1.5, 0.2, 1.0),
    "Data Entry / Reconciliation": ("Operations", 48, 1.2, 0.0, 0.4),
    "Document Check": ("Operations", 24, 0.8, 0.3, 0.4),
    "Management Reporting": ("Operations", 72, 3.5, 0.0, 0.2),
}
SOURCES = {"Loan Origination": "Loan Mgmt", "Credit Risk": "Credit Risk", "Compliance": "CRM",
           "Customer Service": "CRM", "Collections": "Core Banking", "Operations": "NAV"}
FIRST = ["Sam", "Noor", "Daan", "Emma", "Lars", "Sanne", "Milan", "Fleur", "Thijs", "Lotte",
         "Bram", "Iris", "Jesse", "Eva", "Ruben", "Anouk", "Sem", "Lisa", "Niels", "Maud"]
LAST = ["de Vries", "Jansen", "Bakker", "Visser", "Smit", "Meijer", "de Boer", "Mulder", "Bos", "Vos"]


def generate(seed: int = 42, n_tasks: int = 2000, as_of: pd.Timestamp = AS_OF) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)

    # ---- staff
    staff = []
    sid = 1
    for team, (n, _, _) in TEAMS.items():
        team_types = [t for t, v in TYPES.items() if v[0] == team]
        for i in range(n):
            skills = team_types if rng.random() < 0.7 else team_types[:1]
            # cross-skilling: some Customer Service / Operations staff can help Compliance / Collections
            if team == "Customer Service" and i < 3:
                skills = skills + ["KYC Review", "Collections Follow-up"]
            if team == "Loan Origination" and i >= 3:
                skills = skills + ["Credit Assessment", "Risk Review"]
            if team == "Operations" and i < 2:
                skills = skills + ["Loan Application Intake"]
            staff.append({
                "staff_id": f"S{sid:03d}",
                "name": f"{rng.choice(FIRST)} {rng.choice(LAST)}",
                "team": team, "branch": BRANCHES[int(rng.integers(0, 4))],
                "role": "Team Lead" if i == 0 else "Analyst",
                "capacity_hours_week": float(rng.choice([24, 32, 36, 40], p=[0.1, 0.25, 0.25, 0.4])),
                "skills": ";".join(skills),
                # planted: only 2 approvers for Loan Origination, 1 for Credit Risk
                "approval_authority": "Y" if (team in ("Loan Origination", "Credit Risk") and i < (2 if team == "Loan Origination" else 1))
                or (team in ("Compliance", "Collections") and i == 0) else "N",
            })
            sid += 1
    staff = pd.DataFrame(staff)
    bad_error_staff = staff[staff.team == "Compliance"].staff_id.iloc[2]  # planted quality outlier

    # ---- customers
    n_cust = 300
    cust_risk = rng.choice(["Low", "Medium", "High"], size=n_cust, p=[0.6, 0.28, 0.12])
    cust_ids = [f"C{i:04d}" for i in range(1, n_cust + 1)]

    # ---- tasks
    team_names = list(TEAMS)
    team_p = np.array([v[1] for v in TEAMS.values()])
    team_p = team_p / team_p.sum()
    rows = []
    for i in range(1, n_tasks + 1):
        team = rng.choice(team_names, p=team_p)
        tnames = [t for t, v in TYPES.items() if v[0] == team]
        tp = np.array([TYPES[t][4] for t in tnames])
        ttype = rng.choice(tnames, p=tp / tp.sum())
        _, sla_h, base_h, reg_p, _ = TYPES[ttype]
        team_staff = staff[staff.team == team]
        # planted: uneven assignment (first staff get more)
        w = np.linspace(2.0, 0.6, len(team_staff))
        assignee = team_staff.staff_id.iloc[rng.choice(len(team_staff), p=w / w.sum())]
        if team == "Customer Service" and rng.random() < 0.5:  # idle: skew toward two people
            assignee = team_staff.staff_id.iloc[rng.integers(0, 2)]
        branch = staff.set_index("staff_id").loc[assignee, "branch"]
        created = as_of - pd.Timedelta(hours=float(rng.uniform(2, 45 * 24)))
        sla_window = pd.Timedelta(hours=sla_h)
        due = created + sla_window
        cidx = rng.integers(0, n_cust)
        amount = float(np.round(rng.lognormal(10.8, 1.1), -2)) if team in ("Loan Origination", "Credit Risk", "Collections") else float(np.round(rng.lognormal(8.5, 1.0), -1))
        speed = TEAMS[team][2] * (1.3 if branch == "Rotterdam" else 1.0)  # planted: Rotterdam slower
        rework = int(rng.random() < (0.35 if ttype == "KYC Review" else 0.10)) + int(rng.random() < 0.05)
        stuck_p = {"Credit Risk": 0.6, "Loan Origination": 0.65, "Compliance": 0.25, "Operations": 0.12, "Collections": 0.12}.get(team, 0.03)
        stuck = 3.2 if rng.random() < stuck_p else 1.0  # planted: stalled items pile up in some teams
        would_finish = created + sla_window * float(rng.lognormal(-0.75, 0.5)) * speed * stuck * (1 + 0.3 * rework)
        est = round(float(base_h * rng.lognormal(0, 0.3)), 1)
        reg = "Y" if rng.random() < reg_p else "N"
        handoffs = int(rng.poisson(1.2 + (1.5 if ttype in ("Loan Approval Recommendation", "Credit Assessment") else 0)))
        err_p = 0.35 if assignee == bad_error_staff else 0.05
        row = dict(task_id=f"T-{i:06d}", task_type=ttype, team=team, branch=branch, assigned_to=assignee,
                   created_at=created, due_at=due, customer_id=cust_ids[cidx], customer_risk=cust_risk[cidx],
                   amount=amount, regulatory_flag=reg, est_hours=est, rework_count=rework,
                   handoff_count=handoffs, source_system=SOURCES[team], completed_at=pd.NaT,
                   actual_hours=np.nan, error_flag="N", approved_by=pd.NA)
        if would_finish <= as_of:
            row["status"] = "Completed"
            row["completed_at"] = would_finish
            row["actual_hours"] = round(est * float(rng.lognormal(0.1, 0.25)) * (1 + 0.4 * rework), 1)
            row["error_flag"] = "Y" if rng.random() < err_p else "N"
            appr = staff[(staff.team == team) & (staff.approval_authority == "Y")].staff_id
            if reg == "Y" and len(appr) and rng.random() > 0.04:  # planted: ~4% missing approvals
                row["approved_by"] = appr.iloc[rng.integers(0, len(appr))]
        else:
            age_h = (as_of - created) / pd.Timedelta(hours=1)
            if ttype in ("Loan Approval Recommendation", "Credit Assessment", "Risk Review") and rng.random() < 0.6:
                status = "Pending Approval"
            elif rework and rng.random() < 0.6:
                status = "Rework"
            elif age_h < 10:
                status = "New"
            else:
                status = str(rng.choice(["In Progress", "Pending Review", "New"], p=[0.55, 0.3, 0.15]))
            if as_of > due and rng.random() < 0.10:
                status = "Escalated"
            row["status"] = status
        rows.append(row)
    tasks = pd.DataFrame(rows)
    # planted policy violation: a few approvals waiting with a non-approver
    idx = tasks[(tasks.status == "Pending Approval")].sample(4, random_state=seed).index
    non_appr = staff[staff.approval_authority == "N"].staff_id.tolist()
    tasks.loc[idx, "assigned_to"] = [non_appr[i] for i in rng.integers(0, len(non_appr), 4)]
    # planted duplicate work: same customer + type opened twice
    dup_src = tasks[tasks.status != "Completed"].sample(6, random_state=seed + 1)
    dups = dup_src.copy()
    dups["task_id"] = [f"T-{n_tasks + k + 1:06d}" for k in range(len(dups))]
    tasks = pd.concat([tasks, dups], ignore_index=True)
    # one unassigned open item
    tasks.loc[tasks[tasks.status == "New"].index[:3], "assigned_to"] = pd.NA

    # ---- compliance items
    comp = []
    for i in range(1, 71):
        ctype = str(rng.choice(["KYC", "AML", "Risk Review", "Approval", "Policy"], p=[0.35, 0.25, 0.2, 0.12, 0.08]))
        due = as_of + pd.Timedelta(days=float(rng.uniform(-20, 15)))
        status = str(rng.choice(["Open", "Cleared", "Escalated"], p=[0.55, 0.35, 0.10]))
        comp.append(dict(item_id=f"K-{i:04d}", check_type=ctype, customer_id=cust_ids[rng.integers(0, n_cust)],
                         status=status, severity=str(rng.choice(["Low", "Medium", "High"], p=[0.4, 0.4, 0.2])),
                         due_at=due, related_task_id=pd.NA,
                         description={"KYC": "Beneficial owner documents missing", "AML": "Unusual transaction pattern flagged",
                                      "Risk Review": "Annual risk review outstanding", "Approval": "Dual approval not evidenced",
                                      "Policy": "Exception to lending policy"}[ctype]))
    return {"tasks": tasks, "staff": staff, "compliance": pd.DataFrame(comp)}


def write_mock(out_dir: str | Path, seed: int = 42) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, df in generate(seed).items():
        df.to_csv(out / f"{name}.csv", index=False, date_format="%Y-%m-%dT%H:%M:%S")

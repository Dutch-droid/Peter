import re
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient

from treasury import notify, security
from treasury import services as S
from treasury.db import SessionLocal, init_db
from treasury.main import app
from treasury.models import Account, InternetAccount, Lease, NotificationLog, User

PW = "Str0ngPassw0rd!"


@pytest.fixture(scope="module", autouse=True)
def users():
    init_db()
    with SessionLocal() as db:
        for u, r in (("adm", "Administrator"), ("tre", "Treasury Officer"), ("fin", "Finance Officer"), ("ro", "Read-Only User")):
            db.add(User(username=u, role=r, email=f"{u}@x.com", password_hash=security.hash_password(PW)))
        db.commit()


def client(user):
    c = TestClient(app)
    tok = re.search(r'name="csrf_token" value="([^"]+)"', c.get("/login").text).group(1)
    r = c.post("/login", data={"username": user, "password": PW, "csrf_token": tok}, follow_redirects=False)
    assert r.status_code == 303, r.text
    c.csrf = re.search(r'name="csrf_token" value="([^"]+)"', c.get("/").text).group(1)
    return c


def post(c, url, **data):
    return c.post(url, data={**data, "csrf_token": c.csrf}, follow_redirects=False)


def test_login_required_and_bad_password():
    c = TestClient(app)
    assert c.get("/", follow_redirects=False).headers["location"] == "/login"
    tok = re.search(r'name="csrf_token" value="([^"]+)"', c.get("/login").text).group(1)
    assert c.post("/login", data={"username": "adm", "password": "nope", "csrf_token": tok}).status_code == 401
    assert c.post("/login", data={"username": "adm", "password": PW}).status_code == 403  # no CSRF


def test_csrf_enforced_on_writes():
    c = client("tre")
    assert c.post("/e/investors/new", data={"name": "X"}).status_code == 403


def test_rbac_matrix():
    tre, fin, ro, adm = client("tre"), client("fin"), client("ro"), client("adm")
    assert tre.get("/e/investors").status_code == 200 and tre.get("/e/leases").status_code == 403
    assert fin.get("/e/leases").status_code == 200 and fin.get("/e/investors").status_code == 403
    assert ro.get("/e/investors").status_code == 200 and ro.get("/e/investors/new").status_code == 403
    assert post(ro, "/e/investors/new", name="x", kra_pin="A123456789Z").status_code == 403
    assert tre.get("/admin/users").status_code == 403 and fin.get("/admin/audit").status_code == 403
    assert adm.get("/admin/users").status_code == 200
    assert tre.get("/reports/vat_report").status_code == 403 and fin.get("/reports/net_position").status_code == 403


def test_investor_validation_and_account_lifecycle():
    c = client("tre")
    r = post(c, "/e/investors/new", name="Test Inv", kra_pin="bad", email="nope")
    assert r.status_code == 422
    r = post(c, "/e/investors/new", name="Test Inv", kra_pin="a123456789z", email="t@x.com")
    iid = int(re.search(r"/investors/(\d+)", r.headers["location"]).group(1))
    assert post(c, "/e/investors/new", name="Dup", kra_pin="A123456789Z").status_code == 422  # unique PIN
    t = date.today()
    r = post(c, f"/investors/{iid}/accounts", reference="REF-1", date_received=str(t - timedelta(days=100)), principal="1,000,000",
             rate_pct="12", maturity_date=str(t - timedelta(days=10)))
    aid = int(re.search(r"/accounts/(\d+)", r.headers["location"]).group(1))
    with SessionLocal() as db:
        a = db.get(Account, aid)
        assert S.accrued(a, t) == D("29589.04")  # 90 days x 328.767
    # second account for same investor: multiple accounts per profile
    post(c, f"/investors/{iid}/accounts", reference="REF-2", date_received=str(t), principal="500000", rate_pct="10", maturity_date=str(t + timedelta(days=90)))
    assert post(c, f"/investors/{iid}/accounts", reference="REF-2", date_received=str(t), principal="1", rate_pct="1", maturity_date=str(t + timedelta(days=9))).status_code == 303
    # rollover: allowed (matured), then not allowed again until matured
    assert "Error" not in post(c, f"/accounts/{aid}/rollover", rate_pct="11", maturity_date=str(t + timedelta(days=80))).headers.get("x", "")
    with SessionLocal() as db:
        a = db.get(Account, aid)
        assert len(a.terms) == 2 and a.terms[1].start_date == t - timedelta(days=10) and D(a.terms[1].rate_pct) == D("11")
    post(c, f"/accounts/{aid}/rollover", rate_pct="9", maturity_date=str(t + timedelta(days=200)))
    with SessionLocal() as db:
        assert len(db.get(Account, aid).terms) == 2  # not matured -> rejected
    # redeem stops accrual; adjustment needs reason
    post(c, f"/accounts/{aid}/redeem", redemption_date=str(t))
    post(c, f"/accounts/{aid}/adjust", effective_date=str(t), amount="-100", reason="")
    with SessionLocal() as db:
        a = db.get(Account, aid)
        assert a.redemption_date == t and not a.adjustments
        frozen = S.accrued(a, t + timedelta(days=30))
        assert frozen == S.accrued(a, t)
    assert c.get(f"/accounts/{aid}").status_code == 200 and c.get(f"/investors/{iid}").status_code == 200


def test_reports_html_xlsx_pdf_and_math():
    c = client("tre")
    for key, q in (("net_position", ""), ("active_investors", ""), ("total_funds", ""), ("accrual_summary", ""), ("maturing", "days=365"),
                   ("redeemed", ""), ("interest_earned", ""), ("quarterly_interest", f"year={date.today().year}&quarter=1"), ("withholding_tax", f"year={date.today().year}&quarter=1")):
        url = f"/reports/{key}?{q or 'x=1'}"
        assert c.get(url).status_code == 200, key
    r = c.get("/reports/quarterly_interest?year=2026&quarter=1&fmt=xlsx&x=1")
    assert r.status_code == 200 and r.content[:2] == b"PK"
    r = c.get("/reports/net_position?fmt=pdf&x=1")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    from treasury import reports
    with SessionLocal() as db:
        rep = reports.REPORTS["quarterly_interest"]["fn"](db, {"year": 2026, "quarter": 1, "investor_id": None, "group": "account"})
        for row in rep.rows:  # gross - WHT = net, WHT = 15% of gross
            assert row[4] - row[5] == row[6] and row[5] == S.I.withholding_tax(row[4])


def test_finance_flow_payment_advances_due_date_and_reminders_are_idempotent():
    c = client("fin")
    t = date.today()
    r = post(c, "/e/leases/new", branch_name="Kisumu", landlord="L", rent_amount="1000", frequency="Monthly", next_due_date=str(t + timedelta(days=14)), contact_email="l@x.com")
    assert r.status_code == 303
    with SessionLocal() as db:
        lease = db.query(Lease).filter_by(branch_name="Kisumu").one()
        lid, due = lease.id, lease.next_due_date
    post(c, "/e/rent_payments/new", lease_id=str(lid), period_due=str(due), paid_on=str(t), amount="1000")
    with SessionLocal() as db:
        assert db.get(Lease, lid).next_due_date > due
    # reminders: due exactly 7 days out -> one send; second run sends nothing
    with SessionLocal() as db:
        db.get(Lease, lid).next_due_date = t + timedelta(days=7)
        db.commit()
        assert len([s for s in notify.run_reminders(db, t) if s.startswith(f"rent:{lid}:")]) == 1
        assert [s for s in notify.run_reminders(db, t) if s.startswith(f"rent:{lid}:")] == []
        db.get(Lease, lid).next_due_date = t + timedelta(days=8)  # not a reminder day
        db.commit()
        assert not [s for s in notify.run_reminders(db, t) if s.startswith(f"rent:{lid}:")]


def test_procurement_vat_autocalc_and_internet():
    c = client("fin")
    post(c, "/e/suppliers/new", name="S1")
    from treasury.models import ProcurementRequest, Supplier
    with SessionLocal() as db:
        sid = db.query(Supplier).filter_by(name="S1").one().id
    post(c, "/e/procurement/new", request_date=str(date.today()), department="IT", supplier_id=str(sid), items="Cables", quantity="10", unit_cost="100", approval_status="Pending")
    with SessionLocal() as db:
        p = db.query(ProcurementRequest).one()
        assert (p.total_cost, p.vat_amount, p.invoice_value) == (D("1000.00"), D("160.00"), D("1160.00"))
    assert post(c, "/e/internet/new", branch_name="B", isp="ISP", monthly_cost="5000", next_due_date=str(date.today())).status_code == 303


def test_admin_user_mgmt_audit_and_backup():
    a = client("adm")
    assert post(a, "/admin/users", username="weak", role="Read-Only User", password="short").status_code == 303
    with SessionLocal() as db:
        assert not db.query(User).filter_by(username="weak").first()
    post(a, "/admin/users", username="newbie", role="Finance Officer", password=PW)
    with SessionLocal() as db:
        assert db.query(User).filter_by(username="newbie").one()
    assert "login" in a.get("/admin/audit").text
    r = post(a, "/admin/backup")
    assert r.status_code == 200 and r.content[:15] == b"SQLite format 3"


def test_lockout_after_repeated_failures():
    c = TestClient(app)
    tok = re.search(r'name="csrf_token" value="([^"]+)"', c.get("/login").text).group(1)
    for _ in range(5):
        c.post("/login", data={"username": "ro", "password": "bad", "csrf_token": tok})
    r = c.post("/login", data={"username": "ro", "password": PW, "csrf_token": tok})
    assert r.status_code == 401 and "locked" in r.text.lower()

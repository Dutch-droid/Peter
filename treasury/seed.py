"""python -m treasury.seed [--demo]  : create the first administrator (and optional demo data).

Admin password comes from TREASURY_ADMIN_PASSWORD, or is generated and printed once.
"""
from __future__ import annotations

import argparse
import os
import secrets
from datetime import date, timedelta
from decimal import Decimal as D

from sqlalchemy import select

from . import security
from . import services as S
from .db import SessionLocal, init_db
from .models import InternetAccount, Investor, Lease, ProcurementRequest, Supplier, User


def _user(db, username, role, email, password=None):
    if db.scalar(select(User).where(User.username == username)):
        return None
    pw = password or secrets.token_urlsafe(12) + "aB3"
    db.add(User(username=username, full_name=username.replace("_", " ").title(), email=email, role=role, password_hash=security.hash_password(pw)))
    return pw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="also create one user per role and sample data (NOT for production)")
    a = ap.parse_args()
    init_db()
    with SessionLocal() as db:
        pw = _user(db, "admin", "Administrator", "admin@example.com", os.environ.get("TREASURY_ADMIN_PASSWORD"))
        if pw:
            print(f"admin password: {pw}   (change it after first login)")
        if a.demo:
            for u, r in (("treasury", "Treasury Officer"), ("finance", "Finance Officer"), ("viewer", "Read-Only User")):
                p = _user(db, u, r, f"{u}@example.com")
                if p:
                    print(f"{u} password: {p}")
            t = date.today()
            if not db.scalar(select(Investor)):
                for name, pin in (("Acacia Pension Scheme", "P051234567A"), ("Baobab Holdings Ltd", "P051234568B"), ("Jane W. Kamau", "A001234567C")):
                    db.add(Investor(name=name, kra_pin=pin, telephone="0700000000", email="investor@example.com", bank_name="Demo Bank", bank_account="0011223344"))
                db.flush()
                invs = list(db.scalars(select(Investor)))
                S.create_account(db, invs[0].id, "CP-0001-01", t - timedelta(days=120), D(50_000_000), D("12.5"), t - timedelta(days=120), t + timedelta(days=60))
                S.create_account(db, invs[0].id, "CP-0001-02", t - timedelta(days=45), D(20_000_000), D("13"), t - timedelta(days=45), t + timedelta(days=135))
                S.create_account(db, invs[1].id, "CP-0002-01", t - timedelta(days=200), D(10_000_000), D("11.75"), t - timedelta(days=200), t - timedelta(days=5))
                S.create_account(db, invs[2].id, "CP-0003-01", t - timedelta(days=30), D(2_500_000), D("12"), t - timedelta(days=30), t + timedelta(days=28))
                db.add(Lease(branch_name="Nairobi CBD", landlord="Kenya Properties Ltd", location="Kenyatta Ave", rent_amount=D(450000), frequency="Monthly",
                             next_due_date=t + timedelta(days=7), lease_expiry=t + timedelta(days=75), pay_point="Landlord account, Demo Bank", contact_person="A. Otieno", contact_email="rent@example.com"))
                db.add(Lease(branch_name="Mombasa", landlord="Coast Estates", location="Nyali", rent_amount=D(1_200_000), frequency="Quarterly",
                             next_due_date=t + timedelta(days=30), lease_expiry=t + timedelta(days=700), pay_point="Cheque", contact_person="F. Said"))
                db.add(InternetAccount(branch_name="Nairobi CBD", isp="Demo Telecom", monthly_cost=D(65000), next_due_date=t + timedelta(days=3), account_number="ISP-88123", pay_point="Paybill 123456"))
                s = Supplier(name="Office Supplies Co", category="Stationery", contact_person="B. Njeri", telephone="0711000000", email="sales@example.com", kra_pin="P051111111Z", bank_details="Demo Bank 99887766")
                db.add(s); db.flush()
                db.add(ProcurementRequest(request_date=t - timedelta(days=3), department="Finance", supplier_id=s.id, items="A4 paper (reams)", quantity=D(100), unit_cost=D(650),
                                          total_cost=D(65000), vat_amount=D(10400), invoice_value=D(75400), approval_status="Approved"))
        db.commit()


if __name__ == "__main__":
    main()

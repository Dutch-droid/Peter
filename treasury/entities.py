"""Declarative specs that drive the generic list/create/edit/delete screens."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Callable

from . import config
from . import interest as I
from .models import (InternetAccount, InternetPayment, Investor, Lease, ProcurementRequest, RentPayment, Supplier)

KRA = re.compile(r"^[AP]\d{9}[A-Z]$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class F:
    name: str
    label: str
    kind: str = "text"            # text email tel date money number choice ref textarea
    required: bool = False
    choices: tuple = ()
    ref: str = ""                 # entity key for kind=ref
    in_list: bool = True
    optional_money: bool = False  # blank allowed (computed later)
    group: str = ""               # form section heading
    help: str = ""                # hint under the input


@dataclass
class Entity:
    key: str
    title: str
    model: type
    module: str
    fields: list[F]
    label: Callable = lambda o: str(o.id)
    after_save: Callable | None = None      # (db, obj, is_new)
    before_save: Callable | None = None     # (obj)
    search: tuple = ("id",)
    order: str = "id"
    can_delete: bool = True
    detail_url: str = ""
    extra: dict = field(default_factory=dict)


def _hook_rent_paid(db, p, is_new):
    lease = db.get(Lease, p.lease_id)
    if is_new and lease and p.period_due >= lease.next_due_date:
        lease.next_due_date = I.add_period(p.period_due, lease.frequency)


def _hook_net_paid(db, p, is_new):
    a = db.get(InternetAccount, p.internet_account_id)
    if is_new and a and p.period_due >= a.next_due_date:
        a.next_due_date = I.add_period(p.period_due, "Monthly")


def _proc_totals(o):
    o.total_cost = I.money(Decimal(o.quantity) * Decimal(o.unit_cost))
    if o.vat_amount in (None, ""):
        o.vat_amount = I.money(Decimal(o.total_cost) * config.VAT_RATE)
    o.invoice_value = I.money(Decimal(o.total_cost) + Decimal(o.vat_amount))


FREQ = ("Monthly", "Quarterly", "Semi-Annual", "Annual")

ENTITIES: dict[str, Entity] = {e.key: e for e in [
    Entity("investors", "Investors", Investor, "treasury", [
        F("name", "Investor name", required=True), F("kra_pin", "KRA PIN", required=True),
        F("id_number", "National ID / Registration No.", in_list=False), F("address", "Physical address", in_list=False),
        F("telephone", "Telephone", "tel"), F("email", "Email", "email"),
        F("bank_name", "Bank name", in_list=False), F("bank_account", "Bank account number", in_list=False)],
        label=lambda o: f"{o.name} ({o.kra_pin})", search=("name", "kra_pin", "email"), order="name", can_delete=False, detail_url="/investors/{id}"),
    Entity("leases", "Rent / Leases", Lease, "finance", [
        F("branch_name", "Branch", required=True), F("landlord", "Landlord", required=True), F("location", "Property location", in_list=False),
        F("rent_amount", "Rent amount", "money", True), F("frequency", "Payment frequency", "choice", True, FREQ),
        F("next_due_date", "Next due date", "date", True, in_list=False), F("lease_expiry", "Lease expiry", "date"),
        F("pay_point", "Pay point details", "textarea", in_list=False), F("contact_person", "Contact person", in_list=False),
        F("contact_email", "Contact email (gets reminders)", "email", in_list=False)],
        label=lambda o: f"{o.branch_name} - {o.landlord}", search=("branch_name", "landlord", "location"), order="next_due_date", can_delete=False),
    Entity("rent_payments", "Rent payments", RentPayment, "finance", [
        F("lease_id", "Lease", "ref", True, ref="leases"), F("period_due", "Period due date", "date", True),
        F("paid_on", "Paid on", "date", True), F("amount", "Amount paid", "money", True), F("reference", "Payment reference")],
        label=lambda o: f"Payment {o.id}", after_save=_hook_rent_paid, search=("reference",), order="paid_on", can_delete=False),
    Entity("internet", "Internet billing", InternetAccount, "finance", [
        F("branch_name", "Branch", required=True), F("isp", "Internet service provider", required=True),
        F("monthly_cost", "Monthly cost", "money", True), F("next_due_date", "Next due date", "date", True, in_list=False),
        F("account_number", "Account number"), F("pay_point", "Pay point details", "textarea", in_list=False),
        F("contact_person", "Contact person", in_list=False), F("contact_email", "Contact email (gets reminders)", "email", in_list=False)],
        label=lambda o: f"{o.branch_name} - {o.isp}", search=("branch_name", "isp", "account_number"), order="next_due_date", can_delete=False),
    Entity("internet_payments", "Internet payments", InternetPayment, "finance", [
        F("internet_account_id", "Internet account", "ref", True, ref="internet"), F("period_due", "Period due date", "date", True),
        F("paid_on", "Paid on", "date", True), F("amount", "Amount paid", "money", True), F("reference", "Payment reference")],
        label=lambda o: f"Payment {o.id}", after_save=_hook_net_paid, search=("reference",), order="paid_on", can_delete=False),
    Entity("suppliers", "Suppliers", Supplier, "finance", [
        F("name", "Supplier name", required=True), F("category", "Category"), F("contact_person", "Contact person"),
        F("telephone", "Telephone", "tel"), F("email", "Email", "email"), F("kra_pin", "KRA PIN", in_list=False),
        F("bank_details", "Bank details", "textarea", in_list=False), F("pay_point", "Pay point details", "textarea", in_list=False)],
        label=lambda o: o.name, search=("name", "category", "email"), order="name", can_delete=False),
    Entity("procurement", "Procurement requests", ProcurementRequest, "finance", [
        F("request_date", "Request date", "date", True), F("department", "Requesting department", required=True),
        F("supplier_id", "Supplier", "ref", True, ref="suppliers"), F("items", "Items requested", "textarea", True),
        F("quantity", "Quantity", "number", True), F("unit_cost", "Unit cost", "money", True),
        F("vat_amount", f"VAT amount (blank = auto)", "money", in_list=True, optional_money=True),
        F("approval_status", "Approval status", "choice", True, ("Pending", "Approved", "Rejected"))],
        label=lambda o: f"Request {o.id}", before_save=_proc_totals, search=("department", "items"), order="request_date", can_delete=False),
]}

DATE_KINDS = {"date"}


def parse_form(ent: Entity, form: dict, existing_ids: dict[str, set[int]]) -> tuple[dict, dict]:
    """Return (values, errors). existing_ids: ref entity key -> set of valid ids."""
    vals, errs = {}, {}
    for f in ent.fields:
        raw = (form.get(f.name) or "").strip()
        if not raw:
            if f.required:
                errs[f.name] = "Required"
            vals[f.name] = None if f.kind in ("date", "money", "number", "ref") else ""
            continue
        try:
            if f.kind == "date":
                vals[f.name] = date.fromisoformat(raw)
            elif f.kind in ("money", "number"):
                v = Decimal(raw.replace(",", ""))
                if v < 0:
                    raise ValueError("Must not be negative")
                vals[f.name] = v
            elif f.kind == "email":
                if not EMAIL.match(raw):
                    raise ValueError("Invalid email address")
                vals[f.name] = raw
            elif f.kind == "choice":
                if raw not in f.choices:
                    raise ValueError("Invalid choice")
                vals[f.name] = raw
            elif f.kind == "ref":
                if int(raw) not in existing_ids.get(f.ref, set()):
                    raise ValueError("Unknown record")
                vals[f.name] = int(raw)
            else:
                vals[f.name] = raw
        except (ValueError, InvalidOperation) as exc:
            errs[f.name] = str(exc) if isinstance(exc, ValueError) and str(exc) and "decimal" not in str(exc).lower() and "isoformat" not in str(exc).lower() else "Invalid value"
    if ent.key == "investors" and vals.get("kra_pin") and "kra_pin" not in errs:
        vals["kra_pin"] = vals["kra_pin"].upper()
        if not KRA.match(vals["kra_pin"]):
            errs["kra_pin"] = "Expected format A123456789Z"
    if ent.key == "leases" and vals.get("lease_expiry") and vals.get("next_due_date") and "next_due_date" not in errs:
        pass
    return vals, errs


# Form sections and hints: {entity: {field: (group, help)}}
_LAYOUT = {
    "investors": {"name": ("Identity", "Registered name of the individual or institution"), "kra_pin": ("Identity", "Format A123456789Z; must be unique"),
                  "id_number": ("Identity", "Where applicable"), "address": ("Contact", ""), "telephone": ("Contact", ""), "email": ("Contact", ""),
                  "bank_name": ("Banking", ""), "bank_account": ("Banking", "Used for interest and redemption payments")},
    "leases": {"branch_name": ("Property", ""), "landlord": ("Property", ""), "location": ("Property", ""),
               "rent_amount": ("Payment terms", ""), "frequency": ("Payment terms", ""),
               "next_due_date": ("Payment terms", "Moves forward automatically when you record a payment"),
               "lease_expiry": ("Lease", "Used for expiry tracking on the dashboard"), "pay_point": ("Payment terms", "Where and how the rent is paid"),
               "contact_person": ("Contact", ""), "contact_email": ("Contact", "Also receives payment reminders")},
    "internet": {"branch_name": ("Service", ""), "isp": ("Service", ""), "account_number": ("Service", ""),
                 "monthly_cost": ("Billing", ""), "next_due_date": ("Billing", "Moves forward automatically when you record a payment"),
                 "pay_point": ("Billing", "Where and how the bill is paid"), "contact_person": ("Contact", ""), "contact_email": ("Contact", "Also receives payment reminders")},
    "suppliers": {"name": ("Details", ""), "category": ("Details", "e.g. Stationery, IT, Cleaning"), "contact_person": ("Contact", ""), "telephone": ("Contact", ""),
                  "email": ("Contact", ""), "kra_pin": ("Payment information", "Format A123456789Z"), "bank_details": ("Payment information", ""), "pay_point": ("Payment information", "")},
    "procurement": {"request_date": ("Request", ""), "department": ("Request", ""), "supplier_id": ("Request", ""), "items": ("Request", "What is being bought"),
                    "quantity": ("Cost", ""), "unit_cost": ("Cost", ""), "vat_amount": ("Cost", "Leave blank to calculate VAT automatically"),
                    "approval_status": ("Approval", "")},
    "rent_payments": {"lease_id": ("Payment", ""), "period_due": ("Payment", "The due date this payment settles"), "paid_on": ("Payment", ""),
                      "amount": ("Payment", ""), "reference": ("Payment", "Bank or cheque reference")},
    "internet_payments": {"internet_account_id": ("Payment", ""), "period_due": ("Payment", "The due date this payment settles"), "paid_on": ("Payment", ""),
                          "amount": ("Payment", ""), "reference": ("Payment", "Bank or cheque reference")},
}
for _k, _m in _LAYOUT.items():
    for _f in ENTITIES[_k].fields:
        if _f.name in _m:
            _f.group, _f.help = _m[_f.name]

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .interest import Term

M = Numeric(18, 2)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    role: Mapped[str] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(String(300))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    username: Mapped[str] = mapped_column(String(60), default="")
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(60), default="")
    entity_id: Mapped[str] = mapped_column(String(40), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(60), default="")


class Investor(Base):
    __tablename__ = "investors"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    kra_pin: Mapped[str] = mapped_column(String(20), unique=True)
    id_number: Mapped[str] = mapped_column(String(40), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    telephone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    bank_name: Mapped[str] = mapped_column(String(120), default="")
    bank_account: Mapped[str] = mapped_column(String(60), default="")
    accounts: Mapped[list[Account]] = relationship(back_populates="investor", order_by="Account.id")


class Account(Base):
    """One investment (CP subscription). Terms hold principal/rate/dates; rollover appends a term."""
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    investor_id: Mapped[int] = mapped_column(ForeignKey("investors.id"))
    reference: Mapped[str] = mapped_column(String(40), unique=True)
    date_received: Mapped[date] = mapped_column(Date)
    redemption_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    investor: Mapped[Investor] = relationship(back_populates="accounts")
    terms: Mapped[list[AccountTerm]] = relationship(back_populates="account", order_by="AccountTerm.seq", cascade="all, delete-orphan")
    adjustments: Mapped[list[Adjustment]] = relationship(back_populates="account", order_by="Adjustment.effective_date", cascade="all, delete-orphan")

    def interest_terms(self) -> list[Term]:
        return [Term(t.principal, t.rate_pct, t.start_date, t.maturity_date) for t in self.terms]

    @property
    def current_term(self) -> AccountTerm:
        return self.terms[-1]

    @property
    def principal(self):
        return self.current_term.principal

    def status(self, today: date) -> str:
        if self.redemption_date:
            return "Redeemed"
        if self.current_term.maturity_date <= today:
            return "Matured"
        if self.current_term.start_date > today:
            return "Pending"
        return "Active"


class AccountTerm(Base):
    __tablename__ = "account_terms"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    seq: Mapped[int] = mapped_column(Integer)
    principal: Mapped[float] = mapped_column(M)
    rate_pct: Mapped[float] = mapped_column(Numeric(7, 4))
    start_date: Mapped[date] = mapped_column(Date)
    maturity_date: Mapped[date] = mapped_column(Date)
    account: Mapped[Account] = relationship(back_populates="terms")


class Adjustment(Base):
    """Manual interest adjustment (audit trail of adjustments, per BRD)."""
    __tablename__ = "adjustments"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    effective_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(M)
    reason: Mapped[str] = mapped_column(String(255))
    created_by: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    account: Mapped[Account] = relationship(back_populates="adjustments")


class AccrualSnapshot(Base):
    """Daily accrual record written by the daily job (one row per account per day; idempotent)."""
    __tablename__ = "accrual_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    day: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(M)
    cumulative: Mapped[float] = mapped_column(M)


class Lease(Base):
    __tablename__ = "leases"
    id: Mapped[int] = mapped_column(primary_key=True)
    branch_name: Mapped[str] = mapped_column(String(120))
    landlord: Mapped[str] = mapped_column(String(160))
    location: Mapped[str] = mapped_column(String(200), default="")
    rent_amount: Mapped[float] = mapped_column(M)
    frequency: Mapped[str] = mapped_column(String(20), default="Monthly")
    next_due_date: Mapped[date] = mapped_column(Date)
    lease_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    pay_point: Mapped[str] = mapped_column(String(255), default="")
    contact_person: Mapped[str] = mapped_column(String(120), default="")
    contact_email: Mapped[str] = mapped_column(String(160), default="")


class RentPayment(Base):
    __tablename__ = "rent_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    lease_id: Mapped[int] = mapped_column(ForeignKey("leases.id"))
    period_due: Mapped[date] = mapped_column(Date)
    paid_on: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(M)
    reference: Mapped[str] = mapped_column(String(80), default="")


class InternetAccount(Base):
    __tablename__ = "internet_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    branch_name: Mapped[str] = mapped_column(String(120))
    isp: Mapped[str] = mapped_column(String(120))
    monthly_cost: Mapped[float] = mapped_column(M)
    next_due_date: Mapped[date] = mapped_column(Date)
    account_number: Mapped[str] = mapped_column(String(60), default="")
    pay_point: Mapped[str] = mapped_column(String(255), default="")
    contact_person: Mapped[str] = mapped_column(String(120), default="")
    contact_email: Mapped[str] = mapped_column(String(160), default="")


class InternetPayment(Base):
    __tablename__ = "internet_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    internet_account_id: Mapped[int] = mapped_column(ForeignKey("internet_accounts.id"))
    period_due: Mapped[date] = mapped_column(Date)
    paid_on: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(M)
    reference: Mapped[str] = mapped_column(String(80), default="")


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80), default="")
    contact_person: Mapped[str] = mapped_column(String(120), default="")
    telephone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    kra_pin: Mapped[str] = mapped_column(String(20), default="")
    bank_details: Mapped[str] = mapped_column(String(255), default="")
    pay_point: Mapped[str] = mapped_column(String(255), default="")


class ProcurementRequest(Base):
    __tablename__ = "procurement_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    request_date: Mapped[date] = mapped_column(Date)
    department: Mapped[str] = mapped_column(String(120))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    items: Mapped[str] = mapped_column(Text)
    quantity: Mapped[float] = mapped_column(Numeric(14, 2))
    unit_cost: Mapped[float] = mapped_column(M)
    total_cost: Mapped[float] = mapped_column(M)
    vat_amount: Mapped[float] = mapped_column(M)
    invoice_value: Mapped[float] = mapped_column(M)
    approval_status: Mapped[str] = mapped_column(String(20), default="Pending")
    supplier: Mapped[Supplier] = relationship()


class NotificationLog(Base):
    """One row per reminder sent; the unique key makes the daily job idempotent."""
    __tablename__ = "notification_log"
    __table_args__ = (UniqueConstraint("kind", "ref_id", "due_date", "offset_days"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    ref_id: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(Date)
    offset_days: Mapped[int] = mapped_column(Integer)
    recipients: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="sent")
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

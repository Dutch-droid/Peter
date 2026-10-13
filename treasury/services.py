"""Business logic on top of the ORM: positions, lifecycle actions, daily accrual job, audit."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import interest as I
from .models import Account, AccountTerm, AccrualSnapshot, Adjustment, AuditLog

D = Decimal


def audit(db: Session, user: str, action: str, entity: str = "", entity_id="", detail: str = "", ip: str = "") -> None:
    db.add(AuditLog(username=user, action=action, entity=entity, entity_id=str(entity_id), detail=detail[:2000], ip=ip))


def adjustments_total(acct: Account, start: date | None = None, end: date | None = None) -> Decimal:
    """Sum of manual adjustments with effective_date in [start, end)."""
    tot = D(0)
    for a in acct.adjustments:
        if (start is None or a.effective_date >= start) and (end is None or a.effective_date < end):
            tot += D(a.amount)
    return I.money(tot)


def accrued(acct: Account, as_of: date) -> Decimal:
    """Cumulative interest (calculated + adjustments) up to as_of (exclusive)."""
    return I.accrued_to_date(acct.interest_terms(), as_of, acct.redemption_date) + adjustments_total(acct, None, as_of)


def period_gross(acct: Account, start: date, end: date, as_of: date | None = None) -> Decimal:
    """Gross interest for [start, end) incl. adjustments effective in the window."""
    calc = I.period_interest(acct.interest_terms(), start, end, acct.redemption_date, as_of)
    adj_end = min(end, as_of) if as_of else end
    return calc + adjustments_total(acct, start, adj_end)


def principal_outstanding(acct: Account, as_of: date) -> Decimal:
    """Principal still invested at as_of (0 once redeemed)."""
    if acct.redemption_date and acct.redemption_date <= as_of:
        return D(0)
    for t in reversed(acct.terms):
        if t.start_date <= as_of:
            return D(t.principal)
    return D(0)


def create_account(db: Session, investor_id: int, reference: str, date_received: date, principal: Decimal,
                   rate_pct: Decimal, start: date, maturity: date) -> Account:
    _check_term(principal, rate_pct, start, maturity)
    acct = Account(investor_id=investor_id, reference=reference, date_received=date_received)
    acct.terms.append(AccountTerm(seq=1, principal=principal, rate_pct=rate_pct, start_date=start, maturity_date=maturity))
    db.add(acct)
    return acct


def _check_term(principal, rate_pct, start, maturity):
    if D(principal) <= 0:
        raise ValueError("Principal must be greater than zero")
    if not (D(0) <= D(rate_pct) <= D(100)):
        raise ValueError("Interest rate must be between 0 and 100")
    if maturity <= start:
        raise ValueError("Maturity date must be after the start date")


def rollover(db: Session, acct: Account, rate_pct: Decimal, new_maturity: date, today: date) -> AccountTerm:
    """Roll principal into a new term starting at the current maturity (accrual continues on new terms)."""
    if acct.redemption_date:
        raise ValueError("Account is redeemed")
    cur = acct.current_term
    if cur.maturity_date > today:
        raise ValueError(f"Not yet matured (matures {cur.maturity_date})")
    _check_term(cur.principal, rate_pct, cur.maturity_date, new_maturity)
    term = AccountTerm(seq=cur.seq + 1, principal=cur.principal, rate_pct=rate_pct,
                       start_date=cur.maturity_date, maturity_date=new_maturity)
    acct.terms.append(term)
    return term


def redeem(acct: Account, on: date) -> None:
    """Mark redeemed; accrual stops on `on`. Records stay for reporting/audit."""
    if acct.redemption_date:
        raise ValueError("Already redeemed")
    if on < acct.terms[0].start_date:
        raise ValueError("Redemption date is before the investment start")
    acct.redemption_date = on


def add_adjustment(acct: Account, effective: date, amount: Decimal, reason: str, user: str) -> Adjustment:
    if not reason.strip():
        raise ValueError("A reason is required for an adjustment")
    adj = Adjustment(effective_date=effective, amount=amount, reason=reason.strip(), created_by=user)
    acct.adjustments.append(adj)
    return adj


def run_daily_accrual(db: Session, day: date) -> int:
    """Idempotently record each account's accrual for `day`. Returns rows written."""
    written = 0
    existing = {s.account_id for s in db.scalars(select(AccrualSnapshot).where(AccrualSnapshot.day == day))}
    for acct in db.scalars(select(Account)):
        if acct.id in existing:
            continue
        terms = acct.interest_terms()
        amt = I.money(I.interest_for_window(terms, day, day + timedelta(days=1), acct.redemption_date))
        cum = I.accrued_to_date(terms, day + timedelta(days=1), acct.redemption_date)
        db.add(AccrualSnapshot(account_id=acct.id, day=day, amount=amt, cumulative=cum))
        written += 1
    db.commit()
    return written

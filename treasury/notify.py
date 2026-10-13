"""Email reminders for rent and internet bills. Idempotent: each (kind, item, due date, offset) is sent once."""
from __future__ import annotations

import smtplib
from datetime import date
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .models import InternetAccount, Lease, NotificationLog, User


def _recipients(db: Session, extra: str) -> list[str]:
    users = db.scalars(select(User).where(User.active, User.role.in_(["Finance Officer", "Administrator"])))
    out = {u.email for u in users if u.email}
    if extra:
        out.add(extra)
    return sorted(out)


def send_email(to: list[str], subject: str, body: str) -> str:
    """Send via SMTP when configured; otherwise log to stdout (dev). Returns 'sent' or 'logged'."""
    if not config.SMTP_HOST:
        print(f"[email:dev] to={to} subject={subject}\n{body}\n")
        return "logged"
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = config.MAIL_FROM, ", ".join(to), subject
    msg.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
        s.starttls()
        if config.SMTP_USER:
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(msg)
    return "sent"


def _when(offset: int) -> str:
    return "is due today" if offset == 0 else f"is due in {offset} days"


def run_reminders(db: Session, today: date) -> list[str]:
    """Send reminders due today. Safe to run many times a day."""
    sent: list[str] = []
    jobs = []
    for l in db.scalars(select(Lease)):
        jobs.append(("rent", l.id, l.next_due_date, config.RENT_REMINDER_OFFSETS, l.contact_email,
                     f"Rent reminder: {l.branch_name}",
                     f"Rent of {l.rent_amount:,.2f} for {l.branch_name} (landlord: {l.landlord}) {{when}} on {l.next_due_date}.\nPay point: {l.pay_point}"))
    for a in db.scalars(select(InternetAccount)):
        jobs.append(("internet", a.id, a.next_due_date, config.INTERNET_REMINDER_OFFSETS, a.contact_email,
                     f"Internet bill reminder: {a.branch_name}",
                     f"Internet bill of {a.monthly_cost:,.2f} ({a.isp}, account {a.account_number}) for {a.branch_name} {{when}} on {a.next_due_date}. Pay before then to avoid service disruption.\nPay point: {a.pay_point}"))
    for kind, ref, due, offsets, extra, subject, body in jobs:
        offset = (due - today).days
        if offset not in offsets:
            continue
        rcpt = _recipients(db, extra)
        if not rcpt:
            continue
        log = NotificationLog(kind=kind, ref_id=ref, due_date=due, offset_days=offset, recipients=",".join(rcpt), status="pending")
        db.add(log)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            continue  # already sent
        try:
            log.status = send_email(rcpt, subject, body.format(when=_when(offset)))
            sent.append(f"{kind}:{ref}:{offset}")
        except Exception as exc:  # keep the row so failures are visible, and retry tomorrow is impossible by key: delete to allow retry
            db.delete(log)
            print(f"[email:error] {subject}: {exc}")
        db.commit()
    return sent


if __name__ == "__main__":  # python -m treasury.notify   (run daily from cron / task scheduler)
    from .db import SessionLocal, init_db
    init_db()
    with SessionLocal() as s:
        print(run_reminders(s, date.today()))

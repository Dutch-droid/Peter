# Treasury, Investor and Administration Management Platform

Web app built from the Business Requirements Document ("Treasury, Investor and Administration Management Platform").
FastAPI + SQLAlchemy + server-rendered pages (no JS build). SQLite by default; set `TREASURY_DB` for another database.

## Run

    pip install -r requirements.txt
    export TREASURY_SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
    python -m treasury.seed            # creates 'admin' and prints a one-time password (or set TREASURY_ADMIN_PASSWORD)
    python -m treasury.seed --demo     # OPTIONAL, demo only: 3 more users (one per role) + sample data
    uvicorn treasury.main:app --port 8000
    python -m treasury.notify          # run daily from cron / Task Scheduler (also: Admin > Tools)
    python -m pytest tests

Serve behind HTTPS and set `TREASURY_HTTPS_ONLY=1` so the session cookie is `Secure`.

## BRD coverage

| BRD item | Where |
|---|---|
| Investor profiles, unique KRA PIN (format A/P + 9 digits + letter), banking and contact details | Investors |
| Multiple accounts per investor, each with own principal / dates / rate | Investor page > Add investment account |
| Daily interest engine, per account; daily / monthly / quarterly / cumulative views | `interest.py`; Account page |
| Rollover (new rate, new maturity, accrual continues) and redemption (accrual stops, history kept) | Account page |
| Audit trail of calculations and adjustments | Adjustments (reason mandatory) + audit log + daily accrual snapshots |
| Investor dashboard incl. Net Position = principal + accrued interest | Investor page |
| Quarterly report with WHT 15% and net payable; by account / investor / period | Reports |
| Investor and management reports, export to Excel and PDF | Reports (all treasury reports in the BRD) |
| Rent: leases, schedule, upcoming dashboard, payment history, expiry tracking, emails 30/14/7/0 days | Rent, Dashboard, Reports |
| Internet billing: schedule, due dashboard, history, email alerts | Internet |
| Suppliers repository, procurement requests with VAT, VAT report, history | Suppliers, Procurement, Reports |
| Roles: Administrator, Treasury Officer, Finance Officer, Read-Only | `security.py`; enforced on every route |
| Secure login, activity logs, backup, access-controlled reports | PBKDF2 passwords, lockout, CSRF, audit log, Admin > Tools backup |

## Assumptions to confirm with Treasury (all in `config.py` / `interest.py`)

1. **Interest basis:** simple interest, Actual/365. Day of receipt earns interest; maturity/redemption day does not. Change `TREASURY_DAY_COUNT` for Actual/360.
2. **Quarters:** calendar quarters (Jan-Mar ...). Tell us if Treasury uses a fiscal calendar.
3. **Withholding tax:** 15% of gross interest, rounded to cents; net = gross - WHT. `TREASURY_WHT_RATE` overrides it.
4. **Rollover:** principal only; interest earned in the matured term is *not* capitalised. Accrual stops at maturity until the administrator rolls over or redeems.
5. **VAT:** default 16%, computed when the VAT field is blank; can be overridden per request.
6. **Access:** Treasury Officers cannot see Finance modules and vice versa (BRD lists no overlap). Read-Only sees all records and reports, changes nothing. No hard deletes anywhere, to protect the audit trail.
7. **Internet reminder offsets** (7/3/1/0 days) are my choice; the BRD only says "before due date".
8. **Reminder recipients:** active Administrators and Finance Officers with an email, plus the record's contact email.
9. **Rent/internet due dates:** each record keeps its *next* due date; recording a payment advances it by the payment frequency.

## Known limits (not built)

- No investor-facing login or emailed statements; no document attachments; no multi-currency.
- Email: without `TREASURY_SMTP_*` set, reminders are logged to the console and recorded as `logged`.
- Backup is a SQLite online snapshot; other databases need their own tooling. Backups contain bank details: store encrypted.
- No MFA or SSO. Recommended before production use given the bank details held.
- Interest rules, WHT treatment and reports are tested against hand calculations, but must be reconciled with Treasury's current spreadsheets before go-live.

# PeopleFlow HR

An HR, leave and payroll app (Next.js + TypeScript + SQLite), configured for Kenya (KES).

## Run
```
npm install   # Node 22.13+ required (uses built-in node:sqlite, no compiler needed)
npm run seed     # creates data/hr.db with demo data
npm run dev      # http://localhost:3000
npm test         # payroll + leave unit tests
```
Demo logins: `admin@example.com / admin123`, `manager@example.com / manager123`, `amina@example.com / employee123`.
Change these before any real use.

## Modules
- **Employees** (admin/manager): records, departments, managers, salary (admin only), user accounts and roles.
- **Leave**: configurable leave types, weekday-based day counting, balance checks, manager/admin approval (nobody approves their own leave; managers only their reports).
- **Payroll** (admin): monthly runs create draft payslips for active employees; finalizing publishes them to employees.
- **Self-service**: employees see their balances, requests and published payslips only.
- **Settings** (admin): PAYE bands, personal relief, allowances/deductions (with min/max), leave types.

## Kenya defaults (editable in Settings)
PAYE bands 10/25/30/32.5/35%, personal relief KES 2,400/month, NSSF 6% capped at KES 6,480,
SHIF 2.75% of gross (min KES 300), Affordable Housing Levy 1.5% of gross; NSSF/SHIF/levy are deducted before PAYE.
**Verify these against current KRA, NSSF and SHA guidance before running real payroll.** Not modelled yet:
insurance relief, employer-side contributions, NHIF-style legacy rules, public holidays, bank/payslip export.

## Notes
Auth uses scrypt-hashed passwords and server-side sessions in an HttpOnly cookie. For production, run behind HTTPS,
add rate limiting on login, and back up `data/hr.db`.

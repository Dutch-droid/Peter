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

## More modules
- **Exports:** payslip PDF (employee: own published payslips; admin: any), payroll-run CSV with one column per allowance/deduction, employees CSV (admin), leave requests CSV (scoped by role). CSV cells are protected against spreadsheet formula injection.
- **Leave calendar** (`/leave/calendar`): month view. Admins see everyone; others see their department. Approved leave is visible to the team; pending leave only to the requester, their manager and admins.
- **Recruitment** (admin): jobs and a candidate pipeline board (Applied, Screening, Interview, Offer, Hired, Rejected) with drag-and-drop and a keyboard-friendly dropdown fallback.
- **Performance:** review cycles, personal goals with progress, self-assessment then manager review. Employees only see their manager's rating once the review is completed.

## Dashboard charts
Hand-built SVG (no chart library). Admins: payroll cost line chart (gross vs net), headcount-by-department donut, leave-taken columns, hiring-pipeline bars. Everyone else: own net-pay trend and own leave.
Every chart has a hover/keyboard tooltip (arrow keys, Esc), a Table view with the exact numbers, dark mode, and an empty state. Palette checked with a colour-blind / contrast validator; the donut folds small departments into "Other" past five.

## UX design
- **Tables:** search, sort, filter and paginate (TanStack Table). **Forms:** shared zod validation on client and server, inline errors, toast feedback, confirm dialogs for irreversible actions.
- **Smart defaults:** leave starts next working day with Annual preselected and the end date following the start; payroll month suggests the next unprocessed month; new employees get today's hire date, a generated password and the manager's department.
- **Goal-gradient:** admin setup checklist with progress, payroll run stepper, leave balance bars.
- **Endowment:** the dashboard frames leave days, earnings and tenure as the employee's own ("days you have left", "net pay you've earned").
- **Motion:** Figma-style micro-interactions (hover/press feedback, animated progress and counters, modal/toast transitions), disabled automatically for users who prefer reduced motion.

## Kenya defaults (editable in Settings)
PAYE bands 10/25/30/32.5/35%, personal relief KES 2,400/month, NSSF 6% capped at KES 6,480,
SHIF 2.75% of gross (min KES 300), Affordable Housing Levy 1.5% of gross; NSSF/SHIF/levy are deducted before PAYE.
**Verify these against current KRA, NSSF and SHA guidance before running real payroll.** Not modelled yet:
insurance relief, employer-side contributions, NHIF-style legacy rules, public holidays, bank/payslip export.

## Notes
Auth uses scrypt-hashed passwords and server-side sessions in an HttpOnly cookie. For production, run behind HTTPS,
add rate limiting on login, and back up `data/hr.db`.

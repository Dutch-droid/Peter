import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualTax, computePayslip, type Component } from '../lib/payroll';
import { businessDays } from '../lib/leave-days';

const brackets = [
  { upper_limit: 12000, rate: 0 },
  { upper_limit: 36000, rate: 10 },
  { upper_limit: null, rate: 20 },
];

test('annualTax applies each rate only to its slice', () => {
  assert.equal(annualTax(10000, brackets), 0);
  assert.equal(annualTax(36000, brackets), 2400);
  assert.equal(annualTax(60000, brackets), 2400 + 4800);
  assert.equal(annualTax(0, brackets), 0);
});

test('annualTax is order independent', () => {
  assert.equal(annualTax(60000, [...brackets].reverse()), 7200);
});

test('computePayslip: allowances, pre-tax deductions, tax, net', () => {
  const comps: Component[] = [
    { id: 1, name: 'Housing', kind: 'allowance', calc: 'percent', value: 20, taxable: 1 },
    { id: 2, name: 'Transport', kind: 'allowance', calc: 'fixed', value: 100, taxable: 0 },
    { id: 3, name: 'Pension', kind: 'deduction', calc: 'percent', value: 8, taxable: 1 },
    { id: 4, name: 'Union', kind: 'deduction', calc: 'fixed', value: 20, taxable: 0 },
  ];
  const p = computePayslip(5000, comps, brackets);
  assert.equal(p.gross, 6100); // 5000 + 1000 + 100
  assert.equal(p.totalDeductions, 508); // 8% of gross 6100 = 488, + 20
  assert.equal(p.taxableMonthly, 5512); // 5000 + 1000 - 488
  // annual 66144 -> 2400 + (66144-36000)*0.2 = 8428.8 ; /12 = 702.4
  assert.equal(p.tax, 702.4);
  assert.equal(p.net, 4889.6);
});

test('relief reduces tax but never below zero', () => {
  assert.equal(computePayslip(5000, [], brackets, 100).tax, computePayslip(5000, [], brackets).tax - 100);
  assert.equal(computePayslip(1000, [], brackets, 500).tax, 0);
});

test('deduction cap and floor apply', () => {
  const comps: Component[] = [
    { id: 1, name: 'NSSF', kind: 'deduction', calc: 'percent', value: 6, taxable: 1, max_amount: 6480 },
    { id: 2, name: 'SHIF', kind: 'deduction', calc: 'percent', value: 2.75, taxable: 1, min_amount: 300 },
  ];
  const high = computePayslip(200000, comps, []);
  assert.deepEqual(high.deductions.map((d) => d.amount), [6480, 5500]);
  const low = computePayslip(5000, comps, []);
  assert.deepEqual(low.deductions.map((d) => d.amount), [300, 300]);
});

test('computePayslip with no components or brackets', () => {
  const p = computePayslip(1000, [], []);
  assert.deepEqual([p.gross, p.tax, p.net], [1000, 0, 1000]);
});

test('businessDays skips weekends and handles bad ranges', () => {
  assert.equal(businessDays('2026-10-05', '2026-10-09'), 5); // Mon-Fri
  assert.equal(businessDays('2026-10-09', '2026-10-12'), 2); // Fri-Mon
  assert.equal(businessDays('2026-10-10', '2026-10-11'), 0); // weekend
  assert.equal(businessDays('2026-10-09', '2026-10-05'), 0);
  assert.equal(businessDays('nope', '2026-10-05'), 0);
});

import { openDb } from '../lib/db';
import { seed } from '../lib/seed';

test('Kenya seed: KES 120,000 salary produces a sane payslip', () => {
  const d = openDb(':memory:');
  seed(d);
  const comps = d.prepare('SELECT * FROM pay_components').all() as Component[];
  const br = d.prepare('SELECT upper_limit, rate FROM tax_brackets').all() as { upper_limit: number | null; rate: number }[];
  const p = computePayslip(120000, comps, br, 2400);
  assert.equal(p.gross, 138000); // + 15% house allowance
  assert.deepEqual(p.deductions.map((d) => d.amount), [6480, 3795, 2070]);
  assert.ok(p.tax > 0 && p.net > 0 && p.net < p.gross);
});

import { bracketsSchema, componentSchema, leaveRequestSchema } from '../lib/schemas';

test('schemas: leave request rules', () => {
  const ok = { leave_type_id: 1, start_date: '2026-11-02', end_date: '2026-11-04', reason: '' };
  assert.ok(leaveRequestSchema.safeParse(ok).success);
  assert.ok(!leaveRequestSchema.safeParse({ ...ok, end_date: '2026-11-01' }).success);
  assert.ok(!leaveRequestSchema.safeParse({ ...ok, start_date: '2026-11-07', end_date: '2026-11-08' }).success);
  assert.ok(!leaveRequestSchema.safeParse({ ...ok, start_date: '2026-12-30', end_date: '2027-01-02' }).success);
});

test('schemas: component and bracket rules', () => {
  const c = { name: 'X', kind: 'deduction', calc: 'percent', value: 5, taxable: true, min_amount: null, max_amount: null };
  assert.ok(componentSchema.safeParse(c).success);
  assert.ok(!componentSchema.safeParse({ ...c, value: 150 }).success);
  assert.ok(!componentSchema.safeParse({ ...c, min_amount: 10, max_amount: 5 }).success);
  const b = (brackets: { upper_limit: number | null; rate: number }[]) => bracketsSchema.safeParse({ brackets, monthly_relief: 0 }).success;
  assert.ok(b([{ upper_limit: 100, rate: 10 }, { upper_limit: null, rate: 20 }]));
  assert.ok(!b([{ upper_limit: 100, rate: 10 }]));
  assert.ok(!b([{ upper_limit: 200, rate: 10 }, { upper_limit: 100, rate: 20 }, { upper_limit: null, rate: 30 }]));
  assert.ok(!b([{ upper_limit: null, rate: 10 }, { upper_limit: null, rate: 20 }]));
});

import { nextWorkingDay } from '../lib/leave-days';
import { generatePassword } from '../lib/password';

test('nextWorkingDay skips weekends', () => {
  assert.equal(nextWorkingDay(new Date('2026-10-08T10:00:00Z')), '2026-10-09'); // Thu -> Fri
  assert.equal(nextWorkingDay(new Date('2026-10-09T10:00:00Z')), '2026-10-12'); // Fri -> Mon
  assert.equal(nextWorkingDay(new Date('2026-10-10T10:00:00Z')), '2026-10-12'); // Sat -> Mon
});

test('generatePassword is long enough and varies', () => {
  const a = generatePassword(), b = generatePassword();
  assert.equal(a.length, 12);
  assert.notEqual(a, b);
});

import { csvCell, toCsv } from '../lib/csv';
import { buildPayslipPdf } from '../lib/payslip-pdf';

test('csv escapes quotes, commas and newlines', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('l1\nl2'), '"l1\nl2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12.5), '12.5');
});

test('csv neutralises spreadsheet formulas but keeps negative numbers', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('-5'), '-5');
  assert.equal(csvCell(-5), '-5');
  assert.ok(toCsv(['a'], [['b']]).startsWith('﻿a\r\nb'));
});

test('payslip pdf renders a valid, non-trivial PDF (even with non-Latin-1 names)', async () => {
  const slip = computePayslip(120000, [], []);
  const bytes = await buildPayslipPdf({ company: 'Co', name: 'Zoë 山田', jobTitle: 'Eng', department: 'R&D', period: '2026-09', draft: false, slip });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  assert.ok(bytes.length > 1500);
});

import { entriesOn, monthGrid, shiftMonth } from '../lib/calendar';

test('calendar grid is Monday-first, whole weeks, and covers the month', () => {
  const g = monthGrid('2026-10'); // 1 Oct 2026 is a Thursday
  assert.equal(g[0][0].date, '2026-09-28');
  assert.ok(g.every((w) => w.length === 7));
  const days = g.flat().filter((c) => c.inMonth).map((c) => c.date);
  assert.equal(days.length, 31);
  assert.equal(g.at(-1)![6].date >= '2026-10-31', true);
  assert.equal(g[0][5].weekend, true);
});

test('calendar helpers: entriesOn spans ranges, shiftMonth wraps years', () => {
  const e = [{ name: 'A', type: 'Annual', status: 'approved', start_date: '2026-10-05', end_date: '2026-10-07' }];
  assert.equal(entriesOn('2026-10-06', e).length, 1);
  assert.equal(entriesOn('2026-10-08', e).length, 0);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

import { arcPath, columnPath, compactNumber, niceTicks, periodLabel } from '../lib/chart-math';
import { headcountByDepartment, hiringFunnel, leaveByMonth, myPayTrend, payrollTrend } from '../lib/insights';

test('niceTicks gives round numbers that cover the max', () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(95), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(10, 4), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceTicks(10, 4, true), [0, 5, 10]); // counts never get fractional ticks
  assert.deepEqual(niceTicks(3, 4, true), [0, 1, 2, 3]);
  const t = niceTicks(1_234_567);
  assert.ok(t[t.length - 1] >= 1_234_567 && t[0] === 0);
});

test('compactNumber and periodLabel', () => {
  assert.equal(compactNumber(950), '950');
  assert.equal(compactNumber(12900), '12.9K');
  assert.equal(compactNumber(100000), '100K');
  assert.equal(compactNumber(1250000), '1.25M');
  assert.equal(periodLabel('2026-09'), 'Sep 26');
});

test('chart paths are well formed', () => {
  assert.match(arcPath(50, 50, 40, 25, -Math.PI / 2, 0), /^M[\d.,-]+ A40,40 0 0 1 .* Z$/);
  assert.match(arcPath(50, 50, 40, 25, 0, Math.PI * 2), / 0 1 1 /); // full circle uses large-arc
  assert.ok(columnPath(0, 10, 20, 30).startsWith('M0,40'));
});

test('insights queries (seeded db + finalized run)', () => {
  const d = openDb(':memory:');
  seed(d);
  assert.deepEqual(payrollTrend(d), []); // nothing finalized yet
  const r = Number(d.prepare("INSERT INTO payroll_runs (period,status) VALUES ('2026-09','finalized')").run().lastInsertRowid);
  d.prepare("INSERT INTO payslips (run_id,employee_id,base,gross,total_deductions,tax,net,detail) VALUES (?,?,?,?,?,?,?,'{}')").run(r, 3, 100, 120, 10, 10, 100);
  d.prepare("INSERT INTO payslips (run_id,employee_id,base,gross,total_deductions,tax,net,detail) VALUES (?,?,?,?,?,?,?,'{}')").run(r, 4, 50, 60, 5, 5, 50);
  assert.deepEqual(payrollTrend(d), [{ period: '2026-09', gross: 180, net: 150 }]);
  assert.deepEqual(myPayTrend(d, 3), [{ period: '2026-09', gross: 120, net: 100 }]);
  assert.deepEqual(headcountByDepartment(d), [{ name: 'Engineering', count: 3 }, { name: 'HR', count: 1 }]);
  d.prepare("INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,status) VALUES (3,1,'2026-03-02','2026-03-04',3,'approved')").run();
  d.prepare("INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,status) VALUES (4,1,'2026-03-09','2026-03-09',1,'approved')").run();
  d.prepare("INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,status) VALUES (3,1,'2026-05-04','2026-05-05',2,'pending')").run();
  const all = leaveByMonth(d, 2026), mine = leaveByMonth(d, 2026, 3);
  assert.equal(all[2], 4); assert.equal(mine[2], 3); assert.equal(all[4], 0); // pending ignored
  const f = hiringFunnel(d);
  assert.deepEqual(f.map((x) => x.count), [1, 1, 1, 0, 0]);
});

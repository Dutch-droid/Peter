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

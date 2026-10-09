export type Component = {
  id: number;
  name: string;
  kind: 'allowance' | 'deduction';
  calc: 'percent' | 'fixed';
  value: number;
  taxable: number; // allowance: taxable income; deduction: pre-tax
  min_amount?: number | null;
  max_amount?: number | null;
};
export type Bracket = { upper_limit: number | null; rate: number };

export type PayslipLine = { name: string; amount: number };
export type PayslipResult = {
  base: number;
  gross: number;
  allowances: PayslipLine[];
  deductions: PayslipLine[];
  totalDeductions: number;
  taxableMonthly: number;
  tax: number;
  net: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Progressive annual tax: each rate applies only to the slice of income inside its bracket. */
export function annualTax(annualTaxable: number, brackets: Bracket[]): number {
  const sorted = [...brackets].sort(
    (a, b) => (a.upper_limit ?? Infinity) - (b.upper_limit ?? Infinity),
  );
  let tax = 0;
  let lower = 0;
  for (const b of sorted) {
    const upper = b.upper_limit ?? Infinity;
    if (annualTaxable > lower) tax += (Math.min(annualTaxable, upper) - lower) * (b.rate / 100);
    lower = upper;
    if (annualTaxable <= upper) break;
  }
  return tax;
}

/** Percent components apply to `basis` (base pay for allowances, gross for deductions), then floor/cap. */
const amountOf = (c: Component, basis: number) => {
  let a = c.calc === 'percent' ? (basis * c.value) / 100 : c.value;
  if (c.min_amount != null) a = Math.max(a, c.min_amount);
  if (c.max_amount != null) a = Math.min(a, c.max_amount);
  return a;
};

/**
 * Compute one month's payslip. Tax is the annual tax on (taxable*12) divided by 12,
 * less a monthly tax relief credit (e.g. Kenya's personal relief), never below zero.
 */
export function computePayslip(
  monthlySalary: number,
  components: Component[],
  brackets: Bracket[],
  monthlyRelief = 0,
): PayslipResult {
  const base = r2(monthlySalary);
  const allowances = components
    .filter((c) => c.kind === 'allowance')
    .map((c) => ({ name: c.name, amount: r2(amountOf(c, base)), taxable: !!c.taxable }));
  const gross = r2(base + allowances.reduce((s, a) => s + a.amount, 0));
  const deds = components
    .filter((c) => c.kind === 'deduction')
    .map((c) => ({ name: c.name, amount: r2(amountOf(c, gross)), preTax: !!c.taxable }));

  const taxableIncome =
    base +
    allowances.filter((a) => a.taxable).reduce((s, a) => s + a.amount, 0) -
    deds.filter((d) => d.preTax).reduce((s, d) => s + d.amount, 0);
  const taxableMonthly = Math.max(0, r2(taxableIncome));
  const tax = Math.max(0, r2(annualTax(taxableMonthly * 12, brackets) / 12 - monthlyRelief));
  const totalDeductions = r2(deds.reduce((s, d) => s + d.amount, 0));
  const net = r2(gross - totalDeductions - tax);

  return {
    base,
    gross,
    allowances: allowances.map(({ name, amount }) => ({ name, amount })),
    deductions: deds.map(({ name, amount }) => ({ name, amount })),
    totalDeductions,
    taxableMonthly,
    tax,
    net,
  };
}

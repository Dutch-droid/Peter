import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PayslipResult } from './payroll';

const money = (n: number) =>
  'KES ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Standard PDF fonts only cover Latin-1; drop anything else rather than crash on encode.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

export type PayslipDoc = {
  company: string;
  name: string;
  jobTitle: string;
  department: string;
  period: string;
  draft: boolean;
  slip: PayslipResult;
};

export async function buildPayslipPdf(d: PayslipDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${d.period} - ${d.name}`);
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.13, 0.19), mute = rgb(0.4, 0.44, 0.5), brand = rgb(0.06, 0.46, 0.43), line = rgb(0.85, 0.87, 0.9);
  const L = 50, R = 545;
  let y = 790;

  const text = (t: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, size = 10, f = font, color = ink) => {
    const s = safe(t);
    page.drawText(s, { x: R - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const rule = () => page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: line });

  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: brand });
  y = 822; text(d.company, L, 13, bold, rgb(1, 1, 1)); right('PAYSLIP', 11, bold, rgb(1, 1, 1));
  y = 780; text(d.name, L, 16, bold); right(d.period, 12, bold);
  y -= 16; text(`${d.jobTitle}${d.department ? '  |  ' + d.department : ''}`, L, 10, font, mute);
  if (d.draft) { right('DRAFT - not yet published', 10, bold, rgb(0.71, 0.28, 0.03)); }
  y -= 18; rule(); y -= 22;

  const row = (label: string, amount: number, opts: { neg?: boolean; strong?: boolean } = {}) => {
    const f = opts.strong ? bold : font;
    text(label, L, 10.5, f); right((opts.neg ? '- ' : '') + money(amount), 10.5, f); y -= 19;
  };
  const section = (t: string) => { text(t.toUpperCase(), L, 8.5, bold, mute); y -= 16; };

  section('Earnings');
  row('Basic salary', d.slip.base);
  d.slip.allowances.forEach((a) => row(a.name, a.amount));
  rule(); y -= 16; row('Gross pay', d.slip.gross, { strong: true }); y -= 8;

  section('Deductions');
  d.slip.deductions.forEach((x) => row(x.name, x.amount, { neg: true }));
  row('PAYE (after relief)', d.slip.tax, { neg: true });
  rule(); y -= 16;
  row('Total deductions', d.slip.totalDeductions + d.slip.tax, { strong: true, neg: true }); y -= 8;

  page.drawRectangle({ x: L - 8, y: y - 12, width: R - L + 16, height: 34, color: rgb(0.93, 0.97, 0.96) });
  text('NET PAY', L, 12, bold, brand); right(money(d.slip.net), 14, bold, brand);
  y -= 44;
  text(`Taxable income this month: ${money(d.slip.taxableMonthly)}`, L, 9, font, mute);
  y = 50; text('Computer generated. No signature required.', L, 8, font, mute);
  return pdf.save();
}

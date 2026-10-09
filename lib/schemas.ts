import { z } from 'zod';
import { businessDays } from './leave-days';

// Shared by the client forms (instant feedback) and the server actions (the real check).
const num = (msg = 'Enter a number') => z.number(msg);
const money = z.number('Enter an amount').min(0, 'Cannot be negative');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
const optMoney = z.number().min(0, 'Cannot be negative').nullable();

export const employeeSchema = z.object({
  first_name: z.string().trim().min(1, 'Required'),
  last_name: z.string().trim().min(1, 'Required'),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  department: z.string().trim(),
  job_title: z.string().trim(),
  hire_date: dateStr,
  monthly_salary: money,
  manager_id: z.number().nullable(),
  role: z.enum(['employee', 'manager', 'admin']),
  password: z.string().min(8, 'At least 8 characters'),
});

export const employeeUpdateSchema = z.object({
  id: num(),
  department: z.string().trim(),
  job_title: z.string().trim(),
  monthly_salary: money,
  manager_id: z.number().nullable(),
  status: z.enum(['active', 'inactive']),
});

export const leaveRequestSchema = z
  .object({
    leave_type_id: num('Choose a leave type'),
    start_date: dateStr,
    end_date: dateStr,
    reason: z.string().trim().max(300, 'Keep it under 300 characters'),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ['end_date'], message: 'End date is before start date' })
  .refine((v) => v.start_date.slice(0, 4) === v.end_date.slice(0, 4), {
    path: ['end_date'],
    message: 'Split requests that span two calendar years',
  })
  .refine((v) => businessDays(v.start_date, v.end_date) >= 1, {
    path: ['end_date'],
    message: 'Selected dates contain no working days',
  });

export const componentSchema = z
  .object({
    name: z.string().trim().min(1, 'Required'),
    kind: z.enum(['allowance', 'deduction']),
    calc: z.enum(['percent', 'fixed']),
    value: money,
    taxable: z.boolean(),
    min_amount: optMoney,
    max_amount: optMoney,
  })
  .refine((v) => v.calc !== 'percent' || v.value <= 100, { path: ['value'], message: 'A percentage cannot exceed 100' })
  .refine((v) => v.min_amount == null || v.max_amount == null || v.min_amount <= v.max_amount, {
    path: ['max_amount'],
    message: 'Max must be at least the min',
  });

export const bracketsSchema = z
  .object({
    brackets: z
      .array(
        z.object({
          upper_limit: z.number().positive('Must be above 0').nullable(),
          rate: z.number('Enter a rate').min(0, 'Min 0').max(100, 'Max 100'),
        }),
      )
      .min(1, 'Add at least one band'),
    monthly_relief: money,
  })
  .superRefine((v, ctx) => {
    v.brackets.forEach((b, i) => {
      const last = i === v.brackets.length - 1;
      if (b.upper_limit === null && !last)
        ctx.addIssue({ code: 'custom', path: ['brackets', i, 'upper_limit'], message: 'Only the last band can have no limit' });
      if (last && b.upper_limit !== null)
        ctx.addIssue({ code: 'custom', path: ['brackets', i, 'upper_limit'], message: 'The last band must have no limit' });
      const prev = v.brackets[i - 1]?.upper_limit;
      if (b.upper_limit !== null && prev != null && b.upper_limit <= prev)
        ctx.addIssue({ code: 'custom', path: ['brackets', i, 'upper_limit'], message: 'Must be higher than the band above' });
    });
  });

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  days_per_year: z.number('Enter days').int('Whole days only').min(0, 'Cannot be negative'),
});

export const periodSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month'),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type ComponentInput = z.infer<typeof componentSchema>;
export type BracketsInput = z.infer<typeof bracketsSchema>;
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

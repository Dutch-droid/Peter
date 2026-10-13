"""Interest engine: pure functions, no database access.

Convention (assumption, configurable in config.py): simple interest, Actual/365.
Interest accrues for each calendar day from the term start date (inclusive) up to, but not including,
the earliest of: term maturity, redemption date, and the reporting date. So the day funds are
received earns interest and the redemption / maturity day does not.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import config

CENT = Decimal("0.01")


def money(x: Decimal) -> Decimal:
    return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Term:
    principal: Decimal
    rate_pct: Decimal      # annual rate in percent, e.g. 12.5
    start: date
    maturity: date


def daily_interest(principal: Decimal, rate_pct: Decimal) -> Decimal:
    """Unrounded interest for one day."""
    return Decimal(principal) * Decimal(rate_pct) / Decimal(100) / Decimal(config.DAY_COUNT_BASIS)


def accrual_days(term: Term, window_start: date, window_end: date, redemption: date | None = None) -> int:
    """Number of accruing days of `term` inside [window_start, window_end) (end exclusive)."""
    end = min(term.maturity, window_end)
    if redemption is not None:
        end = min(end, redemption)
    start = max(term.start, window_start)
    return max((end - start).days, 0)


def interest_for_window(terms: list[Term], window_start: date, window_end: date, redemption: date | None = None) -> Decimal:
    """Unrounded interest across all terms in the window."""
    total = Decimal(0)
    for t in terms:
        total += daily_interest(t.principal, t.rate_pct) * accrual_days(t, window_start, window_end, redemption)
    return total


def accrued_to_date(terms: list[Term], as_of: date, redemption: date | None = None) -> Decimal:
    """Cumulative interest accrued up to (not including) `as_of`, rounded to cents."""
    if not terms:
        return Decimal("0.00")
    return money(interest_for_window(terms, min(t.start for t in terms), as_of, redemption))


def quarter_bounds(year: int, quarter: int) -> tuple[date, date]:
    """Calendar quarter as (first day, first day of next quarter)."""
    if quarter not in (1, 2, 3, 4):
        raise ValueError("quarter must be 1-4")
    start = date(year, 3 * quarter - 2, 1)
    end = date(year + 1, 1, 1) if quarter == 4 else date(year, 3 * quarter + 1, 1)
    return start, end


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1))


def period_interest(terms: list[Term], start: date, end: date, redemption: date | None = None, as_of: date | None = None) -> Decimal:
    """Rounded interest for [start, end), never beyond `as_of` (default: no cap)."""
    if as_of is not None:
        end = min(end, as_of)
    if end <= start:
        return Decimal("0.00")
    return money(interest_for_window(terms, start, end, redemption))


def withholding_tax(gross: Decimal) -> Decimal:
    return money(Decimal(gross) * config.WHT_RATE)


def net_interest(gross: Decimal) -> Decimal:
    return money(Decimal(gross) - withholding_tax(gross))


def monthly_schedule(terms: list[Term], as_of: date, redemption: date | None = None) -> list[tuple[str, Decimal]]:
    """[(YYYY-MM, interest)] from first term start through the month containing as_of."""
    if not terms:
        return []
    first = min(t.start for t in terms)
    y, m = first.year, first.month
    out = []
    while date(y, m, 1) <= as_of:
        s, e = month_bounds(y, m)
        out.append((f"{y}-{m:02d}", period_interest(terms, s, e, redemption, as_of)))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def daily_schedule(terms: list[Term], start: date, end: date, redemption: date | None = None) -> list[tuple[date, Decimal]]:
    """[(day, interest for that day)] for days in [start, end)."""
    out, d = [], start
    while d < end:
        out.append((d, money(interest_for_window(terms, d, d + timedelta(days=1), redemption))))
        d += timedelta(days=1)
    return out


def add_period(d: date, frequency: str) -> date:
    """Advance a due date by a payment frequency, clamping to month end."""
    months = {"Monthly": 1, "Quarterly": 3, "Semi-Annual": 6, "Annual": 12}[frequency]
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

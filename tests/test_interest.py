from datetime import date
from decimal import Decimal as D

import pytest

from treasury import interest as I


def T(p="1000000", r="12", s=date(2026, 1, 1), m=date(2026, 12, 31)):
    return I.Term(D(p), D(r), s, m)


def test_simple_daily_actual_365():
    # 1,000,000 @ 12% => 328.767.. per day
    assert I.money(I.daily_interest(D(1000000), D(12))) == D("328.77")
    assert I.accrued_to_date([T()], date(2026, 1, 31)) == D("9863.01")  # 30 days


def test_receipt_day_counts_redemption_day_does_not():
    t = T(s=date(2026, 1, 1), m=date(2026, 1, 11))
    assert I.accrual_days(t, date(2026, 1, 1), date(2026, 12, 31)) == 10
    assert I.accrual_days(t, date(2026, 1, 1), date(2026, 12, 31), redemption=date(2026, 1, 5)) == 4


def test_accrual_stops_at_maturity_and_redemption():
    assert I.accrued_to_date([T(m=date(2026, 1, 11))], date(2027, 1, 1)) == I.money(I.daily_interest(D(1000000), D(12)) * 10)
    assert I.accrued_to_date([T()], date(2026, 3, 1), redemption=date(2026, 2, 1)) == I.accrued_to_date([T()], date(2026, 2, 1))


def test_future_start_accrues_nothing():
    assert I.accrued_to_date([T(s=date(2026, 6, 1))], date(2026, 5, 1)) == D("0.00")


def test_rollover_uses_new_rate_from_new_start():
    t1 = I.Term(D(1000000), D(12), date(2026, 1, 1), date(2026, 4, 1))   # 90 days
    t2 = I.Term(D(1000000), D(10), date(2026, 4, 1), date(2026, 7, 1))   # 91 days
    got = I.accrued_to_date([t1, t2], date(2026, 7, 1))
    want = I.money(I.daily_interest(D(1000000), D(12)) * 90 + I.daily_interest(D(1000000), D(10)) * 91)
    assert got == want


def test_quarters_partition_the_year():
    t = [T()]
    total = sum(I.period_interest(t, *I.quarter_bounds(2026, q)) for q in (1, 2, 3, 4))
    assert abs(total - I.money(I.interest_for_window(t, date(2026, 1, 1), date(2027, 1, 1)))) <= D("0.02")


def test_quarter_bounds():
    assert I.quarter_bounds(2026, 1) == (date(2026, 1, 1), date(2026, 4, 1))
    assert I.quarter_bounds(2026, 4) == (date(2026, 10, 1), date(2027, 1, 1))
    with pytest.raises(ValueError):
        I.quarter_bounds(2026, 5)


def test_wht_and_net():
    g = D("10000.00")
    assert I.withholding_tax(g) == D("1500.00")
    assert I.net_interest(g) == D("8500.00")
    assert I.withholding_tax(D("0.03")) + I.net_interest(D("0.03")) == D("0.03")


def test_monthly_schedule_sums_to_cumulative():
    t = [T()]
    sched = I.monthly_schedule(t, date(2026, 6, 15))
    assert sched[0][0] == "2026-01" and sched[-1][0] == "2026-06"
    assert abs(sum(v for _, v in sched) - I.accrued_to_date(t, date(2026, 6, 15))) <= D("0.05")


def test_daily_schedule_matches_period():
    t = [T()]
    ds = I.daily_schedule(t, date(2026, 1, 1), date(2026, 1, 11))
    assert len(ds) == 10 and ds[0][1] == D("328.77")


def test_add_period_clamps_month_end():
    assert I.add_period(date(2026, 1, 31), "Monthly") == date(2026, 2, 28)
    assert I.add_period(date(2026, 11, 30), "Quarterly") == date(2027, 2, 28)
    assert I.add_period(date(2026, 3, 1), "Annual") == date(2027, 3, 1)

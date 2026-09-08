from datetime import UTC, datetime

import pytest

from app.core.errors import AppError
from app.modules.planning.recurrence import RecurrenceService, validate_datetime


def dt(value):
    return datetime.fromisoformat(value)


def test_daily_recurrence_preserves_wall_clock_across_warsaw_dst():
    occurrences = RecurrenceService.between("FREQ=DAILY;COUNT=3", dt("2026-03-28T09:00:00+01:00"), "Europe/Warsaw", dt("2026-03-28T00:00:00Z"), dt("2026-04-01T00:00:00Z"))
    assert occurrences == [dt("2026-03-28T08:00:00Z"), dt("2026-03-29T07:00:00Z"), dt("2026-03-30T07:00:00Z")]


def test_nonexistent_local_occurrence_does_not_consume_count():
    occurrences = RecurrenceService.between("FREQ=DAILY;COUNT=3", dt("2026-03-28T02:30:00+01:00"), "Europe/Warsaw", dt("2026-03-28T00:00:00Z"), dt("2026-04-02T00:00:00Z"))
    assert occurrences == [dt("2026-03-28T01:30:00Z"), dt("2026-03-30T00:30:00Z"), dt("2026-03-31T00:30:00Z")]


def test_ambiguous_time_uses_first_fold_once():
    occurrences = RecurrenceService.between("FREQ=DAILY;COUNT=3", dt("2026-10-24T02:30:00+02:00"), "Europe/Warsaw", dt("2026-10-24T00:00:00Z"), dt("2026-10-28T00:00:00Z"))
    assert occurrences == [dt("2026-10-24T00:30:00Z"), dt("2026-10-25T00:30:00Z"), dt("2026-10-26T01:30:00Z")]


def test_monthly_invalid_days_omitted():
    occurrences = RecurrenceService.between("FREQ=MONTHLY;COUNT=3", dt("2026-01-31T10:00:00Z"), "UTC", dt("2026-01-01T00:00:00Z"), dt("2026-06-01T00:00:00Z"))
    assert [x.month for x in occurrences] == [1, 3, 5]


@pytest.mark.parametrize("rule", ["FREQ=DAILY;COUNT=2;UNTIL=20270101T000000Z", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;FREQ=WEEKLY", "FREQ=YEARLY;BYEASTER=0", "FREQ=BAD", "FREQ=DAILY\nEXDATE:20260906T090000Z", "FREQ=YEARLY;BYMONTH=13", "FREQ=DAILY;BYSECOND=60", "FREQ=WEEKLY;BYDAY=1MO", "FREQ=MONTHLY;BYMONTHDAY=0", "FREQ=MONTHLY;BYSETPOS=1"])
def test_invalid_or_non_rfc_rules_rejected(rule):
    with pytest.raises(AppError) as exc:
        RecurrenceService.validate(rule, datetime(2026, 1, 1, tzinfo=UTC), "UTC")
    assert exc.value.code == "invalid_rrule"


def test_gap_offset_input_rejected_but_utc_input_allowed():
    with pytest.raises(AppError) as exc:
        validate_datetime(dt("2026-03-29T02:30:00+01:00"), "Europe/Warsaw")
    assert exc.value.code == "invalid_local_time"
    validate_datetime(dt("2026-03-29T01:30:00Z"), "Europe/Warsaw")


def test_excessively_dense_range_rejected():
    with pytest.raises(AppError) as exc:
        RecurrenceService.between("FREQ=SECONDLY", dt("2026-01-01T00:00:00Z"), "UTC", dt("2026-01-01T00:00:00Z"), dt("2026-01-02T00:00:00Z"))
    assert exc.value.code == "invalid_or_large_range"

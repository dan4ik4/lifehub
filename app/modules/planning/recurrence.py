"""Bounded RFC 5545 recurrence evaluation in the event's IANA timezone.

Ranges are half-open. DST gaps are omitted and do not consume COUNT; ambiguous
wall times use the first occurrence, as RFC 5545 prescribes. No rows are generated
for ordinary occurrences. Limits guard against adversarial SECONDLY rules.
"""
from datetime import UTC, datetime, timedelta
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from dateutil.tz import datetime_exists

from app.core.errors import AppError

MAX_SCAN = 50000
MAX_OCCURRENCES = 5000


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise AppError(422, "validation_error", "Use an IANA timezone") from exc


def validate_datetime(value: datetime, timezone: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise AppError(422, "validation_error", "Datetime must include an offset")
    local = value.astimezone(zone(timezone))
    if value.utcoffset() != timedelta(0) and value.utcoffset() != local.utcoffset():
        raise AppError(422, "invalid_local_time", "Datetime offset disagrees with the IANA timezone (including DST)")


class RecurrenceService:
    @staticmethod
    def validate(value: str, start: datetime, timezone: str) -> str:
        value = value.strip().upper()
        if value.startswith("RRULE:"):
            value = value[6:]
        if not value or "\n" in value or "\r" in value or ":" in value:
            raise AppError(422, "invalid_rrule", "Provide one RFC 5545 RRULE value")
        try:
            parts = value.split(";")
            values = dict(part.split("=", 1) for part in parts)
            if len(values) != len(parts) or "FREQ" not in values:
                raise ValueError("Duplicate or missing rule component")
            if "COUNT" in values and "UNTIL" in values:
                raise ValueError("COUNT and UNTIL are mutually exclusive")
            for key in ("COUNT", "INTERVAL"):
                if key in values and not 1 <= int(values[key]) <= 2147483647:
                    raise ValueError(f"{key} must be a positive 32-bit integer")
            if "BYEASTER" in values:
                raise ValueError("BYEASTER is not RFC 5545")
            # dateutil deliberately accepts several out-of-range BY* values;
            # validate the RFC domains before passing untrusted input to it.
            numeric_parts = {"BYSECOND": (0, 59, True), "BYMINUTE": (0, 59, True), "BYHOUR": (0, 23, True), "BYMONTH": (1, 12, False), "BYMONTHDAY": (-31, 31, False), "BYYEARDAY": (-366, 366, False), "BYWEEKNO": (-53, 53, False), "BYSETPOS": (-366, 366, False)}
            for key, (minimum, maximum, allow_zero) in numeric_parts.items():
                if key in values:
                    for token in values[key].split(","):
                        number = int(token)
                        if number < minimum or number > maximum or number == 0 and not allow_zero:
                            raise ValueError(f"{key} contains an invalid value (leap seconds are not supported)")
            if "BYDAY" in values:
                for token in values["BYDAY"].split(","):
                    match = re.fullmatch(r"([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)", token)
                    if not match:
                        raise ValueError("Invalid BYDAY weekday")
                    if match[1]:
                        if not 1 <= abs(int(match[1])) <= 53:
                            raise ValueError("Invalid BYDAY ordinal")
                        if values["FREQ"] not in {"MONTHLY", "YEARLY"} or "BYWEEKNO" in values:
                            raise ValueError("Ordinal BYDAY requires MONTHLY or YEARLY without BYWEEKNO")
            if "BYWEEKNO" in values and values["FREQ"] != "YEARLY":
                raise ValueError("BYWEEKNO requires YEARLY")
            if "BYYEARDAY" in values and values["FREQ"] in {"DAILY", "WEEKLY", "MONTHLY"}:
                raise ValueError("BYYEARDAY cannot be combined with DAILY, WEEKLY or MONTHLY")
            if "BYMONTHDAY" in values and values["FREQ"] == "WEEKLY":
                raise ValueError("BYMONTHDAY cannot be combined with WEEKLY")
            if "BYSETPOS" in values and not any(key.startswith("BY") and key != "BYSETPOS" for key in values):
                raise ValueError("BYSETPOS requires another BY rule component")
            if "UNTIL" in values and not re.fullmatch(r"\d{8}T\d{6}Z", values["UNTIL"]):
                raise ValueError("UNTIL must be a UTC datetime in YYYYMMDDTHHMMSSZ format")
            parsed = rrulestr(value, dtstart=start.astimezone(zone(timezone)))
            # Constructing a rule validates all supported RFC component names.
            if not hasattr(parsed, "_freq"):
                raise ValueError("Only one RRULE is accepted")
        except (ValueError, TypeError, OverflowError) as exc:
            raise AppError(422, "invalid_rrule", str(exc)) from exc
        return value

    @staticmethod
    def occurrences(value: str, start: datetime, timezone: str, lower: datetime, upper: datetime, limit: int = MAX_OCCURRENCES):
        value = RecurrenceService.validate(value, start, timezone)
        params = dict(part.split("=", 1) for part in value.split(";"))
        count = int(params.pop("COUNT")) if "COUNT" in params else None
        # dateutil counts imaginary local times. Count valid instances ourselves.
        local_start = start.astimezone(zone(timezone))
        rule = rrulestr(";".join(f"{k}={v}" for k, v in params.items()), dtstart=local_start)
        valid_count = 0
        emitted = 0
        for scanned, candidate in enumerate(rule, start=1):
            if scanned > MAX_SCAN:
                raise AppError(422, "recurrence_too_complex", "Recurrence exceeds the evaluation budget; narrow or simplify the rule")
            if not datetime_exists(candidate):
                continue
            # dateutil discards DTSTART's explicit fold. Preserve that one
            # instant when the client chose the second repeated wall time;
            # otherwise the first generated event predates its stored start.
            if candidate.replace(tzinfo=None) == local_start.replace(tzinfo=None):
                candidate = local_start.astimezone(UTC)
            else:
                candidate = candidate.replace(fold=0).astimezone(UTC)
            valid_count += 1
            if count is not None and valid_count > count:
                break
            if candidate >= upper:
                break
            if candidate >= lower:
                emitted += 1
                if emitted > limit:
                    raise AppError(422, "invalid_or_large_range", "Too many occurrences in this range")
                yield candidate

    @staticmethod
    def between(value: str, start: datetime, timezone: str, lower: datetime, upper: datetime):
        return list(RecurrenceService.occurrences(value, start, timezone, lower, upper))

    @staticmethod
    def next(value: str, start: datetime, timezone: str, after: datetime) -> datetime | None:
        return next(RecurrenceService.occurrences(value, start, timezone, after, datetime(9998, 1, 1, tzinfo=UTC)), None)

    @staticmethod
    def contains(value: str, start: datetime, timezone: str, occurrence: datetime) -> bool:
        return bool(RecurrenceService.between(value, start, timezone, occurrence, occurrence + timedelta(microseconds=1)))

    @staticmethod
    def truncate(value: str, before: datetime) -> str:
        values = dict(part.split("=", 1) for part in value.split(";"))
        values.pop("COUNT", None)
        values["UNTIL"] = (before.astimezone(UTC) - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
        return ";".join(f"{key}={value}" for key, value in values.items())

    @staticmethod
    def describe(value: str) -> str:
        parts = dict(part.split("=", 1) for part in value.split(";"))
        return f"{parts.get('FREQ', 'Recurring').capitalize()} (interval {parts.get('INTERVAL', '1')})"

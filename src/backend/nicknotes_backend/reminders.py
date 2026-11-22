"""Task reminders: the `remind_at` frontmatter field (local time, minute precision).

A reminder is a point in local time, written as `YYYY-MM-DD HH:MM`. The desktop app shows a
notification when it is reached; whether it was already shown is device-local state, never part
of the Markdown.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

REMIND_AT_FORMAT = "%Y-%m-%d %H:%M"

_REMIND_AT_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$")
_CAPTURE_TIME_PATTERN = re.compile(r"^(\d{1,2})(?::(\d{2})|uhr)$", re.IGNORECASE)


def parse_remind_at(value: object) -> datetime | None:
    """`2026-11-21 09:00` (also with `T` or seconds) as a naive local datetime; anything else is no reminder."""
    if isinstance(value, datetime):
        return value.replace(second=0, microsecond=0, tzinfo=None)
    match = _REMIND_AT_PATTERN.match(str(value or "").strip())
    if not match:
        return None
    try:
        day = date.fromisoformat(match.group(1))
        return datetime.combine(day, time(int(match.group(2)), int(match.group(3))))
    except ValueError:
        return None


def format_remind_at(moment: datetime) -> str:
    return moment.strftime(REMIND_AT_FORMAT)


def normalize_remind_at(value: object) -> str | None:
    moment = parse_remind_at(value)
    return format_remind_at(moment) if moment else None


def shift_remind_at(value: object, old_due: date | None, new_due: date) -> str | None:
    """The reminder of a repeating task's next instance: same distance to the due day, same time of day.

    Without a previous due day the reminder moves to the new due day at its time of day.
    """
    moment = parse_remind_at(value)
    if moment is None:
        return None
    offset = (moment.date() - old_due) if old_due else timedelta(0)
    return format_remind_at(datetime.combine(new_due + offset, moment.time()))


def parse_capture_time(word: str) -> time | None:
    """A capture time word without the `@`: `9:00`, `18:30` or `9uhr`."""
    match = _CAPTURE_TIME_PATTERN.match(word.strip())
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2) or 0)
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)

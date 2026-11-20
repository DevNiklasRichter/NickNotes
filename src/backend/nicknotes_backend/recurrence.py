"""Repeating tasks: the `repeat` rule in task frontmatter and the next due date.

Rules are short English tokens like the task status values: ``daily``, ``weekdays``, ``weekly``,
``monthly``, ``yearly`` or ``every 3 days`` / ``every 2 weeks`` / ``every 6 months`` /
``every 2 years``. ``repeat_from: completion`` counts from the day the task was done instead of
its due date.
"""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

REPEAT_UNITS = ("day", "weekday", "week", "month", "year")
REPEAT_INTERVAL_MAX = 365
REPEAT_FROM_COMPLETION = "completion"
_PRESETS = {
    "daily": ("day", 1),
    "weekdays": ("weekday", 1),
    "weekly": ("week", 1),
    "monthly": ("month", 1),
    "yearly": ("year", 1),
}
_CUSTOM = re.compile(r"^every\s+(\d{1,3})\s+(day|week|month|year)s?$")


@dataclass(frozen=True)
class RepeatRule:
    unit: str
    interval: int = 1


def parse_repeat(raw: object) -> RepeatRule | None:
    """A rule from frontmatter; anything unknown means "does not repeat"."""
    clean = " ".join(str(raw or "").strip().lower().split())
    if not clean:
        return None
    if clean in _PRESETS:
        unit, interval = _PRESETS[clean]
        return RepeatRule(unit, interval)
    match = _CUSTOM.match(clean)
    if not match:
        return None
    interval = int(match.group(1))
    if not 1 <= interval <= REPEAT_INTERVAL_MAX:
        return None
    return RepeatRule(match.group(2), interval)


def format_repeat(rule: RepeatRule) -> str:
    """Canonical frontmatter value for a rule."""
    if rule.interval == 1:
        for name, (unit, interval) in _PRESETS.items():
            if unit == rule.unit and interval == 1:
                return name
    return f"every {rule.interval} {rule.unit}s"


def add_months(day: date, months: int) -> date:
    """Same day of month, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb)."""
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return date(year, month + 1, min(day.day, last))


def _advance(rule: RepeatRule, base: date, steps: int) -> date:
    # Counted from the same base each time, so month ends do not drift within one calculation.
    if rule.unit == "day":
        return base + timedelta(days=rule.interval * steps)
    if rule.unit == "week":
        return base + timedelta(weeks=rule.interval * steps)
    if rule.unit == "month":
        return add_months(base, rule.interval * steps)
    if rule.unit == "year":
        return add_months(base, 12 * rule.interval * steps)
    current = base
    remaining = rule.interval * steps
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def next_occurrence(rule: RepeatRule, *, due: date | None, completed: date, from_completion: bool = False) -> date:
    """Due date of the next instance; always after the completion day and after the old due date.

    From the due date the schedule stays fixed: an overdue weekly task done on Thursday comes back
    on its next regular weekday instead of piling up missed weeks.
    """
    if from_completion or due is None:
        return _advance(rule, completed, 1)
    steps = 1
    candidate = _advance(rule, due, steps)
    while candidate <= completed and steps < 5000:
        steps += 1
        candidate = _advance(rule, due, steps)
    return candidate

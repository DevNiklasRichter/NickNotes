"""The focus-time line in daily notes: one format for writing and reading.

A focus round is a plain Markdown list item, e.g. ``- Fokuszeit 09:30–09:55 (25 min): [[tk_1|Angebot]]``.
The Markdown stays the only record; totals are read back from the daily notes.
"""
from __future__ import annotations

import re
from datetime import datetime

# Also accepts a plain hyphen, in case the line was typed or edited by hand.
FOCUS_LINE_PATTERN = re.compile(r"^[ \t]*[-*] Fokuszeit \d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2} \((\d{1,4}) min\)", re.MULTILINE)


def format_focus_line(started: datetime, ended: datetime, minutes: int, target: str = "") -> str:
    """Times stay in the offset of `started` (the user's local time), not the service's zone."""
    line = f"- Fokuszeit {started:%H:%M}–{ended.astimezone(started.tzinfo):%H:%M} ({int(minutes)} min)"
    return f"{line}: {target}" if target else line


def focus_minutes(markdown: str | None) -> int:
    """Total minutes of all focus lines in one note body."""
    return sum(int(value) for value in FOCUS_LINE_PATTERN.findall(markdown or ""))

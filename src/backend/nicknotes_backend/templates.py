"""Note and task templates: Markdown files in `.system/templates/`.

A template is an ordinary Markdown file. Its body becomes the body of a new note, its frontmatter
carries only fields that make sense to repeat (type, tags, priority, estimate, repetition). The
template folder lives in `.system`, so templates travel with the NoteBase but are never indexed,
linked or shown as open tasks. The template named "Tagesnotiz" shapes every new daily note.
"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .file_io import atomic_write_text
from .markdown_io import dump_markdown, parse_markdown_text
from .todos import FENCE_PATTERN, HISTORY_PATTERN, PROMOTION_MARKER_PATTERN, TODO_LINE_PATTERN

DAILY_TEMPLATE_NAME = "Tagesnotiz"
# Fields a new note takes over from its template; everything else (ids, dates, status) is its own.
TEMPLATE_FIELDS = ("tags", "priority", "estimate_minutes", "repeat", "repeat_from")
_WEEKDAYS = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-zäöüÄÖÜ]+)\s*\}\}")
_UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_TODO_BLOCK_REF = re.compile(r"\s+\^nn-todo_[A-Za-z0-9_-]*\s*$")


def fresh_checklist(body: str) -> str:
    """To-dos as a template carries them: open, without their id, history or promotion marker."""
    lines = body.split("\n")
    fence = ""
    for index, line in enumerate(lines):
        opened = FENCE_PATTERN.match(line)
        if opened:
            marker = opened.group(1)[0]
            fence = "" if fence == marker else (fence or marker)
            continue
        match = TODO_LINE_PATTERN.match(line)
        if fence or not match:
            continue
        # Tail order as written by todos.format_todo_tail: history, block ref, promotion marker.
        text = _TODO_BLOCK_REF.sub("", PROMOTION_MARKER_PATTERN.sub("", match.group(3)))
        prefix = match.group(1).replace("[x]", "[ ]").replace("[X]", "[ ]")
        lines[index] = prefix + HISTORY_PATTERN.sub("", text).rstrip()
    return "\n".join(lines)


def template_name(value: str) -> str:
    """A name that is also a valid Windows file name; '' when nothing usable is left."""
    clean = " ".join(_UNSAFE_NAME.sub(" ", str(value or "")).split()).strip(" .")
    return clean[:80]


def render_placeholders(text: str, *, title: str, moment: datetime) -> str:
    """Fill {{datum}}, {{uhrzeit}}, {{wochentag}} and {{titel}} (also the English names); keep unknown ones."""
    values = {
        "datum": moment.strftime("%Y-%m-%d"),
        "date": moment.strftime("%Y-%m-%d"),
        "uhrzeit": moment.strftime("%H:%M"),
        "time": moment.strftime("%H:%M"),
        "wochentag": _WEEKDAYS[moment.weekday()],
        "weekday": _WEEKDAYS[moment.weekday()],
        "titel": title,
        "title": title,
    }
    return _PLACEHOLDER.sub(lambda match: values.get(match.group(1).lower(), match.group(0)), text)


def template_from_note(meta: dict[str, Any], body: str, title: str) -> tuple[str, dict[str, Any], str]:
    """Kind, kept frontmatter and body of a template made from an existing note.

    The note's own heading becomes `# {{titel}}`, so every new note gets its own title there.
    """
    kind = "task" if str(meta.get("type", "")).strip().lower() == "task" else "note"
    fields = {key: meta[key] for key in TEMPLATE_FIELDS if meta.get(key) not in (None, "", [])}
    if str(fields.get("priority", "")).strip().lower() in {"medium", "m"}:
        fields.pop("priority")  # the default needs no mention
    lines = body.split("\n")
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        if title and line.strip() == f"# {title}":
            lines[index] = "# {{titel}}"
        break
    return kind, fields, fresh_checklist("\n".join(lines))


class TemplateStore:
    """Reads and writes the template files of one NoteBase."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder

    def _path(self, name: str) -> Path:
        clean = template_name(name)
        if not clean:
            raise ValueError("Die Vorlage braucht einen Namen.")
        return self.folder / f"{clean}.md"

    def _find(self, name: str) -> Path | None:
        """Template file for a name, ignoring case like Windows does."""
        clean = template_name(name).casefold()
        if not clean or not self.folder.is_dir():
            return None
        return next((path for path in self.folder.glob("*.md") if path.stem.casefold() == clean), None)

    def list(self) -> list[dict[str, Any]]:
        if not self.folder.is_dir():
            return []
        items = []
        for path in self.folder.glob("*.md"):
            try:
                meta, _body = parse_markdown_text(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, ValueError):
                continue
            kind = "task" if str(meta.get("type", "")).strip().lower() == "task" else "note"
            items.append({"name": path.stem, "kind": kind, "daily": path.stem.casefold() == DAILY_TEMPLATE_NAME.casefold()})
        return sorted(items, key=lambda item: item["name"].casefold())

    def read(self, name: str) -> tuple[str, dict[str, Any], str]:
        """Kind, frontmatter fields and body; ValueError when the template does not exist."""
        path = self._find(name)
        if path is None:
            raise ValueError(f"Die Vorlage „{template_name(name)}“ gibt es nicht mehr.")
        meta, body = parse_markdown_text(path.read_text(encoding="utf-8"))
        kind = "task" if str(meta.get("type", "")).strip().lower() == "task" else "note"
        return kind, {key: meta[key] for key in TEMPLATE_FIELDS if key in meta}, fresh_checklist(body)

    def daily(self) -> str | None:
        """Body of the daily-note template, or None without one."""
        try:
            return self.read(DAILY_TEMPLATE_NAME)[2]
        except (OSError, UnicodeDecodeError, ValueError):
            return None

    def exists(self, name: str) -> bool:
        return self._find(name) is not None

    def write(self, name: str, kind: str, fields: dict[str, Any], body: str, *, replace: bool) -> str:
        existing = self._find(name)
        if existing is not None and not replace:
            raise ValueError(f"Eine Vorlage „{existing.stem}“ gibt es schon.")
        path = existing or self._path(name)
        self.folder.mkdir(parents=True, exist_ok=True)
        atomic_write_text(path, dump_markdown({"type": kind, **fields}, body), encoding="utf-8")
        return path.stem

    def delete(self, name: str) -> None:
        path = self._find(name)
        if path is not None:
            path.unlink(missing_ok=True)

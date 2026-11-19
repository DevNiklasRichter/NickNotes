from __future__ import annotations

import gc
import json
import mimetypes
import re
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .indexer import VaultIndexer
from .local_data import RETIRED_SYSTEM_FILES, notebase_data_path
from .file_io import atomic_write_text, atomic_write_bytes
from .migrations import migrate_configuration, validate_configuration
from .source_journal import active_journal
from .markdown_io import dump_markdown, parse_markdown, parse_markdown_text
from .models import ParsedTask, TagSuggestion
from .parser import make_note_id, make_task_id
from .projection_registry import TASK_LINK_INDEX_SCHEMA_VERSION, quarantine_projection_file
from .task_domain import (
    normalize_tag_id as _normalize_tag_id,
    normalize_tag_key as _normalize_tag_key,
    normalize_task_priority as _normalize_task_priority,
    normalize_task_status as _normalize_task_status,
    slugify,
    task_status_folder_token as _task_status_folder_token,
)
from .todos import format_todo_tail, mark_todo_promoted, toggle_todo_checkbox
from ..config import (
    TAG_GROUP_DEFAULT_COLOR,
    TASK_ESTIMATE_MINUTES_MAX,
    VAULT_MAX_DAILY_MIT_ITEMS,
    VAULT_MAX_MEDIA_ASSET_BYTES,
    VAULT_NOTE_TITLE_FALLBACK_LENGTH,
)


WINDOWS_FILE_OPERATION_RETRIES = 8
WINDOWS_FILE_OPERATION_RETRY_DELAY_SECONDS = 0.035


def _normalize_label(value: str) -> str:
    return " ".join(value.strip().split())


def _with_windows_file_operation_retry(operation: Any) -> Any:
    last_error: PermissionError | None = None
    for attempt in range(WINDOWS_FILE_OPERATION_RETRIES):
        try:
            return operation()
        except PermissionError as exc:
            last_error = exc
            if attempt >= WINDOWS_FILE_OPERATION_RETRIES - 1:
                break
            gc.collect()
            time.sleep(WINDOWS_FILE_OPERATION_RETRY_DELAY_SECONDS * (attempt + 1))
    if last_error is not None:
        raise last_error
    return None


def _rename_path_with_retry(source: Path, destination: Path) -> None:
    if journal := active_journal.get():
        journal.move(source, destination)
    _with_windows_file_operation_retry(lambda: source.rename(destination))


def _unlink_path_with_retry(path: Path, *, missing_ok: bool = False) -> None:
    if journal := active_journal.get():
        journal.record(path)
    _with_windows_file_operation_retry(lambda: path.unlink(missing_ok=missing_ok))


def _rmtree_with_retry(path: Path) -> None:
    if journal := active_journal.get():
        journal.tree(path)
    _with_windows_file_operation_retry(lambda: shutil.rmtree(path))


def _dedupe_sorted(values: list[str]) -> list[str]:
    return sorted(set(values), key=lambda item: item.lower())


TASK_STATUSES = ("new_topic", "open", "in_progress", "on_hold", "done")
TASK_PRIORITIES = ("low", "medium", "high")
TASK_LINK_NOTE_TYPE = "task_link"
INLINE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}")
WIKILINK_PATTERN = re.compile(r"\[\[([^[\]\n]+)\]\]")
TITLE_HEADING_PATTERN = re.compile(r"^\s{0,3}#\s+(.+?)\s*$")
MEDIA_IMAGE_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
}
MEDIA_IMAGE_EXTENSIONS = set(MEDIA_IMAGE_CONTENT_TYPES.values())
ISO_DAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def _normalize_tag_color(value: str) -> str:
    clean = value.strip().lower()
    if len(clean) == 4 and clean.startswith("#") and all(char in "0123456789abcdef" for char in clean[1:]):
        return clean
    if len(clean) == 7 and clean.startswith("#") and all(char in "0123456789abcdef" for char in clean[1:]):
        return clean
    return TAG_GROUP_DEFAULT_COLOR


def _tag_ref_for_suggestion(tag: TagSuggestion) -> tuple[str, str, str]:
    group_slug = slugify(str(tag.category))
    tag_slug = slugify(str(tag.slug))
    if not group_slug or not tag_slug:
        return "", "", ""
    key = f"{group_slug}:{tag_slug}"
    inline_ref = f"{{tag:{group_slug}/{tag_slug}}}"
    display_name = _normalize_label(str(tag.display_name or "").replace("_", " ").replace("-", " "))
    if not display_name:
        display_name = tag_slug.replace("_", " ")
    return key, inline_ref, display_name


def _replace_text_outside_inline_tags(text: str, pattern: re.Pattern[str], replacement: str) -> str:
    if not text:
        return text

    inline_ranges = [(match.start(), match.end()) for match in INLINE_TAG_PATTERN.finditer(text)]

    def intersects_inline_tag(start: int, end: int) -> bool:
        for range_start, range_end in inline_ranges:
            if start < range_end and end > range_start:
                return True
        return False

    parts: list[str] = []
    cursor = 0
    changed = False
    for match in pattern.finditer(text):
        start, end = match.span()
        if start < cursor:
            continue
        if intersects_inline_tag(start, end):
            continue
        parts.append(text[cursor:start])
        parts.append(replacement)
        cursor = end
        changed = True

    if not changed:
        return text

    parts.append(text[cursor:])
    return "".join(parts)


def _apply_capture_tag_replacements(text: str, selected_tags: list[TagSuggestion]) -> str:
    if not text or not selected_tags:
        return text

    tag_rows: list[dict[str, Any]] = []
    first_token_counts: dict[str, int] = {}
    seen_keys: set[str] = set()

    for tag in selected_tags:
        key, inline_ref, display_name = _tag_ref_for_suggestion(tag)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)

        aliases: list[str] = []
        if display_name:
            aliases.append(display_name)

        slug_alias = " ".join(str(tag.slug).replace("-", " ").replace("_", " ").split())
        if slug_alias and all(existing.casefold() != slug_alias.casefold() for existing in aliases):
            aliases.append(slug_alias)

        first_token = ""
        if display_name:
            token = display_name.split(" ", 1)[0].strip()
            if len(token) >= 3:
                first_token = token
                lowered = token.casefold()
                first_token_counts[lowered] = first_token_counts.get(lowered, 0) + 1

        tag_rows.append(
            {
                "inline_ref": inline_ref,
                "aliases": aliases,
                "first_token": first_token,
            }
        )

    replaced_text = text
    for row in tag_rows:
        aliases = [str(alias).strip() for alias in row["aliases"] if str(alias).strip()]
        first_token = str(row["first_token"] or "").strip()
        if first_token:
            lowered = first_token.casefold()
            if first_token_counts.get(lowered, 0) == 1 and all(existing.casefold() != lowered for existing in aliases):
                aliases.append(first_token)

        deduped_aliases: list[str] = []
        seen_aliases: set[str] = set()
        for alias in sorted(aliases, key=lambda value: (-len(value), value.casefold())):
            key = alias.casefold()
            if key in seen_aliases:
                continue
            seen_aliases.add(key)
            deduped_aliases.append(alias)

        for alias in deduped_aliases:
            alias_pattern = re.compile(
                rf"(?<![A-Za-z0-9_]){re.escape(alias)}(?![A-Za-z0-9_])",
                flags=re.IGNORECASE,
            )
            replaced_text = _replace_text_outside_inline_tags(replaced_text, alias_pattern, str(row["inline_ref"]))

    return replaced_text


def _ensure_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        items = [value]
    elif isinstance(value, list):
        items = [str(item) for item in value]
    else:
        items = []
    return [item.strip() for item in items if item and str(item).strip()]


def _normalize_note_type(raw: str) -> str:
    clean = raw.strip().lower().replace("-", "_").replace(" ", "_")
    return "task" if clean == "task" else "note"

def _task_link_token(raw: str) -> str:
    clean = _normalize_label(str(raw or "")).lower()
    clean = re.sub(r"[^a-z0-9]+", "_", clean)
    clean = re.sub(r"_+", "_", clean).strip("_")
    return clean or "task"


def _normalize_due_date(raw: str) -> str:
    clean = raw.strip()
    if not clean:
        return ""
    return clean if re.fullmatch(r"\d{4}-\d{2}-\d{2}", clean) else ""


def _normalize_iso_timestamp(raw: Any) -> str:
    clean = str(raw or "").strip()
    if not clean:
        return ""
    if clean.endswith("Z"):
        clean = f"{clean[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(clean)
    except ValueError:
        return ""
    return parsed.isoformat(timespec="seconds")


def _normalize_estimate_minutes(raw: Any) -> int | None:
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        value = int(raw)
    else:
        clean = str(raw).strip()
        if not clean:
            return None
        try:
            value = int(float(clean))
        except ValueError:
            return None
    if value <= 0:
        return None
    return min(value, TASK_ESTIMATE_MINUTES_MAX)


def _normalize_optional_text(raw: Any) -> str:
    return " ".join(str(raw or "").split())


def _normalize_blocked_by_ids(raw: Any, exclude_id: str = "") -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    exclude_key = exclude_id.strip().lower()
    for item in _ensure_string_list(raw):
        parts = item.split(",") if "," in item else [item]
        for part in parts:
            clean = part.strip()
            if not clean:
                continue
            lowered = clean.lower()
            if exclude_key and lowered == exclude_key:
                # Defensive hygiene: avoid self-referential blockers.
                continue
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized.append(clean)
    return normalized


def _extract_title_from_body(body: str) -> str:
    for line in body.splitlines():
        match = TITLE_HEADING_PATTERN.match(line)
        if match:
            return _normalize_label(match.group(1))
        stripped = line.strip()
        if stripped:
            return _normalize_label(stripped[:VAULT_NOTE_TITLE_FALLBACK_LENGTH])
    return ""


def _strip_matching_title_heading(body: str, title: str) -> str:
    lines = body.splitlines()
    if not lines:
        return body
    match = TITLE_HEADING_PATTERN.match(lines[0])
    if not match:
        return body
    heading_title = _normalize_label(match.group(1))
    if heading_title.lower() != _normalize_label(title).lower():
        return body
    trimmed = "\n".join(lines[1:]).lstrip("\n")
    return trimmed


def _extract_auto_tags(body: str) -> list[str]:
    found: set[str] = set()
    from .markdown_syntax import prose_text

    for match in INLINE_TAG_PATTERN.finditer(prose_text(body)):
        key = _normalize_tag_key(f"{match.group(1)}:{match.group(2)}")
        if key:
            found.add(key)

    return sorted(found, key=lambda item: item.lower())


def _extract_related_links(body: str) -> list[str]:
    related: set[str] = set()
    from .markdown_syntax import prose_text
    for match in WIKILINK_PATTERN.finditer(prose_text(body)):
        raw = match.group(1).strip()
        if not raw:
            continue
        target = raw.split("|", 1)[0].strip()
        if not target:
            continue
        clean = target.split("#", 1)[0].strip().replace("\\", "/")
        clean = clean[:-3] if clean.lower().endswith(".md") else clean
        if clean:
            related.add(clean)
    return sorted(related, key=lambda item: item.lower())


def _looks_like_corrupt_title(value: str) -> bool:
    clean = value.strip().lower()
    return clean in {"", "---", "ï»¿---", "\ufeff---"}


def _extract_markdown_link_target(raw_target: str) -> str:
    clean = raw_target.strip()
    if not clean:
        return ""

    if clean.startswith("<"):
        end = clean.find(">")
        if end > 1:
            return clean[1:end].strip()

    separators = (' "', " '", "\t", "\r", "\n")
    for separator in separators:
        if separator in clean:
            clean = clean.split(separator, 1)[0].strip()
            break

    return clean


def _normalize_daily_day(raw_day: str | None) -> str:
    if raw_day and ISO_DAY_PATTERN.fullmatch(raw_day.strip()):
        return raw_day.strip()
    return datetime.now().date().isoformat()


def _daily_month_folder(day_iso: str) -> str:
    return day_iso[:7].replace("-", ".")


def _normalize_mit_ids(raw_value: Any, limit: int = VAULT_MAX_DAILY_MIT_ITEMS) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in _ensure_string_list(raw_value):
        clean = item.strip()
        if not clean:
            continue
        lowered = clean.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(clean)
        if len(normalized) >= limit:
            break
    return normalized


DUE_TOKEN_PATTERN = re.compile(r"(?:^|\s)@(\d{4}-\d{2}-\d{2})(?=\s|$)")


_CAPTURE_DATED_LINE = re.compile(r"^(\s*)(?!(?:[-*+]\s+)?\[[ xX]\])(?!#)(?:[-*+]\s+)?(\S.*)$")


_GERMAN_DUE_TOKEN = re.compile(r"(?:^|(?<=\s))@(\d{1,2})\.(\d{1,2})\.(\d{4})?(?=\s|$)")


def _german_due_tokens_to_iso(line: str, today: datetime) -> str:
    """`@20.11.2026` / `@20.11.` typed without the popup become `@2026-11-20`; impossible days stay as typed (no task)."""

    def replace(match: re.Match[str]) -> str:
        day, month = int(match.group(1)), int(match.group(2))
        years = [int(match.group(3))] if match.group(3) else range(today.year, today.year + 9)
        for year in years:
            try:
                resolved = datetime(year, month, day)
            except ValueError:
                continue
            if match.group(3) or resolved.date() >= today.date():
                return f"@{resolved:%Y-%m-%d}"
        return match.group(0)

    return _GERMAN_DUE_TOKEN.sub(replace, line)


def _normalize_capture_dates(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Normalizes typed `@dates` and finds plain lines (no checkbox) carrying a valid one: `(title, due_date)`.

    A dated plain line becomes a task; a dated to-do (`- [ ] ... @date`) stays a to-do. Impossible days stay text.
    """
    out: list[str] = []
    dated: list[tuple[str, str]] = []
    in_fence = False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence:
            line = _german_due_tokens_to_iso(line, datetime.now())
            match = _CAPTURE_DATED_LINE.match(line)
            due = DUE_TOKEN_PATTERN.search(match.group(2)) if match else None
            if match and due and _is_iso_day(due.group(1)):
                title = " ".join(DUE_TOKEN_PATTERN.sub(" ", match.group(2)).split())
                if title:
                    dated.append((title, due.group(1)))
        out.append(line)
    return "\n".join(out), dated


def _is_iso_day(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


class VaultManager:
    def __init__(self, vault_path: Path):
        self.vault_path = vault_path
        self._last_link_rewrite_result: dict[str, Any] = {"updated": 0, "paths": []}
        self._configure_root_paths()

    def validate_roots(self) -> None:
        root = self.vault_path.resolve()
        for path in (self.system_path, self.media_root_path, self.daily_root_path, self.tasks_root_path, self.tag_root_path):
            if not path.resolve().is_relative_to(root):
                raise ValueError("Ein interner NoteBase-Ordner verweist außerhalb der NoteBase.")

    def ensure_structure(self) -> None:
        from .source_journal import SourceJournal, active_journal
        self.validate_roots()
        self._reject_unsupported_layout()
        validate_configuration(self)
        if active_journal.get() is not None:
            return self._ensure_structure()
        with SourceJournal(self, 'ensure-structure-migration'):
            self._ensure_structure()

    def _ensure_structure(self) -> None:
        self.validate_roots()
        migrate_configuration(self)
        for path in (self.daily_root_path, self.tag_root_path, self.tasks_root_path, self.media_root_path, self.system_path, self.local_path):
            path.mkdir(parents=True, exist_ok=True)
        self._ensure_task_status_folders()
        self._remove_retired_projections()

        if not self.config_path.exists():
            atomic_write_text(self.config_path, json.dumps({'format_version': 2, 'vault_id': str(uuid.uuid4())}, indent=2), encoding='utf-8')

        if not self.read_tag_groups():
            # New NoteBases should start without pre-created tag groups.
            self._write_tag_groups([])

        if not self.favorite_folders_path.exists():
            self._write_favorite_folders([self.daily_root_name, self.tag_root_name, self.tasks_root_name])

        if not self.ui_settings_path.exists():
            atomic_write_text(self.ui_settings_path, json.dumps({'updated_at': datetime.now().astimezone().isoformat(timespec='seconds'), 'app': {}, 'explorer': {}}, indent=2, ensure_ascii=False), encoding='utf-8')

    def _configure_root_paths(self) -> None:
        self.daily_root_name = "daily"
        self.tag_root_name = "tags"
        self.tasks_root_name = "tasks"
        self.media_root_name = ".media"
        self.system_root_name = ".system"

        self.daily_root_path = self.vault_path / self.daily_root_name
        self.tag_root_path = self.vault_path / self.tag_root_name
        self.tasks_root_path = self.vault_path / self.tasks_root_name
        self.media_root_path = self.vault_path / self.media_root_name
        self.system_path = self.vault_path / self.system_root_name

        self.config_path = self.system_path / "config.json"
        self.tag_groups_path = self.system_path / "tag_groups.json"
        self.favorite_folders_path = self.system_path / "favorite_folders.json"
        self.ui_settings_path = self.system_path / "ui_settings.json"
        self.graph_state_path = self.system_path / "graph-state.json"  # your graph arrangement travels with the NoteBase
        # Derived projections and journals are device-local (see local_data).
        self.local_path = notebase_data_path(self.vault_path)
        self.db_path = self.local_path / "index.db"
        self.graph_index_path = self.local_path / "graph-index.json"
        self.projection_dirty_path = self.local_path / "projection-dirty.json"
        self.recovery_path = self.local_path / "recovery"
        self.operations_path = self.local_path / "mcp-operations"
        self.task_status_links_path = self.local_path / "task_status_links.json"

    def _remove_retired_projections(self) -> None:
        """Projections used to live in `.system`; keep pending journals, drop the rest."""
        for name in RETIRED_SYSTEM_FILES:
            (self.system_path / name).unlink(missing_ok=True)
        old_recovery = self.system_path / "recovery"
        if old_recovery.is_dir() and not old_recovery.is_symlink():
            self.recovery_path.mkdir(parents=True, exist_ok=True)
            for entry in old_recovery.iterdir():
                if not (self.recovery_path / entry.name).exists():
                    shutil.move(str(entry), str(self.recovery_path / entry.name))
            shutil.rmtree(old_recovery, ignore_errors=True)
        shutil.rmtree(self.system_path / "mcp-operations", ignore_errors=True)

    def _ensure_task_status_folders(self) -> None:
        self.tasks_root_path.mkdir(parents=True, exist_ok=True)
        for status in TASK_STATUSES:
            folder = self.tasks_root_path / _task_status_folder_token(status)
            folder.mkdir(parents=True, exist_ok=True)

    def _read_task_status_link_index(self) -> dict[str, str]:
        if not self.task_status_links_path.exists():
            return {}
        try:
            payload = json.loads(self.task_status_links_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            quarantine_projection_file(self.task_status_links_path, projection="task-status-links")
            return {}
        if not isinstance(payload, dict):
            quarantine_projection_file(self.task_status_links_path, projection="task-status-links")
            return {}
        raw_version = payload.get("version")
        try:
            version = int(raw_version)
        except (TypeError, ValueError):
            version = 0
        if version != TASK_LINK_INDEX_SCHEMA_VERSION:
            quarantine_projection_file(self.task_status_links_path, projection="task-status-links")
            return {}
        raw_links = payload.get("links", {})
        if not isinstance(raw_links, dict):
            return {}
        next_links: dict[str, str] = {}
        for raw_task_id, raw_relative in raw_links.items():
            task_id = str(raw_task_id or "").strip()
            relative = str(raw_relative or "").replace("\\", "/").strip().strip("/")
            if task_id and relative:
                next_links[task_id] = relative
        return next_links

    def _write_task_status_link_index(self, mapping: dict[str, str]) -> None:
        links = {str(task_id): str(relative).replace("\\", "/").strip().strip("/") for task_id, relative in mapping.items()}
        payload = {
            "version": TASK_LINK_INDEX_SCHEMA_VERSION,
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "links": links,
        }
        self.system_path.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.task_status_links_path, json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')

    def _reject_unsupported_layout(self) -> None:
        """Stop before writing when the folder still uses a pre-2.1 metadata directory."""
        if (self.system_path / "config.json").exists():
            return
        for name in ("system", "99_system"):
            if (self.vault_path / name / "config.json").is_file():
                raise ValueError(
                    f'Diese NoteBase verwendet noch den alten Systemordner "{name}". '
                    "Öffne sie einmal mit NickNotes 2.1.0-rc.4 oder benenne den Ordner in \".system\" um. "
                    "Es wurde nichts verändert."
                )

    def list_note_groups(self) -> list[dict[str, Any]]:
        groups: list[dict[str, Any]] = []
        favorites = set(self._read_favorite_folders())
        for child in self._sorted_dirs(self.vault_path):
            if child.name in {self.system_root_name, self.media_root_name}:
                continue
            groups.extend(self._collect_custom_group_payloads(child, favorites))
        return groups

    def create_note_group(self, group_name: str, parent_key: str = "") -> dict[str, Any]:
        clean_name = _normalize_label(group_name)
        if not clean_name:
            raise ValueError("Group name cannot be empty")

        token = self._safe_group_dir_token(clean_name)
        if not token:
            raise ValueError("Group name contains no valid filename characters")

        parent_path = self._resolve_group_path(parent_key)
        if self._is_creation_locked_path(parent_path):
            raise ValueError("In daily-, tags- und tasks-Ordnern können keine neuen Gruppen angelegt werden.")

        candidate = token
        suffix = 2
        while True:
            target_path = parent_path / candidate
            file_collision = any(
                sibling_file.is_file() and sibling_file.stem.lower() == candidate.lower() for sibling_file in parent_path.iterdir()
            )
            if not target_path.exists() and not file_collision:
                break
            candidate = f"{token}_{suffix}"
            suffix += 1

        target_path.mkdir(parents=True, exist_ok=True)
        return self._group_payload(target_path, set(self._read_favorite_folders()))

    def create_note_in_group(
        self,
        group_key: str,
        title: str,
        indexer: VaultIndexer,
        note_type: str = "note",
        status: str = "open",
    ) -> dict[str, Any]:
        root_dir = self._resolve_group_path(group_key)
        if self._is_creation_locked_path(root_dir):
            raise ValueError("In daily-, tags- und tasks-Ordnern können keine neuen Notizen oder Tasks angelegt werden.")

        kind = _normalize_note_type(note_type)
        now = datetime.now()
        clean_title = _normalize_label(title) or ("New Task" if kind == "task" else "New Note")
        note_id = make_task_id(now) if kind == "task" else make_note_id(now)
        safe_stem = self._safe_entry_name(clean_title) or note_id

        note_dir = root_dir
        note_dir.mkdir(parents=True, exist_ok=True)
        note_path = self._next_available_note_path(note_dir, safe_stem)
        normalized_status = _normalize_task_status(status)
        normalized_priority = _normalize_task_priority("medium")
        note_content = self._build_note_document(
            body="",
            title=clean_title,
            note_type=kind,
            note_id=note_id,
            node_id=note_id,
            created_at=now.astimezone().isoformat(timespec="seconds"),
            updated_at=now.astimezone().isoformat(timespec="seconds"),
            status=normalized_status,
            priority=normalized_priority,
            due_date="",
            estimate_minutes=None,
            completed_at="",
            blocked_by_ids=[],
            waiting_for="",
            follow_up_date="",
            blocked_reason="",
            next_action_hint="",
            manual_tags=[],
            manual_related=[],
            auto_tags=[],
            auto_related=[],
        )
        atomic_write_text(note_path, note_content, encoding='utf-8')

        indexer.reindex_markdown_file(self.vault_path, note_path)
        if kind == "task":
            self.sync_task_status_link(
                task_id=note_id,
                title=clean_title,
                status=normalized_status,
                task_path=str(note_path),
                indexer=indexer,
            )
        return {"note_id": note_id, "note_path": note_path, "title": clean_title}

    def rename_note_group(self, group_key: str, new_name: str, indexer: VaultIndexer) -> dict[str, Any]:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        target = self._resolve_group_path(group_key)
        relative = self._to_group_key(target)
        if self._is_protected_root(relative):
            raise ValueError("Dieser Basisordner kann nicht umbenannt werden.")

        clean_name = _normalize_label(new_name)
        if not clean_name:
            raise ValueError("Folder name cannot be empty")
        safe_name = self._safe_entry_name(clean_name)
        if not safe_name:
            raise ValueError("Folder name contains no valid filename characters")

        destination = target.parent / safe_name
        suffix = 2
        while destination.exists() and destination != target:
            destination = target.parent / f"{safe_name}_{suffix}"
            suffix += 1

        if destination == target:
            return self._group_payload(target, set(self._read_favorite_folders()))

        link_mappings = self._collect_note_path_mappings_for_tree_move(target, destination)
        _rename_path_with_retry(target, destination)
        self._remap_favorites(relative, self._to_group_key(destination))
        indexer.reindex_vault(self.vault_path)
        self._record_link_rewrite_result(self.rewrite_note_links_for_moved_paths(link_mappings, indexer))
        return self._group_payload(destination, set(self._read_favorite_folders()))

    def move_note_group(self, group_key: str, target_parent_key: str, indexer: VaultIndexer) -> dict[str, Any]:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        source = self._resolve_group_path(group_key)
        source_key = self._to_group_key(source)
        if self._is_protected_root(source_key):
            raise ValueError("Die Basisordner daily, tags und tasks können nicht verschoben werden.")
        if self._is_system_path(source):
            raise ValueError("Systemordner kann nicht verschoben werden.")

        target_parent = self._resolve_group_path(target_parent_key)
        if self._is_tag_path(target_parent):
            raise ValueError("Ordner können nicht in den Tag-Bereich verschoben werden.")
        if self._is_system_path(target_parent):
            raise ValueError("Ordner können nicht in den Systembereich verschoben werden.")
        if self._is_same_or_descendant(source, target_parent):
            raise ValueError("Ein Ordner kann nicht in sich selbst oder einen Unterordner verschoben werden.")

        destination = target_parent / source.name
        if destination == source:
            return self._group_payload(source, set(self._read_favorite_folders()))

        suffix = 2
        while destination.exists() and destination != source:
            destination = target_parent / f"{source.name}_{suffix}"
            suffix += 1

        link_mappings = self._collect_note_path_mappings_for_tree_move(source, destination)
        _rename_path_with_retry(source, destination)
        self._remap_favorites(source_key, self._to_group_key(destination))
        indexer.reindex_vault(self.vault_path)
        self.rebuild_task_status_links(indexer)
        self._record_link_rewrite_result(self.rewrite_note_links_for_moved_paths(link_mappings, indexer))
        return self._group_payload(destination, set(self._read_favorite_folders()))

    def delete_note_group(self, group_key: str, indexer: VaultIndexer) -> None:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        target = self._resolve_group_path(group_key)
        relative = self._to_group_key(target)
        if self._is_protected_root(relative):
            raise ValueError("Die Basisordner daily, tags und tasks können nicht gelöscht werden.")
        if self._is_system_path(target):
            raise ValueError("Systemordner kann nicht gelöscht werden.")

        deleted_targets = self._collect_note_link_keys_for_tree(target)
        _rmtree_with_retry(target)
        self._remove_favorite_path(relative)
        indexer.reindex_vault(self.vault_path)
        self.rebuild_task_status_links(indexer)
        self._record_link_rewrite_result(self.rewrite_note_links_for_deleted_paths(deleted_targets, indexer))

    def rename_note_file(self, note_path: str, new_name: str, indexer: VaultIndexer) -> Path:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        file_path = self._resolve_note_file(note_path)
        previous_task_payload = self._task_link_payload_from_file(file_path)
        clean_name = _normalize_label(new_name)
        if not clean_name:
            raise ValueError("File name cannot be empty")

        safe_stem = self._safe_entry_name(Path(clean_name).stem)
        if not safe_stem:
            raise ValueError("File name contains no valid filename characters")

        destination = file_path.with_name(f"{safe_stem}{file_path.suffix or '.md'}")
        suffix = 2
        while destination.exists() and destination != file_path:
            destination = file_path.with_name(f"{safe_stem}_{suffix}{file_path.suffix or '.md'}")
            suffix += 1

        if destination != file_path:
            _rename_path_with_retry(file_path, destination)

        resolved_title = clean_name
        if destination.stem.lower() != safe_stem.lower():
            resolved_title = self._label_from_group_dir(destination.stem)

        original = destination.read_text(encoding="utf-8")
        normalized, _meta = self.normalize_note_markdown_text(
            text=original,
            path=destination,
            force_title=resolved_title,
            touch_updated=True,
        )
        if normalized != original:
            atomic_write_text(destination, normalized, encoding='utf-8')

        indexer.remove_projection_for_path(str(file_path))
        indexer.reindex_markdown_file(self.vault_path, destination)
        next_task_payload = self._task_link_payload_from_file(destination)
        previous_task_id = previous_task_payload["task_id"] if previous_task_payload else ""
        next_task_id = next_task_payload["task_id"] if next_task_payload else ""
        if previous_task_payload and (not next_task_payload or previous_task_id != next_task_id):
            self.sync_task_status_link(
                task_id=previous_task_id,
                title=previous_task_payload["title"],
                status=previous_task_payload["status"],
                task_path="",
                indexer=indexer,
            )
        if next_task_payload:
            self.sync_task_status_link(
                task_id=next_task_payload["task_id"],
                title=next_task_payload["title"],
                status=next_task_payload["status"],
                task_path=str(destination),
                indexer=indexer,
            )
        if destination != file_path:
            self._record_link_rewrite_result(
                self.rewrite_note_links_for_moved_paths(self._note_path_mappings([(file_path, destination)]), indexer)
            )
        return destination

    def move_note_file(self, note_path: str, target_group_key: str, indexer: VaultIndexer) -> Path:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        file_path = self._resolve_note_file(note_path)
        task_payload = self._task_link_payload_from_file(file_path)
        target_group = self._resolve_group_path(target_group_key)
        if self._is_tag_path(target_group):
            raise ValueError("Notizen können nicht in den Tag-Bereich verschoben werden.")
        if self._is_system_path(target_group):
            raise ValueError("Notizen können nicht in den Systembereich verschoben werden.")

        target_dir = target_group
        target_dir.mkdir(parents=True, exist_ok=True)

        destination = target_dir / file_path.name
        if destination == file_path:
            return file_path

        suffix = 2
        while destination.exists() and destination != file_path:
            destination = target_dir / f"{file_path.stem}_{suffix}{file_path.suffix}"
            suffix += 1

        _rename_path_with_retry(file_path, destination)
        indexer.remove_projection_for_path(str(file_path))
        indexer.reindex_markdown_file(self.vault_path, destination)
        if task_payload:
            self.sync_task_status_link(
                task_id=task_payload["task_id"],
                title=task_payload["title"],
                status=task_payload["status"],
                task_path=str(destination),
                indexer=indexer,
            )
        self._record_link_rewrite_result(
            self.rewrite_note_links_for_moved_paths(self._note_path_mappings([(file_path, destination)]), indexer)
        )
        return destination

    def move_note_files(self, note_paths: list[str], target_group_key: str, indexer: VaultIndexer) -> list[dict[str, str]]:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        if not note_paths:
            return []

        target_group = self._resolve_group_path(target_group_key)
        if self._is_tag_path(target_group):
            raise ValueError("Notizen können nicht in den Tag-Bereich verschoben werden.")
        if self._is_system_path(target_group):
            raise ValueError("Notizen können nicht in den Systembereich verschoben werden.")

        target_dir = target_group
        target_dir.mkdir(parents=True, exist_ok=True)

        resolved_sources: list[Path] = []
        seen_sources: set[str] = set()
        for raw_path in note_paths:
            file_path = self._resolve_note_file(raw_path)
            source_key = str(file_path.resolve()).lower()
            if source_key in seen_sources:
                continue
            seen_sources.add(source_key)
            resolved_sources.append(file_path)

        moved_entries: list[dict[str, str]] = []
        changed = False
        task_payloads_by_source: dict[str, dict[str, str]] = {}
        for file_path in resolved_sources:
            payload = self._task_link_payload_from_file(file_path)
            if payload:
                task_payloads_by_source[str(file_path)] = payload
            destination = target_dir / file_path.name
            if destination != file_path:
                suffix = 2
                while destination.exists() and destination != file_path:
                    destination = target_dir / f"{file_path.stem}_{suffix}{file_path.suffix}"
                    suffix += 1
                _rename_path_with_retry(file_path, destination)
                changed = True

            moved_entries.append(
                {
                    "fromPath": str(file_path),
                    "movedPath": str(destination),
                }
            )

        if changed:
            link_mappings = self._note_path_mappings(
                [
                    (Path(entry.get("fromPath", "")), Path(entry.get("movedPath", "")))
                    for entry in moved_entries
                    if entry.get("fromPath") and entry.get("movedPath") and entry.get("fromPath") != entry.get("movedPath")
                ]
            )
            for entry in moved_entries:
                from_path = entry.get("fromPath", "")
                moved_path = entry.get("movedPath", "")
                if from_path and from_path != moved_path:
                    indexer.remove_projection_for_path(from_path)
                if moved_path:
                    moved_file = Path(moved_path)
                    indexer.reindex_markdown_file(self.vault_path, moved_file)
                    payload = task_payloads_by_source.get(from_path, None)
                    if payload:
                        self.sync_task_status_link(
                            task_id=payload["task_id"],
                            title=payload["title"],
                            status=payload["status"],
                            task_path=str(moved_file),
                            indexer=indexer,
                        )
            self._record_link_rewrite_result(self.rewrite_note_links_for_moved_paths(link_mappings, indexer))
        else:
            self._record_link_rewrite_result({"updated": 0, "paths": []})
        return moved_entries

    def delete_note_file(self, note_path: str, indexer: VaultIndexer) -> None:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        file_path = self._resolve_note_file(note_path)
        task_payload = self._task_link_payload_from_file(file_path)
        deleted_targets = [self._note_link_key(file_path)]
        _unlink_path_with_retry(file_path, missing_ok=False)
        # Media may be referenced by unsaved drafts; only explicit maintenance may collect it.
        indexer.remove_projection_for_path(str(file_path))
        if task_payload:
            self.sync_task_status_link(
                task_id=task_payload["task_id"],
                title=task_payload["title"],
                status=task_payload["status"],
                task_path="",
                indexer=indexer,
            )
        self._record_link_rewrite_result(self.rewrite_note_links_for_deleted_paths(deleted_targets, indexer))

    def add_note_media_asset(
        self,
        note_path: str,
        filename: str,
        content_type: str,
        data: bytes,
    ) -> dict[str, str]:
        note_file = self._resolve_note_file(note_path)
        payload, clean_content_type, suffix = self._validated_media_payload(
            filename=filename,
            content_type=content_type,
            data=data,
        )

        safe_note_token = self._safe_entry_name(note_file.stem) or "note"
        target_dir = self.note_media_directory(note_file)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{safe_note_token}_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}{suffix}"
        while target_path.exists():
            target_path = target_dir / f"{safe_note_token}_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}{suffix}"

        atomic_write_bytes(target_path, payload)
        vault_relative = target_path.relative_to(self.vault_path).as_posix()
        markdown_path = f"/{vault_relative}"
        return {
            "media_path": vault_relative,
            "markdown_path": markdown_path,
            "file_name": target_path.name,
        }




    def _validated_media_payload(self, *, filename: str, content_type: str, data: bytes) -> tuple[bytes, str, str]:
        payload = bytes(data)
        if not payload:
            raise ValueError("Die Bilddatei ist leer.")
        if len(payload) > VAULT_MAX_MEDIA_ASSET_BYTES:
            raise ValueError("Bilddatei ist zu groß (maximal 20 MB).")

        clean_content_type = (content_type or "").split(";", 1)[0].strip().lower()
        if clean_content_type and not clean_content_type.startswith("image/"):
            raise ValueError("Nur Bilddateien können eingefügt werden.")

        suffix = Path(filename or "").suffix.lower()
        if suffix == ".jpe":
            suffix = ".jpg"
        if suffix not in MEDIA_IMAGE_EXTENSIONS:
            mapped = MEDIA_IMAGE_CONTENT_TYPES.get(clean_content_type, "")
            if mapped:
                suffix = mapped
            else:
                guessed = mimetypes.guess_extension(clean_content_type or "") or ""
                guessed = ".jpg" if guessed == ".jpe" else guessed.lower()
                suffix = guessed if guessed in MEDIA_IMAGE_EXTENSIONS else ".png"
        return payload, clean_content_type, suffix


    def note_media_directory(self, note_file: Path) -> Path:
        try:
            relative_note = note_file.resolve().relative_to(self.vault_path.resolve())
        except ValueError:
            relative_note = Path(note_file.name)
        return self.media_root_path / relative_note.with_suffix("")








    def _collect_note_path_mappings_for_tree_move(self, source: Path, destination: Path) -> list[tuple[str, str]]:
        pairs: list[tuple[Path, Path]] = []
        if source.is_file() and source.suffix.lower() == ".md":
            pairs.append((source, destination))
        elif source.is_dir():
            for note_file in sorted(source.rglob("*.md"), key=lambda item: item.as_posix().lower()):
                if self._is_system_path(note_file.parent):
                    continue
                try:
                    relative = note_file.relative_to(source)
                except ValueError:
                    continue
                pairs.append((note_file, destination / relative))
        return self._note_path_mappings(pairs)

    def _collect_note_link_keys_for_tree(self, source: Path) -> list[str]:
        note_paths: list[Path] = []
        if source.is_file() and source.suffix.lower() == ".md":
            note_paths.append(source)
        elif source.is_dir():
            for note_file in sorted(source.rglob("*.md"), key=lambda item: item.as_posix().lower()):
                if self._is_system_path(note_file.parent):
                    continue
                note_paths.append(note_file)

        keys: list[str] = []
        seen: set[str] = set()
        for note_path in note_paths:
            try:
                key = self._note_link_key(note_path)
            except ValueError:
                continue
            lower = key.lower()
            if not key or lower in seen:
                continue
            seen.add(lower)
            keys.append(key)
        return keys

    def _note_path_mappings(self, pairs: list[tuple[Path, Path]]) -> list[tuple[str, str]]:
        mappings: list[tuple[str, str]] = []
        seen: set[str] = set()
        for old_path, new_path in pairs:
            try:
                old_key = self._note_link_key(old_path)
                new_key = self._note_link_key(new_path)
            except ValueError:
                continue
            if not old_key or not new_key or old_key.lower() == new_key.lower():
                continue
            dedupe_key = old_key.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            mappings.append((old_key, new_key))
        return mappings

    def _note_link_key(self, note_path: Path) -> str:
        relative = note_path.resolve().relative_to(self.vault_path.resolve()).as_posix()
        if relative.lower().endswith(".md"):
            relative = relative[:-3]
        return relative.strip().strip("/")

    def consume_last_link_rewrite_result(self) -> dict[str, Any]:
        result = self._last_link_rewrite_result
        self._last_link_rewrite_result = {"updated": 0, "paths": []}
        return {
            "updated": int(result.get("updated", 0) or 0),
            "paths": [str(path) for path in result.get("paths", []) if str(path).strip()],
        }

    def _record_link_rewrite_result(self, result: dict[str, Any]) -> None:
        self._last_link_rewrite_result = {
            "updated": int(result.get("updated", 0) or 0),
            "paths": [str(path) for path in result.get("paths", []) if str(path).strip()],
        }

    def _normalize_link_mappings(self, mappings: list[tuple[str, str]]) -> list[tuple[str, str]]:
        normalized: list[tuple[str, str]] = []
        seen: set[str] = set()
        for old_target, new_target in mappings:
            old_clean = self._normalize_wiki_target(old_target)
            new_clean = self._normalize_wiki_target(new_target)
            if not old_clean or not new_clean or old_clean.lower() == new_clean.lower():
                continue
            key = old_clean.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append((old_clean, new_clean))
        return normalized


    def rewrite_note_links_for_moved_paths(
        self,
        mappings: list[tuple[str, str]],
        indexer: VaultIndexer | None = None,
    ) -> dict[str, Any]:
        clean_mappings = self._normalize_link_mappings(mappings)
        if not clean_mappings:
            return {"updated": 0, "paths": []}

        mapping_by_key = {old_target.lower(): new_target for old_target, new_target in clean_mappings}
        touched: list[Path] = []
        for markdown_path in self._iter_markdown_files_for_tag_updates():
            try:
                original = markdown_path.read_text(encoding="utf-8")
                meta, body = parse_markdown_text(original)
            except OSError:
                continue

            from .markdown_syntax import transform_prose, rewrite_markdown_links
            updated_body = transform_prose(body, lambda text: self._rewrite_wikilink_targets(text, mapping_by_key))
            updated_body = rewrite_markdown_links(updated_body, markdown_path.relative_to(self.vault_path).as_posix(), dict(clean_mappings))
            updated_meta, meta_changed = self._rewrite_related_frontmatter(meta, mapping_by_key)
            if updated_body == body and not meta_changed:
                continue

            updated = dump_markdown(updated_meta, updated_body)
            try:
                atomic_write_text(markdown_path, updated, encoding='utf-8')
            except OSError:
                raise
            touched.append(markdown_path)
            if indexer is not None:
                indexer.reindex_markdown_file(self.vault_path, markdown_path)

        return {"updated": len(touched), "paths": [str(path) for path in touched]}

    def rewrite_note_links_for_deleted_paths(
        self,
        deleted_targets: list[str],
        indexer: VaultIndexer | None = None,
    ) -> dict[str, Any]:
        clean_targets = self._normalize_deleted_link_targets(deleted_targets)
        if not clean_targets:
            return {"updated": 0, "paths": []}

        deleted_by_key = {target.lower(): target for target in clean_targets}
        touched: list[Path] = []
        for markdown_path in self._iter_markdown_files_for_tag_updates():
            try:
                original = markdown_path.read_text(encoding="utf-8")
                meta, body = parse_markdown_text(original)
            except OSError:
                continue

            from .markdown_syntax import transform_prose, rewrite_markdown_links
            updated_body = transform_prose(body, lambda text: self._rewrite_deleted_wikilinks(text, deleted_by_key))
            updated_body = rewrite_markdown_links(updated_body, markdown_path.relative_to(self.vault_path).as_posix(), {}, deleted_by_key)
            updated_meta, meta_changed = self._rewrite_deleted_related_frontmatter(meta, deleted_by_key)
            if updated_body == body and not meta_changed:
                continue

            updated = dump_markdown(updated_meta, updated_body)
            try:
                atomic_write_text(markdown_path, updated, encoding='utf-8')
            except OSError:
                raise
            touched.append(markdown_path)
            if indexer is not None:
                indexer.reindex_markdown_file(self.vault_path, markdown_path)

        return {"updated": len(touched), "paths": [str(path) for path in touched]}

    def _normalize_deleted_link_targets(self, deleted_targets: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for target in deleted_targets:
            clean = self._normalize_wiki_target(target)
            if not clean:
                continue
            key = clean.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(clean)
        return normalized

    def _rewrite_deleted_related_frontmatter(
        self,
        meta: dict[str, Any],
        deleted_by_key: dict[str, str],
    ) -> tuple[dict[str, Any], bool]:
        updated = dict(meta)
        changed = False
        for key in ("related", "related_auto"):
            values = _ensure_string_list(updated.get(key, []))
            next_values: list[str] = []
            key_changed = False
            for value in values:
                clean = self._normalize_wiki_target(value)
                deleted_target = deleted_by_key.get(clean.lower())
                if deleted_target:
                    key_changed = True
                else:
                    next_values.append(value)
            if key_changed or key in updated:
                updated[key] = _dedupe_sorted(next_values)
            changed = changed or key_changed
        return updated, changed

    def _rewrite_deleted_wikilinks(self, body: str, deleted_by_key: dict[str, str]) -> str:
        updated = body
        for match in reversed(list(WIKILINK_PATTERN.finditer(body))):
            raw = match.group(1)
            replacement = self._deleted_wikilink_replacement(raw, deleted_by_key)
            if replacement is None:
                continue
            updated = f"{updated[: match.start()]}{replacement}{updated[match.end() :]}"
        return updated

    def _deleted_wikilink_replacement(self, raw: str, deleted_by_key: dict[str, str]) -> str | None:
        target_part, separator, alias = raw.partition("|")
        target_without_anchor = target_part.split("#", 1)[0]
        clean = self._normalize_wiki_target(target_without_anchor)
        deleted_target = deleted_by_key.get(clean.lower())
        if not deleted_target:
            return None
        label = alias.strip() if separator and alias.strip() else target_part.strip()
        if not label:
            label = deleted_target
        return f"~~{label}~~ *(deleted note: {deleted_target})*"

    def _rewrite_related_frontmatter(
        self,
        meta: dict[str, Any],
        mapping_by_key: dict[str, str],
    ) -> tuple[dict[str, Any], bool]:
        updated = dict(meta)
        changed = False
        for key in ("related", "related_auto"):
            values = _ensure_string_list(updated.get(key, []))
            next_values: list[str] = []
            key_changed = False
            for value in values:
                replacement = self._mapped_related_value(value, mapping_by_key)
                next_values.append(replacement)
                key_changed = key_changed or replacement != value
            if key_changed or key in updated:
                updated[key] = _dedupe_sorted(next_values)
            changed = changed or key_changed
        return updated, changed

    def _mapped_related_value(self, value: str, mapping_by_key: dict[str, str]) -> str:
        clean = self._normalize_wiki_target(value)
        replacement = mapping_by_key.get(clean.lower())
        if not replacement:
            return value
        return self._format_mapped_target(value, replacement)

    def _rewrite_wikilink_targets(self, body: str, mapping_by_key: dict[str, str]) -> str:
        updated = body
        for match in reversed(list(WIKILINK_PATTERN.finditer(body))):
            raw = match.group(1)
            replacement = self._mapped_wikilink_raw(raw, mapping_by_key)
            if replacement == raw:
                continue
            updated = f"{updated[: match.start(1)]}{replacement}{updated[match.end(1) :]}"
        return updated

    def _mapped_wikilink_raw(self, raw: str, mapping_by_key: dict[str, str]) -> str:
        target_part, separator, alias = raw.partition("|")
        target_without_anchor, anchor_separator, anchor = target_part.partition("#")
        clean = self._normalize_wiki_target(target_without_anchor)
        replacement = mapping_by_key.get(clean.lower())
        if not replacement:
            return raw
        next_target = self._format_mapped_target(target_without_anchor, replacement)
        if anchor_separator:
            next_target = f"{next_target}#{anchor}"
        if separator:
            return f"{next_target}|{alias}"
        return next_target

    def _format_mapped_target(self, original: str, replacement: str) -> str:
        stripped = original.strip()
        prefix = "/" if stripped.startswith("/") else ""
        suffix = ".md" if stripped.lower().endswith(".md") else ""
        return f"{prefix}{replacement}{suffix}"

    def _normalize_wiki_target(self, raw: str) -> str:
        target = str(raw or "").split("|", 1)[0].strip()
        target = target.split("#", 1)[0].strip().replace("\\", "/")
        target = target[:-3] if target.lower().endswith(".md") else target
        return target.strip().strip("/")

    def resolve_note_media_asset(self, note_path: str, source: str) -> tuple[Path, str]:
        note_file = self._resolve_note_file(note_path)
        asset_path = self._resolve_media_source_path(note_file, source, allow_missing=False)
        mime_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
        return asset_path, mime_type

    def _resolve_media_source_path(self, note_file: Path, source: str, allow_missing: bool) -> Path:
        clean_source = _extract_markdown_link_target(source)
        if not clean_source:
            raise ValueError("Leere Bildreferenz.")

        lowered = clean_source.lower()
        if lowered.startswith(("http://", "https://", "data:", "mailto:", "file://")):
            raise ValueError("Externe Bildreferenzen werden hier nicht verwaltet.")

        if clean_source.startswith("/"):
            resolved = (self.vault_path / clean_source.lstrip("/")).resolve()
        else:
            resolved = (note_file.parent / clean_source).resolve()
            if not self._is_inside_media_root(resolved):
                normalized = clean_source.replace("\\", "/")
                if normalized.startswith("./"):
                    normalized = normalized[2:]
                if normalized.startswith(".media/"):
                    resolved = (self.vault_path / normalized).resolve()

        try:
            resolved.relative_to(self.vault_path.resolve())
        except ValueError as exc:
            raise ValueError("Ungültige Bildreferenz.") from exc

        if not self._is_inside_media_root(resolved):
            raise ValueError("Bildreferenzen müssen auf .media zeigen.")

        if not allow_missing and (not resolved.exists() or not resolved.is_file()):
            raise ValueError(f"Bilddatei nicht gefunden: {clean_source}")

        return resolved

    def _is_inside_media_root(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.media_root_path.resolve())
            return True
        except ValueError:
            return False

    def normalize_note_markdown_text(
        self,
        text: str,
        path: Path,
        force_title: str = "",
        touch_updated: bool = True,
        previous_status: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        frontmatter, raw_body = parse_markdown_text(text)
        nested_frontmatter, nested_body = parse_markdown_text(raw_body.lstrip("\ufeff"))
        if nested_frontmatter:
            outer_title = str(frontmatter.get("title", "")).strip()
            outer_type = _normalize_note_type(str(frontmatter.get("type", "note")))
            nested_type = _normalize_note_type(str(nested_frontmatter.get("type", "note")))
            if _looks_like_corrupt_title(outer_title) or (outer_type == "note" and nested_type != outer_type):
                frontmatter = dict(nested_frontmatter)
                raw_body = nested_body

        now_iso = datetime.now().astimezone().isoformat(timespec="seconds")

        try:
            stat = path.stat()
            fallback_created = datetime.fromtimestamp(stat.st_ctime).isoformat(timespec="seconds")
            fallback_updated = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
        except OSError:
            fallback_created = now_iso
            fallback_updated = now_iso

        note_type = _normalize_note_type(str(frontmatter.get("type", "note")))
        detected_title = _extract_title_from_body(raw_body)
        raw_frontmatter_title = str(frontmatter.get("title", ""))
        title = _normalize_label(force_title) or _normalize_label(raw_frontmatter_title)
        if not title:
            title = "Untitled" if "title" in frontmatter and not raw_frontmatter_title.strip() else detected_title or self._label_from_group_dir(path.stem)
        body = _strip_matching_title_heading(raw_body, title)

        manual_tags: list[str] = []
        for raw_tag in _ensure_string_list(frontmatter.get("tags", [])):
            normalized = _normalize_tag_key(raw_tag)
            if normalized:
                manual_tags.append(normalized)
                continue
            slug = slugify(raw_tag.lstrip("#"))
            if slug:
                manual_tags.append(f"topic:{slug}")
        manual_tags = _dedupe_sorted(manual_tags)

        manual_related: list[str] = []
        for raw_related in _ensure_string_list(frontmatter.get("related", [])):
            clean = raw_related.replace("\\", "/").strip()
            clean = clean[:-3] if clean.lower().endswith(".md") else clean
            if clean:
                manual_related.append(clean)
        manual_related = _dedupe_sorted(manual_related)

        auto_tags = _extract_auto_tags(body)
        auto_related = _extract_related_links(body)

        note_id = str(frontmatter.get("id", "")).strip()
        if not note_id:
            note_id = make_task_id() if note_type == "task" else make_note_id()
        node_id = str(frontmatter.get("node_id", "")).strip() or note_id

        created_at = str(frontmatter.get("created_at", "")).strip() or fallback_created
        previous_updated = str(frontmatter.get("updated_at", "")).strip() or fallback_updated
        updated_at = now_iso if touch_updated else previous_updated
        status = _normalize_task_status(str(frontmatter.get("status", "open")))
        priority = _normalize_task_priority(str(frontmatter.get("priority", "medium")))
        due_date = _normalize_due_date(str(frontmatter.get("due_date", "")))
        estimate_minutes = _normalize_estimate_minutes(frontmatter.get("estimate_minutes"))
        task_self_id = note_id if note_type == "task" else ""
        blocked_by_ids = _normalize_blocked_by_ids(frontmatter.get("blocked_by_ids"), exclude_id=task_self_id)
        waiting_for = _normalize_optional_text(frontmatter.get("waiting_for"))
        follow_up_date = _normalize_due_date(str(frontmatter.get("follow_up_date", "")))
        blocked_reason = _normalize_optional_text(frontmatter.get("blocked_reason"))
        next_action_hint = _normalize_optional_text(frontmatter.get("next_action_hint"))
        raw_completed_at = _normalize_iso_timestamp(frontmatter.get("completed_at"))
        if status == "done":
            completed_at = raw_completed_at or (now_iso if touch_updated and previous_status != "done" else "")
        else:
            completed_at = ""

        known_keys = {
            "id",
            "node_id",
            "title",
            "type",
            "status",
            "priority",
            "due_date",
            "created_at",
            "updated_at",
            "completed_at",
            "tags",
            "tags_auto",
            "related",
            "related_auto",
            "estimate_minutes",
            "blocked_by_ids",
            "waiting_for",
            "follow_up_date",
            "blocked_reason",
            "next_action_hint",
        }
        extra: dict[str, Any] = {}
        for key, value in frontmatter.items():
            if key in known_keys:
                continue
            extra[key] = value

        normalized = self._build_note_document(
            body=body,
            title=title,
            note_type=note_type,
            note_id=note_id,
            node_id=node_id,
            created_at=created_at,
            updated_at=updated_at,
            status=status,
            priority=priority,
            due_date=due_date,
            estimate_minutes=estimate_minutes,
            completed_at=completed_at,
            blocked_by_ids=blocked_by_ids,
            waiting_for=waiting_for,
            follow_up_date=follow_up_date,
            blocked_reason=blocked_reason,
            next_action_hint=next_action_hint,
            manual_tags=manual_tags,
            manual_related=manual_related,
            auto_tags=auto_tags,
            auto_related=auto_related,
            extra=extra,
        )
        meta = {
            "id": note_id,
            "node_id": node_id,
            "title": title,
            "type": note_type,
            "status": status,
            "priority": priority,
            "due_date": due_date,
            "estimate_minutes": estimate_minutes,
            "completed_at": completed_at,
            "blocked_by_ids": blocked_by_ids,
            "waiting_for": waiting_for,
            "follow_up_date": follow_up_date,
            "blocked_reason": blocked_reason,
            "next_action_hint": next_action_hint,
            "created_at": created_at,
            "updated_at": updated_at,
            "tags": manual_tags,
            "tags_auto": auto_tags,
            "related": manual_related,
            "related_auto": auto_related,
        }
        return normalized, meta

    def normalize_note_file(
        self,
        note_path: Path,
        touch_updated: bool = True,
        rename_by_title: bool = False,
        force_title: str = "",
        previous_status: str | None = None,
    ) -> tuple[Path, dict[str, Any], bool]:
        original = note_path.read_text(encoding="utf-8")
        if previous_status is None:
            previous_status=str(parse_markdown_text(original)[0].get('status','open'))
        normalized, meta = self.normalize_note_markdown_text(
            text=original,
            path=note_path,
            force_title=force_title,
            touch_updated=touch_updated,
            previous_status=previous_status,
        )
        changed = normalized != original
        if changed:
            atomic_write_text(note_path, normalized, encoding='utf-8')

        destination = note_path
        if rename_by_title:
            safe_stem = self._safe_entry_name(meta.get("title", "")) or note_path.stem
            preferred = note_path.with_name(f"{safe_stem}{note_path.suffix or '.md'}")
            destination = self._next_available_note_path(note_path.parent, safe_stem, preferred_current=note_path)
            if destination != note_path:
                _rename_path_with_retry(note_path, destination)
                changed = True
            if destination.stem.lower() != safe_stem.lower():
                resolved_title = self._label_from_group_dir(destination.stem)
                current = destination.read_text(encoding="utf-8")
                resolved_text, resolved_meta = self.normalize_note_markdown_text(
                    text=current,
                    path=destination,
                    force_title=resolved_title,
                    touch_updated=False,
                )
                meta = resolved_meta
                if resolved_text != current:
                    atomic_write_text(destination, resolved_text, encoding='utf-8')
                    changed = True

        return destination, meta, changed

    def save_note_document(self, note_path: str, content: str, indexer: VaultIndexer) -> dict[str, Any]:
        self._record_link_rewrite_result({"updated": 0, "paths": []})
        file_path = self._resolve_note_file_for_save(note_path, content)
        raw_meta, _raw_body = parse_markdown(file_path)
        raw_type = str(raw_meta.get("type", "")).strip().lower()
        is_tag_overview_file = file_path.name.lower() == "overview.md" and self._is_tag_path(file_path.parent)
        if raw_type == "tag_index" or is_tag_overview_file:
            raise ValueError("Tag-Overview-Notizen sind schreibgeschützt und werden automatisch erzeugt.")

        previous_path = str(file_path)
        previous_content = file_path.read_text(encoding="utf-8")
        _previous_normalized, previous_meta = self.normalize_note_markdown_text(
            text=previous_content,
            path=file_path,
            touch_updated=False,
        )

        from .todos import synchronize_todo_history
        incoming, next_body=parse_markdown_text(content)
        incoming['id']=str(incoming.get('id') or previous_meta['id'])
        incoming['node_id']=str(incoming.get('node_id') or incoming['id'])
        if _normalize_note_type(str(incoming.get('type','note'))) != 'task':
            row=indexer.conn.execute('SELECT id FROM notes WHERE path=?',(str(file_path),)).fetchone()
            old_anchor=str(raw_meta.get('id') or (row['id'] if row else incoming['id']))
            next_body=synchronize_todo_history(_raw_body,next_body,old_anchor,incoming['id'])
        content=dump_markdown(incoming,next_body)
        atomic_write_text(file_path, content, encoding='utf-8')
        final_path, meta, _changed = self.normalize_note_file(
            note_path=file_path,
            touch_updated=True,
            rename_by_title=True,
            previous_status=str(previous_meta.get("status","open")),
        )
        if final_path.resolve() != file_path.resolve():
            self._record_link_rewrite_result(
                self.rewrite_note_links_for_moved_paths(self._note_path_mappings([(file_path, final_path)]), indexer)
            )
        # Media may be referenced by unsaved drafts; only explicit maintenance may collect it.

        indexer.remove_projection_for_path(previous_path)
        indexer.reindex_markdown_file(self.vault_path, final_path)

        previous_tags = sorted(_ensure_string_list(previous_meta.get("tags", [])))
        next_tags = sorted(_ensure_string_list(meta.get("tags", [])))
        previous_auto_tags = sorted(_ensure_string_list(previous_meta.get("tags_auto", [])))
        next_auto_tags = sorted(_ensure_string_list(meta.get("tags_auto", [])))
        previous_type = _normalize_note_type(str(previous_meta.get("type", "note")))
        next_type = _normalize_note_type(str(meta.get("type", "note")))
        previous_status = _normalize_task_status(str(previous_meta.get("status", "open")))
        next_status = _normalize_task_status(str(meta.get("status", "open")))
        title_changed = _normalize_label(str(previous_meta.get("title", ""))) != _normalize_label(str(meta.get("title", "")))
        path_changed = str(final_path) != previous_path
        type_changed = previous_type != next_type
        tags_changed = previous_tags != next_tags or previous_auto_tags != next_auto_tags
        task_state_changed = previous_status != next_status
        tag_rebuild_required = path_changed or title_changed or type_changed or tags_changed or task_state_changed

        previous_task_payload = self._task_link_payload_from_meta(Path(previous_path), previous_meta)
        next_task_payload = self._task_link_payload_from_meta(final_path, meta)
        previous_task_id = previous_task_payload["task_id"] if previous_task_payload else ""
        next_task_id = next_task_payload["task_id"] if next_task_payload else ""
        if previous_task_payload and (not next_task_payload or previous_task_id != next_task_id):
            self.sync_task_status_link(
                task_id=previous_task_id,
                title=previous_task_payload["title"],
                status=previous_task_payload["status"],
                task_path="",
                indexer=indexer,
            )
        if next_task_payload:
            self.sync_task_status_link(
                task_id=next_task_payload["task_id"],
                title=next_task_payload["title"],
                status=next_task_payload["status"],
                task_path=str(final_path),
                indexer=indexer,
            )

        return {
            "path": final_path,
            "title": str(meta.get("title", final_path.stem)),
            "meta": meta,
            "tag_rebuild_required": tag_rebuild_required,
        }

    def _task_link_payload_from_meta(self, note_path: Path, meta: dict[str, Any]) -> dict[str, str] | None:
        note_type = _normalize_note_type(str(meta.get("type", "note")))
        if note_type != "task":
            return None
        task_id = str(meta.get("id", "")).strip() or str(meta.get("node_id", "")).strip() or note_path.stem
        if not task_id:
            return None
        title = _normalize_label(str(meta.get("title", "")).strip()) or note_path.stem or task_id
        status = str(meta.get("status", "open")).strip() or "open"
        return {
            "task_id": task_id,
            "title": title,
            "status": status,
        }

    def _task_link_payload_from_file(self, note_path: Path) -> dict[str, str] | None:
        try:
            meta, _body = parse_markdown(note_path)
        except OSError:
            return None
        return self._task_link_payload_from_meta(note_path, meta)

    def _is_task_link_note_for_task(self, file_path: Path, task_id: str) -> bool:
        if not file_path.exists() or not file_path.is_file():
            return False
        try:
            meta, _body = parse_markdown(file_path)
        except OSError:
            return False
        note_type = str(meta.get("type", "")).strip().lower().replace("-", "_")
        if note_type != TASK_LINK_NOTE_TYPE:
            return False
        linked_task_id = str(meta.get("task_id", "")).strip()
        return linked_task_id == task_id

    def _remove_task_status_link_file(self, file_path: Path, indexer: VaultIndexer) -> None:
        try:
            if file_path.exists() and file_path.is_file():
                _unlink_path_with_retry(file_path, missing_ok=True)
        except OSError:
            pass
        indexer.remove_projection_for_path(str(file_path))

    def sync_task_status_link(
        self,
        *,
        task_id: str,
        title: str,
        status: str,
        task_path: str,
        indexer: VaultIndexer,
        index_mapping: dict[str, str] | None = None,
        persist_index: bool = True,
    ) -> None:
        clean_task_id = str(task_id or "").strip()
        if not clean_task_id:
            return

        links = index_mapping if index_mapping is not None else self._read_task_status_link_index()
        previous_relative = str(links.get(clean_task_id, "")).replace("\\", "/").strip().strip("/")
        previous_path = (self.vault_path / previous_relative).resolve() if previous_relative else None

        clean_target = str(task_path or "").strip()
        if not clean_target:
            if previous_path is not None:
                self._remove_task_status_link_file(previous_path, indexer)
            links.pop(clean_task_id, None)
            if persist_index and index_mapping is None:
                self._write_task_status_link_index(links)
            return

        try:
            target_file = Path(clean_target).expanduser().resolve()
        except OSError:
            target_file = Path(clean_target)
        if not target_file.exists() or not target_file.is_file():
            if previous_path is not None:
                self._remove_task_status_link_file(previous_path, indexer)
            links.pop(clean_task_id, None)
            if persist_index and index_mapping is None:
                self._write_task_status_link_index(links)
            return

        self._ensure_task_status_folders()
        status_token = _task_status_folder_token(status)
        status_dir = self.tasks_root_path / status_token
        status_dir.mkdir(parents=True, exist_ok=True)

        # If the task itself already lives in the matching status folder, no link file is needed.
        if self._is_same_or_descendant(status_dir, target_file):
            if previous_path is not None:
                self._remove_task_status_link_file(previous_path, indexer)
            links.pop(clean_task_id, None)
            if persist_index and index_mapping is None:
                self._write_task_status_link_index(links)
            return

        candidate: Path | None = None
        if previous_path is not None and previous_path.parent == status_dir and self._is_task_link_note_for_task(previous_path, clean_task_id):
            candidate = previous_path
        else:
            base_token = _task_link_token(clean_task_id or title or target_file.stem)
            candidate = status_dir / f"{base_token}.md"
            suffix = 2
            while candidate.exists() and not self._is_task_link_note_for_task(candidate, clean_task_id):
                candidate = status_dir / f"{base_token}_{suffix}.md"
                suffix += 1

        now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
        created_at = now_iso
        if candidate.exists():
            try:
                existing_meta, _existing_body = parse_markdown(candidate)
                existing_created = str(existing_meta.get("created_at", "")).strip()
                if existing_created:
                    created_at = existing_created
            except OSError:
                pass

        safe_title = _normalize_label(title) or target_file.stem or clean_task_id
        try:
            target_relative = target_file.resolve().relative_to(self.vault_path.resolve()).as_posix()
        except ValueError:
            target_relative = target_file.as_posix()
        target_posix = target_file.as_posix()
        frontmatter = {
            "id": f"task_link_{clean_task_id}",
            "node_id": f"task_link_{clean_task_id}",
            "type": TASK_LINK_NOTE_TYPE,
            "title": safe_title,
            "task_id": clean_task_id,
            "task_status": status_token,
            "task_path": target_posix,
            "task_path_relative": target_relative,
            "created_at": created_at,
            "updated_at": now_iso,
            "tags": [],
            "tags_auto": [],
        }
        body = (
            f"# {safe_title}\n\n"
            f"- Original Task: [{safe_title}]({target_posix})\n"
            f"- Status: `{status_token}`\n"
        )
        atomic_write_text(candidate, dump_markdown(frontmatter, body), encoding='utf-8')
        indexer.reindex_markdown_file(self.vault_path, candidate)

        if previous_path is not None and previous_path != candidate:
            self._remove_task_status_link_file(previous_path, indexer)

        links[clean_task_id] = candidate.resolve().relative_to(self.vault_path.resolve()).as_posix()
        if persist_index and index_mapping is None:
            self._write_task_status_link_index(links)

    def bootstrap_task_status_links(self, indexer: VaultIndexer) -> None:
        self._ensure_task_status_folders()
        if self.task_status_links_path.exists():
            existing = self._read_task_status_link_index()
            if existing:
                return
            if indexer.list_tasks(include_done=True):
                self.rebuild_task_status_links(indexer)
            else:
                self._write_task_status_link_index({})
            return

        links: dict[str, str] = {}
        for row in indexer.list_tasks(include_done=True):
            task_id = str(row.get("id", "")).strip()
            if not task_id:
                continue
            title = _normalize_label(str(row.get("title", "")).strip()) or task_id
            status = str(row.get("status", "open")).strip() or "open"
            task_path = str(row.get("path", "")).strip()
            self.sync_task_status_link(
                task_id=task_id,
                title=title,
                status=status,
                task_path=task_path,
                indexer=indexer,
                index_mapping=links,
                persist_index=False,
            )
        self._write_task_status_link_index(links)

    def rebuild_task_status_links(self, indexer: VaultIndexer) -> None:
        self._ensure_task_status_folders()
        links = self._read_task_status_link_index()
        seen_task_ids: set[str] = set()
        for row in indexer.list_tasks(include_done=True):
            task_id = str(row.get("id", "")).strip()
            if not task_id:
                continue
            seen_task_ids.add(task_id)
            title = _normalize_label(str(row.get("title", "")).strip()) or task_id
            status = str(row.get("status", "open")).strip() or "open"
            task_path = str(row.get("path", "")).strip()
            self.sync_task_status_link(
                task_id=task_id,
                title=title,
                status=status,
                task_path=task_path,
                indexer=indexer,
                index_mapping=links,
                persist_index=False,
            )

        for task_id in list(links.keys()):
            if task_id in seen_task_ids:
                continue
            stale_relative = str(links.get(task_id, "")).replace("\\", "/").strip().strip("/")
            if stale_relative:
                stale_path = (self.vault_path / stale_relative).resolve()
                self._remove_task_status_link_file(stale_path, indexer)
            links.pop(task_id, None)

        self._write_task_status_link_index(links)

    def toggle_todo(self, todo_id: str, indexer: VaultIndexer, checked: bool | None = None) -> dict[str, Any]:
        todo = indexer.get_todo(todo_id)
        if not todo:
            raise ValueError("Todo not found")

        note_file = self._resolve_note_file(str(todo.get("note_path", "")))
        meta, body = parse_markdown(note_file)
        note_anchor = str(meta.get("id", "")).strip() or str(todo.get("note_id", "")).strip() or note_file.as_posix()
        inherited_tags = self._todo_inherited_tags_from_meta(meta)
        next_body, updated = toggle_todo_checkbox(
            body=body,
            note_anchor=note_anchor,
            todo_id=todo_id,
            checked=checked,
            inherited_tags=inherited_tags,
        )
        if updated is None:
            raise ValueError("Todo entry could not be resolved in source note.")

        if next_body != body:
            meta["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
            atomic_write_text(note_file, dump_markdown(meta, next_body), encoding='utf-8')

        indexer.reindex_markdown_file(self.vault_path, note_file)
        refreshed = indexer.get_todo(todo_id)
        return {
            "todo": refreshed,
            "notePath": str(note_file),
        }

    def promote_todo_to_task(self, todo_id: str, indexer: VaultIndexer, due_date: str | None = None) -> dict[str, Any]:
        todo = indexer.get_todo(todo_id)
        if not todo:
            raise ValueError("Todo not found")

        existing_task_id = str(todo.get("promoted_task_id", "")).strip()
        if bool(todo.get("promoted")) and existing_task_id:
            existing_task = next((item for item in indexer.list_tasks(include_done=True) if item.get("id") == existing_task_id), None)
            if existing_task:
                return {
                    "todo": todo,
                    "taskId": existing_task_id,
                    "taskPath": existing_task.get("path"),
                    "created": False,
                }

        note_file = self._resolve_note_file(str(todo.get("note_path", "")))
        meta, body = parse_markdown(note_file)
        note_anchor = str(meta.get("id", "")).strip() or str(todo.get("note_id", "")).strip() or note_file.as_posix()
        now = datetime.now()
        task_id = make_task_id(now)

        inherited_tags = self._todo_inherited_tags_from_meta(meta)
        next_body, updated = mark_todo_promoted(
            body=body,
            note_anchor=note_anchor,
            todo_id=todo_id,
            task_id=task_id,
            inherited_tags=inherited_tags,
        )
        if updated is None:
            raise ValueError("Todo entry could not be resolved in source note.")

        explicit_tags = [item.strip() for item in updated.explicit_tags if item and item.strip()]
        inherited = [item.strip() for item in updated.inherited_tags if item and item.strip()]
        merged_tags = sorted({*explicit_tags, *inherited}, key=lambda item: item.lower())
        project_tag = None
        for key in merged_tags:
            if key.lower().startswith("project:"):
                project_tag = key.split(":", 1)[1]
                break

        title = updated.raw_text
        if due_date:
            title = " ".join(DUE_TOKEN_PATTERN.sub(" ", title).split()) or title
        parsed_task = ParsedTask(
            title=title,
            due_date=due_date,
            priority="M",
            status="open",
            project_tag=project_tag,
            tags=merged_tags,
        )

        task_path = self._create_task_file(
            task_id=task_id,
            note_id=note_anchor,
            task=parsed_task,
            now=now,
            indexer=indexer,
            manual_related=list(updated.links),
            extra_frontmatter={
                "origin_todo_id": updated.id,
                "origin_note_id": note_anchor,
                "origin_note_path": str(note_file),
                "origin_line_no": updated.line_no,
            },
            body=updated.raw_text,
        )

        try:
            meta["updated_at"] = now.astimezone().isoformat(timespec="seconds")
            atomic_write_text(note_file, dump_markdown(meta, next_body), encoding='utf-8')
        except OSError as exc:
            try:
                _unlink_path_with_retry(task_path, missing_ok=True)
            except OSError:
                pass
            indexer.remove_projection_for_path(str(task_path))
            raise ValueError(f"Could not update source todo after task creation: {exc}") from exc

        indexer.reindex_markdown_file(self.vault_path, note_file)
        refreshed = indexer.get_todo(todo_id)
        return {
            "todo": refreshed,
            "taskId": task_id,
            "taskPath": str(task_path),
            "created": True,
        }

    def add_favorite_folder(self, group_key: str) -> list[str]:
        folder = self._resolve_group_path(group_key)
        relative = self._to_group_key(folder)
        if not relative or self._is_system_name(relative.split("/")[0]):
            raise ValueError("Folder cannot be added to favorites")

        favorites = set(self._read_favorite_folders())
        favorites.add(relative)
        self._write_favorite_folders(sorted(favorites, key=lambda item: item.lower()))
        return self._read_favorite_folders()

    def remove_favorite_folder(self, group_key: str) -> list[str]:
        relative = group_key.replace("\\", "/").strip().strip("/")
        if not relative:
            return self._read_favorite_folders()
        if self._is_protected_root(relative):
            raise ValueError("Die Basisordner daily, tags und tasks sind immer fixiert.")
        favorites = [item for item in self._read_favorite_folders() if item != relative]
        self._write_favorite_folders(favorites)
        return self._read_favorite_folders()

    def read_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

    def read_ui_settings(self) -> dict[str, Any]:
        default_payload: dict[str, Any] = {
            "updated_at": "",
            "app": {},
            "explorer": {},
        }
        if not self.ui_settings_path.exists():
            return default_payload

        try:
            payload = json.loads(self.ui_settings_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return default_payload

        if not isinstance(payload, dict):
            return default_payload

        app_settings = payload.get("app")
        explorer_settings = payload.get("explorer")
        updated_at = payload.get("updated_at")

        return {
            "updated_at": updated_at if isinstance(updated_at, str) else "",
            "app": self._normalize_ui_app_settings(app_settings if isinstance(app_settings, dict) else {}),
            "explorer": explorer_settings if isinstance(explorer_settings, dict) else {},
        }

    def _normalize_ui_app_settings(self, app_settings: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(app_settings)
        # Only the two built-in themes exist; settings written by the former theme editor are dropped.
        for retired in ("themes", "colorProfiles", "activeThemeId", "activeColorProfileId"):
            normalized.pop(retired, None)
        if normalized.get("theme") not in {"light", "dark"}:
            normalized.pop("theme", None)
        return normalized

    def update_ui_settings(
        self,
        app_settings: dict[str, Any] | None = None,
        explorer_settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = self.read_ui_settings()
        current_app = current.get("app")
        current_explorer = current.get("explorer")
        next_app = dict(current_app) if isinstance(current_app, dict) else {}
        next_explorer = dict(current_explorer) if isinstance(current_explorer, dict) else {}

        if app_settings is not None:
            if isinstance(app_settings, dict):
                next_app.update(app_settings)
                next_app = self._normalize_ui_app_settings(next_app)
            else:
                next_app = {}

        if explorer_settings is not None:
            if isinstance(explorer_settings, dict):
                next_explorer = dict(explorer_settings)
            else:
                next_explorer = {}

        payload = {
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "app": next_app,
            "explorer": next_explorer,
        }
        atomic_write_text(self.ui_settings_path, json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
        return payload

    def read_tag_groups(self) -> list[dict[str, Any]]:
        if not self.tag_groups_path.exists():
            return []
        payload = json.loads(self.tag_groups_path.read_text(encoding="utf-8"))
        groups = payload.get("groups", payload.get("tagGroups", [])) if isinstance(payload, dict) else payload
        return self._normalize_tag_groups(groups)

    def sync_tag_groups_with_index(self, indexer: VaultIndexer) -> list[dict[str, Any]]:
        groups = self.read_tag_groups()
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def add_tag_group(self, group_id: str, display_name: str, color: str, indexer: VaultIndexer) -> list[dict[str, Any]]:
        groups = self.read_tag_groups()
        clean_group_id = _normalize_tag_id(group_id)
        if not clean_group_id:
            return groups

        existing = self._resolve_group_entry(groups, clean_group_id)
        if existing is None:
            groups.append(
                {
                    "id": clean_group_id,
                    "displayName": _normalize_label(display_name) or clean_group_id,
                    "color": _normalize_tag_color(color),
                    "tags": [],
                }
            )
            groups = self._normalize_tag_groups(groups)

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def add_tag_to_group(
        self,
        group_id: str,
        tag_id: str,
        display_name: str,
        indexer: VaultIndexer,
    ) -> list[dict[str, Any]]:
        groups = self.read_tag_groups()
        clean_group_id = _normalize_tag_id(group_id)
        clean_tag_id = _normalize_tag_id(tag_id)
        if not clean_group_id or not clean_tag_id:
            return groups

        target_group = self._resolve_group_entry(groups, clean_group_id)
        if target_group is None:
            target_group = {
                "id": clean_group_id,
                "displayName": clean_group_id,
                "color": TAG_GROUP_DEFAULT_COLOR,
                "tags": [],
            }
            groups.append(target_group)

        target_tag = self._resolve_tag_entry(target_group, clean_tag_id)
        if target_tag is None:
            target_group.setdefault("tags", []).append(
                {
                    "id": clean_tag_id,
                    "displayName": _normalize_label(display_name) or clean_tag_id,
                }
            )
            target_group["tags"] = self._sorted_tag_entries(target_group.get("tags", []))

        groups = self._normalize_tag_groups(groups)
        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def rename_tag_group(
        self,
        group_id: str,
        new_group_id: str,
        new_display_name: str,
        new_color: str,
        apply_to_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[list[dict[str, Any]], int]:
        groups = self.read_tag_groups()
        source_group = self._resolve_group_entry(groups, group_id)
        if source_group is None:
            raise ValueError(f"Tag group not found: {group_id}")

        next_group_id = _normalize_tag_id(new_group_id)
        if not next_group_id:
            raise ValueError("New group id cannot be empty")

        duplicate_group = self._resolve_group_entry(groups, next_group_id)
        if duplicate_group is not None and duplicate_group is not source_group:
            raise ValueError(f"Tag group already exists: {next_group_id}")

        old_group_id = str(source_group.get("id", "")).strip()
        id_changed = old_group_id.lower() != next_group_id.lower()

        source_group["id"] = next_group_id
        source_group["displayName"] = _normalize_label(new_display_name) or next_group_id
        source_group["color"] = _normalize_tag_color(new_color)

        touched = 0
        if id_changed and apply_to_notes:
            for tag in source_group.get("tags", []):
                tag_id = str(tag.get("id", "")).strip()
                if not tag_id:
                    continue
                touched += self._rewrite_tag_references(
                    old_key=self._to_tag_key(old_group_id, tag_id),
                    new_key=self._to_tag_key(next_group_id, tag_id),
                    remove=False,
                )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        groups = self._normalize_tag_groups(groups)
        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def delete_tag_group(
        self,
        group_id: str,
        remove_from_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[list[dict[str, Any]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_entry(groups, group_id)
        if target_group is None:
            raise ValueError(f"Tag group not found: {group_id}")

        target_group_id = str(target_group.get("id", "")).strip()
        target_tags = [str(tag.get("id", "")).strip() for tag in target_group.get("tags", [])]
        groups = [group for group in groups if group is not target_group]

        touched = 0
        if remove_from_notes:
            for tag_id in target_tags:
                if not tag_id:
                    continue
                touched += self._rewrite_tag_references(
                    old_key=self._to_tag_key(target_group_id, tag_id),
                    new_key="",
                    remove=True,
                )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        groups = self._normalize_tag_groups(groups)
        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def rename_tag(
        self,
        group_id: str,
        tag_id: str,
        new_tag_id: str,
        new_display_name: str,
        apply_to_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[list[dict[str, Any]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_entry(groups, group_id)
        if target_group is None:
            raise ValueError(f"Tag group not found: {group_id}")

        source_tag = self._resolve_tag_entry(target_group, tag_id)
        if source_tag is None:
            raise ValueError(f"Tag not found: {group_id}:{tag_id}")

        next_tag_id = _normalize_tag_id(new_tag_id)
        if not next_tag_id:
            raise ValueError("New tag id cannot be empty")

        duplicate_tag = self._resolve_tag_entry(target_group, next_tag_id)
        if duplicate_tag is not None and duplicate_tag is not source_tag:
            raise ValueError(f"Tag already exists: {group_id}:{next_tag_id}")

        old_group_id = str(target_group.get("id", "")).strip()
        old_tag_id = str(source_tag.get("id", "")).strip()
        id_changed = old_tag_id.lower() != next_tag_id.lower()

        source_tag["id"] = next_tag_id
        source_tag["displayName"] = _normalize_label(new_display_name) or next_tag_id
        target_group["tags"] = self._sorted_tag_entries(target_group.get("tags", []))

        touched = 0
        if id_changed and apply_to_notes:
            touched = self._rewrite_tag_references(
                old_key=self._to_tag_key(old_group_id, old_tag_id),
                new_key=self._to_tag_key(old_group_id, next_tag_id),
                remove=False,
            )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        groups = self._normalize_tag_groups(groups)
        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def delete_tag(
        self,
        group_id: str,
        tag_id: str,
        remove_from_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[list[dict[str, Any]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_entry(groups, group_id)
        if target_group is None:
            raise ValueError(f"Tag group not found: {group_id}")

        target_tag = self._resolve_tag_entry(target_group, tag_id)
        if target_tag is None:
            raise ValueError(f"Tag not found: {group_id}:{tag_id}")

        target_group_id = str(target_group.get("id", "")).strip()
        target_tag_id = str(target_tag.get("id", "")).strip()
        target_group["tags"] = [
            tag for tag in target_group.get("tags", []) if str(tag.get("id", "")).strip().lower() != target_tag_id.lower()
        ]

        touched = 0
        if remove_from_notes:
            touched = self._rewrite_tag_references(
                old_key=self._to_tag_key(target_group_id, target_tag_id),
                new_key="",
                remove=True,
            )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        groups = self._normalize_tag_groups(groups)
        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def save_capture(
        self,
        text: str,
        selected_tags: list[TagSuggestion],
        indexer: VaultIndexer,
    ) -> dict[str, Any]:
        now = datetime.now()
        created_at = now.astimezone().isoformat(timespec="seconds")
        day = f"{now:%Y-%m-%d}"
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Capture text is empty")
        capture_text, dated_lines = _normalize_capture_dates(_apply_capture_tag_replacements(clean_text, selected_tags))

        note_path = self._ensure_daily_note(day, created_at)
        meta, body = parse_markdown(note_path)
        if not str(meta.get("id", "")).strip():
            meta["id"] = f"daily_{day}"
        if not str(meta.get("type", "")).strip():
            meta["type"] = "daily"
        if not str(meta.get("created_at", "")).strip():
            meta["created_at"] = f"{day}T00:00:00"
        meta["tags"] = _ensure_string_list(meta.get("tags", []))
        meta["updated_at"] = created_at

        block_lines = [f"**Quick Capture** {now:%H:%M}", "", capture_text]
        block = "\n".join(block_lines).strip()

        next_body = body.rstrip()
        if next_body:
            next_body = f"{next_body}\n\n{block}\n"
        else:
            next_body = f"{block}\n"
        atomic_write_text(note_path, dump_markdown(meta, next_body), encoding='utf-8')
        indexer.reindex_markdown_file(self.vault_path, note_path)

        # A plain line with a date ("Angebot schicken @2026-11-20") becomes a task due that day and stays
        # ordinary text in the daily note; a to-do with a date stays a to-do and creates no task.
        tasks = []
        note_anchor = str(meta.get("id", f"daily_{day}"))
        for title, due_date in dated_lines:
            task_id = make_task_id(now)
            task_path = self._create_task_file(
                task_id=task_id,
                note_id=note_anchor,
                task=ParsedTask(title=title, due_date=due_date, priority="M", status="open", project_tag=None, tags=[]),
                now=now,
                indexer=indexer,
                extra_frontmatter={"origin_note_id": note_anchor, "origin_note_path": str(note_path)},
                body=title,
            )
            tasks.append({"taskId": task_id, "taskPath": str(task_path), "dueDate": due_date})

        groups = self.read_tag_groups()
        self.rebuild_all_tag_pages(groups, indexer)

        return {
            "note_id": str(meta.get("id", f"daily_{day}")),
            "date": day,
            "note_path": note_path,
            "tasks": tasks,
        }

    def get_daily_mit(self, day_iso: str | None = None) -> dict[str, Any]:
        day = _normalize_daily_day(day_iso)
        daily_path = self._daily_note_path(day)
        if not daily_path.exists():
            return {
                "date": day,
                "note_path": daily_path,
                "mit_ids": [],
            }

        meta, _body = parse_markdown(daily_path)
        return {
            "date": day,
            "note_path": daily_path,
            "mit_ids": _normalize_mit_ids(meta.get("mit", [])),
        }

    def ensure_daily_note(self, day_iso: str | None, indexer: VaultIndexer) -> dict[str, Any]:
        day = _normalize_daily_day(day_iso)
        now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
        daily_path = self._daily_note_path(day)
        existed = daily_path.exists()
        daily_path = self._ensure_daily_note(day, now_iso)
        if not existed:
            indexer.reindex_markdown_file(self.vault_path, daily_path)

        title = day
        try:
            meta, _body = parse_markdown(daily_path)
            parsed_title = str(meta.get("title", "")).strip()
            if parsed_title:
                title = parsed_title
        except Exception:
            # If parsing fails for any reason, still return a stable fallback title.
            pass

        return {
            "date": day,
            "note_path": daily_path,
            "title": title,
            "created": not existed,
        }

    def set_daily_mit(self, day_iso: str | None, mit_ids: list[str], indexer: VaultIndexer) -> dict[str, Any]:
        day = _normalize_daily_day(day_iso)
        now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
        daily_path = self._ensure_daily_note(day, now_iso)
        meta, body = parse_markdown(daily_path)

        if not str(meta.get("id", "")).strip():
            meta["id"] = f"daily_{day}"
        if not str(meta.get("type", "")).strip():
            meta["type"] = "daily"
        if not str(meta.get("created_at", "")).strip():
            meta["created_at"] = f"{day}T00:00:00"
        meta["tags"] = _ensure_string_list(meta.get("tags", []))
        meta["mit"] = _normalize_mit_ids(mit_ids)
        meta["updated_at"] = now_iso

        atomic_write_text(daily_path, dump_markdown(meta, body), encoding='utf-8')
        indexer.reindex_markdown_file(self.vault_path, daily_path)

        return {
            "date": day,
            "note_path": daily_path,
            "mit_ids": _normalize_mit_ids(meta.get("mit", [])),
        }

    def add_quick_todo_to_daily(self, text: str, indexer: VaultIndexer, day_iso: str | None = None) -> dict[str, Any]:
        clean_text = " ".join(text.strip().split())
        if not clean_text:
            raise ValueError("Quick capture text is empty")

        day = _normalize_daily_day(day_iso)
        now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
        daily_path = self._ensure_daily_note(day, now_iso)
        meta, body = parse_markdown(daily_path)

        if not str(meta.get("id", "")).strip():
            meta["id"] = f"daily_{day}"
        if not str(meta.get("type", "")).strip():
            meta["type"] = "daily"
        if not str(meta.get("created_at", "")).strip():
            meta["created_at"] = f"{day}T00:00:00"
        meta["tags"] = _ensure_string_list(meta.get("tags", []))
        meta["updated_at"] = now_iso

        block_ref = f"nn-todo_{uuid.uuid4().hex[:16]}"
        todo_line = "- [ ] " + format_todo_tail(clean_text, block_ref, now_iso)
        if body.strip():
            next_body = body.rstrip() + "\n" + todo_line + "\n"
        else:
            next_body = f"# {day}\n\n{todo_line}\n"

        atomic_write_text(daily_path, dump_markdown(meta, next_body), encoding='utf-8')
        indexer.reindex_markdown_file(self.vault_path, daily_path)

        return {
            "date": day,
            "note_path": daily_path,
            "todo_text": clean_text,
        }

    def _create_task_file(
        self,
        task_id: str,
        note_id: str,
        task: ParsedTask,
        now: datetime,
        indexer: VaultIndexer,
        manual_related: list[str] | None = None,
        extra_frontmatter: dict[str, Any] | None = None,
        body: str | None = None,
    ) -> Path:
        status = task.status.lower() if task.status else "open"
        folder = "done" if status == "done" else "open"
        task_path = self.tasks_root_path / folder / f"{task_id}.md"
        ts = now.astimezone().isoformat(timespec="seconds")
        related = _dedupe_sorted([item for item in (manual_related or []) if item.strip()])
        completed_at = _normalize_iso_timestamp(task.completed_at)
        if status == "done" and not completed_at:
            completed_at = ts
        if status != "done":
            completed_at = ""

        frontmatter = {
            "id": task_id,
            "node_id": task_id,
            "title": task.title,
            "type": "task",
            "note_id": note_id,
            "created_at": ts,
            "updated_at": ts,
            "status": status,
            "priority": (task.priority or "M").upper()[:1],
            "due_date": task.due_date or "",
            "project_tag": task.project_tag or "",
            "tags": task.tags,
            "tags_auto": [],
            "related": related,
            "related_auto": [],
        }
        estimate_minutes = _normalize_estimate_minutes(task.estimate_minutes)
        blocked_by_ids = _normalize_blocked_by_ids(task.blocked_by_ids, exclude_id=task_id)
        waiting_for = _normalize_optional_text(task.waiting_for)
        follow_up_date = _normalize_due_date(task.follow_up_date or "")
        blocked_reason = _normalize_optional_text(task.blocked_reason)
        next_action_hint = _normalize_optional_text(task.next_action_hint)
        if estimate_minutes is not None:
            frontmatter["estimate_minutes"] = estimate_minutes
        if completed_at:
            frontmatter["completed_at"] = completed_at
        if blocked_by_ids:
            frontmatter["blocked_by_ids"] = blocked_by_ids
        if waiting_for:
            frontmatter["waiting_for"] = waiting_for
        if follow_up_date:
            frontmatter["follow_up_date"] = follow_up_date
        if blocked_reason:
            frontmatter["blocked_reason"] = blocked_reason
        if next_action_hint:
            frontmatter["next_action_hint"] = next_action_hint
        if extra_frontmatter:
            for key, value in extra_frontmatter.items():
                if key not in frontmatter:
                    frontmatter[key] = value
        body_text = body if body is not None else task.title
        atomic_write_text(task_path, dump_markdown(frontmatter, body_text), encoding='utf-8')

        task_for_index = ParsedTask(
            title=task.title,
            due_date=task.due_date,
            priority=task.priority,
            status=task.status,
            project_tag=task.project_tag,
            tags=list(task.tags),
            estimate_minutes=estimate_minutes,
            completed_at=completed_at or None,
            blocked_by_ids=blocked_by_ids,
            waiting_for=waiting_for or None,
            follow_up_date=follow_up_date or None,
            blocked_reason=blocked_reason or None,
            next_action_hint=next_action_hint or None,
        )
        indexer.add_or_update_task(
            task_id=task_id,
            note_id=note_id,
            path=str(task_path),
            parsed=task_for_index,
            created_at=ts,
            updated_at=ts,
        )
        self.sync_task_status_link(
            task_id=task_id,
            title=task.title,
            status=task.status,
            task_path=str(task_path),
            indexer=indexer,
        )
        return task_path

    def _ensure_daily_note(self, day_iso: str, updated_at: str) -> Path:
        daily_path = self._daily_note_path(day_iso)
        if daily_path.exists():
            return daily_path

        daily_path.parent.mkdir(parents=True, exist_ok=True)
        fm = {
            "id": f"daily_{day_iso}",
            "type": "daily",
            "title": day_iso,
            "created_at": f"{day_iso}T00:00:00",
            "updated_at": updated_at,
            "tags": [],
        }
        body = f"# {day_iso}\n"
        atomic_write_text(daily_path, dump_markdown(fm, body), encoding='utf-8')
        return daily_path

    def _daily_note_path(self, day_iso: str) -> Path:
        return self.daily_root_path / _daily_month_folder(day_iso) / f"{day_iso}.md"

    def rebuild_all_tag_pages(self, groups: list[dict[str, Any]], indexer: VaultIndexer) -> None:
        self.tag_root_path.mkdir(parents=True, exist_ok=True)
        for child in self.tag_root_path.iterdir():
            try:
                if child.is_dir():
                    _rmtree_with_retry(child)
                else:
                    _unlink_path_with_retry(child, missing_ok=True)
            except PermissionError:
                # In some restricted environments, delete operations are blocked.
                # We keep existing files and overwrite known targets below.
                continue

        normalized_groups = self._normalize_tag_groups(groups)
        for group in normalized_groups:
            group_id = str(group.get("id", "")).strip()
            group_display_name = str(group.get("displayName", "")).strip() or group_id
            group_slug = slugify(group_id)
            group_dir = self.tag_root_path / group_slug
            group_dir.mkdir(parents=True, exist_ok=True)

            for tag in group.get("tags", []):
                tag_id = str(tag.get("id", "")).strip()
                tag_display_name = str(tag.get("displayName", "")).strip() or tag_id
                self.rebuild_tag_page(group_id, group_display_name, tag_id, tag_display_name, indexer)

    def rebuild_tag_page(
        self,
        group_id: str,
        group_display_name: str,
        tag_id: str,
        tag_display_name: str,
        indexer: VaultIndexer,
    ) -> Path:
        group_slug = slugify(group_id)
        tag_slug = slugify(tag_id)
        if not group_slug or not tag_slug:
            raise ValueError(f"Invalid tag reference: {group_id}:{tag_id}")

        tag_dir = self.tag_root_path / group_slug / tag_slug
        tag_dir.mkdir(parents=True, exist_ok=True)
        tag_path = tag_dir / "overview.md"

        rows = indexer.notes_for_tag(group_slug, tag_slug)
        open_tasks = self._open_tasks_for_tag(group_slug, tag_slug, indexer)
        now = datetime.now().astimezone().isoformat(timespec="seconds")

        frontmatter = {
            "id": f"tag_{group_slug}_{tag_slug}",
            "node_id": f"tag_{group_slug}_{tag_slug}",
            "title": f"{group_display_name} / {tag_display_name}",
            "type": "tag_index",
            "group": group_display_name,
            "tag": tag_display_name,
            "created_at": now,
            "updated_at": now,
            "tags": [f"{group_slug}:{tag_slug}"],
        }

        body_lines = [
            f"# {group_display_name} / {tag_display_name}",
            "",
            "## Uebersicht",
            f"- Verknuepfte Notizen: {len(rows)}",
            f"- Offene To-dos: {len(open_tasks)}",
            "",
            "## Letzte Notizen",
        ]
        if not rows:
            body_lines.append("- Noch keine verknüpften Notizen.")
        else:
            for row in rows[:40]:
                body_lines.append(
                    f"- {row['created_at']} [{row['title']}]({Path(row['path']).as_posix()}) (`{row['id']}`)"
                )

        body_lines.extend(["", "## Querverweise"])
        if not rows:
            body_lines.append("- Noch keine Querverweise vorhanden.")
        else:
            for row in rows[:12]:
                body_lines.append(f"- [{row['title']}]({Path(row['path']).as_posix()})")

        body_lines.extend(["", "## Offene To-dos"])
        if not open_tasks:
            body_lines.append("- Keine offenen To-dos.")
        else:
            for task in open_tasks[:30]:
                due = f" | due {task['due_date']}" if task["due_date"] else ""
                priority = task["priority"]
                body_lines.append(f"- [ ] ({priority}) {task['title']}{due} [{task['id']}]({task['path']})")

        body = "\n".join(body_lines) + "\n"
        atomic_write_text(tag_path, dump_markdown(frontmatter, body), encoding='utf-8')
        return tag_path

    def resolve_tag_overview_note(self, group_id: str, tag_id: str, indexer: VaultIndexer) -> dict[str, Any]:
        group_slug = slugify(group_id)
        tag_slug = slugify(tag_id)
        if not group_slug or not tag_slug:
            raise ValueError(f"Invalid tag reference: {group_id}:{tag_id}")

        groups = self.read_tag_groups()
        selected_group: dict[str, Any] | None = None
        for group in groups:
            candidate = str(group.get("id", "")).strip()
            if not candidate:
                continue
            candidate_slug = slugify(candidate)
            if candidate_slug and candidate_slug.lower() == group_slug.lower():
                selected_group = group
                break
            if _normalize_tag_id(candidate) == _normalize_tag_id(group_slug):
                selected_group = group

        group_display_name = group_slug
        tag_display_name = tag_slug
        if selected_group is not None:
            group_display_name = _normalize_label(str(selected_group.get("displayName", ""))) or group_slug
            tags = selected_group.get("tags", [])
            if isinstance(tags, list):
                for tag in tags:
                    if not isinstance(tag, dict):
                        continue
                    candidate_id = str(tag.get("id", "")).strip()
                    if not candidate_id:
                        continue
                    candidate_slug = slugify(candidate_id)
                    if candidate_slug and candidate_slug.lower() == tag_slug.lower():
                        tag_display_name = _normalize_label(str(tag.get("displayName", ""))) or tag_slug
                        break
                    if _normalize_tag_id(candidate_id) == _normalize_tag_id(tag_slug):
                        tag_display_name = _normalize_label(str(tag.get("displayName", ""))) or tag_slug

        tag_path = self.rebuild_tag_page(group_slug, group_display_name, tag_slug, tag_display_name, indexer)
        return {
            "path": tag_path,
            "title": f"{group_display_name} / {tag_display_name}",
        }

    def _open_tasks_for_tag(self, group_slug: str, tag_slug: str, indexer: VaultIndexer) -> list[dict[str, str]]:
        rows=indexer.conn.execute("""SELECT DISTINCT t.id,t.title,t.priority,t.due_date,t.path FROM tasks t JOIN notes n ON n.path=t.path JOIN note_tags nt ON nt.note_id=n.id JOIN tags tag ON tag.id=nt.tag_id WHERE tag.category=? AND tag.slug=? AND t.status NOT IN ('done','cancelled','archived') ORDER BY COALESCE(t.due_date,'9999-12-31'), t.title""",(group_slug,tag_slug)).fetchall()
        return [{key:str(row[key] or '') for key in ('id','title','priority','due_date','path')} for row in rows]

    def _rewrite_tag_references(self, old_key: str, new_key: str, remove: bool) -> int:
        old_key = _normalize_tag_key(old_key)
        new_key = _normalize_tag_key(new_key)
        if not old_key:
            return 0

        changed = 0
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        for file_path in self._iter_markdown_files_for_tag_updates():
            meta, body = parse_markdown(file_path)
            touched = False
            for field in ('tags', 'tags_auto'):
                raw_tags = meta.get(field, [])
                if isinstance(raw_tags, str):
                    raw_tags = [raw_tags]
                normalized = [_normalize_tag_key(str(item)) for item in raw_tags] if isinstance(raw_tags, list) else []
                if old_key in normalized:
                    meta[field] = _dedupe_sorted([new_key if tag == old_key else tag for tag in normalized if tag != old_key or (not remove and new_key)])
                    touched = True
            old_group, old_tag = old_key.split(':', 1)
            old_inline = '{tag:' + old_group + '/' + old_tag + '}'
            replacement = '' if remove else '{tag:' + new_key.replace(':', '/', 1) + '}'
            from .markdown_syntax import transform_prose
            next_body = transform_prose(body, lambda text: text.replace(old_inline, replacement))
            touched = touched or next_body != body
            body = next_body
            if not touched:
                continue
            meta["updated_at"] = now
            atomic_write_text(file_path, dump_markdown(meta, body), encoding='utf-8')
            changed += 1

        return changed

    def _iter_markdown_files_for_tag_updates(self) -> list[Path]:
        from .inventory import markdown_sources
        return markdown_sources(self.vault_path)

    def _collect_custom_group_payloads(
        self, root: Path, favorites: set[str], seen: set[Path] | None = None
    ) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        seen_paths = seen if seen is not None else set()
        try:
            resolved_root = root.resolve()
        except OSError:
            return payloads
        if resolved_root in seen_paths:
            return payloads
        seen_paths.add(resolved_root)

        try:
            payloads.append(self._group_payload(root, favorites))
        except (OSError, ValueError):
            return payloads

        child_dirs = self._sorted_dirs(root)
        for child in child_dirs:
            if self._is_system_name(child.name):
                continue
            payloads.extend(self._collect_custom_group_payloads(child, favorites, seen_paths))
        return payloads

    def _group_payload(self, directory: Path, favorites: set[str]) -> dict[str, Any]:
        key = self._to_group_key(directory)
        creation_locked = self._is_creation_locked_path(directory)
        return {
            "key": key,
            "label": self._label_from_group_dir(directory.name),
            "path": str(directory),
            "favorite": key in favorites,
            "canCreateNotes": not creation_locked,
            "canCreateGroups": not creation_locked,
            "canDelete": not self._is_protected_root(key),
        }

    def _resolve_group_path(self, group_key: str) -> Path:
        clean_key = group_key.replace("\\", "/").strip().strip("/")
        if not clean_key:
            return self.vault_path

        path = (self.vault_path / clean_key).resolve()
        vault_root = self.vault_path.resolve()
        try:
            path.relative_to(vault_root)
        except ValueError as exc:
            raise ValueError(f"Invalid group key: {group_key}") from exc

        if not path.exists() or not path.is_dir():
            raise ValueError(f"Unknown note group: {group_key}")
        return path

    def _to_group_key(self, directory: Path) -> str:
        return directory.relative_to(self.vault_path).as_posix()

    def _is_same_or_descendant(self, parent: Path, child: Path) -> bool:
        try:
            child.resolve().relative_to(parent.resolve())
            return True
        except ValueError:
            return False

    def _is_tag_path(self, directory: Path) -> bool:
        try:
            directory.resolve().relative_to(self.tag_root_path.resolve())
            return True
        except ValueError:
            return False

    def _is_daily_path(self, directory: Path) -> bool:
        try:
            directory.resolve().relative_to(self.daily_root_path.resolve())
            return True
        except ValueError:
            return False

    def _is_tasks_path(self, directory: Path) -> bool:
        try:
            directory.resolve().relative_to(self.tasks_root_path.resolve())
            return True
        except ValueError:
            return False

    def _is_creation_locked_path(self, directory: Path) -> bool:
        return self._is_daily_path(directory) or self._is_tag_path(directory) or self._is_tasks_path(directory)

    def _label_from_group_dir(self, directory_name: str) -> str:
        trimmed = directory_name.strip()
        if len(trimmed) > 3 and trimmed[:2].isdigit() and trimmed[2] == "_":
            trimmed = trimmed[3:]
        return _normalize_label(trimmed.replace("_", " ").replace("-", " ")) or directory_name

    def _safe_group_dir_token(self, label: str) -> str:
        raw = label.strip().replace(" ", "_")
        filtered = "".join(char if (char.isalnum() or char in {"_", "-"}) else "_" for char in raw)
        clean = "_".join(part for part in filtered.split("_") if part)
        return clean[:60]

    def _safe_entry_name(self, value: str) -> str:
        return self._safe_group_dir_token(value)

    def _next_available_note_path(self, directory: Path, safe_stem: str, preferred_current: Path | None = None) -> Path:
        suffix = ".md"
        candidate = directory / f"{safe_stem}{suffix}"
        counter = 2
        while candidate.exists() and candidate != preferred_current:
            candidate = directory / f"{safe_stem}_{counter}{suffix}"
            counter += 1
        return candidate

    def _todo_inherited_tags_from_meta(self, meta: dict[str, Any]) -> list[str]:
        keys: set[str] = set()
        for raw_tag in _ensure_string_list(meta.get("tags", [])):
            key = _normalize_tag_key(raw_tag)
            if key:
                keys.add(key)
        for raw_tag in _ensure_string_list(meta.get("tags_auto", [])):
            key = _normalize_tag_key(raw_tag)
            if key:
                keys.add(key)
                continue
            topic = slugify(raw_tag.lstrip("#"))
            if topic:
                keys.add(f"topic:{topic}")
        return sorted(keys, key=lambda item: item.lower())

    def _build_note_document(
        self,
        body: str,
        title: str,
        note_type: str,
        note_id: str,
        node_id: str,
        created_at: str,
        updated_at: str,
        status: str,
        priority: str,
        due_date: str,
        estimate_minutes: int | None,
        completed_at: str,
        blocked_by_ids: list[str],
        waiting_for: str,
        follow_up_date: str,
        blocked_reason: str,
        next_action_hint: str,
        manual_tags: list[str],
        manual_related: list[str],
        auto_tags: list[str],
        auto_related: list[str],
        extra: dict[str, Any] | None = None,
    ) -> str:
        frontmatter: dict[str, Any] = {
            "id": note_id,
            "node_id": node_id,
            "title": title,
            "type": note_type,
            "status": _normalize_task_status(status),
            "priority": _normalize_task_priority(priority),
            "due_date": _normalize_due_date(due_date),
            "created_at": created_at,
            "updated_at": updated_at,
            "tags": _dedupe_sorted(manual_tags),
            "tags_auto": _dedupe_sorted(auto_tags),
            "related": _dedupe_sorted(manual_related),
            "related_auto": _dedupe_sorted(auto_related),
        }
        if estimate_minutes is not None:
            frontmatter["estimate_minutes"] = estimate_minutes
        if completed_at:
            frontmatter["completed_at"] = _normalize_iso_timestamp(completed_at)
        if blocked_by_ids:
            frontmatter["blocked_by_ids"] = _normalize_blocked_by_ids(blocked_by_ids)
        if waiting_for:
            frontmatter["waiting_for"] = waiting_for
        if follow_up_date:
            frontmatter["follow_up_date"] = _normalize_due_date(follow_up_date)
        if blocked_reason:
            frontmatter["blocked_reason"] = blocked_reason
        if next_action_hint:
            frontmatter["next_action_hint"] = next_action_hint
        if extra:
            for key, value in extra.items():
                if key not in frontmatter:
                    frontmatter[key] = value
        return dump_markdown(frontmatter, body)

    def _sorted_dirs(self, directory: Path) -> list[Path]:
        try:
            entries = list(directory.iterdir())
        except OSError:
            return []

        dirs: list[Path] = []
        for child in entries:
            try:
                if child.is_symlink():
                    continue
                if child.is_dir():
                    dirs.append(child)
            except OSError:
                continue

        return sorted(dirs, key=lambda item: item.name.lower())

    def _is_system_name(self, name: str) -> bool:
        return name == self.system_root_name

    def _is_system_path(self, directory: Path) -> bool:
        try:
            directory.resolve().relative_to(self.system_path.resolve())
            return True
        except ValueError:
            return False

    def _is_protected_root(self, key: str) -> bool:
        clean_key = key.replace("\\", "/").strip().strip("/")
        return clean_key in {
            self.daily_root_name,
            self.tag_root_name,
            self.tasks_root_name,
            self.media_root_name,
        }

    def _resolve_note_file(self, note_path: str) -> Path:
        candidate = Path(note_path).expanduser()
        if candidate.is_absolute():
            path = candidate.resolve()
        else:
            clean_path = note_path.replace("\\", "/").strip().strip("/")
            path = (self.vault_path / clean_path).resolve()
        vault_root = self.vault_path.resolve()
        try:
            path.relative_to(vault_root)
        except ValueError as exc:
            raise ValueError("Invalid note path") from exc

        if not path.exists() or not path.is_file():
            raise ValueError(f"Unknown note file: {note_path}")
        if self._is_system_path(path.parent):
            raise ValueError("System files cannot be modified")
        return path

    def _resolve_note_file_for_save(self, note_path: str, content: str) -> Path:
        try:
            return self._resolve_note_file(note_path)
        except ValueError as original_exc:
            resolved = self._resolve_existing_note_after_rename(note_path, content)
            if resolved is not None:
                return resolved
            raise original_exc

    def _resolve_existing_note_after_rename(self, note_path: str, content: str) -> Path | None:
        meta, body = parse_markdown_text(content)
        note_ids = [
            str(meta.get("id", "")).strip(),
            str(meta.get("node_id", "")).strip(),
        ]
        for note_id in note_ids:
            if not note_id:
                continue
            by_id = self._find_markdown_file_by_note_id(note_id)
            if by_id is not None:
                return by_id

        target_parent = self._requested_note_parent(note_path)
        if target_parent is None or not target_parent.exists():
            return None

        title = str(meta.get("title", "")).strip()
        if not title and body.strip():
            heading = TITLE_HEADING_PATTERN.search(body)
            title = heading.group(1).strip() if heading else ""
        safe_stem = self._safe_entry_name(title) if title else ""
        if safe_stem:
            for candidate in (
                target_parent / f"{safe_stem}.md",
                target_parent / f"{safe_stem.lower()}.md",
            ):
                resolved = self._validated_existing_note_file(candidate)
                if resolved is not None:
                    return resolved

        requested_stem = Path(note_path).stem
        requested_key = self._loose_filename_key(requested_stem)
        if requested_key:
            for sibling in target_parent.glob("*.md"):
                if self._loose_filename_key(sibling.stem) == requested_key:
                    resolved = self._validated_existing_note_file(sibling)
                    if resolved is not None:
                        return resolved

        return None

    def _requested_note_parent(self, note_path: str) -> Path | None:
        candidate = Path(note_path).expanduser()
        if candidate.is_absolute():
            parent = candidate.parent.resolve()
        else:
            clean_path = note_path.replace("\\", "/").strip().strip("/")
            parent = (self.vault_path / clean_path).resolve().parent
        vault_root = self.vault_path.resolve()
        try:
            parent.relative_to(vault_root)
        except ValueError:
            return None
        if self._is_system_path(parent):
            return None
        return parent

    def _find_markdown_file_by_note_id(self, note_id: str) -> Path | None:
        matches: list[Path] = []
        for candidate in self.vault_path.rglob("*.md"):
            if self._is_system_path(candidate.parent):
                continue
            if candidate.parts and any(part == self.media_root_name for part in candidate.parts):
                continue
            try:
                meta, _body = parse_markdown(candidate)
            except OSError:
                continue
            ids = {
                str(meta.get("id", "")).strip(),
                str(meta.get("node_id", "")).strip(),
            }
            if note_id in ids:
                matches.append(candidate.resolve())
        if len(matches) == 1:
            return matches[0]
        return None

    def _validated_existing_note_file(self, candidate: Path) -> Path | None:
        try:
            path = candidate.resolve()
            path.relative_to(self.vault_path.resolve())
        except (OSError, ValueError):
            return None
        if not path.exists() or not path.is_file() or path.suffix.lower() != ".md":
            return None
        if self._is_system_path(path.parent):
            return None
        return path

    def _loose_filename_key(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", value.strip().lower())

    def _read_favorite_folders(self) -> list[str]:
        if not self.favorite_folders_path.exists():
            return [self.daily_root_name, self.tag_root_name, self.tasks_root_name]

        try:
            payload = json.loads(self.favorite_folders_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}

        source = payload.get("folders", []) if isinstance(payload, dict) else payload
        if not isinstance(source, list):
            source = []

        favorites: list[str] = []
        for raw in source:
            if not isinstance(raw, str):
                continue
            clean = raw.replace("\\", "/").strip().strip("/")
            if not clean:
                continue
            target = self.vault_path / clean
            try:
                if not target.exists() or not target.is_dir():
                    continue
            except OSError:
                continue
            if self._is_system_name(clean.split("/")[0]):
                continue
            favorites.append(clean)

        for base in (self.daily_root_name, self.tag_root_name, self.tasks_root_name):
            if (self.vault_path / base).exists() and base not in favorites:
                favorites.append(base)

        unique = sorted(set(favorites), key=lambda item: item.lower())
        if unique != favorites:
            self._write_favorite_folders(unique)
        return unique

    def _write_favorite_folders(self, folders: list[str]) -> None:
        clean = sorted(
            {
                item.replace("\\", "/").strip().strip("/")
                for item in folders
                if isinstance(item, str) and item.strip()
            },
            key=lambda item: item.lower(),
        )
        payload = {
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "folders": clean,
        }
        atomic_write_text(self.favorite_folders_path, json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')

    def _remove_favorite_path(self, path_key: str) -> None:
        clean = path_key.replace("\\", "/").strip().strip("/")
        favorites = [
            item
            for item in self._read_favorite_folders()
            if item != clean and not item.startswith(f"{clean}/")
        ]
        self._write_favorite_folders(favorites)

    def _remap_favorites(self, old_key: str, new_key: str) -> None:
        clean_old = old_key.replace("\\", "/").strip().strip("/")
        clean_new = new_key.replace("\\", "/").strip().strip("/")
        remapped: list[str] = []
        for item in self._read_favorite_folders():
            if item == clean_old:
                remapped.append(clean_new)
                continue
            if item.startswith(f"{clean_old}/"):
                suffix = item[len(clean_old) :]
                remapped.append(f"{clean_new}{suffix}")
                continue
            remapped.append(item)
        self._write_favorite_folders(remapped)

    def _to_tag_key(self, group_id: str, tag_id: str) -> str:
        group_slug = _normalize_tag_id(group_id)
        tag_slug = _normalize_tag_id(tag_id)
        if not group_slug or not tag_slug:
            return ""
        return f"{group_slug}:{tag_slug}"

    def _resolve_group_entry(self, groups: list[dict[str, Any]], group_id: str) -> dict[str, Any] | None:
        clean_group_id = _normalize_tag_id(group_id)
        if not clean_group_id:
            return None
        for group in groups:
            candidate = _normalize_tag_id(str(group.get("id", "")))
            if candidate and candidate.lower() == clean_group_id.lower():
                return group
        return None

    def _resolve_tag_entry(self, group: dict[str, Any], tag_id: str) -> dict[str, Any] | None:
        clean_tag_id = _normalize_tag_id(tag_id)
        if not clean_tag_id:
            return None
        tags = group.get("tags", [])
        if not isinstance(tags, list):
            return None
        for tag in tags:
            if not isinstance(tag, dict):
                continue
            candidate = _normalize_tag_id(str(tag.get("id", "")))
            if candidate and candidate.lower() == clean_tag_id.lower():
                return tag
        return None

    def _sorted_tag_entries(self, tags: Any) -> list[dict[str, str]]:
        if not isinstance(tags, list):
            return []

        entries: dict[str, dict[str, str]] = {}
        for tag in tags:
            if isinstance(tag, str):
                tag_id = _normalize_tag_id(tag)
                if not tag_id:
                    continue
                display_name = _normalize_label(tag) or tag_id
            elif isinstance(tag, dict):
                tag_id = _normalize_tag_id(str(tag.get("id", "")))
                if not tag_id:
                    continue
                display_name = _normalize_label(str(tag.get("displayName", ""))) or tag_id
            else:
                continue

            existing = entries.get(tag_id)
            if existing is None or existing["displayName"] == existing["id"]:
                entries[tag_id] = {"id": tag_id, "displayName": display_name}

        return sorted(entries.values(), key=lambda item: item["displayName"].lower())

    def _normalize_tag_groups(self, value: Any) -> list[dict[str, Any]]:
        normalized: dict[str, dict[str, Any]] = {}

        if isinstance(value, dict):
            for raw_group, raw_tags in value.items():
                if not isinstance(raw_group, str):
                    continue
                group_id = _normalize_tag_id(raw_group)
                if not group_id:
                    continue
                display_name = _normalize_label(raw_group) or group_id
                tags = self._sorted_tag_entries(raw_tags)
                normalized[group_id] = {
                    "id": group_id,
                    "displayName": display_name,
                    "color": TAG_GROUP_DEFAULT_COLOR,
                    "tags": tags,
                }
        elif isinstance(value, list):
            for raw_group in value:
                if not isinstance(raw_group, dict):
                    continue
                group_id = _normalize_tag_id(str(raw_group.get("id", "")))
                if not group_id:
                    continue

                display_name = _normalize_label(str(raw_group.get("displayName", ""))) or group_id
                color = _normalize_tag_color(str(raw_group.get("color", "")))
                tags = self._sorted_tag_entries(raw_group.get("tags", []))

                existing = normalized.get(group_id)
                if existing is None:
                    normalized[group_id] = {
                        "id": group_id,
                        "displayName": display_name,
                        "color": color,
                        "tags": tags,
                    }
                    continue

                merged_tags = self._sorted_tag_entries([*existing.get("tags", []), *tags])
                normalized[group_id] = {
                    "id": group_id,
                    "displayName": display_name or existing.get("displayName", group_id),
                    "color": color or existing.get("color", TAG_GROUP_DEFAULT_COLOR),
                    "tags": merged_tags,
                }

        return sorted(normalized.values(), key=lambda item: str(item.get("displayName", item.get("id", ""))).lower())

    def _write_tag_groups(self, groups: Any) -> None:
        atomic_write_text(self.tag_groups_path, json.dumps({"version": 1, "groups": self._normalize_tag_groups(groups)}, indent=2, ensure_ascii=False))

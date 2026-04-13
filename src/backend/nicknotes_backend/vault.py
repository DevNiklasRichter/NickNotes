from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from .indexer import VaultIndexer
from .markdown_io import dump_markdown, parse_markdown, parse_markdown_text
from .models import ParsedTask, TagSuggestion
from .parser import make_note_id, make_task_id, slugify


def _normalize_label(value: str) -> str:
    return " ".join(value.strip().split())


def _dedupe_sorted(values: list[str]) -> list[str]:
    return sorted(set(values), key=lambda item: item.lower())


DEFAULT_TAG_GROUP_COLOR = "#4f8cff"
TASK_STATUSES = ("new_topic", "open", "in_progress", "done")
INLINE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}")
HASHTAG_PATTERN = re.compile(r"(?<![A-Za-z0-9_])#([A-Za-z0-9][A-Za-z0-9_\-/]{1,60})")
WIKILINK_PATTERN = re.compile(r"\[\[([^[\]\n]+)\]\]")
TITLE_HEADING_PATTERN = re.compile(r"^\s{0,3}#\s+(.+?)\s*$")


def _normalize_tag_id(value: str) -> str:
    clean = _normalize_label(value).strip().lower()
    clean = re.sub(r"[^a-z0-9]+", "-", clean)
    clean = clean.strip("-")
    return clean


def _normalize_tag_color(value: str) -> str:
    clean = value.strip().lower()
    if len(clean) == 4 and clean.startswith("#") and all(char in "0123456789abcdef" for char in clean[1:]):
        return clean
    if len(clean) == 7 and clean.startswith("#") and all(char in "0123456789abcdef" for char in clean[1:]):
        return clean
    return DEFAULT_TAG_GROUP_COLOR


def _normalize_tag_key(raw: str) -> str:
    if ":" not in raw:
        return ""
    group, tag = raw.split(":", 1)
    group_slug = slugify(group)
    tag_slug = slugify(tag)
    if not group_slug or not tag_slug:
        return ""
    return f"{group_slug}:{tag_slug}"


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


def _normalize_task_status(raw: str) -> str:
    clean = raw.strip().lower().replace("-", "_").replace(" ", "_")
    return clean if clean in TASK_STATUSES else "open"


def _extract_title_from_body(body: str) -> str:
    for line in body.splitlines():
        match = TITLE_HEADING_PATTERN.match(line)
        if match:
            return _normalize_label(match.group(1))
        stripped = line.strip()
        if stripped:
            return _normalize_label(stripped[:120])
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

    for match in INLINE_TAG_PATTERN.finditer(body):
        key = _normalize_tag_key(f"{match.group(1)}:{match.group(2)}")
        if key:
            found.add(key)

    for match in HASHTAG_PATTERN.finditer(body):
        raw = match.group(1).strip().strip("/")
        if not raw:
            continue
        if "/" in raw:
            left, right = raw.split("/", 1)
            key = _normalize_tag_key(f"{left}:{right}")
            if key:
                found.add(key)
            continue
        slug = slugify(raw)
        if slug:
            found.add(f"topic:{slug}")

    return sorted(found, key=lambda item: item.lower())


def _extract_related_links(body: str) -> list[str]:
    related: set[str] = set()
    for match in WIKILINK_PATTERN.finditer(body):
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


class VaultManager:
    def __init__(self, vault_path: Path):
        self.vault_path = vault_path
        self._configure_root_paths()

    def ensure_structure(self) -> None:
        self.daily_root_path = self._ensure_root_directory("daily", "01_daily")
        self.tag_root_path = self._ensure_root_directory("tags", "02_tags")
        self.tasks_root_path = self._ensure_root_directory("tasks", "03_tasks")
        self.system_path = self._ensure_system_directory()
        self._configure_root_paths()

        (self.tasks_root_path / "open").mkdir(parents=True, exist_ok=True)
        (self.tasks_root_path / "done").mkdir(parents=True, exist_ok=True)
        self.system_path.mkdir(parents=True, exist_ok=True)

        if not self.config_path.exists():
            self.config_path.write_text(
                json.dumps(
                    {
                        "mode": "core",
                        "openai": {
                            "enabled": False,
                            "model": "gpt-4.1-mini",
                            "api_key_env": "OPENAI_API_KEY",
                        },
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )

        if not self.read_tag_groups():
            defaults = [
                {"id": "person", "displayName": "Person", "color": "#4f8cff", "tags": []},
                {"id": "project", "displayName": "Project", "color": "#2fba7a", "tags": []},
                {"id": "customer", "displayName": "Customer", "color": "#ff8a4f", "tags": []},
                {"id": "machine-no", "displayName": "Machine No", "color": "#7a78ff", "tags": []},
                {"id": "machine-type", "displayName": "Machine Type", "color": "#d26cf5", "tags": []},
            ]
            self._write_tag_groups(defaults)

        if not self.favorite_folders_path.exists():
            self._write_favorite_folders([self.daily_root_name, self.tag_root_name, self.tasks_root_name])

        if not self.ui_settings_path.exists():
            self.ui_settings_path.write_text(
                json.dumps(
                    {
                        "updated_at": datetime.now().isoformat(timespec="seconds"),
                        "app": {},
                        "explorer": {},
                    },
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

        self._migrate_legacy_inbox()

    def _configure_root_paths(self) -> None:
        self.daily_root_name = self._pick_root_name("daily", "01_daily")
        self.tag_root_name = self._pick_root_name("tags", "02_tags")
        self.tasks_root_name = self._pick_root_name("tasks", "03_tasks")
        self.system_root_name = self._pick_system_root_name()

        self.daily_root_path = self.vault_path / self.daily_root_name
        self.tag_root_path = self.vault_path / self.tag_root_name
        self.tasks_root_path = self.vault_path / self.tasks_root_name
        self.system_path = self.vault_path / self.system_root_name

        self.db_path = self.system_path / "index.db"
        self.config_path = self.system_path / "config.json"
        self.tag_groups_path = self.system_path / "tag_groups.json"
        self.favorite_folders_path = self.system_path / "favorite_folders.json"
        self.ui_settings_path = self.system_path / "ui_settings.json"

    def _pick_root_name(self, preferred: str, legacy: str) -> str:
        if (self.vault_path / preferred).is_dir():
            return preferred
        if (self.vault_path / legacy).is_dir():
            return legacy
        return preferred

    def _ensure_root_directory(self, preferred: str, legacy: str) -> Path:
        preferred_path = self.vault_path / preferred
        legacy_path = self.vault_path / legacy

        if preferred_path.exists():
            preferred_path.mkdir(parents=True, exist_ok=True)
            return preferred_path

        if legacy_path.exists():
            try:
                legacy_path.rename(preferred_path)
                return preferred_path
            except OSError:
                legacy_path.mkdir(parents=True, exist_ok=True)
                return legacy_path

        preferred_path.mkdir(parents=True, exist_ok=True)
        return preferred_path

    def _pick_system_root_name(self) -> str:
        for candidate in (".system", "system", "99_system"):
            if (self.vault_path / candidate).is_dir():
                return candidate
        return ".system"

    def _ensure_system_directory(self) -> Path:
        preferred_path = self.vault_path / ".system"
        modern_path = self.vault_path / "system"
        legacy_path = self.vault_path / "99_system"

        if preferred_path.exists():
            preferred_path.mkdir(parents=True, exist_ok=True)
            return preferred_path

        for source_path in (modern_path, legacy_path):
            if not source_path.exists():
                continue
            try:
                shutil.move(str(source_path), str(preferred_path))
                return preferred_path
            except OSError:
                source_path.mkdir(parents=True, exist_ok=True)
                return source_path

        preferred_path.mkdir(parents=True, exist_ok=True)
        return preferred_path

    def list_note_groups(self) -> list[dict[str, Any]]:
        groups: list[dict[str, Any]] = []
        favorites = set(self._read_favorite_folders())
        for child in self._sorted_dirs(self.vault_path):
            if self._is_system_name(child.name) or child.name == "02_entities" or self._is_hidden_legacy_root(child.name):
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
        if self._is_tag_path(parent_path):
            raise ValueError("In Tag-Notes koennen keine neuen Gruppen angelegt werden.")

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
        clean_key = group_key.replace("\\", "/").strip().strip("/")
        root_dir = self._resolve_group_path(clean_key)
        if self._is_tag_path(root_dir):
            raise ValueError("In Tag-Notes koennen keine neuen Notizen angelegt werden.")

        kind = _normalize_note_type(note_type)
        now = datetime.now()
        clean_title = _normalize_label(title) or ("New Task" if kind == "task" else "New Note")
        note_id = make_task_id(now) if kind == "task" else make_note_id(now)
        safe_stem = self._safe_entry_name(clean_title) or note_id

        note_dir = root_dir / "notes" if self._is_daily_group_key(clean_key) else root_dir
        note_dir.mkdir(parents=True, exist_ok=True)
        note_path = self._next_available_note_path(note_dir, safe_stem)
        normalized_status = _normalize_task_status(status)
        note_content = self._build_note_document(
            body="",
            title=clean_title,
            note_type=kind,
            note_id=note_id,
            node_id=note_id,
            created_at=now.isoformat(timespec="seconds"),
            updated_at=now.isoformat(timespec="seconds"),
            status=normalized_status,
            manual_tags=[],
            manual_related=[],
            auto_tags=[],
            auto_related=[],
        )
        note_path.write_text(note_content, encoding="utf-8")

        indexer.reindex_vault(self.vault_path)
        return {"note_id": note_id, "note_path": note_path, "title": clean_title}

    def create_task_in_group(self, group_key: str, title: str, indexer: VaultIndexer, status: str = "open") -> dict[str, Any]:
        return self.create_note_in_group(group_key=group_key, title=title, indexer=indexer, note_type="task", status=status)

    def rename_note_group(self, group_key: str, new_name: str, indexer: VaultIndexer) -> dict[str, Any]:
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

        target.rename(destination)
        self._remap_favorites(relative, self._to_group_key(destination))
        indexer.reindex_vault(self.vault_path)
        return self._group_payload(destination, set(self._read_favorite_folders()))

    def move_note_group(self, group_key: str, target_parent_key: str, indexer: VaultIndexer) -> dict[str, Any]:
        source = self._resolve_group_path(group_key)
        source_key = self._to_group_key(source)
        if self._is_protected_root(source_key):
            raise ValueError("Die Basisordner daily, tags und tasks koennen nicht verschoben werden.")
        if self._is_system_path(source):
            raise ValueError("Systemordner kann nicht verschoben werden.")

        target_parent = self._resolve_group_path(target_parent_key)
        if self._is_tag_path(target_parent):
            raise ValueError("Ordner koennen nicht in den Tag-Bereich verschoben werden.")
        if self._is_system_path(target_parent):
            raise ValueError("Ordner koennen nicht in den Systembereich verschoben werden.")
        if self._is_same_or_descendant(source, target_parent):
            raise ValueError("Ein Ordner kann nicht in sich selbst oder einen Unterordner verschoben werden.")

        destination = target_parent / source.name
        if destination == source:
            return self._group_payload(source, set(self._read_favorite_folders()))

        suffix = 2
        while destination.exists() and destination != source:
            destination = target_parent / f"{source.name}_{suffix}"
            suffix += 1

        source.rename(destination)
        self._remap_favorites(source_key, self._to_group_key(destination))
        indexer.reindex_vault(self.vault_path)
        return self._group_payload(destination, set(self._read_favorite_folders()))

    def delete_note_group(self, group_key: str, indexer: VaultIndexer) -> None:
        target = self._resolve_group_path(group_key)
        relative = self._to_group_key(target)
        if self._is_protected_root(relative):
            raise ValueError("Die Basisordner daily, tags und tasks koennen nicht geloescht werden.")
        if self._is_system_path(target):
            raise ValueError("Systemordner kann nicht geloescht werden.")

        shutil.rmtree(target)
        self._remove_favorite_path(relative)
        indexer.reindex_vault(self.vault_path)

    def rename_note_file(self, note_path: str, new_name: str, indexer: VaultIndexer) -> Path:
        file_path = self._resolve_note_file(note_path)
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
            file_path.rename(destination)

        original = destination.read_text(encoding="utf-8")
        normalized, _meta = self.normalize_note_markdown_text(
            text=original,
            path=destination,
            force_title=clean_name,
            touch_updated=True,
        )
        if normalized != original:
            destination.write_text(normalized, encoding="utf-8")

        indexer.reindex_vault(self.vault_path)
        return destination

    def move_note_file(self, note_path: str, target_group_key: str, indexer: VaultIndexer) -> Path:
        file_path = self._resolve_note_file(note_path)
        target_group = self._resolve_group_path(target_group_key)
        if self._is_tag_path(target_group):
            raise ValueError("Notizen koennen nicht in den Tag-Bereich verschoben werden.")
        if self._is_system_path(target_group):
            raise ValueError("Notizen koennen nicht in den Systembereich verschoben werden.")

        clean_target_key = target_group_key.replace("\\", "/").strip().strip("/")
        target_dir = target_group / "notes" if self._is_daily_group_key(clean_target_key) else target_group
        target_dir.mkdir(parents=True, exist_ok=True)

        destination = target_dir / file_path.name
        if destination == file_path:
            return file_path

        suffix = 2
        while destination.exists() and destination != file_path:
            destination = target_dir / f"{file_path.stem}_{suffix}{file_path.suffix}"
            suffix += 1

        file_path.rename(destination)
        indexer.reindex_vault(self.vault_path)
        return destination

    def delete_note_file(self, note_path: str, indexer: VaultIndexer) -> None:
        file_path = self._resolve_note_file(note_path)
        file_path.unlink(missing_ok=False)
        indexer.reindex_vault(self.vault_path)

    def normalize_note_markdown_text(
        self,
        text: str,
        path: Path,
        force_title: str = "",
        touch_updated: bool = True,
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

        now_iso = datetime.now().isoformat(timespec="seconds")

        try:
            stat = path.stat()
            fallback_created = datetime.fromtimestamp(stat.st_ctime).isoformat(timespec="seconds")
            fallback_updated = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
        except OSError:
            fallback_created = now_iso
            fallback_updated = now_iso

        note_type = _normalize_note_type(str(frontmatter.get("type", "note")))
        detected_title = _extract_title_from_body(raw_body)
        title = _normalize_label(force_title) or _normalize_label(str(frontmatter.get("title", "")))
        if not title:
            title = detected_title or self._label_from_group_dir(path.stem)
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
        status = _normalize_task_status(str(frontmatter.get("status", "open"))) if note_type == "task" else ""

        known_keys = {
            "id",
            "node_id",
            "title",
            "type",
            "status",
            "created_at",
            "updated_at",
            "tags",
            "tags_auto",
            "related",
            "related_auto",
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
    ) -> tuple[Path, dict[str, Any], bool]:
        original = note_path.read_text(encoding="utf-8")
        normalized, meta = self.normalize_note_markdown_text(
            text=original,
            path=note_path,
            force_title=force_title,
            touch_updated=touch_updated,
        )
        changed = normalized != original
        if changed:
            note_path.write_text(normalized, encoding="utf-8")

        destination = note_path
        if rename_by_title:
            safe_stem = self._safe_entry_name(meta.get("title", "")) or note_path.stem
            preferred = note_path.with_name(f"{safe_stem}{note_path.suffix or '.md'}")
            destination = self._next_available_note_path(note_path.parent, safe_stem, preferred_current=note_path)
            if destination != note_path:
                note_path.rename(destination)
                changed = True

        return destination, meta, changed

    def save_note_document(self, note_path: str, content: str, indexer: VaultIndexer) -> dict[str, Any]:
        file_path = self._resolve_note_file(note_path)
        file_path.write_text(content, encoding="utf-8")
        final_path, meta, _changed = self.normalize_note_file(
            note_path=file_path,
            touch_updated=True,
            rename_by_title=True,
        )
        indexer.reindex_vault(self.vault_path)
        return {
            "path": final_path,
            "title": str(meta.get("title", final_path.stem)),
            "meta": meta,
        }

    def migrate_note_templates(self, indexer: VaultIndexer) -> dict[str, Any]:
        touched_paths: list[str] = []
        for file_path in self._iter_markdown_files_for_tag_updates():
            if self._is_system_path(file_path.parent) or self._is_tag_path(file_path.parent):
                continue
            _final_path, _meta, changed = self.normalize_note_file(file_path, touch_updated=False, rename_by_title=False)
            if changed:
                touched_paths.append(file_path.as_posix())

        indexer.reindex_vault(self.vault_path)
        return {"updated": len(touched_paths), "paths": touched_paths}

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
            "app": app_settings if isinstance(app_settings, dict) else {},
            "explorer": explorer_settings if isinstance(explorer_settings, dict) else {},
        }

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
            else:
                next_app = {}

        if explorer_settings is not None:
            if isinstance(explorer_settings, dict):
                next_explorer = dict(explorer_settings)
            else:
                next_explorer = {}

        payload = {
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "app": next_app,
            "explorer": next_explorer,
        }
        self.ui_settings_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return payload

    def read_tag_groups(self) -> list[dict[str, Any]]:
        config = self.read_config()
        if isinstance(config, dict) and "tagGroups" in config:
            return self._normalize_tag_groups(config.get("tagGroups"))

        if not self.tag_groups_path.exists():
            return []

        try:
            payload = json.loads(self.tag_groups_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

        if isinstance(payload, dict) and "tagGroups" in payload:
            source = payload.get("tagGroups")
        elif isinstance(payload, dict) and "groups" in payload:
            source = payload.get("groups")
        else:
            source = payload

        normalized = self._normalize_tag_groups(source)
        if normalized:
            # One-way migration: legacy tag_groups.json -> config.json.
            self._write_tag_groups(normalized)
        return normalized

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
                "color": DEFAULT_TAG_GROUP_COLOR,
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

    def move_tag(
        self,
        from_group: str,
        tag_name: str,
        to_group: str,
        apply_to_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[list[dict[str, Any]], int]:
        groups = self.read_tag_groups()
        source_group = self._resolve_group_entry(groups, from_group)
        if source_group is None:
            raise ValueError(f"Tag group not found: {from_group}")

        source_tag = self._resolve_tag_entry(source_group, tag_name)
        if source_tag is None:
            raise ValueError(f"Tag not found: {from_group}:{tag_name}")

        clean_target_group = _normalize_tag_id(to_group)
        if not clean_target_group:
            raise ValueError("Target group cannot be empty")

        target_group = self._resolve_group_entry(groups, clean_target_group)
        if target_group is None:
            target_group = {
                "id": clean_target_group,
                "displayName": clean_target_group,
                "color": DEFAULT_TAG_GROUP_COLOR,
                "tags": [],
            }
            groups.append(target_group)

        target_existing = self._resolve_tag_entry(target_group, str(source_tag.get("id", "")))
        if target_existing is None:
            target_group.setdefault("tags", []).append(
                {
                    "id": str(source_tag.get("id", "")).strip(),
                    "displayName": _normalize_label(str(source_tag.get("displayName", "")).strip())
                    or str(source_tag.get("id", "")).strip(),
                }
            )
            target_group["tags"] = self._sorted_tag_entries(target_group.get("tags", []))

        source_group["tags"] = [
            tag for tag in source_group.get("tags", []) if str(tag.get("id", "")).strip().lower() != str(source_tag.get("id", "")).strip().lower()
        ]

        old_group_id = str(source_group.get("id", "")).strip()
        moved_tag_id = str(source_tag.get("id", "")).strip()
        new_group_id = str(target_group.get("id", "")).strip()
        touched = 0
        if apply_to_notes:
            touched = self._rewrite_tag_references(
                old_key=self._to_tag_key(old_group_id, moved_tag_id),
                new_key=self._to_tag_key(new_group_id, moved_tag_id),
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
        tasks: list[ParsedTask],
        indexer: VaultIndexer,
    ) -> dict[str, Any]:
        now = datetime.now()
        note_id = make_note_id(now)
        created_at = now.isoformat(timespec="seconds")

        note_dir = self.daily_root_path / "captures" / f"{now:%Y-%m-%d}"
        note_dir.mkdir(parents=True, exist_ok=True)
        note_path = note_dir / f"{note_id}.md"

        tag_keys = sorted({tag.key for tag in selected_tags})
        frontmatter = {
            "id": note_id,
            "node_id": note_id,
            "title": text.strip().splitlines()[0][:120] if text.strip() else note_id,
            "type": "capture",
            "created_at": created_at,
            "updated_at": created_at,
            "tags": tag_keys,
            "tags_auto": [],
            "related": [],
            "related_auto": [],
        }
        note_path.write_text(dump_markdown(frontmatter, text), encoding="utf-8")

        title = text.strip().splitlines()[0][:120] if text.strip() else note_id
        indexer.upsert_note(
            note_id=note_id,
            path=str(note_path),
            title=title,
            body=text,
            note_type="capture",
            created_at=created_at,
            updated_at=created_at,
        )
        tag_rows = [
            {
                "category": tag.category,
                "slug": tag.slug,
                "display_name": tag.display_name,
                "source": tag.source,
                "confidence": tag.confidence,
            }
            for tag in selected_tags
        ]
        indexer.set_note_tags(note_id, tag_rows)

        task_ids = []
        for parsed_task in tasks:
            task_id = make_task_id()
            task_ids.append(task_id)
            self._create_task_file(task_id, note_id, parsed_task, now, indexer)

        self._append_to_daily(note_path, note_id, title, created_at, tag_keys)

        groups = self.read_tag_groups()
        self.rebuild_all_tag_pages(groups, indexer)

        return {
            "note_id": note_id,
            "note_path": note_path,
            "task_ids": task_ids,
        }

    def _create_task_file(
        self,
        task_id: str,
        note_id: str,
        task: ParsedTask,
        now: datetime,
        indexer: VaultIndexer,
    ) -> Path:
        status = task.status.lower() if task.status else "open"
        folder = "done" if status == "done" else "open"
        task_path = self.tasks_root_path / folder / f"{task_id}.md"
        ts = now.isoformat(timespec="seconds")

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
            "related": [],
            "related_auto": [],
        }
        body = task.title
        task_path.write_text(dump_markdown(frontmatter, body), encoding="utf-8")

        indexer.add_or_update_task(
            task_id=task_id,
            note_id=note_id,
            path=str(task_path),
            parsed=task,
            created_at=ts,
            updated_at=ts,
        )
        return task_path

    def _append_to_daily(
        self,
        note_path: Path,
        note_id: str,
        title: str,
        created_at: str,
        tag_keys: list[str],
    ) -> None:
        day = created_at[:10]
        daily_path = self.daily_root_path / f"{day}.md"
        if not daily_path.exists():
            fm = {
                "id": f"daily_{day}",
                "type": "daily",
                "created_at": f"{day}T00:00:00",
                "updated_at": created_at,
                "tags": [],
            }
            body = f"# Daily {day}\n"
            daily_path.write_text(dump_markdown(fm, body), encoding="utf-8")

        existing = daily_path.read_text(encoding="utf-8")
        tags_hint = f" | tags: {', '.join(tag_keys)}" if tag_keys else ""
        line = f"- {created_at[11:19]} [{title}]({note_path.as_posix()}) (`{note_id}`){tags_hint}"
        if line not in existing:
            updated = existing.rstrip() + "\n" + line + "\n"
            daily_path.write_text(updated, encoding="utf-8")

    def rebuild_all_tag_pages(self, groups: list[dict[str, Any]], indexer: VaultIndexer) -> None:
        self.tag_root_path.mkdir(parents=True, exist_ok=True)
        for child in self.tag_root_path.iterdir():
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink(missing_ok=True)
            except PermissionError:
                # In some restricted environments, delete operations are blocked.
                # We keep existing files and overwrite known targets below.
                continue

        # Clean up legacy index files from older tag explorer versions.
        for legacy_index in self.tag_root_path.rglob("index.md"):
            try:
                legacy_index.unlink(missing_ok=True)
            except OSError:
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
        open_tasks = self._open_tasks_for_tag(group_slug, tag_slug)
        now = datetime.now().isoformat(timespec="seconds")

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
            body_lines.append("- Noch keine verknuepften Notizen.")
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
        tag_path.write_text(dump_markdown(frontmatter, body), encoding="utf-8")
        return tag_path

    def _open_tasks_for_tag(self, group_slug: str, tag_slug: str) -> list[dict[str, str]]:
        result: list[dict[str, str]] = []
        tag_key = f"{group_slug}:{tag_slug}"
        for task_file in (self.tasks_root_path / "open").rglob("*.md"):
            meta, body = parse_markdown(task_file)
            raw_tags = meta.get("tags", [])
            if isinstance(raw_tags, str):
                raw_tags = [raw_tags]
            tags = [_normalize_tag_key(str(item)) for item in raw_tags if str(item).strip()]
            if tag_key not in tags:
                continue

            title = body.strip().splitlines()[0] if body.strip() else str(meta.get("id", task_file.stem))
            result.append(
                {
                    "id": str(meta.get("id", task_file.stem)),
                    "title": title,
                    "priority": str(meta.get("priority", "M")).upper()[:1] or "M",
                    "due_date": str(meta.get("due_date", "")).strip(),
                    "path": task_file.as_posix(),
                }
            )

        result.sort(key=lambda item: (item["due_date"] or "9999-12-31", item["title"].lower()))
        return result

    def _rewrite_tag_references(self, old_key: str, new_key: str, remove: bool) -> int:
        old_key = _normalize_tag_key(old_key)
        new_key = _normalize_tag_key(new_key)
        if not old_key:
            return 0

        changed = 0
        now = datetime.now().isoformat(timespec="seconds")
        for file_path in self._iter_markdown_files_for_tag_updates():
            meta, body = parse_markdown(file_path)
            raw_tags = meta.get("tags", [])
            if isinstance(raw_tags, str):
                raw_tags = [raw_tags]
            if not isinstance(raw_tags, list):
                continue

            normalized_tags = [_normalize_tag_key(str(item)) for item in raw_tags if _normalize_tag_key(str(item))]
            if old_key not in normalized_tags:
                continue

            next_tags: list[str] = []
            for tag in normalized_tags:
                if tag != old_key:
                    next_tags.append(tag)
                    continue
                if not remove and new_key:
                    next_tags.append(new_key)

            meta["tags"] = _dedupe_sorted(next_tags)
            meta["updated_at"] = now
            file_path.write_text(dump_markdown(meta, body), encoding="utf-8")
            changed += 1

        return changed

    def _iter_markdown_files_for_tag_updates(self) -> list[Path]:
        files: list[Path] = []
        excluded = {"00_inbox", "02_entities", self.tag_root_name, "02_tags", self.system_root_name, "99_system"}
        for child in self.vault_path.iterdir():
            if not child.is_dir() or child.name in excluded or self._is_hidden_legacy_root(child.name):
                continue
            files.extend(child.rglob("*.md"))
        return files

    def _migrate_legacy_inbox(self) -> None:
        inbox_path = self.vault_path / "00_inbox"
        if not inbox_path.exists() or not inbox_path.is_dir():
            return

        moved_paths: list[tuple[str, str]] = []
        capture_root = self.daily_root_path / "captures"
        capture_root.mkdir(parents=True, exist_ok=True)

        for file_path in sorted(inbox_path.rglob("*.md")):
            target_day = file_path.parent.name
            meta, _body = parse_markdown(file_path)
            raw_created_at = str(meta.get("created_at", "")).strip()
            if len(raw_created_at) >= 10 and raw_created_at[4] == "-" and raw_created_at[7] == "-":
                target_day = raw_created_at[:10]

            target_dir = capture_root / target_day
            target_dir.mkdir(parents=True, exist_ok=True)

            target_path = target_dir / file_path.name
            suffix = 2
            while target_path.exists():
                target_path = target_dir / f"{file_path.stem}_{suffix}{file_path.suffix}"
                suffix += 1

            shutil.move(str(file_path), str(target_path))
            moved_paths.append((file_path.as_posix(), target_path.as_posix()))

        daily_root = self.daily_root_path
        if moved_paths and daily_root.exists():
            for daily_file in daily_root.glob("*.md"):
                content = daily_file.read_text(encoding="utf-8")
                updated = content
                for old_path, new_path in moved_paths:
                    updated = updated.replace(old_path, new_path)
                if updated != content:
                    daily_file.write_text(updated, encoding="utf-8")

        try:
            shutil.rmtree(inbox_path)
        except OSError:
            pass

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
        return {
            "key": key,
            "label": self._label_from_group_dir(directory.name),
            "path": str(directory),
            "favorite": key in favorites,
            "canCreateNotes": not self._is_tag_path(directory),
            "canCreateGroups": not self._is_tag_path(directory),
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
            "created_at": created_at,
            "updated_at": updated_at,
            "tags": _dedupe_sorted(manual_tags),
            "tags_auto": _dedupe_sorted(auto_tags),
            "related": _dedupe_sorted(manual_related),
            "related_auto": _dedupe_sorted(auto_related),
        }
        if note_type == "task":
            frontmatter["status"] = _normalize_task_status(status)
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
        return name in {"99_system", "system", ".system"}

    def _is_hidden_legacy_root(self, name: str) -> bool:
        normalized = name.strip().lower()
        if normalized == "system" and (self.vault_path / ".system").is_dir():
            return True
        if normalized == "01_daily" and (self.vault_path / "daily").is_dir():
            return True
        if normalized == "02_tags" and (self.vault_path / "tags").is_dir():
            return True
        if normalized == "03_tasks" and (self.vault_path / "tasks").is_dir():
            return True
        if normalized == "99_system" and ((self.vault_path / "system").is_dir() or (self.vault_path / ".system").is_dir()):
            return True
        return False

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
            "01_daily",
            "02_tags",
            "03_tasks",
            "daily",
            "tags",
            "tasks",
        }

    def _is_daily_group_key(self, key: str) -> bool:
        clean_key = key.replace("\\", "/").strip().strip("/")
        if not clean_key:
            return False
        root = clean_key.split("/", 1)[0]
        return root in {self.daily_root_name, "01_daily", "daily"}

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
            if clean == "01_daily" and (self.vault_path / "daily").is_dir():
                clean = "daily"
            if clean == "02_tags" and (self.vault_path / "tags").is_dir():
                clean = "tags"
            if clean == "03_tasks" and (self.vault_path / "tasks").is_dir():
                clean = "tasks"
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
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "folders": clean,
        }
        self.favorite_folders_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

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
                    "color": DEFAULT_TAG_GROUP_COLOR,
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
                    "color": color or existing.get("color", DEFAULT_TAG_GROUP_COLOR),
                    "tags": merged_tags,
                }

        return sorted(normalized.values(), key=lambda item: str(item.get("displayName", item.get("id", ""))).lower())

    def _write_tag_groups(self, groups: Any) -> None:
        clean_groups = self._normalize_tag_groups(groups)
        config = self.read_config()
        if not isinstance(config, dict):
            config = {}
        config["tagGroups"] = clean_groups
        if "mode" not in config:
            config["mode"] = "core"
        if not isinstance(config.get("openai"), dict):
            config["openai"] = {
                "enabled": False,
                "model": "gpt-4.1-mini",
                "api_key_env": "OPENAI_API_KEY",
            }

        self.config_path.write_text(
            json.dumps(config, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # Keep legacy file in sync for backwards compatibility with older builds.
        legacy_payload = {
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "tagGroups": clean_groups,
        }
        self.tag_groups_path.write_text(
            json.dumps(legacy_payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from .indexer import VaultIndexer
from .markdown_io import dump_markdown, parse_markdown
from .models import ParsedTask, TagSuggestion
from .parser import make_note_id, make_task_id, slugify


def _normalize_label(value: str) -> str:
    return " ".join(value.strip().split())


def _dedupe_sorted(values: list[str]) -> list[str]:
    return sorted(set(values), key=lambda item: item.lower())


def _normalize_tag_key(raw: str) -> str:
    if ":" not in raw:
        return ""
    group, tag = raw.split(":", 1)
    group_slug = slugify(group)
    tag_slug = slugify(tag)
    if not group_slug or not tag_slug:
        return ""
    return f"{group_slug}:{tag_slug}"


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

        if not self.tag_groups_path.exists():
            defaults = {
                "Person": [],
                "Project": [],
                "Customer": [],
                "Machine No": [],
                "Machine Type": [],
            }
            self._write_tag_groups(defaults)

        if not self.favorite_folders_path.exists():
            self._write_favorite_folders([self.daily_root_name, self.tag_root_name, self.tasks_root_name])

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

        siblings = [child for child in parent_path.iterdir() if child.is_dir()]
        for sibling in siblings:
            if self._label_from_group_dir(sibling.name).lower() == clean_name.lower():
                return self._group_payload(sibling, set(self._read_favorite_folders()))

        target_name = token
        counter = 2
        while (parent_path / target_name).exists():
            target_name = f"{token}_{counter}"
            counter += 1

        target_path = parent_path / target_name
        target_path.mkdir(parents=True, exist_ok=True)
        return self._group_payload(target_path, set(self._read_favorite_folders()))

    def create_note_in_group(self, group_key: str, title: str, indexer: VaultIndexer) -> dict[str, Any]:
        clean_key = group_key.replace("\\", "/").strip().strip("/")
        root_dir = self._resolve_group_path(clean_key)
        if self._is_tag_path(root_dir):
            raise ValueError("In Tag-Notes koennen keine neuen Notizen angelegt werden.")

        now = datetime.now()
        created_at = now.isoformat(timespec="seconds")
        note_id = make_note_id(now)
        clean_title = _normalize_label(title) or f"Neue Notiz {now:%Y-%m-%d %H:%M}"
        title_slug = slugify(clean_title) or note_id

        note_dir = root_dir / "notes" if self._is_daily_group_key(clean_key) else root_dir
        note_dir.mkdir(parents=True, exist_ok=True)

        note_path = note_dir / f"{now:%Y%m%d_%H%M%S}_{title_slug}.md"
        suffix = 2
        while note_path.exists():
            note_path = note_dir / f"{now:%Y%m%d_%H%M%S}_{title_slug}_{suffix}.md"
            suffix += 1

        frontmatter = {
            "id": note_id,
            "type": "daily_note" if self._is_daily_path(note_dir) else "note",
            "created_at": created_at,
            "updated_at": created_at,
            "tags": [],
        }
        body = f"# {clean_title}\n\n"
        note_path.write_text(dump_markdown(frontmatter, body), encoding="utf-8")

        indexer.reindex_vault(self.vault_path)
        return {"note_id": note_id, "note_path": note_path}

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

    def read_tag_groups(self) -> dict[str, list[str]]:
        if not self.tag_groups_path.exists():
            return {}

        try:
            payload = json.loads(self.tag_groups_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

        if isinstance(payload, dict) and "groups" in payload:
            source = payload.get("groups")
        else:
            source = payload

        return self._normalize_tag_groups(source)

    def sync_tag_groups_with_index(self, indexer: VaultIndexer) -> dict[str, list[str]]:
        groups = self.read_tag_groups()
        for row in indexer.get_all_tags():
            category = _normalize_label(str(row.get("category", "")))
            tag_name = _normalize_label(str(row.get("display_name") or row.get("slug") or ""))
            if not category or not tag_name:
                continue

            target_group = self._resolve_group_name(groups, category)
            if not target_group:
                target_group = category
                groups[target_group] = []

            target_tag = self._resolve_tag_name(groups[target_group], tag_name)
            if not target_tag:
                groups[target_group] = _dedupe_sorted([*groups[target_group], tag_name])

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def add_tag_group(self, group_name: str, indexer: VaultIndexer) -> dict[str, list[str]]:
        groups = self.read_tag_groups()
        clean_group = _normalize_label(group_name)
        if not clean_group:
            return groups

        existing = self._resolve_group_name(groups, clean_group)
        if not existing:
            groups[clean_group] = []

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def add_tag_to_group(self, group_name: str, tag_name: str, indexer: VaultIndexer) -> dict[str, list[str]]:
        groups = self.read_tag_groups()
        clean_group = _normalize_label(group_name)
        clean_tag = _normalize_label(tag_name)
        if not clean_group or not clean_tag:
            return groups

        target_group = self._resolve_group_name(groups, clean_group)
        if not target_group:
            target_group = clean_group
            groups[target_group] = []

        existing_tag = self._resolve_tag_name(groups[target_group], clean_tag)
        if not existing_tag:
            groups[target_group] = _dedupe_sorted([*groups[target_group], clean_tag])

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups

    def rename_tag_group(
        self,
        group_name: str,
        new_group_name: str,
        apply_to_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[dict[str, list[str]], int]:
        groups = self.read_tag_groups()
        source_group = self._resolve_group_name(groups, group_name)
        if not source_group:
            raise ValueError(f"Tag group not found: {group_name}")

        next_group = _normalize_label(new_group_name)
        if not next_group:
            raise ValueError("New group name cannot be empty")

        duplicate_group = self._resolve_group_name(groups, next_group)
        if duplicate_group and duplicate_group != source_group:
            raise ValueError(f"Tag group already exists: {next_group}")

        if next_group == source_group:
            return groups, 0

        source_tags = list(groups.get(source_group, []))
        groups.pop(source_group, None)
        groups[next_group] = _dedupe_sorted(source_tags)

        touched = 0
        if apply_to_notes:
            for tag_name in source_tags:
                touched += self._rewrite_tag_references(
                    old_key=self._to_tag_key(source_group, tag_name),
                    new_key=self._to_tag_key(next_group, tag_name),
                    remove=False,
                )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def delete_tag_group(
        self,
        group_name: str,
        remove_from_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[dict[str, list[str]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_name(groups, group_name)
        if not target_group:
            raise ValueError(f"Tag group not found: {group_name}")

        target_tags = list(groups.get(target_group, []))
        groups.pop(target_group, None)

        touched = 0
        if remove_from_notes:
            for tag_name in target_tags:
                touched += self._rewrite_tag_references(
                    old_key=self._to_tag_key(target_group, tag_name),
                    new_key="",
                    remove=True,
                )
            if touched > 0:
                indexer.reindex_vault(self.vault_path)

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def rename_tag(
        self,
        group_name: str,
        tag_name: str,
        new_tag_name: str,
        apply_to_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[dict[str, list[str]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_name(groups, group_name)
        if not target_group:
            raise ValueError(f"Tag group not found: {group_name}")

        old_tag = self._resolve_tag_name(groups[target_group], tag_name)
        if not old_tag:
            raise ValueError(f"Tag not found: {group_name}:{tag_name}")

        next_tag = _normalize_label(new_tag_name)
        if not next_tag:
            raise ValueError("New tag name cannot be empty")

        duplicate = self._resolve_tag_name(groups[target_group], next_tag)
        if duplicate and duplicate != old_tag:
            raise ValueError(f"Tag already exists: {target_group}:{next_tag}")

        groups[target_group] = [next_tag if item == old_tag else item for item in groups[target_group]]
        groups[target_group] = _dedupe_sorted(groups[target_group])

        old_key = self._to_tag_key(target_group, old_tag)
        new_key = self._to_tag_key(target_group, next_tag)
        touched = 0
        if apply_to_notes:
            touched = self._rewrite_tag_references(old_key=old_key, new_key=new_key, remove=False)
            indexer.reindex_vault(self.vault_path)

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
    ) -> tuple[dict[str, list[str]], int]:
        groups = self.read_tag_groups()
        source_group = self._resolve_group_name(groups, from_group)
        if not source_group:
            raise ValueError(f"Tag group not found: {from_group}")

        source_tag = self._resolve_tag_name(groups[source_group], tag_name)
        if not source_tag:
            raise ValueError(f"Tag not found: {from_group}:{tag_name}")

        clean_target_group = _normalize_label(to_group)
        if not clean_target_group:
            raise ValueError("Target group cannot be empty")

        target_group = self._resolve_group_name(groups, clean_target_group)
        if not target_group:
            target_group = clean_target_group
            groups[target_group] = []

        existing_target = self._resolve_tag_name(groups[target_group], source_tag)
        if not existing_target:
            groups[target_group] = _dedupe_sorted([*groups[target_group], source_tag])
        groups[source_group] = [item for item in groups[source_group] if item != source_tag]

        old_key = self._to_tag_key(source_group, source_tag)
        new_key = self._to_tag_key(target_group, source_tag)
        touched = 0
        if apply_to_notes:
            touched = self._rewrite_tag_references(old_key=old_key, new_key=new_key, remove=False)
            indexer.reindex_vault(self.vault_path)

        self._write_tag_groups(groups)
        self.rebuild_all_tag_pages(groups, indexer)
        return groups, touched

    def delete_tag(
        self,
        group_name: str,
        tag_name: str,
        remove_from_notes: bool,
        indexer: VaultIndexer,
    ) -> tuple[dict[str, list[str]], int]:
        groups = self.read_tag_groups()
        target_group = self._resolve_group_name(groups, group_name)
        if not target_group:
            raise ValueError(f"Tag group not found: {group_name}")

        target_tag = self._resolve_tag_name(groups[target_group], tag_name)
        if not target_tag:
            raise ValueError(f"Tag not found: {group_name}:{tag_name}")

        groups[target_group] = [item for item in groups[target_group] if item != target_tag]
        touched = 0
        if remove_from_notes:
            touched = self._rewrite_tag_references(
                old_key=self._to_tag_key(target_group, target_tag),
                new_key="",
                remove=True,
            )
            indexer.reindex_vault(self.vault_path)

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
            "type": "capture",
            "created_at": created_at,
            "updated_at": created_at,
            "tags": tag_keys,
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
        for tag in selected_tags:
            group_name = self._resolve_group_name(groups, tag.category) or _normalize_label(tag.category)
            display_name = _normalize_label(tag.display_name or tag.slug)
            if not group_name or not display_name:
                continue
            groups.setdefault(group_name, [])
            if not self._resolve_tag_name(groups[group_name], display_name):
                groups[group_name] = _dedupe_sorted([*groups[group_name], display_name])

        self._write_tag_groups(groups)
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
            "type": "task",
            "note_id": note_id,
            "created_at": ts,
            "updated_at": ts,
            "status": status,
            "priority": (task.priority or "M").upper()[:1],
            "due_date": task.due_date or "",
            "project_tag": task.project_tag or "",
            "tags": task.tags,
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

    def rebuild_all_tag_pages(self, groups: dict[str, list[str]], indexer: VaultIndexer) -> None:
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

        root_lines = ["# Tag Uebersicht", "", "## Gruppen"]
        for group_name in sorted(groups, key=lambda item: item.lower()):
            group_slug = slugify(group_name)
            group_dir = self.tag_root_path / group_slug
            group_dir.mkdir(parents=True, exist_ok=True)

            tags = _dedupe_sorted(groups.get(group_name, []))
            self._write_group_index(group_name, tags, group_dir)
            root_lines.append(f"- [{group_name}]({group_slug}/index.md) ({len(tags)} Tags)")

            for tag_name in tags:
                self.rebuild_tag_page(group_name, tag_name, indexer)

        (self.tag_root_path / "index.md").write_text("\n".join(root_lines) + "\n", encoding="utf-8")

    def rebuild_tag_page(self, group_name: str, tag_name: str, indexer: VaultIndexer) -> Path:
        group_slug = slugify(group_name)
        tag_slug = slugify(tag_name)
        if not group_slug or not tag_slug:
            raise ValueError(f"Invalid tag reference: {group_name}:{tag_name}")

        tag_dir = self.tag_root_path / group_slug / tag_slug
        tag_dir.mkdir(parents=True, exist_ok=True)
        tag_path = tag_dir / "overview.md"

        rows = indexer.notes_for_tag(group_slug, tag_slug)
        open_tasks = self._open_tasks_for_tag(group_slug, tag_slug)
        now = datetime.now().isoformat(timespec="seconds")

        frontmatter = {
            "id": f"tag_{group_slug}_{tag_slug}",
            "type": "tag_index",
            "group": group_name,
            "tag": tag_name,
            "created_at": now,
            "updated_at": now,
            "tags": [f"{group_slug}:{tag_slug}"],
        }

        body_lines = [
            f"# {group_name} / {tag_name}",
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

    def _write_group_index(self, group_name: str, tags: list[str], group_dir: Path) -> None:
        lines = [f"# {group_name}", "", "## Tags"]
        if not tags:
            lines.append("- Noch keine Tags in dieser Gruppe.")
        else:
            for tag_name in tags:
                tag_slug = slugify(tag_name)
                lines.append(f"- [{tag_name}]({tag_slug}/overview.md)")

        (group_dir / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

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

    def _collect_custom_group_payloads(self, root: Path, favorites: set[str]) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        payloads.append(self._group_payload(root, favorites))
        child_dirs = self._sorted_dirs(root)
        for child in child_dirs:
            if self._is_system_name(child.name):
                continue
            payloads.extend(self._collect_custom_group_payloads(child, favorites))
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

    def _sorted_dirs(self, directory: Path) -> list[Path]:
        return sorted([child for child in directory.iterdir() if child.is_dir()], key=lambda item: item.name.lower())

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
            if not target.exists() or not target.is_dir():
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

    def _to_tag_key(self, group_name: str, tag_name: str) -> str:
        return f"{slugify(group_name)}:{slugify(tag_name)}"

    def _resolve_group_name(self, groups: dict[str, list[str]], name: str) -> str | None:
        clean_name = _normalize_label(name)
        if not clean_name:
            return None

        for candidate in groups:
            if candidate.lower() == clean_name.lower():
                return candidate
        clean_slug = slugify(clean_name)
        for candidate in groups:
            if slugify(candidate) == clean_slug:
                return candidate
        return None

    def _resolve_tag_name(self, tags: list[str], name: str) -> str | None:
        clean_name = _normalize_label(name)
        if not clean_name:
            return None

        for candidate in tags:
            if candidate.lower() == clean_name.lower():
                return candidate

        clean_slug = slugify(clean_name)
        for candidate in tags:
            if slugify(candidate) == clean_slug:
                return candidate
        return None

    def _normalize_tag_groups(self, value: Any) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            return {}

        normalized: dict[str, list[str]] = {}
        for raw_group, raw_tags in value.items():
            if not isinstance(raw_group, str):
                continue

            group_name = _normalize_label(raw_group)
            if not group_name:
                continue

            if not isinstance(raw_tags, list):
                normalized[group_name] = []
                continue

            tags = [_normalize_label(str(item)) for item in raw_tags]
            tags = [item for item in tags if item]
            normalized[group_name] = _dedupe_sorted(tags)

        return dict(sorted(normalized.items(), key=lambda item: item[0].lower()))

    def _write_tag_groups(self, groups: dict[str, list[str]]) -> None:
        clean_groups = self._normalize_tag_groups(groups)
        payload = {
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "groups": clean_groups,
        }
        self.tag_groups_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

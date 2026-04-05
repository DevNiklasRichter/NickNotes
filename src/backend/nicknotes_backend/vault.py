from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from .indexer import VaultIndexer
from .markdown_io import dump_markdown, parse_markdown
from .models import ParsedTask, TAG_CATEGORIES, TagSuggestion
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
        self.system_path = vault_path / "99_system"
        self.tag_root_path = vault_path / "02_tags"
        self.legacy_entities_path = vault_path / "02_entities"
        self.db_path = self.system_path / "index.db"
        self.config_path = self.system_path / "config.json"
        self.tag_groups_path = self.system_path / "tag_groups.json"

    def ensure_structure(self) -> None:
        (self.vault_path / "00_inbox").mkdir(parents=True, exist_ok=True)
        (self.vault_path / "01_daily").mkdir(parents=True, exist_ok=True)
        self.tag_root_path.mkdir(parents=True, exist_ok=True)
        self.legacy_entities_path.mkdir(parents=True, exist_ok=True)
        for category in TAG_CATEGORIES:
            (self.legacy_entities_path / category).mkdir(parents=True, exist_ok=True)
        (self.vault_path / "03_tasks" / "open").mkdir(parents=True, exist_ok=True)
        (self.vault_path / "03_tasks" / "done").mkdir(parents=True, exist_ok=True)
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

        note_dir = self.vault_path / "00_inbox" / f"{now:%Y-%m-%d}"
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

        self._append_to_daily(note_path, note_id, title, created_at)

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
        task_path = self.vault_path / "03_tasks" / folder / f"{task_id}.md"
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

    def _append_to_daily(self, note_path: Path, note_id: str, title: str, created_at: str) -> None:
        day = created_at[:10]
        daily_path = self.vault_path / "01_daily" / f"{day}.md"
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
        line = f"- {created_at[11:19]} [{title}]({note_path.as_posix()}) (`{note_id}`)"
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
        for task_file in (self.vault_path / "03_tasks" / "open").rglob("*.md"):
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
        for root in ("00_inbox", "01_daily", "03_tasks"):
            root_path = self.vault_path / root
            if root_path.exists():
                files.extend(root_path.rglob("*.md"))
        return files

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

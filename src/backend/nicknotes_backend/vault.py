from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .indexer import VaultIndexer
from .markdown_io import dump_markdown
from .models import ParsedTask, TAG_CATEGORIES, TagSuggestion
from .parser import make_note_id, make_task_id


class VaultManager:
    def __init__(self, vault_path: Path):
        self.vault_path = vault_path
        self.system_path = vault_path / "99_system"
        self.db_path = self.system_path / "index.db"
        self.config_path = self.system_path / "config.json"

    def ensure_structure(self) -> None:
        (self.vault_path / "00_inbox").mkdir(parents=True, exist_ok=True)
        (self.vault_path / "01_daily").mkdir(parents=True, exist_ok=True)
        (self.vault_path / "02_entities").mkdir(parents=True, exist_ok=True)
        for category in TAG_CATEGORIES:
            (self.vault_path / "02_entities" / category).mkdir(parents=True, exist_ok=True)
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

    def read_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}

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

        touched_entities = {(tag.category, tag.slug) for tag in selected_tags}
        for category, slug in touched_entities:
            self.rebuild_entity_page(category, slug, indexer)

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

    def rebuild_entity_page(self, category: str, slug: str, indexer: VaultIndexer) -> Path:
        if category not in TAG_CATEGORIES:
            raise ValueError(f"Unknown category: {category}")
        entity_dir = self.vault_path / "02_entities" / category
        entity_dir.mkdir(parents=True, exist_ok=True)
        entity_path = entity_dir / f"{slug}.md"
        rows = indexer.notes_for_tag(category, slug)
        now = datetime.now().isoformat(timespec="seconds")

        frontmatter = {
            "id": f"entity_{category}_{slug}",
            "type": "entity",
            "category": category,
            "slug": slug,
            "created_at": now,
            "updated_at": now,
            "tags": [f"{category}:{slug}"],
        }

        body_lines = [
            f"# {category}:{slug}",
            "",
            "## Chronologie",
        ]
        if not rows:
            body_lines.append("- Noch keine verknuepften Notizen.")
        else:
            for row in rows:
                body_lines.append(
                    f"- {row['created_at']} [{row['title']}]({Path(row['path']).as_posix()}) (`{row['id']}`)"
                )
        body = "\n".join(body_lines) + "\n"
        entity_path.write_text(dump_markdown(frontmatter, body), encoding="utf-8")
        return entity_path


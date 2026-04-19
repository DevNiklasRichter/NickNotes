from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .markdown_io import parse_markdown
from .models import ParsedTask, TagRef
from .parser import slugify
from .todos import ExtractedTodo, extract_todos_from_body


INLINE_TITLE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}", re.IGNORECASE)
BODY_HASHTAG_PATTERN = re.compile(r"(^|\s)#([A-Za-z0-9][A-Za-z0-9_/-]{1,60})")


class VaultIndexer:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._configure_connection()
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def _configure_connection(self) -> None:
        with self._lock:
            # MEMORY journal is more robust in restricted/sandboxed filesystems.
            self.conn.execute("PRAGMA journal_mode=MEMORY;")
            self.conn.execute("PRAGMA temp_store=MEMORY;")
            self.conn.execute("PRAGMA synchronous=NORMAL;")
            self.conn.execute("PRAGMA foreign_keys=ON;")

    def _init_schema(self) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS notes (
                  id TEXT PRIMARY KEY,
                  path TEXT NOT NULL,
                  title TEXT,
                  body TEXT,
                  note_type TEXT,
                  created_at TEXT,
                  updated_at TEXT
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS tags (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category TEXT NOT NULL,
                  slug TEXT NOT NULL,
                  display_name TEXT NOT NULL,
                  UNIQUE(category, slug)
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS note_tags (
                  note_id TEXT NOT NULL,
                  tag_id INTEGER NOT NULL,
                  source TEXT NOT NULL,
                  confidence REAL NOT NULL,
                  PRIMARY KEY(note_id, tag_id),
                  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
                  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                  id TEXT PRIMARY KEY,
                  note_id TEXT,
                  path TEXT,
                  title TEXT NOT NULL,
                  status TEXT NOT NULL,
                  priority TEXT NOT NULL,
                  due_date TEXT,
                  project_tag TEXT,
                  estimate_minutes INTEGER,
                  completed_at TEXT,
                  blocked_by_ids_json TEXT NOT NULL DEFAULT '[]',
                  waiting_for TEXT,
                  follow_up_date TEXT,
                  blocked_reason TEXT,
                  next_action_hint TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS todos (
                  id TEXT PRIMARY KEY,
                  note_id TEXT NOT NULL,
                  note_path TEXT NOT NULL,
                  line_no INTEGER NOT NULL,
                  block_ref TEXT,
                  checked INTEGER NOT NULL,
                  raw_text TEXT NOT NULL,
                  explicit_tags_json TEXT NOT NULL,
                  inherited_tags_json TEXT NOT NULL,
                  links_json TEXT NOT NULL,
                  promoted INTEGER NOT NULL DEFAULT 0,
                  promoted_task_id TEXT,
                  completed_at TEXT,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_note ON todos(note_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_checked ON todos(checked);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_promoted ON todos(promoted);")
            cur.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
                USING fts5(note_id UNINDEXED, title, body);
                """
            )
            self._ensure_tasks_schema(cur)
            self._ensure_todos_schema(cur)
            self.conn.commit()

    def _ensure_tasks_schema(self, cur: sqlite3.Cursor) -> None:
        cur.execute("PRAGMA table_info(tasks);")
        columns = {str(row["name"]) for row in cur.fetchall()}
        migrations: list[str] = []
        if "estimate_minutes" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER;")
        if "completed_at" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN completed_at TEXT;")
        if "blocked_by_ids_json" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN blocked_by_ids_json TEXT NOT NULL DEFAULT '[]';")
        if "waiting_for" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN waiting_for TEXT;")
        if "follow_up_date" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN follow_up_date TEXT;")
        if "blocked_reason" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN blocked_reason TEXT;")
        if "next_action_hint" not in columns:
            migrations.append("ALTER TABLE tasks ADD COLUMN next_action_hint TEXT;")
        for statement in migrations:
            cur.execute(statement)

    def _ensure_todos_schema(self, cur: sqlite3.Cursor) -> None:
        cur.execute("PRAGMA table_info(todos);")
        columns = {str(row["name"]) for row in cur.fetchall()}
        migrations: list[str] = []
        if "completed_at" not in columns:
            migrations.append("ALTER TABLE todos ADD COLUMN completed_at TEXT;")
        for statement in migrations:
            cur.execute(statement)

    def clear_all(self) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("DELETE FROM note_tags;")
            cur.execute("DELETE FROM tasks;")
            cur.execute("DELETE FROM todos;")
            cur.execute("DELETE FROM tags;")
            cur.execute("DELETE FROM notes;")
            cur.execute("DELETE FROM notes_fts;")
            self.conn.commit()

    def upsert_note(
        self,
        note_id: str,
        path: str,
        title: str,
        body: str,
        note_type: str,
        created_at: str,
        updated_at: str,
    ) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                INSERT INTO notes(id, path, title, body, note_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  path=excluded.path,
                  title=excluded.title,
                  body=excluded.body,
                  note_type=excluded.note_type,
                  created_at=excluded.created_at,
                  updated_at=excluded.updated_at;
                """,
                (note_id, path, title, body, note_type, created_at, updated_at),
            )
            cur.execute("DELETE FROM notes_fts WHERE note_id = ?;", (note_id,))
            cur.execute(
                "INSERT INTO notes_fts(note_id, title, body) VALUES (?, ?, ?);",
                (note_id, title, body),
            )
            self.conn.commit()

    def _ensure_tag(self, ref: TagRef) -> int:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                INSERT INTO tags(category, slug, display_name)
                VALUES (?, ?, ?)
                ON CONFLICT(category, slug) DO UPDATE SET
                  display_name=excluded.display_name;
                """,
                (ref.category, ref.slug, ref.display_name),
            )
            cur.execute(
                "SELECT id FROM tags WHERE category = ? AND slug = ?;",
                (ref.category, ref.slug),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError("Failed to fetch tag after upsert.")
            return int(row["id"])

    def set_note_tags(self, note_id: str, tag_rows: list[dict[str, Any]]) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("DELETE FROM note_tags WHERE note_id = ?;", (note_id,))
            for row in tag_rows:
                ref = TagRef(
                    category=row["category"],
                    slug=row["slug"],
                    display_name=row.get("display_name") or row["slug"],
                )
                tag_id = self._ensure_tag(ref)
                cur.execute(
                    """
                    INSERT INTO note_tags(note_id, tag_id, source, confidence)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(note_id, tag_id) DO UPDATE SET
                      source=excluded.source,
                      confidence=excluded.confidence;
                    """,
                    (
                        note_id,
                        tag_id,
                        row.get("source", "manual"),
                        float(row.get("confidence", 1.0)),
                    ),
                )
            self._prune_orphan_tags(cur)
            self.conn.commit()

    def add_or_update_task(
        self,
        task_id: str,
        note_id: str | None,
        path: str | None,
        parsed: ParsedTask,
        created_at: str,
        updated_at: str,
    ) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                INSERT INTO tasks(
                  id, note_id, path, title, status, priority, due_date, project_tag,
                  estimate_minutes, completed_at, blocked_by_ids_json, waiting_for, follow_up_date, blocked_reason, next_action_hint,
                  created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  note_id=excluded.note_id,
                  path=excluded.path,
                  title=excluded.title,
                  status=excluded.status,
                  priority=excluded.priority,
                  due_date=excluded.due_date,
                  project_tag=excluded.project_tag,
                  estimate_minutes=excluded.estimate_minutes,
                  completed_at=excluded.completed_at,
                  blocked_by_ids_json=excluded.blocked_by_ids_json,
                  waiting_for=excluded.waiting_for,
                  follow_up_date=excluded.follow_up_date,
                  blocked_reason=excluded.blocked_reason,
                  next_action_hint=excluded.next_action_hint,
                  updated_at=excluded.updated_at;
                """,
                (
                    task_id,
                    note_id,
                    path,
                    parsed.title,
                    parsed.status,
                    parsed.priority,
                    parsed.due_date,
                    parsed.project_tag,
                    parsed.estimate_minutes,
                    _normalize_iso_timestamp(parsed.completed_at),
                    json.dumps(_normalize_task_id_list(parsed.blocked_by_ids, exclude_id=task_id), ensure_ascii=False),
                    _normalize_free_text(parsed.waiting_for),
                    _normalize_iso_date(parsed.follow_up_date),
                    _normalize_free_text(parsed.blocked_reason),
                    _normalize_free_text(parsed.next_action_hint),
                    created_at,
                    updated_at,
                ),
            )
            self.conn.commit()

    def clear_note_todos(self, note_id: str) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM todos WHERE note_id = ?;", (note_id,))
            self.conn.commit()

    def set_note_todos(
        self,
        note_id: str,
        note_path: str,
        todos: list[ExtractedTodo],
        updated_at: str,
    ) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, checked, completed_at
                FROM todos
                WHERE note_id = ?;
                """,
                (note_id,),
            )
            existing_rows = [dict(row) for row in cur.fetchall()]
            existing_by_id: dict[str, dict[str, Any]] = {str(row.get("id")): row for row in existing_rows if row.get("id")}
            cur.execute("DELETE FROM todos WHERE note_id = ?;", (note_id,))
            for todo in todos:
                previous_row = existing_by_id.get(todo.id) or {}
                previous_completed_at = _normalize_iso_timestamp(previous_row.get("completed_at"))
                if todo.checked:
                    completed_at = previous_completed_at or (updated_at or datetime.now().isoformat(timespec="seconds"))
                else:
                    completed_at = None
                cur.execute(
                    """
                    INSERT INTO todos(
                      id, note_id, note_path, line_no, block_ref, checked, raw_text,
                      explicit_tags_json, inherited_tags_json, links_json,
                      promoted, promoted_task_id, completed_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        todo.id,
                        note_id,
                        note_path,
                        int(todo.line_no),
                        todo.block_ref,
                        1 if todo.checked else 0,
                        todo.raw_text,
                        json.dumps(todo.explicit_tags, ensure_ascii=False),
                        json.dumps(todo.inherited_tags, ensure_ascii=False),
                        json.dumps(todo.links, ensure_ascii=False),
                        1 if todo.promoted else 0,
                        todo.promoted_task_id,
                        _normalize_iso_timestamp(completed_at),
                        updated_at,
                    ),
                )
            self.conn.commit()

    def list_todos(self) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT
                  t.id,
                  t.note_id,
                  t.note_path,
                  t.line_no,
                  t.block_ref,
                  t.checked,
                  t.raw_text,
                  t.explicit_tags_json,
                  t.inherited_tags_json,
                  t.links_json,
                  t.promoted,
                  t.promoted_task_id,
                  t.completed_at,
                  t.updated_at,
                  n.title AS note_title
                FROM todos t
                LEFT JOIN notes n ON n.id = t.note_id
                ORDER BY t.checked ASC, t.updated_at DESC, t.note_path ASC, t.line_no ASC;
                """
            )
            rows = [dict(row) for row in cur.fetchall()]
            return [_hydrate_todo_row(row) for row in rows]

    def get_todo(self, todo_id: str) -> dict[str, Any] | None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT
                  t.id,
                  t.note_id,
                  t.note_path,
                  t.line_no,
                  t.block_ref,
                  t.checked,
                  t.raw_text,
                  t.explicit_tags_json,
                  t.inherited_tags_json,
                  t.links_json,
                  t.promoted,
                  t.promoted_task_id,
                  t.completed_at,
                  t.updated_at,
                  n.title AS note_title
                FROM todos t
                LEFT JOIN notes n ON n.id = t.note_id
                WHERE t.id = ?;
                """,
                (todo_id,),
            )
            row = cur.fetchone()
            return _hydrate_todo_row(dict(row)) if row else None

    def remove_projection_for_path(self, path: str) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("SELECT id FROM notes WHERE path = ?;", (path,))
            note_ids = [str(row["id"]) for row in cur.fetchall()]
            if note_ids:
                cur.executemany("DELETE FROM notes WHERE id = ?;", [(note_id,) for note_id in note_ids])
            cur.execute("DELETE FROM tasks WHERE path = ?;", (path,))
            self._prune_orphan_tags(cur)
            self.conn.commit()

    def reindex_markdown_file(self, vault_path: Path, file_path: Path) -> dict[str, int]:
        resolved = file_path.resolve()
        self.remove_projection_for_path(str(resolved))

        if not resolved.exists() or not resolved.is_file() or resolved.suffix.lower() != ".md":
            return {"notes": 0, "tasks": 0}

        try:
            relative = resolved.relative_to(vault_path.resolve()).as_posix()
        except ValueError:
            return {"notes": 0, "tasks": 0}

        top = relative.split("/", 1)[0].lower()
        hidden_roots = {".system", "system", "99_system", ".media", "02_entities", "tags", "02_tags"}
        if top in hidden_roots:
            return {"notes": 0, "tasks": 0}
        if top in {"tasks", "03_tasks"}:
            return {"notes": 0, "tasks": self._index_task_markdown(resolved)}

        return {"notes": self._index_note_markdown(resolved), "tasks": 0}

    def _prune_orphan_tags(self, cur: sqlite3.Cursor) -> None:
        cur.execute(
            """
            DELETE FROM tags
            WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags);
            """
        )

    def get_all_tags(self) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT category, slug, display_name FROM tags ORDER BY category, display_name;"
            )
            return [dict(row) for row in cur.fetchall()]

    def search_notes(self, query: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            cleaned = query.strip()
            if not cleaned:
                cur.execute(
                    """
                    SELECT id, title, path, note_type, created_at, updated_at
                    FROM notes
                    ORDER BY updated_at DESC
                    LIMIT ?;
                    """,
                    (limit,),
                )
                return [dict(row) for row in cur.fetchall()]

            try:
                cur.execute(
                    """
                    SELECT n.id, n.title, n.path, n.note_type, n.created_at, n.updated_at
                    FROM notes_fts f
                    JOIN notes n ON n.id = f.note_id
                    WHERE notes_fts MATCH ?
                    ORDER BY n.updated_at DESC
                    LIMIT ?;
                    """,
                    (cleaned, limit),
                )
                rows = cur.fetchall()
                if rows:
                    return [dict(row) for row in rows]
            except sqlite3.OperationalError:
                pass

            like = f"%{cleaned}%"
            cur.execute(
                """
                SELECT id, title, path, note_type, created_at, updated_at
                FROM notes
                WHERE title LIKE ? OR body LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?;
                """,
                (like, like, limit),
            )
            return [dict(row) for row in cur.fetchall()]

    def list_tasks(self, include_done: bool = False) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            if include_done:
                cur.execute(
                    """
                    SELECT
                      id,
                      title,
                      status,
                      priority,
                      due_date,
                      project_tag,
                      estimate_minutes,
                      completed_at,
                      blocked_by_ids_json,
                      waiting_for,
                      follow_up_date,
                      blocked_reason,
                      next_action_hint,
                      updated_at,
                      path
                    FROM tasks
                    ORDER BY
                      CASE priority WHEN 'H' THEN 1 WHEN 'M' THEN 2 ELSE 3 END,
                      COALESCE(due_date, '9999-12-31') ASC,
                      updated_at DESC;
                    """
                )
            else:
                cur.execute(
                    """
                    SELECT
                      id,
                      title,
                      status,
                      priority,
                      due_date,
                      project_tag,
                      estimate_minutes,
                      completed_at,
                      blocked_by_ids_json,
                      waiting_for,
                      follow_up_date,
                      blocked_reason,
                      next_action_hint,
                      updated_at,
                      path
                    FROM tasks
                    WHERE status <> 'done'
                    ORDER BY
                      CASE priority WHEN 'H' THEN 1 WHEN 'M' THEN 2 ELSE 3 END,
                      COALESCE(due_date, '9999-12-31') ASC,
                      updated_at DESC;
                    """
                )
            rows = [dict(row) for row in cur.fetchall()]
            for row in rows:
                tags, related = self._extract_task_property_tokens(path=str(row.get("path") or ""))
                row["tags"] = tags
                row["related"] = related
                row["estimate_minutes"] = _normalize_estimate_minutes(row.get("estimate_minutes"))
                row["completed_at"] = _normalize_iso_timestamp(row.get("completed_at"))
                row["blocked_by_ids"] = _normalize_task_id_list(_safe_json_list(row.get("blocked_by_ids_json")), exclude_id=str(row.get("id") or ""))
                row["waiting_for"] = _normalize_free_text(row.get("waiting_for"))
                row["follow_up_date"] = _normalize_iso_date(row.get("follow_up_date"))
                row["blocked_reason"] = _normalize_free_text(row.get("blocked_reason"))
                row["next_action_hint"] = _normalize_free_text(row.get("next_action_hint"))
                row.pop("blocked_by_ids_json", None)
            return rows

    def _extract_task_property_tokens(self, path: str) -> tuple[list[str], list[str]]:
        tag_values: set[str] = set()
        related_values: set[str] = set()

        clean_path = path.strip()
        if clean_path:
            file_path = Path(clean_path)
            if file_path.exists() and file_path.suffix.lower() == ".md":
                try:
                    meta, _body = parse_markdown(file_path)
                    for raw_tag in _ensure_string_list(meta.get("tags", [])):
                        normalized = _normalize_tag_value(raw_tag)
                        if normalized:
                            tag_values.add(normalized)
                    for raw_tag in _extract_body_auto_tags(_body):
                        normalized = _normalize_tag_value(raw_tag)
                        if normalized:
                            tag_values.add(normalized)
                    for raw_related in _ensure_string_list(meta.get("related", [])):
                        normalized = _normalize_related_value(raw_related)
                        if normalized:
                            related_values.add(normalized)
                    for raw_related in _ensure_string_list(meta.get("related_auto", [])):
                        normalized = _normalize_related_value(raw_related)
                        if normalized:
                            related_values.add(normalized)
                except OSError:
                    pass

        return sorted(tag_values, key=lambda item: item.lower()), sorted(related_values, key=lambda item: item.lower())

    def notes_for_tag(self, category: str, slug: str) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT n.id, n.path, n.title, n.created_at, n.updated_at
                FROM tags t
                JOIN note_tags nt ON nt.tag_id = t.id
                JOIN notes n ON n.id = nt.note_id
                WHERE t.category = ? AND t.slug = ?
                  AND n.note_type <> 'tag_index'
                ORDER BY n.created_at DESC;
                """,
                (category, slug),
            )
            return [dict(row) for row in cur.fetchall()]

    def daily_summary(self, day: date) -> dict[str, Any]:
        day_str = day.isoformat()
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM notes WHERE substr(created_at, 1, 10) = ?;",
                (day_str,),
            )
            notes_count = int(cur.fetchone()["cnt"])
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM tasks
                WHERE status <> 'done' AND (due_date IS NULL OR due_date >= ?);
                """,
                (day_str,),
            )
            open_count = int(cur.fetchone()["cnt"])
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM tasks
                WHERE status = 'done' AND substr(COALESCE(completed_at, updated_at), 1, 10) = ?;
                """,
                (day_str,),
            )
            done_count = int(cur.fetchone()["cnt"])
        return {
            "date": day_str,
            "new_notes": notes_count,
            "open_tasks": open_count,
            "done_today": done_count,
        }

    def weekly_summary(self, end_day: date) -> dict[str, Any]:
        start = end_day - timedelta(days=6)
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM notes
                WHERE substr(created_at, 1, 10) BETWEEN ? AND ?;
                """,
                (start.isoformat(), end_day.isoformat()),
            )
            notes_count = int(cur.fetchone()["cnt"])
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM tasks
                WHERE status <> 'done';
                """
            )
            open_tasks = int(cur.fetchone()["cnt"])
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM tasks
                WHERE status = 'done'
                  AND substr(COALESCE(completed_at, updated_at), 1, 10) BETWEEN ? AND ?;
                """,
                (start.isoformat(), end_day.isoformat()),
            )
            done_week = int(cur.fetchone()["cnt"])
        return {
            "from": start.isoformat(),
            "to": end_day.isoformat(),
            "notes_total": notes_count,
            "tasks_open": open_tasks,
            "tasks_done": done_week,
        }

    def reindex_vault(self, vault_path: Path) -> dict[str, int]:
        self.clear_all()
        notes_indexed = 0
        tasks_indexed = 0

        excluded_note_roots = {"00_inbox", "tasks", "03_tasks", ".system", "system", "99_system", "02_entities"}
        if (vault_path / "daily").is_dir():
            excluded_note_roots.add("01_daily")
        if (vault_path / "tags").is_dir():
            excluded_note_roots.add("02_tags")
        if (vault_path / "tasks").is_dir():
            excluded_note_roots.add("03_tasks")
        if (vault_path / "system").is_dir():
            excluded_note_roots.add("99_system")
        for child in vault_path.iterdir():
            if not child.is_dir() or child.name in excluded_note_roots:
                continue
            for md in child.rglob("*.md"):
                notes_indexed += self._index_note_markdown(md)

        task_root = vault_path / "tasks"
        if not task_root.is_dir():
            task_root = vault_path / "03_tasks"
        if task_root.is_dir():
            for md in task_root.rglob("*.md"):
                tasks_indexed += self._index_task_markdown(md)

        return {"notes": notes_indexed, "tasks": tasks_indexed}

    def _index_note_markdown(self, file_path: Path) -> int:
        meta, body = parse_markdown(file_path)
        note_id = str(meta.get("id", "")).strip()
        if not note_id:
            digest = hashlib.sha1(str(file_path).encode("utf-8")).hexdigest()[:16]
            note_id = f"note_{digest}"

        stat = file_path.stat()
        fallback_created = datetime.fromtimestamp(stat.st_ctime).isoformat(timespec="seconds")
        fallback_updated = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
        created_at = str(meta.get("created_at", fallback_created))
        updated_at = str(meta.get("updated_at", fallback_updated))
        note_type = str(meta.get("type", "note")).strip() or "note"
        normalized_note_type = note_type.lower().replace("-", "_").replace(" ", "_")

        title = str(meta.get("title", "")).strip()
        if not title:
            if body.strip():
                first_line = next((line.strip() for line in body.splitlines() if line.strip()), "")
                title = first_line.lstrip("# ").strip()[:120] or file_path.stem
            else:
                title = file_path.stem or note_id

        self.upsert_note(
            note_id=note_id,
            path=str(file_path),
            title=title,
            body=body,
            note_type=note_type,
            created_at=created_at,
            updated_at=updated_at,
        )

        raw_tags = meta.get("tags", [])
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        if not isinstance(raw_tags, list):
            raw_tags = []

        tags = []
        for item in raw_tags:
            parsed = _split_tag(str(item))
            if parsed:
                category, slug = parsed
                tags.append(
                    {
                        "category": category,
                        "slug": slug,
                        "display_name": slug,
                        "source": "frontmatter",
                        "confidence": 1.0,
                    }
                )
        self.set_note_tags(note_id, tags)

        inherited_todo_tags = _extract_inherited_note_tags(meta, tags)
        if normalized_note_type not in {"task", "tag_index"}:
            todos = extract_todos_from_body(body, note_anchor=note_id, inherited_tags=inherited_todo_tags)
            self.set_note_todos(
                note_id=note_id,
                note_path=str(file_path),
                todos=todos,
                updated_at=updated_at,
            )
        else:
            self.clear_note_todos(note_id)

        if normalized_note_type == "task":
            task_id = str(meta.get("id", "")).strip() or note_id
            parsed_task = ParsedTask(
                title=title,
                due_date=str(meta.get("due_date", "")).strip() or None,
                priority=str(meta.get("priority", "M")).upper()[:1] or "M",
                status=str(meta.get("status", "open")).strip().lower().replace("-", "_") or "open",
                project_tag=str(meta.get("project_tag", "")).strip() or None,
                estimate_minutes=_normalize_estimate_minutes(meta.get("estimate_minutes")),
                completed_at=_normalize_iso_timestamp(meta.get("completed_at")),
                blocked_by_ids=_normalize_task_id_list(meta.get("blocked_by_ids"), exclude_id=task_id),
                waiting_for=_normalize_free_text(meta.get("waiting_for")),
                follow_up_date=_normalize_iso_date(meta.get("follow_up_date")),
                blocked_reason=_normalize_free_text(meta.get("blocked_reason")),
                next_action_hint=_normalize_free_text(meta.get("next_action_hint")),
            )
            self.add_or_update_task(
                task_id=task_id,
                note_id=note_id,
                path=str(file_path),
                parsed=parsed_task,
                created_at=created_at,
                updated_at=updated_at,
            )
        return 1

    def _index_task_markdown(self, file_path: Path) -> int:
        meta, body = parse_markdown(file_path)
        task_id = str(meta.get("id", "")).strip()
        if not task_id:
            digest = hashlib.sha1(str(file_path).encode("utf-8")).hexdigest()[:16]
            task_id = f"task_{digest}"

        stat = file_path.stat()
        fallback_created = datetime.fromtimestamp(stat.st_ctime).isoformat(timespec="seconds")
        fallback_updated = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")

        title = str(meta.get("title", "")).strip()
        if not title:
            title = body.splitlines()[0].strip() if body.strip() else str(file_path.stem or task_id)
        inferred_status = "done" if "done" in {part.lower() for part in file_path.parts} else "open"
        parsed = ParsedTask(
            title=title,
            due_date=str(meta.get("due_date", "") or "") or None,
            priority=str(meta.get("priority", "M")).upper()[:1] or "M",
            status=str(meta.get("status", inferred_status)).lower().replace("-", "_"),
            project_tag=str(meta.get("project_tag", "") or "") or None,
            estimate_minutes=_normalize_estimate_minutes(meta.get("estimate_minutes")),
            completed_at=_normalize_iso_timestamp(meta.get("completed_at")),
            blocked_by_ids=_normalize_task_id_list(meta.get("blocked_by_ids"), exclude_id=task_id),
            waiting_for=_normalize_free_text(meta.get("waiting_for")),
            follow_up_date=_normalize_iso_date(meta.get("follow_up_date")),
            blocked_reason=_normalize_free_text(meta.get("blocked_reason")),
            next_action_hint=_normalize_free_text(meta.get("next_action_hint")),
        )
        created_at = str(meta.get("created_at", fallback_created))
        updated_at = str(meta.get("updated_at", fallback_updated))
        note_id = str(meta.get("note_id", "") or "") or None

        self.add_or_update_task(
            task_id=task_id,
            note_id=note_id,
            path=str(file_path),
            parsed=parsed,
            created_at=created_at,
            updated_at=updated_at,
        )
        return 1


def _split_tag(raw: str) -> tuple[str, str] | None:
    if ":" not in raw:
        return None
    category, value = raw.split(":", 1)
    category = slugify(category)
    slug = slugify(value)
    if not category or not slug:
        return None
    return category, slug


def _normalize_tag_value(raw: str) -> str | None:
    clean = str(raw).strip()
    if not clean:
        return None

    inline = INLINE_TITLE_TAG_PATTERN.fullmatch(clean)
    if inline:
        clean = f"{inline.group(1)}:{inline.group(2)}"

    clean = clean.lstrip("#")
    delimiter = ":" if ":" in clean else "/" if "/" in clean else ""
    if delimiter:
        left, right = clean.split(delimiter, 1)
        category = slugify(left)
        slug = slugify(right)
        if category and slug:
            return f"{category}:{slug}"
        return None

    topic = slugify(clean)
    return f"topic:{topic}" if topic else None


def _normalize_related_value(raw: str) -> str:
    clean = str(raw).strip()
    if not clean:
        return ""
    if clean.startswith("[[") and clean.endswith("]]"):
        clean = clean[2:-2].strip()
    if "|" in clean:
        clean = clean.split("|", 1)[0].strip()
    if "#" in clean:
        clean = clean.split("#", 1)[0].strip()
    clean = clean.replace("\\", "/").strip()
    if clean.lower().endswith(".md"):
        clean = clean[:-3]
    return clean.strip()


def _normalize_iso_date(raw: Any) -> str | None:
    clean = str(raw or "").strip()
    if not clean:
        return None
    return clean if re.fullmatch(r"\d{4}-\d{2}-\d{2}", clean) else None


def _normalize_iso_timestamp(raw: Any) -> str | None:
    clean = str(raw or "").strip()
    if not clean:
        return None
    if clean.endswith("Z"):
        clean = f"{clean[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(clean)
    except ValueError:
        return None
    return parsed.isoformat(timespec="seconds")


def _normalize_free_text(raw: Any) -> str | None:
    clean = " ".join(str(raw or "").split())
    return clean or None


def _normalize_estimate_minutes(raw: Any) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
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
    return min(value, 10000)


def _normalize_task_id_list(raw: Any, exclude_id: str = "") -> list[str]:
    source: list[str]
    if isinstance(raw, str):
        clean = raw.strip()
        if not clean:
            source = []
        elif clean.startswith("["):
            source = _safe_json_list(clean)
        else:
            source = [clean]
    elif isinstance(raw, list):
        source = [str(item).strip() for item in raw]
    else:
        source = []

    normalized: list[str] = []
    seen: set[str] = set()
    exclude_key = exclude_id.strip().lower()
    for item in source:
        parts = item.split(",") if "," in item else [item]
        for part in parts:
            clean_item = part.strip()
            if not clean_item:
                continue
            lowered = clean_item.lower()
            if exclude_key and lowered == exclude_key:
                # Ignore self-references in blocker ids defensively.
                continue
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized.append(clean_item)
    return normalized


def _extract_body_auto_tags(body: str) -> list[str]:
    found: set[str] = set()
    text = body or ""

    for match in INLINE_TITLE_TAG_PATTERN.finditer(text):
        found.add(f"{match.group(1)}:{match.group(2)}")

    for match in BODY_HASHTAG_PATTERN.finditer(text):
        hashtag = str(match.group(2) or "").strip()
        if hashtag:
            found.add(hashtag)

    return sorted(found, key=lambda item: item.lower())


def _ensure_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _extract_inherited_note_tags(meta: dict[str, Any], note_tag_rows: list[dict[str, Any]]) -> list[str]:
    found: set[str] = set()
    for row in note_tag_rows:
        category = slugify(str(row.get("category", "")))
        slug = slugify(str(row.get("slug", "")))
        if category and slug:
            found.add(f"{category}:{slug}")

    for raw_tag in _ensure_string_list(meta.get("tags_auto", [])):
        clean = str(raw_tag).strip()
        if not clean:
            continue
        if ":" in clean:
            category, slug = clean.split(":", 1)
            cat_slug = slugify(category)
            tag_slug = slugify(slug)
            if cat_slug and tag_slug:
                found.add(f"{cat_slug}:{tag_slug}")
            continue
        topic_slug = slugify(clean.lstrip("#"))
        if topic_slug:
            found.add(f"topic:{topic_slug}")

    return sorted(found, key=lambda item: item.lower())


def _safe_json_list(raw_value: Any) -> list[str]:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    values: list[str] = []
    for item in parsed:
        text = str(item).strip()
        if text:
            values.append(text)
    return values


def _hydrate_todo_row(row: dict[str, Any]) -> dict[str, Any]:
    completed_at = _normalize_iso_timestamp(row.get("completed_at"))
    checked = bool(row.get("checked"))
    if not checked:
        completed_at = None
    return {
        "id": row.get("id"),
        "note_id": row.get("note_id"),
        "note_title": row.get("note_title") or "",
        "note_path": row.get("note_path"),
        "line_no": int(row.get("line_no") or 0),
        "block_ref": row.get("block_ref"),
        "checked": checked,
        "raw_text": row.get("raw_text") or "",
        "explicit_tags": _safe_json_list(row.get("explicit_tags_json")),
        "inherited_tags": _safe_json_list(row.get("inherited_tags_json")),
        "links": _safe_json_list(row.get("links_json")),
        "promoted": bool(row.get("promoted")),
        "promoted_task_id": row.get("promoted_task_id"),
        "completed_at": completed_at,
        "updated_at": row.get("updated_at") or "",
    }

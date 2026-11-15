from __future__ import annotations
from .dates import calendar_day
from .inventory import markdown_sources, is_source
from .graph_index import _extract_tags

from contextlib import contextmanager
from functools import wraps
import hashlib
import json
import re
import sqlite3
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from .markdown_io import document_snapshots, parse_markdown, snapshot_operation, prefetch_markdown
from .projection_registry import INDEXER_SCHEMA_VERSION
from .models import ParsedTask, TagRef
from .parser import slugify
from .todos import ExtractedTodo, extract_todos_from_body
from ..config import (
    INDEXER_REVIEW_COMPLETED_LIST_BASE,
    INDEXER_REVIEW_COMPLETED_LIST_PADDING,
    INDEXER_REVIEW_BACKLOG_DELTA_WARNING_MIN,
    INDEXER_REVIEW_BACKLOG_DELTA_NEW_WORK_FACTOR,
    INDEXER_REVIEW_BACKLOG_DELTA_NEW_WORK_OFFSET,
    INDEXER_REVIEW_COMPLETION_RATIO_WARNING,
    INDEXER_REVIEW_COMPLETION_RATIO_HIGH_RISK,
    INDEXER_REVIEW_MIN_NEW_WORK_FOR_RATIO,
    INDEXER_REVIEW_OVERDUE_WARNING,
    INDEXER_REVIEW_OVERDUE_HIGH_RISK,
    INDEXER_REVIEW_NEW_WORK_WARNING_MIN,
    INDEXER_REVIEW_BACKLOG_DELTA_HIGH_RISK,
    REVIEW_DASHBOARD_DEFAULT_DAYS,
    REVIEW_DASHBOARD_DAYS_MIN,
    REVIEW_DASHBOARD_DAYS_MAX,
    REVIEW_DASHBOARD_DEFAULT_TOP_NOTES,
    REVIEW_DASHBOARD_TOP_NOTES_MIN,
    REVIEW_DASHBOARD_TOP_NOTES_MAX,
    TASK_ESTIMATE_MINUTES_MAX,
)


INLINE_TITLE_TAG_PATTERN = re.compile(r"\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)/([A-Za-z0-9][A-Za-z0-9_-]*)\}", re.IGNORECASE)


def _count_from_cursor(cur: sqlite3.Cursor) -> int:
    row = cur.fetchone()
    if row is None:
        return 0
    try:
        return int(row["cnt"] or 0)
    except (KeyError, TypeError, ValueError):
        return 0


def batch_projection(function):
    @wraps(function)
    @snapshot_operation
    def run(self, *args, **kwargs):
        with self.batch():
            return function(self, *args, **kwargs)
    return run


class VaultIndexer:
    def __init__(self, db_path: Path):
        self._batch_depth = 0
        self.db_path = db_path
        self._lock = threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.create_function("local_day",1,calendar_day)
        try:
            self._configure_connection()
            self._init_schema()
            self.conn.execute("CREATE TABLE IF NOT EXISTS indexed_files(path TEXT PRIMARY KEY, mtime_ns INTEGER NOT NULL, size INTEGER NOT NULL);")
            self.conn.commit()
            self._ensure_schema_version()
        except Exception:
            self.conn.close()
            raise

    def _commit(self):
        if not self._batch_depth:
            self.conn.commit()

    @contextmanager
    def batch(self):
        with self._lock:
            outermost = self._batch_depth == 0
            if outermost:
                self.conn.execute('BEGIN;')
            self._batch_depth += 1
            try:
                yield
                if outermost:
                    self.conn.commit()
            except Exception:
                if outermost:
                    self.conn.rollback()
                raise
            finally:
                self._batch_depth -= 1

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    def _configure_connection(self) -> None:
        with self._lock:
            # Rebuildable local projection; WAL keeps bulk rebuilds atomic for readers.
            self.conn.execute("PRAGMA journal_mode=WAL;")
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
                  created_at TEXT NOT NULL,
                  completed_at TEXT,
                  updated_at TEXT NOT NULL,
                  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
                );
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_note ON todos(note_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_checked ON todos(checked);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_promoted ON todos(promoted);")
            # Every single-file reindex looks its previous rows up by path.
            cur.execute("CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tasks_path ON tasks(path);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_todos_note_path ON todos(note_path);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);")
            cur.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
                USING fts5(note_id UNINDEXED, title, body);
                """
            )
            self._commit()

    def _ensure_schema_version(self) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("PRAGMA user_version;")
            current_version = int((cur.fetchone() or [0])[0] or 0)
            if current_version == INDEXER_SCHEMA_VERSION:
                return
            if current_version > INDEXER_SCHEMA_VERSION:
                raise sqlite3.DatabaseError(
                    f"Unsupported indexer schema version: {current_version}. Expected version <= {INDEXER_SCHEMA_VERSION}."
                )
            self._init_schema()
            # Schema 4 keys each full-text row by its note row, so one note is replaced
            # without scanning the whole full-text table. Older rows are re-keyed once.
            cur.execute("DELETE FROM notes_fts;")
            cur.execute("INSERT INTO notes_fts(rowid, note_id, title, body) SELECT rowid, id, title, body FROM notes;")
            cur.execute(f"PRAGMA user_version={INDEXER_SCHEMA_VERSION};")
            self._commit()

    def clear_all(self) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("DELETE FROM note_tags;")
            cur.execute("DELETE FROM tasks;")
            cur.execute("DELETE FROM todos;")
            cur.execute("DELETE FROM tags;")
            cur.execute("DELETE FROM notes;")
            cur.execute("DELETE FROM notes_fts;")
            cur.execute("DELETE FROM indexed_files;")
            self._commit()

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
            previous = cur.execute('SELECT path FROM notes WHERE id=?', (note_id,)).fetchone()
            if previous and Path(previous['path']).resolve() != Path(path).resolve() and Path(previous['path']).exists():
                raise ValueError(f'Doppelte Markdown-ID {note_id}: {previous["path"]} und {path}')
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
            # An upsert keeps the note's rowid; the full-text row shares it (see schema 4).
            rowid = cur.execute("SELECT rowid FROM notes WHERE id = ?;", (note_id,)).fetchone()[0]
            cur.execute("DELETE FROM notes_fts WHERE rowid = ?;", (rowid,))
            cur.execute(
                "INSERT INTO notes_fts(rowid, note_id, title, body) VALUES (?, ?, ?, ?);",
                (rowid, note_id, title, body),
            )
            self._commit()

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
            self._commit()

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
            self._commit()

    def clear_note_todos(self, note_id: str) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM todos WHERE note_id = ?;", (note_id,))
            self._commit()

    def _todo_rows_for_path(self, note_path: str) -> list[dict[str, Any]]:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, checked, created_at, completed_at
                FROM todos
                WHERE note_path = ?;
                """,
                (note_path,),
            )
            return [dict(row) for row in cur.fetchall()]

    def set_note_todos(
        self,
        note_id: str,
        note_path: str,
        todos: list[ExtractedTodo],
        updated_at: str,
        existing_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        with self._lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT id, checked, created_at, completed_at
                FROM todos
                WHERE note_id = ?;
                """,
                (note_id,),
            )
            current_rows = [dict(row) for row in cur.fetchall()]
            preserved_rows = [*list(existing_rows or []), *current_rows]
            existing_by_id: dict[str, dict[str, Any]] = {str(row.get("id")): row for row in preserved_rows if row.get("id")}
            cur.execute("DELETE FROM todos WHERE note_id = ?;", (note_id,))
            for todo in todos:
                created_at = _normalize_iso_timestamp(todo.created_at) or ''
                completed_at = _normalize_iso_timestamp(todo.completed_at) if todo.checked else None
                cur.execute(
                    """
                    INSERT INTO todos(
                      id, note_id, note_path, line_no, block_ref, checked, raw_text,
                      explicit_tags_json, inherited_tags_json, links_json,
                      promoted, promoted_task_id, created_at, completed_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
                        created_at,
                        _normalize_iso_timestamp(completed_at),
                        updated_at,
                    ),
                )
            self._commit()

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
                  t.created_at,
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
                  t.created_at,
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
            cur.execute("SELECT rowid, id FROM notes WHERE path = ?;", (path,))
            rows = cur.fetchall()
            if rows:
                # A freed rowid may be reused by another note; its full-text row must go with it.
                cur.executemany("DELETE FROM notes_fts WHERE rowid = ?;", [(row["rowid"],) for row in rows])
                cur.executemany("DELETE FROM notes WHERE id = ?;", [(str(row["id"]),) for row in rows])
            cur.execute("DELETE FROM tasks WHERE path = ?;", (path,))
            cur.execute("DELETE FROM indexed_files WHERE path = ?;", (path,))
            self._prune_orphan_tags(cur)
            self._commit()

    @batch_projection
    def reindex_markdown_file(self, vault_path: Path, file_path: Path) -> dict[str, int]:
        resolved = file_path.resolve()
        if not resolved.is_file() or not is_source(vault_path, resolved):
            self.remove_projection_for_path(str(resolved))
            return {"notes": 0, "tasks": 0}
        return self._reindex_source(resolved)

    def _reindex_source(self, resolved: Path) -> dict[str, int]:
        """Reindex one file that the inventory has already accepted as a source."""
        preserved_todo_rows = self._todo_rows_for_path(str(resolved))
        meta, _ = parse_markdown(resolved)
        kind = str(meta.get('type', 'note')).lower().replace('-', '_')
        if kind in {'tag_index', 'task_link'}:
            self.remove_projection_for_path(str(resolved))
            self._record_file(resolved)
            return {"notes": 0, "tasks": 0}
        self.remove_projection_for_path(str(resolved))
        count = self._index_note_markdown(resolved, preserved_todo_rows=preserved_todo_rows)
        self._record_file(resolved)
        return {"notes": count, "tasks": int(kind == 'task')}

    def _record_file(self, path):
        stat=path.stat()
        self.conn.execute('INSERT INTO indexed_files(path,mtime_ns,size) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET mtime_ns=excluded.mtime_ns,size=excluded.size',(str(path),stat.st_mtime_ns,stat.st_size))
        self._commit()

    @batch_projection
    def reconcile_vault(self, vault_path: Path, progress_callback=None):
        sources=markdown_sources(vault_path)
        stored={str(row['path']):(row['mtime_ns'],row['size']) for row in self.conn.execute('SELECT * FROM indexed_files')}
        current={str(path) for path in sources}
        deleted=[path for path in stored if path not in current]
        for path in deleted:
            self.remove_projection_for_path(path)
        changed=[]
        def differs(path):
            stat=path.stat()
            return stored.get(str(path))!=(stat.st_mtime_ns,stat.st_size)
        # Cold reads dominate a first open, so each batch is read in parallel before it is indexed.
        with document_snapshots():
            for start in range(0,len(sources),256):
                batch=sources[start:start+256]
                pending={path for path in batch if differs(path)}
                prefetch_markdown(sorted(pending))
                for processed,path in enumerate(batch,start+1):
                    if path in pending:
                        self._reindex_source(path)
                        changed.append(str(path))
                    if progress_callback:
                        progress_callback('Quellen werden abgeglichen ...',processed,len(sources),str(path))
        return {'notes':self.conn.execute('SELECT COUNT(*) FROM notes').fetchone()[0], 'tasks':self.conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0], 'changed':len(changed), 'deleted':len(deleted)}

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

    def search_notes(self, query: str, limit: int = 100, offset: int = 0, tag: str | None = None, note_type: str | None = None) -> list[dict[str, Any]]:
        cleaned = query.strip()
        if len(cleaned) > 2000:
            raise ValueError('Suchanfrage ist zu lang.')
        limit, offset = max(1, min(int(limit), 1000)), max(0, min(int(offset), 100000))
        conditions, parameters = [], []
        if tag:
            parsed = _split_tag(tag)
            if not parsed:
                return []
            conditions.append('EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.category=? AND t.slug=?)')
            parameters.extend(parsed)
        if note_type:
            conditions.append('n.note_type=?')
            parameters.append(note_type)
        selection = 'n.id, n.title, n.path, n.note_type, n.created_at, n.updated_at, substr(n.body,1,240) AS excerpt'
        extra = (' AND ' + ' AND '.join(conditions)) if conditions else ''
        with self._lock:
            if cleaned:
                try:
                    rows = self.conn.execute(f'SELECT {selection} FROM notes_fts JOIN notes n ON n.id=notes_fts.note_id WHERE notes_fts MATCH ?{extra} ORDER BY bm25(notes_fts), n.updated_at DESC, n.id LIMIT ? OFFSET ?', [cleaned, *parameters, limit, offset]).fetchall()
                    if rows:
                        return [dict(row) for row in rows]
                except sqlite3.OperationalError:
                    # Invalid FTS syntax has an explicit, bounded literal substring fallback.
                    pass
                literal = '%' + cleaned.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
                where = "(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')" + extra
                values = [literal, literal, *parameters, limit, offset]
            else:
                where = '1=1' + extra
                values = [*parameters, limit, offset]
            rows = self.conn.execute(f'SELECT {selection} FROM notes n WHERE {where} ORDER BY n.updated_at DESC, n.id LIMIT ? OFFSET ?', values).fetchall()
            return [dict(row) for row in rows]

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

    def review_dashboard(
        self,
        end_day: date,
        window_days: int = REVIEW_DASHBOARD_DEFAULT_DAYS,
        top_notes_limit: int = REVIEW_DASHBOARD_DEFAULT_TOP_NOTES,
    ) -> dict[str, Any]:
        safe_window = max(REVIEW_DASHBOARD_DAYS_MIN, min(int(window_days), REVIEW_DASHBOARD_DAYS_MAX))
        safe_top_limit = max(REVIEW_DASHBOARD_TOP_NOTES_MIN, min(int(top_notes_limit), REVIEW_DASHBOARD_TOP_NOTES_MAX))
        start_day = end_day - timedelta(days=safe_window - 1)
        start_iso = start_day.isoformat()
        end_iso = end_day.isoformat()

        def _to_daily_count_map(cur: sqlite3.Cursor, query: str, args: tuple[Any, ...]) -> dict[str, int]:
            cur.execute(query, args)
            result: dict[str, int] = {}
            for row in cur.fetchall():
                day = str(row["day"] or "").strip()
                if not day:
                    continue
                result[day] = int(row["cnt"] or 0)
            return result

        with self._lock:
            cur = self.conn.cursor()

            cur.execute("SELECT COUNT(*) AS cnt FROM tasks WHERE status <> 'done';")
            open_tasks_now = _count_from_cursor(cur)

            cur.execute("SELECT COUNT(*) AS cnt FROM todos WHERE checked = 0;")
            open_todos_now = _count_from_cursor(cur)

            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM tasks
                WHERE status <> 'done'
                  AND due_date IS NOT NULL
                  AND due_date <> ''
                  AND substr(due_date, 1, 10) < ?;
                """,
                (end_iso,),
            )
            overdue_open_tasks = _count_from_cursor(cur)

            notes_by_day = _to_daily_count_map(
                cur,
                """
                SELECT local_day(created_at) AS day, COUNT(*) AS cnt
                FROM notes
                WHERE local_day(created_at) BETWEEN ? AND ?
                GROUP BY day;
                """,
                (start_iso, end_iso),
            )
            tasks_created_by_day = _to_daily_count_map(
                cur,
                """
                SELECT local_day(created_at) AS day, COUNT(*) AS cnt
                FROM tasks
                WHERE local_day(created_at) BETWEEN ? AND ?
                GROUP BY day;
                """,
                (start_iso, end_iso),
            )
            tasks_done_by_day = _to_daily_count_map(
                cur,
                """
                SELECT local_day(completed_at) AS day, COUNT(*) AS cnt
                FROM tasks
                WHERE status = 'done'
                  AND local_day(completed_at) BETWEEN ? AND ?
                GROUP BY day;
                """,
                (start_iso, end_iso),
            )
            todos_created_by_day = _to_daily_count_map(
                cur,
                """
                SELECT substr(COALESCE(created_at, updated_at), 1, 10) AS day, COUNT(*) AS cnt
                FROM todos
                WHERE substr(COALESCE(created_at, updated_at), 1, 10) BETWEEN ? AND ?
                GROUP BY day;
                """,
                (start_iso, end_iso),
            )
            todos_done_by_day = _to_daily_count_map(
                cur,
                """
                SELECT local_day(completed_at) AS day, COUNT(*) AS cnt
                FROM todos
                WHERE checked = 1
                  AND local_day(completed_at) BETWEEN ? AND ?
                GROUP BY day;
                """,
                (start_iso, end_iso),
            )

            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                FROM notes
                WHERE local_day(updated_at) BETWEEN ? AND ?;
                """,
                (start_iso, end_iso),
            )
            notes_updated_period = _count_from_cursor(cur)

            cur.execute(
                """
                SELECT status, created_at, updated_at, completed_at
                FROM tasks;
                """
            )
            task_timeline_rows = [dict(row) for row in cur.fetchall()]

            cur.execute(
                """
                SELECT checked, created_at, updated_at, completed_at
                FROM todos;
                """
            )
            todo_timeline_rows = [dict(row) for row in cur.fetchall()]

            note_meta_by_key: dict[str, dict[str, str]] = {}
            top_notes_by_key: dict[str, dict[str, Any]] = {}
            top_tasks_by_key: dict[str, dict[str, Any]] = {}
            completed_task_rows: list[dict[str, Any]] = []
            completed_todo_rows: list[dict[str, Any]] = []

            def _normalize_note_type(raw: Any) -> str:
                return str(raw or "note").strip().lower().replace("-", "_")

            def _upsert_top_note(path: str, *, title: str | None = None, note_type: str | None = None, updated_at: str | None = None) -> dict[str, Any] | None:
                clean_path = str(path or "").strip()
                if not clean_path:
                    return None
                normalized_type = _normalize_note_type(note_type)
                if normalized_type == "task":
                    return None
                key = clean_path.replace("\\", "/").lower()
                existing = top_notes_by_key.get(key)
                if existing is None:
                    fallback_title = Path(clean_path).stem or "Note"
                    existing = {
                        "path": clean_path,
                        "title": (title or "").strip() or fallback_title,
                        "note_type": "note",
                        "updated_at": (updated_at or "").strip() or "",
                        "activity_events": 0,
                        "note_events": 0,
                        "todo_events": 0,
                    }
                    top_notes_by_key[key] = existing
                else:
                    if title and not str(existing.get("title", "")).strip():
                        existing["title"] = title.strip()
                    if updated_at and str(updated_at) > str(existing.get("updated_at", "")):
                        existing["updated_at"] = str(updated_at)
                return existing

            def _upsert_top_task(path: str, *, title: str | None = None, updated_at: str | None = None) -> dict[str, Any] | None:
                clean_path = str(path or "").strip()
                if not clean_path:
                    return None
                key = clean_path.replace("\\", "/").lower()
                existing = top_tasks_by_key.get(key)
                if existing is None:
                    fallback_title = Path(clean_path).stem or "Task"
                    existing = {
                        "path": clean_path,
                        "title": (title or "").strip() or fallback_title,
                        "updated_at": (updated_at or "").strip() or "",
                        "activity_events": 0,
                        "created_events": 0,
                        "done_events": 0,
                        "updated_events": 0,
                        "todo_events": 0,
                    }
                    top_tasks_by_key[key] = existing
                else:
                    if title and not str(existing.get("title", "")).strip():
                        existing["title"] = title.strip()
                    if updated_at and str(updated_at) > str(existing.get("updated_at", "")):
                        existing["updated_at"] = str(updated_at)
                return existing

            cur.execute(
                """
                SELECT
                  path,
                  title,
                  note_type,
                  updated_at,
                  CASE WHEN local_day(created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END AS created_hit,
                  CASE WHEN local_day(updated_at) BETWEEN ? AND ? THEN 1 ELSE 0 END AS updated_hit
                FROM notes
                WHERE local_day(created_at) BETWEEN ? AND ?
                   OR local_day(updated_at) BETWEEN ? AND ?;
                """,
                (start_iso, end_iso, start_iso, end_iso, start_iso, end_iso, start_iso, end_iso),
            )
            for raw_row in cur.fetchall():
                row = dict(raw_row)
                path = str(row["path"] or "").strip()
                if not path:
                    continue
                key = path.replace("\\", "/").lower()
                normalized_type = _normalize_note_type(row.get("note_type"))
                note_meta_by_key[key] = {
                    "path": path,
                    "title": str(row.get("title") or "").strip(),
                    "note_type": normalized_type,
                    "updated_at": str(row.get("updated_at") or "").strip(),
                }
                entry = _upsert_top_note(
                    path,
                    title=str(row["title"] or ""),
                    note_type=normalized_type,
                    updated_at=str(row["updated_at"] or ""),
                )
                if entry is None:
                    continue
                note_events = int(row["created_hit"] or 0) + int(row["updated_hit"] or 0)
                entry["note_events"] += note_events
                entry["activity_events"] += note_events

            cur.execute(
                """
                SELECT
                  t.path,
                  COALESCE(MAX(n.title), MAX(t.title), '') AS title,
                  MAX(t.updated_at) AS last_updated,
                  SUM(CASE WHEN local_day(t.created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS created_hits,
                  SUM(CASE WHEN t.status = 'done' AND local_day(t.completed_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done_hits,
                  SUM(CASE WHEN local_day(t.updated_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS updated_hits
                FROM tasks t
                LEFT JOIN notes n ON lower(replace(n.path, '\\', '/')) = lower(replace(t.path, '\\', '/'))
                WHERE t.path IS NOT NULL AND t.path <> ''
                GROUP BY t.path;
                """,
                (start_iso, end_iso, start_iso, end_iso, start_iso, end_iso),
            )
            for raw_row in cur.fetchall():
                row = dict(raw_row)
                created_hits = int(row["created_hits"] or 0)
                done_hits = int(row["done_hits"] or 0)
                updated_hits = int(row["updated_hits"] or 0)
                task_events = created_hits + done_hits + updated_hits
                if task_events <= 0:
                    continue
                entry = _upsert_top_task(
                    str(row["path"] or ""),
                    title=str(row["title"] or ""),
                    updated_at=str(row["last_updated"] or ""),
                )
                if entry is None:
                    continue
                entry["created_events"] += created_hits
                entry["done_events"] += done_hits
                entry["updated_events"] += updated_hits
                entry["activity_events"] += task_events

            cur.execute(
                """
                SELECT
                  t.note_path,
                  MAX(t.updated_at) AS last_updated,
                  MAX(COALESCE(n.title, '')) AS note_title,
                  MAX(COALESCE(n.note_type, 'note')) AS note_type,
                  SUM(CASE WHEN substr(COALESCE(t.created_at, t.updated_at), 1, 10) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS created_hits,
                  SUM(CASE WHEN t.checked = 1 AND local_day(t.completed_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done_hits,
                  SUM(CASE WHEN local_day(t.updated_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS updated_hits
                FROM todos t
                LEFT JOIN notes n ON n.id = t.note_id
                GROUP BY t.note_path;
                """,
                (start_iso, end_iso, start_iso, end_iso, start_iso, end_iso),
            )
            for row in cur.fetchall():
                created_hits = int(row["created_hits"] or 0)
                done_hits = int(row["done_hits"] or 0)
                updated_hits = int(row["updated_hits"] or 0)
                todo_events = created_hits + done_hits + updated_hits
                if todo_events <= 0:
                    continue

                path = str(row["note_path"] or "").strip()
                if not path:
                    continue
                key = path.replace("\\", "/").lower()
                meta = note_meta_by_key.get(key) or {}
                note_type = _normalize_note_type(meta.get("note_type") or row.get("note_type") or "note")
                title = str(meta.get("title") or row.get("note_title") or "").strip()
                last_updated = str(row["last_updated"] or meta.get("updated_at") or "")
                if note_type == "task":
                    entry = _upsert_top_task(path, title=title, updated_at=last_updated)
                    if entry is None:
                        continue
                    entry["todo_events"] += todo_events
                    entry["activity_events"] += todo_events
                else:
                    entry = _upsert_top_note(path, title=title, note_type=note_type, updated_at=last_updated)
                    if entry is None:
                        continue
                    entry["todo_events"] += todo_events
                    entry["activity_events"] += todo_events

            completed_limit = max(INDEXER_REVIEW_COMPLETED_LIST_BASE, safe_top_limit + INDEXER_REVIEW_COMPLETED_LIST_PADDING)
            cur.execute(
                """
                SELECT
                  t.path,
                  COALESCE(n.title, t.title, '') AS title,
                  t.completed_at AS completed_at,
                  COALESCE(n.note_type, 'task') AS note_type
                FROM tasks t
                LEFT JOIN notes n ON lower(replace(n.path, '\\', '/')) = lower(replace(t.path, '\\', '/'))
                WHERE t.status = 'done'
                  AND local_day(t.completed_at) BETWEEN ? AND ?
                ORDER BY t.completed_at DESC
                LIMIT ?;
                """,
                (start_iso, end_iso, completed_limit),
            )
            completed_task_rows = [dict(row) for row in cur.fetchall()]

            cur.execute(
                """
                SELECT
                  t.note_path,
                  COALESCE(n.title, '') AS note_title,
                  COALESCE(n.note_type, 'note') AS note_type,
                  t.raw_text,
                  t.completed_at AS completed_at
                FROM todos t
                LEFT JOIN notes n ON n.id = t.note_id
                WHERE t.checked = 1
                  AND local_day(t.completed_at) BETWEEN ? AND ?
                ORDER BY t.completed_at DESC
                LIMIT ?;
                """,
                (start_iso, end_iso, completed_limit * 2),
            )
            completed_todo_rows = [dict(row) for row in cur.fetchall()]

        def _task_is_open_on_day(row: dict[str, Any], day_iso: str) -> bool:
            created_day = _to_iso_day_value(row.get("created_at")) or _to_iso_day_value(row.get("updated_at"))
            if not created_day or created_day > day_iso:
                return False
            status = str(row.get("status", "")).strip().lower().replace("-", "_")
            if status != "done":
                return True
            done_day = _to_iso_day_value(row.get("completed_at"))
            if not done_day:
                return False
            return day_iso < done_day

        def _todo_is_open_on_day(row: dict[str, Any], day_iso: str) -> bool:
            created_day = _to_iso_day_value(row.get("created_at")) or _to_iso_day_value(row.get("updated_at"))
            if not created_day or created_day > day_iso:
                return False
            checked = bool(row.get("checked"))
            if not checked:
                return True
            done_day = _to_iso_day_value(row.get("completed_at"))
            if not done_day:
                return False
            return day_iso < done_day

        series: list[dict[str, int | str]] = []
        cursor_day = start_day
        while cursor_day <= end_day:
            day_iso = cursor_day.isoformat()
            open_tasks = sum(1 for row in task_timeline_rows if _task_is_open_on_day(row, day_iso))
            open_todos = sum(1 for row in todo_timeline_rows if _todo_is_open_on_day(row, day_iso))
            series.append(
                {
                    "date": day_iso,
                    "new_notes": int(notes_by_day.get(day_iso, 0)),
                    "new_tasks": int(tasks_created_by_day.get(day_iso, 0)),
                    "completed_tasks": int(tasks_done_by_day.get(day_iso, 0)),
                    "new_todos": int(todos_created_by_day.get(day_iso, 0)),
                    "completed_todos": int(todos_done_by_day.get(day_iso, 0)),
                    "open_tasks": open_tasks,
                    "open_todos": open_todos,
                }
            )
            cursor_day += timedelta(days=1)

        new_notes_period = sum(int(point["new_notes"]) for point in series)
        new_tasks_period = sum(int(point["new_tasks"]) for point in series)
        new_todos_period = sum(int(point["new_todos"]) for point in series)
        done_tasks_period = sum(int(point["completed_tasks"]) for point in series)
        done_todos_period = sum(int(point["completed_todos"]) for point in series)

        new_work_period = new_tasks_period + new_todos_period
        done_work_period = done_tasks_period + done_todos_period
        completion_ratio = (done_work_period / new_work_period) if new_work_period > 0 else 1.0

        backlog_start = int(series[0]["open_tasks"]) + int(series[0]["open_todos"]) if series else 0
        backlog_end = int(series[-1]["open_tasks"]) + int(series[-1]["open_todos"]) if series else 0
        backlog_delta = backlog_end - backlog_start
        open_total_now = open_tasks_now + open_todos_now

        risk_reasons: list[str] = []
        if backlog_delta >= max(
            INDEXER_REVIEW_BACKLOG_DELTA_WARNING_MIN,
            int(new_work_period * INDEXER_REVIEW_BACKLOG_DELTA_NEW_WORK_FACTOR) + INDEXER_REVIEW_BACKLOG_DELTA_NEW_WORK_OFFSET,
        ):
            risk_reasons.append("Backlog steigt im gewählten Zeitraum.")
        if completion_ratio < INDEXER_REVIEW_COMPLETION_RATIO_WARNING and new_work_period >= INDEXER_REVIEW_MIN_NEW_WORK_FOR_RATIO:
            risk_reasons.append("Erledigungsquote liegt unter 75%.")
        if overdue_open_tasks >= INDEXER_REVIEW_OVERDUE_WARNING:
            risk_reasons.append("Viele offene überfällige Tasks.")
        if open_total_now >= INDEXER_REVIEW_NEW_WORK_WARNING_MIN:
            risk_reasons.append("Hoher aktueller Gesamt-Backlog.")

        if (
            overdue_open_tasks >= INDEXER_REVIEW_OVERDUE_HIGH_RISK
            or (backlog_delta >= INDEXER_REVIEW_BACKLOG_DELTA_HIGH_RISK and completion_ratio < INDEXER_REVIEW_COMPLETION_RATIO_HIGH_RISK)
            or len(risk_reasons) >= 3
        ):
            risk_level = "high"
        elif risk_reasons:
            risk_level = "medium"
        else:
            risk_level = "low"

        top_notes = sorted(
            (
                {
                    "path": str(entry.get("path", "")),
                    "title": str(entry.get("title", "")),
                    "note_type": str(entry.get("note_type", "note")),
                    "updated_at": str(entry.get("updated_at", "")),
                    "activity_events": int(entry.get("activity_events", 0)),
                    "note_events": int(entry.get("note_events", 0)),
                    "todo_events": int(entry.get("todo_events", 0)),
                }
                for entry in top_notes_by_key.values()
                if int(entry.get("activity_events", 0)) > 0
            ),
            key=lambda item: (int(item["activity_events"]), str(item["updated_at"]), str(item["title"]).lower()),
            reverse=True,
        )[:safe_top_limit]

        top_tasks = sorted(
            (
                {
                    "path": str(entry.get("path", "")),
                    "title": str(entry.get("title", "")),
                    "updated_at": str(entry.get("updated_at", "")),
                    "activity_events": int(entry.get("activity_events", 0)),
                    "created_events": int(entry.get("created_events", 0)),
                    "done_events": int(entry.get("done_events", 0)),
                    "updated_events": int(entry.get("updated_events", 0)),
                    "todo_events": int(entry.get("todo_events", 0)),
                }
                for entry in top_tasks_by_key.values()
                if int(entry.get("activity_events", 0)) > 0
            ),
            key=lambda item: (int(item["activity_events"]), str(item["updated_at"]), str(item["title"]).lower()),
            reverse=True,
        )[:safe_top_limit]

        completed_items: list[dict[str, Any]] = []
        for row in completed_task_rows:
            path = str(row.get("path") or "").strip()
            if not path:
                continue
            completed_items.append(
                {
                    "kind": "task",
                    "path": path,
                    "title": str(row.get("title") or Path(path).stem or "Task"),
                    "note_type": str(row.get("note_type") or "task"),
                    "completed_at": str(row.get("completed_at") or ""),
                }
            )

        for row in completed_todo_rows:
            path = str(row.get("note_path") or "").strip()
            if not path:
                continue
            key = path.replace("\\", "/").lower()
            meta = note_meta_by_key.get(key) or {}
            todo_title = str(row.get("raw_text") or "").strip() or str(row.get("note_title") or "") or "Todo"
            completed_items.append(
                {
                    "kind": "todo",
                    "path": path,
                    "title": todo_title,
                    "note_type": str(meta.get("note_type") or row.get("note_type") or "note"),
                    "completed_at": str(row.get("completed_at") or ""),
                }
            )

        completed_items = sorted(
            completed_items,
            key=lambda item: str(item.get("completed_at", "")),
            reverse=True,
        )[: max(INDEXER_REVIEW_COMPLETED_LIST_BASE, safe_top_limit + INDEXER_REVIEW_COMPLETED_LIST_PADDING)]

        return {
            "period": {
                "from": start_iso,
                "to": end_iso,
                "days": safe_window,
            },
            "kpis": {
                "open_tasks_now": open_tasks_now,
                "open_todos_now": open_todos_now,
                "open_total_now": open_total_now,
                "overdue_open_tasks": overdue_open_tasks,
                "new_notes_period": new_notes_period,
                "notes_updated_period": notes_updated_period,
                "new_tasks_period": new_tasks_period,
                "new_todos_period": new_todos_period,
                "new_work_period": new_work_period,
                "done_tasks_period": done_tasks_period,
                "done_todos_period": done_todos_period,
                "done_work_period": done_work_period,
                "completion_ratio": round(completion_ratio, 4),
                "backlog_start": backlog_start,
                "backlog_end": backlog_end,
                "backlog_delta": backlog_delta,
            },
            "risk": {
                "level": risk_level,
                "reasons": risk_reasons,
                "backlog_delta": backlog_delta,
                "completion_ratio": round(completion_ratio, 4),
                "overdue_open_tasks": overdue_open_tasks,
            },
            "series": series,
            "top_notes": top_notes,
            "top_tasks": top_tasks,
            "completed_items": completed_items,
        }

    @batch_projection
    def reindex_vault(
        self,
        vault_path: Path,
        progress_callback: Callable[[str, int, int, str | None], None] | None = None,
    ) -> dict[str, int]:
        sources = markdown_sources(vault_path)
        prefetch_markdown(sources)
        parsed = []
        ids = {}
        # Validate the complete source set before replacing the previous projection.
        for path in sources:
            meta, _ = parse_markdown(path)
            kind = str(meta.get('type', 'note')).lower().replace('-', '_')
            if kind in {'task_link', 'tag_index'}:
                continue
            identity = str(meta.get('id', '')).strip()
            if identity and identity in ids:
                raise ValueError(f'Doppelte Markdown-ID {identity}: {ids[identity]} und {path}')
            if identity:
                ids[identity] = path
            parsed.append((path, kind))
        self.clear_all()
        notes_indexed = tasks_indexed = 0
        for processed, (path, kind) in enumerate(parsed, 1):
            notes_indexed += self._index_note_markdown(path)
            self._record_file(path)
            tasks_indexed += int(kind == 'task')
            if progress_callback:
                progress_callback('Markdown wird indexiert ...', processed, len(parsed), str(path))
        return {"notes": notes_indexed, "tasks": tasks_indexed}

    def _index_note_markdown(self, file_path: Path, preserved_todo_rows: list[dict[str, Any]] | None = None) -> int:
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

        raw_tags = _extract_tags(meta, body)

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
                existing_rows=preserved_todo_rows,
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


def _to_iso_day_value(raw: Any) -> str:
    return calendar_day(raw)


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
    return min(value, TASK_ESTIMATE_MINUTES_MAX)


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
    from .markdown_syntax import prose_text
    text = prose_text(body or "")

    for match in INLINE_TITLE_TAG_PATTERN.finditer(text):
        found.add(f"{match.group(1)}:{match.group(2)}")

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
    created_at = _normalize_iso_timestamp(row.get("created_at"))
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
        "created_at": created_at,
        "completed_at": completed_at,
        "updated_at": row.get("updated_at") or "",
    }

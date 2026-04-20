from __future__ import annotations

import unittest
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.markdown_io import dump_markdown, parse_markdown, parse_markdown_text
from src.backend.nicknotes_backend.models import ParsedTask
from src.backend.nicknotes_backend.vault import VaultManager

try:
    from fastapi.testclient import TestClient
    from src.backend import api as backend_api
except Exception:  # pragma: no cover - optional dependency in local env
    TestClient = None
    backend_api = None


class PhaseEBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path.cwd() / "src" / "backend" / "tests" / "_runtime"
        base_tmp.mkdir(parents=True, exist_ok=True)
        self.test_root = base_tmp / f"case_{uuid.uuid4().hex}"
        self.vault_path = self.test_root / "vault"
        self.vault_path.mkdir(parents=True, exist_ok=True)
        self.vault = VaultManager(self.vault_path)
        self.vault.ensure_structure()
        self.indexer = VaultIndexer(self.vault.db_path)
        self.indexer.reindex_vault(self.vault.vault_path)

    def tearDown(self) -> None:
        self.indexer.close()
        shutil.rmtree(self.test_root, ignore_errors=True)
        if backend_api is not None:
            backend_api.state.close()

    def test_task_completed_at_semantics_and_blocked_by_hygiene(self) -> None:
        now = datetime(2026, 4, 19, 9, 30, 0)
        task_id = "tk_phase_e_semantics"
        task_path = self.vault._create_task_file(
            task_id=task_id,
            note_id="note_semantics",
            task=ParsedTask(title="Phase E semantics", status="open", priority="M"),
            now=now,
            indexer=self.indexer,
        )

        meta, body = parse_markdown(task_path)
        meta["status"] = "done"
        meta["completed_at"] = "2001-01-01T00:00:00"
        meta["blocked_by_ids"] = [task_id, "TK_PHASE_E_SEMANTICS", "tk_other", "tk_other"]
        done_markdown, _done_meta = self.vault.normalize_note_markdown_text(
            text=dump_markdown(meta, body),
            path=task_path,
            touch_updated=True,
        )
        meta_done, done_body = parse_markdown_text(done_markdown)
        self.assertEqual(str(meta_done.get("completed_at", "")), "2001-01-01T00:00:00")
        self.assertEqual(meta_done.get("blocked_by_ids"), ["tk_other"])

        meta_done["status"] = "open"
        reopened_markdown, _reopen_meta = self.vault.normalize_note_markdown_text(
            text=dump_markdown(meta_done, done_body),
            path=task_path,
            touch_updated=True,
        )
        reopened_meta, reopened_body = parse_markdown_text(reopened_markdown)
        self.assertEqual(str(reopened_meta.get("completed_at", "")), "")

        reopened_meta["status"] = "done"
        reopened_meta["completed_at"] = ""
        redone_markdown, _redone_meta = self.vault.normalize_note_markdown_text(
            text=dump_markdown(reopened_meta, reopened_body),
            path=task_path,
            touch_updated=True,
        )
        redone_meta, _ = parse_markdown_text(redone_markdown)
        redone_completed_at = str(redone_meta.get("completed_at", "")).strip()
        self.assertTrue(redone_completed_at)
        self.assertNotEqual(redone_completed_at, "2001-01-01T00:00:00")

    def test_todo_toggle_sets_and_clears_completed_at(self) -> None:
        self.vault.add_quick_todo_to_daily(text="Phase E todo", indexer=self.indexer, day_iso="2026-04-19")
        todos = self.indexer.list_todos()
        target = next((item for item in todos if item.get("raw_text") == "Phase E todo"), None)
        self.assertIsNotNone(target)
        assert target is not None
        todo_id = str(target["id"])
        self.assertFalse(bool(target.get("checked")))
        self.assertIsNone(target.get("completed_at"))

        self.vault.toggle_todo(todo_id=todo_id, indexer=self.indexer, checked=True)
        checked_todo = self.indexer.get_todo(todo_id)
        self.assertIsNotNone(checked_todo)
        assert checked_todo is not None
        self.assertTrue(bool(checked_todo.get("checked")))
        self.assertTrue(str(checked_todo.get("completed_at", "")).strip())

        self.vault.toggle_todo(todo_id=todo_id, indexer=self.indexer, checked=False)
        unchecked_todo = self.indexer.get_todo(todo_id)
        self.assertIsNotNone(unchecked_todo)
        assert unchecked_todo is not None
        self.assertFalse(bool(unchecked_todo.get("checked")))
        self.assertIsNone(unchecked_todo.get("completed_at"))

    @unittest.skipIf(backend_api is None, "FastAPI backend dependencies are not available in this environment.")
    def test_compute_done_today_counts_uses_completed_at_and_fallback(self) -> None:
        tasks = [
            {"status": "done", "completed_at": "2026-04-19T10:00:00", "updated_at": "2026-04-18T10:00:00"},
            {"status": "done", "completed_at": "", "updated_at": "2026-04-19T11:00:00"},
            {"status": "open", "completed_at": "2026-04-19T12:00:00", "updated_at": "2026-04-19T12:00:00"},
        ]
        todos = [
            {"checked": True, "completed_at": "2026-04-19T09:00:00", "updated_at": "2026-04-17T09:00:00"},
            {"checked": True, "completed_at": None, "updated_at": "2026-04-19T15:00:00"},
            {"checked": False, "completed_at": "2026-04-19T16:00:00", "updated_at": "2026-04-19T16:00:00"},
        ]
        done_tasks, done_todos = backend_api._compute_done_today_counts(tasks=tasks, todos=todos, day_iso="2026-04-19")
        self.assertEqual(done_tasks, 2)
        self.assertEqual(done_todos, 2)

    @unittest.skipIf(backend_api is None, "FastAPI backend dependencies are not available in this environment.")
    def test_compute_focus_stats_includes_phase_f_hygiene_counts(self) -> None:
        tasks = [
            {
                "id": "task_a",
                "status": "open",
                "due_date": "2026-04-18",
                "estimate_minutes": 30,
                "waiting_for": "",
                "follow_up_date": "",
                "blocked_by_ids": [],
                "updated_at": "2026-04-18T10:00:00",
            },
            {
                "id": "task_b",
                "status": "open",
                "due_date": "",
                "estimate_minutes": None,
                "waiting_for": "Vendor feedback",
                "follow_up_date": "",
                "blocked_by_ids": [],
                "updated_at": "2026-04-19T10:00:00",
            },
            {
                "id": "task_c",
                "status": "open",
                "due_date": "",
                "estimate_minutes": "",
                "waiting_for": "",
                "follow_up_date": "",
                "blocked_by_ids": ["task_a", "missing_task"],
                "updated_at": "2026-04-19T12:00:00",
            },
            {
                "id": "task_done",
                "status": "done",
                "due_date": "2026-04-19",
                "estimate_minutes": 15,
                "waiting_for": "",
                "follow_up_date": "",
                "blocked_by_ids": [],
                "completed_at": "2026-04-19T18:00:00",
                "updated_at": "2026-04-19T18:00:00",
            },
        ]
        stats = backend_api._compute_focus_stats(tasks=tasks, todos=[], day_iso="2026-04-19")
        self.assertEqual(int(stats.get("overdueCount", 0)), 1)
        self.assertEqual(int(stats.get("blockedCount", 0)), 2)
        self.assertEqual(int(stats.get("waitingCount", 0)), 1)
        self.assertEqual(int(stats.get("doneTodayTasks", 0)), 1)
        self.assertEqual(int(stats.get("openTasksWithoutEstimateCount", 0)), 2)
        self.assertEqual(int(stats.get("waitingWithoutFollowUpCount", 0)), 1)
        self.assertEqual(int(stats.get("unknownBlockerTaskCount", 0)), 1)
        self.assertEqual(int(stats.get("unknownBlockerReferenceCount", 0)), 1)

    @unittest.skipIf(backend_api is None or TestClient is None, "FastAPI TestClient is not available in this environment.")
    def test_focus_dashboard_endpoint_returns_aggregate_structure(self) -> None:
        backend_api.state.close()
        client = TestClient(backend_api.app)
        open_response = client.post("/vault/open", json={"path": str(self.vault_path)})
        self.assertEqual(open_response.status_code, 200)

        daily_quick = client.post("/focus/quick-capture", json={"text": "Endpoint todo", "date": "2026-04-19"})
        self.assertEqual(daily_quick.status_code, 200)

        legacy_task_path = self.vault.tasks_root_path / "done" / "tk_legacy_done_no_completed.md"
        legacy_task_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_task_path.write_text(
            dump_markdown(
                {
                    "id": "tk_legacy_done_no_completed",
                    "node_id": "tk_legacy_done_no_completed",
                    "title": "Legacy done task",
                    "type": "task",
                    "status": "done",
                    "priority": "M",
                    "due_date": "",
                    "created_at": "2026-04-18T08:00:00",
                    "updated_at": "2026-04-19T08:30:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Legacy done body",
            ),
            encoding="utf-8",
        )
        reindex_response = client.post("/vault/reindex")
        self.assertEqual(reindex_response.status_code, 200)

        response = client.get("/focus/dashboard?date=2026-04-19")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("tasks", payload)
        self.assertIn("todos", payload)
        self.assertIn("notes", payload)
        self.assertIn("mitIds", payload)
        self.assertIn("stats", payload)
        self.assertIn("counts", payload)

        stats = payload.get("stats") or {}
        self.assertGreaterEqual(int(stats.get("doneTodayTasks", 0)), 1)
        self.assertGreaterEqual(int(stats.get("doneToday", 0)), int(stats.get("doneTodayTasks", 0)))
        self.assertIn("openTasksWithoutEstimateCount", stats)
        self.assertIn("waitingWithoutFollowUpCount", stats)
        self.assertIn("unknownBlockerTaskCount", stats)
        self.assertIn("unknownBlockerReferenceCount", stats)


if __name__ == "__main__":
    unittest.main()

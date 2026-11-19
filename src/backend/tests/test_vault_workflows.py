from __future__ import annotations

import unittest
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.markdown_io import dump_markdown, parse_markdown, parse_markdown_text
from src.backend.nicknotes_backend.models import ParsedTask, TagSuggestion
from src.backend.nicknotes_backend.vault import VaultManager

from src.backend import api as backend_api

from src.backend.tests.http_client import TestClient


class VaultWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path(__file__).resolve().parents[3] / ".tmp" / "vault_workflows_runtime"
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
            backend_api.state.dispose_session()

    def test_capture_preview_returns_defined_tag_and_save_preserves_inline_reference(self) -> None:
        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        self.assertEqual(client.post('/notebase/open', json={'path': str(self.vault_path)}).status_code, 200)
        self.assertEqual(client.post('/tag-groups/add-group', json={'groupId': 'ux-vorschlag', 'displayName': 'Vorschlag'}).status_code, 200)
        self.assertEqual(client.post('/tag-groups/add-tag', json={'groupId': 'ux-vorschlag', 'tagId': 'synthese', 'displayName': 'Synthese'}).status_code, 200)
        definitions = self.vault.tag_groups_path.read_text(encoding='utf-8')
        preview = client.post('/capture/preview', json={'text': 'Vorher Synthese nachher.'})
        self.assertEqual(preview.status_code, 200)
        suggestion = next(item for item in preview.json()['suggestions'] if item['key'] == 'ux-vorschlag:synthese')
        self.assertEqual(suggestion['displayName'], 'Synthese')
        self.assertNotEqual(suggestion['source'], 'explicit')
        self.assertEqual(self.vault.tag_groups_path.read_text(encoding='utf-8'), definitions)
        text = 'Vorher {tag:ux-vorschlag/synthese} nachher.'
        saved = client.post('/capture/save', json={'text': text, 'selectedTagKeys': []})
        self.assertEqual(saved.status_code, 200)
        self.assertIn(text, Path(saved.json()['notePath']).read_text(encoding='utf-8'))

    def test_task_completed_at_semantics_and_blocked_by_hygiene(self) -> None:
        now = datetime(2026, 4, 19, 9, 30, 0)
        task_id = "tk_status_semantics"
        task_path = self.vault._create_task_file(
            task_id=task_id,
            note_id="note_semantics",
            task=ParsedTask(title="Status semantics", status="open", priority="M"),
            now=now,
            indexer=self.indexer,
        )

        meta, body = parse_markdown(task_path)
        meta["status"] = "done"
        meta["completed_at"] = "2001-01-01T00:00:00"
        meta["blocked_by_ids"] = [task_id, "TK_STATUS_SEMANTICS", "tk_other", "tk_other"]
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
        result = self.vault.add_quick_todo_to_daily(text="Schnelles Todo", indexer=self.indexer, day_iso="2026-04-19")
        note_path = Path(result["note_path"])
        self.assertRegex(
            note_path.read_text(encoding="utf-8"),
            r"- \[ \] Schnelles Todo <!-- nn:todo created=\S+ --> \^nn-todo_[0-9a-f]{16}",
        )
        todos = self.indexer.list_todos()
        target = next((item for item in todos if item.get("raw_text") == "Schnelles Todo"), None)
        self.assertIsNotNone(target)
        assert target is not None
        todo_id = str(target["id"])
        self.assertFalse(bool(target.get("checked")))
        self.assertIsNone(target.get("completed_at"))
        created_at = str(target.get("created_at", "")).strip()
        self.assertTrue(created_at)

        self.vault.toggle_todo(todo_id=todo_id, indexer=self.indexer, checked=True)
        checked_todo = self.indexer.get_todo(todo_id)
        self.assertIsNotNone(checked_todo)
        assert checked_todo is not None
        self.assertTrue(bool(checked_todo.get("checked")))
        self.assertTrue(str(checked_todo.get("completed_at", "")).strip())
        self.assertEqual(str(checked_todo.get("created_at", "")).strip(), created_at)
        self.assertRegex(note_path.read_text(encoding="utf-8"), r" completed=\S+ -->")

        self.vault.toggle_todo(todo_id=todo_id, indexer=self.indexer, checked=False)
        unchecked_todo = self.indexer.get_todo(todo_id)
        self.assertIsNotNone(unchecked_todo)
        assert unchecked_todo is not None
        self.assertFalse(bool(unchecked_todo.get("checked")))
        self.assertIsNone(unchecked_todo.get("completed_at"))
        self.assertEqual(str(unchecked_todo.get("created_at", "")).strip(), created_at)
        self.assertNotIn(" completed=", note_path.read_text(encoding="utf-8"))

    def test_save_capture_appends_quick_capture_block_to_daily(self) -> None:
        selected_tags = [
            TagSuggestion(
                category="person",
                slug="max-muster",
                display_name="Max Muster",
                confidence=0.91,
                source="context",
                auto_apply=True,
            )
        ]
        result = self.vault.save_capture(
            text="Max sagt: Bananen sind ungesund und als To-do keine Bananen mehr kaufen.",
            selected_tags=selected_tags,
            indexer=self.indexer,
        )

        note_path = Path(result["note_path"])
        self.assertTrue(note_path.exists())
        self.assertEqual(note_path.parent.name, datetime.now().strftime("%Y.%m"))
        self.assertEqual(note_path.parent.parent, self.vault.daily_root_path)

        _meta, body = parse_markdown(note_path)
        self.assertIn("**Quick Capture** ", body)
        self.assertIn("Bananen sind ungesund", body)
        self.assertIn("{tag:person/max-muster}", body)

        self.assertEqual(len(self.indexer.list_tasks()), 0)
        self.assertEqual(len(self.indexer.list_todos()), 0)

    def test_save_capture_turns_dated_line_into_task(self) -> None:
        result = self.vault.save_capture(
            text="Angebot schicken @2026-11-20\n- [ ] Rechnung pruefen @2026-11-21\nOhne Datum",
            selected_tags=[],
            indexer=self.indexer,
        )

        self.assertEqual([task["dueDate"] for task in result["tasks"]], ["2026-11-20", "2026-11-21"])
        self.assertEqual(sorted(task["due_date"] for task in self.indexer.list_tasks()), ["2026-11-20", "2026-11-21"])
        _meta, body = parse_markdown(Path(result["note_path"]))
        self.assertIn("Ohne Datum", body)
        self.assertEqual(len(self.indexer.list_todos()), 2)

    def test_save_capture_handles_typed_and_invalid_dates(self) -> None:
        result = self.vault.save_capture(
            text="Tippfehler @31.02.2027\nGanz falsch @2026-13-40\nManuell @20.11.2030 erledigen",
            selected_tags=[],
            indexer=self.indexer,
        )

        self.assertEqual([task["dueDate"] for task in result["tasks"]], ["2030-11-20"])
        _meta, body = parse_markdown(Path(result["note_path"]))
        self.assertIn("@31.02.2027", body)
        self.assertIn("@2026-13-40", body)
        self.assertEqual(len(self.indexer.list_tasks()), 1)

    def test_open_endpoint_recovers_corrupt_index_db(self) -> None:
        self.indexer.close()
        self.vault.db_path.write_text("NOT A SQLITE DATABASE", encoding="utf-8")

        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        response = client.post("/notebase/open", json={"path": str(self.vault_path)})
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertEqual(payload.get("vaultPath"), str(self.vault_path))
        backups = list(self.vault.local_path.glob("index.db.*.corrupt.*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertTrue(self.vault.db_path.exists())

        self.indexer = VaultIndexer(self.vault.db_path)

    def test_focus_dashboard_endpoint_returns_aggregate_structure(self) -> None:
        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        open_response = client.post("/notebase/open", json={"path": str(self.vault_path)})
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
        reindex_response = client.post("/notebase/reindex")
        self.assertEqual(reindex_response.status_code, 200)

        response = client.get("/focus/dashboard?date=2026-04-19")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("tasks", payload)
        self.assertIn("todos", payload)
        self.assertIn("notes", payload)
        self.assertIn("mitIds", payload)
        self.assertIn("counts", payload)
        self.assertNotIn("stats", payload)
        legacy = next(task for task in payload["tasks"] if task["id"] == "tk_legacy_done_no_completed")
        self.assertFalse(legacy.get("completed_at"))  # An unknown completion stays unknown; the view must not count it.

    def test_task_follow_up_defers_and_resumes_through_note_save(self) -> None:
        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        self.assertEqual(client.post("/notebase/open", json={"path": str(self.vault_path)}).status_code, 200)
        created = client.post("/note-groups/add-note", json={"groupKey": "", "title": "Lieferant anrufen", "noteType": "task"})
        self.assertEqual(created.status_code, 200)
        task_path = Path(created.json()["notePath"])
        task_id = str(parse_markdown(task_path)[0]["id"])

        deferred = client.post(f"/tasks/{task_id}/follow-up", json={"date": "2026-11-21"})
        self.assertEqual(deferred.status_code, 200)
        self.assertEqual(deferred.json()["followUpDate"], "2026-11-21")
        meta, _ = parse_markdown(task_path)
        self.assertEqual(meta["follow_up_date"], "2026-11-21")
        row = next(task for task in client.get("/tasks").json()["items"] if task["id"] == task_id)
        self.assertEqual(row["follow_up_date"], "2026-11-21")

        resumed = client.post(f"/tasks/{task_id}/follow-up", json={"date": ""})
        self.assertEqual(resumed.status_code, 200)
        self.assertIsNone(resumed.json()["followUpDate"])
        self.assertNotIn("follow_up_date", parse_markdown(task_path)[0])

        self.assertEqual(client.post(f"/tasks/{task_id}/follow-up", json={"date": "21.11.2026"}).status_code, 400)
        self.assertEqual(client.post("/tasks/tk_missing/follow-up", json={"date": "2026-11-21"}).status_code, 404)

    def test_daily_open_today_endpoint_creates_then_reuses_daily(self) -> None:
        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        open_response = client.post("/notebase/open", json={"path": str(self.vault_path)})
        self.assertEqual(open_response.status_code, 200)

        first = client.post("/daily/open-today?date=2026-04-20")
        self.assertEqual(first.status_code, 200)
        first_payload = first.json()
        self.assertTrue(bool(first_payload.get("created")))
        self.assertEqual(str(first_payload.get("date", "")), "2026-04-20")
        self.assertEqual(str(first_payload.get("title", "")), "2026-04-20")
        first_path = str(first_payload.get("notePath", "")).strip()
        self.assertTrue(first_path.endswith("2026.04\\2026-04-20.md") or first_path.endswith("2026.04/2026-04-20.md"))
        meta, body = parse_markdown(Path(first_path))
        self.assertEqual(str(meta.get("title", "")), "2026-04-20")
        self.assertTrue(body.startswith("# 2026-04-20"))
        self.assertNotIn("# Daily 2026-04-20", body)

        second = client.post("/daily/open-today?date=2026-04-20")
        self.assertEqual(second.status_code, 200)
        second_payload = second.json()
        self.assertFalse(bool(second_payload.get("created")))
        self.assertEqual(str(second_payload.get("notePath", "")).strip(), first_path)

    def _write_review_task(self, task_id: str, title: str, **fields: str) -> None:
        task_path = self.vault.vault_path / "Projects" / "Tasks" / f"{task_id}.md"
        task_path.parent.mkdir(parents=True, exist_ok=True)
        frontmatter = {
            "id": task_id,
            "node_id": task_id,
            "title": title,
            "type": "task",
            "status": "open",
            "priority": "M",
            "created_at": "2026-04-01T09:00:00",
            "updated_at": "2026-04-02T09:00:00",
            "tags": [],
            **fields,
        }
        task_path.write_text(dump_markdown(frontmatter, "Synthetischer Task"), encoding="utf-8")

    def test_review_dashboard_reconstructs_period_and_attention(self) -> None:
        note_path = self.vault.vault_path / "Projects" / "Review Notiz.md"
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text(
            dump_markdown(
                {"id": "note_review", "title": "Review Notiz", "type": "note", "created_at": "2026-04-05T08:00:00", "updated_at": "2026-04-15T08:00:00"},
                "\n".join(
                    [
                        "- [x] Erledigt im Zeitraum <!-- nn:todo created=2026-04-10T09:00:00 completed=2026-04-15T10:00:00 --> ^nn-todo_aaaaaaaaaaaaaaaa",
                        "- [ ] Liegt lange <!-- nn:todo created=2026-03-01T09:00:00 --> ^nn-todo_bbbbbbbbbbbbbbbb",
                        "- [ ] Ohne Verlauf",
                        "- [ ] Zur Task gemacht <!-- nn:todo created=2026-04-12T09:00:00 --> ^nn-todo_cccccccccccccccc <!-- nn:todo:promoted:tk_review_overdue -->",
                    ]
                ),
            ),
            encoding="utf-8",
        )
        self._write_review_task("tk_review_overdue", "Überfällig", due_date="2026-04-18")
        self._write_review_task("tk_review_follow_up", "Wiedervorlage", follow_up_date="2026-04-21")
        self._write_review_task("tk_review_waiting", "Wartet", status="on_hold", waiting_for="Rückmeldung")
        self._write_review_task("tk_review_done", "Erledigt", status="done", completed_at="2026-04-19T16:00:00")
        self.indexer.reindex_vault(self.vault.vault_path)

        backend_api.state.dispose_session()
        client = TestClient(backend_api.app)
        self.assertEqual(client.post("/notebase/open", json={"path": str(self.vault_path)}).status_code, 200)
        response = client.get("/review/dashboard?days=30&day=2026-04-21")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(payload["period"], {"from": "2026-03-23", "to": "2026-04-21", "days": 30})
        self.assertEqual(len(payload["series"]), 30)
        # The to-do without history dates back to its note; the promoted one counts only as task.
        self.assertEqual(
            payload["summary"],
            {
                "new_tasks": 4,
                "new_todos": 2,
                "done_tasks": 1,
                "done_todos": 1,
                "open_tasks_start": 0,
                "open_todos_start": 1,
                "open_tasks_end": 3,
                "open_todos_end": 2,
            },
        )
        attention = payload["attention"]
        self.assertEqual([item["id"] for item in attention["overdue"]["items"]], ["tk_review_overdue"])
        self.assertEqual([item["id"] for item in attention["follow_up"]["items"]], ["tk_review_follow_up"])
        self.assertEqual([item["id"] for item in attention["waiting"]["items"]], ["tk_review_waiting"])
        self.assertEqual(attention["waiting"]["items"][0]["detail"], "Rückmeldung")
        self.assertEqual([item["title"] for item in attention["stale_todos"]["items"]], ["Liegt lange"])
        self.assertEqual(attention["stale_todos"]["items"][0]["source_title"], "Review Notiz")

        self.assertEqual(payload["completed_total"], 2)
        self.assertEqual([(item["kind"], item["title"]) for item in payload["completed_items"]], [("task", "Erledigt"), ("todo", "Erledigt im Zeitraum")])

    def test_first_save_keeps_unknown_creation_time_of_existing_todos(self) -> None:
        note_path = self.vault.vault_path / "Projects" / "Altbestand.md"
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text(
            dump_markdown({"id": "note_legacy", "title": "Altbestand", "type": "note", "created_at": "2026-02-01T08:00:00"}, "- [ ] Alter Eintrag"),
            encoding="utf-8",
        )
        self.indexer.reindex_vault(self.vault.vault_path)

        self.vault.save_note_document(str(note_path), note_path.read_text(encoding="utf-8") + "- [ ] Neuer Eintrag\n", self.indexer)

        saved = next(self.vault.vault_path.rglob("Altbestand.md")).read_text(encoding="utf-8")
        # The source keeps the unknown time; only the index dates the old to-do to its note.
        self.assertIn("Alter Eintrag <!-- nn:todo created= -->", saved)
        self.assertRegex(saved, r"Neuer Eintrag <!-- nn:todo created=\S+ --> \^nn-todo_[0-9a-f]{16}")
        created_by_text = {row["raw_text"]: row["created_at"] for row in self.indexer.list_todos()}
        self.assertEqual(created_by_text["Alter Eintrag"], "2026-02-01T08:00:00")
        self.assertNotEqual(created_by_text["Neuer Eintrag"][:10], "2026-02-01")

    def test_daily_note_helpers_use_month_folders(self) -> None:
        result = self.vault.add_quick_todo_to_daily(text="Monatsordner Todo", indexer=self.indexer, day_iso="2026-12-05")
        note_path = Path(result["note_path"])
        self.assertEqual(note_path, self.vault.daily_root_path / "2026.12" / "2026-12-05.md")
        self.assertTrue(note_path.exists())

        mit_state = self.vault.set_daily_mit(day_iso="2027-01-02", mit_ids=["tk_a"], indexer=self.indexer)
        mit_path = Path(mit_state["note_path"])
        self.assertEqual(mit_path, self.vault.daily_root_path / "2027.01" / "2027-01-02.md")
        self.assertEqual(self.vault.get_daily_mit("2027-01-02")["mit_ids"], ["tk_a"])

    def test_reindex_skips_generated_task_status_links(self) -> None:
        task_id = "tk_external_group"
        task_path = self.vault.vault_path / "Projects" / "Tasks" / "External task.md"
        task_path.parent.mkdir(parents=True, exist_ok=True)
        task_path.write_text(
            dump_markdown(
                {
                    "id": task_id,
                    "node_id": task_id,
                    "title": "External task",
                    "type": "task",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-04-19T08:00:00",
                    "updated_at": "2026-04-19T08:00:00",
                    "tags": [],
                },
                "External task body",
            ),
            encoding="utf-8",
        )

        self.indexer.reindex_vault(self.vault.vault_path)
        self.vault.rebuild_task_status_links(self.indexer)
        self.indexer.reindex_vault(self.vault.vault_path)

        tasks = self.indexer.list_tasks(include_done=True)
        self.assertEqual([item["id"] for item in tasks], [task_id])
        self.assertTrue((self.vault.tasks_root_path / "open" / f"{task_id}.md").exists())

    def test_note_media_assets_are_created_below_note_path(self) -> None:
        self.vault.create_note_group("Projects", "")
        created = self.vault.create_note_in_group("Projects", "Image Note", self.indexer)
        note_path = Path(created["note_path"])

        result = self.vault.add_note_media_asset(
            note_path=str(note_path),
            filename="diagram.png",
            content_type="image/png",
            data=b"fake-png",
        )

        media_path = result["media_path"].replace("\\", "/")
        self.assertTrue(media_path.startswith(".media/Projects/Image_Note/"))
        self.assertTrue((self.vault.vault_path / media_path).exists())
        self.assertEqual(result["markdown_path"], f"/{media_path}")

    def test_note_move_keeps_stable_shared_media_references(self) -> None:
        self.vault.create_note_group("Projects", "")
        self.vault.create_note_group("Archive", "")
        created = self.vault.create_note_in_group("Projects", "Move Media", self.indexer)
        note_path = Path(created["note_path"])
        media_result = self.vault.add_note_media_asset(
            note_path=str(note_path),
            filename="screenshot.png",
            content_type="image/png",
            data=b"fake-png",
        )
        old_media_path = self.vault.vault_path / media_result["media_path"]
        note_path.write_text(
            dump_markdown(
                {
                    "id": "note_move_media",
                    "node_id": "note_move_media",
                    "title": "Move Media",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                f"![Screenshot]({media_result['markdown_path']})",
            ),
            encoding="utf-8",
        )

        moved_path = self.vault.move_note_file(str(note_path), "Archive", self.indexer)

        updated = moved_path.read_text(encoding="utf-8")
        self.assertIn(f"]({media_result['markdown_path']})", updated)
        self.assertTrue(old_media_path.exists())
        self.assertTrue(old_media_path.parent.is_dir())
        self.assertEqual(len(list(old_media_path.parent.iterdir())), 1)

    def test_folder_rename_keeps_existing_media_references(self) -> None:
        self.vault.create_note_group("Old Folder", "")
        created = self.vault.create_note_in_group("Old_Folder", "Media Note", self.indexer)
        note_path = Path(created["note_path"])
        media_result = self.vault.add_note_media_asset(
            note_path=str(note_path),
            filename="screenshot.png",
            content_type="image/png",
            data=b"fake-png",
        )
        note_path.write_text(
            dump_markdown(
                {
                    "id": "note_folder_rename_media",
                    "node_id": "note_folder_rename_media",
                    "title": "Media Note",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                f"![Screenshot]({media_result['markdown_path']})",
            ),
            encoding="utf-8",
        )

        self.vault.rename_note_group("Old_Folder", "New Folder", self.indexer)

        new_note_path = self.vault.vault_path / "New_Folder" / "Media_Note.md"
        _meta, body = parse_markdown(new_note_path)
        self.assertIn(media_result["markdown_path"], body)
        self.assertTrue((self.vault.vault_path / media_result["media_path"]).exists())
        self.assertTrue((self.vault.vault_path / media_result["media_path"]).parent.is_dir())

    def test_note_move_rewrites_wikilinks_and_related_frontmatter(self) -> None:
        self.vault.create_note_group("Projects", "")
        self.vault.create_note_group("Archive", "")
        target = self.vault.create_note_in_group("Projects", "Linked Note", self.indexer)
        source = self.vault.create_note_in_group("Projects", "Source Note", self.indexer)
        task = self.vault.create_note_in_group("Projects", "Task Source", self.indexer, note_type="task")

        source_path = Path(source["note_path"])
        source_path.write_text(
            dump_markdown(
                {
                    "id": "note_source_links",
                    "node_id": "note_source_links",
                    "title": "Source Note",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Projects/Linked_Note"],
                    "related_auto": ["Projects/Linked_Note"],
                },
                "See [[Projects/Linked_Note#Details|Linked]] and [[Projects/Linked_Note.md]].",
            ),
            encoding="utf-8",
        )
        task_path = Path(task["note_path"])
        task_path.write_text(
            dump_markdown(
                {
                    "id": "task_source_links",
                    "node_id": "task_source_links",
                    "title": "Task Source",
                    "type": "task",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Projects/Linked_Note"],
                    "related_auto": [],
                },
                "Task link [[Projects/Linked_Note]].",
            ),
            encoding="utf-8",
        )

        moved_path = self.vault.move_note_file(str(target["note_path"]), "Archive", self.indexer)

        source_meta, source_body = parse_markdown(source_path)
        task_meta, task_body = parse_markdown(task_path)
        self.assertEqual(moved_path, self.vault.vault_path / "Archive" / "Linked_Note.md")
        self.assertIn("[[Archive/Linked_Note#Details|Linked]]", source_body)
        self.assertIn("[[Archive/Linked_Note.md]]", source_body)
        self.assertEqual(source_meta.get("related"), ["Archive/Linked_Note"])
        self.assertEqual(source_meta.get("related_auto"), ["Archive/Linked_Note"])
        self.assertIn("[[Archive/Linked_Note]]", task_body)
        self.assertEqual(task_meta.get("related"), ["Archive/Linked_Note"])

    def test_folder_move_rewrites_links_for_all_moved_notes(self) -> None:
        self.vault.create_note_group("Projects", "")
        self.vault.create_note_group("References", "Projects")
        self.vault.create_note_group("Archive", "")
        first = self.vault.create_note_in_group("Projects/References", "First", self.indexer)
        second = self.vault.create_note_in_group("Projects/References", "Second", self.indexer)
        source = self.vault.create_note_in_group("Projects", "Folder Source", self.indexer)
        source_path = Path(source["note_path"])
        source_path.write_text(
            dump_markdown(
                {
                    "id": "note_folder_source",
                    "node_id": "note_folder_source",
                    "title": "Folder Source",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Projects/References/First", "Projects/References/Second"],
                    "related_auto": [],
                },
                "[[Projects/References/First]]\n[[Projects/References/Second]]",
            ),
            encoding="utf-8",
        )

        self.vault.move_note_group("Projects/References", "Archive", self.indexer)

        meta, body = parse_markdown(source_path)
        self.assertTrue((self.vault.vault_path / "Archive" / "References" / "First.md").exists())
        self.assertTrue((self.vault.vault_path / "Archive" / "References" / "Second.md").exists())
        self.assertFalse(Path(first["note_path"]).exists())
        self.assertFalse(Path(second["note_path"]).exists())
        self.assertIn("[[Archive/References/First]]", body)
        self.assertIn("[[Archive/References/Second]]", body)
        self.assertEqual(meta.get("related"), ["Archive/References/First", "Archive/References/Second"])

    def test_move_note_to_vault_root_rewrites_nested_references_before_returning(self) -> None:
        self.vault.create_note_group("Wirtschaft", "")
        self.vault.create_note_group("Reisen", "")
        target = self.vault.create_note_in_group("Wirtschaft", "Anlage Servicefall", self.indexer)
        source = self.vault.create_note_in_group("Reisen", "Reise Herbst 24", self.indexer)
        source_path = Path(source["note_path"])
        source_path.write_text(
            dump_markdown(
                {
                    "id": "note_reise_herbst",
                    "node_id": "note_reise_herbst",
                    "title": "Reise Herbst 24",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": ["Wirtschaft/Anlage_Servicefall"],
                },
                "[[Wirtschaft/Anlage_Servicefall]]",
            ),
            encoding="utf-8",
        )

        self.vault.move_note_file(str(target["note_path"]), "", self.indexer)

        meta, body = parse_markdown(source_path)
        self.assertIn("[[Anlage_Servicefall]]", body)
        self.assertNotIn("Wirtschaft/Anlage_Servicefall", body)
        self.assertEqual(meta.get("related_auto"), ["Anlage_Servicefall"])

    def test_delete_note_marks_wikilinks_and_related_as_deleted(self) -> None:
        self.vault.create_note_group("Projects", "")
        target = self.vault.create_note_in_group("Projects", "Deleted Target", self.indexer)
        source = self.vault.create_note_in_group("Projects", "Source", self.indexer)
        task = self.vault.create_note_in_group("Projects", "Task Source", self.indexer, note_type="task")

        source_path = Path(source["note_path"])
        source_path.write_text(
            dump_markdown(
                {
                    "id": "note_delete_source",
                    "node_id": "note_delete_source",
                    "title": "Source",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Projects/Deleted_Target"],
                    "related_auto": ["Projects/Deleted_Target"],
                },
                "[[Projects/Deleted_Target|Target alias]]",
            ),
            encoding="utf-8",
        )
        task_path = Path(task["note_path"])
        task_path.write_text(
            dump_markdown(
                {
                    "id": "task_delete_source",
                    "node_id": "task_delete_source",
                    "title": "Task Source",
                    "type": "task",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Projects/Deleted_Target"],
                    "related_auto": [],
                },
                "[[Projects/Deleted_Target]]",
            ),
            encoding="utf-8",
        )

        self.vault.delete_note_file(str(target["note_path"]), self.indexer)

        source_meta, source_body = parse_markdown(source_path)
        task_meta, task_body = parse_markdown(task_path)
        self.assertIn("~~Target alias~~ *(deleted note: Projects/Deleted_Target)*", source_body)
        self.assertNotIn("[[Projects/Deleted_Target", source_body)
        self.assertEqual(source_meta.get("related"), [])
        self.assertEqual(source_meta.get("related_auto"), [])
        self.assertIn("~~Projects/Deleted_Target~~ *(deleted note: Projects/Deleted_Target)*", task_body)
        self.assertEqual(task_meta.get("related"), [])

    def test_delete_folder_marks_links_to_all_deleted_notes(self) -> None:
        self.vault.create_note_group("Projects", "")
        self.vault.create_note_group("Archive", "")
        self.vault.create_note_group("References", "Archive")
        first = self.vault.create_note_in_group("Archive/References", "First", self.indexer)
        second = self.vault.create_note_in_group("Archive/References", "Second", self.indexer)
        source = self.vault.create_note_in_group("Projects", "Source", self.indexer)
        source_path = Path(source["note_path"])
        source_path.write_text(
            dump_markdown(
                {
                    "id": "note_delete_folder_source",
                    "node_id": "note_delete_folder_source",
                    "title": "Source",
                    "type": "note",
                    "status": "open",
                    "priority": "medium",
                    "due_date": "",
                    "created_at": "2026-05-11T10:00:00",
                    "updated_at": "2026-05-11T10:00:00",
                    "tags": [],
                    "tags_auto": [],
                    "related": ["Archive/References/First", "Archive/References/Second"],
                    "related_auto": [],
                },
                "[[Archive/References/First]]\n[[Archive/References/Second|Second alias]]",
            ),
            encoding="utf-8",
        )

        self.vault.delete_note_group("Archive/References", self.indexer)

        meta, body = parse_markdown(source_path)
        self.assertFalse(Path(first["note_path"]).exists())
        self.assertFalse(Path(second["note_path"]).exists())
        self.assertIn("~~Archive/References/First~~ *(deleted note: Archive/References/First)*", body)
        self.assertIn("~~Second alias~~ *(deleted note: Archive/References/Second)*", body)
        self.assertEqual(meta.get("related"), [])


if __name__ == "__main__":
    unittest.main()

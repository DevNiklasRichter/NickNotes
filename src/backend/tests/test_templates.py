from __future__ import annotations

import shutil
import unittest
import uuid
from datetime import date, datetime
from pathlib import Path

from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.inventory import markdown_sources
from src.backend.nicknotes_backend.markdown_io import dump_markdown, parse_markdown
from src.backend.nicknotes_backend.templates import render_placeholders, template_from_note, template_name
from src.backend.nicknotes_backend.vault import VaultManager

from src.backend import api as backend_api

from src.backend.tests.http_client import TestClient


class TemplateTextTests(unittest.TestCase):
    def test_placeholders_are_filled_in_german_and_english(self) -> None:
        moment = datetime(2026, 11, 23, 9, 5)
        text = "{{titel}} am {{ Datum }} ({{wochentag}}, {{uhrzeit}}) · {{date}} {{time}} {{title}} {{unbekannt}}"
        self.assertEqual(
            render_placeholders(text, title="Weekly", moment=moment),
            "Weekly am 2026-11-23 (Montag, 09:05) · 2026-11-23 09:05 Weekly {{unbekannt}}",
        )

    def test_a_note_becomes_a_template_without_its_own_identity(self) -> None:
        meta = {"id": "tk_1", "type": "task", "title": "Wochenplanung", "status": "done", "due_date": "2026-11-23",
                "priority": "high", "tags": ["bereich:arbeit"], "estimate_minutes": 30, "repeat": "weekly", "remind_at": "2026-11-23 09:00"}
        kind, fields, body = template_from_note(meta, "\n# Wochenplanung\n\n- [ ] Ziele\n", "Wochenplanung")
        self.assertEqual(kind, "task")
        self.assertEqual(fields, {"tags": ["bereich:arbeit"], "priority": "high", "estimate_minutes": 30, "repeat": "weekly"})
        self.assertEqual(body, "\n# {{titel}}\n\n- [ ] Ziele\n")

    def test_todos_in_a_template_start_open_and_without_their_history(self) -> None:
        body = (
            "- [x] Agenda <!-- nn:todo created=2026-11-20T09:00:00+01:00 completed=2026-11-20T10:00:00+01:00 --> ^nn-todo_ab12\n"
            "- [ ] Protokoll <!-- nn:todo created=2026-11-20T09:00:00+01:00 --> ^nn-todo_ef56 <!-- nn:todo:promoted:tk_1 -->\n"
            "- [ ] Eigener Anker ^eigener-anker\n"
            "```\n- [x] Beispiel im Code ^nn-todo_cd34\n```\n"
        )
        _kind, _fields, clean = template_from_note({"type": "note"}, body, "")
        self.assertEqual(clean, "- [ ] Agenda\n- [ ] Protokoll\n- [ ] Eigener Anker ^eigener-anker\n```\n- [x] Beispiel im Code ^nn-todo_cd34\n```\n")

    def test_names_are_valid_file_names(self) -> None:
        self.assertEqual(template_name('  Besprechung: 1/1 '), "Besprechung 1 1")
        self.assertEqual(template_name("..."), "")


class TemplateWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path(__file__).resolve().parents[3] / ".tmp" / "template_runtime"
        base_tmp.mkdir(parents=True, exist_ok=True)
        self.test_root = base_tmp / f"case_{uuid.uuid4().hex}"
        self.vault_path = self.test_root / "vault"
        self.vault_path.mkdir(parents=True)
        self.vault = VaultManager(self.vault_path)
        self.vault.ensure_structure()
        self.indexer = VaultIndexer(self.vault.db_path)
        self.indexer.reindex_vault(self.vault.vault_path)

    def tearDown(self) -> None:
        self.indexer.close()
        shutil.rmtree(self.test_root, ignore_errors=True)

    def test_save_a_task_as_template_and_create_a_new_task_from_it(self) -> None:
        source = self.vault.create_note_in_group("", "Wochenplanung", self.indexer, note_type="task")
        meta, _body = parse_markdown(source["note_path"])
        meta.update({"priority": "high", "tags": ["bereich:arbeit"], "repeat": "weekly", "due_date": "2026-11-23"})
        source["note_path"].write_text(dump_markdown(meta, "# Wochenplanung\n\nAm {{datum}}:\n- [ ] Ziele\n"), encoding="utf-8")

        self.assertEqual(self.vault.save_note_as_template(str(source["note_path"])), "Wochenplanung")
        self.assertEqual(self.vault.templates.list(), [{"name": "Wochenplanung", "kind": "task", "daily": False}])
        # Templates live in .system and never become sources of the index or graph.
        self.assertFalse(any(".system" in path.parts for path in markdown_sources(self.vault_path)))
        with self.assertRaises(ValueError):
            self.vault.save_note_as_template(str(source["note_path"]))
        self.vault.save_note_as_template(str(source["note_path"]), replace=True)

        created = self.vault.create_note_in_group("Projekte", "Wochenplanung 2", self.indexer, template="wochenplanung") \
            if (self.vault_path / "Projekte").mkdir() is None else None
        meta, body = parse_markdown(created["note_path"])
        self.assertEqual(meta["type"], "task")
        self.assertEqual(meta["status"], "open")
        self.assertEqual(meta["priority"], "high")
        self.assertEqual(meta["tags"], ["bereich:arbeit"])
        self.assertEqual(meta["repeat"], "weekly")
        self.assertEqual(meta.get("due_date", ""), "")
        self.assertNotEqual(meta["id"], source["note_id"])
        self.assertEqual(body.strip(), f"# Wochenplanung 2\n\nAm {date.today().isoformat()}:\n- [ ] Ziele")
        self.assertEqual(sorted(row["title"] for row in self.indexer.list_tasks()), ["Wochenplanung", "Wochenplanung 2"])

    def test_missing_template_is_a_clear_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "gibt es nicht mehr"):
            self.vault.create_note_in_group("", "X", self.indexer, template="Weg")

    def test_daily_note_template_shapes_new_daily_notes(self) -> None:
        today = self.vault.ensure_daily_note(None, self.indexer)
        daily_path = today["note_path"]
        meta, _body = parse_markdown(daily_path)
        # The editor writes `type: note` when it saves a daily note; the folder still makes it one.
        daily_path.write_text(dump_markdown(meta | {"type": "note"}, f"# {meta['title']}\n\n## {{{{wochentag}}}}\n- [ ] Plan\n"), encoding="utf-8")
        self.assertEqual(self.vault.save_note_as_template(str(daily_path)), "Tagesnotiz")
        self.assertEqual(self.vault.templates.list(), [{"name": "Tagesnotiz", "kind": "note", "daily": True}])

        later = self.vault.ensure_daily_note("2030-01-07", self.indexer)
        later_path = later["note_path"]
        meta, body = parse_markdown(later_path)
        self.assertEqual(meta["type"], "daily")
        self.assertEqual(body.strip(), "# 2030-01-07\n\n## Montag\n- [ ] Plan")

        self.vault.templates.delete("tagesnotiz")
        self.assertEqual(self.vault.templates.list(), [])

    def test_template_routes_save_list_create_and_delete(self) -> None:
        backend_api.state.dispose_session()
        try:
            client = TestClient(backend_api.app)
            self.assertEqual(client.post('/notebase/open', json={'path': str(self.vault_path)}).status_code, 200)
            source = client.post('/note-groups/add-note', json={'groupKey': '', 'title': 'Besprechung', 'noteType': 'note'}).json()
            saved = client.post('/templates/save', json={'notePath': source['notePath']})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json(), {'items': [{'name': 'Besprechung', 'kind': 'note', 'daily': False}], 'saved': 'Besprechung'})
            self.assertEqual(client.post('/templates/save', json={'notePath': source['notePath']}).status_code, 400)
            self.assertEqual(client.get('/templates').json()['items'][0]['name'], 'Besprechung')

            created = client.post('/note-groups/add-note', json={'groupKey': '', 'title': 'Besprechung 2', 'template': 'Besprechung'})
            self.assertEqual(created.status_code, 200, created.text)
            self.assertEqual(created.json()['noteType'], 'note')
            self.assertEqual(client.post('/note-groups/add-note', json={'groupKey': '', 'title': 'X', 'template': 'Fehlt'}).status_code, 400)

            self.assertEqual(client.post('/templates/delete', json={'name': 'Besprechung'}).json(), {'items': [], 'saved': ''})
        finally:
            backend_api.state.dispose_session()


if __name__ == "__main__":
    unittest.main()

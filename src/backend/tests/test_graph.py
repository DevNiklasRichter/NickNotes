from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path

from src.backend.nicknotes_backend.graph_index import build_graph_index
from src.backend.nicknotes_backend.graph_storage import read_graph_index, read_graph_state, write_graph_index, write_graph_state
from src.backend.nicknotes_backend.markdown_io import dump_markdown
from src.backend.nicknotes_backend.vault import VaultManager


class GraphIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path.cwd() / "src" / "backend" / "tests" / "_runtime"
        base_tmp.mkdir(parents=True, exist_ok=True)
        self.test_root = base_tmp / f"graph_{uuid.uuid4().hex}"
        self.vault_path = self.test_root / "vault"
        self.vault_path.mkdir(parents=True, exist_ok=True)
        self.vault = VaultManager(self.vault_path)
        self.vault.ensure_structure()
        self.vault._write_tag_groups(
            [
                {
                    "id": "project",
                    "displayName": "Project",
                    "color": "#4f8cff",
                    "tags": [{"id": "alpha", "displayName": "Alpha"}],
                },
                {
                    "id": "topic",
                    "displayName": "Topic",
                    "color": "#2fba7a",
                    "tags": [{"id": "known", "displayName": "Known"}],
                },
            ]
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.test_root, ignore_errors=True)

    def test_build_graph_index_from_markdown(self) -> None:
        first = self.vault_path / "notes" / "first.md"
        second = self.vault_path / "notes" / "second.md"
        task = self.vault.tasks_root_path / "open" / "task.md"
        first.parent.mkdir(parents=True, exist_ok=True)
        task.parent.mkdir(parents=True, exist_ok=True)

        first.write_text(
            dump_markdown(
                {
                    "id": "note_first",
                    "node_id": "note_first",
                    "title": "First Note",
                    "type": "note",
                    "tags": ["project:alpha"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Links to [[notes/second]] and [[missing-note]]. Also {tag:topic/known} and #project/unknown.",
            ),
            encoding="utf-8",
        )
        second.write_text(
            dump_markdown(
                {
                    "id": "note_second",
                    "node_id": "note_second",
                    "title": "Second Note",
                    "type": "note",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "# Second Note",
            ),
            encoding="utf-8",
        )
        task.write_text(
            dump_markdown(
                {
                    "id": "task_one",
                    "node_id": "task_one",
                    "title": "Task One",
                    "type": "task",
                    "status": "open",
                    "priority": "M",
                    "tags": ["topic:known"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Task body",
            ),
            encoding="utf-8",
        )

        index = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        payload = index.to_dict()

        self.assertEqual(payload["version"], 1)
        self.assertIn("notes/first.md", payload["files"])
        self.assertIn("notes/second.md", payload["files"])
        self.assertIn("tasks/open/task.md", payload["files"])

        node_types = {node["id"]: node["type"] for node in payload["nodes"]}
        self.assertEqual(node_types.get("file:note_first"), "note")
        self.assertEqual(node_types.get("file:task_one"), "task")
        self.assertEqual(node_types.get("tag:project/alpha"), "tag")

        link_edges = [edge for edge in payload["edges"] if edge["type"] == "link"]
        self.assertTrue(any(edge["source"] == "file:note_first" and edge["target"] == "file:note_second" for edge in link_edges))

        tag_edges = [edge for edge in payload["edges"] if edge["type"] == "tagUsage"]
        self.assertTrue(any(edge["source"] == "file:note_first" and edge["target"] == "tag:project/alpha" for edge in tag_edges))
        self.assertTrue(any(edge["source"] == "file:task_one" and edge["target"] == "tag:topic/known" for edge in tag_edges))

        diagnostics = payload["diagnostics"]
        self.assertTrue(any(item["type"] == "unresolvedLink" and item.get("target") == "missing-note" for item in diagnostics))
        self.assertTrue(any(item["type"] == "unknownTag" and item.get("tag") == "project:unknown" for item in diagnostics))

    def test_graph_index_roundtrip_and_corrupt_fallback(self) -> None:
        note = self.vault_path / "notes" / "roundtrip.md"
        note.parent.mkdir(parents=True, exist_ok=True)
        note.write_text(
            dump_markdown(
                {
                    "id": "note_roundtrip",
                    "node_id": "note_roundtrip",
                    "title": "Roundtrip",
                    "type": "note",
                    "tags": ["project:alpha"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Body",
            ),
            encoding="utf-8",
        )

        index = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        write_graph_index(self.vault.graph_index_path, index)
        loaded = read_graph_index(self.vault.graph_index_path).to_dict()
        self.assertIn("notes/roundtrip.md", loaded["files"])
        self.assertEqual(loaded["version"], 1)

        self.vault.graph_index_path.write_text("{not json", encoding="utf-8")
        fallback = read_graph_index(self.vault.graph_index_path).to_dict()
        self.assertEqual(fallback["version"], 1)
        self.assertEqual(fallback["nodes"], [])
        self.assertTrue(any(item["type"] == "graphIndexReadFailed" for item in fallback["diagnostics"]))

    def test_graph_state_roundtrip_and_corrupt_fallback(self) -> None:
        saved = write_graph_state(
            self.vault.graph_state_path,
            {
                "activeMode": "tag",
                "filters": {"minimumWeight": 2},
                "viewport": {"zoom": 1.5, "pan": {"x": 12, "y": -4}},
            },
        )
        self.assertEqual(saved["version"], 1)
        loaded = read_graph_state(self.vault.graph_state_path)
        self.assertEqual(loaded["activeMode"], "tag")
        self.assertEqual(loaded["filters"]["minimumWeight"], 2)

        self.vault.graph_state_path.write_text("[]", encoding="utf-8")
        fallback = read_graph_state(self.vault.graph_state_path)
        self.assertEqual(fallback["version"], 1)
        self.assertEqual(fallback["activeMode"], "link")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import shutil
import unittest
import uuid
from pathlib import Path

from src.backend.nicknotes_backend.graph_index import build_graph_index, update_graph_index_for_file, related_files
from src.backend.nicknotes_backend.graph_storage import read_graph_index, read_graph_state, write_graph_index, write_graph_state
from src.backend.nicknotes_backend.graph_watcher import graph_watcher_snapshot
from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.markdown_io import dump_markdown
from src.backend.nicknotes_backend.projection_registry import TASK_LINK_INDEX_SCHEMA_VERSION
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
                {
                    "id": "person",
                    "displayName": "Person",
                    "color": "#d3a33a",
                    "tags": [{"id": "max", "displayName": "Max"}],
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
                    "related": ["notes/second"],
                    "related_auto": [],
                },
                "Links to [[missing-note]]. Also {tag:topic/known} and {tag:project/unknown}.",
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

        self.assertEqual(payload["version"], 2)
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
        self.assertEqual(loaded["version"], 2)

        self.vault.graph_index_path.write_text("{not json", encoding="utf-8")
        fallback = read_graph_index(self.vault.graph_index_path).to_dict()
        self.assertEqual(fallback["version"], 2)
        self.assertEqual(fallback["nodes"], [])
        self.assertTrue(any(item["type"] == "graphIndexReadFailed" for item in fallback["diagnostics"]))
        backups = list(self.vault.local_path.glob("graph-index.json.*.corrupt.*.bak"))
        self.assertEqual(len(backups), 1)

        rebuilt = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        write_graph_index(self.vault.graph_index_path, rebuilt)
        recovered = read_graph_index(self.vault.graph_index_path).to_dict()
        self.assertIn("notes/roundtrip.md", recovered["files"])
        self.assertFalse(any(item["type"] == "graphIndexReadFailed" for item in recovered["diagnostics"]))

    def test_legacy_backlink_edges_are_ignored_when_loading_index(self) -> None:
        payload = {
            "version": 2,
            "updated_at": "2026-01-01T00:00:00",
            "source": {},
            "files": {},
            "nodes": [],
            "edges": [
                {"id": "link:a->b", "source": "a", "target": "b", "type": "link", "weight": 5, "reasons": []},
                {"id": "backlink:b->a", "source": "b", "target": "a", "type": "backlink", "weight": 4, "reasons": []},
            ],
            "diagnostics": [],
        }
        self.vault.graph_index_path.write_text(__import__("json").dumps(payload), encoding="utf-8")
        loaded = read_graph_index(self.vault.graph_index_path).to_dict()
        self.assertEqual([edge["type"] for edge in loaded["edges"]], ["link"])

    def test_related_links_resolve_slug_variants(self) -> None:
        note = self.vault_path / "notes" / "source.md"
        target = self.vault_path / "company" / "reviews" / "Review_Board_2026_W16.md"
        note.parent.mkdir(parents=True, exist_ok=True)
        target.parent.mkdir(parents=True, exist_ok=True)
        note.write_text(
            dump_markdown(
                {
                    "id": "source",
                    "node_id": "source",
                    "title": "Source",
                    "type": "note",
                    "related": ["company/reviews/review-board-2026-W16"],
                },
                "# Source",
            ),
            encoding="utf-8",
        )
        target.write_text(
            dump_markdown(
                {"id": "review", "node_id": "review", "title": "Review", "type": "note"},
                "# Review",
            ),
            encoding="utf-8",
        )

        payload = build_graph_index(self.vault_path, self.vault.read_tag_groups()).to_dict()
        self.assertTrue(
            any(edge["type"] == "link" and edge["source"] == "file:source" and edge["target"] == "file:review" for edge in payload["edges"])
        )

    def test_save_note_document_recovers_renamed_path_by_id(self) -> None:
        old_path = self.vault_path / "notes" / "old-name.md"
        renamed_path = self.vault_path / "notes" / "Renamed_Note.md"
        renamed_path.parent.mkdir(parents=True, exist_ok=True)
        renamed_path.write_text(
            dump_markdown(
                {
                    "id": "note_stable_id",
                    "node_id": "note_stable_id",
                    "title": "Renamed Note",
                    "type": "note",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Original body.",
            ),
            encoding="utf-8",
        )

        indexer = VaultIndexer(self.vault.db_path)
        try:
            result = self.vault.save_note_document(
                str(old_path),
                dump_markdown(
                    {
                        "id": "note_stable_id",
                        "node_id": "note_stable_id",
                        "title": "Renamed Note",
                        "type": "note",
                        "tags": [],
                        "tags_auto": [],
                        "related": [],
                        "related_auto": [],
                    },
                    "Updated body.",
                ),
                indexer,
            )
        finally:
            indexer.close()

        saved_path = Path(result["path"])
        self.assertEqual(saved_path, renamed_path)
        self.assertIn("Updated body.", renamed_path.read_text(encoding="utf-8"))

    def test_incremental_update_refreshes_file_edges_and_diagnostics(self) -> None:
        first = self.vault_path / "notes" / "first.md"
        second = self.vault_path / "notes" / "second.md"
        third = self.vault_path / "notes" / "third.md"
        first.parent.mkdir(parents=True, exist_ok=True)

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
                "Links to [[missing-note]] and {tag:project/unknown}.",
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
        third.write_text(
            dump_markdown(
                {
                    "id": "note_third",
                    "node_id": "note_third",
                    "title": "Third Note",
                    "type": "note",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "# Third Note",
            ),
            encoding="utf-8",
        )

        index = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        original_second_hash = index.files["notes/second.md"].hash

        first.write_text(
            dump_markdown(
                {
                    "id": "note_first",
                    "node_id": "note_first",
                    "title": "First Note",
                    "type": "note",
                    "tags": [],
                    "tags_auto": ["topic:known"],
                    "related": [],
                    "related_auto": [],
                },
                "Links to [[notes/second]] and [[notes/third]].",
            ),
            encoding="utf-8",
        )

        updated = update_graph_index_for_file(
            vault_path=self.vault_path,
            tag_groups=self.vault.read_tag_groups(),
            index=index,
            file_path=first,
        )
        payload = updated.to_dict()
        self.assertEqual(payload["files"]["notes/second.md"]["hash"], original_second_hash)

        edges = payload["edges"]
        self.assertFalse(
            any(edge["type"] == "tagUsage" and edge["source"] == "file:note_first" and edge["target"] == "tag:project/alpha" for edge in edges)
        )
        self.assertTrue(
            any(edge["type"] == "tagUsage" and edge["source"] == "file:note_first" and edge["target"] == "tag:topic/known" for edge in edges)
        )
        self.assertTrue(any(edge["type"] == "link" and edge["source"] == "file:note_first" and edge["target"] == "file:note_second" for edge in edges))
        self.assertTrue(any(edge["type"] == "link" and edge["source"] == "file:note_first" and edge["target"] == "file:note_third" for edge in edges))

        diagnostics = payload["diagnostics"]
        self.assertFalse(any(item["type"] == "unresolvedLink" and item.get("path") == "notes/first.md" for item in diagnostics))
        self.assertFalse(any(item["type"] == "unknownTag" and item.get("path") == "notes/first.md" for item in diagnostics))

    def test_body_hashtags_and_mentions_are_not_tags(self) -> None:
        note = self.vault_path / "notes" / "hashtags.md"
        note.parent.mkdir(parents=True, exist_ok=True)
        note.write_text(
            dump_markdown(
                {
                    "id": "note_hashtags",
                    "node_id": "note_hashtags",
                    "title": "Hashtags",
                    "type": "note",
                    "tags": [],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Plain text #known #project/alpha @max project:alpha but explicit {tag:topic/known}.",
            ),
            encoding="utf-8",
        )

        payload = build_graph_index(self.vault_path, self.vault.read_tag_groups()).to_dict()
        tags = payload["files"]["notes/hashtags.md"]["tags"]

        self.assertEqual(tags, ["topic:known"])
        self.assertFalse(any(node["id"] == "tag:project/alpha" for node in payload["nodes"]))

    def test_shared_tag_edges_are_derived_without_backlinks(self) -> None:
        first = self.vault_path / "notes" / "first.md"
        second = self.vault_path / "notes" / "second.md"
        third = self.vault_path / "notes" / "third.md"
        first.parent.mkdir(parents=True, exist_ok=True)

        first.write_text(
            dump_markdown(
                {
                    "id": "note_first",
                    "node_id": "note_first",
                    "title": "First Note",
                    "type": "note",
                    "tags": ["project:alpha", "person:max"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "Links to [[notes/second]].",
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
                    "tags": ["project:alpha", "person:max"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "# Second Note",
            ),
            encoding="utf-8",
        )
        third.write_text(
            dump_markdown(
                {
                    "id": "note_third",
                    "node_id": "note_third",
                    "title": "Third Note",
                    "type": "note",
                    "tags": ["topic:known"],
                    "tags_auto": [],
                    "related": [],
                    "related_auto": [],
                },
                "# Third Note",
            ),
            encoding="utf-8",
        )

        payload = build_graph_index(self.vault_path, self.vault.read_tag_groups()).to_dict()
        edges = payload["edges"]
        self.assertFalse(any(edge["type"] == "backlink" for edge in edges))

        shared_edges = [edge for edge in edges if edge["type"] == "sharedTag"]
        self.assertEqual(shared_edges, [])
        neighbours = related_files(build_graph_index(self.vault_path, self.vault.read_tag_groups()), 'file:note_first')
        match = next(item for item in neighbours['items'] if item['id'] == 'file:note_second')
        self.assertEqual(match['sharedTags'], ['person:max', 'project:alpha'])
        self.assertEqual(match['weight'], 10)  # Five for tags, five for the explicit link.

        edge_ids = [edge["id"] for edge in edges]
        self.assertEqual(len(edge_ids), len(set(edge_ids)))

    def test_shared_tag_edges_use_tag_buckets_for_sparse_graphs(self) -> None:
        notes_dir = self.vault_path / "notes"
        notes_dir.mkdir(parents=True, exist_ok=True)
        for index_value in range(80):
            note = notes_dir / f"note-{index_value}.md"
            note.write_text(
                dump_markdown(
                    {
                        "id": f"note_{index_value}",
                        "node_id": f"note_{index_value}",
                        "title": f"Note {index_value}",
                        "type": "note",
                        "tags": [f"topic:unique-{index_value}"],
                        "tags_auto": [],
                        "related": [],
                        "related_auto": [],
                    },
                    f"# Note {index_value}",
                ),
                encoding="utf-8",
            )

        payload = build_graph_index(self.vault_path, self.vault.read_tag_groups()).to_dict()
        self.assertEqual([edge for edge in payload["edges"] if edge["type"] == "sharedTag"], [])

    def test_deleted_file_is_removed_incrementally(self) -> None:
        first = self.vault_path / "notes" / "first.md"
        second = self.vault_path / "notes" / "second.md"
        first.parent.mkdir(parents=True, exist_ok=True)
        first.write_text(
            dump_markdown(
                {"id": "note_first", "node_id": "note_first", "title": "First", "type": "note", "tags": ["project:alpha"]},
                "Links to [[notes/second]].",
            ),
            encoding="utf-8",
        )
        second.write_text(
            dump_markdown(
                {"id": "note_second", "node_id": "note_second", "title": "Second", "type": "note", "tags": ["project:alpha"]},
                "# Second",
            ),
            encoding="utf-8",
        )
        index = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        missing_path = first.with_name("deleted.md")

        updated = update_graph_index_for_file(
            vault_path=self.vault_path,
            tag_groups=self.vault.read_tag_groups(),
            index=index,
            file_path=missing_path,
            previous_path=first,
        )
        payload = updated.to_dict()
        self.assertNotIn("notes/first.md", payload["files"])
        self.assertFalse(any(node["id"] == "file:note_first" for node in payload["nodes"]))
        self.assertFalse(any(edge["source"] == "file:note_first" or edge["target"] == "file:note_first" for edge in payload["edges"]))

    def test_large_shared_tag_bucket_does_not_crash(self) -> None:
        notes_dir = self.vault_path / "notes"
        notes_dir.mkdir(parents=True, exist_ok=True)
        for index_value in range(45):
            note = notes_dir / f"alpha-{index_value}.md"
            note.write_text(
                dump_markdown(
                    {
                        "id": f"alpha_{index_value}",
                        "node_id": f"alpha_{index_value}",
                        "title": f"Alpha {index_value}",
                        "type": "note",
                        "tags": ["project:alpha"],
                    },
                    f"# Alpha {index_value}",
                ),
                encoding="utf-8",
            )

        payload = build_graph_index(self.vault_path, self.vault.read_tag_groups()).to_dict()
        shared_edges = [edge for edge in payload["edges"] if edge["type"] == "sharedTag"]
        self.assertEqual(shared_edges, [])
        index = build_graph_index(self.vault_path, self.vault.read_tag_groups())
        neighbours = related_files(index, 'file:alpha_0', limit=10)
        self.assertEqual(len(neighbours['items']), 10)
        self.assertTrue(neighbours['truncated'])
        self.assertEqual(neighbours['total'], 44)

    def test_graph_state_roundtrip_and_corrupt_fallback(self) -> None:
        saved = write_graph_state(
            self.vault.graph_state_path,
            {
                "activeMode": "tag",
                "filters": {"minimumWeight": 2},
                "viewport": {"zoom": 1.5, "pan": {"x": 12, "y": -4}},
            },
        )
        self.assertEqual(saved["version"], 2)
        loaded = read_graph_state(self.vault.graph_state_path)
        self.assertEqual(loaded["activeMode"], "tag")
        self.assertEqual(loaded["filters"]["minimumWeight"], 2)

        self.vault.graph_state_path.write_text("[]", encoding="utf-8")
        fallback = read_graph_state(self.vault.graph_state_path)
        self.assertEqual(fallback["version"], 2)
        self.assertEqual(fallback["activeMode"], "focus")
        backups = list(self.vault.system_path.glob("graph-state.json.*.corrupt.*.bak"))
        self.assertEqual(len(backups), 1)

    def test_task_status_links_roundtrip_and_corrupt_fallback(self) -> None:
        valid = {
            "version": TASK_LINK_INDEX_SCHEMA_VERSION,
            "updated_at": "2026-06-15T00:00:00",
            "links": {"task_abc": "tasks/open/task-abc.md"},
        }
        self.vault.task_status_links_path.write_text(json.dumps(valid), encoding="utf-8")
        loaded = self.vault._read_task_status_link_index()
        self.assertEqual(loaded, {"task_abc": "tasks/open/task-abc.md"})

        corrupted = self.vault.task_status_links_path
        corrupted.write_text("{not json", encoding="utf-8")
        recovered = self.vault._read_task_status_link_index()
        self.assertEqual(recovered, {})
        backups = list(self.vault.local_path.glob("task_status_links.json.*.corrupt.*.bak"))
        self.assertEqual(len(backups), 1)

    def test_graph_state_migrates_legacy_payload_and_watcher_ignores_system(self) -> None:
        self.vault.graph_state_path.write_text('{"version":1,"activeMode":"focus","filters":{},"positions":{"file:a":{"x":1,"y":2}}}', encoding="utf-8")
        migrated = read_graph_state(self.vault.graph_state_path)
        self.assertEqual(migrated["version"], 2)
        self.assertEqual(migrated["activeMode"], "focus")
        self.assertEqual(migrated["positions"]["file:a"]["x"], 1)

        note = self.vault_path / "notes" / "visible.md"
        system_note = self.vault.system_path / "hidden.md"
        note.parent.mkdir(parents=True, exist_ok=True)
        note.write_text("# Visible", encoding="utf-8")
        system_note.write_text("# Hidden", encoding="utf-8")
        snapshot = graph_watcher_snapshot(self.vault_path)
        self.assertIn(note.resolve(), snapshot)
        self.assertNotIn(system_note.resolve(), snapshot)


if __name__ == "__main__":
    unittest.main()

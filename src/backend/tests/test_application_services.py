from __future__ import annotations

import tempfile
import hashlib
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from src.backend.application_services import BackendApiService
from src.backend import api as backend_api


class BackendApiServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        backend_api.state.dispose_session()
        self.service = BackendApiService(runtime=backend_api.state, capabilities=backend_api.BACKEND_CAPABILITIES)
        # Keep a deterministic module target and avoid re-import side effects in tests.

    @staticmethod
    def _mock_note_path(path: str, *, exists: bool, content: str = "") -> Path:
        fake_parent = mock.MagicMock()
        fake_parent.mkdir.return_value = None

        fake_path = mock.MagicMock(spec=Path)
        fake_path.__str__.return_value = path
        fake_path.exists.return_value = exists
        fake_path.is_file.return_value = True
        fake_path.read_text.return_value = content
        fake_path.read_bytes.return_value = content.encode('utf-8')
        fake_path.write_text.return_value = None
        fake_path.unlink.return_value = None
        fake_path.mkdir.return_value = None
        fake_path.parent = fake_parent
        fake_path.name = "note.md"
        fake_path.resolve.return_value = fake_path
        return fake_path

    @staticmethod
    def _replace_projection_lock(lock: Any) -> Any:
        previous_lock = backend_api.state._session.projection_lock
        backend_api.state._session.projection_lock = lock
        return previous_lock

    def test_health_is_served_by_application_service(self) -> None:
        result = self.service.health()
        self.assertTrue(result["ok"])
        self.assertFalse(result["vaultLoaded"])
        self.assertEqual(result["capabilities"], backend_api.BACKEND_CAPABILITIES)

    def test_state_is_served_by_application_service(self) -> None:
        result = self.service.get_state()
        self.assertEqual(result, {"vaultLoaded": False})

    def test_create_vault_route_delegates_to_service(self) -> None:
        request = backend_api.VaultCreateRequest(parentPath="C:/temp", name="TestVault")
        expected = {"path": "C:/temp", "created": True}
        with mock.patch.object(backend_api.backend_api_service, "create_vault", return_value=expected) as spy:
            result = backend_api.create_vault(request)
            self.assertIs(result, expected)
            spy.assert_called_once_with(request)

    def test_open_vault_route_delegates_to_service(self) -> None:
        request = backend_api.VaultOpenRequest(path="C:/temp")
        expected = {"vaultPath": "C:/temp"}
        with mock.patch.object(backend_api.backend_api_service, "open_vault", return_value=expected) as spy:
            result = backend_api.open_vault(request)
            self.assertIs(result, expected)
            spy.assert_called_once_with(request)

    def test_get_focus_dashboard_route_delegates_to_service(self) -> None:
        expected = {"date": "2026-06-15", "stats": {}}
        with mock.patch.object(backend_api.backend_api_service, "get_focus_dashboard", return_value=expected) as spy:
            result = backend_api.get_focus_dashboard("2026-06-15")
            self.assertIs(result, expected)
            spy.assert_called_once_with("2026-06-15")

    def test_start_notebase_open_route_delegates_to_service(self) -> None:
        request = backend_api.VaultOpenRequest(path="C:/temp")
        expected = {"started": True, "path": "C:/temp"}
        with mock.patch.object(backend_api.backend_api_service, "start_notebase_open", return_value=expected) as spy:
            result = backend_api.start_notebase_open(request)
            self.assertIs(result, expected)
            spy.assert_called_once_with(request)

    def test_get_notebase_open_status_route_delegates_to_service(self) -> None:
        expected = {"active": False}
        with mock.patch.object(backend_api.backend_api_service, "get_notebase_open_status", return_value=expected) as spy:
            result = backend_api.get_notebase_open_status()
            self.assertIs(result, expected)
            spy.assert_called_once_with()

    def test_rename_notebase_can_rename_explicit_recent_path_without_opening(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            parent = Path(tmpdir)
            vault_path = parent / "RecentBase"
            (vault_path / ".system").mkdir(parents=True)
            (vault_path / ".system" / "config.json").write_text("{}", encoding="utf-8")

            request = backend_api.NoteBaseRenameRequest(path=str(vault_path), newName="RenamedBase")
            result = self.service.rename_notebase(request)

            renamed_path = parent / "RenamedBase"
            # Windows TEMP may use an 8.3 alias; the API returns resolved paths.
            self.assertEqual(result["vaultPath"], str(renamed_path.resolve()))
            self.assertFalse(vault_path.exists())
            self.assertTrue(renamed_path.exists())
            self.assertFalse(backend_api.state.vault)

    def test_delete_notebase_can_delete_explicit_recent_path_without_opening(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            vault_path = Path(tmpdir) / "RecentBase"
            (vault_path / ".system").mkdir(parents=True)
            (vault_path / ".system" / "config.json").write_text('{"vault_id": "recent"}', encoding="utf-8")

            request = backend_api.NoteBaseDeleteRequest(path=str(vault_path), confirmDelete=True)
            # The Recycle Bin itself is not exercised by unattended tests.
            with mock.patch("src.backend.application_services.move_to_trash") as trash:
                result = self.service.delete_notebase(request)

            trash.assert_called_once_with(vault_path.resolve())
            self.assertTrue(result["deleted"])
            self.assertEqual(result["deletedPath"], str(vault_path.resolve()))
            self.assertFalse(result["vaultLoaded"])
            self.assertFalse(backend_api.state.vault)


    def test_save_note_content_executes_transaction_with_recovery_log(self) -> None:
        fake_path = self._mock_note_path("note.md", exists=True, content="title: A\\n\\nbody")
        request = backend_api.NoteSaveRequest(expectedRevision=hashlib.sha256(fake_path.read_bytes()).hexdigest(), path="note.md", content="title: B\\n\\nbody")
        vault = mock.MagicMock()
        vault.vault_path = Path("C:/dummy")
        vault.save_note_document.return_value = {
            "path": "note.md",
            "title": "B",
            "tag_rebuild_required": False,
        }
        vault.sync_tag_groups_with_index.return_value = None
        vault.consume_last_link_rewrite_result.return_value = {"updated": 0, "paths": []}
        indexer = mock.MagicMock()
        projection_lock = mock.MagicMock()
        previous_lock = self._replace_projection_lock(projection_lock)

        try:
            with mock.patch.object(self.service, "_resolve_note_request_path", return_value=fake_path), mock.patch.object(
                self.service,
                "require_loaded",
                return_value=(vault, indexer),
            ), mock.patch.object(self.service, "counts", return_value={"notes": 1}):
                with mock.patch.object(
                    self.service,
                    "update_graph_after_note_save",
                    return_value={"available": True},
                ) as update_graph:
                    result = self.service.save_note_content(request)
                    self.assertTrue(result.get("saved"))
                    self.assertEqual(result.get("path"), "note.md")
                    self.assertEqual(result["operationLog"]["status"], "completed")
                    self.assertTrue(
                        any(step["name"] == "save_note_document" for step in result["operationLog"]["steps"])
                    )
                    update_graph.assert_called_once()
                    projection_lock.__enter__.assert_called_once()
                    projection_lock.__exit__.assert_called_once()
        finally:
            backend_api.state._session.projection_lock = previous_lock

    def test_save_note_content_rolls_back_on_graph_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            rollback_path = Path(tmpdir) / "rollback.md"
            fake_path = self._mock_note_path(str(rollback_path), exists=True, content="title: Rollback\\n\\nbody")
            request = backend_api.NoteSaveRequest(expectedRevision=hashlib.sha256(fake_path.read_bytes()).hexdigest(), path=str(rollback_path), content="title: Updated\\n\\nbody")
            vault = mock.MagicMock()
            vault.vault_path = Path("C:/dummy")
            vault.save_note_document.return_value = {
                "path": str(rollback_path),
                "title": "Updated",
                "tag_rebuild_required": False,
            }
            vault.sync_tag_groups_with_index.return_value = None
            vault.consume_last_link_rewrite_result.return_value = {"updated": 0, "paths": []}
            indexer = mock.MagicMock()

            with mock.patch.object(self.service, "_resolve_note_request_path", return_value=fake_path), mock.patch.object(
                self.service,
                "require_loaded",
                return_value=(vault, indexer),
            ), mock.patch.object(self.service, "counts", return_value={"notes": 1}):
                    with mock.patch.object(
                        self.service,
                        "update_graph_after_note_save",
                        side_effect=RuntimeError("graph broken"),
                    ):
                        with self.assertRaises(Exception):
                            self.service.save_note_content(request)
                    self.assertTrue(
                        any("rollback.md" in str(args[0]) for args in indexer.remove_projection_for_path.call_args_list for args in [args[0]])
                    )

    def test_delete_note_content_runs_transaction(self) -> None:
        fake_path = self._mock_note_path("delete-me.md", exists=True, content="title: Delete\\n\\nbody")
        request = backend_api.NoteFileDeleteRequest(path="delete-me.md")
        vault = mock.MagicMock()
        vault.vault_path = Path("C:/dummy")
        vault.delete_note_file.return_value = None
        vault.consume_last_link_rewrite_result.return_value = {"updated": 0, "paths": []}
        indexer = mock.MagicMock()
        projection_lock = mock.MagicMock()
        previous_lock = self._replace_projection_lock(projection_lock)

        try:
            with mock.patch.object(self.service, "_resolve_note_request_path", return_value=fake_path), mock.patch.object(
                self.service,
                "require_loaded",
                return_value=(vault, indexer),
            ), mock.patch.object(self.service, "counts", return_value={"notes": 0}), mock.patch.object(
                self.service,
                "rebuild_graph_projection",
                return_value={"available": True},
            ) as rebuild:
                result = self.service.delete_note(request)
                self.assertTrue(result["deleted"])
                self.assertEqual(result["operationLog"]["status"], "completed")
                vault.delete_note_file.assert_called_once_with("delete-me.md", indexer)
                rebuild.assert_called_once()
                projection_lock.__enter__.assert_called_once()
                projection_lock.__exit__.assert_called_once()
        finally:
            backend_api.state._session.projection_lock = previous_lock

    def test_rename_note_uses_projection_lock(self) -> None:
        fake_path = self._mock_note_path("note.md", exists=True, content="title: One\\n\\nbody")
        request = backend_api.NoteFileRenameRequest(path="note.md", newName="note-new.md")
        vault = mock.MagicMock()
        vault.vault_path = Path("C:/dummy")
        vault.rename_note_file.return_value = Path("C:/dummy/note-new.md")
        vault.consume_last_link_rewrite_result.return_value = {"updated": 0, "paths": []}
        indexer = mock.MagicMock()
        projection_lock = mock.MagicMock()
        previous_lock = self._replace_projection_lock(projection_lock)

        with mock.patch.object(self.service, "_resolve_note_request_path", return_value=fake_path), mock.patch.object(
            self.service,
            "require_loaded",
            return_value=(vault, indexer),
        ), mock.patch.object(
            self.service,
            "rebuild_graph_projection",
            return_value={"available": True},
        ) as rebuild:
            try:
                result = self.service.rename_note(request)
                self.assertTrue(result["renamedPath"].endswith("note-new.md"))
                self.assertEqual(result["operationLog"]["status"], "completed")
                vault.rename_note_file.assert_called_once_with("note.md", "note-new.md", indexer)
                rebuild.assert_called_once()
                projection_lock.__enter__.assert_called_once()
                projection_lock.__exit__.assert_called_once()
            finally:
                backend_api.state._session.projection_lock = previous_lock

    def test_move_note_uses_projection_lock(self) -> None:
        fake_path = self._mock_note_path("note.md", exists=True, content="title: Move\\n\\nbody")
        request = backend_api.NoteFileMoveRequest(path="note.md", targetGroupKey="02_tasks")
        vault = mock.MagicMock()
        vault.vault_path = Path("C:/dummy")
        vault.move_note_file.return_value = Path("C:/dummy/02_tasks/note.md")
        vault.consume_last_link_rewrite_result.return_value = {"updated": 0, "paths": []}
        indexer = mock.MagicMock()
        projection_lock = mock.MagicMock()
        previous_lock = self._replace_projection_lock(projection_lock)

        with mock.patch.object(self.service, "_resolve_note_request_path", return_value=fake_path), mock.patch.object(
            self.service,
            "require_loaded",
            return_value=(vault, indexer),
        ), mock.patch.object(
            self.service,
            "rebuild_graph_projection",
            return_value={"available": True},
        ) as rebuild:
            try:
                result = self.service.move_note(request)
                self.assertEqual(result["movedPath"], str(Path("C:/dummy/02_tasks/note.md")))
                self.assertEqual(result["operationLog"]["status"], "completed")
                vault.move_note_file.assert_called_once_with("note.md", "02_tasks", indexer)
                rebuild.assert_called_once()
                projection_lock.__enter__.assert_called_once()
                projection_lock.__exit__.assert_called_once()
            finally:
                backend_api.state._session.projection_lock = previous_lock


if __name__ == "__main__":
    unittest.main()

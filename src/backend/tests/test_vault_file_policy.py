from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path
from unittest import mock

from src.backend import api as backend_api
from src.backend.errors import DomainError
from src.backend.nicknotes_backend.indexer import VaultIndexer
from src.backend.nicknotes_backend.vault import VaultManager


class VaultFilePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        base_tmp = Path.cwd() / "src" / "backend" / "tests" / "_runtime"
        base_tmp.mkdir(parents=True, exist_ok=True)
        self.test_root = base_tmp / f"file_policy_{uuid.uuid4().hex}"
        self.vault_path = self.test_root / "vault"
        self.vault_path.mkdir(parents=True, exist_ok=True)
        self.vault = VaultManager(self.vault_path)
        self.vault.ensure_structure()
        self.indexer = VaultIndexer(self.vault.db_path)
        backend_api.state.start_session(vault=self.vault, indexer=self.indexer)

    def tearDown(self) -> None:
        backend_api.state.dispose_session()
        shutil.rmtree(self.test_root, ignore_errors=True)

    def test_note_content_allows_files_inside_loaded_vault(self) -> None:
        note_path = self.vault_path / "notes" / "inside.md"
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("# Inside\n\nVault content.", encoding="utf-8")

        payload = backend_api.read_note_content(str(note_path))

        self.assertEqual(payload.get("path"), str(note_path.resolve()))
        self.assertIn("Vault content.", payload.get("content", ""))

    def test_note_content_blocks_files_outside_loaded_vault(self) -> None:
        outside_path = self.test_root / "outside.md"
        outside_path.write_text("# Outside", encoding="utf-8")

        with self.assertRaises(DomainError) as caught:
            backend_api.read_note_content(str(outside_path))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.error_code, "request.validation")

    def test_open_note_file_uses_same_vault_boundary(self) -> None:
        inside_path = self.vault_path / "notes" / "openable.md"
        inside_path.parent.mkdir(parents=True, exist_ok=True)
        inside_path.write_text("# Openable", encoding="utf-8")
        outside_path = self.test_root / "outside-open.md"
        outside_path.write_text("# Outside", encoding="utf-8")

        with self.assertRaises(DomainError) as caught:
            backend_api.open_note_file(backend_api.NoteOpenRequest(path=str(outside_path)))
        self.assertEqual(caught.exception.status_code, 400)

        with mock.patch("src.backend.application_services.sys.platform", "linux"), mock.patch(
            "src.backend.application_services.subprocess.run"
        ) as run:
            allowed = backend_api.open_note_file(backend_api.NoteOpenRequest(path=str(inside_path)))

        self.assertTrue(allowed.get("opened"))
        run.assert_called_once_with(["xdg-open", str(inside_path.resolve())], check=False)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient
    from src.backend import api as backend_api
    from src.backend.errors import DomainError
except Exception:  # pragma: no cover - optional dependency or backend import path issues in env
    TestClient = None
    backend_api = None
    DomainError = None


@unittest.skipIf(
    backend_api is None or TestClient is None or DomainError is None,
    "FastAPI TestClient oder Backend-API sind in dieser Umgebung nicht verfuegbar.",
)
class ApiErrorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        backend_api.state.close()

    def test_validation_domain_error_is_standardized(self) -> None:
        client = TestClient(backend_api.app)
        with mock.patch.object(
            backend_api.backend_api_service,
            "open_vault",
            side_effect=DomainError(
                "Vault path invalid",
                status_code=400,
                error_code="request.validation",
                operation="test_open_vault",
                vault_id="C:/tmp/test",
            ),
        ):
            response = client.post("/vault/open", json={"path": "C:/tmp/test"})
            self.assertEqual(response.status_code, 400)
            payload = response.json()
            self.assertEqual(payload.get("ok"), False)
            self.assertEqual(payload.get("status"), 400)
            self.assertEqual(payload.get("error", {}).get("code"), "request.validation")
            self.assertEqual(payload.get("error", {}).get("message"), "Vault path invalid")
            self.assertIn("operationId", payload.get("error", {}))

    def test_unexpected_exception_is_sanitized(self) -> None:
        client = TestClient(backend_api.app)
        with mock.patch.object(
            backend_api.backend_api_service,
            "open_vault",
            side_effect=RuntimeError("Internal sqlite detail with secret"),
        ):
            response = client.post("/vault/open", json={"path": "C:/tmp/test"})
            self.assertEqual(response.status_code, 500)
            payload = response.json()
            self.assertEqual(payload.get("ok"), False)
            self.assertEqual(payload.get("status"), 500)
            self.assertEqual(payload.get("error", {}).get("code"), "service.unexpected")
            self.assertNotEqual(payload.get("error", {}).get("message"), "Internal sqlite detail with secret")

    def test_not_loaded_guard_uses_error_payload(self) -> None:
        client = TestClient(backend_api.app)
        response = client.post("/notebase/reindex")
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload.get("error", {}).get("code"), "request.validation")
        self.assertIn("No NoteBase loaded", payload.get("error", {}).get("message", ""))

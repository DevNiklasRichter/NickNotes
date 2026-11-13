from __future__ import annotations

import unittest
from unittest import mock

from src.backend.tests.http_client import TestClient
from src.backend import api as backend_api
from src.backend.errors import DomainError


class ApiErrorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        backend_api.state.dispose_session()

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
            response = client.post("/notebase/open", json={"path": "C:/tmp/test"})
            self.assertEqual(response.status_code, 400)
            payload = response.json()
            self.assertEqual(payload.get("ok"), False)
            self.assertEqual(payload.get("status"), 400)
            self.assertEqual(payload.get("error", {}).get("code"), "request.validation")
            self.assertEqual(payload.get("error", {}).get("message"), "Vault path invalid")
            self.assertIn("operationId", payload.get("error", {}))

    def test_unexpected_exception_is_sanitized(self) -> None:
        client = TestClient(backend_api.app, raise_server_exceptions=False)
        with mock.patch.object(
            backend_api.backend_api_service,
            "open_vault",
            side_effect=RuntimeError("Internal sqlite detail with secret"),
        ):
            response = client.post("/notebase/open", json={"path": "C:/tmp/test"})
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

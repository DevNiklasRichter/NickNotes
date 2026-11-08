from __future__ import annotations

import unittest

from src.backend.tests.http_client import TestClient
from src.backend import api as backend_api


class ApiCorsTests(unittest.TestCase):
    def setUp(self) -> None:
        backend_api.state.close()

    def _preflight_headers(self, origin: str) -> dict[str, str]:
        return {
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        }

    def test_cors_allows_configured_origin(self) -> None:
        client = TestClient(backend_api.app)
        allowed = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8765",
            "http://127.0.0.1:8765",
            "nicknotes://app",
        ]
        for origin in allowed:
            response = client.options("/state", headers=self._preflight_headers(origin))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers.get("access-control-allow-origin"), origin)

    def test_cors_rejects_untrusted_origin(self) -> None:
        client = TestClient(backend_api.app)
        response = client.options("/state", headers=self._preflight_headers("http://malicious.example"))
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "http://malicious.example")
        self.assertEqual(response.status_code, 400)

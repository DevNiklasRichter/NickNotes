import unittest
from fastapi.testclient import TestClient
from src.backend.api import app
from src.backend.security import INTERNAL_TOKEN


class TransportSecurityTests(unittest.TestCase):
    def test_requires_app_token(self):
        with TestClient(app, base_url='http://127.0.0.1:8765') as client:
            self.assertEqual(client.get('/state').status_code, 401)
            self.assertEqual(client.get('/state', headers={'Authorization': f'Bearer {INTERNAL_TOKEN}'}).status_code, 200)

    def test_rejects_null_origin_and_untrusted_host_with_valid_token(self):
        with TestClient(app, base_url='http://127.0.0.1:8765', headers={'Authorization': f'Bearer {INTERNAL_TOKEN}'}) as client:
            self.assertEqual(client.get('/state', headers={'Origin': 'null'}).status_code, 403)
            self.assertEqual(client.get('/state', headers={'Host': 'untrusted.example'}).status_code, 403)

    def test_rejects_oversized_body_before_parse(self):
        with TestClient(app, base_url='http://127.0.0.1:8765', headers={'Authorization': f'Bearer {INTERNAL_TOKEN}'}) as client:
            self.assertEqual(client.post('/notes/save', content=b'{}', headers={'Content-Length': str(31*1024*1024)}).status_code, 413)

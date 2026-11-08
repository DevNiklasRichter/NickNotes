from fastapi.testclient import TestClient as RawTestClient
from src.backend.security import INTERNAL_TOKEN


def TestClient(app, **kwargs):
    kwargs.setdefault('base_url', 'http://127.0.0.1:8765')
    kwargs.setdefault('headers', {'Authorization': f'Bearer {INTERNAL_TOKEN}'})
    return RawTestClient(app, **kwargs)

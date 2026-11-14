"""User-local MCP grants. Only salted, high-entropy token digests are persisted."""
from __future__ import annotations
from contextvars import ContextVar
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import uuid
from .nicknotes_backend.file_io import atomic_write_text
from .nicknotes_backend.local_data import user_data_path
from .nicknotes_backend.source_journal import active_journal

principal = ContextVar('nicknotes_mcp_principal', default=None)

class GrantStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else user_data_path() / 'mcp-grants.json'
        self.lock = threading.RLock()

    def _read(self):
        if not self.path.exists():
            return []
        value = json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(value, list):
            raise ValueError('Invalid local MCP grants.')
        return value

    def _write(self, values):
        context = active_journal.set(None)
        try:
            atomic_write_text(self.path, json.dumps(values, indent=2))
            if os.name != 'nt':
                self.path.chmod(0o600)
        finally:
            active_journal.reset(context)

    def list(self):
        with self.lock:
            return [{k: v for k, v in item.items() if k != 'digest'} for item in self._read()]

    def create(self, name, vault, write=False):
        secret = secrets.token_urlsafe(48)
        record = {'id': uuid.uuid4().hex, 'name': name.strip()[:80] or 'Agent', 'vaultId': vault.read_config()['vault_id'], 'vaultPath': str(vault.vault_path.resolve()), 'write': bool(write), 'createdAt': datetime.now(timezone.utc).isoformat(), 'digest': hashlib.sha256(secret.encode()).hexdigest()}
        with self.lock:
            records = self._read()
            if len(records) >= 100:
                raise ValueError('Maximal 100 lokale Agent-Freigaben. Bitte alte Freigaben entfernen.')
            records.append(record)
            self._write(records)
        return {k:v for k,v in record.items() if k != 'digest'} | {'token': secret}

    def revoke(self, identity):
        with self.lock:
            self._write([item for item in self._read() if item['id'] != identity])

    def verify(self, token):
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            return next((item for item in self._read() if hmac.compare_digest(item['digest'], digest)), None)

    def current(self, identity):
        with self.lock:
            return next((item for item in self._read() if item['id'] == identity), None)

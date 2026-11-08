"""Bounded source backups and compensation for multi-file application operations."""
from contextvars import ContextVar
import json
import os
from pathlib import Path
import uuid

active_journal = ContextVar('nicknotes_source_journal', default=None)


class SourceJournal:
    def __init__(self, vault, operation):
        self.vault = vault
        self.root = vault.vault_path.resolve()
        self.directory = vault.system_path / 'recovery' / uuid.uuid4().hex
        self.operation = operation
        self.before = {}
        self.size = 0
        self.state = 'running'

    def __enter__(self):
        self.parent = active_journal.get()
        self.token = active_journal.set(self)
        return self

    def record(self, path):
        from .file_io import atomic_write_bytes
        path = Path(path).resolve()
        try:
            relative = path.relative_to(self.root)
        except ValueError:
            raise ValueError('Source operation escaped the NoteBase.')
        if relative.parts[0] in {'.system', 'system', '99_system'} and path not in {self.vault.tag_groups_path.resolve(), self.vault.config_path.resolve()}:
            return
        if relative.parts[0] in {self.vault.tag_root_name, '02_tags'}:
            return
        if path in self.before or path.is_dir():
            return
        if getattr(self, 'parent', None):
            self.parent.record(path)
        content = path.read_bytes() if path.exists() else None
        self.size += len(content or b'')
        if self.size > 64 * 1024 * 1024:
            raise ValueError('Aenderung ist zu gross fuer die sichere Wiederherstellung (64 MB).')
        self.before[path] = content
        if content is not None:
            atomic_write_bytes(self.directory / f'{len(self.before)-1}.bak', content)
        # Append a durable intent before the source write. This remains linear for large moves.
        self.directory.mkdir(parents=True, exist_ok=True)
        entry = {'path': str(path.relative_to(self.root)), 'backup': f'{len(self.before)-1}.bak' if content is not None else None}
        with (self.directory/'entries.jsonl').open('a',encoding='utf-8') as stream:
            stream.write(json.dumps(entry)+'\n')
            stream.flush()
            os.fsync(stream.fileno())
        if len(self.before) == 1:
            self._manifest()

    def move(self, source, target):
        source, target = Path(source), Path(target)
        if source.is_dir():
            for child in source.rglob('*'):
                if child.is_file():
                    self.record(child)
                    self.record(target / child.relative_to(source))
        else:
            self.record(source)
            self.record(target)

    def tree(self, path):
        for child in Path(path).rglob('*'):
            if child.is_file():
                self.record(child)

    def _manifest(self):
        from .file_io import atomic_write_text
        entries = [{'path': str(p.relative_to(self.root)), 'backup': f'{i}.bak' if value is not None else None} for i, (p, value) in enumerate(self.before.items())]
        atomic_write_text(self.directory / 'manifest.json', json.dumps({'operation': self.operation, 'state': self.state, 'entries': entries if self.state != 'running' else [], 'entriesFormat': 'jsonl' if self.state == 'running' else 'inline'}, indent=2))

    def __exit__(self, error_type, error, traceback):
        from .file_io import atomic_write_bytes, atomic_write_text
        active_journal.reset(self.token)
        if not self.before:
            return
        if error_type:
            try:
                for path, content in reversed(list(self.before.items())):
                    if content is None:
                        path.unlink(missing_ok=True)
                    else:
                        atomic_write_bytes(path, content)
                self.state = 'restored'
            except OSError:
                self.state = 'recovery_required'
            atomic_write_text(self.vault.system_path / 'projection-dirty.json', json.dumps({'operation': self.operation, 'sources': self.state}))
        else:
            self.state = 'committed'
        self._manifest()
        try:
            self._prune()
        except OSError:
            pass

    def _prune(self):
        # Retain the latest ten successful source backups; never prune unresolved operations.
        parent = self.directory.parent.resolve()
        complete = []
        for directory in parent.iterdir():
            if directory.is_symlink() or len(directory.name) != 32:
                continue
            manifest = directory / 'manifest.json'
            try:
                if json.loads(manifest.read_text()).get('state') in {'committed', 'restored', 'kept'}:
                    complete.append(directory)
            except (ValueError, OSError):
                continue
        for directory in sorted(complete, key=lambda p: p.stat().st_mtime, reverse=True)[10:]:
            try:
                files = list(directory.iterdir())
                if any(file.name not in {'manifest.json', 'entries.jsonl'} and not (file.stem.isdigit() and file.suffix == '.bak') for file in files):
                    continue
                for file in files:
                    if file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(parent):
                        file.unlink()
                directory.rmdir()
            except OSError:
                pass  # A cleanup failure must never turn a committed source write into a failed save.


def pending_recovery(vault):
    parent = vault.system_path / 'recovery'
    if not parent.exists():
        return []
    pending = []
    for manifest in parent.glob('*/manifest.json'):
        try:
            if json.loads(manifest.read_text()).get('state') not in {'committed', 'restored', 'kept'}:
                pending.append(str(manifest.relative_to(vault.vault_path)))
        except (OSError, ValueError):
            pending.append(str(manifest.relative_to(vault.vault_path)))
    return pending

"""Device-local data: projections and journals stay out of a (possibly synced) NoteBase folder."""
import hashlib
import os
import sys
from pathlib import Path

# Files that older versions kept inside `.system`; they are rebuilt locally on open.
RETIRED_SYSTEM_FILES = ('index.db', 'index.db-wal', 'index.db-shm', 'graph-index.json', 'graph-state.json', 'projection-dirty.json', 'task_status_links.json')


def user_data_path() -> Path:
    return Path(os.environ.get('NICKNOTES_USER_DATA') or Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'NickNotes')


def notebase_data_path(vault_path: Path) -> Path:
    """One folder per NoteBase location; a moved or copied NoteBase rebuilds its projections."""
    resolved = str(Path(vault_path).resolve())
    if sys.platform == 'win32':
        resolved = resolved.lower()
    digest = hashlib.sha256(resolved.encode('utf-8')).hexdigest()[:16]
    name = ''.join(char for char in Path(vault_path).name if char.isalnum() or char in '-_')[:40] or 'notebase'
    return user_data_path() / 'notebases' / f'{name}-{digest}'

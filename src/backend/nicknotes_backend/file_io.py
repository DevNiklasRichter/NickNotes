"""Crash-resistant single-file writes shared by source and projection writers."""
import os
from pathlib import Path
import tempfile
import time


def atomic_write_text(path: Path, text: str, encoding: str = 'utf-8') -> int:
    atomic_write_bytes(path, text.encode(encoding))
    return len(text)


def atomic_write_bytes(path: Path, payload: bytes) -> int:
    path = Path(path)
    from .source_journal import active_journal
    journal = active_journal.get()
    if journal:
        journal.record(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        for attempt in range(6):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.04 * (attempt + 1))
    finally:
        Path(temporary).unlink(missing_ok=True)
    return len(payload)

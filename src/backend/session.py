from __future__ import annotations
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
import sys
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from .nicknotes_backend.vault import VaultManager
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.graph_watcher import graph_watcher_loop
from .errors import ConflictDomainError
from .nicknotes_backend.markdown_io import snapshot_operation
from .nicknotes_backend.source_journal import SourceJournal, active_journal, pending_recovery

expected_session: ContextVar[str | None] = ContextVar("nicknotes_expected_session", default=None)

def coordinated(function=None, *, mutation: bool = False, invalidate: bool = True, lifecycle: bool = False):
    """Coordinate transport-independent operations; writes declare their effects explicitly."""
    if function is None:
        return lambda target: coordinated(target, mutation=mutation, invalidate=invalidate, lifecycle=lifecycle)
    @wraps(function)
    @snapshot_operation
    def invoke(self, *args, **kwargs):
        with self.state.operation_lock:
            expected = expected_session.get()
            if expected and expected != self.state.generation:
                raise ConflictDomainError("Die geöffnete NoteBase hat sich geändert. Bitte erneut laden.")
            vault = self.state.vault
            dirty = vault.projection_dirty_path if vault else None
            if vault and dirty.exists() and not self.state.repairing and function.__name__ not in {'get_state','counts','require_loaded'} and not pending_recovery(vault):
                self.state.repairing = True
                try:
                    self.state.indexer.reindex_vault(vault.vault_path)
                    self.rebuild_graph_projection(vault)
                    dirty.unlink(missing_ok=True)
                finally:
                    self.state.repairing = False
            if vault and mutation and not lifecycle:
                vault.validate_roots()
                if active_journal.get() is not None:
                    return function(self, *args, **kwargs)
                if pending_recovery(vault):
                    raise ConflictDomainError("Eine unterbrochene Änderung muss zuerst in den Einstellungen geprüft werden.")
                with SourceJournal(vault, function.__name__) as journal:
                    result = function(self, *args, **kwargs)
                # View preferences do not invalidate Markdown, search or open drafts.
                if invalidate:
                    self.state.record_change(function.__name__, list(journal.before))
                return result
            return function(self, *args, **kwargs)
    return invoke

@dataclass
class GraphRuntimeStatus:
    is_updating: bool = False
    last_error: str | None = None
    watcher_enabled: bool = False
    last_external_update: str | None = None


@dataclass
class ProgressStatus:
    active: bool = False
    done: bool = False
    error: str | None = None
    error_code: str | None = None
    error_details: dict[str, Any] | None = None
    phase: str = ""
    processed: int = 0
    total: int = 0
    current_path: str | None = None
    result: dict[str, Any] | None = None
    started_at: float = 0.0
    finished_at: float | None = None


_PROGRESS_FIELDS = {"phase", "processed", "total", "current_path", "error", "error_code", "error_details", "result"}


class ProgressTracker:
    """Thread-safe progress of one background operation (NoteBase open, import)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status = ProgressStatus()

    def reset(self, phase: str) -> None:
        with self.lock:
            self.status = ProgressStatus(active=True, phase=phase, started_at=time.time())

    def clear(self) -> None:
        with self.lock:
            self.status = ProgressStatus()

    def update(self, *, done: bool | None = None, **changes: Any) -> None:
        """Apply the given fields; ``None`` leaves a field unchanged."""
        unknown = set(changes) - _PROGRESS_FIELDS
        if unknown:
            raise TypeError(f"Unknown progress field: {sorted(unknown)}")
        with self.lock:
            for name, value in changes.items():
                if value is not None:
                    setattr(self.status, name, value)
            if done is not None:
                self.status.done = done
                self.status.active = not done
                if done:
                    self.status.finished_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            status = self.status
            return {
                "active": status.active,
                "done": status.done,
                "error": status.error,
                "errorCode": status.error_code,
                "errorDetails": status.error_details,
                "phase": status.phase,
                "processed": status.processed,
                "total": status.total,
                "currentPath": status.current_path,
                "result": status.result,
                "startedAt": status.started_at,
                "finishedAt": status.finished_at,
            }


@dataclass
class VaultSession:
    vault: VaultManager | None = None
    indexer: VaultIndexer | None = None
    parser: CaptureParser = field(default_factory=CaptureParser)
    projection_lock: threading.RLock = field(default_factory=threading.RLock)
    graph_status: GraphRuntimeStatus = field(default_factory=GraphRuntimeStatus)
    watcher_stop: threading.Event | None = None
    watcher_thread: threading.Thread | None = None
    load: ProgressTracker = field(default_factory=ProgressTracker)
    imports: ProgressTracker = field(default_factory=ProgressTracker)

    def dispose(self) -> None:
        # The load tracker survives: opening a NoteBase disposes the previous session itself.
        self.stop_graph_watcher()
        if self.indexer:
            self.indexer.close()
            self.indexer = None
        self.vault = None
        self.imports.clear()
        self.graph_status = GraphRuntimeStatus()

    def start_graph_watcher(self, runtime: "RuntimeState", baseline=None) -> None:
        if not self.vault or not self.indexer or self.watcher_thread:
            return
        stop_event = threading.Event()
        self.watcher_stop = stop_event
        self.graph_status.watcher_enabled = True
        self.watcher_thread = threading.Thread(
            target=graph_watcher_loop,
            args=(runtime, self.vault, self.indexer, stop_event, baseline),
            name="nicknotes-graph-watcher",
            daemon=True,
        )
        self.watcher_thread.start()

    def stop_graph_watcher(self) -> None:
        if self.watcher_stop:
            self.watcher_stop.set()
        if self.watcher_thread and self.watcher_thread.is_alive():
            self.watcher_thread.join(timeout=2)
        self.watcher_stop = None
        self.watcher_thread = None
        self.graph_status.watcher_enabled = False


@dataclass
class RuntimeState:
    """One backend process owns one session; operations serialize on ``operation_lock``."""

    _session: VaultSession = field(default_factory=VaultSession)
    session_lock: threading.Lock = field(default_factory=threading.Lock)
    operation_lock: threading.RLock = field(default_factory=threading.RLock)
    generation: str = field(default_factory=lambda: uuid.uuid4().hex)
    repairing: bool = False
    change_version: int = 0
    handled_files: dict[Path, tuple[int, int] | None] = field(default_factory=dict)
    client_seen: float = field(default_factory=time.monotonic)  # last /state poll; paces the watcher
    last_change: dict[str, Any] = field(default_factory=dict)

    def record_change(self, operation: str, paths: list[Path]) -> None:
        self.change_version += 1
        self.last_change = {'version': self.change_version, 'operation': operation, 'paths': [str(path) for path in paths[:1000]], 'truncated': len(paths) > 1000}
        for path in paths:
            try:
                stat = path.stat()
                self.handled_files[path.resolve()] = (stat.st_mtime_ns, stat.st_size)
            except OSError:
                self.handled_files[path.resolve()] = None
        while len(self.handled_files) > 2048:
            self.handled_files.pop(next(iter(self.handled_files)))

    @property
    def vault(self) -> VaultManager | None:
        return self._session.vault

    @property
    def indexer(self) -> VaultIndexer | None:
        return self._session.indexer

    @property
    def parser(self) -> CaptureParser:
        return self._session.parser

    @property
    def graph_status(self) -> GraphRuntimeStatus:
        return self._session.graph_status

    @property
    def projection_lock(self) -> threading.RLock:
        return self._session.projection_lock

    @property
    def load(self) -> ProgressTracker:
        return self._session.load

    @property
    def imports(self) -> ProgressTracker:
        return self._session.imports

    def start_session(self, *, vault: VaultManager | None, indexer: VaultIndexer | None) -> None:
        with self.operation_lock, self.session_lock:
            self._session.dispose()
            self.generation = uuid.uuid4().hex
            self.handled_files.clear()
            self._session.vault = vault
            self._session.indexer = indexer

    def dispose_session(self) -> None:
        with self.operation_lock, self.session_lock:
            self._session.dispose()
            self.generation = uuid.uuid4().hex
            self.handled_files.clear()

    def start_graph_watcher(self, baseline=None) -> None:
        with self.operation_lock, self.session_lock:
            self._session.start_graph_watcher(self, baseline)

    def stop_graph_watcher(self) -> None:
        with self.operation_lock, self.session_lock:
            self._session.stop_graph_watcher()


# Runtime of the current call when it is not the NoteBase shown in the app (MCP).
bound_runtime: ContextVar[RuntimeState | None] = ContextVar("nicknotes_bound_runtime", default=None)


class SessionRegistry:
    """NoteBases opened for agents next to the one the app shows; idle ones close themselves."""

    IDLE_SECONDS = 600

    def __init__(self, service) -> None:
        self.service = service
        self.lock = threading.Lock()
        self.extra: dict[Path, list] = {}  # resolved path -> [runtime, last use]
        self.reaper: threading.Thread | None = None

    @staticmethod
    def _key(path: Path) -> Path:
        return Path(str(path.resolve()).lower()) if sys.platform == "win32" else path.resolve()

    @contextmanager
    def bind(self, path: Path):
        app = self.service._runtime
        key = self._key(path)
        if app.vault and self._key(app.vault.vault_path) == key:
            yield app
            return
        with self.lock:
            entry = self.extra.get(key)
            if entry is None:
                runtime = RuntimeState()
                token = bound_runtime.set(runtime)
                try:
                    self.service.open_vault(SimpleNamespace(path=str(path)))
                except Exception:
                    runtime.dispose_session()
                    raise
                finally:
                    bound_runtime.reset(token)
                entry = self.extra[key] = [runtime, 0.0]
                self._start_reaper()
            entry[1] = time.monotonic()
        token = bound_runtime.set(entry[0])
        try:
            yield entry[0]
        finally:
            entry[1] = time.monotonic()
            bound_runtime.reset(token)

    def release(self, path: Path) -> None:
        """The app is about to open this NoteBase itself; one session per NoteBase."""
        with self.lock:
            entry = self.extra.pop(self._key(path), None)
        if entry:
            entry[0].dispose_session()

    def close_idle(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self.lock:
            idle = [key for key, (_, used) in self.extra.items() if now - used > self.IDLE_SECONDS]
            entries = [self.extra.pop(key) for key in idle]
        for runtime, _ in entries:
            runtime.dispose_session()

    def _start_reaper(self) -> None:
        if self.reaper and self.reaper.is_alive():
            return
        def reap() -> None:
            while True:
                time.sleep(60)
                self.close_idle()
        self.reaper = threading.Thread(target=reap, name="nicknotes-session-reaper", daemon=True)
        self.reaper.start()

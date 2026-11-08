from __future__ import annotations
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
import threading
import time
import uuid
from typing import Any
from .nicknotes_backend.vault import VaultManager
from .nicknotes_backend.indexer import VaultIndexer
from .nicknotes_backend.parser import CaptureParser
from .nicknotes_backend.graph_watcher import graph_watcher_loop
from .errors import ConflictDomainError
from .nicknotes_backend.markdown_io import snapshot_operation
from .nicknotes_backend.source_journal import SourceJournal, active_journal, pending_recovery

expected_session: ContextVar[str | None] = ContextVar("nicknotes_expected_session", default=None)

def coordinated(function):
    @wraps(function)
    @snapshot_operation
    def invoke(self, *args, **kwargs):
        with self.state.operation_lock:
            expected = expected_session.get()
            if expected and expected != self.state.generation:
                raise ConflictDomainError("Die geoeffnete NoteBase hat sich geaendert. Bitte erneut laden.")
            vault = self.state.vault
            dirty = vault.system_path/'projection-dirty.json' if vault else None
            if vault and dirty.exists() and not self.state.repairing and function.__name__ not in {'get_state','counts','require_loaded'} and not pending_recovery(vault):
                self.state.repairing = True
                try:
                    self.state.indexer.reindex_vault(vault.vault_path)
                    self.rebuild_graph_projection(vault)
                    dirty.unlink(missing_ok=True)
                finally:
                    self.state.repairing = False
            mutating = function.__name__.startswith(('save_', 'add_', 'rename_', 'move_', 'delete_', 'apply_', 'toggle_', 'promote_', 'mark_', 'quick_')) or function.__name__ == 'open_or_create_daily'
            lifecycle = function.__name__ in {'rename_notebase', 'delete_notebase'}
            mutating = mutating or function.__name__ in {'update_ui_settings', 'update_graph_state', 'save_focus_mit', 'start_onenote_import', 'reindex_vault'}
            if vault and mutating and not lifecycle:
                vault.validate_roots()
                if active_journal.get() is not None:
                    return function(self, *args, **kwargs)
                if pending_recovery(vault):
                    raise ConflictDomainError("Eine unterbrochene Aenderung muss zuerst in den Einstellungen geprueft werden.")
                with SourceJournal(vault, function.__name__) as journal:
                    result = function(self, *args, **kwargs)
                # View preferences do not invalidate Markdown, search or open drafts.
                if function.__name__ not in {'update_ui_settings', 'update_graph_state', 'favorite_note_group', 'unfavorite_note_group'}:
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
class NoteBaseLoadStatus:
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


@dataclass
class VaultSession:
    vault: VaultManager | None = None
    indexer: VaultIndexer | None = None
    parser: CaptureParser = field(default_factory=CaptureParser)
    projection_lock: threading.RLock = field(default_factory=threading.RLock)
    graph_status: GraphRuntimeStatus = field(default_factory=GraphRuntimeStatus)
    watcher_stop: threading.Event | None = None
    watcher_thread: threading.Thread | None = None
    load_status: NoteBaseLoadStatus = field(default_factory=NoteBaseLoadStatus)
    load_lock: threading.Lock = field(default_factory=threading.Lock)
    import_status: NoteBaseLoadStatus = field(default_factory=NoteBaseLoadStatus)
    import_lock: threading.Lock = field(default_factory=threading.Lock)

    def dispose(self) -> None:
        self.stop_graph_watcher()
        if self.indexer:
            self.indexer.close()
            self.indexer = None
        self.vault = None
        with self.import_lock:
            self.import_status = NoteBaseLoadStatus()
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

    def reset_load_status(self, phase: str) -> None:
        with self.load_lock:
            self.load_status = NoteBaseLoadStatus(active=True, phase=phase, started_at=time.time())

    def update_load_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        with self.load_lock:
            status = self.load_status
            if phase is not None:
                status.phase = phase
            if processed is not None:
                status.processed = processed
            if total is not None:
                status.total = total
            if current_path is not None:
                status.current_path = current_path
            if error is not None:
                status.error = error
            if error_code is not None:
                status.error_code = error_code
            if error_details is not None:
                status.error_details = error_details
            if result is not None:
                status.result = result
            if done is not None:
                status.done = done
                status.active = not done
                if done:
                    status.finished_at = time.time()

    def get_load_status(self) -> dict[str, Any]:
        with self.load_lock:
            status = self.load_status
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

    def reset_import_status(self, phase: str) -> None:
        with self.import_lock:
            self.import_status = NoteBaseLoadStatus(active=True, phase=phase, started_at=time.time())

    def update_import_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        with self.import_lock:
            status = self.import_status
            if phase is not None:
                status.phase = phase
            if processed is not None:
                status.processed = processed
            if total is not None:
                status.total = total
            if current_path is not None:
                status.current_path = current_path
            if error is not None:
                status.error = error
            if error_code is not None:
                status.error_code = error_code
            if error_details is not None:
                status.error_details = error_details
            if result is not None:
                status.result = result
            if done is not None:
                status.done = done
                status.active = not done
                if done:
                    status.finished_at = time.time()

    def get_import_status(self) -> dict[str, Any]:
        with self.import_lock:
            status = self.import_status
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
class RuntimeState:
    _session: VaultSession = field(default_factory=VaultSession)
    session_lock: threading.Lock = field(default_factory=threading.Lock)
    operation_lock: threading.RLock = field(default_factory=threading.RLock)
    generation: str = field(default_factory=lambda: uuid.uuid4().hex)
    repairing: bool = False
    change_version: int = 0
    handled_files: dict[Path, tuple[int, int] | None] = field(default_factory=dict)
    last_change: dict[str, Any] = field(default_factory=dict)

    def record_change(self, operation: str, paths: list[Path]):
        self.change_version += 1
        self.last_change = {'version':self.change_version, 'operation':operation, 'paths':[str(path) for path in paths[:1000]], 'truncated':len(paths)>1000}
        for path in paths:
            try:
                stat = path.stat()
                self.handled_files[path.resolve()] = (stat.st_mtime_ns, stat.st_size)
            except OSError:
                self.handled_files[path.resolve()] = None
        while len(self.handled_files)>2048:
            self.handled_files.pop(next(iter(self.handled_files)))


    @property
    def vault(self) -> VaultManager | None:
        return self._session.vault

    @vault.setter
    def vault(self, value: VaultManager | None) -> None:
        self._session.vault = value

    @property
    def indexer(self) -> VaultIndexer | None:
        return self._session.indexer

    @indexer.setter
    def indexer(self, value: VaultIndexer | None) -> None:
        self._session.indexer = value

    @property
    def parser(self) -> CaptureParser:
        return self._session.parser

    @parser.setter
    def parser(self, value: CaptureParser) -> None:
        self._session.parser = value



    @property
    def graph_status(self) -> GraphRuntimeStatus:
        return self._session.graph_status

    @graph_status.setter
    def graph_status(self, value: GraphRuntimeStatus) -> None:
        self._session.graph_status = value

    @property
    def projection_lock(self) -> threading.RLock:
        return self._session.projection_lock

    @property
    def watcher_stop(self) -> threading.Event | None:
        return self._session.watcher_stop

    @watcher_stop.setter
    def watcher_stop(self, value: threading.Event | None) -> None:
        self._session.watcher_stop = value

    @property
    def watcher_thread(self) -> threading.Thread | None:
        return self._session.watcher_thread

    @watcher_thread.setter
    def watcher_thread(self, value: threading.Thread | None) -> None:
        self._session.watcher_thread = value

    @property
    def load_status(self) -> NoteBaseLoadStatus:
        return self._session.load_status

    @load_status.setter
    def load_status(self, value: NoteBaseLoadStatus) -> None:
        self._session.load_status = value

    @property
    def load_lock(self) -> threading.Lock:
        return self._session.load_lock

    @property
    def import_status(self) -> NoteBaseLoadStatus:
        return self._session.import_status

    @import_status.setter
    def import_status(self, value: NoteBaseLoadStatus) -> None:
        self._session.import_status = value

    @property
    def import_lock(self) -> threading.Lock:
        return self._session.import_lock

    @property
    def session(self) -> VaultSession:
        return self._session

    def start_session(
        self,
        *,
        vault: VaultManager | None,
        indexer: VaultIndexer | None,
        parser: CaptureParser | None = None,
    ) -> None:
        with self.operation_lock, self.session_lock:
            self._session.dispose()
            self.generation = uuid.uuid4().hex
            self.handled_files.clear()
            self._session.vault = vault
            self._session.indexer = indexer
            if parser is not None:
                self._session.parser = parser

    def stop_session(self) -> None:
        with self.operation_lock, self.session_lock:
            self._session.stop_graph_watcher()
            if self._session.indexer:
                self._session.indexer.close()

    def dispose_session(self) -> None:
        with self.operation_lock, self.session_lock:
            self._session.dispose()
            self.generation = uuid.uuid4().hex
            self.handled_files.clear()

    def close(self) -> None:
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

    def reset_load_status(self, phase: str) -> None:
        self._session.reset_load_status(phase)

    def update_load_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._session.update_load_status(
            phase=phase,
            processed=processed,
            total=total,
            current_path=current_path,
            done=done,
            error=error,
            error_code=error_code,
            error_details=error_details,
            result=result,
        )

    def get_load_status(self) -> dict[str, Any]:
        return self._session.get_load_status()

    def reset_import_status(self, phase: str) -> None:
        self._session.reset_import_status(phase)

    def update_import_status(
        self,
        *,
        phase: str | None = None,
        processed: int | None = None,
        total: int | None = None,
        current_path: str | None = None,
        done: bool | None = None,
        error: str | None = None,
        error_code: str | None = None,
        error_details: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._session.update_import_status(
            phase=phase,
            processed=processed,
            total=total,
            current_path=current_path,
            done=done,
            error=error,
            error_code=error_code,
            error_details=error_details,
            result=result,
        )

    def get_import_status(self) -> dict[str, Any]:
        return self._session.get_import_status()

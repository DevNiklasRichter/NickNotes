from __future__ import annotations

from pathlib import Path
import logging
import time
from datetime import datetime


def graph_watcher_loop(runtime, vault, indexer, stop_event, baseline=None):
    from ..application_services import BackendApiService
    service = BackendApiService(runtime=runtime)
    snapshot = baseline if baseline is not None else graph_watcher_snapshot(vault.vault_path)
    pending = {}
    # Scan every two seconds while a client is polling, every ten once it has gone quiet (hidden window).
    while not stop_event.wait(2 if time.monotonic() - runtime.client_seen < 30 else 10):
        try:
            current = graph_watcher_snapshot(vault.vault_path)
            # A directory listing can lag behind the file; confirm each apparent change on the file itself.
            for path in [path for path in set(current) | set(snapshot) if current.get(path) != snapshot.get(path)]:
                try:
                    stat = path.stat()
                    current[path] = (stat.st_mtime_ns, stat.st_size)
                except OSError:
                    current.pop(path, None)
            now = time.monotonic()
            for path in set(current) | set(snapshot):
                if current.get(path) != snapshot.get(path):
                    absent = object()
                    handled = runtime.handled_files.pop(path, absent)
                    if handled is not absent and handled == current.get(path):
                        pending.pop(path, None)
                    else:
                        pending[path] = now
            ready = [p for p, seen in pending.items() if now - seen >= 1.2]
            snapshot = current
            if not ready or not runtime.operation_lock.acquire(timeout=0.2):
                continue
            try:
                if stop_event.is_set() or runtime.vault is not vault:
                    return
                from .markdown_io import document_snapshots, parse_markdown
                from .graph_storage import read_graph_index, write_graph_index
                from .graph_index import update_graph_index_for_file
                real=[]
                with document_snapshots():
                    with indexer.batch():
                        for path in ready:
                            if path.name == 'tag_groups.json':
                                real.append(path)
                                continue
                            if path.exists() and str(parse_markdown(path)[0].get('type','')) in {'task_link','tag_index'}:
                                continue
                            indexer.reindex_markdown_file(vault.vault_path,path)
                            real.append(path)
                    if not real:
                        for path in ready:
                            pending.pop(path,None)
                        continue
                    vault.rebuild_task_status_links(indexer)
                    vault.sync_tag_groups_with_index(indexer)
                    if len(real)<=8 and not any(path.name=='tag_groups.json' for path in real):
                        stored=graph=read_graph_index(vault.graph_index_path)
                        if service.graph_index_needs_rebuild(graph):
                            service.rebuild_graph_projection(vault)
                        else:
                            for path in real:
                                graph=update_graph_index_for_file(vault_path=vault.vault_path,tag_groups=vault.read_tag_groups(),index=graph,file_path=path)
                            if graph is not stored:write_graph_index(vault.graph_index_path,graph)
                    else:
                        service.rebuild_graph_projection(vault)
                runtime.record_change('external-files', real)
                for path in ready:
                    pending.pop(path,None)
                runtime.graph_status.last_error = None
                runtime.graph_status.last_external_update = datetime.now().astimezone().isoformat(timespec='seconds')
            finally:
                runtime.operation_lock.release()
        except Exception:
            runtime.graph_status.last_error = 'Eine externe Änderung konnte nicht indexiert werden. Bitte Markdown und Dateizugriff prüfen.'
            for path in pending:
                pending[path] = time.monotonic()+10
            logging.getLogger(__name__).exception('External change projection failed')


def graph_watcher_snapshot(vault_path: Path) -> dict[Path, tuple[int, int]]:
    root = vault_path.resolve()
    from .inventory import source_stats
    snapshot = source_stats(root)
    try:
        stat = (root / '.system' / 'tag_groups.json').stat()
        snapshot[root / '.system' / 'tag_groups.json'] = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        pass
    return snapshot

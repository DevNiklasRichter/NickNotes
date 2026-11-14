from __future__ import annotations

import json
from .file_io import atomic_write_text
from datetime import datetime
from pathlib import Path
from typing import Any

from .graph_index import GRAPH_INDEX_VERSION, GraphDiagnostic, GraphIndex, graph_index_from_dict
from .projection_registry import GRAPH_STATE_SCHEMA_VERSION, quarantine_projection_file


GRAPH_STATE_VERSION = GRAPH_STATE_SCHEMA_VERSION


# The parsed projection of the open NoteBase, valid while the file on disk is the one it came from.
_cached: tuple[Path, tuple[int, int], GraphIndex] | None = None


def _signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size


def read_graph_index(path: Path) -> GraphIndex:
    global _cached
    if not path.exists():
        return GraphIndex.empty()
    try:
        signature = _signature(path)
        if _cached and _cached[0] == path and _cached[1] == signature:
            return _cached[2]
        index = graph_index_from_dict(json.loads(path.read_text(encoding="utf-8")))
        _cached = (path, signature, index)
        return index
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        quarantine_projection_file(path, projection="graph-index")
        return GraphIndex.empty(
            GraphDiagnostic(
                type="graphIndexReadFailed",
                severity="warning",
                message=f"Graph index could not be read and should be rebuilt: {exc}",
            )
        )


def write_graph_index(path: Path, index: GraphIndex) -> None:
    global _cached
    _cached = None
    atomic_write_text(path, json.dumps(index.to_dict(), ensure_ascii=False, separators=(',', ':')))
    _cached = (path, _signature(path), index)


def default_graph_state() -> dict[str, Any]:
    return {
        "version": GRAPH_STATE_VERSION,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "activeMode": "focus",  # neighbourhood of the open note
        "filters": {},
        "layout": {},
        "viewport": {"zoom": 1, "pan": {"x": 0, "y": 0}},
        "positions": {},
    }


def read_graph_state(path: Path) -> dict[str, Any]:
    default = default_graph_state()
    if not path.exists():
        return default
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        quarantine_projection_file(path, projection="graph-state")
        return default
    if not isinstance(payload, dict):
        quarantine_projection_file(path, projection="graph-state")
        return default
    try:
        version = int(payload.get("version", 0) or 0)
    except (TypeError, ValueError):
        version = 0
    if version < 1 or version > GRAPH_STATE_VERSION:
        quarantine_projection_file(path, projection="graph-state")
        return default
    merged = {**default, **payload}
    merged["version"] = GRAPH_STATE_VERSION
    merged["filters"] = payload.get("filters") if isinstance(payload.get("filters"), dict) else default["filters"]
    merged["layout"] = payload.get("layout") if isinstance(payload.get("layout"), dict) else default["layout"]
    merged["viewport"] = payload.get("viewport") if isinstance(payload.get("viewport"), dict) else default["viewport"]
    merged["positions"] = payload.get("positions") if isinstance(payload.get("positions"), dict) else default["positions"]
    return merged


def write_graph_state(path: Path, state: dict[str, Any]) -> dict[str, Any]:
    payload = dict(state) if isinstance(state, dict) else {}
    payload["version"] = GRAPH_STATE_VERSION
    payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
    atomic_write_text(path, json.dumps(payload, indent=2, ensure_ascii=False))
    return payload

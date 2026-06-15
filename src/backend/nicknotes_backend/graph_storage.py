from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .graph_index import GRAPH_INDEX_VERSION, GraphDiagnostic, GraphIndex, graph_index_from_dict
from .projection_registry import GRAPH_STATE_SCHEMA_VERSION, quarantine_projection_file


GRAPH_STATE_VERSION = GRAPH_STATE_SCHEMA_VERSION


def read_graph_index(path: Path) -> GraphIndex:
    if not path.exists():
        return GraphIndex.empty()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return graph_index_from_dict(payload)
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
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(json.dumps(index.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        temp_path.replace(path)
    except PermissionError:
        path.write_text(temp_path.read_text(encoding="utf-8"), encoding="utf-8")
        try:
            temp_path.unlink(missing_ok=True)
        except PermissionError:
            pass


def default_graph_state() -> dict[str, Any]:
    return {
        "version": GRAPH_STATE_VERSION,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "activeMode": "link",
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
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        temp_path.replace(path)
    except PermissionError:
        path.write_text(temp_path.read_text(encoding="utf-8"), encoding="utf-8")
        try:
            temp_path.unlink(missing_ok=True)
        except PermissionError:
            pass
    return payload

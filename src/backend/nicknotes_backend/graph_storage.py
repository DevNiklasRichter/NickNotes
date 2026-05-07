from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .graph_index import GRAPH_INDEX_VERSION, GraphDiagnostic, GraphIndex, graph_index_from_dict


GRAPH_STATE_VERSION = 1


def read_graph_index(path: Path) -> GraphIndex:
    if not path.exists():
        return GraphIndex.empty()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return graph_index_from_dict(payload)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
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
    if not path.exists():
        return default_graph_state()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_graph_state()
    if not isinstance(payload, dict):
        return default_graph_state()
    try:
        version = int(payload.get("version", 0) or 0)
    except (TypeError, ValueError):
        version = 0
    if version != GRAPH_STATE_VERSION:
        return default_graph_state()
    return payload


def write_graph_state(path: Path, state: dict[str, Any]) -> dict[str, Any]:
    payload = dict(state) if isinstance(state, dict) else {}
    payload["version"] = GRAPH_STATE_VERSION
    payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload

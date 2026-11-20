from __future__ import annotations

from datetime import datetime
from pathlib import Path

INDEXER_SCHEMA_VERSION = 5
GRAPH_INDEX_SCHEMA_VERSION = 2
TASK_LINK_INDEX_SCHEMA_VERSION = 1
GRAPH_STATE_SCHEMA_VERSION = 2


def _safe_projection_tag(value: str) -> str:
    lowered = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in value.lower())
    while "--" in lowered:
        lowered = lowered.replace("--", "-")
    return lowered.strip("-")


def quarantine_projection_file(path: Path, *, projection: str) -> Path | None:
    if not path.exists():
        return None

    suffix = _safe_projection_tag(projection)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = path.with_name(f"{path.name}.{suffix}.corrupt.{timestamp}.bak")
    try:
        path.rename(target)
        return target
    except OSError:
        return None

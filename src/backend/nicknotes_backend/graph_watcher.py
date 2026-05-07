from __future__ import annotations

from pathlib import Path


def graph_watcher_snapshot(vault_path: Path) -> dict[Path, tuple[int, int]]:
    root = vault_path.resolve()
    snapshot: dict[Path, tuple[int, int]] = {}
    for path in root.rglob("*.md"):
        if not path.is_file():
            continue
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            continue
        top = relative.split("/", 1)[0].lower()
        if top in {".system", "system", "99_system", ".media"}:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        snapshot[path.resolve()] = (stat.st_mtime_ns, stat.st_size)
    return snapshot

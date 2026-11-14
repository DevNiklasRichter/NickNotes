"""Pruned, vault-bound Markdown inventory shared by every projection."""
import os
from pathlib import Path
EXCLUDED = {'.system','.media','tags'}

def is_source(root: Path, path: Path) -> bool:
    root, path = root.resolve(), path.resolve()
    if not path.is_relative_to(root) or path.suffix.lower() != '.md':
        return False
    return not any(part.startswith('.') or part.lower() in EXCLUDED for part in path.relative_to(root).parts)

def _scan(root: Path):
    """Yield the directory entry of every source file below an already resolved root."""
    pending = [str(root)]
    while pending:
        folder = pending.pop()
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.name.startswith('.') or entry.name.lower() in EXCLUDED or entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if Path(entry.path).resolve().is_relative_to(root):
                        pending.append(entry.path)
                elif entry.name.lower().endswith('.md') and entry.is_file(follow_symlinks=False):
                    yield entry

def markdown_sources(root: Path) -> list[Path]:
    root = root.resolve()
    prefix = len(str(root)) + 1
    return [Path(entry.path) for entry in sorted(_scan(root), key=lambda entry: entry.path[prefix:].replace(os.sep, '/').lower())]

def source_stats(root: Path) -> dict[Path, tuple[int, int]]:
    """Modification time and size per source, taken from the directory listing without opening files."""
    stats = {}
    for entry in _scan(root.resolve()):
        try:
            stat = entry.stat(follow_symlinks=False)
        except OSError:
            continue
        stats[Path(entry.path)] = (stat.st_mtime_ns, stat.st_size)
    return stats

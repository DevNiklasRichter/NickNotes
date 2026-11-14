"""Pruned, vault-bound Markdown inventory shared by every projection."""
import os
from pathlib import Path
EXCLUDED = {'.system','.media','tags'}

def is_source(root: Path, path: Path) -> bool:
    root, path = root.resolve(), path.resolve()
    if not path.is_relative_to(root) or path.suffix.lower() != '.md':
        return False
    return not any(part.startswith('.') or part.lower() in EXCLUDED for part in path.relative_to(root).parts)

def markdown_sources(root: Path) -> list[Path]:
    root = root.resolve()
    sources, pending = [], [root]
    while pending:
        folder = pending.pop()
        with os.scandir(folder) as entries:
            for entry in entries:
                if entry.name.startswith('.') or entry.name.lower() in EXCLUDED or entry.is_symlink():
                    continue
                path = Path(entry.path)
                if entry.is_dir(follow_symlinks=False):
                    if path.resolve().is_relative_to(root):
                        pending.append(path)
                elif entry.name.lower().endswith('.md') and entry.is_file(follow_symlinks=False):
                    sources.append(path)
    return sorted(sources,key=lambda path:path.relative_to(root).as_posix().lower())

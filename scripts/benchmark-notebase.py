"""Times open, reopen, save and rename on a synthetic NoteBase; never opens a personal one.

Usage: python scripts/benchmark-notebase.py [--count 3000] [--profile open|reopen|first-save|save|rename]
"""
from pathlib import Path
import argparse
import cProfile
import json
import pstats
import shutil
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.backend.application_services import BackendApiService
from src.backend.commands import NoteFileRenameRequest, NoteSaveRequest, VaultCreateRequest, VaultOpenRequest

parser = argparse.ArgumentParser()
parser.add_argument('--count', type=int, default=3000)
parser.add_argument('--profile', choices=['open', 'reopen', 'first-save', 'save', 'rename'], default='')
parser.add_argument('--callees', default='')
args = parser.parse_args()

scratch = Path(__file__).resolve().parents[1] / '.tmp' / ('notebase-benchmark-' + uuid.uuid4().hex[:8])
scratch.mkdir(parents=True)
timings: dict[str, float] = {}


def timed(name, action):
    profiler = cProfile.Profile() if args.profile == name else None
    started = time.perf_counter()
    result = profiler.runcall(action) if profiler else action()
    timings[name] = round(time.perf_counter() - started, 3)
    if profiler:
        stats = pstats.Stats(profiler).sort_stats('cumulative'); stats.print_stats(45) if not args.callees else stats.print_callees(args.callees)
    return result


service = BackendApiService()
try:
    service.create_vault(VaultCreateRequest(parentPath=str(scratch), name='Benchmark'))
    root = service.state.vault.vault_path
    service.state.dispose_session()
    # Notes with frontmatter, tags in the body, wiki links, a to-do and some prose, spread over folders.
    (root / '.system' / 'tag_groups.json').write_text(json.dumps({'groups': [
        {'id': 'project', 'displayName': 'Projekt', 'tags': [{'id': f'p{n}', 'displayName': f'Projekt {n}'} for n in range(40)]}]}), encoding='utf-8')
    prose = 'Ein Absatz mit etwas Inhalt, der die übliche Länge einer Arbeitsnotiz abbildet. ' * 12
    for number in range(args.count):
        folder = root / f'Bereich-{number % 30:02}'
        folder.mkdir(exist_ok=True)
        links = ' '.join(f'[[Notiz-{(number + step) % args.count:05}]]' for step in (1, 7, 31))
        (folder / f'Notiz-{number:05}.md').write_text(
            f'# Notiz {number}\n\n{{tag:project/p{number % 40}}} {links}\n\n- [ ] Offener Punkt {number}\n\n{prose}\n', encoding='utf-8')

    request = VaultOpenRequest(path=str(root))
    timed('open', lambda: service.open_vault(request))
    service.state.dispose_session()
    timed('reopen', lambda: service.open_vault(request))

    import hashlib

    def save(path, suffix):
        target = Path(path)
        revision = hashlib.sha256(target.read_bytes()).hexdigest()
        return service.save_note_content(NoteSaveRequest(path=str(target), content=target.read_text(encoding='utf-8') + suffix, expectedRevision=revision))

    # The first save adds frontmatter and renames the file to its title; the second is the everyday case.
    first = timed('first-save', lambda: save(root / 'Bereich-00' / 'Notiz-00000.md', '\nErste Änderung.\n'))
    saved = timed('save', lambda: save(first['path'], '\nZweite Änderung.\n'))
    timed('rename', lambda: service.rename_note(NoteFileRenameRequest(path=saved['path'], newName='Umbenannt')))
    for name in ('index.db', 'graph-index.json'):
        timings[name + ' MB'] = round((root / '.system' / name).stat().st_size / 1e6, 2)
    print(json.dumps({'notes': args.count, **timings}))
finally:
    service.state.dispose_session()
    shutil.rmtree(scratch, ignore_errors=True)

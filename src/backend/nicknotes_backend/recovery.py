"""Explicit resolution of interrupted source operations with a fresh safety backup."""
import json
from pathlib import Path
import re
from .file_io import atomic_write_text, atomic_write_bytes
from .source_journal import SourceJournal, pending_recovery


def _entries(directory, payload):
    if payload.get('entriesFormat') == 'jsonl':
        path = directory/'entries.jsonl'
        if path.stat().st_size > 8*1024*1024:
            raise ValueError('Recovery journal is too large.')
        return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]
    return payload.get('entries',[])


def list_recovery(vault):
    result = []
    for relative in pending_recovery(vault):
        path = Path(relative)
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
            result.append({'id':path.parent.name,'operation':payload.get('operation','Unknown'),'paths':[entry.get('path','') for entry in _entries(path.parent,payload)],'manifest':relative})
        except (ValueError, OSError):
            result.append({'id':path.parent.name,'operation':'Unreadable recovery manifest','paths':[],'manifest':relative})
    return result


def resolve_recovery(vault, identity, action):
    if not re.fullmatch('[a-f0-9]{32}',identity) or action not in {'restore','keep'}:
        raise ValueError('Invalid recovery action.')
    directory = (vault.recovery_path/identity).resolve()
    if not directory.is_relative_to(vault.recovery_path.resolve()):
        raise ValueError('Recovery directory is outside the local journal.')
    manifest = directory/'manifest.json'
    payload = json.loads(manifest.read_text(encoding='utf-8'))
    if action == 'keep':
        payload['state']='kept'
        atomic_write_text(manifest,json.dumps(payload,indent=2))
        return {'resolved':True,'action':action,'paths':[]}
    entries = _entries(directory,payload)
    if not isinstance(entries,list) or len(entries)>10000:
        raise ValueError('Invalid recovery entries.')
    operations = []
    total = 0
    for entry in entries:
        relative=Path(entry['path'])
        target=(vault.vault_path/relative).resolve()
        if relative.is_absolute() or not target.is_relative_to(vault.vault_path.resolve()) or not relative.parts:
            raise ValueError('Invalid recovery source path.')
        if relative.parts[0].startswith('.') and relative.parts[0] != '.media' and target not in {vault.config_path.resolve(),vault.tag_groups_path.resolve()}:
            raise ValueError('Internal path is not a recoverable source.')
        backup=entry.get('backup')
        if backup is not None and not re.fullmatch(r'[0-9]+\.bak',backup):
            raise ValueError('Invalid recovery backup path.')
        source=(directory/backup).resolve() if backup else None
        if source and not source.is_relative_to(directory):
            raise ValueError('Invalid recovery backup target.')
        total += source.stat().st_size if source else 0
        if total>64*1024*1024:
            raise ValueError('Recovery sources exceed the safety limit.')
        operations.append((target,source.read_bytes() if source else None))
    if action == 'restore':
        with SourceJournal(vault,'manual-recovery') as journal:
            for target, content in operations:
                journal.record(target)
                if content is None:
                    target.unlink(missing_ok=True)
                else:
                    atomic_write_bytes(target,content)
    payload['state']='restored' if action=='restore' else 'kept'
    atomic_write_text(manifest,json.dumps(payload,indent=2))
    return {'resolved':True,'action':action,'paths':[str(target) for target,_ in operations]}

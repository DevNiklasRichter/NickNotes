"""Bounded one-way configuration migration; never guess between conflicting sources."""
from datetime import datetime, timezone
import json
import uuid
from .file_io import atomic_write_text


def validate_configuration(vault):
    if not vault.config_path.exists():
        return None
    raw = vault.config_path.read_text(encoding='utf-8')
    config = json.loads(raw)
    if not isinstance(config, dict):
        raise ValueError('NoteBase configuration must be an object.')
    if int(config.get('format_version', 0)) > 2:
        raise ValueError('This NoteBase requires a newer NickNotes version.')
    legacy = vault._normalize_tag_groups(config['tagGroups']) if 'tagGroups' in config else None
    current = None
    if vault.tag_groups_path.exists():
        payload = json.loads(vault.tag_groups_path.read_text(encoding='utf-8'))
        current = vault._normalize_tag_groups(payload.get('groups', payload.get('tagGroups', [])) if isinstance(payload, dict) else payload)
    if legacy is not None and current is not None and legacy != current:
        raise ValueError('Die Tagdefinitionen in config.json und tag_groups.json widersprechen sich. Beide Quellen wurden erhalten.')
    return raw, config, legacy


def migrate_configuration(vault):
    inspected=validate_configuration(vault)
    if inspected is None:
        return
    raw, config, legacy=inspected
    obsolete = {'tagGroups', 'assistant', 'openai', 'mode'}
    if config.get('format_version') == 2 and config.get('vault_id') and not obsolete.intersection(config):
        return
    backup = vault.system_path / 'migrations' / ('config-before-v2-' + uuid.uuid4().hex + '.json')
    atomic_write_text(backup, raw)
    if legacy is not None:
        atomic_write_text(vault.tag_groups_path, json.dumps({'version': 1, 'groups': legacy}, indent=2, ensure_ascii=False))
    clean = {key: value for key, value in config.items() if key not in obsolete}
    clean.update(format_version=2, vault_id=config.get('vault_id') or str(uuid.uuid4()))
    atomic_write_text(vault.config_path, json.dumps(clean, indent=2, ensure_ascii=False))
    atomic_write_text(backup.with_suffix('.manifest.json'), json.dumps({'completed_at': datetime.now(timezone.utc).isoformat(), 'format_version': 2}))

"""Collect Python runtime third-party notices from the isolated packaging environment."""
import importlib.metadata as metadata
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
parts=['NickNotes bundled Python runtime dependency notices\n']
for distribution in sorted(metadata.distributions(),key=lambda item:item.metadata['Name'].lower()):
    name=distribution.metadata['Name']
    if name.lower() in {'pip','setuptools','pyinstaller','pyinstaller-hooks-contrib','altgraph','pefile','pywin32-ctypes'}:
        continue
    parts.append(f'\n--- {name} {distribution.version} ---\n')
    parts.append(str(distribution.metadata.get('License-Expression') or distribution.metadata.get('License') or 'See upstream package license.'))
    for file in distribution.files or []:
        if file.name.lower().startswith(('license','copying','notice')):
            path=distribution.locate_file(file)
            if path.is_file() and path.stat().st_size<1024*1024:
                parts.append(path.read_text(encoding='utf-8',errors='replace'))
python_license=Path(sys.base_prefix)/'LICENSE.txt'
if python_license.exists():
    parts.extend(['\n--- Python runtime ---\n',python_license.read_text(encoding='utf-8',errors='replace')])
output=root/'dist'/'PYTHON_NOTICES.txt'
output.write_text('\n'.join(parts),encoding='utf-8')

import { spawnSync } from 'node:child_process'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const result = spawnSync(python, ['scripts/build-backend.py'], { cwd: root, stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)

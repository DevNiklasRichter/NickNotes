import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = fs.existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3'
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'src/backend/tests', '-v'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
})
process.exit(result.status ?? 1)

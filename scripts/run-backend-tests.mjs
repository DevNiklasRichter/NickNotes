import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = fs.existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3'
// Device-local projections and grants must never land in the real user profile.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nicknotes-tests-'))
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'src/backend/tests', '-v'], {
  cwd: root, stdio: 'inherit', windowsHide: true, env: {...process.env, NICKNOTES_USER_DATA: profile},
})
fs.rmSync(profile, {recursive: true, force: true})
process.exit(result.status ?? 1)

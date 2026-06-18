import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_PORT = 8765

let backendProcess = null
let mainWindow = null
let backendStopping = false
const unsavedByWebContentsId = new Map()
const pendingSaveBeforeCloseByWebContentsId = new Set()
const allowCloseByWebContentsId = new Set()
const EXTERNAL_URL_SCHEME_ALLOWLIST = new Set(['http:', 'https:', 'mailto:', 'file:'])

const NICKNOTES_ALLOWED_EXTERNAL_URL_ORIGINS = process.env.NICKNOTES_ALLOWED_EXTERNAL_URL_ORIGINS?.split(',')
  .map((value) => value.trim())
  .filter(Boolean) ?? []
const NICKNOTES_ALLOWED_EXTERNAL_URL_HOST_REGEX = process.env.NICKNOTES_ALLOWED_EXTERNAL_URL_HOST_REGEX?.trim() || ''

let externalUrlHostRegex = null
if (NICKNOTES_ALLOWED_EXTERNAL_URL_HOST_REGEX) {
  try {
    externalUrlHostRegex = new RegExp(NICKNOTES_ALLOWED_EXTERNAL_URL_HOST_REGEX, 'i')
  } catch (error) {
    console.warn('[nicknotes-security] Invalid NICKNOTES_ALLOWED_EXTERNAL_URL_HOST_REGEX value, disabled regex rule', error)
    externalUrlHostRegex = null
  }
}

function isHostAllowed(rawUrl) {
  if (!rawUrl || !rawUrl.hostname) {
    return false
  }
  if (NICKNOTES_ALLOWED_EXTERNAL_URL_ORIGINS.length === 0 && externalUrlHostRegex === null) {
    return true
  }
  const hostname = rawUrl.hostname.toLowerCase()
  const exact = NICKNOTES_ALLOWED_EXTERNAL_URL_ORIGINS.some((value) => {
    const lowered = value.toLowerCase()
    if (lowered === '*') {
      return true
    }
    if (lowered.startsWith('*.')) {
      return hostname === lowered.slice(2) || hostname.endsWith(`.${lowered.slice(2)}`)
    }
    return hostname === lowered
  })
  if (exact) {
    return true
  }
  if (externalUrlHostRegex && externalUrlHostRegex.test(hostname)) {
    return true
  }
  return false
}

function validateLocalDirectoryPath(rawPath) {
  const cleanPath = String(rawPath || '').trim()
  if (!cleanPath) {
    return { allowed: false, code: 'empty_path', message: 'Pfad fehlt.' }
  }
  if (!path.isAbsolute(cleanPath)) {
    return { allowed: false, code: 'relative_path', message: 'Nur absolute Pfade koennen geoeffnet werden.' }
  }
  try {
    const resolvedPath = path.resolve(cleanPath)
    const stats = fs.statSync(resolvedPath)
    if (!stats.isDirectory()) {
      return { allowed: false, code: 'not_directory', message: 'Der Pfad ist kein Ordner.' }
    }
    return { allowed: true, path: resolvedPath }
  } catch {
    return { allowed: false, code: 'path_not_found', message: 'Ordner wurde nicht gefunden.' }
  }
}

function validateExternalUrl(rawUrl) {
  const cleanUrl = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!cleanUrl) {
    return { allowed: false, code: 'invalid_url', message: 'URL ist leer.' }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(cleanUrl)
  } catch {
    return { allowed: false, code: 'invalid_url', message: 'URL-Format ist ungültig.' }
  }

  if (!EXTERNAL_URL_SCHEME_ALLOWLIST.has(parsedUrl.protocol)) {
    return {
      allowed: false,
      code: 'unsupported_scheme',
      message: `Schema \"${parsedUrl.protocol}\" ist nicht erlaubt.`,
    }
  }

  if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
    if (!isHostAllowed(parsedUrl)) {
      return { allowed: false, code: 'host_blocked', message: 'Hostname ist nicht in der erlaubten URL-Policy.' }
    }
  }

  return { allowed: true, code: 'ok', message: '' }
}

function applyWindowTheme(win, theme = 'dark') {
  const isDark = theme === 'dark'
  const backgroundColor = isDark ? '#1f252f' : '#eef1f5'
  const titleBarColor = isDark ? '#1f252f' : '#eceef2'
  const titleBarSymbolColor = isDark ? '#a7afbd' : '#6a727f'
  nativeTheme.themeSource = isDark ? 'dark' : 'light'

  win.setBackgroundColor(backgroundColor)
  if (typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({
      color: titleBarColor,
      symbolColor: titleBarSymbolColor,
      height: 34,
    })
  }
}

function resolvePythonBinary() {
  const venvPython =
    process.platform === 'win32'
      ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
      : path.join(process.cwd(), '.venv', 'bin', 'python')

  if (fs.existsSync(venvPython)) {
    return venvPython
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function stopProcessListeningOnBackendPort() {
  if (process.platform !== 'win32') {
    return
  }

  const script = `
$connections = Get-NetTCPConnection -LocalPort ${BACKEND_PORT} -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
  if ($connection.OwningProcess -and $connection.OwningProcess -ne $PID) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
`
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

function startBackend() {
  if (backendProcess) {
    return
  }

  stopProcessListeningOnBackendPort()
  backendStopping = false
  const python = resolvePythonBinary()
  backendProcess = spawn(python, ['-m', 'src.backend.server'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      NICKNOTES_PARENT_PID: String(process.pid),
    },
  })

  backendProcess.on('exit', () => {
    backendProcess = null
    backendStopping = false
  })
}

function stopBackend() {
  if (!backendProcess || backendStopping) {
    return
  }

  backendStopping = true
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(backendProcess.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    backendProcess.kill('SIGTERM')
  }
  backendProcess = null
  backendStopping = false
}

function stopBackendAndQuit(signal = '') {
  stopBackend()
  if (signal) {
    process.exit(0)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 740,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#eceef2',
      symbolColor: '#6a727f',
      height: 34,
    },
    backgroundColor: '#1f252f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.setMenuBarVisibility(false)
  applyWindowTheme(win, 'dark')
  mainWindow = win
  const webContentsId = win.webContents.id
  unsavedByWebContentsId.set(webContentsId, false)

  win.on('close', (event) => {
    if (allowCloseByWebContentsId.has(webContentsId)) {
      allowCloseByWebContentsId.delete(webContentsId)
      return
    }
    const hasUnsavedChanges = unsavedByWebContentsId.get(webContentsId) ?? false
    if (!hasUnsavedChanges) {
      return
    }

    event.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Speichern', 'Nicht speichern', 'Abbrechen'],
      defaultId: 0,
      cancelId: 2,
      title: 'Ungespeicherte Aenderungen',
      message: 'Es gibt ungespeicherte Aenderungen. Vor dem Schliessen speichern?',
      noLink: true,
    })

    if (choice === 1) {
      allowCloseByWebContentsId.add(webContentsId)
      win.close()
      return
    }
    if (choice !== 0) {
      return
    }
    if (pendingSaveBeforeCloseByWebContentsId.has(webContentsId)) {
      return
    }
    pendingSaveBeforeCloseByWebContentsId.add(webContentsId)
    win.webContents.send('app:request-save-before-close')
  })

  win.on('closed', () => {
    unsavedByWebContentsId.delete(webContentsId)
    pendingSaveBeforeCloseByWebContentsId.delete(webContentsId)
    allowCloseByWebContentsId.delete(webContentsId)
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
    return
  }

  win.loadFile(path.join(process.cwd(), 'dist', 'frontend', 'index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  startBackend()

  ipcMain.on('app:set-unsaved', (event, payload) => {
    unsavedByWebContentsId.set(event.sender.id, Boolean(payload))
  })

  ipcMain.on('app:save-before-close-result', (event, payload) => {
    const webContentsId = event.sender.id
    if (!pendingSaveBeforeCloseByWebContentsId.has(webContentsId)) {
      return
    }
    pendingSaveBeforeCloseByWebContentsId.delete(webContentsId)

    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }
    if (!payload || payload.ok !== true) {
      return
    }
    allowCloseByWebContentsId.add(webContentsId)
    targetWindow.close()
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectImportSources', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'OneNote-Paketdateien',
          extensions: ['onepkg'],
        },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return result.filePaths
  })

  ipcMain.handle('backend:url', async () => {
    return `http://127.0.0.1:${BACKEND_PORT}`
  })

  ipcMain.handle('shell:openExternal', async (_event, url) => {
    const decision = validateExternalUrl(url)
    if (!decision.allowed) {
      console.warn('[nicknotes-security] blocked external URL', { url, code: decision.code })
      return { ok: false, code: decision.code, message: decision.message }
    }

    try {
      await shell.openExternal(url.trim())
      return { ok: true, code: 'ok', message: '' }
    } catch (error) {
      console.warn('[nicknotes-security] failed to open external URL', { url, error: String(error) })
      return { ok: false, code: 'launch_failed', message: 'Externe URL konnte nicht geöffnet werden.' }
    }
  })

  ipcMain.handle('shell:openPathInFileExplorer', async (_event, rawPath) => {
    const decision = validateLocalDirectoryPath(rawPath)
    if (!decision.allowed) {
      return { ok: false, code: decision.code, message: decision.message }
    }

    try {
      const errorMessage = await shell.openPath(decision.path)
      if (errorMessage) {
        return { ok: false, code: 'launch_failed', message: errorMessage }
      }
      return { ok: true, code: 'ok', message: '' }
    } catch {
      return { ok: false, code: 'launch_failed', message: 'Windows Explorer konnte nicht geoeffnet werden.' }
    }
  })

  ipcMain.handle('window:set-theme', async (_event, theme) => {
    if (!mainWindow) {
      return { ok: false }
    }
    applyWindowTheme(mainWindow, theme === 'light' ? 'light' : 'dark')
    return { ok: true }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopBackend()
})

process.once('SIGINT', () => {
  stopBackendAndQuit('SIGINT')
})

process.once('SIGTERM', () => {
  stopBackendAndQuit('SIGTERM')
})

process.once('exit', () => {
  stopBackend()
})






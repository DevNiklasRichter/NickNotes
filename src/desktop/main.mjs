import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, protocol, net } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_PORT = Number(process.env.NICKNOTES_PORT || 8765)
const API_TOKEN = randomBytes(32).toString('hex')
const PROJECT_ROOT = path.resolve(__dirname, '../..')
app.setName('NickNotes')
if (process.env.NICKNOTES_USER_DATA) app.setPath('userData', process.env.NICKNOTES_USER_DATA)
protocol.registerSchemesAsPrivileged([{ scheme: 'nicknotes', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const isTrusted = (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false
  const url = new URL(event.senderFrame.url)
  return app.isPackaged ? url.protocol === 'nicknotes:' && url.hostname === 'app' : url.origin === 'http://localhost:5173'
}
const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
  if (!isTrusted(event)) throw new Error('Untrusted app frame')
  return handler(event, ...args)
})
const listen = (channel, handler) => ipcMain.on(channel, (event, ...args) => {
  if (isTrusted(event)) handler(event, ...args)
})


let backendReady = false
let backendProcess = null
let mainWindow = null
let backendStopping = false
const unsavedByWebContentsId = new Map()
const pendingSaveBeforeCloseByWebContentsId = new Set()
const allowCloseByWebContentsId = new Set()
const EXTERNAL_URL_SCHEME_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])

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
      ? path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
      : path.join(PROJECT_ROOT, '.venv', 'bin', 'python')

  if (fs.existsSync(venvPython)) {
    return venvPython
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

async function startBackend() {
  const packaged = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'nicknotes-backend.exe' : 'nicknotes-backend')
  backendStopping = false
  backendProcess = spawn(app.isPackaged ? packaged : resolvePythonBinary(), app.isPackaged ? [] : ['-m', 'src.backend.server'], {
    cwd: app.isPackaged ? app.getPath('userData') : PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, NICKNOTES_DESKTOP_BOOT: '1', PYTHONUNBUFFERED: '1' },
  })
  backendProcess.stdin.on('error', () => {}) // Process exit is reported by the readiness handler.
  backendProcess.stdin.write(JSON.stringify({ token: API_TOKEN, port: BACKEND_PORT, parent_pid: process.pid, user_data: app.getPath('userData') }) + '\n')
  backendProcess.stderr.on('data', data => process.stderr.write(data))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend antwortet nicht.')), 45000)
    let pending = ''
    backendProcess.stdout.on('data', data => {
      pending += data.toString()
      let index
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1)
        try { if (JSON.parse(line).event === 'ready') { clearTimeout(timer); resolve() } } catch {}
      }
    })
    backendProcess.once('error', error => { clearTimeout(timer); reject(error) })
    backendProcess.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend wurde beendet (${code}). Möglicherweise ist Port ${BACKEND_PORT} belegt.`)) })
  })
  backendProcess.on('exit', () => { backendProcess = null })
}

async function stopBackend() {
  const child = backendProcess
  if (!child || backendStopping) return
  if (child.exitCode !== null || child.signalCode !== null) { backendProcess = null; return }
  backendStopping = true
  try { child.stdin.write(JSON.stringify({ command: 'shutdown' }) + '\n') } catch {}
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
  if (child.exitCode === null) child.kill()
  backendProcess = null
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
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault() })
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

  win.loadURL(backendReady ? 'nicknotes://app/index.html' : 'nicknotes://app/startup.html')
}

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', () => { if (mainWindow) { mainWindow.restore(); mainWindow.focus() } })

app.whenReady().then(async () => {
  if (!hasInstanceLock) return
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  protocol.handle('nicknotes', async request => {
    const url = new URL(request.url)
    const root = path.join(app.getAppPath(), 'frontend')
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname))
    if (url.hostname !== 'app' || !target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 })
    const response = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src http://127.0.0.1:${BACKEND_PORT}; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'`)
    return new Response(response.body, { status: response.status, headers })
  })
  Menu.setApplicationMenu(null)
  if (app.isPackaged) createWindow()
  try { await startBackend(); backendReady = true } catch (error) {
    dialog.showErrorBox('NickNotes konnte nicht starten', String(error.message || error))
    await stopBackend(); app.quit(); return
  }

  listen('app:set-unsaved', (event, payload) => {
    unsavedByWebContentsId.set(event.sender.id, Boolean(payload))
  })

  listen('app:save-before-close-result', (event, payload) => {
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

  handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  handle('dialog:selectImportSources', async () => {
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

  handle('backend:token', async () => API_TOKEN)

  handle('backend:url', async () => {
    return `http://127.0.0.1:${BACKEND_PORT}`
  })

  handle('shell:openExternal', async (_event, url) => {
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

  handle('shell:openPathInFileExplorer', async (_event, rawPath) => {
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

  handle('window:set-theme', async (_event, theme) => {
    if (!mainWindow) {
      return { ok: false }
    }
    applyWindowTheme(mainWindow, theme === 'light' ? 'light' : 'dark')
    return { ok: true }
  })

  if (mainWindow) mainWindow.loadURL('nicknotes://app/index.html')
  else createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => { app.quit() })
let quitting = false
app.on('will-quit', event => {
  if (quitting || !backendProcess) return
  event.preventDefault(); quitting = true
  void stopBackend().finally(() => app.quit())
})
process.once('SIGINT', () => { void stopBackend().finally(() => app.quit()) })
process.once('SIGTERM', () => { void stopBackend().finally(() => app.quit()) })

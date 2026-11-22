import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, shell, protocol, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {CaptureDraftStore} from './capture-draft-store.mjs'
import {createWindowCloseGuard} from './window-close-guard.mjs'
import {createUpdateService} from './update-service.mjs'
import {createBackendService} from './backend-service.mjs'
import {CAPTURE_SHORTCUTS, DesktopSettingsStore, OVERVIEW_TIMES, shortcutLabel} from './desktop-settings.mjs'
import {createQuickCaptureWindow} from './quick-capture-window.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_PORT = Number(process.env.NICKNOTES_PORT || 8765)
let API_TOKEN = ''
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const startupStarted=performance.now()
let startupMetricsWrite=Promise.resolve()
const startupMark=event=>{
  const line=JSON.stringify({event,elapsedMs:Math.round(performance.now()-startupStarted),wallTime:Date.now()})
  console.log('[startup] '+line)
  if(process.env.NICKNOTES_STARTUP_DIAGNOSTICS==='1')startupMetricsWrite=startupMetricsWrite.then(()=>fs.promises.appendFile(path.join(app.getPath('userData'),'startup-metrics.jsonl'),line+'\n')).catch(()=>{})
}
app.setName('NickNotes')
if (process.env.NICKNOTES_USER_DATA) app.setPath('userData', process.env.NICKNOTES_USER_DATA)
if (!app.isPackaged && process.env.NICKNOTES_STARTUP_DIAGNOSTICS === '1') app.commandLine.appendSwitch('remote-debugging-port', '0')
protocol.registerSchemesAsPrivileged([{ scheme: 'nicknotes', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const isAppFrame = (event) => {
  if (event.senderFrame !== event.sender.mainFrame) return false
  const url = new URL(event.senderFrame.url)
  return app.isPackaged ? url.protocol === 'nicknotes:' && url.hostname === 'app' : url.origin === 'http://localhost:5173'
}
const isTrusted = (event) => Boolean(mainWindow && event.sender === mainWindow.webContents && isAppFrame(event))
// The capture window may only reach the backend credentials and its own draft.
const isQuickCapture = (event) => Boolean(quickCapture?.owns(event.sender) && isAppFrame(event))
const handle = (channel, handler, {quickCaptureAllowed = false} = {}) => ipcMain.handle(channel, (event, ...args) => {
  if (!isTrusted(event) && !(quickCaptureAllowed && isQuickCapture(event))) throw new Error('Untrusted app frame')
  return handler(event, ...args)
})
const listen = (channel, handler) => ipcMain.on(channel, (event, ...args) => {
  if (isTrusted(event)) handler(event, ...args)
})


let backendStatus = {phase:'starting',message:'Der lokale Dienst wird gestartet …'}
let resolveBackendReady, rejectBackendReady
const backendReadyPromise=new Promise((resolve,reject)=>{resolveBackendReady=resolve;rejectBackendReady=reject})
backendReadyPromise.catch(()=>{}) // The renderer receives the same failure through its authenticated connection.
let draftStore
let quickDraftStore
let desktopSettings
let quickCapture=null
let tray=null
let shortcutRegistered=false
let quitRequested=false
let startupTheme='light'
try {const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'window-state.json'),'utf8'));if(saved.theme==='dark')startupTheme='dark'} catch { /* First launch uses a neutral light background. */ }
let backendAttached = false
let mainWindow = null
const closeGuards = new Map()
let releaseConfig={updatesEnabled:false}
if(app.isPackaged){
  try{releaseConfig=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json'),'utf8'))}catch{ /* Local candidate: updates stay disabled. */ }
}
const updates=createUpdateService({
  version:app.getVersion(),enabled:app.isPackaged&&process.platform==='win32'&&releaseConfig.updatesEnabled===true,
  notify:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('updates:state',state)},
  loadUpdater:async()=>{
    const [{default:module},{parse},{verifyInstallerSignature}]=await Promise.all([import('electron-updater'),import('yaml'),import('./verify-installer.mjs')])
    const config=parse(await fs.promises.readFile(path.join(process.resourcesPath,'app-update.yml'),'utf8'))
    const publishers=Array.isArray(config.publisherName)?config.publisherName:[config.publisherName]
    if(!releaseConfig.publisherName||publishers.length!==1||publishers[0]!==releaseConfig.publisherName)throw new Error('Die erwartete Herausgebersignatur ist nicht konfiguriert.')
    const updater=module.autoUpdater
    updater.verifyUpdateCodeSignature=(_publishers,file)=>verifyInstallerSignature(file,releaseConfig.publisherName)
    updater.disableWebInstaller=true
    updater.setFeedURL({provider:'github',owner:'DevNiklasRichter',repo:'NickNotes',private:false,channel:'latest'})
    return updater
  },
  prepareInstall:async install=>{
    const win=mainWindow,guard=win&&closeGuards.get(win.webContents.id)
    if(!guard)return false
    return guard.requestClose(async()=>{
      await draftStore?.flush()
      await stopBackend({force:true})  // the installer replaces the service executable
      try{install()}catch(error){
        if(!win.isDestroyed())await startBackend()
        throw error
      }
    })
  },
})
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
    return { allowed: false, code: 'relative_path', message: 'Nur absolute Pfade können geöffnet werden.' }
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
  // Mirrors --surface, --bg-layer-1 and --muted in src/frontend/src/index.css.
  const backgroundColor = isDark ? '#1e2023' : '#f8f8f9'
  const titleBarColor = isDark ? '#191b1e' : '#eeeef0'
  const titleBarSymbolColor = isDark ? '#a3a9b3' : '#5f6672'
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

const windowBackground = () => startupTheme==='dark'?'#1e2023':'#f8f8f9'
const loadAppPage = (win, page) => app.isPackaged ? win.loadURL(`nicknotes://app/${page}`) : win.loadURL(`http://localhost:5173/${page}`)

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Run an allow-listed app command in the main window, e.g. from the tray menu. */
function runAppCommand(command) {
  if (!mainWindow || !['focusTimer'].includes(command)) return
  showMainWindow()
  mainWindow.webContents.send('app:command', command)
}

function registerCaptureShortcut() {
  globalShortcut.unregisterAll()
  shortcutRegistered = false
  const accelerator = desktopSettings?.current.captureShortcut
  if (!accelerator) return
  try {
    shortcutRegistered = globalShortcut.register(accelerator, () => quickCapture?.toggle())
  } catch (error) {
    console.warn('[desktop] Kürzel konnte nicht registriert werden:', String(error))
  }
  if (!shortcutRegistered) console.warn(`[desktop] ${shortcutLabel(accelerator)} ist bereits von einem anderen Programm belegt.`)
}

function desktopState() {
  const {captureShortcut, keepInTray, dailyOverview} = desktopSettings.current
  return {captureShortcut, keepInTray, dailyOverview, shortcutRegistered, shortcuts: CAPTURE_SHORTCUTS, overviewTimes: OVERVIEW_TIMES}
}

function updateTrayMenu() {
  if (!tray) return
  const shortcut = shortcutLabel(desktopSettings.current.captureShortcut)
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Schnellerfassung', accelerator: shortcutRegistered ? desktopSettings.current.captureShortcut : undefined, registerAccelerator: false, click: () => quickCapture?.show()},
    {label: 'Fokuszeit starten', click: () => runAppCommand('focusTimer')},
    {label: 'NickNotes öffnen', click: showMainWindow},
    {type: 'separator'},
    {label: 'Beenden', click: () => {quitRequested = true; if (mainWindow) {showMainWindow(); mainWindow.close()} else app.quit()}},
  ]))
  tray.setToolTip(shortcut && shortcutRegistered ? `NickNotes – Schnellerfassung mit ${shortcut}` : 'NickNotes')
}

async function createTray() {
  try {
    const icon = app.isPackaged
      ? await app.getFileIcon(process.execPath, {size: 'small'})
      : nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png')).resize({width: 16, height: 16})
    tray = new Tray(icon)
    tray.on('click', showMainWindow)
    updateTrayMenu()
  } catch (error) {
    console.warn('[desktop] Symbol im Infobereich nicht verfügbar:', String(error))
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

const PACKAGED_BACKEND=process.platform==='win32'?'nicknotes-backend.exe':'nicknotes-backend'
const backendService=createBackendService({
  executable:app.isPackaged?path.join(process.resourcesPath,'backend',PACKAGED_BACKEND):resolvePythonBinary(),
  args:app.isPackaged?[]:['-m','src.backend.server'],
  cwd:app.isPackaged?path.join(process.resourcesPath,'backend'):PROJECT_ROOT,
  version:app.isPackaged?app.getVersion():'dev',port:BACKEND_PORT,inheritOutput:!app.isPackaged,
})

// "Reachable in the background": login autostart of the service, which then also outlives the app.
const LOGIN_ITEM_NAME='NickNotes Dienst'
const loginItem=()=>({path:path.join(process.resourcesPath,'backend',PACKAGED_BACKEND),args:['--service'],name:LOGIN_ITEM_NAME})
// getLoginItemSettings kennt (anders als set) keine eigene Registry-Bezeichnung und wuerde den Eintrag unter dem
// Standardnamen suchen; deshalb den Eintrag selbst ueber launchItems finden.
const backgroundEnabled=()=>app.isPackaged&&process.platform==='win32'&&app.getLoginItemSettings(loginItem()).launchItems.some(item=>item.name===LOGIN_ITEM_NAME&&item.enabled)
const backgroundState=()=>({available:app.isPackaged&&process.platform==='win32',enabled:backgroundEnabled()})

async function startBackend() {
  startupMark('backend-spawn-start')
  const info=await backendService.ensure(backgroundEnabled()?null:process.pid)
  API_TOKEN=info.token;backendAttached=true
}

async function stopBackend({force=false}={}) {
  if(!backendAttached||(!force&&backgroundEnabled()))return
  backendAttached=false
  await backendService.stop()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 740,
    autoHideMenuBar: true,
    // Gepackt liefert die .exe das Icon; in der Entwicklung sonst das Electron-Standardicon.
    ...(app.isPackaged ? {} : {icon: path.join(__dirname, '../../build/icon.png')}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: startupTheme==='dark'?'#191b1e':'#eeeef0',
      symbolColor: startupTheme==='dark'?'#a3a9b3':'#5f6672',
      height: 34,
    },
    backgroundColor: startupTheme==='dark'?'#1e2023':'#f8f8f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments:[`--nicknotes-theme=${startupTheme}`],
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })
  win.webContents.on('render-process-gone', (_event, details) => console.error('[renderer] Prozess beendet:', details.reason))
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error(`[renderer] Laden fehlgeschlagen: ${description} (${url})`)
  })
  win.webContents.on('will-navigate', (event, url) => { if (url !== win.webContents.getURL()) event.preventDefault() })
  win.setMenuBarVisibility(false)
  applyWindowTheme(win, startupTheme)
  mainWindow = win
  startupMark('window-created')
  win.webContents.once('dom-ready',()=>startupMark('html-ready'))
  const webContentsId = win.webContents.id
  // With "keep in tray", closing hides the window; quitting from the tray or an update closes for real.
  closeGuards.set(webContentsId,createWindowCloseGuard(win,dialog,{hideInstead:()=>Boolean(tray&&desktopSettings?.current.keepInTray&&!quitRequested)}))

  win.on('closed', () => {
    closeGuards.delete(webContentsId)
    if (mainWindow === win) {
      mainWindow = null
      // The hidden capture window must not keep the app alive without its main window.
      quickCapture?.destroy()
    }
  })

  loadAppPage(win, 'index.html')
  if (!app.isPackaged && process.env.NICKNOTES_DEVTOOLS === '1') win.webContents.openDevTools()
}

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', showMainWindow)
app.on('before-quit', () => { quitRequested = true })

app.whenReady().then(async () => {
  if (!hasInstanceLock) return
  startupMark('app-ready')
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  // Windows shows notifications (focus timer) only for an app with its own ID; it matches electron-builder's appId.
  if(process.platform==='win32')app.setAppUserModelId('local.nicknotes.desktop')
  draftStore=new CaptureDraftStore(app.getPath('userData'))
  const draftLoaded=draftStore.load()
  draftLoaded.catch(error=>console.error('[capture-draft] Entwurf konnte nicht gelesen werden:',String(error)))
  quickDraftStore=new CaptureDraftStore(app.getPath('userData'),'quick-capture-draft.md')
  const quickDraftLoaded=quickDraftStore.load()
  quickDraftLoaded.catch(error=>console.error('[capture-draft] Entwurf der Schnellerfassung konnte nicht gelesen werden:',String(error)))
  desktopSettings=new DesktopSettingsStore(app.getPath('userData'))
  await desktopSettings.load()
  quickCapture=createQuickCaptureWindow({BrowserWindow,screen,preload:path.join(__dirname,'preload.cjs'),
    load:win=>loadAppPage(win,'capture.html'),theme:()=>startupTheme,background:windowBackground})
  // Development builds only: automated UI checks open the window without pressing a system-wide key.
  if(!app.isPackaged)globalThis.__nicknotesQuickCapture=quickCapture
  protocol.handle('nicknotes', async request => {
    const url = new URL(request.url)
    const root = path.join(app.getAppPath(), 'frontend')
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname))
    if (url.hostname !== 'app' || !target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 })
    const measuredResource=process.env.NICKNOTES_STARTUP_DIAGNOSTICS==='1'&&['/index.html','/startup.js'].includes(url.pathname)
    if(measuredResource)startupMark('resource-request:'+url.pathname)
    const response = await net.fetch(pathToFileURL(target).toString())
    if(measuredResource)startupMark('resource-headers:'+url.pathname)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src http://127.0.0.1:${BACKEND_PORT}; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'`)
    return new Response(response.body, {status:response.status,headers})
  })
  Menu.setApplicationMenu(null)
  let releaseFirstPaint
  const firstPaint=new Promise(resolve=>releaseFirstPaint=resolve)
  listen('startup:mark',(_event,name)=>{
    if(['quick-entry-enabled','quick-entry-ready','ui-rendered','workspace-ready'].includes(name))startupMark(name)
    if(name==='quick-entry-ready')releaseFirstPaint()
  })

  listen('app:set-unsaved', (event, payload) => {
    closeGuards.get(event.sender.id)?.setDirty(payload)
  })
  listen('app:close-guard-ready',(event,payload)=>closeGuards.get(event.sender.id)?.setReady(payload))
  listen('app:close-state-result',(event,payload)=>closeGuards.get(event.sender.id)?.receiveState(payload))
  listen('app:save-before-close-result', (event, payload) => {
    closeGuards.get(event.sender.id)?.receiveSaveResult(payload)
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

  handle('backend:token', async () => {await backendReadyPromise;return API_TOKEN}, {quickCaptureAllowed:true})
  handle('backend:status', () => backendStatus)
  handle('service:background', () => backgroundState())
  handle('service:set-background', async (_event, enabled) => {
    if(!backgroundState().available)throw new Error('Nur in der installierten App unter Windows verfügbar.')
    app.setLoginItemSettings({...loginItem(),openAtLogin:Boolean(enabled)})
    await backendService.setOwner(enabled?null:process.pid)
    return backgroundState()
  })
  handle('updates:state',()=>updates.getState())
  handle('updates:check',()=>updates.check())
  handle('updates:download',()=>updates.download())
  handle('updates:install',()=>updates.install())
  handle('capture:draft-read', async () => {await draftLoaded;return draftStore.current})
  handle('capture:draft-write', async (_event,text) => {await draftLoaded;await draftStore.set(text)})
  handle('quick-capture:draft-read', async () => {await quickDraftLoaded;return quickDraftStore.current}, {quickCaptureAllowed:true})
  handle('quick-capture:draft-write', async (_event,text) => {await quickDraftLoaded;await quickDraftStore.set(text)}, {quickCaptureAllowed:true})
  handle('quick-capture:hide', () => quickCapture?.hide(), {quickCaptureAllowed:true})
  handle('desktop:settings', () => desktopState())
  handle('desktop:set-settings', async (_event,patch) => {
    await desktopSettings.update(patch)
    registerCaptureShortcut()
    updateTrayMenu()
    return desktopState()
  })

  handle('window:action', (_event, action) => {
    if (!mainWindow) return
    if (action === 'close') mainWindow.close()
    else if (action === 'show') showMainWindow()  // a clicked reminder brings the hidden window back
    else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  handle('editor:action', (_event, action) => {
    if (['undo','redo','cut','copy','paste','selectAll'].includes(action)) mainWindow?.webContents[action]()
  })

  handle('backend:url', async () => {
    return `http://127.0.0.1:${BACKEND_PORT}`
  }, {quickCaptureAllowed:true})

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
      return { ok: false, code: 'launch_failed', message: 'Windows Explorer konnte nicht geöffnet werden.' }
    }
  })

  handle('window:set-theme', async (_event, theme) => {
    if (!mainWindow) {
      return { ok: false }
    }
    applyWindowTheme(mainWindow, theme === 'light' ? 'light' : 'dark')
    startupTheme=theme==='dark'?'dark':'light'
    fs.promises.writeFile(path.join(app.getPath('userData'),'window-state.json'),JSON.stringify({theme:startupTheme})).catch(()=>{})
    return { ok: true }
  })

  createWindow()
  registerCaptureShortcut()
  void createTray()
  // Windows process creation and cold Python imports must not compete with the first entry paint.
  // A broken/missing renderer must not leave backend startup waiting indefinitely.
  const paintTimeout=setTimeout(releaseFirstPaint,3000)
  void firstPaint.then(()=>{clearTimeout(paintTimeout);if(mainWindow)return startBackend();throw new Error('Fenster wurde geschlossen.')}).then(()=>{
    backendStatus={phase:'ready',message:'Lokaler Dienst bereit.'};resolveBackendReady()
    startupMark('backend-ready')
    updates.start()
    mainWindow?.webContents.send('backend:status-changed',backendStatus)
  }).catch(async error=>{
    const message=String(error.message||error)
    backendStatus={phase:'error',message};rejectBackendReady(new Error(message))
    console.error('[backend] Start fehlgeschlagen:',message)
    mainWindow?.webContents.send('backend:status-changed',backendStatus)
    await stopBackend()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => { app.quit() })
let quitting = false
app.on('will-quit', event => {
  if (quitting || (!backendAttached&&!draftStore)) return
  event.preventDefault(); quitting = true;updates.dispose()
  globalShortcut.unregisterAll();tray?.destroy();tray=null
  void Promise.allSettled([stopBackend(),draftStore?.flush(),quickDraftStore?.flush()]).finally(() => app.quit())
})
process.once('SIGINT', () => { void stopBackend().finally(() => app.quit()) })
process.once('SIGTERM', () => { void stopBackend().finally(() => app.quit()) })

import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_PORT = 8765

let backendProcess = null

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

function startBackend() {
  if (backendProcess) {
    return
  }

  const python = resolvePythonBinary()
  backendProcess = spawn(python, ['-m', 'src.backend.server'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  })

  backendProcess.on('exit', () => {
    backendProcess = null
  })
}

function stopBackend() {
  if (!backendProcess) {
    return
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(backendProcess.pid), '/T', '/F'])
  } else {
    backendProcess.kill('SIGTERM')
  }

  backendProcess = null
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 740,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.setMenuBarVisibility(false)

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

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('backend:url', async () => {
    return `http://127.0.0.1:${BACKEND_PORT}`
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





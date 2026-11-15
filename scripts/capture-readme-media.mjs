/**
 * Erzeugt die Screenshots und GIFs der README aus der echten Desktop-App.
 * Datenquelle ist ausschließlich die fiktive Demo-NoteBase unter examples/demo-notebase.
 * Aufruf: npm run readme:media [-- --stills | --gifs]   (GIFs brauchen ffmpeg im PATH)
 */
import {_electron as electron, expect} from '@playwright/test'
import electronBinary from 'electron'
import {spawn, spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {isViteReady} from './vite-readiness.mjs'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'doc', 'media')
const only = process.argv.includes('--stills') ? 'stills' : process.argv.includes('--gifs') ? 'gifs' : 'all'
const size = {width: 1440, height: 900}
fs.mkdirSync(path.join(root, '.tmp'), {recursive: true})
const scratch = fs.mkdtempSync(path.join(root, '.tmp', 'readme-media-'))
fs.mkdirSync(outDir, {recursive: true})

if (only !== 'stills' && spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg fehlt im PATH (winget install Gyan.FFmpeg).')

const demoSource = path.join(root, 'examples', 'demo-notebase')
const vaultPath = path.join(scratch, 'Demo-NoteBase')
fs.cpSync(demoSource, vaultPath, {recursive: true})

let viteLog = '', page, app
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--strictPort'], {cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
for (const stream of [vite.stdout, vite.stderr]) stream.on('data', chunk => {viteLog = (viteLog + chunk).slice(-8000)})

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function request(endpoint, body) {
  return page.evaluate(async ({endpoint, body}) => {
    const base = await window.nicknotes.getBackendUrl()
    const token = await window.nicknotes.getBackendToken()
    const response = await fetch(base + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`)
    return data
  }, {endpoint, body})
}

async function setSize() {
  await app.evaluate(({BrowserWindow}, {width, height}) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win.isMaximized()) win.unmaximize()
    win.setContentSize(width, height)
  }, size)
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size.width)
}

async function setTheme(mode) {
  await page.locator('.activity-rail').getByRole('button', {name: 'Einstellungen', exact: true}).click()
  await page.getByRole('button', {name: 'Darstellung', exact: true}).click()
  await page.locator('.settings-modal').getByRole('combobox').first().selectOption(mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
  const save = page.getByRole('dialog').getByRole('button', {name: 'Speichern', exact: true})
  if (await save.isEnabled()) {await save.click(); await expect(save).toBeDisabled()}
  await page.getByRole('button', {name: 'Einstellungen schließen'}).click()
}

async function openNote(title) {
  await page.keyboard.press('Control+o')
  await page.getByRole('combobox', {name: 'Notiz suchen'}).fill(title)
  const option = page.getByRole('option').filter({hasText: title}).first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(page.locator('.note-title-input').first()).toHaveValue(title)
  await expect(page.locator('.note-body-editor .cm-content').first()).toBeVisible()
}

const rail = name => page.locator('.activity-rail').getByRole('button', {name, exact: true})

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await wait(400)
}

async function still(name) {
  await settle()
  await page.screenshot({path: path.join(outDir, `${name}.png`)})
  console.log('Screenshot', name)
}

/** Zeichnet per Chromium-Screencast Bilder mit Zeitstempeln auf und setzt daraus ein GIF zusammen. */
async function gif(name, action, {width = 960, fps = 12} = {}) {
  const dir = path.join(scratch, `frames-${name}`)
  fs.mkdirSync(dir, {recursive: true})
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({data, metadata, sessionId}) => {
    const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({file, at: metadata.timestamp})
    cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 90, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1})
  await wait(600)
  await action()
  await wait(1500)
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  if (frames.length < 2) throw new Error(`Screencast ${name}: keine Bilder`)
  const quote = file => `file '${file.replaceAll(path.sep, '/')}'`
  const list = frames.map((frame, i) => [quote(frame.file), `duration ${(i + 1 < frames.length ? frames[i + 1].at - frame.at : 1.2).toFixed(3)}`])
  list.push([quote(frames.at(-1).file)])
  const listFile = path.join(scratch, `${name}.txt`)
  fs.writeFileSync(listFile, list.flat().join('\n'))
  const target = path.join(outDir, `${name}.gif`)
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', filter, '-loop', '0', target])
  if (result.status !== 0) throw new Error('ffmpeg: ' + result.stderr)
  console.log('GIF', name, frames.length, 'Bilder,', Math.round(fs.statSync(target).size / 1024), 'KB')
}

async function type(text, delay = 55) {
  await page.keyboard.type(text, {delay})
}

try {
  for (let i = 0; i < 90 && !isViteReady(viteLog); i++) await wait(500)
  app = await electron.launch({
    executablePath: electronBinary, args: [root], cwd: root,
    env: {...process.env, NICKNOTES_USER_DATA: path.join(scratch, 'profile'), NICKNOTES_PORT: '18782'},
    timeout: 90000
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  await expect(page.getByRole('menubar')).toBeVisible({timeout: 90000})
  await setSize()
  await request('/notebase/open', {path: vaultPath})
  await request('/notebase/reindex', {})
  await request('/graph-index/rebuild', {})
  await page.reload()
  await expect(page.locator('.activity-rail')).toBeVisible()
  await setTheme('light')
  await setSize()

  const closeCapture = () => page.getByRole('button', {name: /^Schnellerfassung schließen/}).click().catch(() => {})
  const openCapture = async () => {
    await page.keyboard.press('Control+Shift+Space')
    await expect(page.getByRole('button', {name: /^Schnellerfassung schließen/})).toBeVisible()
  }
  const sidebar = page.locator('.left-sidebar')
  const sel = label => sidebar.locator(`xpath=//*[normalize-space(text())="${label}"]/following::select[1]`)
  await closeCapture()

  if (only !== 'gifs') {
    for (const mode of ['light', 'dark']) {
      await setTheme(mode)
      await rail('Notizen').click()
      await openNote('Atlas – Palettierzelle')
      await still(`note-${mode}`)
      await rail('Tasks').click()
      await still(`tasks-${mode}`)
      await openNote('Atlas – Palettierzelle')
      await rail('Wissensgraph').click()
      await wait(3500)
      await still(`graph-${mode}`)
      await rail('Fokus').click()
      await wait(1200)
      await still(`focus-${mode}`)
      await rail('Tags').click()
      await still(`tags-${mode}`)
    }
    await setTheme('light')
    await rail('Einstellungen').click()
    await page.getByRole('button', {name: 'MCP'}).click()
    await still('agents-light')
    await page.getByRole('button', {name: 'Einstellungen schließen'}).click()
  }

  if (only !== 'stills') {
    await setTheme('light')
    // Schnellerfassung: Link, Tag und Datum direkt beim Schreiben
    await rail('Notizen').click()
    await openNote('Atlas – Palettierzelle')
    await openCapture()
    await gif('schnellerfassung', async () => {
      await page.getByText('Gedanken festhalten').click({force: true})
      await type('- [ ] Greiferzeichnung nachfassen ')
      await type('[[Palettier', 80)
      await wait(900)
      await page.keyboard.press('Enter')
      await type(' #Atl', 90)
      await wait(900)
      await page.keyboard.press('Enter')
      await type(' @Fre', 90)
      await wait(900)
      await page.keyboard.press('Enter')
      await wait(700)
      await page.getByRole('button', {name: 'Senden', exact: true}).click()
      await wait(900)
    })
    await closeCapture()

    await gif('suche', async () => {
      await page.keyboard.press('Control+o')
      await type('alarm', 120)
      await wait(900)
      await page.keyboard.press('ArrowDown')
      await wait(600)
      await page.keyboard.press('Enter')
      await wait(1200)
    })

    await openNote('Atlas – Palettierzelle')
    await rail('Wissensgraph').click()
    await wait(3500)
    const canvas = page.getByRole('group', {name: 'Wissensgraph', exact: true})
    await gif('graph', async () => {
      const box = await canvas.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      for (let i = 0; i < 4; i++) {await page.mouse.wheel(0, -90); await wait(250)}
      await wait(600)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 70, {steps: 18})
      await page.mouse.up()
      await wait(800)
      await sidebar.locator('.graph-sidebar-search-input').click()
      await type('Atlas', 120)
      await wait(1500)
    }, {width: 880, fps: 10})

    await rail('Tasks').click()
    await gif('tasks', async () => {
      await wait(800)
      await sel('Gruppieren nach').selectOption({label: 'Priorität'})
      await wait(1500)
      await sel('Gruppieren nach').selectOption({label: 'Status'})
      await wait(1000)
      await sel('Darstellung').selectOption({index: 1})
      await wait(1500)
    })
  }
} finally {
  await app?.close().catch(() => {})
  vite.kill()
}

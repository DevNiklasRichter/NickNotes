/** Repeatable UX evidence from the real desktop and backend, with disposable data only. */
import {_electron as electron, expect as baseExpect} from '@playwright/test'
import electronBinary from 'electron'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {parse as parseYaml} from 'yaml'
import {createInterface} from 'node:readline/promises'
import {isViteReady} from './vite-readiness.mjs'

const root = path.resolve(import.meta.dirname, '..')
if (process.argv.includes('--review') && !process.stdin.isTTY) throw new Error('--review needs an interactive terminal; omit it for automatic capture.')
fs.mkdirSync(path.join(root, '.tmp'), {recursive: true})
const scratch = fs.mkdtempSync(path.join(root, '.tmp', 'ux-baseline-'))
const expect = baseExpect.configure({timeout: 20000})
const review = process.argv.includes('--review')
const edgesOnly = process.argv.includes('--edges-only')
const foundations = process.argv.includes('--foundations')
const menus = process.argv.includes('--menus')
const tags = process.argv.includes('--tags')
const graph = process.argv.includes('--graph')
const editorMenus = process.argv.includes('--editor-menus')
const sidebarMenus = process.argv.includes('--sidebar-menus')
const suggestionMenus = process.argv.includes('--suggestions')
const createDialog = process.argv.includes('--create-dialog')
const tagMatching = process.argv.includes('--tag-matching')
const settingsDialog = process.argv.includes('--settings-dialog')
const filters = process.argv.includes('--filters')
const properties = process.argv.includes('--properties')
const tooltips = process.argv.includes('--tooltips')
const searchCommands = process.argv.includes('--search-commands')
const reviewFromArg = process.argv.slice(2).find(arg => /^--review-from=\d+$/.test(arg))
const reviewFrom = reviewFromArg ? Number(reviewFromArg.split('=')[1]) : 1
if (process.argv.slice(2).some(arg => !['--review','--edges-only','--foundations','--menus','--tags','--graph','--editor-menus','--sidebar-menus','--suggestions','--create-dialog','--tag-matching','--settings-dialog','--filters','--properties','--tooltips','--search-commands'].includes(arg) && arg !== reviewFromArg)) throw new Error('Usage: npm run ux:baseline -- [--review] [--review-from=N] [--edges-only] [--foundations] [--menus] [--tags] [--graph] [--editor-menus] [--sidebar-menus] [--suggestions] [--create-dialog] [--tag-matching] [--settings-dialog] [--filters] [--properties] [--tooltips] [--search-commands]')
const input = review ? createInterface({input: process.stdin, output: process.stdout}) : null
const report = {
  sourceCommit: null, startedAt: new Date().toISOString(),
  runtime: {node: process.version, platform: process.platform},
  fixture: 'Synthetic Markdown only; recovery journal is staged, conflict is a real external file edit.',
  screenshots: [], checks: {}, pageErrors: [], requests: [],
}
const git = spawn('git', ['rev-parse', 'HEAD'], {cwd: root, windowsHide: true})
let commit = ''
git.stdout.on('data', chunk => {commit += chunk})
git.on('close', code => {if (code === 0) report.sourceCommit = commit.trim()})
git.on('error', () => {})
let app, page, vaultPath, notePath, viteLog = '', viteError
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
})
vite.stdout.on('data', chunk => {viteLog = (viteLog + chunk).slice(-8000)})
vite.stderr.on('data', chunk => {viteLog = (viteLog + chunk).slice(-8000)})
vite.on('error', error => {viteError = error})
const writeReport = () => fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify(report, null, 2))

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

async function windowSize(width, height, zoom = 1) {
  const before=await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0]
    const state={maximized:win.isMaximized(),fullscreen:win.isFullScreen(),contentSize:win.getContentSize(),zoom:win.webContents.getZoomFactor()}
    if(state.fullscreen)win.setFullScreen(false)
    if(state.maximized)win.unmaximize()
    return state
  })
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0]
    return win.isFullScreen()||win.isMaximized()
  })).toBe(false)
  await app.evaluate(({BrowserWindow}, {width, height, zoom}) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.setZoomFactor(zoom)
    win.setContentSize(width, height)
  }, {width, height, zoom})
  await expect.poll(()=>page.evaluate(({width,height,zoom})=>Math.abs(innerWidth-width/zoom)<2&&Math.abs(innerHeight-height/zoom)<2,{width,height,zoom})).toBe(true)
  report.checks.windowSetups ??= []
  report.checks.windowSetups.push({width,height,zoom,before,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight}))})
}

async function capture(name, description) {
  // Wait for actual paints and font completion, not a fixed screenshot delay.
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all([...document.querySelectorAll('.nn-tooltip:popover-open .nn-tooltip-content')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})))
  })
  const step = report.screenshots.length + (edgesOnly ? 19 : 1)
  const file = `${String(step).padStart(2, '0')}-${name}.png`
  const metrics = await page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector)
      if (!node) return null
      const {x, y, width, height} = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {x, y, width, height, fontSize: style.fontSize, fontFamily: style.fontFamily}
    }
    return {
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
      theme: document.documentElement.dataset.theme,
      documentOverflowX: document.documentElement.scrollWidth > innerWidth,
      focus: {tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), className: document.activeElement?.className},
      navigation: rect('.activity-rail'), sidebar: rect('.left-sidebar'), main: rect('.main-region'),
      railButtons: [...document.querySelectorAll('.activity-rail button')].map(node => {
        const {x,y,width,height} = node.getBoundingClientRect()
        return {x,y,width,height}
      }),
      palette: Object.fromEntries(['text','muted','surface','surface-strong','surface-contrast','bg-layer-1','accent-strong','editor-note-bg'].map(key => [key,getComputedStyle(document.documentElement).getPropertyValue('--'+key).trim()])),
      properties: rect('.note-properties-panel'), editor: rect('.note-body-editor .cm-scroller'),
      graphCanvas: rect('.graph-network-canvas'),
      capture: rect('.capture-workspace-panel'),
      tooltips: [...document.querySelectorAll('.nn-tooltip:popover-open')].map(node=>{
        const {x,y,width,height}=node.getBoundingClientRect()
        return {text:node.textContent,id:node.id,x,y,width,height,outsideViewport:x<0||y<0||x+width>innerWidth||y+height>innerHeight,
          describedBy:[...document.querySelectorAll('[aria-describedby]')].filter(target=>target.getAttribute('aria-describedby').split(/\s+/).includes(node.id)).map(target=>({tag:target.tagName,label:target.getAttribute('aria-label')}))}
      }),
      menus: [...document.querySelectorAll('.nn-context-menu,.explorer-context-menu,.editor-selection-context-menu')].map(node => {
        const {x, y, width, height} = node.getBoundingClientRect()
        return {className: node.className, role: node.getAttribute('role'), label: node.getAttribute('aria-label'), x, y, width, height,
          scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop,
          outsideViewport: x < 0 || y < 0 || x + width > innerWidth || y + height > innerHeight}
      }),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node=>!node.closest('[aria-hidden="true"]')&&node.getClientRects().length).map(node=>{
        const {x,y,width,height}=node.getBoundingClientRect()
        return {label:node.getAttribute('aria-label')||document.getElementById(node.getAttribute('aria-labelledby'))?.textContent,
          x,y,width,height,outsideViewport:x<0||y<0||x+width>innerWidth+1||y+height>innerHeight+1}
      }),
    }
  })
  if (metrics.main) {
    assert.ok(Math.abs(metrics.main.x + metrics.main.width - metrics.viewport.width) <= 2, 'Workspace leaves unused columns on its right')
    if (metrics.sidebar) assert.ok(metrics.sidebar.width > 0, 'An enabled sidebar must remain visible at zoomed widths')
    for (let i=1;i<metrics.railButtons.length;i++) assert.ok(metrics.railButtons[i].y >= metrics.railButtons[i-1].y + metrics.railButtons[i-1].height, 'Navigation buttons overlap')
  }
  // Capture the compositor surface. CDP screenshots in Electron can crop a
  // zoomed window to CSS viewport dimensions instead of its full pixel surface.
  for (const menu of metrics.menus.filter(m => m.className === 'nn-context-menu')) assert.equal(menu.outsideViewport,false,'Context menu is outside viewport')
  const pixels = await app.evaluate(async ({BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0]
    const capture = await win.webContents.capturePage()
    return {png: capture.toPNG().toString('base64'), size: capture.getSize()}
  })
  fs.writeFileSync(path.join(scratch, file), Buffer.from(pixels.png, 'base64'))
  metrics.screenshotSize = pixels.size
  report.screenshots.push({file, description, ...metrics})
  writeReport()
  console.log(JSON.stringify({screenshot: path.join(scratch, file), description, viewport: metrics.viewport, theme: metrics.theme, menus: metrics.menus}))
  if (input && step >= reviewFrom) await input.question('Review screenshot, then Enter to continue: ')
}

async function openNote(title) {
  await page.keyboard.press('Control+o')
  const query = page.getByRole('combobox', {name: 'Notiz suchen'})
  await query.fill(title)
  const option = page.getByRole('option').filter({hasText: title})
  await expect(option).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-title-input').first()).toHaveValue(title)
  await expect(page.locator('.note-body-editor .cm-content').first()).toBeVisible()
}

async function theme(mode) {
  await page.locator('.activity-rail').getByRole('button', {name: 'Einstellungen', exact: true}).click()
  await page.getByRole('button', {name: 'Darstellung', exact: true}).click()
  await page.locator('.settings-modal').getByRole('combobox').first().selectOption(mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
  const save = page.getByRole('dialog').getByRole('button', {name: 'Speichern', exact: true})
  if (await save.isEnabled()) {await save.click(); await expect(save).toBeDisabled()}
  await page.getByRole('button', {name: 'Einstellungen schliessen'}).click()
}

async function createNote(title, body, noteType = 'note') {
  const note = await request('/note-groups/add-note', {groupKey: '', title, noteType})
  assert.ok(path.resolve(note.notePath).startsWith(vaultPath + path.sep), 'Fixture write outside its own NoteBase')
  const document = await request('/notes/content?path=' + encodeURIComponent(note.notePath))
  await request('/notes/save', {path: note.notePath, content: document.content + '\n' + body, expectedRevision: document.revision})
  return note.notePath
}

async function verifyFoundations() {
  const editor = page.locator('.note-body-editor .cm-content').first()
  const marker = 'Layoutwechsel behält diesen Entwurf.'
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n'+marker)
  await windowSize(1280,800,1.5)
  await capture('note-zoom-150-dark','150% app zoom; all three workspace areas remain reachable')
  await page.keyboard.press('Control+Shift+e')
  await expect(page.locator('.left-sidebar')).toHaveCount(0)
  await capture('note-sidebar-hidden-dark','150% app zoom with sidebar explicitly hidden; main fills remaining width')
  await page.keyboard.press('Control+Shift+e')
  await expect(page.locator('.left-sidebar')).toBeVisible()
  await windowSize(1280,800)
  await expect(editor).toContainText(marker)
  const response = page.waitForResponse(res=>res.url().endsWith('/notes/save') && res.request().method()==='POST')
  await page.keyboard.press('Control+s')
  assert.equal((await response).status(),200)
  assert.ok(fs.readFileSync(notePath,'utf8').includes(marker))
  report.checks.resizeAndSidebarPreserveDraft = true

  await page.locator('.activity-rail').getByRole('button',{name:'Einstellungen',exact:true}).click()
  await page.getByRole('button',{name:'Darstellung',exact:true}).click()
  await page.getByRole('button',{name:'Neues Theme',exact:true}).click()
  for (const [label,value] of [['Text','#dcece2'],['Editor-Hintergrund','#1b2721']]) {
    const field = page.locator('.theme-token-row').filter({has:page.getByText(label,{exact:true})}).locator('input:not([type="color"])')
    await field.fill(value); await field.press('Tab')
  }
  const save = page.getByRole('dialog').getByRole('button',{name:'Speichern',exact:true})
  await save.click(); await expect(save).toBeDisabled()
  await page.getByRole('button',{name:'Einstellungen schliessen'}).click()
  await capture('note-custom-profile','Custom profile with independent text/editor colours')
  const stored = JSON.stringify(await request('/ui-settings'))
  assert.ok(stored.includes('#dcece2') && stored.includes('#1b2721'))
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--text'))).toBe('#dcece2')
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--editor-note-bg'))).toBe('#1b2721')
  report.checks.customProfileSurvivesReload = true
  await openNote('Arbeitsnotiz')
  await theme('dark')
}

async function verifyMenus() {
  const tab = page.locator('.tab-open').filter({hasText:'Arbeitsnotiz'}).first()
  const tabMenu = page.getByRole('menu',{name:'Registerkartenaktionen',exact:true})
  const explorerMenu = page.getByRole('menu',{name:'Exploreraktionen',exact:true})
  await tab.focus(); await page.keyboard.press('Shift+F10')
  await expect(tabMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End'); await expect(tabMenu.getByRole('menuitem').last()).toBeFocused()
  await page.keyboard.press('ArrowDown'); await expect(tabMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowUp'); await expect(tabMenu.getByRole('menuitem').last()).toBeFocused()
  await page.keyboard.press('Home'); await expect(tabMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  const disabled = tabMenu.getByRole('menuitem',{name:'Alle anderen Registerkarten schliessen',exact:true})
  await expect(disabled).toHaveAttribute('aria-disabled','true')
  await expect(disabled).toBeFocused()
  await page.keyboard.press('Enter'); await expect(tabMenu).toBeVisible()
  await page.keyboard.press('Space'); await expect(tabMenu).toBeVisible()
  const count = await page.locator('.tab-open').count()
  await page.keyboard.press('Control+w')
  await expect(page.locator('.tab-open')).toHaveCount(count)
  await capture('menu-keyboard-disabled-dark','Tab menu opened with Shift+F10; disabled action is focusable but cannot activate')
  await page.keyboard.press('Escape'); await expect(tabMenu).toHaveCount(0); await expect(tab).toBeFocused()
  report.checks.menuKeyboardNavigationAndDisabled = true

  await page.keyboard.press('Shift+F10'); await page.keyboard.press('Tab')
  await expect(tabMenu).toHaveCount(0)
  assert.equal(await page.evaluate(()=>document.activeElement===document.body),false,'Tab must leave menu with usable focus')
  await tab.focus(); await page.keyboard.press('Shift+F10'); await page.keyboard.press('Shift+Tab')
  await expect(tabMenu).toHaveCount(0)
  assert.equal(await page.evaluate(()=>document.activeElement===document.body),false)
  report.checks.menuTabExits = true

  // Remove the invoked tab to check the surviving pane as the focus fallback.
  await tab.focus(); await page.keyboard.press('Shift+F10')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(tab).toHaveCount(0)
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.classList.contains('workspace-pane'))).toBe(true)
  await openNote('Arbeitsnotiz')
  report.checks.menuRemovedTriggerFallback = true

  await expect(page.locator('.left-sidebar')).toBeVisible()
  const row = page.locator('.explorer-row').filter({hasText:'Arbeitsnotiz'}).first()
  await row.click({button:'right'})
  await expect(explorerMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape'); await expect(row).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await page.keyboard.press('u')
  await expect(explorerMenu.getByRole('menuitem',{name:'Umbenennen',exact:true})).toBeFocused()
  await page.keyboard.press('Enter')
  const input = page.locator('.explorer-action-dialog input')
  await expect(input).toBeFocused()
  await expect(explorerMenu).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('.explorer-action-dialog button').last()).toBeFocused()
  await page.keyboard.press('Tab'); await expect(input).toBeFocused()
  await page.keyboard.press('Control+w'); await expect(tab).toHaveCount(1); await expect(input).toBeFocused()
  await capture('menu-rename-dialog-dark','Enter hands focus to the existing rename dialog; no action executed on cancel')
  await page.keyboard.press('Escape'); await expect(input).toHaveCount(0); await expect(row).toBeFocused()
  assert.ok(fs.existsSync(notePath))
  report.checks.menuDialogFocusRoundTrip = true

  await page.keyboard.press('Shift+F10'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  const confirm = page.locator('.explorer-action-dialog')
  await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await page.keyboard.press('Tab'); await expect(confirm.getByRole('button',{name:'Loeschen',exact:true})).toBeFocused()
  await page.keyboard.press('Shift+Tab'); await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await capture('menu-delete-confirm-dark','Existing delete confirmation receives focus; Escape cancels without deleting the Markdown file')
  await page.keyboard.press('Enter'); await expect(confirm).toHaveCount(0); await expect(row).toBeFocused()
  assert.ok(fs.existsSync(notePath))
  await page.keyboard.press('Shift+F10'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await page.keyboard.press('Escape'); await expect(confirm).toHaveCount(0); await expect(row).toBeFocused()
  assert.ok(fs.existsSync(notePath))
  report.checks.menuDeleteConfirmationCancelled = true

  await page.keyboard.press('ContextMenu'); await expect(explorerMenu).toBeVisible()
  await page.keyboard.press('Escape'); await expect(row).toBeFocused()
  report.checks.menuContextKey = true

  await page.keyboard.press('Shift+F10'); await page.keyboard.press('Home'); await page.keyboard.press('Space')
  await expect(explorerMenu).toHaveCount(0)
  await expect(page.locator('.note-title-input').first()).toHaveValue('Arbeitsnotiz')
  await row.click({button:'right'})
  const search = page.locator('.explorer-search-input')
  await search.click(); await expect(explorerMenu).toHaveCount(0); await expect(search).toBeFocused()
  const folderButton = page.locator('.explorer-row').filter({has:page.getByText('tasks',{exact:true})}).locator('.row-folder-menu')
  await folderButton.focus(); await expect(folderButton).toBeFocused(); await page.keyboard.press('Enter')
  await expect(explorerMenu).toBeVisible()
  const point = await explorerMenu.boundingBox()
  assert.ok(point && point.x>8 && point.y>8,'Keyboard activation of folder button should anchor to its control')
  await page.keyboard.press('Escape'); await expect(folderButton).toBeFocused()
  await row.click({button:'right'})
  await search.hover(); await page.mouse.wheel(0,100)
  await expect(explorerMenu).toHaveCount(0)
  report.checks.menuSpaceAndOutsidePointer = true

  // Only this disposable test window is allowed below the product's normal minimum.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(240,240))
  await windowSize(360,480,1.5)
  await tab.focus(); await page.keyboard.press('Shift+F10')
  await capture('menu-narrow-zoom-dark','Long labels wrap inside a 240-CSS-pixel viewport at 150% zoom')
  assert.equal(await tabMenu.evaluate(menu=>menu.scrollWidth>menu.clientWidth),false)
  assert.ok(await tabMenu.getByRole('menuitem',{name:'Alle anderen Registerkarten schliessen',exact:true}).evaluate(item=>item.getBoundingClientRect().height>32),'Long label should wrap')
  await page.keyboard.press('End'); await expect(tabMenu.getByRole('menuitem').last()).toBeFocused()
  await windowSize(360,240,1.5)
  await expect.poll(()=>tabMenu.evaluate(menu=>menu.scrollHeight>menu.clientHeight)).toBe(true)
  await page.keyboard.press('Home'); await page.keyboard.press('End')
  await expect.poll(()=>tabMenu.evaluate(menu=>menu.scrollTop>0)).toBe(true)
  await capture('menu-short-scroll-dark','Short zoomed viewport: menu remains inside window and scrolls to its final item')
  await page.keyboard.press('Escape')
  await windowSize(1280,800)
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setMinimumSize(1100,740))
  report.checks.menuNarrowZoomAndScroll = true
}

async function verifyTags() {
  await request('/tag-groups/add-group',{groupId:'ux-projekt',displayName:'UX Projekte',color:'#81a1c1'})
  await request('/tag-groups/add-tag',{groupId:'ux-projekt',tagId:'layout',displayName:'Layout'})
  const source = await request('/notes/content?path='+encodeURIComponent(notePath))
  await request('/notes/save',{path:notePath,content:source.content+'\n{tag:ux-projekt/layout}\n',expectedRevision:source.revision})
  const definitionsPath = path.join(vaultPath,'.system','tag_groups.json')
  // Add a long synthetic tag list using the same portable source format.
  const definitions = JSON.parse(fs.readFileSync(definitionsPath,'utf8'))
  definitions.groups.push({id:'z-tests',displayName:'Weitere synthetische Tags',color:'#a3be8c',tags:Array.from({length:32},(_,i)=>({id:`eintrag-${i+1}`,displayName:`Prüfeintrag ${String(i+1).padStart(2,'0')}`}))})
  fs.writeFileSync(definitionsPath,JSON.stringify(definitions,null,2))
  await request('/notebase/reindex',{})
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await page.locator('.activity-rail').getByRole('button',{name:'Tagging',exact:true}).click()
  const shell = page.locator('.tag-explorer-shell')
  const group = shell.locator('[data-tag-group="ux-projekt"]:not([data-tag-id])')
  const tag = shell.locator('[data-tag-key="ux-projekt:layout"]')
  const menu = page.getByRole('menu',{name:'Tagaktionen',exact:true})
  const dialog = page.locator('.tag-action-modal')
  const original = fs.readFileSync(definitionsPath,'utf8')
  await group.locator('.row-folder-menu').focus(); await page.keyboard.press('Enter')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await capture('tag-group-menu-dark','Group actions opened with Enter on the keyboard-reachable action button')
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(dialog).toHaveAttribute('role','dialog')
  await expect(dialog.locator('#tag-group-id')).toBeFocused()
  await dialog.locator('#tag-group-display-name').fill('Diese Änderung wird abgebrochen')
  await dialog.locator('#tag-group-id').focus(); await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await page.keyboard.press('Tab'); await expect(dialog.locator('#tag-group-id')).toBeFocused()
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).focus(); await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(group.locator('.row-folder-menu')).toBeFocused()
  assert.equal(fs.readFileSync(definitionsPath,'utf8'),original,'Enter on Cancel must not save group edits')
  report.checks.tagGroupCancelEnterAndFocus = true

  await page.keyboard.press('Shift+F10'); await page.keyboard.press('Home'); await page.keyboard.press('Enter')
  await expect(dialog.locator('#tag-id')).toBeFocused()
  await dialog.locator('#tag-id').fill('neuer-ui-tag')
  await dialog.locator('#tag-display-name').fill('UI Testtag')
  const created = page.waitForResponse(res=>res.url().endsWith('/tag-groups/add-tag')&&res.request().method()==='POST')
  await page.keyboard.press('Enter'); assert.equal((await created).status(),200)
  await expect(dialog).toHaveCount(0)
  assert.ok(JSON.parse(fs.readFileSync(definitionsPath,'utf8')).groups.find(g=>g.id==='ux-projekt').tags.some(t=>t.id==='neuer-ui-tag'))
  report.checks.tagCreatedFromGroupMenu200 = true

  await tag.focus(); await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem',{name:'Tag bearbeiten',exact:true})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('#tag-id')).toBeFocused()
  await dialog.locator('#tag-display-name').fill('Layout geprüft')
  await capture('tag-edit-dialog-dark','Tag form receives focus and preserves edits while tabbing through its fields')
  const saved = page.waitForResponse(res=>res.url().endsWith('/tag-groups/rename-tag')&&res.request().method()==='POST')
  await page.keyboard.press('Enter')
  assert.equal((await saved).status(),200)
  await expect(dialog).toHaveCount(0); await expect(tag).toBeFocused()
  const updated = JSON.parse(fs.readFileSync(definitionsPath,'utf8'))
  assert.equal(updated.groups.find(g=>g.id==='ux-projekt').tags.find(t=>t.id==='layout').displayName,'Layout geprüft')
  assert.ok(fs.readFileSync(notePath,'utf8').includes('{tag:ux-projekt/layout}'))
  report.checks.tagSave200AndMarkdownReferencePreserved = true

  await page.keyboard.press('ContextMenu'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await capture('tag-delete-choice-dark','Tag deletion choice defaults to Cancel; Enter retains the definition and Markdown reference')
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button',{name:'Auch aus Notizen entfernen',exact:true})).toBeFocused()
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  const before = report.requests.length
  await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); await expect(tag).toBeFocused()
  assert.equal(report.requests.slice(before).some(r=>r.method==='POST'&&r.endpoint==='/tag-groups/delete-tag'),false)
  assert.ok(JSON.parse(fs.readFileSync(definitionsPath,'utf8')).groups.find(g=>g.id==='ux-projekt').tags.some(t=>t.id==='layout'))
  report.checks.tagDeleteCancelEnterDoesNotMutate = true

  await group.focus(); await page.keyboard.press('Shift+F10')
  await menu.getByRole('menuitem',{name:'Farbe setzen',exact:true}).focus(); await page.keyboard.press('Space')
  await expect(dialog.locator('input[type=color]')).toBeFocused()
  await dialog.locator('.tag-color-swatch').first().focus(); await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).focus(); await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0); await expect(group).toBeFocused()
  report.checks.tagColorButtonEnterKeepsDialogOpen = true

  const tree = shell.locator('.tag-explorer-tree')
  await tree.focus(); await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem',{name:'Alle erweitern',exact:true})).toBeFocused()
  await page.keyboard.press('Escape'); await expect(tree).toBeFocused()
  const last = shell.locator('.tag-entry-row').last()
  await last.scrollIntoViewIfNeeded(); await last.click({button:'right'})
  await capture('tag-menu-bottom-dark','Tag menu at the bottom of a long tag list is clamped to the window')
  await page.keyboard.press('Escape'); await expect(last).toBeFocused()
  await windowSize(1280,800,1.5)
  await last.focus(); await page.keyboard.press('Shift+F10')
  await capture('tag-menu-zoom-dark','Tag actions remain reachable at 150% app zoom')
  await page.keyboard.press('Escape'); await windowSize(1280,800)
  await theme('light')
  await last.scrollIntoViewIfNeeded(); await last.click({button:'right'})
  await capture('tag-menu-light','Shared tag menu in the light theme')
  await page.keyboard.press('Escape')
  report.checks.tagTreeKeyboardEdgesAndZoom = true
  await theme('dark')
  await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click()
  await openNote('Arbeitsnotiz')
  const editor = page.locator('.note-body-editor .cm-content').first()
  const marker = 'Der gemeinsame Tagdialog schützt auch diesen Entwurf.'
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n'+marker)
  await page.keyboard.press('Control+w')
  await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await capture('tag-shared-draft-guard-dark','Shared choice dialog protects a dirty note; Enter on Cancel preserves its draft')
  await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0)
  await expect(editor).toContainText(marker)
  await page.keyboard.press('Control+w')
  const savedDraft = page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await dialog.getByRole('button',{name:'Speichern',exact:true}).focus(); await page.keyboard.press('Enter')
  assert.equal((await savedDraft).status(),200)
  await expect(page.locator('.tab-open').filter({hasText:'Arbeitsnotiz'})).toHaveCount(0)
  assert.ok(fs.readFileSync(notePath,'utf8').includes(marker))
  await openNote('Arbeitsnotiz')
  report.checks.tagSharedDialogCancelAndSavePreserveDraft = true
}


async function verifyGraph() {
  await request('/tag-groups/add-group',{groupId:'ux-graph',displayName:'UX-Graph',color:'#81a1c1'})
  await request('/tag-groups/add-tag',{groupId:'ux-graph',tagId:'thema',displayName:'UX-Graph Thema'})
  const alphaPath = await createNote('UX-Graph Alpha','[[UX-Graph Beta]]\n\n{tag:ux-graph/thema}\n')
  await createNote('UX-Graph Beta','[[UX-Graph Alpha]]\n')
  await request('/graph-index/rebuild',{})
  // Establish the externally seeded graph before UI filtering; a late fixture
  // refresh otherwise reapplies its saved filters during the pointer measurement.
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await page.locator('.activity-rail').getByRole('button',{name:'Graph',exact:true}).click()
  await expect.poll(async()=>Number.parseInt(await page.locator('.graph-sidebar-metrics span').first().innerText())).toBeGreaterThan(0)
  await page.getByRole('button',{name:'Graph oeffnen',exact:true}).click()
  await page.locator('.graph-sidebar-search-input').fill('UX-Graph')
  const canvas = page.getByRole('group',{name:'Wissensgraph',exact:true})
  const menu = page.getByRole('menu',{name:/^Knotenaktionen:/})
  // Read the installed renderer's positions only to locate genuine canvas hit targets.
  const state = () => canvas.evaluate(host=>{
    const cy=host._cyreg?.cy
    return cy ? {nodes:cy.nodes().map(node=>({id:node.id(),label:node.data('label'),type:node.data('type'),point:node.renderedPosition()})),zoom:cy.zoom(),pan:cy.pan()} : null
  })
  await expect(canvas).toBeVisible()
  await expect.poll(async()=>(await state())?.nodes.length).toBe(3)
  await expect.poll(async()=>canvas.evaluate(async host=>{
    const cy=host._cyreg?.cy, nodes=cy?.nodes()
    if(!nodes?.length)return Infinity
    const before=nodes.map(node=>node.renderedPosition())
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    return Math.max(...nodes.map((node,i)=>Math.hypot(node.renderedPosition().x-before[i].x,node.renderedPosition().y-before[i].y)))
  })).toBeLessThan(1)

  await canvas.focus(); await page.keyboard.press('Home')
  const first = (await state()).nodes[0]
  await expect(page.locator('.graph-keyboard-hint')).toContainText(first.label)
  await page.keyboard.press('End')
  await expect(page.locator('.graph-keyboard-hint')).toContainText((await state()).nodes.at(-1).label)
  await page.keyboard.press('ArrowRight'); await expect(page.locator('.graph-keyboard-hint')).toContainText(first.label)
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await capture('graph-keyboard-menu-dark','Canvas node selection with Home/End/arrows and Shift+F10 opens the shared node menu')
  await page.keyboard.press('Escape'); await expect(canvas).toBeFocused()
  report.checks.graphKeyboardSelectionAndEscape = true

  let snapshot=await state()
  const alpha=snapshot.nodes.find(node=>node.label==='UX-Graph Alpha')
  await canvas.click({button:'right',position:alpha.point})
  await expect(menu).toHaveAttribute('aria-label','Knotenaktionen: UX-Graph Alpha')
  await expect(menu.getByRole('menuitem',{name:'Im Editor oeffnen',exact:true})).not.toHaveAttribute('aria-disabled','true')
  const bounds=await canvas.boundingBox(), menuBounds=await menu.boundingBox()
  const pointerViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
  const expectedX=Math.max(8,Math.min(bounds.x+alpha.point.x,pointerViewport.width-menuBounds.width-8))
  const expectedY=Math.max(8,Math.min(bounds.y+alpha.point.y,pointerViewport.height-menuBounds.height-8))
  assert.ok(Math.abs(menuBounds.x-expectedX)<=3 && Math.abs(menuBounds.y-expectedY)<=3,'Canvas menu must use window coordinates with the shared viewport clamping')
  report.checks.graphPointerAnchorMeasurement={clientX:bounds.x+alpha.point.x,clientY:bounds.y+alpha.point.y,menuX:menuBounds.x,menuY:menuBounds.y,canvasX:bounds.x,canvasY:bounds.y}
  await capture('graph-pointer-menu-dark','Actual canvas right-click: node menu uses client coordinates beyond sidebar and toolbar offsets')
  await page.keyboard.press('Escape')

  // Pan and zoom through real pointer input, not renderer mutations.
  const box=await canvas.boundingBox()
  const beforePointer=await state()
  await page.mouse.move(box.x+box.width-10,box.y+box.height-10)
  await page.mouse.down(); await page.mouse.move(box.x+box.width-40,box.y+box.height-30,{steps:6}); await page.mouse.up()
  await expect.poll(async()=>{const current=await state();return Math.hypot(beforePointer.pan.x-current.pan.x,beforePointer.pan.y-current.pan.y)}).toBeGreaterThan(10)
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.wheel(0,-80)
  await expect.poll(async()=>Math.abs(beforePointer.zoom-(await state()).zoom)).toBeGreaterThan(.001)
  const beforeSelect = await state()
  await canvas.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ContextMenu')
  await capture('graph-pan-zoom-menu-dark','Canvas node menu after genuine pan/zoom; selecting a node preserves the viewport')
  const afterSelect=await state()
  assert.ok(Math.abs(beforeSelect.zoom-afterSelect.zoom)<.02,'Selecting a node must not refit or reset graph zoom')
  assert.ok(Math.hypot(beforeSelect.pan.x-afterSelect.pan.x,beforeSelect.pan.y-afterSelect.pan.y)<3,'Selecting a node must not reset pan')
  report.checks.graphViewportMeasurement={before:{zoom:beforeSelect.zoom,pan:beforeSelect.pan},after:{zoom:afterSelect.zoom,pan:afterSelect.pan}}
  await page.keyboard.press('Escape')
  report.checks.graphPointerClientCoordinatesAndViewport = true

  // Select the tag with genuine keyboard navigation; its file actions stay disabled.
  snapshot=await state()
  const tagIndex=snapshot.nodes.findIndex(node=>node.type==='tag')
  await page.keyboard.press('Home')
  for(let i=0;i<tagIndex;i++)await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+F10')
  const reveal=menu.getByRole('menuitem',{name:'Im Explorer anzeigen',exact:true})
  const open=menu.getByRole('menuitem',{name:'Im Editor oeffnen',exact:true})
  await expect(reveal).toHaveAttribute('aria-disabled','true'); await expect(open).toHaveAttribute('aria-disabled','true')
  await open.focus(); await page.keyboard.press('Enter'); await expect(menu).toBeVisible()
  await page.keyboard.press('Space'); await expect(menu).toBeVisible()
  await capture('graph-tag-disabled-dark','Tag node actions: highlight remains available; file reveal/open cannot activate')
  await page.keyboard.press('Home'); await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0); await expect(canvas).toBeFocused()
  report.checks.graphTagDisabledActionsAndHighlight = true

  const search=page.locator('.graph-sidebar-search-input')
  await page.keyboard.press('Shift+F10'); await search.click()
  await expect(menu).toHaveCount(0); await expect(search).toBeFocused()
  await search.fill('__keine_graph_treffer__')
  await expect.poll(async()=>(await state())?.nodes.length).toBe(0)
  await canvas.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+F10')
  await expect(menu).toHaveCount(0)
  await expect(page.locator('.graph-keyboard-hint')).toContainText('Kein Knoten')
  await search.fill('UX-Graph'); await expect.poll(async()=>(await state())?.nodes.length).toBe(3)
  report.checks.graphOutsideFocusAndEmptyFilter = true

  // All four window corners exercise the real Cytoscape cxttap adapter. Coordinates only are synthetic.
  report.checks.graphMenuCorners={}
  for(const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    await canvas.evaluate((host,corner)=>{
      const cy=host._cyreg.cy,node=cy.nodes().filter(node=>node.data('label')==='UX-Graph Alpha')[0]
      const x=corner.endsWith('right')?innerWidth-2:2,y=corner.startsWith('bottom')?innerHeight-2:2
      node.emit({type:'cxttap',originalEvent:new MouseEvent('contextmenu',{clientX:x,clientY:y}),renderedPosition:node.renderedPosition()})
    },corner)
    await expect(menu).toHaveAttribute('aria-label','Knotenaktionen: UX-Graph Alpha')
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight})), rect=await menu.boundingBox()
    assert.ok(Math.abs(rect.x-(corner.endsWith('right')?viewport.width-rect.width-8:8))<2,'Graph client X must match the requested corner')
    assert.ok(Math.abs(rect.y-(corner.startsWith('bottom')?viewport.height-rect.height-8:8))<2,'Graph client Y must match the requested corner')
    await capture(`graph-edge-${corner}-dark`,`Cytoscape node handler with synthetic ${corner} client coordinates`)
    await page.keyboard.press('Escape'); await expect(canvas).toBeFocused()
    report.checks.graphMenuCorners[corner]=true
  }
  await windowSize(1280,800,1.5)
  await canvas.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+F10')
  await capture('graph-app-zoom-dark','Shared graph node menu at 150% app zoom')
  await page.keyboard.press('Escape'); await windowSize(1280,800)
  await theme('light')
  await canvas.focus(); await page.keyboard.press('Shift+F10')
  await capture('graph-menu-light','Shared graph node menu in the light theme')
  await page.keyboard.press('Escape')
  await theme('dark')

  // Open and reveal the actual file through the existing domain actions.
  snapshot=await state()
  const alphaIndex=snapshot.nodes.findIndex(node=>node.label==='UX-Graph Alpha')
  await canvas.focus(); await page.keyboard.press('Home')
  for(let i=0;i<alphaIndex;i++)await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+F10')
  await menu.getByRole('menuitem',{name:'Im Editor oeffnen',exact:true}).click()
  await expect(page.locator('.note-title-input').first()).toHaveValue('UX-Graph Alpha')
  await page.locator('.tab-open').filter({hasText:'Graph'}).first().click()
  await expect(canvas).toBeVisible(); await canvas.focus(); await page.keyboard.press('Home')
  const afterOpen=(await state()).nodes.findIndex(node=>node.label==='UX-Graph Alpha')
  for(let i=0;i<afterOpen;i++)await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+F10')
  await menu.getByRole('menuitem',{name:'Im Explorer anzeigen',exact:true}).click()
  const revealed=page.locator('.explorer-row').filter({hasText:path.basename(alphaPath,'.md')}).first()
  await expect(revealed).toBeVisible(); await expect(revealed).toHaveClass(/selected/)
  assert.ok(fs.existsSync(alphaPath))
  report.checks.graphOpenAndRevealExistingFile = true
  await openNote('Arbeitsnotiz')
}


async function verifyEditorMenus() {
  await request('/tag-groups/add-group',{groupId:'ux-editor',displayName:'Editorprüfung',color:'#81a1c1'})
  const editorPath=await createNote('Editor Menüprobe','Auswahlwort\n\n| Kopf A | Kopf B |\n| --- | --- |\n| A | B |\n| C | D |\n\nNach der Tabelle.\n')
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await openNote('Editor Menüprobe')
  const editor=page.locator('.note-body-editor .cm-content').first()
  const selectionMenu=page.getByRole('menu',{name:'Auswahlaktionen',exact:true})
  const tableMenu=page.getByRole('menu',{name:'Tabellenaktionen',exact:true})
  const dialog=page.locator('.tag-action-modal')
  const read=()=>editor.evaluate(node=>{const view=node.cmTile.root.view;return {doc:view.state.doc.toString(),from:view.state.selection.main.from,to:view.state.selection.main.to,head:view.state.selection.main.head}})
  await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End')
  const selected=await read()
  assert.equal(selected.doc.slice(selected.from,selected.to),'Auswahlwort')
  await page.keyboard.press('Shift+F10'); await expect(selectionMenu.getByRole('menuitem')).toBeFocused()
  assert.deepEqual(await read(),selected)
  await capture('editor-selection-keyboard-dark','Selection menu opens from CodeMirror without changing the selected range or document')
  await page.keyboard.press('Escape'); await expect(editor).toBeFocused(); assert.deepEqual(await read(),selected)
  await page.keyboard.type('Probe'); assert.ok((await read()).doc.startsWith('Probe'))
  await page.keyboard.press('Control+z'); await expect.poll(read).toEqual(selected)
  report.checks.editorSelectionEscapeAndTypingPreserved=true

  await page.keyboard.press('ContextMenu'); await expect(selectionMenu.getByRole('menuitem')).toBeFocused(); await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).focus(); await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0); await expect(editor).toBeFocused(); assert.deepEqual(await read(),selected)
  await editor.locator('.cm-line').first().click({button:'right',position:{x:20,y:10}})
  await expect(selectionMenu).toBeVisible(); await selectionMenu.getByRole('menuitem').click()
  await dialog.locator('#tag-group-select').selectOption('ux-editor')
  await dialog.locator('#tag-id').fill('auswahl-test')
  await dialog.locator('#tag-display-name').fill('Auswahltest')
  await capture('editor-selection-tag-dialog-dark','Existing tag dialog receives the preserved selection; submission creates and inserts the tag')
  const tagSaved=page.waitForResponse(res=>res.url().endsWith('/tag-groups/add-tag')&&res.request().method()==='POST')
  await page.keyboard.press('Enter'); assert.equal((await tagSaved).status(),200)
  await expect(dialog).toHaveCount(0)
  await expect.poll(async()=>(await read()).doc.startsWith('{tag:ux-editor/auswahl-test}')).toBe(true)
  await page.keyboard.press('Control+z'); await expect.poll(async()=>(await read()).doc).toBe(selected.doc)
  await page.keyboard.press('Control+y'); await expect.poll(async()=>(await read()).doc).toContain('{tag:ux-editor/auswahl-test}')
  report.checks.editorTagReplacementAndUndoRedo=true

  const table=editor.locator('.cm-md-table-widget').first()
  await table.locator('.cm-md-table-cell-value').first().focus(); await page.keyboard.press('Shift+F10')
  await expect(tableMenu.getByRole('menuitem',{name:'Zeile loeschen',exact:true})).toHaveAttribute('aria-disabled','true')
  const beforeHeader=await read()
  await tableMenu.getByRole('menuitem',{name:'Zeile loeschen',exact:true}).focus(); await page.keyboard.press('Enter')
  await expect(tableMenu).toBeVisible(); assert.deepEqual(await read(),beforeHeader)
  await page.keyboard.press('Escape')
  await table.locator('tbody .cm-md-table-cell-value').first().click()
  const input=table.locator('textarea:not([hidden])')
  await input.fill('Zellentext bleibt erhalten')
  const beforeCellMenu=await read()
  const inputSelection=await input.evaluate(node=>({start:node.selectionStart,end:node.selectionEnd}))
  await page.keyboard.press('Shift+F10')
  await capture('editor-table-draft-menu-dark','Table menu keeps an uncommitted cell draft; its blur does not replace the widget')
  assert.deepEqual(await read(),beforeCellMenu)
  await page.keyboard.press('Escape'); await expect(input).toBeFocused(); await expect(input).toHaveValue('Zellentext bleibt erhalten')
  assert.deepEqual(await input.evaluate(node=>({start:node.selectionStart,end:node.selectionEnd})),inputSelection)
  const saved=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await page.keyboard.press('Control+s'); assert.equal((await saved).status(),200)
  assert.ok(fs.readFileSync(editorPath,'utf8').includes('Zellentext bleibt erhalten'))
  report.checks.editorTableDraftEscapeAndSave200=true

  await table.locator('tbody .cm-md-table-cell-value').first().click()
  await input.fill('Zellentext bleibt erhalten + Außenklick')
  await page.keyboard.press('Shift+F10'); await expect(tableMenu.getByRole('menuitem').first()).toBeFocused()
  const outside=page.locator('.explorer-search-input').first()
  await outside.click(); await expect(tableMenu).toHaveCount(0); await expect(outside).toBeFocused()
  assert.ok((await read()).doc.includes('Zellentext bleibt erhalten + Außenklick'))
  const outsideSave=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await page.keyboard.press('Control+s'); assert.equal((await outsideSave).status(),200)
  assert.ok(fs.readFileSync(editorPath,'utf8').includes('Zellentext bleibt erhalten + Außenklick'))
  report.checks.editorTableOutsideDismissPreservesDraft=true

  await table.locator('tbody .cm-md-table-cell-value').first().focus(); await page.keyboard.press('Shift+F10')
  await tableMenu.getByRole('menuitem',{name:'Zeile darunter einfuegen',exact:true}).click()
  await expect(table.locator('tbody tr')).toHaveCount(3); await expect(editor).toBeFocused()
  await page.keyboard.press('Control+z'); await expect(table.locator('tbody tr')).toHaveCount(2)
  assert.ok((await read()).doc.includes('Zellentext bleibt erhalten'))
  await page.keyboard.press('Control+y'); await expect(table.locator('tbody tr')).toHaveCount(3)
  await table.locator('tbody .cm-md-table-cell-value').first().focus(); await page.keyboard.press('Shift+F10')
  await tableMenu.getByRole('menuitem',{name:'Spalte loeschen',exact:true}).click()
  await expect(table.locator('thead th')).toHaveCount(1)
  await table.locator('.cm-md-table-cell-value').first().focus(); await page.keyboard.press('Shift+F10')
  await expect(tableMenu.getByRole('menuitem',{name:'Spalte loeschen',exact:true})).toHaveAttribute('aria-disabled','true')
  await page.keyboard.press('Escape'); await editor.focus(); await page.keyboard.press('Control+z')
  await expect(table.locator('thead th')).toHaveCount(2); await expect(table.locator('tbody tr')).toHaveCount(3)
  await page.keyboard.press('Control+z'); await expect(table.locator('tbody tr')).toHaveCount(2)
  report.checks.editorTableStructureIndependentUndoRedo=true

  report.checks.editorTableCorners={}
  for(const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    await table.locator('tbody .cm-md-table-cell-value').first().evaluate((node,corner)=>{
      node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:corner.endsWith('right')?innerWidth-2:2,clientY:corner.startsWith('bottom')?innerHeight-2:2}))
    },corner)
    await expect(tableMenu).toBeVisible()
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight})), rect=await tableMenu.boundingBox()
    assert.ok(Math.abs(rect.x-(corner.endsWith('right')?viewport.width-rect.width-8:8))<2)
    assert.ok(Math.abs(rect.y-(corner.startsWith('bottom')?viewport.height-rect.height-8:8))<2)
    await capture(`editor-table-edge-${corner}-dark`,`Actual table-cell handler with explicitly synthetic ${corner} pointer coordinates`)
    await page.keyboard.press('Escape')
    report.checks.editorTableCorners[corner]=true
  }
  await windowSize(1280,800,1.5)
  await table.locator('tbody .cm-md-table-cell-value').first().focus(); await page.keyboard.press('Shift+F10')
  await capture('editor-table-zoom-dark','Shared table menu at 150% app zoom')
  await page.keyboard.press('Escape'); await windowSize(1280,800)
  await theme('light')
  await table.locator('tbody .cm-md-table-cell-value').first().click({button:'right'})
  await capture('editor-table-menu-light','Shared table menu in the light theme')
  await page.keyboard.press('Escape'); await theme('dark')

  const fixtureUrl='/@fs/'+path.join(root,'scripts/fixtures/editor-menu.tsx').replaceAll('\\','/')
  const dispose=await page.evaluateHandle(async url=>(await import(url)).mountEditorMenuFixture(),fixtureUrl)
  try {
    const fixture=page.getByTestId('editor-menu-fixture')
    const cell=fixture.locator('.cm-md-table-cell-value').first()
    await cell.focus(); await page.keyboard.press('Shift+F10')
    await expect(tableMenu.getByRole('menuitem')).toHaveCount(6)
    for(const item of await tableMenu.getByRole('menuitem').all())await expect(item).toHaveAttribute('aria-disabled','true')
    await page.keyboard.press('Enter'); await expect(tableMenu).toBeVisible()
    await capture('editor-table-readonly-fixture','Standalone real editor component: read-only table actions stay disabled')
    // Programmatic prop change while the menu owns focus verifies widget destruction cleanup.
    await fixture.getByRole('button',{name:'Schreibschutz wechseln',exact:true}).evaluate(button=>button.click())
    await expect(tableMenu).toHaveCount(0)
    const fixtureEditor=fixture.locator('.cm-content')
    await fixtureEditor.focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End')
    await page.keyboard.press('Shift+F10'); await selectionMenu.getByRole('menuitem').click()
    await fixture.getByRole('button',{name:'Dokument extern ersetzen',exact:true}).click()
    await expect(fixtureEditor).toContainText('Extern ersetzter Text.')
    await fixture.getByRole('button',{name:'Verspätete Auswahl übernehmen',exact:true}).click()
    await expect(fixture.getByTestId('late-selection-result')).toHaveText('false')
    await expect(fixtureEditor).not.toContainText('{tag:test/alt}')
    report.checks.editorReadonlyAndStaleReplacementProtected=true
  } finally {await dispose.evaluate(dispose=>dispose()); await dispose.dispose()}
  await openNote('Arbeitsnotiz')
}


async function verifySidebarMenus() {
  // Two genuine disposable NoteBases; only the recent-list seed is installed directly.
  const other = await request('/notebase/create', {parentPath:scratch, name:'UX-Zweite-NoteBase'})
  const otherPath = path.resolve(other.noteBasePath)
  assert.equal(otherPath, path.join(scratch, 'UX-Zweite-NoteBase'))
  await request('/notebase/open', {path:vaultPath})
  await request('/tag-groups/add-group', {groupId:'ux-sort-a', displayName:'A Sortierprobe', color:'#81a1c1'})
  await request('/tag-groups/add-group', {groupId:'ux-sort-z', displayName:'Z Sortierprobe', color:'#81a1c1'})
  await request('/tag-groups/add-tag', {groupId:'ux-sort-a', tagId:'alpha', displayName:'Alpha'})
  await request('/tag-groups/add-tag', {groupId:'ux-sort-a', tagId:'zulu', displayName:'Zulu'})
  await page.evaluate(paths => localStorage.setItem('nicknotes-recent-notebases', JSON.stringify(paths)), [vaultPath,otherPath])
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await openNote('Arbeitsnotiz')
  const sort = page.getByRole('button', {name:'Notizen sortieren',exact:true})
  const sortMenu = page.getByRole('menu', {name:'Notizen sortieren',exact:true})
  const radio = name => sortMenu.getByRole('menuitemradio', {name,exact:true})
  await sort.focus(); await page.keyboard.press('ArrowDown')
  await expect(radio('Manuell')).toBeFocused()
  await page.keyboard.press('ArrowUp'); await expect(sortMenu.getByRole('menuitem', {name:'Aktualisieren',exact:true})).toBeFocused()
  await page.keyboard.press('Home'); await page.keyboard.press('n'); await expect(radio('Name')).toBeFocused()
  await page.keyboard.press('Enter'); await expect(sortMenu).toHaveCount(0); await expect(sort).toBeFocused()
  await page.keyboard.press('Space'); await expect(radio('Name')).toHaveAttribute('aria-checked','true')
  await page.keyboard.press('End'); await page.keyboard.press('ArrowUp'); await expect(radio('Absteigend')).toBeFocused()
  await page.keyboard.press('Space'); await expect(sort).toBeFocused()
  const researchNames = () => page.locator('.explorer-row[data-node-id^="file:"] .row-name').allTextContents().then(names => names.filter(name => name.startsWith('Recherche-')))
  await expect.poll(async () => (await researchNames())[0]).toBe('Recherche-60')
  await sort.click(); await expect(radio('Absteigend')).toHaveAttribute('aria-checked','true')
  await expect(sortMenu.locator('[aria-checked="true"]')).toHaveCount(2)
  await capture('notes-sort-radio-dark','Named sort groups show independent checked mode and direction; keyboard navigation spans both')
  await radio('Aufsteigend').click(); await expect.poll(async () => (await researchNames())[0]).toBe('Recherche-01')
  await sort.click(); await expect(sortMenu).toBeVisible(); await sort.click(); await expect(sortMenu).toHaveCount(0)
  await sort.focus(); await page.keyboard.press('Shift+F10'); await expect(sortMenu).toBeVisible()
  await page.keyboard.press('Escape'); await expect(sort).toBeFocused()
  await page.keyboard.press('ContextMenu'); await expect(sortMenu).toBeVisible()
  await page.keyboard.press('Tab'); await expect(sortMenu).toHaveCount(0)
  assert.equal(await page.evaluate(() => document.activeElement === document.body),false)
  const search=page.locator('.explorer-search-input')
  await sort.click(); await search.click({position:{x:(await search.boundingBox()).width-8,y:10}})
  await expect(sortMenu).toHaveCount(0); await expect(search).toBeFocused()
  report.checks.sidebarSortRadioKeyboardToggleAndOrder=true

  await page.locator('.activity-rail').getByRole('button',{name:'Tagging',exact:true}).click()
  const tagSort=page.getByRole('button',{name:'Tags sortieren',exact:true})
  const tagMenu=page.getByRole('menu',{name:'Tags sortieren',exact:true})
  await tagSort.focus(); await page.keyboard.press('ArrowUp')
  await expect(tagMenu.getByRole('menuitemradio').last()).toBeFocused()
  await page.keyboard.press('End'); await page.keyboard.press('Enter')
  const groupIds=()=>page.locator('.tag-group-row').evaluateAll(rows=>rows.map(row=>row.dataset.tagGroup))
  await expect.poll(async () => (await groupIds()).filter(id=>id.startsWith('ux-sort-'))).toEqual(['ux-sort-z','ux-sort-a'])
  await expect(page.locator('.tag-entry-row[data-tag-group="ux-sort-a"] .row-name')).toHaveText(['Zulu','Alpha'])
  await tagSort.click(); await expect(tagMenu.getByRole('menuitemradio').last()).toHaveAttribute('aria-checked','true')
  await capture('tags-sort-radio-dark','Tag sorting changes both groups and entries; checked direction remains explicit')
  await tagMenu.getByRole('menuitemradio').first().click()
  await expect.poll(async () => (await groupIds()).filter(id=>id.startsWith('ux-sort-'))).toEqual(['ux-sort-a','ux-sort-z'])
  await expect(page.locator('.tag-entry-row[data-tag-group="ux-sort-a"] .row-name')).toHaveText(['Alpha','Zulu'])
  report.checks.sidebarTagSortOrder=true

  await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click()
  const editor=page.locator('.note-body-editor .cm-content').first()
  const marker='Sidebar-Menüs erhalten diesen Entwurf.'
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n'+marker)
  await page.locator('.activity-rail').getByRole('button',{name:'NoteBase',exact:true}).click()
  const activeButton=page.getByRole('button',{name:'Aktionen für NoteBase UX-NoteBase',exact:true})
  const activeMenu=page.getByRole('menu',{name:'Aktionen für NoteBase UX-NoteBase',exact:true})
  const recentButton=page.getByRole('button',{name:'Aktionen für NoteBase UX-Zweite-NoteBase',exact:true})
  const recentMenu=page.getByRole('menu',{name:'Aktionen für NoteBase UX-Zweite-NoteBase',exact:true})
  await activeButton.hover(); await expect(activeMenu).toHaveCount(0)
  await activeButton.focus(); await expect(activeMenu).toHaveCount(0)
  await page.keyboard.press('Enter'); await expect(activeMenu.getByRole('menuitem').first()).toBeFocused()
  await capture('notebase-active-menu-dark','Explicit active NoteBase menu names its target and exposes existing confirmed actions')
  await activeMenu.getByRole('menuitem',{name:'NoteBase umbenennen',exact:true}).click()
  const dialog=page.locator('.tag-action-modal')
  await expect(dialog.getByRole('heading',{name:'NoteBase umbenennen',exact:true})).toBeVisible()
  await capture('notebase-rename-dialog-dark','Existing NoteBase rename dialog receives focus from the shared menu')
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click(); await expect(activeButton).toBeFocused()
  const deletes=report.requests.filter(req=>req.endpoint==='/notebase/delete').length
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await expect(dialog.getByRole('heading',{name:'NoteBase loeschen',exact:true})).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await capture('notebase-delete-cancel-dark','Destructive NoteBase action still starts on cancel in the existing confirmation dialog')
  await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); await expect(activeButton).toBeFocused()
  assert.equal(report.requests.filter(req=>req.endpoint==='/notebase/delete').length,deletes)
  assert.ok(fs.existsSync(notePath)); await expect(editor).toContainText(marker)
  report.checks.sidebarNoteBaseDialogCancelPreservesDraft=true

  await recentButton.click(); await expect(activeMenu).toHaveCount(0)
  await capture('notebase-recent-menu-dark','Recent NoteBase includes open and remove-from-list, distinct from deleting files')
  await recentMenu.getByRole('menuitem',{name:'NoteBase umbenennen',exact:true}).click()
  await expect(dialog.getByRole('textbox')).toHaveValue('UX-Zweite-NoteBase')
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click(); await expect(recentButton).toBeFocused()
  const switches=report.requests.filter(req=>req.endpoint==='/notebase/open/start').length
  await recentButton.click(); await recentMenu.getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
  await expect(dialog.getByRole('heading',{name:'Ungespeicherte Aenderungen',exact:true})).toBeVisible()
  await expect(dialog.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); await expect(recentButton).toBeFocused()
  assert.equal(report.requests.filter(req=>req.endpoint==='/notebase/open/start').length,switches)
  await expect(editor).toContainText(marker)
  await page.keyboard.press('Control+s'); await expect.poll(()=>fs.readFileSync(notePath,'utf8')).toContain(marker)
  report.checks.sidebarNoteBaseSwitchCancelPreservesDraft=true

  await recentButton.click(); await recentMenu.getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
  // Sort preferences are pending UI settings even after saving the note itself.
  await expect(dialog.getByRole('heading',{name:'Ungespeicherte Aenderungen',exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'Speichern',exact:true}).click()
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-Zweite-NoteBase')
  await activeButton.click(); await activeMenu.getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-NoteBase')
  await recentButton.click(); await recentMenu.getByRole('menuitem',{name:'Aus Liste entfernen',exact:true}).click()
  await expect(recentButton).toHaveCount(0); await expect(page.locator('.notebase-sidebar-shell')).toBeFocused()
  assert.ok(fs.existsSync(path.join(otherPath,'.system','config.json')))
  const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('nicknotes-recent-notebases')||'[]'))
  assert.equal(history.some(entry=>(typeof entry==='string'?entry:entry.path)===otherPath),false)
  report.checks.sidebarNoteBaseOpenAndRemoveHistoryOnly=true

  report.checks.sidebarMenuCorners={}
  for (const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    await activeButton.evaluate((button,corner)=>button.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,
      clientX:corner.endsWith('right')?innerWidth-2:2,clientY:corner.startsWith('bottom')?innerHeight-2:2})),corner)
    await expect(activeMenu).toBeVisible()
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight})), rect=await activeMenu.boundingBox()
    assert.ok(Math.abs(rect.x-(corner.endsWith('right')?viewport.width-rect.width-8:8))<2)
    assert.ok(Math.abs(rect.y-(corner.startsWith('bottom')?viewport.height-rect.height-8:8))<2)
    await capture(`notebase-menu-edge-${corner}-dark`,`Actual menu-button handler with explicitly synthetic ${corner} client coordinates`)
    await page.keyboard.press('Escape'); await expect(activeButton).toBeFocused()
    report.checks.sidebarMenuCorners[corner]=true
  }
  await windowSize(1280,800,1.5); await activeButton.click()
  await capture('notebase-menu-zoom-dark','Explicit NoteBase menu at 150% app zoom')
  await page.keyboard.press('Escape'); await windowSize(1280,800)
  await theme('light'); await activeButton.click()
  await capture('notebase-menu-light','Shared NoteBase actions in the light theme')
  await page.keyboard.press('Escape'); await theme('dark')
  await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click()
  await openNote('Arbeitsnotiz'); await expect(editor).toContainText(marker)
  await sort.click(); await expect(radio('Name')).toHaveAttribute('aria-checked','true')
  await expect(radio('Aufsteigend')).toHaveAttribute('aria-checked','true'); await page.keyboard.press('Escape')
  report.checks.sidebarSortPreferenceSurvivesNoteBaseReopen=true
}

async function verifySuggestionMenus() {
  await request('/tag-groups/add-group',{groupId:'ux-vorschlag',displayName:'Vorschlagsprüfung',color:'#81a1c1'})
  await request('/tag-groups/add-tag',{groupId:'ux-vorschlag',tagId:'synthese',displayName:'Synthese'})
  await request('/tag-groups/add-tag',{groupId:'ux-vorschlag',tagId:'verwerfenprobe',displayName:'Verwerfenprobe'})
  await page.reload(); await expect(page.locator('.activity-rail')).toBeVisible()
  await openNote('Arbeitsnotiz')
  await page.keyboard.press('Alt+q')
  const editor=page.locator('.capture-markdown-editor .cm-content')
  const text='Vorher Synthese nachher Verwerfenprobe.'
  const menu=page.getByRole('menu',{name:'Tagvorschlag: Synthese',exact:true})
  const read=()=>editor.evaluate(node=>{
    const view=node.cmTile.root.view, selection=view.state.selection.main
    return {doc:view.state.doc.toString(),from:selection.from,to:selection.to}
  })
  const atWord=async(targetEditor,offset=9)=>{
    await targetEditor.focus(); await page.keyboard.press('Control+Home')
    for(let index=0;index<offset;index++)await page.keyboard.press('ArrowRight')
  }
  await expect(editor).toBeFocused()
  const initialPreview=page.waitForResponse(res=>res.url().endsWith('/capture/preview')&&res.request().postDataJSON()?.text===text)
  await page.keyboard.press('Control+a'); await page.keyboard.type(text)
  const response=await initialPreview
  assert.equal(response.status(),200,JSON.stringify(await response.json()))
  const mark=editor.locator('.cm-capture-tag-suggestion').filter({hasText:/^Synthese$/})
  await expect(mark).toHaveCount(1)
  await expect(editor).toHaveAttribute('aria-description',/Shift\+F10/)
  await expect(editor).toBeFocused()
  const beforeHover=await read()
  await mark.hover(); await expect(menu).toBeVisible(); await expect(editor).toBeFocused()
  assert.deepEqual(await read(),beforeHover)
  await menu.getByRole('menuitem',{name:'Übernehmen',exact:true}).hover()
  // Deliberately exceed the hover bridge duration; pointer entry must cancel it.
  await page.waitForTimeout(240)
  await expect(menu).toBeVisible(); await expect(editor).toBeFocused()
  await capture('suggestion-hover-dark','Real capture preview after the hover bridge: editor focus and selection remain unchanged')
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(editor).toBeFocused()
  await atWord(editor)
  const beforeKeyboard=await read()
  await page.keyboard.press('Shift+F10'); await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End'); await expect(menu.getByRole('menuitem',{name:'Verwerfen',exact:true})).toBeFocused()
  await capture('suggestion-keyboard-dark','Shift+F10 at the suggestion gives action focus; text and cursor remain in CodeMirror')
  await expect(menu.getByRole('menuitem',{name:'Verwerfen',exact:true})).toBeFocused()
  await page.keyboard.press('Escape'); await expect(editor).toBeFocused(); assert.deepEqual(await read(),beforeKeyboard)
  await page.keyboard.press('ContextMenu'); await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Tab'); await expect(menu).toHaveCount(0)
  assert.equal(await page.evaluate(()=>document.activeElement===document.body),false)
  await atWord(editor); await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible(); await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click()
  await expect(menu).toHaveCount(0)
  assert.equal((await read()).doc,text)
  report.checks.suggestionHoverKeyboardAndDismissPreserveText=true

  await atWord(editor); await mark.click({button:'right'})
  await expect(menu.getByRole('menuitem').first()).toBeFocused(); await page.keyboard.press('Enter')
  const inserted='Vorher {tag:ux-vorschlag/synthese} nachher Verwerfenprobe.'
  await expect.poll(async()=>(await read()).doc).toBe(inserted)
  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+z'); assert.equal((await read()).doc,text)
  const preview=page.waitForResponse(res=>res.url().endsWith('/capture/preview')&&res.request().postDataJSON()?.text===inserted)
  await page.keyboard.press('Control+y'); assert.equal((await read()).doc,inserted)
  assert.equal((await preview).status(),200)
  // A preview response invalidates old menu snapshots when React applies it.
  // Headers alone do not mean its body and editor decorations have committed.
  await (await preview).finished()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await expect(editor.locator('.cm-capture-tag-suggestion').filter({hasText:/^synthese$/i})).toHaveCount(0)
  const rejectedMark=editor.locator('.cm-capture-tag-suggestion').filter({hasText:/^Verwerfenprobe$/})
  await expect(rejectedMark).toHaveCount(1)
  await rejectedMark.click({button:'right'})
  const rejectedMenu=page.getByRole('menu',{name:'Tagvorschlag: Verwerfenprobe',exact:true})
  await expect(rejectedMenu).toBeVisible()
  await rejectedMenu.getByRole('menuitem',{name:'Verwerfen',exact:true}).click()
  await expect(rejectedMark).toHaveCount(0); assert.equal((await read()).doc,inserted)
  await expect(editor).toBeFocused()
  const finalText=inserted+' Capture-Prüfung.'
  const refresh=page.waitForResponse(res=>res.url().endsWith('/capture/preview')&&res.request().postDataJSON()?.text===finalText)
  await page.keyboard.press('Control+End'); await page.keyboard.type(' Capture-Prüfung.')
  assert.equal((await refresh).status(),200)
  await expect(rejectedMark).toHaveCount(0)
  const save=page.waitForResponse(res=>res.url().endsWith('/capture/save')&&res.request().method()==='POST')
  await page.getByRole('button',{name:'Senden',exact:true}).click(); assert.equal((await save).status(),200)
  await expect.poll(async()=>(await read()).doc).toBe('')
  const dailyRoot=path.join(vaultPath,'daily')
  const saved=fs.readdirSync(dailyRoot,{recursive:true}).filter(file=>file.endsWith('.md')).map(file=>fs.readFileSync(path.join(dailyRoot,file),'utf8'))
  assert.ok(saved.some(content=>content.includes(finalText)),'Accepted tag and rejected plain word must reach daily Markdown')
  report.checks.suggestionAcceptUndoRejectAndCaptureSave200=true

  const fixtureUrl='/@fs/'+path.join(root,'scripts/fixtures/tag-suggestion.tsx').replaceAll('\\','/')
  const dispose=await page.evaluateHandle(async url=>(await import(url)).mountTagSuggestionFixture(),fixtureUrl)
  try {
    const fixture=page.getByTestId('tag-suggestion-fixture'), field=fixture.locator('.cm-content')
    await expect(field).toBeVisible()
    await atWord(field); await page.keyboard.press('Shift+F10'); await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await fixture.getByRole('button',{name:'Vorschläge erneuern',exact:true}).evaluate(button=>button.click())
    await expect(menu).toHaveCount(0); await expect(field).toBeFocused()
    await expect(fixture.getByTestId('suggestion-actions')).toHaveText('0/0')
    await atWord(field); await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible()
    await fixture.getByRole('button',{name:'Schreibschutz wechseln',exact:true}).evaluate(button=>button.click())
    await expect(menu).toHaveCount(0); await expect(field).toBeFocused()
    await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible()
    for(const item of await menu.getByRole('menuitem').all())await expect(item).toHaveAttribute('aria-disabled','true')
    await page.keyboard.press('Enter'); await page.keyboard.press('End'); await page.keyboard.press('Space')
    await expect(fixture.getByTestId('suggestion-actions')).toHaveText('0/0')
    await capture('suggestion-readonly-fixture','Real editor component with read-only props: both actions are disabled and cannot mutate')
    await page.keyboard.press('Escape')
    await fixture.getByRole('button',{name:'Schreibschutz wechseln',exact:true}).click()
    report.checks.suggestionNewPreviewAndReadonlyProtected=true

    report.checks.suggestionFixtureCorners={}
    for(const corner of ['top-left','top-right','bottom-left','bottom-right']) {
      // Synthetic fixture placement; real cursor coordinates and keyboard opening.
      await fixture.evaluate((node,corner)=>{
        const host=node.parentElement
        Object.assign(host.style,{inset:'auto',width:'300px',height:'190px',boxSizing:'border-box',
          left:corner.endsWith('right')?`${innerWidth-308}px`:'8px',top:corner.startsWith('bottom')?`${innerHeight-198}px`:'8px'})
      },corner)
      await atWord(field); await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible()
      const anchor=await field.evaluate(node=>node.cmTile.root.view.coordsAtPos('Vorher Synthese'.length))
      const bounds=await menu.boundingBox(), viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert.ok(Math.abs(bounds.x-Math.max(8,Math.min(anchor.left,viewport.width-bounds.width-8)))<2)
      assert.ok(Math.abs(bounds.y-Math.max(8,Math.min(anchor.bottom+8,viewport.height-bounds.height-8)))<2)
      await capture(`suggestion-fixture-${corner}`,'Synthetic fixture at '+corner+'; genuine CodeMirror cursor anchor and menu clamping')
      await page.keyboard.press('Escape'); await expect(field).toBeFocused()
      report.checks.suggestionFixtureCorners[corner]=true
    }
    await fixture.evaluate(node=>Object.assign(node.parentElement.style,{inset:'8%',width:'auto',height:'auto'}))
    await windowSize(1280,800,1.5)
    await atWord(field); await page.keyboard.press('Shift+F10')
    await capture('suggestion-zoom-dark','Shared tag suggestion actions at 150% app zoom')
    await page.keyboard.press('Escape'); await windowSize(1280,800)
    // The synthetic overlay must not cover the real settings controls.
    await fixture.evaluate(node=>{node.parentElement.style.visibility='hidden'})
    await theme('light')
    await fixture.evaluate(node=>{node.parentElement.style.visibility='visible'})
    await atWord(field); await page.keyboard.press('Shift+F10')
    await capture('suggestion-light','Shared tag suggestion actions in the light theme')
    await fixture.getByRole('button',{name:'Dokument extern ersetzen',exact:true}).evaluate(button=>button.click())
    await expect(menu).toHaveCount(0); await expect(field).toContainText('Extern ersetzter Text.')
    await expect(field).toBeFocused(); await expect(fixture.getByTestId('suggestion-actions')).toHaveText('0/0')
    report.checks.suggestionExternalReplacementProtected=true
  } finally {await dispose.evaluate(dispose=>dispose()); await dispose.dispose()}
  await theme('dark'); await openNote('Arbeitsnotiz')
}

async function verifyCreateDialogLaunch() {
  const trigger=page.getByRole('button',{name:'NoteBase erstellen',exact:true})
  const dialog=page.getByRole('dialog',{name:'Neue NoteBase erstellen',exact:true})
  const requests=()=>report.requests.filter(req=>req.endpoint==='/notebase/create').length
  const before=requests()
  await trigger.click(); await expect(dialog.getByLabel('Anrede',{exact:true})).toBeFocused()
  await expect(dialog).toHaveAttribute('aria-modal','true')
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button',{name:'NoteBase erstellen',exact:true})).toBeFocused()
  await page.keyboard.press('Tab'); await expect(dialog.getByLabel('Anrede',{exact:true})).toBeFocused()
  await dialog.getByLabel('NoteBase-Name',{exact:true}).fill('Probe mit Leerzeichen')
  await expect(dialog.getByLabel('NoteBase-Name',{exact:true})).toHaveValue('Probe mit Leerzeichen')
  await capture('create-dialog-launch-light','Accessible create dialog from the launcher: named fields, native form actions and contained focus')
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).focus(); await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused(); assert.equal(requests(),before)
  await trigger.click(); await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused()
  await trigger.click(); await page.mouse.click(4,45); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused()
  report.checks.createDialogLaunchKeyboardAndCancel=true
}

async function verifyCreateDialog() {
  const editor=page.locator('.note-body-editor .cm-content').first()
  const marker='NoteBase-Dialog schützt diesen Entwurf.'
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n'+marker)
  await page.locator('.activity-rail').getByRole('button',{name:'NoteBase',exact:true}).click()
  const trigger=page.locator('.notebase-sidebar-toolbar').getByRole('button',{name:'NoteBase erstellen',exact:true})
  const dialog=page.getByRole('dialog',{name:'Neue NoteBase erstellen',exact:true})
  const confirm=page.getByRole('dialog',{name:'Ungespeicherte Aenderungen',exact:true})
  const posts=()=>report.requests.filter(req=>req.endpoint==='/notebase/create'&&req.method==='POST').length
  const before=posts()
  await trigger.click(); await expect(dialog.getByLabel('Anrede',{exact:true})).toBeFocused()
  await expect(dialog.getByLabel('Speicherort',{exact:true})).toHaveValue(scratch)
  await dialog.getByLabel('Anrede',{exact:true}).fill('Dialog Nutzer')
  await dialog.getByLabel('NoteBase-Name',{exact:true}).fill('../Nicht erlaubt')
  await dialog.getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Pfadtrenner'); assert.equal(posts(),before)
  await dialog.getByLabel('NoteBase-Name',{exact:true}).fill('UX-Dialog-Neu')
  await capture('create-dialog-workspace-dark','Create form preserves entered values and displays validation at its source')
  await page.keyboard.press('Control+n'); await expect(dialog).toBeVisible(); assert.equal(posts(),before)
  await dialog.getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
  await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await expect(dialog).toHaveCount(0) // The underlying form is inert and hidden from the accessibility tree.
  await expect(page.locator('.create-notebase-modal')).toBeHidden()
  await expect(confirm).toBeVisible()
  await capture('create-dialog-dirty-confirm-dark','Existing save-before-switch confirmation is the only active dialog')
  await page.keyboard.press('Enter'); await expect(confirm).toHaveCount(0)
  await expect(dialog.getByLabel('Anrede',{exact:true})).toBeFocused()
  await expect(dialog.getByLabel('NoteBase-Name',{exact:true})).toHaveValue('UX-Dialog-Neu')
  await expect(editor).toContainText(marker); assert.equal(posts(),before)
  await dialog.getByRole('button',{name:'Abbrechen',exact:true}).click(); await expect(trigger).toBeFocused()
  report.checks.createDialogDirtyCancelPreservesDraft=true

  // Stub only the OS directory picker inside this disposable Electron instance.
  await app.evaluate(({dialog})=>{
    globalThis.__createDialogPickerOriginal=dialog.showOpenDialog
    globalThis.__createDialogPickerCalls=0
    dialog.showOpenDialog=()=>{globalThis.__createDialogPickerCalls++;return new Promise(resolve=>{globalThis.__createDialogPickerFinish=resolve})}
  })
  try {
    await trigger.click()
    await dialog.getByRole('button',{name:'Ordner wählen',exact:true}).focus(); await page.keyboard.press('Enter')
    await expect(dialog).toHaveAttribute('aria-busy','true')
    await page.keyboard.press('Escape'); await page.mouse.click(4,45); await expect(dialog).toBeVisible()
    await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
    assert.equal(posts(),before)
    assert.equal(await app.evaluate(()=>globalThis.__createDialogPickerCalls),1)
    await app.evaluate((_electron,path)=>globalThis.__createDialogPickerFinish({canceled:false,filePaths:[path]}),scratch)
    await expect(dialog).not.toHaveAttribute('aria-busy','true')
    await expect(dialog.getByLabel('Speicherort',{exact:true})).toHaveValue(scratch)
  } finally {
    await app.evaluate(({dialog})=>{
      dialog.showOpenDialog=globalThis.__createDialogPickerOriginal
      delete globalThis.__createDialogPickerOriginal;delete globalThis.__createDialogPickerFinish;delete globalThis.__createDialogPickerCalls
    })
  }
  report.checks.createDialogDirectoryButtonDoesNotSubmit=true

  await dialog.getByLabel('NoteBase-Name',{exact:true}).fill('CON')
  await dialog.getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button',{name:'Speichern',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText(/reserved|reserviert/i)
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await expect(editor).toContainText(marker); assert.ok(fs.readFileSync(notePath,'utf8').includes(marker))
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-NoteBase')
  await capture('create-dialog-request-error-dark','Real backend rejects a reserved name; existing NoteBase, note and form remain available')
  report.checks.createDialogRequestErrorKeepsWorkspace=true

  // Permit a genuinely narrow surface only in this disposable window. Otherwise
  // Electron silently clamps the requested size to the product's normal minimum.
  const minimum=await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0], previous=win.getMinimumSize()
    win.setMinimumSize(240,240);return previous
  })
  try {
    for(const [label,width,height,zoom] of [['zoom',1280,800,1.5],['narrow',640,500,1.5]]) {
      await windowSize(width,height,zoom)
      const rect=await dialog.boundingBox(), viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert.ok(Math.abs(viewport.width-width/zoom)<2,'Requested narrow test viewport was not applied')
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1)
      await dialog.getByLabel('Anrede',{exact:true}).focus(); await page.keyboard.press('Shift+Tab')
      const submit=dialog.getByRole('button',{name:'NoteBase erstellen',exact:true})
      await expect(submit).toBeFocused();await expect(submit).toBeInViewport()
      await capture(`create-dialog-${label}-dark`,'Create form stays inside '+label+' viewport; final action remains keyboard reachable')
    }
  } finally {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum)
    await windowSize(1280,800)
  }
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused()
  await theme('light'); await trigger.click()
  await capture('create-dialog-light','Shared create form in the light theme')
  await page.keyboard.press('Escape'); await theme('dark'); await trigger.click()
  await dialog.getByLabel('Anrede',{exact:true}).fill('Dialog Nutzer')
  await dialog.getByLabel('NoteBase-Name',{exact:true}).fill('UX-Dialog-Neu')
  await dialog.getByLabel('Speicherort',{exact:true}).fill(scratch)
  // Save any theme preferences through the existing switch confirmation first.
  // Intercept only this request to exercise the in-flight guard, then forward it unchanged.
  let release
  const gate=new Promise(resolve=>{release=resolve})
  let creates=0
  const intercept=async route=>{
    const payload=route.request().postDataJSON()
    assert.equal(path.resolve(payload.parentPath),scratch); assert.equal(payload.name,'UX-Dialog-Neu')
    creates++; await gate; await route.continue()
  }
  await page.route('**/notebase/create',intercept)
  try {
    await dialog.getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
    // Theme settings may already be saved by theme(); only an actual dialog is handled.
    await expect.poll(async()=>creates+(await confirm.count())).toBe(1)
    if(await confirm.count())await confirm.getByRole('button',{name:'Speichern',exact:true}).click()
    await expect.poll(()=>creates).toBe(1)
    await expect(dialog).toHaveAttribute('aria-busy','true')
    await page.keyboard.press('Escape'); await page.mouse.click(4,45); await expect(dialog).toBeVisible()
    await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
    assert.equal(creates,1)
    await capture('create-dialog-pending-dark','Deferred real create request locks the form and all dismissal paths; duplicate submission does not send another request')
    release()
    await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-Dialog-Neu')
    await expect(dialog).toHaveCount(0)
  } finally {release(); await page.unroute('**/notebase/create',intercept)}
  const newRoot=path.join(scratch,'UX-Dialog-Neu')
  assert.ok(fs.existsSync(path.join(newRoot,'.system','config.json')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(newRoot,'.system','ui_settings.json'),'utf8')).app.displayName,'Dialog Nutzer')
  await capture('create-dialog-created-dark','Genuine synthetic NoteBase created through the form with persisted display name')
  const recent=page.getByRole('button',{name:'Aktionen für NoteBase UX-NoteBase',exact:true})
  await recent.click()
  await page.getByRole('menu',{name:'Aktionen für NoteBase UX-NoteBase',exact:true}).getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-NoteBase')
  await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click()
  await openNote('Arbeitsnotiz'); await expect(editor).toContainText(marker)
  report.checks.createDialogSingleRequestSuccessAndSettingsPersisted=true
}

async function verifyTagMatching() {
  const originalVault=vaultPath
  const matchRoot=path.join(scratch,'UX-Tag-Matching')
  await page.keyboard.press('Control+Shift+s')
  await page.locator('.activity-rail').getByRole('button',{name:'NoteBase',exact:true}).click()
  await page.locator('.notebase-sidebar-toolbar').getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
  const create=page.getByRole('dialog',{name:'Neue NoteBase erstellen',exact:true})
  await create.getByLabel('NoteBase-Name',{exact:true}).fill('UX-Tag-Matching')
  await create.getByLabel('Speicherort',{exact:true}).fill(scratch)
  await create.getByRole('button',{name:'NoteBase erstellen',exact:true}).click()
  const confirm=page.getByRole('dialog',{name:'Ungespeicherte Aenderungen',exact:true})
  await expect.poll(async()=>await confirm.count()||+(await create.count()===0)).toBe(1)
  if(await confirm.count())await confirm.getByRole('button',{name:'Speichern',exact:true}).click()
  await expect(create).toHaveCount(0)
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-Tag-Matching')
  vaultPath=matchRoot
  try {
    await request('/tag-groups/add-group',{groupId:'ux-match',displayName:'Prüfprojekte',color:'#81a1c1'})
    await request('/tag-groups/add-tag',{groupId:'ux-match',tagId:'orionprobe',displayName:'Orionprobe'})
    await request('/tag-groups/add-tag',{groupId:'ux-match',tagId:'vektorprobe',displayName:'Vektorprobe'})
    const a=await createNote('Tag-Prüfung A','Orionprobe startet hier.\n\nOrionprobe steht erneut im Text.\n\nVektorprobe bleibt als zweite Kategorie.\n')
    const b=await createNote('Tag-Prüfung B','Eine weitere Orionprobe steht in dieser Notiz.\n')
    await page.reload();await expect(page.locator('.activity-rail')).toBeVisible()
    await theme('dark');await openNote('Tag-Prüfung A')
    await page.locator('.activity-rail').getByRole('button',{name:'Tagging',exact:true}).click()
    const trigger=page.getByRole('button',{name:'NoteBase nach Tag-Fundstellen durchsuchen',exact:true})
    const dialog=page.getByRole('dialog',{name:'Tag-Fundstellen prüfen',exact:true})
    const close=()=>dialog.getByRole('button',{name:'Tag-Prüfung schließen',exact:true})
    const retry=()=>dialog.getByRole('button',{name:'Erneut suchen',exact:true})
    const apply=()=>dialog.getByRole('button',{name:'Übernehmen',exact:true})
    const count=()=>dialog.locator('.tag-match-summary-row span').first()
    const posts=()=>report.requests.filter(req=>req.method==='POST'&&req.endpoint==='/tag-groups/apply-matches').length
    const initialA=fs.readFileSync(a,'utf8')
    let initialB=fs.readFileSync(b,'utf8')
    assert.equal((await request('/tag-groups/match-candidates')).total,4)
    const open=async()=>{await trigger.click();await expect(retry()).toBeEnabled();await expect(count()).toHaveText('Treffer 1 von 4')}

    // Hold one genuine scan response, cancel it, and open a second scan before
    // allowing the first response to arrive. No product callback is substituted.
    let releaseScan,scans=0,oldScanReady=false,oldScanFinished=false
    const scanGate=new Promise(resolve=>{releaseScan=resolve})
    const slowScan=async route=>{
      if(++scans!==1){await route.continue();return}
      const response=await route.fetch();oldScanReady=true;await scanGate
      await route.fulfill({response}).catch(()=>{}) // A canceled transport may already be disposed.
      oldScanFinished=true
    }
    await page.route('**/tag-groups/match-candidates',slowScan)
    try {
      await trigger.click();await expect(dialog).toHaveAttribute('aria-busy','true')
      await expect(dialog).toBeFocused()
      await expect.poll(()=>oldScanReady).toBe(true)
      await capture('tag-matching-loading-dark','Cancelable genuine scan; named dialog owns focus while loading')
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
      const previous=await request('/notes/content?path='+encodeURIComponent(b))
      await request('/notes/save',{path:b,content:previous.content+'\nOrionprobe als fünfte Fundstelle.\n',expectedRevision:previous.revision})
      await trigger.click();await expect(count()).toHaveText('Treffer 1 von 5')
      releaseScan();await expect.poll(()=>oldScanFinished).toBe(true);await expect(count()).toHaveText('Treffer 1 von 5')
      await expect(dialog.getByRole('alert')).toHaveCount(0)
      const current=await request('/notes/content?path='+encodeURIComponent(b))
      await request('/notes/save',{path:b,content:initialB,expectedRevision:current.revision})
      initialB=fs.readFileSync(b,'utf8') // The intentional save updates its timestamp.
    } finally {releaseScan();await page.unroute('**/tag-groups/match-candidates',slowScan)}
    await close().focus();await page.keyboard.press('Enter');await expect(trigger).toBeFocused()
    report.checks.tagMatchingCanceledScanDoesNotReplaceNewDialog=true

    const failedScan=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetischer Suchfehler',code:'ux.scan.failed'}})})
    await page.route('**/tag-groups/match-candidates',failedScan)
    try {
      await trigger.click();await expect(dialog.getByRole('alert')).toContainText('Synthetischer Suchfehler')
      await expect(dialog.getByText('Keine Fundstellen mehr offen.',{exact:true})).toHaveCount(0)
      await capture('tag-matching-search-error-dark','Scan error is distinct from an empty result and offers retry')
    } finally {await page.unroute('**/tag-groups/match-candidates',failedScan)}
    await retry().click();await expect(count()).toHaveText('Treffer 1 von 4');await expect(retry()).toBeFocused()
    const before=posts()
    await page.keyboard.press('Shift+Tab');await expect(apply()).toBeFocused()
    await page.keyboard.press('Tab');await expect(retry()).toBeFocused()
    await page.keyboard.press('ArrowRight');await expect(count()).toHaveText('Treffer 2 von 4')
    await dialog.getByRole('button',{name:'Vorherige Fundstelle',exact:true}).click()
    await expect(count()).toHaveText('Treffer 1 von 4')
    await dialog.getByRole('region',{name:'Vorher',exact:true}).focus()
    await page.keyboard.press('ArrowRight');await expect(count()).toHaveText('Treffer 1 von 4')
    await dialog.getByRole('button',{name:'Überspringen',exact:true}).click()
    await expect(count()).toHaveText('Treffer 1 von 3')
    assert.equal(posts(),before);assert.equal(fs.readFileSync(a,'utf8'),initialA);assert.equal(fs.readFileSync(b,'utf8'),initialB)
    await capture('tag-matching-preview-dark','Before/after comparison, named navigation and non-writing skip action')
    await page.keyboard.press('Control+n');await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
    await open();await page.mouse.click(4,45);await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
    report.checks.tagMatchingKeyboardSkipAndDismissPreserveFiles=true

    const editor=page.locator('.note-body-editor .cm-content').first(),marker='Dieser ungespeicherte Entwurf bleibt erhalten.'
    await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\n'+marker)
    await open();await apply().click()
    await expect(dialog.getByRole('alert')).toContainText('geöffneten geänderten Notizen')
    assert.equal(posts(),before);assert.equal(fs.readFileSync(a,'utf8'),initialA)
    await capture('tag-matching-dirty-guard-dark','Buffered editor draft blocks replacement and explains how to continue')
    await page.keyboard.press('Escape');await expect(editor).toContainText(marker)
    await page.keyboard.press('Control+s');await expect.poll(()=>fs.readFileSync(a,'utf8')).toContain(marker)
    await open()
    report.checks.tagMatchingDirtyTargetDoesNotSendApply=true

    const failedApply=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetischer Übernahmefehler',code:'ux.apply.failed'}})})
    await page.route('**/tag-groups/apply-matches',failedApply)
    try {
      await apply().click();await expect(dialog.getByRole('alert')).toContainText('Synthetischer Übernahmefehler')
      await expect(count()).toHaveText('Treffer 1 von 4');await expect(apply()).toBeEnabled()
      assert.equal(fs.readFileSync(a,'utf8').includes('{tag:ux-match/'),false)
      await capture('tag-matching-apply-error-dark','Failed mutation keeps its candidate and permits retry')
    } finally {await page.unroute('**/tag-groups/apply-matches',failedApply)}
    report.checks.tagMatchingApplyFailureRetainsCandidate=true

    let releaseApply,applies=0
    const applyGate=new Promise(resolve=>{releaseApply=resolve})
    const slowApply=async route=>{applies++;await applyGate;await route.continue()}
    await page.route('**/tag-groups/apply-matches',slowApply)
    try {
      await apply().click();await expect.poll(()=>applies).toBe(1);await expect(dialog).toHaveAttribute('aria-busy','true')
      await page.keyboard.press('Escape');await page.mouse.click(4,45);await expect(dialog).toBeVisible()
      await expect(close()).toBeDisabled();await expect(retry()).toBeDisabled()
      await expect(dialog.getByRole('button',{name:'Nächste Fundstelle',exact:true})).toBeDisabled()
      await dialog.locator('button').evaluateAll(buttons=>buttons.forEach(button=>button.click()))
      assert.equal(applies,1)
      await capture('tag-matching-pending-dark','Deferred real apply locks dismissal, navigation and mutation controls')
      releaseApply();await expect(count()).toHaveText('Treffer 1 von 3');await expect(apply()).toBeEnabled()
    } finally {releaseApply();await page.unroute('**/tag-groups/apply-matches',slowApply)}
    assert.equal((fs.readFileSync(a,'utf8').match(/\{tag:ux-match\/orionprobe\}/g)||[]).length,1)
    assert.equal(fs.readFileSync(b,'utf8'),initialB)
    report.checks.tagMatchingSingleApply200AndDoubleSubmitProtected=true

    // The previous replacement shifts later offsets in this same file. The real
    // backend rejects that stale location with applied=0, without rewriting it.
    const beforeStale=fs.readFileSync(a,'utf8')
    await apply().click();await expect(dialog.getByRole('alert')).toContainText('inzwischen geändert')
    await expect(count()).toHaveText('Treffer 1 von 3');await expect(apply()).toBeDisabled()
    assert.equal(fs.readFileSync(a,'utf8'),beforeStale)
    await capture('tag-matching-stale-dark','Real zero-apply response preserves stale candidates and requires a fresh scan')
    report.checks.tagMatchingZeroApplyIsNotReportedAsCompleted=true

    await retry().click();await expect(count()).toHaveText('Treffer 1 von 3')
    await dialog.getByRole('button',{name:'Diesen Tag überall',exact:true}).click()
    await expect(count()).toHaveText('Treffer 1 von 1');await expect(apply()).toBeEnabled()
    assert.equal((fs.readFileSync(a,'utf8').match(/\{tag:ux-match\/orionprobe\}/g)||[]).length,2)
    assert.equal((fs.readFileSync(b,'utf8').match(/\{tag:ux-match\/orionprobe\}/g)||[]).length,1)
    await retry().click();await expect(count()).toHaveText('Treffer 1 von 1')

    const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,240);return old})
    try {
      for(const [label,width,height] of [['zoom',1280,800],['narrow',640,500]]) {
        await windowSize(width,height,1.5)
        const rect=await dialog.boundingBox(),view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
        assert.ok(Math.abs(view.width-width/1.5)<2)
        assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=view.width+1&&rect.y+rect.height<=view.height+1)
        await retry().focus();await page.keyboard.press('Shift+Tab');await expect(apply()).toBeFocused();await expect(apply()).toBeInViewport()
        await capture(`tag-matching-${label}-dark`,'Comparison scrolls inside actual '+label+' viewport; final action remains reachable')
      }
    } finally {await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum);await windowSize(1280,800)}
    await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
    await theme('light');await trigger.click();await expect(count()).toHaveText('Treffer 1 von 1')
    await capture('tag-matching-light','Tag matching comparison and action labels in the light theme')
    await dialog.getByRole('button',{name:'Alle übernehmen',exact:true}).click()
    await expect(dialog.getByText('Keine Fundstellen mehr offen.',{exact:true})).toBeVisible()
    await expect(dialog.getByRole('status')).toContainText('1 Fundstelle in 1 Notiz übernommen.')
    assert.ok(fs.readFileSync(a,'utf8').includes('{tag:ux-match/vektorprobe}'))
    assert.ok(fs.readFileSync(a,'utf8').includes(marker))
    assert.equal((await request('/tag-groups/match-candidates')).total,0)
    // A real partial batch must not mark its unconfirmed candidates as done.
    const c=await createNote('Tag-Prüfung C','Orionprobe wird zuerst geprüft.\n\nOrionprobe steht auch weiter unten.\n')
    const d=await createNote('Tag-Prüfung D','Orionprobe wird außerhalb der Vorschau verschoben.\n')
    await retry().click();await expect(count()).toHaveText('Treffer 1 von 3')
    const external=await request('/notes/content?path='+encodeURIComponent(d))
    await request('/notes/save',{path:d,content:external.content.replace('Orionprobe','Vorher verschoben. Orionprobe'),expectedRevision:external.revision})
    const untouchedD=fs.readFileSync(d,'utf8')
    await dialog.getByRole('button',{name:'Diesen Tag überall',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText('Einige Fundstellen haben sich geändert')
    await expect(dialog.getByRole('status')).toContainText('2 Fundstellen in 1 Notiz übernommen.')
    await expect(count()).toHaveText('Treffer 1 von 3');await expect(apply()).toBeDisabled()
    assert.equal((fs.readFileSync(c,'utf8').match(/\{tag:ux-match\/orionprobe\}/g)||[]).length,2)
    assert.equal(fs.readFileSync(d,'utf8'),untouchedD)
    await capture('tag-matching-partial-light','Real partial batch writes two confirmed positions and retains unconfirmed candidates until rescan')
    await retry().click();await expect(count()).toHaveText('Treffer 1 von 1')
    await dialog.getByRole('button',{name:'Alle übernehmen',exact:true}).click()
    await expect(dialog.getByText('Keine Fundstellen mehr offen.',{exact:true})).toBeVisible()
    await expect(dialog.getByRole('status')).toContainText('1 Fundstelle in 1 Notiz übernommen.')
    assert.ok(fs.readFileSync(d,'utf8').includes('{tag:ux-match/orionprobe}'))
    assert.equal((await request('/tag-groups/match-candidates')).total,0)
    report.checks.tagMatchingPartialApplyRetainsUnconfirmedCandidates=true
    const graph=JSON.parse(fs.readFileSync(path.join(matchRoot,'.system','graph-index.json'),'utf8'))
    for(const file of [a,b,c,d]) {
      const entry=graph.files[path.relative(matchRoot,file).replaceAll('\\','/')]
      assert.ok(entry.tags.includes('ux-match:orionprobe'))
      assert.ok(graph.edges.some(edge=>edge.type==='tagUsage'&&edge.source===entry.id&&edge.target==='tag:ux-match/orionprobe'))
    }
    const indexed=await request('/search?tag='+encodeURIComponent('ux-match:orionprobe'))
    for(const file of [a,b,c,d])assert.ok(indexed.items.some(item=>path.resolve(item.path)===path.resolve(file)))
    const vector=await request('/search?tag='+encodeURIComponent('ux-match:vektorprobe'))
    assert.equal(vector.items.length,1);assert.equal(path.resolve(vector.items[0].path),path.resolve(a))
    await capture('tag-matching-complete-light','Real single, per-tag and all-match writes completed; index and graph refreshed')
    await dialog.getByRole('button',{name:'Fertig',exact:true}).focus();await page.keyboard.press('Enter');await expect(trigger).toBeFocused()
    report.checks.tagMatchingBatchApplyMarkdownIndexAndGraph=true
  } finally {vaultPath=originalVault}
  await page.locator('.activity-rail').getByRole('button',{name:'NoteBase',exact:true}).click()
  await page.getByRole('button',{name:'Aktionen für NoteBase UX-NoteBase',exact:true}).click()
  await page.getByRole('menu',{name:'Aktionen für NoteBase UX-NoteBase',exact:true}).getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
  await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-NoteBase')
  await theme('dark');await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click();await openNote('Arbeitsnotiz')
}

async function verifySettingsDialog() {
  const trigger=page.locator('.activity-rail').getByRole('button',{name:'Einstellungen',exact:true})
  const dialog=page.getByRole('dialog',{name:'Einstellungen',exact:true})
  const confirm=page.getByRole('dialog',{name:'Ungespeicherte Einstellungen',exact:true})
  const nav=()=>dialog.getByRole('navigation',{name:'Einstellungsbereiche',exact:true})
  const section=name=>nav().getByRole('button',{name,exact:true})
  const name=()=>dialog.getByLabel('Anrede',{exact:true})
  const save=()=>dialog.getByRole('button',{name:'Speichern',exact:true})
  const discard=()=>dialog.getByRole('button',{name:'Verwerfen',exact:true})
  const close=()=>dialog.getByRole('button',{name:'Einstellungen schliessen',exact:true})
  const fullSave=route=>route.request().method()==='POST'&&Object.hasOwn(route.request().postDataJSON()?.app??{},'displayName')
  const settingsFile=path.join(vaultPath,'.system','ui_settings.json')
  const saved=()=>JSON.parse(fs.readFileSync(settingsFile,'utf8')).app
  const open=async()=>{await trigger.click();await expect(name()).toBeFocused()}
  await open()
  if(await save().isEnabled()){await save().click();await expect(close()).toBeEnabled()}
  const originalName=await name().inputValue()
  const originalTheme=saved().activeThemeId
  await capture('settings-dialog-general-dark','Shared focus lifecycle and accessible setting fields in the existing settings dialog')
  await section('Allgemein').focus();await page.keyboard.press('End')
  await expect(section('Tasks')).toBeFocused();await expect(section('Tasks')).toHaveAttribute('aria-current','page')
  await page.keyboard.press('Home');await expect(section('Allgemein')).toBeFocused()
  await page.keyboard.press('ArrowDown');await expect(section('Darstellung')).toBeFocused()
  await page.keyboard.press('ArrowUp');await expect(section('Allgemein')).toBeFocused()
  await name().fill('Ada mit Leerzeichen');await expect(name()).toHaveValue('Ada mit Leerzeichen')
  await section('Allgemein').focus();await page.keyboard.press('Shift+Tab');await expect(save()).toBeFocused()
  await page.keyboard.press('Tab');await expect(section('Allgemein')).toBeFocused()
  await page.keyboard.press('Control+n');await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape');await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await expect(page.locator('.settings-modal')).toBeHidden();await expect(dialog).toHaveCount(0)
  await capture('settings-dialog-close-confirm-dark','Only the existing save/discard/cancel confirmation is visible and active')
  await page.keyboard.press('Control+s');assert.equal(saved().displayName,originalName)
  await page.keyboard.press('Enter');await expect(name()).toHaveValue('Ada mit Leerzeichen');await expect(name()).toBeFocused()
  await close().click();await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'Abbrechen',exact:true}).click()
  await page.mouse.click(4,45);await expect(confirm.getByRole('button',{name:'Abbrechen',exact:true})).toBeFocused()
  await confirm.getByRole('button',{name:'Verwerfen',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
  assert.equal(saved().displayName,originalName)
  await open();await expect(name()).toHaveValue(originalName)
  await name().fill('Wird verworfen');await discard().click();await expect(name()).toHaveValue(originalName);await expect(save()).toBeDisabled()
  await expect(section('Allgemein')).toBeFocused()
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
  await open();await close().focus();await page.keyboard.press('Enter');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
  await open();await page.keyboard.press('Control+s');await expect(name()).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
  await open();await page.mouse.click(4,45);await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
  report.checks.settingsDialogKeyboardDirtyCancelDiscardAndFocus=true

  await open();await name().fill('Fehler-Entwurf')
  const failed=async route=>{
    if(!fullSave(route)){await route.continue();return}
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetischer Einstellungsfehler',code:'ux.settings.failed'}})})
  }
  await page.route('**/ui-settings',failed)
  try {
    await save().click();await expect(dialog.getByRole('alert')).toContainText('Synthetischer Einstellungsfehler')
    await expect(name()).toHaveValue('Fehler-Entwurf');await expect(save()).toBeEnabled()
    assert.equal(saved().displayName,originalName)
    await capture('settings-dialog-save-error-dark','Failed real save path retains draft, shows an inline error and enables retry')
    await close().click();await confirm.getByRole('button',{name:'Speichern',exact:true}).click()
    await expect(dialog).toBeVisible();await expect(dialog.getByRole('alert')).toContainText('Synthetischer Einstellungsfehler')
    await expect(name()).toHaveValue('Fehler-Entwurf');assert.equal(saved().displayName,originalName)
  } finally {await page.unroute('**/ui-settings',failed)}
  report.checks.settingsDialogFailedSaveKeepsDraftAndDialog=true

  await name().fill('Ada gespeichert')
  let release,saves=0
  const gate=new Promise(resolve=>{release=resolve})
  const slow=async route=>{
    if(!fullSave(route)){await route.continue();return}
    saves++;assert.equal(route.request().postDataJSON().app.displayName,'Ada gespeichert')
    await gate;await route.continue()
  }
  await page.route('**/ui-settings',slow)
  try {
    await name().focus();await page.keyboard.press('Control+s');await expect.poll(()=>saves).toBe(1)
    await expect(dialog).toHaveAttribute('aria-busy','true');await expect(name()).toBeDisabled();await expect(close()).toBeDisabled()
    await page.keyboard.press('Escape');await page.mouse.click(4,45);await expect(dialog).toBeVisible();await expect(confirm).toHaveCount(0)
    await page.keyboard.press('Control+s');await page.keyboard.press('Control+s')
    await dialog.locator('button').evaluateAll(buttons=>buttons.forEach(button=>button.click()))
    assert.equal(saves,1);assert.equal(saved().displayName,originalName)
    await capture('settings-dialog-pending-dark','Deferred genuine save locks settings and dismissal; repeated shortcuts do not write again')
    release();await expect(name()).toBeEnabled();await expect(save()).toBeDisabled()
    await expect.poll(()=>saved().displayName).toBe('Ada gespeichert')
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(saves,1)
  } finally {release();await page.unroute('**/ui-settings',slow)}
  report.checks.settingsDialogSingleSaveAcrossQueuedShortcuts=true

  await name().fill('Über den Abschluss gespeichert');await close().click()
  await confirm.getByRole('button',{name:'Speichern',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused()
  assert.equal(saved().displayName,'Über den Abschluss gespeichert')
  await open();await name().fill(originalName);await save().click();await expect(close()).toBeEnabled()
  await section('Import').click()
  await app.evaluate(({dialog})=>{
    globalThis.__settingsPickerOriginal=dialog.showOpenDialog
    globalThis.__settingsPickerCalls=0
    dialog.showOpenDialog=()=>{globalThis.__settingsPickerCalls++;return new Promise(resolve=>{globalThis.__settingsPickerFinish=resolve})}
  })
  try {
    const picker=dialog.getByRole('button',{name:'Dateien waehlen',exact:true})
    await picker.focus();await page.keyboard.press('Enter');await expect(dialog).toHaveAttribute('aria-busy','true')
    await expect(close()).toBeDisabled();await page.keyboard.press('Escape');await page.mouse.click(4,45)
    await expect(dialog).toBeVisible();await expect(confirm).toHaveCount(0)
    assert.equal(await app.evaluate(()=>globalThis.__settingsPickerCalls),1)
    await expect(dialog.getByRole('status')).toContainText('Dateiauswahl ist geöffnet')
    await expect(dialog.locator('.launch-progress')).toHaveCount(0)
    await capture('settings-dialog-import-picker-dark','Only the isolated OS picker is stubbed; settings remain locked until it returns')
    await app.evaluate(()=>globalThis.__settingsPickerFinish({canceled:true,filePaths:[]}))
    await expect(close()).toBeEnabled();await expect(dialog.getByRole('button',{name:'Import starten',exact:true})).toBeDisabled()
  } finally {
    await app.evaluate(({dialog})=>{
      dialog.showOpenDialog=globalThis.__settingsPickerOriginal
      delete globalThis.__settingsPickerOriginal;delete globalThis.__settingsPickerFinish;delete globalThis.__settingsPickerCalls
    })
  }
  report.checks.settingsDialogPickerWaitBlocksDismissal=true
  await section('Darstellung').click();await dialog.getByRole('button',{name:'Neues Theme',exact:true}).click()
  const customId=await dialog.getByRole('combobox',{name:'Theme',exact:true}).inputValue()
  const profileName=dialog.getByLabel('Theme-Name',{exact:true})
  await profileName.fill('Tastatur Theme');await page.keyboard.press('Control+s')
  await expect(close()).toBeEnabled();await expect(save()).toBeDisabled()
  assert.equal(saved().themes.find(profile=>profile.id===saved().activeThemeId).name,'Tastatur Theme')
  const textColor=dialog.getByLabel('Text als Farbwert',{exact:true})
  await textColor.fill('#dcece2');await page.keyboard.press('Control+s')
  await expect(close()).toBeEnabled();await expect(save()).toBeDisabled()
  assert.equal(saved().themes.find(profile=>profile.id===saved().activeThemeId).colors.text,'#dcece2')
  await capture('settings-dialog-theme-keyboard-dark','Ctrl+S commits the still-focused theme name and colour through existing blur handlers')
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
  await page.reload();await expect(trigger).toBeVisible();await open();await section('Darstellung').click()
  await expect(profileName).toHaveValue('Tastatur Theme');await expect(textColor).toHaveValue('#dcece2')
  report.checks.settingsDialogThemeDraftShortcutAndReload=true

  const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,240);return old})
  try {
    for(const [label,width,height] of [['zoom',1280,800],['narrow',640,500]]) {
      await windowSize(width,height,1.5)
      const rect=await dialog.boundingBox(),view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert.ok(Math.abs(view.width-width/1.5)<2)
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=view.width+1&&rect.y+rect.height<=view.height+1)
      await section('Allgemein').focus();await page.keyboard.press('Shift+Tab')
      const focused=page.locator(':focus');await expect(focused).toHaveAttribute('aria-label',/als Farbwert$/);await expect(focused).toBeInViewport()
      await section('Allgemein').click();await name().fill('Viewport-Entwurf')
      await section('Allgemein').focus();await page.keyboard.press('Shift+Tab');await expect(save()).toBeFocused();await expect(save()).toBeInViewport()
      await capture(`settings-dialog-${label}-dark`,'Settings remain within actual '+label+' viewport; final enabled action reachable by keyboard')
      await discard().click();await expect(section('Allgemein')).toBeFocused();await expect(section('Allgemein')).toBeInViewport();await section('Darstellung').click()
    }
  } finally {await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum);await windowSize(1280,800)}
  await dialog.getByRole('combobox',{name:'Theme',exact:true}).selectOption(customId)
  // Delete only the test profile by its active custom identity, then restore the original theme.
  await dialog.getByRole('button',{name:'Theme loeschen',exact:true}).click()
  await dialog.getByRole('combobox',{name:'Theme',exact:true}).selectOption(originalTheme)
  await save().click();await expect(close()).toBeEnabled()
  await page.keyboard.press('Escape');await theme('light');await open()
  await capture('settings-dialog-light','General settings, live save status and area navigation in the light theme')
  await page.keyboard.press('Escape');await theme('dark')
  await openNote('Arbeitsnotiz')
}

async function verifyFilters() {
  await request('/tag-groups/add-group',{groupId:'ux-filter',displayName:'Filterprojekte',color:'#81a1c1'})
  await request('/tag-groups/add-group',{groupId:'ux-filter-zweit',displayName:'Zweite Filtergruppe',color:'#a3be8c'})
  await request('/tag-groups/add-tag',{groupId:'ux-filter-zweit',tagId:'zweites',displayName:'Zweites Tag'})
  const definitionsPath=path.join(vaultPath,'.system','tag_groups.json')
  const definitions=JSON.parse(fs.readFileSync(definitionsPath,'utf8'))
  definitions.groups.find(group=>group.id==='ux-filter').tags=Array.from({length:26},(_,i)=>({id:`tag-${String(i).padStart(2,'0')}`,displayName:`Lange Filteroption ${String(i).padStart(2,'0')} mit ausreichend Beschreibung zum Umbruch im kleinen Fenster`}))
  fs.writeFileSync(definitionsPath,JSON.stringify(definitions,null,2))
  const fixture=[]
  for(const [title,status,priority,tag] of [['Filtertask Offen','open','high','ux-filter/tag-00'],['Filtertask Erledigt','done','low','ux-filter/tag-25'],['Filtertask Wartet','on_hold','medium','ux-filter-zweit/zweites']]) {
    const file=await createNote(title,`Synthetische Filterprobe {tag:${tag}}.\n`,'task')
    const source=await request('/notes/content?path='+encodeURIComponent(file))
    await request('/notes/save',{path:file,content:source.content.replace(/^status:.*$/m,`status: ${status}`).replace(/^priority:.*$/m,`priority: ${priority}`),expectedRevision:source.revision})
    fixture.push(file)
  }
  fixture.push(await createNote('Filtertodo Quelle','- [ ] Filtertodo offen {tag:ux-filter/tag-00}\n- [x] Filtertodo fertig {tag:ux-filter/tag-25}\n'))
  await request('/notebase/reindex',{})
  await page.reload();await expect(page.locator('.activity-rail')).toBeVisible();await openNote('Arbeitsnotiz')
  const editor=page.locator('.note-body-editor .cm-content').first(),marker='Filterbedienung erhält diesen Entwurf.'
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\n'+marker)
  const snapshots=new Map([...fixture,notePath].map(file=>[file,fs.readFileSync(file,'utf8')]))
  const writes=()=>report.requests.filter(req=>req.method==='POST'&&(req.endpoint==='/notes/save'||req.endpoint==='/note-groups/add-note')).length
  const before=writes()
  const popup=label=>page.getByRole('dialog',{name:label,exact:true})
  const trigger=label=>page.locator('.left-sidebar').getByRole('button',{name:new RegExp('^'+label+':')})
  const opened=page.locator('.nn-filter-popover:popover-open')
  const taskLabel='Tasks: Status',taskPopup=popup(taskLabel),taskTrigger=trigger(taskLabel)
  const taskShell=page.locator('.todo-explorer-shell')
  const resetTasks=async()=>{await taskShell.getByRole('button',{name:'Alle Filter zuruecksetzen',exact:true}).click();await taskShell.getByLabel('Tasks durchsuchen',{exact:true}).fill('Filtertask')}
  const titles=()=>page.locator('.task-canvas .task-title-with-tags').allTextContents().then(items=>items.map(text=>text.trim()).sort())
  await page.locator('.activity-rail').getByRole('button',{name:'Tasks',exact:true}).click()
  await taskShell.locator('.todo-open-dashboard-button').click();await resetTasks()
  await expect.poll(titles).toEqual(['Filtertask Erledigt','Filtertask Offen','Filtertask Wartet'])
  await taskTrigger.focus();await page.keyboard.press('Enter')
  const search=taskPopup.getByRole('searchbox',{name:taskLabel+' durchsuchen',exact:true})
  await expect(search).toBeFocused();await expect(taskTrigger).toHaveAttribute('aria-expanded','true')
  await search.fill('open');await page.keyboard.press('ArrowDown');await expect(taskPopup.getByRole('checkbox',{name:'Open',exact:true})).toBeFocused()
  await page.keyboard.press('Space');await expect(taskPopup).toBeVisible();await expect.poll(titles).toEqual(['Filtertask Offen'])
  await page.keyboard.press('Enter');await expect(taskPopup.getByRole('checkbox',{name:'Open',exact:true})).not.toBeChecked()
  await expect.poll(titles).toEqual(['Filtertask Erledigt','Filtertask Offen','Filtertask Wartet'])
  await page.keyboard.press('Space');await search.fill('done');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
  await expect(taskPopup.getByRole('checkbox',{name:'Done',exact:true})).toBeChecked()
  await expect.poll(titles).toEqual(['Filtertask Erledigt','Filtertask Offen'])
  await capture('filter-task-multiple-dark','Native checkbox selection stays open for keyboard and pointer; dashboard reflects both selected statuses')
  await page.keyboard.press('Control+n');await page.keyboard.press('Control+s');assert.equal(writes(),before)
  await page.keyboard.press('Escape');await expect(taskPopup).toHaveCount(0);await expect(taskTrigger).toBeFocused()
  await taskTrigger.click();await expect(search).toHaveValue('');await expect(taskPopup.getByRole('checkbox',{name:'Open',exact:true})).toBeChecked()
  await search.fill('keine passende suchoption');await expect(taskPopup.getByText('Keine passenden Optionen.',{exact:true})).toBeVisible()
  await capture('filter-search-empty-dark','Search has its own empty state without clearing the selected filter values')
  await taskPopup.getByRole('button',{name:'Suche leeren',exact:true}).focus();await page.keyboard.press('Enter');await expect(search).toHaveValue('');await expect(search).toBeFocused()
  await taskPopup.getByRole('button',{name:'Fertig',exact:true}).focus();await page.keyboard.press('Tab')
  const priorityTrigger=trigger('Tasks: Priorität'),priorityPopup=popup('Tasks: Priorität')
  await expect(taskPopup).toHaveCount(0);await expect(priorityTrigger).toBeFocused()
  await page.keyboard.press('ArrowUp');await expect(priorityPopup.getByRole('checkbox').last()).toBeFocused()
  await page.keyboard.press('Space');await expect(priorityPopup.getByRole('checkbox',{name:'High',exact:true})).toBeChecked();await expect.poll(titles).toEqual(['Filtertask Offen'])
  await page.keyboard.press('Home');await expect(priorityPopup.getByRole('checkbox').first()).toBeFocused()
  await page.keyboard.press('End');await expect(priorityPopup.getByRole('checkbox').last()).toBeFocused()
  await page.keyboard.press('Escape');await expect(priorityTrigger).toBeFocused();await resetTasks()
  report.checks.filtersKeyboardMultipleSelectionAndRealHits=true

  await priorityTrigger.click();await taskTrigger.click();await expect(opened).toHaveCount(1);await expect(taskPopup).toBeVisible()
  await taskShell.getByLabel('Tasks durchsuchen',{exact:true}).focus();await expect(opened).toHaveCount(0)
  await taskTrigger.click();await expect(search).toBeFocused();await taskTrigger.click();await expect(opened).toHaveCount(0);await expect(taskTrigger).toHaveAttribute('aria-expanded','false')
  await taskTrigger.dblclick();await expect(opened).toHaveCount(0);await expect(taskTrigger).toHaveAttribute('aria-expanded','false')
  await taskTrigger.click();await taskShell.getByLabel('Tasks durchsuchen',{exact:true}).click();await expect(opened).toHaveCount(0)
  report.checks.filtersNativeToggleExclusivityAndOutsideFocus=true

  const tagsLabel='Tasks: Tags',tagsPopup=popup(tagsLabel),tagsTrigger=trigger(tagsLabel)
  await tagsTrigger.click();await tagsPopup.getByRole('searchbox').fill('lange filteroption')
  await expect(tagsPopup.getByRole('checkbox')).toHaveCount(26)
  await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await expect(tagsPopup.getByRole('checkbox').last()).toBeFocused()
  await page.keyboard.press('Space');await expect.poll(titles).toEqual(['Filtertask Erledigt'])
  await capture('filter-long-options-dark','Long tag labels wrap and the last real option can be selected without sidebar clipping')
  await page.keyboard.press('Escape');await expect(tagsTrigger).toBeFocused()
  await trigger('Tasks: Tag-Gruppe').click();const groups=popup('Tasks: Tag-Gruppe')
  await groups.getByRole('checkbox',{name:'Zweite Filtergruppe',exact:true}).check();await page.keyboard.press('Escape')
  await expect(tagsTrigger).toHaveAccessibleName('Tasks: Tags: Alle')
  await expect.poll(titles).toEqual(['Filtertask Wartet'])
  await tagsTrigger.click();await expect(tagsPopup.getByRole('checkbox')).toHaveCount(1)
  await expect(tagsPopup.getByRole('checkbox',{name:'Zweites Tag',exact:true})).not.toBeChecked()
  await page.keyboard.press('Escape');await resetTasks()
  await trigger('Tasks: Verknüpfungen').click();await expect(popup('Tasks: Verknüpfungen').getByText('Keine Optionen verfügbar.',{exact:true})).toBeVisible()
  await capture('filter-no-options-dark','An empty source is distinguishable from a search without matches')
  await page.keyboard.press('Escape')
  report.checks.filtersGroupChangePrunesUnavailableTags=true

  await taskTrigger.click();await page.locator('.activity-rail').getByRole('button',{name:'Todos',exact:true}).click()
  await expect(opened).toHaveCount(0)
  const todoShell=page.locator('.todo-explorer-shell')
  await todoShell.locator('.todo-open-dashboard-button').click()
  await todoShell.getByRole('button',{name:'Alle Filter zuruecksetzen',exact:true}).click();await todoShell.getByLabel('Todos durchsuchen',{exact:true}).fill('Filtertodo')
  await expect(page.locator('.todo-canvas-line')).toHaveCount(2)
  const todoLabel='To-dos: Status',todoPopup=popup(todoLabel),todoTrigger=trigger(todoLabel)
  await todoTrigger.click();await todoPopup.getByRole('checkbox',{name:'Done',exact:true}).check()
  await expect(page.locator('.todo-canvas-line')).toHaveCount(1);await expect(page.locator('.todo-canvas-line-text')).toContainText('Filtertodo fertig')
  await todoPopup.getByRole('checkbox',{name:'Open',exact:true}).focus();await page.keyboard.press('Enter')
  await expect(page.locator('.todo-canvas-line')).toHaveCount(2)
  await capture('filter-todo-multiple-dark','The same component filters checkbox to-dos with matching pointer and keyboard behavior')
  await page.keyboard.press('Escape');await expect(todoTrigger).toBeFocused()
  await todoShell.getByRole('button',{name:'Alle Filter zuruecksetzen',exact:true}).click()
  for(const [file,content] of snapshots)assert.equal(fs.readFileSync(file,'utf8'),content)
  assert.equal(writes(),before)
  report.checks.filtersDoNotWriteMarkdownOrLoseEditorDraft=true

  await page.locator('.activity-rail').getByRole('button',{name:'Tasks',exact:true}).click();await taskShell.locator('.todo-open-dashboard-button').click();await resetTasks()
  const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,200);return old})
  try {
    for(const [label,width,height] of [['zoom',1280,800],['narrow',640,500],['short',640,240]]) {
      await windowSize(width,height,1.5)
      await tagsTrigger.click();await tagsPopup.getByRole('searchbox').fill('lange filteroption')
      await page.keyboard.press('ArrowDown');await page.keyboard.press('End')
      await expect(tagsPopup.getByRole('checkbox').last()).toBeFocused();await expect(tagsPopup.getByRole('checkbox').last()).toBeInViewport()
      const rect=await tagsPopup.boundingBox(),view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=view.width+1&&rect.y+rect.height<=view.height+1)
      report.checks.filtersViewports ??= {}
      report.checks.filtersViewports[label]={surface:rect,viewport:view,lastOptionReachable:true}
      await capture(`filter-${label}-dark`,'Native top-layer filter fits '+label+' viewport; long final option remains reachable')
      await page.keyboard.press('Escape');await expect(tagsTrigger).toBeFocused()
      await tagsTrigger.click();await expect(tagsPopup.getByRole('searchbox')).toBeFocused();await expect(tagsPopup.getByRole('searchbox')).toBeInViewport()
      await page.keyboard.press('Escape')
    }
  } finally {await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum);await windowSize(1280,800)}
  report.checks.filtersViewportAndReopenFocus=true
  await theme('light');await taskTrigger.click();await expect(taskPopup.getByRole('searchbox')).toBeFocused()
  await capture('filter-light','Shared filter surface in the light theme')
  await page.keyboard.press('Escape');await resetTasks();await theme('dark')
  await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click();await openNote('Arbeitsnotiz')
  await expect(editor).toContainText(marker)
  const response=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await page.keyboard.press('Control+s');assert.equal((await response).status(),200)
  assert.ok(fs.readFileSync(notePath,'utf8').includes(marker))
  report.checks.filtersDraftSavedAfterExplicitSave=true
}

async function verifyProperties() {
  const oldSettings=(await request('/ui-settings')).settings
  await request('/ui-settings',{app:{...oldSettings.app,taskFeatureSettings:{advancedTaskHandling:true,taskTimeManagement:true}}})
  await request('/tag-groups/add-group',{groupId:'ux-properties',displayName:'Eigenschaften',color:'#81a1c1'})
  for(let i=0;i<6;i++)await request('/tag-groups/add-tag',{groupId:'ux-properties',tagId:'tag-'+i,displayName:`Eigenschaftsauswahl ${i} mit langem Namen für einen kontrollierten Zeilenumbruch`})
  const target=await createNote('Eigenschaftsziel','Ziel einer manuellen Verknüpfung.\n')
  let task=await createNote('Eigenschaftstask','Automatischer Bezug bleibt im Body: {tag:ux-properties/tag-5}.\n')
  const source=await request('/notes/content?path='+encodeURIComponent(task))
  await request('/notes/save',{path:task,content:source.content.replace(/^type:.*$/m,'type: task'),expectedRevision:source.revision})
  await page.reload();await expect(page.locator('.activity-rail')).toBeVisible();await openNote('Eigenschaftstask')
  const panel=page.getByRole('region',{name:'Notizeigenschaften',exact:true}).first()
  const initial=fs.readFileSync(task,'utf8')
  const saved=()=>parseYaml(fs.readFileSync(task,'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)[1])
  const writes=()=>report.requests.filter(req=>req.method==='POST'&&req.endpoint==='/notes/save').length
  const save=async()=>{
    const response=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
    await page.keyboard.press('Control+s');const result=await response;assert.equal(result.status(),200);task=(await result.json()).path||task
  }
  const tagsButton=panel.getByRole('button',{name:'Tags bearbeiten',exact:true}),tagsPopup=page.getByRole('dialog',{name:'Tags bearbeiten',exact:true})
  await expect(panel.getByRole('button',{name:'Task',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(panel.getByLabel('Status',{exact:true})).toHaveValue('open')
  await expect(panel.getByLabel('Priorität',{exact:true})).toBeVisible()
  await tagsButton.focus();await page.keyboard.press('Enter');await expect(tagsPopup.getByRole('searchbox')).toBeFocused()
  await tagsPopup.getByRole('searchbox').fill('unbestätigte suche');await capture('properties-tag-search-dark','Named shared picker: searching and dismissal do not add a tag')
  await page.keyboard.press('Escape');await expect(tagsButton).toBeFocused();assert.equal(fs.readFileSync(task,'utf8'),initial)
  await expect(panel.locator('.property-chip.manual')).toHaveCount(0)
  await tagsButton.click();await tagsPopup.getByRole('searchbox').fill('Eigenschaftsauswahl')
  await expect(tagsPopup.getByRole('checkbox')).toHaveCount(6)
  await tagsPopup.getByRole('checkbox').first().focus();await page.keyboard.press('Space');await expect(tagsPopup).toBeVisible()
  await page.keyboard.press('Enter');await expect(tagsPopup.getByRole('checkbox').first()).not.toBeChecked()
  await page.keyboard.press('Space');await expect(tagsPopup.getByRole('checkbox').first()).toBeChecked()
  await tagsPopup.getByRole('searchbox').fill(':');await tagsPopup.locator('.nn-picker-add-value').click()
  await expect(tagsPopup.getByRole('alert')).toContainText('ungültig');await capture('properties-invalid-value-dark','Invalid free tag remains visible with an inline alert and no file write')
  await tagsPopup.getByRole('button',{name:'Suche leeren',exact:true}).click();await expect(tagsPopup.getByRole('alert')).toHaveCount(0)
  await tagsPopup.getByRole('searchbox').fill('ux-properties:freier-wert');await tagsPopup.locator('.nn-picker-add-value').click()
  await expect(tagsPopup.getByRole('searchbox')).toHaveValue('');await page.keyboard.press('Escape')
  await expect(panel.getByRole('button',{name:'Tag ux-properties:tag-0 entfernen',exact:true})).toBeVisible()
  await expect(panel.getByRole('button',{name:'Tag ux-properties:freier-wert entfernen',exact:true})).toBeVisible()
  const linksButton=panel.getByRole('button',{name:'Verknüpfungen bearbeiten',exact:true}),linksPopup=page.getByRole('dialog',{name:'Verknüpfungen bearbeiten',exact:true})
  await linksButton.click();await linksPopup.getByRole('searchbox').fill('Eigenschaftsziel');await linksPopup.getByRole('checkbox',{name:'Eigenschaftsziel',exact:true}).check()
  await capture('properties-related-dark','Existing note selection changes only the document draft; real automatic tags remain separate')
  await page.keyboard.press('Escape');await expect(linksButton).toBeFocused()
  assert.equal(fs.readFileSync(task,'utf8'),initial)
  await save();assert.ok(saved().tags.includes('ux-properties:tag-0'));assert.ok(saved().tags.includes('ux-properties:freier-wert'));assert.ok(saved().related.includes('Eigenschaftsziel'))
  const graph=JSON.parse(fs.readFileSync(path.join(vaultPath,'.system','graph-index.json'),'utf8'))
  const entry=graph.files[path.relative(vaultPath,task).replaceAll('\\','/')],other=graph.files[path.relative(vaultPath,target).replaceAll('\\','/')]
  assert.ok(graph.edges.some(edge=>edge.type==='tagUsage'&&edge.source===entry.id&&edge.target==='tag:ux-properties/tag-0'))
  assert.ok(graph.edges.some(edge=>edge.source===entry.id&&edge.target===other.id))
  const indexed=await request('/search?tag='+encodeURIComponent('ux-properties:tag-0'))
  assert.ok(indexed.items.some(item=>path.resolve(item.path)===path.resolve(task)))
  report.checks.propertiesExplicitSelectionSaveIndexAndGraph=true

  const title=panel.getByLabel('Notiztitel',{exact:true})
  let releaseTitleSave, titleSaveReady=false
  const titleGate=new Promise(resolve=>releaseTitleSave=resolve)
  const holdTitle=async route=>{const result=await route.fetch();titleSaveReady=true;await titleGate;await route.fulfill({response:result})}
  await page.route('**/notes/save',holdTitle)
  try {
    const beforeTitleBlur=fs.readFileSync(task,'utf8'),renamesBefore=report.requests.filter(req=>req.method==='POST'&&req.endpoint==='/notes/rename').length
    await title.fill('Eigenschaftstask mit geändertem Titel');await title.press('Tab')
    assert.equal(fs.readFileSync(task,'utf8'),beforeTitleBlur);assert.equal(report.requests.filter(req=>req.method==='POST'&&req.endpoint==='/notes/rename').length,renamesBefore)
    await capture('properties-title-draft-dark','Leaving the edited title changes only its draft; the revision-protected save owns path normalization')
    report.checks.propertiesTitleBlurDoesNotWrite=true
    await title.focus();const pendingSave=save()
    await expect.poll(()=>titleSaveReady).toBe(true);await title.fill('Eigenschaftstask')
    releaseTitleSave();await pendingSave;await expect(title).toHaveValue('Eigenschaftstask');await expect(title).toBeFocused()
    assert.equal(saved().title,'Eigenschaftstask mit geändertem Titel')
  } finally {releaseTitleSave();await page.unroute('**/notes/save',holdTitle)}
  await save();assert.equal(saved().title,'Eigenschaftstask')
  report.checks.propertiesTitleRenameAndTypingDuringSavePreserved=true
  const waiting=panel.getByLabel('Warten auf',{exact:true}),estimate=panel.getByLabel('Schätzung in Minuten',{exact:true})
  for(const [name,value,key,expected] of [['Schätzung in Minuten','35','estimate_minutes',35],['Warten auf','Rückmeldung mit Leerzeichen','waiting_for','Rückmeldung mit Leerzeichen'],['Blockierungsgrund','Ein genauer Grund\nmit zweiter Zeile','blocked_reason','Ein genauer Grund mit zweiter Zeile'],['Nächster Schritt','Die nächste Aktion','next_action_hint','Die nächste Aktion'],['Wiedervorlagedatum','2026-12-01','follow_up_date','2026-12-01']]) {
    const field=panel.getByLabel(name,{exact:true});await field.fill(value);await save();await expect(field).toBeFocused();assert.equal(saved()[key],expected)
  }
  await estimate.fill('45');const iconSave=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  const saveButton=page.locator('.workspace-toolbar').getByRole('button',{name:'Speichern',exact:true});await expect(saveButton).toBeEnabled();await saveButton.click();assert.equal((await iconSave).status(),200);assert.equal(saved().estimate_minutes,45)
  report.checks.propertiesToolbarSaveIncludesFocusedInput=true
  await estimate.fill('0');const beforeInvalid=writes();await page.keyboard.press('Control+s')
  await expect(estimate).toHaveAttribute('aria-invalid','true');await expect(panel.getByRole('alert')).toContainText('positive Zahl')
  await capture('properties-field-error-dark','Invalid active estimate blocks save, retains input and describes the error at its field')
  assert.equal(writes(),beforeInvalid);assert.equal(saved().estimate_minutes,45)
  await page.keyboard.press('Escape');await expect(estimate).toHaveValue('45');await expect(estimate).toHaveAttribute('aria-invalid','false')
  await waiting.fill('Abzubrechender Feldentwurf');await page.keyboard.press('Escape');await expect(waiting).toHaveValue('Rückmeldung mit Leerzeichen')
  report.checks.propertiesFocusedFieldsSaveAndEscapeValidation=true

  await page.keyboard.press('Control+Shift+s');await expect(page.locator('.tab-dirty-dot')).toHaveCount(0)
  await waiting.fill('Nur vor nativem Schließen gepuffert');await expect(page.locator('.tab-dirty-dot')).toHaveCount(0)
  await page.evaluate(async()=>{window.nicknotes.setUnsavedChanges(false);await window.nicknotes.getBackendUrl()})
  await app.evaluate(({dialog})=>{
    globalThis.__propertiesDialog=dialog.showMessageBoxSync;globalThis.__propertiesClosePrompts=0
    dialog.showMessageBoxSync=()=>{globalThis.__propertiesClosePrompts++;return 2}
  })
  try {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
    await expect.poll(()=>app.evaluate(()=>globalThis.__propertiesClosePrompts)).toBe(1)
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(1)
  } finally {await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=globalThis.__propertiesDialog;delete globalThis.__propertiesDialog})}
  await expect(waiting).toHaveValue('Nur vor nativem Schließen gepuffert');assert.equal(saved().waiting_for,'Rückmeldung mit Leerzeichen')
  await waiting.focus();await save();assert.equal(saved().waiting_for,'Nur vor nativem Schließen gepuffert')
  report.checks.propertiesNativeCloseFlushAndCancel=true
  await capture('properties-fields-dark','Named task fields, retained native-close draft, wrapped tag chips and accessible actions')

  await waiting.fill('Entwurf vor dem Teilen')
  await page.keyboard.press('Control+\\');await expect(page.locator('.workspace-pane')).toHaveCount(2)
  await expect(waiting).toHaveValue('Entwurf vor dem Teilen')
  await capture('properties-split-dark','Property panel stays usable alongside the existing second editor group')
  await page.keyboard.press('Control+\\');await expect(page.locator('.workspace-pane')).toHaveCount(1)
  await expect(waiting).toHaveValue('Entwurf vor dem Teilen');await waiting.focus();await save();assert.equal(saved().waiting_for,'Entwurf vor dem Teilen')
  report.checks.propertiesSplitPreservesPendingInput=true
  const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,240);return old})
  try {
    for(const [label,width,height] of [['zoom',1280,800],['narrow',640,500]]) {
      await windowSize(width,height,1.5);await title.focus()
      await expect.poll(()=>title.evaluate(node=>node.scrollHeight<=node.clientHeight+1)).toBe(true)
      await tagsButton.evaluate(button=>button.scrollIntoView({block:'center',inline:'nearest'}));await tagsButton.click();await tagsPopup.getByRole('searchbox').fill('Eigenschaftsauswahl')
      await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await expect(tagsPopup.getByRole('checkbox').last()).toBeInViewport()
      const rect=await tagsPopup.boundingBox(),view=await page.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=view.width+1&&rect.y+rect.height<=view.height+1)
      await capture(`properties-${label}-dark`,'Shared property selection remains inside '+label+' viewport with a reachable final option')
      await page.keyboard.press('Escape');await expect(tagsButton).toBeFocused()
    }
  } finally {await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum);await windowSize(1280,800)}
  await theme('light');await linksButton.click();await expect(linksPopup.getByRole('searchbox')).toBeFocused()
  await capture('properties-light','Shared property picker and task fields in the light theme');await page.keyboard.press('Escape');await theme('dark')
  await request('/ui-settings',{app:oldSettings.app});await page.reload();await expect(page.locator('.activity-rail')).toBeVisible();await openNote('Arbeitsnotiz')
}

function searchCommand(label) {
  return page.getByRole('option').filter({has:page.getByText(label,{exact:true})})
}

async function verifySearchCommandsLaunch() {
  const trigger=page.getByRole('button',{name:'Notizen und Befehle suchen',exact:true})
  await trigger.focus();await trigger.click()
  const field=page.getByRole('combobox',{name:'Befehl suchen',exact:true})
  await expect(field).toBeFocused();await field.fill('>speichern')
  const save=searchCommand('Speichern')
  await expect(save).toHaveAttribute('aria-disabled','true');await expect(save).toContainText('Zuerst eine NoteBase öffnen.')
  // Bypass only Playwright's aria-disabled actionability check to probe the real pointer guard.
  await save.click({force:true});await expect(field).toBeFocused();await expect(field).toBeVisible()
  await capture('search-launch-disabled-light','Unified search from the launcher: disabled actions explain their context and cannot execute')
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
  await page.keyboard.press('Control+p');await expect(field).toBeFocused();await field.fill('>Tastenkürzel und Bedienung')
  await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Tastenkürzel und Bedienung',exact:true})).toBeVisible()
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
  report.checks.searchLauncherCommandsAndDisabledReason=true
}

async function verifySearchCommands() {
  await windowSize(1280,800);await theme('dark');await openNote('Arbeitsnotiz')
  const trigger=page.getByRole('button',{name:'Notizen und Befehle suchen',exact:true})
  const dialog=page.getByRole('dialog',{name:'Notizen und Befehle',exact:true})
  const noteField=page.getByRole('combobox',{name:'Notiz suchen',exact:true})
  const commandField=page.getByRole('combobox',{name:'Befehl suchen',exact:true})
  const editor=page.locator('.note-body-editor .cm-content').first()
  const before=fs.readFileSync(notePath,'utf8'),marker='Die gemeinsame Suche bewahrt diesen Entwurf.'
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\n'+marker)
  await trigger.click();await expect(noteField).toBeFocused()
  const opened=page.getByRole('group',{name:'Geöffnete Notizen',exact:true})
  await expect(opened.getByRole('option').first()).toContainText('Arbeitsnotiz')
  await capture('search-open-targets-dark','Opened note targets share the existing note search; current draft remains local')
  await page.keyboard.press('Control+p');await expect(commandField).toBeFocused();await commandField.fill('>Editorgruppe wechseln')
  await expect(searchCommand('Editorgruppe wechseln')).toHaveAttribute('aria-disabled','true')
  await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await expect(commandField).toBeFocused()
  await capture('search-disabled-context-dark','Commands come from the live catalog; single-pane mode explains the unavailable pane switch')
  await commandField.fill('>Speichern');const saveResponse=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await searchCommand('Speichern').click();const saved=await saveResponse;assert.equal(saved.status(),200);await saved.finished()
  await expect(dialog).toHaveCount(0);assert.ok(fs.readFileSync(notePath,'utf8').includes(marker));assert.ok(!before.includes(marker))
  report.checks.searchDraftAndExistingSaveCommand=true

  // Native editing must target the original CodeMirror selection, never the search field.
  const undoMarker='Natives Undo aus der App-Befehlssuche.'
  await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type('\n'+undoMarker)
  await page.keyboard.press('Control+p');await commandField.fill('>Rückgängig');await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0);await expect(editor).not.toContainText(undoMarker);await expect(editor).toBeFocused()
  await page.keyboard.press('Control+y');await expect(editor).toContainText(undoMarker)
  const redoSave=page.waitForResponse(res=>res.url().endsWith('/notes/save')&&res.request().method()==='POST')
  await page.keyboard.press('Control+s');const redoSaved=await redoSave;assert.equal(redoSaved.status(),200);await redoSaved.finished()
  await page.keyboard.press('Control+k');await expect(page.getByRole('listbox',{name:'Markdown-Befehle',exact:true})).toBeVisible();await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+p');await expect(page.getByRole('listbox',{name:'Markdown-Befehle',exact:true})).toBeVisible();await page.keyboard.press('Escape')
  await page.keyboard.press('Control+p');await commandField.fill('>Aktuelle Datei löschen');await page.keyboard.press('Enter')
  const confirm=page.getByRole('dialog',{name:'Datei löschen',exact:true})
  await expect(confirm).toBeVisible();assert.ok(fs.existsSync(notePath))
  await capture('search-delete-confirm-dark','File deletion from the palette still requires the existing confirmation')
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);assert.ok(fs.existsSync(notePath))
  report.checks.searchNativeUndoMarkdownShortcutsAndDeleteConfirmation=true

  await createNote('Suchalpha','Synthetisches Suchziel Alpha.\n');await createNote('Suchbeta','Synthetisches Suchziel Beta.\n')
  const pattern='**/search?**'
  const holdSearch=async text=>{
    let release,finish,started=false
    const gate=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finish=resolve)
    const intercept=async route=>{
      if(new URL(route.request().url()).searchParams.get('query')!==text){await route.continue();return}
      started=true
      try{const response=await route.fetch();await gate;await route.fulfill({response})}catch{/* Aborted browser requests cannot consume the held response. */}finally{finish()}
    }
    await page.route(pattern,intercept)
    return {wait:()=>expect.poll(()=>started).toBe(true),release:async()=>{release();if(started)await done;await page.unroute(pattern,intercept)}}
  }
  await page.keyboard.press('Control+o');await noteField.fill('Suchbeta');await expect(page.getByRole('option')).toHaveCount(1)
  const delayed=await holdSearch('Suchalpha')
  try {
    await noteField.fill('Suchalpha');await delayed.wait();await expect(page.getByRole('option')).toHaveCount(0)
    await expect(noteField).not.toHaveAttribute('aria-activedescendant',/./)
    await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await expect(page.locator('.note-title-input').first()).toHaveValue('Arbeitsnotiz')
    await capture('search-pending-dark','A changed query immediately removes old results; Enter cannot open the previous selection')
    await noteField.fill('Suchbeta');await expect(page.getByRole('option')).toHaveCount(1);await expect(page.getByRole('option')).toContainText('Suchbeta')
    await delayed.release();await expect(page.getByRole('option')).toContainText('Suchbeta')
    await page.keyboard.press('Enter');await expect(page.locator('.note-title-input').first()).toHaveValue('Suchbeta')
  } finally {await delayed.release()}
  report.checks.searchLatestQueryAndStaleEnter=true

  let failures=0
  const failOnce=async route=>{
    if(new URL(route.request().url()).searchParams.get('query')==='Suchfehler'&&failures++===0)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetischer Suchfehler.'}})})
    else await route.continue()
  }
  await page.route(pattern,failOnce)
  try {
    await page.keyboard.press('Control+o');await noteField.fill('Suchfehler');await expect(dialog.getByRole('alert')).toHaveText('Synthetischer Suchfehler.')
    await expect(page.getByRole('option')).toHaveCount(0);await capture('search-error-dark','A transport failure is visible with retry and no stale result options')
    await dialog.getByRole('button',{name:'Erneut suchen',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Keine passenden Notizen gefunden.')
    await noteField.focus();await noteField.fill('>Editor teilen');await page.keyboard.press('Enter');await expect(page.locator('.editor-workspace-split')).toBeVisible()
    await page.keyboard.press('F8');await expect(page.locator('.editor-workspace-single')).toBeVisible()
  } finally {await page.unroute(pattern,failOnce)}
  report.checks.searchErrorRetryAndCommandMode=true

  await openNote('Arbeitsnotiz')
  const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,240);return old})
  try {
    for(const [label,w,h,z,mode]of[['zoom-dark',1280,800,1.5,'dark'],['small-dark',640,420,1,'dark'],['light',1280,800,1,'light']]){
      await windowSize(w,h,z);if(mode==='light')await theme('light')
      await expect(trigger).toBeInViewport();await trigger.focus();await trigger.click();await noteField.fill('>');await expect(commandField).toBeFocused()
      await commandField.press('ArrowUp');await expect(page.getByRole('option').last()).toHaveAttribute('aria-selected','true');await expect(page.getByRole('option').last()).toBeInViewport()
      const box=await dialog.boundingBox(),view=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=view.w+1&&box.y+box.height<=view.h+1)
      await capture('search-'+label,'Grouped app commands remain reachable with keyboard and inside '+label+' viewport')
      await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(commandField).toBeFocused()
      await page.keyboard.press('Escape');await expect(trigger).toBeFocused()
    }
  } finally {await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum);await windowSize(1280,800)}
  report.checks.searchThemesZoomSmallWindowAndFocus=true

  // A real UI NoteBase switch follows cancellation of a held response from the old base.
  await theme('dark');await page.keyboard.press('Control+o');const cancelled=await holdSearch('Suchalpha')
  try {
    await noteField.fill('Suchalpha');await cancelled.wait();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
    await page.keyboard.press('Control+p');await commandField.fill('>NoteBase erstellen');await page.keyboard.press('Enter')
    const create=page.getByRole('dialog',{name:'Neue NoteBase erstellen',exact:true})
    await expect(create).toBeVisible();await create.getByLabel('NoteBase-Name',{exact:true}).fill('UX-Suchwechsel');await create.getByLabel('Speicherort',{exact:true}).fill(scratch)
    await create.getByRole('button',{name:'NoteBase erstellen',exact:true}).click();await expect(create).toHaveCount(0)
    await page.locator('.activity-rail').getByRole('button',{name:'NoteBase',exact:true}).click()
    await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-Suchwechsel')
    await cancelled.release();await page.keyboard.press('Control+o');await noteField.fill('Suchalpha')
    await expect(dialog.getByRole('status')).toHaveText('Keine passenden Notizen gefunden.');await expect(page.getByRole('group',{name:'Geöffnete Notizen',exact:true})).toHaveCount(0)
    await capture('search-notebase-switch','New NoteBase has no old opened targets or late search results from the cancelled request')
    await page.keyboard.press('Escape')
    const recent=page.getByRole('button',{name:'Aktionen für NoteBase UX-NoteBase',exact:true});await recent.click()
    await page.getByRole('menu',{name:'Aktionen für NoteBase UX-NoteBase',exact:true}).getByRole('menuitem',{name:'NoteBase öffnen',exact:true}).click()
    await expect(page.locator('.notebase-row.active strong')).toHaveText('UX-NoteBase')
    await page.locator('.activity-rail').getByRole('button',{name:'Notizen',exact:true}).click();await openNote('Arbeitsnotiz');await expect(editor).toContainText(marker)
  } finally {await cancelled.release()}
  report.checks.searchCancellationAndNoteBaseSwitch=true
}

async function verifyTooltips() {
  await windowSize(1280,800)
  await theme('dark');await openNote('Arbeitsnotiz')
  const original=fs.readFileSync(notePath,'utf8')
  const tip=page.getByRole('tooltip'),rail=page.locator('.activity-rail')
  const notes=rail.getByRole('button',{name:'Notizen',exact:true})
  const noTip=()=>expect(tip).not.toBeVisible()
  const bounds=async()=>{
    const box=await tip.boundingBox(),vp=await page.evaluate(()=>({w:innerWidth,h:innerHeight}))
    report.checks.tooltipBounds ??= []
    report.checks.tooltipBounds.push({text:await tip.textContent(),box,viewport:vp})
    assert.ok(box&&box.x>=7&&box.y>=7&&box.x+box.width<=vp.w-7&&box.y+box.height<=vp.h-7,'Tooltip outside viewport')
  }
  const beside=async item=>{
    const box=await tip.boundingBox(),anchor=await item.boundingBox()
    assert.ok(box.x>=anchor.x+anchor.width-1||box.x+box.width<=anchor.x+1,'Menu hint covers neighbouring actions')
  }
  await notes.hover();await expect(tip).toContainText('Notizen');await expect(tip).toContainText('Alt+1')
  await bounds();await capture('tooltip-rail-dark','Shared dark tooltip with command-catalog shortcut; right of the activity rail')
  await tip.hover();await page.waitForTimeout(600);await expect(tip).toBeVisible()
  await page.mouse.move(700,500);await noTip()
  report.checks.tooltipHoverBridge=true

  await rail.getByRole('button',{name:'NoteBase',exact:true}).focus();await page.keyboard.press('Tab')
  await expect(notes).toBeFocused();await expect(tip).toContainText('Notizen')
  const tipId=await tip.getAttribute('id');await expect(notes).toHaveAttribute('aria-describedby',tipId)
  await capture('tooltip-keyboard-dark','Keyboard focus opens the same hint without moving focus')
  await page.keyboard.press('Escape');await noTip();await expect(notes).toBeFocused()
  await expect(notes).not.toHaveAttribute('aria-describedby',/./)
  await page.waitForTimeout(600);await noTip()
  report.checks.tooltipKeyboardEscapeKeepsFocusAndStaysDismissed=true

  await notes.hover();await page.mouse.move(700,500);await notes.hover();await expect(tip).toBeVisible()
  await notes.click();await noTip();await page.waitForTimeout(600);await noTip()
  await expect(page.locator('.left-sidebar')).not.toBeVisible()
  await notes.click();await expect(page.locator('.left-sidebar')).toBeVisible()
  const menuTrigger=page.getByRole('button',{name:'Notizen sortieren',exact:true})
  await menuTrigger.click();await expect(page.getByRole('menu',{name:'Notizen sortieren',exact:true})).toBeVisible()
  await notes.hover();await page.waitForTimeout(600);await noTip();await page.keyboard.press('Escape')
  await page.locator('.explorer-row').filter({hasText:'Arbeitsnotiz'}).first().click({button:'right'})
  const fileMenu=page.getByRole('menu',{name:'Exploreraktionen',exact:true})
  await expect(fileMenu).toBeVisible();await fileMenu.getByRole('menuitem',{name:'Umbenennen',exact:true}).hover()
  const rename=fileMenu.getByRole('menuitem',{name:'Umbenennen',exact:true})
  await expect(tip).toHaveText('Umbenennen');await expect(fileMenu).toBeVisible();await bounds();await beside(rename)
  await capture('tooltip-context-menu-dark','Shared hint within the active context menu keeps its actions and focus intact')
  await page.keyboard.press('Escape');await expect(fileMenu).toHaveCount(0);await noTip()
  await page.locator('.explorer-row').filter({hasText:'Arbeitsnotiz'}).first().evaluate(node=>node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-4,clientY:200,button:2})))
  await expect(fileMenu).toBeVisible();await rename.hover();await expect(tip).toHaveText('Umbenennen');await bounds();await beside(rename)
  await capture('tooltip-menu-right-edge-dark','Actual menu with synthetic right-edge coordinates: hint flips to its left without covering adjacent actions')
  await page.keyboard.press('Escape');await expect(fileMenu).toHaveCount(0);await noTip()
  report.checks.tooltipClickAndMenuBoundary=true

  await page.getByRole('button',{name:'Tags bearbeiten',exact:true}).first().click()
  const popup=page.getByRole('dialog',{name:'Tags bearbeiten',exact:true})
  await expect(popup).toBeVisible();await notes.hover();await page.waitForTimeout(600);await noTip()
  await popup.getByRole('searchbox').click();await page.keyboard.press('Escape');await expect(popup).not.toBeVisible()
  report.checks.tooltipDoesNotDismissOrEscapeAutoPopover=true

  await rail.getByRole('button',{name:'Einstellungen',exact:true}).click()
  const close=page.getByRole('button',{name:'Einstellungen schliessen',exact:true})
  await close.hover();await expect(tip).toContainText('Einstellungen schliessen');await bounds()
  await capture('tooltip-settings-dark','Hint above the active settings dialog; no focus or action in the hint')
  // Synthetic event probes scope eligibility without clicking through the modal.
  await notes.dispatchEvent('pointerover',{pointerType:'mouse'});await page.waitForTimeout(600);await noTip()
  await close.click();report.checks.tooltipDialogBoundary=true

  // Explicitly synthetic lifecycle/edge controls; the real shared layer owns all hints.
  await page.evaluate(()=>{
    const host=document.createElement('section');host.id='tooltip-probe';host.style.cssText='position:fixed;left:430px;top:250px;z-index:300;background:var(--surface);padding:16px;border:1px solid var(--line)'
    host.innerHTML='<p>Isolierte Tooltip-Probe</p><p id="tooltip-probe-description">Bestehende Feldbeschreibung</p><input aria-label="Tooltip-Prüffeld" aria-describedby="tooltip-probe-description" data-tooltip="Zusätzlicher Feldhinweis"/><button disabled data-tooltip="Aktion derzeit nicht verfügbar">Deaktivierte Aktion</button><button id="tooltip-probe-edge">Langer Pfad</button>'
    host.querySelector('#tooltip-probe-edge').dataset.tooltip='C:/Synthetische-NoteBase/'+('Ein-sehr-langer-Ordnername/'.repeat(9))+'Dokument.md'
    document.body.append(host)
  })
  const minimum=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],old=win.getMinimumSize();win.setMinimumSize(240,240);return old})
  try {
    const field=page.getByRole('textbox',{name:'Tooltip-Prüffeld',exact:true})
    await field.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(field).toBeFocused()
    await expect(tip).toHaveText('Zusätzlicher Feldhinweis')
    await expect(field).toHaveAttribute('aria-describedby',`tooltip-probe-description ${tipId}`)
    await page.keyboard.press('Escape');await noTip();await expect(field).toHaveAttribute('aria-describedby','tooltip-probe-description')
    await expect(field).toBeFocused();report.checks.tooltipPreservesExistingDescription=true
    await page.getByRole('button',{name:'Langer Pfad',exact:true}).focus()
    await field.dispatchEvent('pointerdown',{pointerType:'touch'});await field.focus();await page.waitForTimeout(600);await noTip()
    await field.dispatchEvent('pointerout',{pointerType:'touch'});report.checks.tooltipTouchFocusDoesNotOpen=true
    await page.getByRole('button',{name:'Deaktivierte Aktion',exact:true}).hover();await expect(tip).toHaveText('Aktion derzeit nicht verfügbar')
    await capture('tooltip-disabled-dark','Synthetic disabled control remains explainable on hover')
    await page.getByRole('button',{name:'Deaktivierte Aktion',exact:true}).evaluate(node=>node.remove());await noTip()
    report.checks.tooltipDisabledAndUnmount=true
    for(const [label,w,h,z,mode]of[['zoom',1280,800,1.5,'dark'],['small',640,420,1,'dark'],['light',1280,800,1,'light']]) {
      await windowSize(w,h,z)
      if(mode==='light')await theme('light')
      await page.evaluate(()=>{const host=document.getElementById('tooltip-probe');host.style.cssText='position:fixed;right:8px;bottom:8px;z-index:300;background:var(--surface);padding:8px;border:1px solid var(--line)';host.querySelector('input').style.display='none';host.querySelectorAll('p').forEach(node=>node.style.display='none')})
      const edge=page.getByRole('button',{name:'Langer Pfad',exact:true})
      await page.mouse.move(10,100);await edge.hover();await expect(tip).toContainText('Dokument.md');await bounds()
      await capture(`tooltip-${label}`,'Synthetic long path at the bottom-right boundary, '+label)
      await page.keyboard.press('Escape');await noTip()
    }
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.mouse.move(10,100);await page.getByRole('button',{name:'Langer Pfad',exact:true}).hover();await expect(tip).toBeVisible()
    assert.equal(await tip.locator('.nn-tooltip-content').evaluate(node=>getComputedStyle(node).animationName),'none')
    await capture('tooltip-reduced-motion','Shared tooltip with reduced-motion preference and no animation')
    await page.mouse.wheel(0,150);await noTip();report.checks.tooltipReducedMotionAndScrollDismiss=true
  } finally {
    await page.evaluate(()=>document.getElementById('tooltip-probe')?.remove());await page.emulateMedia({reducedMotion:null})
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setMinimumSize(...size),minimum)
  }
  await noTip();assert.equal(fs.readFileSync(notePath,'utf8'),original)
  report.checks.tooltipNoDocumentWrites=true
  assert.equal(await page.locator('.activity-rail [title],.editor-workspace-panel [title]:not(.cm-editor *)').count(),0)
  await windowSize(1280,800);await theme('dark');await openNote('Arbeitsnotiz')
}

async function captureTabMenuEdges() {
  // Exercise the actual tab handler with boundary inputs. The trigger is genuine;
  // only the pointer coordinates are synthetic, because tabs cannot occupy every corner.
  const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}))
  report.checks.tabMenuEscapeByCorner = {}
  for (const [corner, x, y] of [
    ['top-left', 4, 4], ['top-right', viewport.width - 4, 4],
    ['bottom-left', 4, viewport.height - 4], ['bottom-right', viewport.width - 4, viewport.height - 4],
  ]) {
    const coordinates = await page.locator('.tab-open').filter({hasText: 'Arbeitsnotiz'}).first().evaluate((node, {x, y}) => {
      const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2})
      node.dispatchEvent(event)
      return {x: event.clientX, y: event.clientY}
    }, {x, y})
    assert.deepEqual(coordinates, {x, y})
    await expect(page.getByRole('menu', {name:'Registerkartenaktionen',exact:true})).toBeVisible()
    await capture(`tab-edge-${corner}-light`, `Actual tab menu handler with synthetic ${corner} pointer coordinates`)
    await page.keyboard.press('Escape')
    report.checks.tabMenuEscapeByCorner[corner] = await page.getByRole('menu', {name:'Registerkartenaktionen',exact:true}).count() === 0
    assert.equal(report.checks.tabMenuEscapeByCorner[corner],true,'Escape must close tab menus at every edge')
    await expect(page.getByRole('menu', {name:'Registerkartenaktionen',exact:true})).toHaveCount(0)
  }

}

try {
  console.log(JSON.stringify({output: scratch}))
  await expect.poll(() => {
    if (viteError || vite.exitCode !== null) throw new Error('Owned Vite failed: ' + (viteError?.message || viteLog))
    return isViteReady(viteLog)
  }, {timeout: 45000}).toBe(true)
  const started = performance.now()
  app = await electron.launch({
    executablePath: electronBinary, args: [root], cwd: root,
    env: {...process.env, NICKNOTES_USER_DATA: path.join(scratch, 'profile'), NICKNOTES_PORT: '18781'},
    timeout: 90000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('request', req => {
    if (req.url().startsWith('http://127.0.0.1:18781')) report.requests.push({method: req.method(), endpoint: new URL(req.url()).pathname})
  })
  await expect(page.getByRole('menubar')).toBeVisible({timeout: 90000})
  report.checks.launchToMenubarMs = Math.round(performance.now() - started)
  await windowSize(1280, 800)
  if (!edgesOnly) await capture('launch-light', 'Start without an open NoteBase, light, 1280×800')
  if (searchCommands && !edgesOnly) await verifySearchCommandsLaunch()
  if (createDialog && !edgesOnly) await verifyCreateDialogLaunch()

  const vault = await request('/notebase/create', {parentPath: scratch, name: 'UX-NoteBase'})
  vaultPath = path.resolve(vault.noteBasePath)
  assert.equal(vaultPath, path.join(scratch, 'UX-NoteBase'))
  await page.reload()
  await expect(page.locator('.activity-rail')).toBeVisible()
  if (!edgesOnly) await capture('empty-light', 'New empty NoteBase, light, 1280×800')

  if (edgesOnly) {
    await createNote('Arbeitsnotiz', 'Synthetische Notiz für die Randpositionsprobe.\n')
    await page.reload()
    await expect(page.locator('.activity-rail')).toBeVisible()
    await openNote('Arbeitsnotiz')
    await captureTabMenuEdges()
  } else {
    notePath = await createNote('Arbeitsnotiz', '# Ein ruhiger Arbeitsplatz\n\nDiese synthetische Notiz dient ausschließlich der UX-Prüfung.\n\n## Nächste Schritte\n\n- [ ] Entwurf besprechen\n- [x] Recherche zusammenfassen\n\nEin [relativer Link](./Aufgabe.md) und ein **hervorgehobener Gedanke**.\n\n> Inhalte bleiben als Markdown lesbar.\n')
    await createNote('Aufgabe', 'Die Umsetzung gemeinsam vorbereiten.\n\n- [ ] Akzeptanzkriterien abstimmen\n', 'task')
    // Populate one genuine long file list without exercising UI creation sixty times.
    for (let i = 1; i <= 60; i++) {
      fs.writeFileSync(path.join(vaultPath, `Recherche-${String(i).padStart(2, '0')}.md`),
        `---\nid: ux-reference-${i}\ntitle: Recherche ${String(i).padStart(2, '0')}\ntype: note\n---\n\nSynthetischer Rechercheeintrag ${i}.\n`)
    }
    await request('/notebase/reindex', {})
    await page.reload()
    await expect(page.locator('.activity-rail')).toBeVisible()
    await openNote('Arbeitsnotiz')
    report.checks.keyboardQuickOpen = true
    await capture('note-light', 'Markdown note and long explorer list, light, 1280×800')
    await theme('dark')
    await capture('note-dark', 'Same note, dark, 1280×800')
    await windowSize(1600, 1000)
    await capture('note-large-dark', 'Same note, dark, 1600×1000')
    await windowSize(1280, 800, 1.25)
    await capture('note-zoom-dark', 'Same note, dark, Electron zoom 125%, content size 1280×800')
    await windowSize(1280, 800)

    if (foundations) await verifyFoundations()
    if (menus) await verifyMenus()
    if (tags) await verifyTags()
    if (graph) await verifyGraph()
    if (editorMenus) await verifyEditorMenus()
    if (sidebarMenus) await verifySidebarMenus()
    if (suggestionMenus) await verifySuggestionMenus()
    if (createDialog) await verifyCreateDialog()
    if (tagMatching) await verifyTagMatching()
    if (settingsDialog) await verifySettingsDialog()
    if (filters) await verifyFilters()
    if (properties) await verifyProperties()
    if (tooltips) await verifyTooltips()
    if (searchCommands) await verifySearchCommands()

    await page.locator('.note-body-editor .cm-content').first().click()
    await page.keyboard.press('Control+o')
    await page.getByRole('combobox', {name: 'Notiz suchen'}).fill('Recherche')
    await expect(page.getByRole('option')).toHaveCount(50)
    await page.keyboard.press('ArrowDown')
    await capture('quick-open-dark', 'Keyboard selection in Quick Open; fifty of sixty results')
    await page.keyboard.press('Escape')
    await expect(page.locator('.note-body-editor .cm-content').first()).toBeFocused()
    report.checks.quickOpenRestoresEditorFocus = true

    await page.keyboard.press('Control+Shift+n')
    await expect(page.locator('.note-title-input').first()).toHaveValue('Neuer Task')
    await page.locator('.property-picker-select-status').selectOption('in_progress')
    const save = page.waitForResponse(res => res.url().endsWith('/notes/save') && res.request().method() === 'POST')
    await page.keyboard.press('Control+s')
    const saved = await save
    assert.equal(saved.status(), 200)
    const createdTask = (await saved.json()).path
    assert.ok(fs.readFileSync(createdTask, 'utf8').includes('in_progress'))
    report.checks.keyboardTaskCreatedAndStatusSaved = true
    await capture('task-dark', 'Task created by keyboard, status changed by visible control and persisted')

    await page.locator('.activity-rail').getByRole('button', {name: 'Tasks', exact: true}).click()
    await page.locator('.left-sidebar .todo-open-dashboard-button').click()
    await expect(page.locator('.task-canvas')).toBeVisible()
    await capture('task-dashboard-dark', 'Task dashboard opened with the mouse')
    await openNote('Arbeitsnotiz')
    await windowSize(1600, 1000)
    await page.keyboard.press('F8')
    await expect(page.locator('.editor-workspace-split')).toBeVisible()
    await page.keyboard.press('Control+2')
    await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id'))).toBe('right')
    await page.keyboard.press('F6')
    await expect.poll(()=>page.evaluate(()=>document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id'))).toBe('left')
    report.checks.splitFocusPane = await page.evaluate(() => document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id'))
    assert.equal(report.checks.splitFocusPane, 'left')
    await capture('split-dark', 'Two editor groups, pane switching by keyboard, dark, 1600×1000')
    await page.keyboard.press('F8')
    await windowSize(1280, 800)

    await page.locator('.activity-rail').getByRole('button', {name: 'Notizen', exact: true}).click()
    await expect(page.locator('.explorer-row').filter({hasText: 'Arbeitsnotiz'}).first()).toBeVisible()
    await page.locator('.explorer-row').filter({hasText: 'Arbeitsnotiz'}).first().click({button: 'right'})
    await expect(page.getByRole('menu', {name:'Exploreraktionen',exact:true})).toBeVisible()
    await capture('explorer-menu-dark', 'Explorer context menu, dark, 1280×800')
    await page.keyboard.press('Escape')
    await page.locator('.tab-open').filter({hasText: 'Arbeitsnotiz'}).first().click({button: 'right'})
    await expect(page.getByRole('menu', {name:'Registerkartenaktionen',exact:true})).toBeVisible()
    await capture('tab-menu-dark', 'Tab context menu, dark, 1280×800')
    await page.keyboard.press('Escape')
    const editor = page.locator('.note-body-editor .cm-content').first()
    // This is a selection menu, so invoke it inside an actual text selection.
    await editor.click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+End')
    await editor.locator('.cm-line').first().click({button: 'right', position: {x: 60, y: 12}})
    await expect(page.getByRole('menu',{name:'Auswahlaktionen',exact:true})).toBeVisible()
    await capture('editor-menu-dark', 'Editor context menu, dark, 1280×800')
    await page.keyboard.press('Escape')

    const lastRow = page.locator('.explorer-row').last()
    await lastRow.scrollIntoViewIfNeeded()
    await lastRow.click({button: 'right'})
    await expect(page.getByRole('menu', {name:'Exploreraktionen',exact:true})).toBeVisible()
    await capture('explorer-menu-bottom-dark', 'File context menu at the bottom of the long explorer list')
    await page.keyboard.press('ArrowDown')
    report.checks.explorerMenuOwnsArrowFocus = await page.evaluate(() => Boolean(document.querySelector('.nn-context-menu')?.contains(document.activeElement)))
    assert.equal(report.checks.explorerMenuOwnsArrowFocus,true,'Arrow keys must stay in the explorer menu')
    await page.keyboard.press('Escape')

    await page.locator('.activity-rail').getByRole('button', {name: 'Einstellungen', exact: true}).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture('settings-dark', 'Settings, dark, 1280×800')
    await page.getByRole('button', {name: 'Darstellung', exact: true}).click()
    await page.getByRole('combobox').first().selectOption('light')
    const settingsSave = page.getByRole('dialog').getByRole('button', {name: 'Speichern', exact: true})
    await settingsSave.click(); await expect(settingsSave).toBeDisabled()
    await capture('settings-light', 'Appearance settings, light, 1280×800')
    await page.getByRole('button', {name: 'Einstellungen schliessen'}).click()

    await openNote('Arbeitsnotiz')
    await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nUngespeicherter lokaler Entwurf.')
    fs.appendFileSync(notePath, '\nExterne Bearbeitung der synthetischen Datei.\n')
    await expect(page.getByRole('alert').filter({hasText: 'Dein Entwurf bleibt erhalten'})).toBeVisible({timeout: 30000})
    const conflict = page.waitForResponse(res => res.url().endsWith('/notes/save') && res.request().method() === 'POST')
    await page.keyboard.press('Control+s')
    assert.equal((await conflict).status(), 409)
    await expect(editor).toContainText('Ungespeicherter lokaler Entwurf.')
    assert.ok(!fs.readFileSync(notePath, 'utf8').includes('Ungespeicherter lokaler Entwurf.'))
    report.checks.externalConflict409AndDraftPreserved = true
    await capture('conflict-light', 'Real revision conflict after external edit; local draft retained')

    const recovery = path.join(vaultPath, '.system', 'recovery', '11111111111111111111111111111111')
    fs.mkdirSync(recovery, {recursive: true})
    fs.copyFileSync(notePath, path.join(recovery, '0.bak'))
    fs.writeFileSync(path.join(recovery, 'manifest.json'), JSON.stringify({
      operation: 'UX-Beispiel: unterbrochene Änderung', state: 'recovery_required',
      entries: [{path: path.relative(vaultPath, notePath), backup: '0.bak'}],
    }))
    await page.locator('.activity-rail').getByRole('button', {name: 'Einstellungen', exact: true}).click()
    await expect(page.getByRole('heading', {name: 'Unterbrochene Aenderungen pruefen'})).toBeVisible()
    if(settingsDialog) {
      const summary=page.locator('.settings-modal summary').first()
      await summary.focus();await page.keyboard.press('Tab')
      await expect(page.getByRole('button',{name:'Vorherigen Stand wiederherstellen',exact:true})).toBeFocused()
      await page.keyboard.press('Shift+Tab');await expect(summary).toBeFocused()
      await page.keyboard.press('Enter');await expect(summary.locator('..')).toHaveAttribute('open','')
      report.checks.settingsDialogRecoveryDetailsNativeKeyboard=true
    }
    await capture('recovery-light', 'Real recovery UI with a deliberately staged local journal; no crash simulated')

    await page.getByRole('button', {name: 'Einstellungen schliessen'}).click()
    await captureTabMenuEdges()
  }

  // Observe an idle window deliberately; this duration is measurement, not an UI readiness guess.
  const before = report.requests.length
  await page.waitForTimeout(8000)
  report.checks.idleRequestsOver8Seconds = report.requests.slice(before)
  assert.deepEqual(report.pageErrors, [])
  report.completed = true
} catch (error) {
  report.completed = false
  report.failure = String(error)
  if (page) report.failureUi = await page.evaluate(() => ({
    focus: {tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')},
    editors:[...document.querySelectorAll('.note-body-editor .cm-content')].map(node=>{
      const view=node.cmTile?.root?.view
      return view ? {doc:view.state.doc.toString(),selection:{from:view.state.selection.main.from,to:view.state.selection.main.to},readOnly:view.state.readOnly} : null
    }),
    menus:[...document.querySelectorAll('[role=menu]')].map(node=>node.getAttribute('aria-label')),
  })).catch(()=>null)
  if (page) await page.screenshot({path: path.join(scratch, 'failure.png')}).catch(() => {})
  throw error
} finally {
  writeReport()
  input?.close()
  if (app) {
    // The entire profile and any draft belong to this disposable fixture only.
    await app.evaluate(({dialog}) => {dialog.showMessageBoxSync = () => 1}).catch(() => {})
    await app.close()
  }
  if (vite.exitCode === null) vite.kill()
  console.log(JSON.stringify({result: path.join(scratch, 'result.json'), completed: report.completed}))
}

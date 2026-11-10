/** Repeatable UX evidence from the real desktop and backend, with disposable data only. */
import {_electron as electron, expect as baseExpect} from '@playwright/test'
import electronBinary from 'electron'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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
const reviewFromArg = process.argv.slice(2).find(arg => /^--review-from=\d+$/.test(arg))
const reviewFrom = reviewFromArg ? Number(reviewFromArg.split('=')[1]) : 1
if (process.argv.slice(2).some(arg => !['--review','--edges-only','--foundations','--menus','--tags'].includes(arg) && arg !== reviewFromArg)) throw new Error('Usage: npm run ux:baseline -- [--review] [--review-from=N] [--edges-only] [--foundations] [--menus] [--tags]')
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
  await app.evaluate(({BrowserWindow}, {width, height, zoom}) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.setZoomFactor(zoom)
    win.setContentSize(width, height)
  }, {width, height, zoom})
}

async function capture(name, description) {
  // Wait for actual paints and font completion, not a fixed screenshot delay.
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
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
      capture: rect('.capture-workspace-panel'),
      menus: [...document.querySelectorAll('.nn-context-menu,.explorer-context-menu,.editor-selection-context-menu')].map(node => {
        const {x, y, width, height} = node.getBoundingClientRect()
        return {className: node.className, role: node.getAttribute('role'), x, y, width, height,
          scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop,
          outsideViewport: x < 0 || y < 0 || x + width > innerWidth || y + height > innerHeight}
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
  await page.getByRole('combobox').first().selectOption(mode)
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
    await page.keyboard.press('F6')
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
    await expect(page.locator('.editor-selection-context-menu')).toBeVisible()
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

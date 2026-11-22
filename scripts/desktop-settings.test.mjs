import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {CAPTURE_SHORTCUTS, DEFAULT_DESKTOP_SETTINGS, DesktopSettingsStore, normalizeDesktopSettings, shortcutLabel} from '../src/desktop/desktop-settings.mjs'
import {COMMANDS} from '../src/frontend/src/app/commands.ts'

test('unknown or damaged values fall back to the defaults; an empty shortcut stays off', () => {
  assert.deepEqual(normalizeDesktopSettings(null), DEFAULT_DESKTOP_SETTINGS)
  assert.deepEqual(normalizeDesktopSettings({captureShortcut: 'Alt+F4', keepInTray: 'yes'}), DEFAULT_DESKTOP_SETTINGS)
  assert.deepEqual(normalizeDesktopSettings({captureShortcut: '', keepInTray: true}), {captureShortcut: '', keepInTray: true, dailyOverview: ''})
  assert.equal(normalizeDesktopSettings({dailyOverview: '07:30'}).dailyOverview, '07:30')
  assert.equal(normalizeDesktopSettings({dailyOverview: '25:00'}).dailyOverview, '')
  assert.equal(shortcutLabel('CommandOrControl+Alt+Space'), 'Strg+Alt+Leertaste')
})

test('no offered global shortcut collides with an in-app shortcut', () => {
  const inApp = new Set(COMMANDS.flatMap(command => [command.shortcut, ...(command.aliases ?? [])]).filter(Boolean).map(value => value.replace('Mod', 'CommandOrControl')))
  for (const {value} of CAPTURE_SHORTCUTS) assert.equal(inApp.has(value), false, value)
})

test('settings survive a restart and ignore unknown fields', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-desktop-settings-'))
  try {
    const store = new DesktopSettingsStore(profile)
    assert.deepEqual(await store.load(), DEFAULT_DESKTOP_SETTINGS)
    await store.update({captureShortcut: 'CommandOrControl+Alt+Space', keepInTray: true, dailyOverview: '08:00', extra: 1})
    const again = new DesktopSettingsStore(profile)
    assert.deepEqual(await again.load(), {captureShortcut: 'CommandOrControl+Alt+Space', keepInTray: true, dailyOverview: '08:00'})
  } finally {
    fs.rmSync(profile, {recursive: true, force: true})
  }
})

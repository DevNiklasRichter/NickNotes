import { type Dispatch, type SetStateAction } from 'react'
import {flushSync} from 'react-dom'
import type { ColorProfile, StatusBarPrefs, TaskFeatureSettings, ThemeMode } from './AppShared'
import type { ExplorerOptions } from '../explorer/types'
import { normalizeLabel, toThemeMode } from './AppShared'

type AppSettingsSnapshot = {
  getTheme: () => ThemeMode
  getActiveColorProfileId: () => string
  getColorProfiles: () => ColorProfile[]
  getDisplayName: () => string
  isSidebarOpen: () => boolean
  getStatusBarPrefs: () => StatusBarPrefs
  getTaskFeatureSettings: () => TaskFeatureSettings
  getExplorerOptions: () => ExplorerOptions
  getSavedTheme: () => ThemeMode
  getSavedActiveColorProfileId: () => string
  getSavedColorProfiles: () => ColorProfile[]
  getSavedDisplayName: () => string
  getSavedSidebarOpen: () => boolean
  getSavedStatusBarPrefs: () => StatusBarPrefs
  getSavedTaskFeatureSettings: () => TaskFeatureSettings
  getSavedExplorerOptions: () => ExplorerOptions
}

type AppSettingsWriter = {
  setTheme: (theme: ThemeMode) => void
  setActiveColorProfileId: (colorProfileId: string) => void
  setColorProfiles: Dispatch<SetStateAction<ColorProfile[]>>
  setDisplayName: (value: string) => void
  setSidebarOpen: (open: boolean) => void
  setStatusBarPrefs: (prefs: StatusBarPrefs) => void
  setTaskFeatureSettings: (settings: TaskFeatureSettings) => void
  setExplorerOptions: (options: ExplorerOptions) => void
  setSavedTheme: (theme: ThemeMode) => void
  setSavedActiveColorProfileId: (colorProfileId: string) => void
  setSavedColorProfiles: (profiles: ColorProfile[]) => void
  setSavedDisplayName: (value: string) => void
  setSavedSidebarOpen: (open: boolean) => void
  setSavedStatusBarPrefs: (prefs: StatusBarPrefs) => void
  setSavedTaskFeatureSettings: (settings: TaskFeatureSettings) => void
  setSavedExplorerOptions: (options: ExplorerOptions) => void
  setMessage: (message: string) => void
  setError: (error: string) => void
}

type UiSettingsPatch = {
  app?: Record<string, unknown>
}

type AppSettingsContext = {
  snapshot: AppSettingsSnapshot
  writer: AppSettingsWriter
  isVaultLoaded: () => boolean
  isSettingsDirty: () => boolean
  getSavePromise: () => Promise<boolean> | null
  setSavePromise: (promise: Promise<boolean> | null) => void
  isClosePending: () => boolean
  setClosePending: (pending: boolean) => void
  setSaving: (saving: boolean) => void
  setSaveError: (message: string) => void
  askCloseChoice: () => Promise<string | null>
  setSettingsDialogOpen: (open: boolean) => void
  saveUiSettingsPatch: (patch: UiSettingsPatch) => Promise<void>
  buildFullAppUiSettings: () => Record<string, unknown>
}

export class AppSettingsService {
  private readonly context: AppSettingsContext

  constructor(context: AppSettingsContext) {
    this.context = context
  }

  private get snapshot() {
    return this.context.snapshot
  }

  private get writer() {
    return this.context.writer
  }

  private cloneColorProfiles = (profiles: ColorProfile[]) =>
    profiles.map((profile) => ({ ...profile, colors: { ...profile.colors } }))

  openSettingsDialog = () => {
    this.context.setSaveError('')
    this.context.setSettingsDialogOpen(true)
  }

  closeSettingsDialog = async () => {
    if (this.context.getSavePromise() || this.context.isClosePending()) return
    if (!this.context.isSettingsDirty()) {
      this.context.setSettingsDialogOpen(false)
      return
    }
    this.context.setClosePending(true)
    try {
      const choice = await this.context.askCloseChoice()
      if (choice === 'save' && await this.saveSettings()) this.context.setSettingsDialogOpen(false)
      else if (choice === 'discard') {
        this.discardSettings()
        this.context.setSettingsDialogOpen(false)
      }
    } finally {this.context.setClosePending(false)}
  }

  saveSettings = (): Promise<boolean> => {
    const existing = this.context.getSavePromise()
    if (existing) return existing
    if (!this.context.isSettingsDirty()) return Promise.resolve(true)
    this.context.setSaving(true)
    this.context.setSaveError('')
    const pending = this.persistSettings().finally(() => {
      this.context.setSavePromise(null)
      this.context.setSaving(false)
    })
    this.context.setSavePromise(pending)
    return pending
  }

  private persistSettings = async (): Promise<boolean> => {
    try {
      const displayName = normalizeLabel(this.snapshot.getDisplayName()) || 'Mein Wissen'
      if (this.context.isVaultLoaded()) {
        await this.context.saveUiSettingsPatch({
          app: {...this.context.buildFullAppUiSettings(), displayName},
        })
      }
      // Publish the saved baseline before a queued shortcut or close request continues.
      flushSync(() => {
        this.writer.setSavedTheme(this.snapshot.getTheme())
        this.writer.setSavedActiveColorProfileId(this.snapshot.getActiveColorProfileId())
        this.writer.setSavedColorProfiles(this.cloneColorProfiles(this.snapshot.getColorProfiles()))
        this.writer.setDisplayName(displayName)
        this.writer.setSavedDisplayName(displayName)
        this.writer.setSavedSidebarOpen(this.snapshot.isSidebarOpen())
        this.writer.setSavedStatusBarPrefs({ ...this.snapshot.getStatusBarPrefs() })
        this.writer.setSavedTaskFeatureSettings({ ...this.snapshot.getTaskFeatureSettings() })
        this.writer.setSavedExplorerOptions({ ...this.snapshot.getExplorerOptions() })
      })
      this.writer.setMessage('Einstellungen gespeichert.')
      this.writer.setError('')
      return true
    } catch (caught) {
      this.context.setSaveError(String(caught))
      this.writer.setError(String(caught))
      return false
    }
  }

  discardSettings = () => {
    if (this.context.getSavePromise()) return
    this.context.setSaveError('')
    this.writer.setTheme(this.snapshot.getSavedTheme())
    this.writer.setActiveColorProfileId(this.snapshot.getSavedActiveColorProfileId())
    this.writer.setColorProfiles(this.cloneColorProfiles(this.snapshot.getSavedColorProfiles()))
    this.writer.setDisplayName(this.snapshot.getSavedDisplayName())
    this.writer.setSidebarOpen(this.snapshot.getSavedSidebarOpen())
    this.writer.setStatusBarPrefs({ ...this.snapshot.getSavedStatusBarPrefs() })
    this.writer.setTaskFeatureSettings({ ...this.snapshot.getSavedTaskFeatureSettings() })
    this.writer.setExplorerOptions({ ...this.snapshot.getSavedExplorerOptions() })
    this.writer.setMessage('Nicht gespeicherte Einstellungen verworfen.')
  }

  setDisplayName = (nextRawValue: string) => {
    this.writer.setDisplayName(nextRawValue)
  }

  setThemeMode = (nextMode: ThemeMode) => {
    this.writer.setTheme(nextMode)
    this.writer.setActiveColorProfileId(nextMode)
  }

  toggleThemeMode = () => {
    this.setThemeMode(this.snapshot.getTheme() === 'light' ? 'dark' : 'light')
  }

  setColorProfiles = (nextColorProfiles: SetStateAction<ColorProfile[]>) => {
    if (typeof nextColorProfiles === 'function') {
      const nextProfiles = nextColorProfiles(this.snapshot.getColorProfiles())
      this.writer.setColorProfiles(this.cloneColorProfiles(nextProfiles))
      return
    }
    this.writer.setColorProfiles(this.cloneColorProfiles(nextColorProfiles))
  }

  handleActiveColorProfileChange = (profileId: string) => {
    const nextProfile = this.snapshot.getColorProfiles().find((profile) => profile.id === profileId)
    if (!nextProfile) {
      this.writer.setActiveColorProfileId(profileId)
      return
    }
    this.writer.setActiveColorProfileId(nextProfile.id)
    this.writer.setTheme(toThemeMode(nextProfile.baseTheme, this.snapshot.getTheme()))
  }
}

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  DEFAULT_DARK_COLOR_PROFILE,
  DEFAULT_LIGHT_COLOR_PROFILE,
  THEME_COLOR_TOKEN_GROUPS,
  THEME_COLOR_TOKEN_LABELS,
  apiRequest,
  normalizeCssColor,
  normalizeLabel,
  type ColorProfile,
  type NoteGroup,
  type ThemeColorToken,
  type VaultCounts,
} from '../app/AppShared'
import type { AssistantProviderProbeResponse, AssistantSettingsConfig, AssistantSettingsResponse } from '../contracts/apiContracts'
import type { ExplorerOptions } from '../explorer/types'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import {
  ASSISTANT_DEFAULT_CONTEXT_CHARS,
  ASSISTANT_DEFAULT_CONTEXT_NOTES,
  ASSISTANT_DEFAULT_PROVIDER_RETRIES,
  ASSISTANT_DEFAULT_REQUEST_CHARS,
  ASSISTANT_DEFAULT_RESPONSE_CHARS,
  ASSISTANT_MAX_CONTEXT_CHARS,
  ASSISTANT_MAX_CONTEXT_NOTES,
  ASSISTANT_MAX_PROVIDER_RETRIES,
  ASSISTANT_MAX_REQUEST_CHARS,
  ASSISTANT_MAX_RESPONSE_CHARS,
  ASSISTANT_MIN_CONTEXT_CHARS,
  ASSISTANT_MIN_CONTEXT_NOTES,
  ASSISTANT_MIN_PROVIDER_RETRIES,
  ASSISTANT_MIN_REQUEST_CHARS,
  ASSISTANT_MIN_RESPONSE_CHARS,
} from '../assistant/assistantLimits'

type ThemeMode = 'light' | 'dark'

type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

type TaskFeatureSettings = {
  advancedTaskHandling: boolean
  taskTimeManagement: boolean
}

type OneNoteImportPreview = {
  notebooks: number
  sections: number
  pages: number
  mediaCandidates: number
  unsupportedFiles: number
  warnings: string[]
  pagesPreview: Array<{
    title: string
    notebook: string
    section: string
    sourcePath: string
  }>
}

type OneNoteImportResponse = {
  counts?: VaultCounts
  tagGroups?: unknown
  groups?: NoteGroup[]
  import?: {
    importedPages: number
    skippedPages: number
    mediaFiles: number
    warnings: string[]
    reportPath: string
  }
}

type OneNoteImportStatus = {
  active: boolean
  done: boolean
  error: string | null
  errorCode?: string | null
  errorDetails?: Record<string, unknown> | null
  phase: string
  processed: number
  total: number
  currentPath: string | null
  result?: OneNoteImportResponse | null
}

const DEFAULT_ASSISTANT_SETTINGS_CONFIG: AssistantSettingsConfig = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseUrl: '',
  reasoningEffort: '',
  allowExternalNoteContent: false,
  allowWriteActions: false,
  maxContextNotes: ASSISTANT_DEFAULT_CONTEXT_NOTES,
  maxContextChars: ASSISTANT_DEFAULT_CONTEXT_CHARS,
  providerRetries: ASSISTANT_DEFAULT_PROVIDER_RETRIES,
  maxRequestChars: ASSISTANT_DEFAULT_REQUEST_CHARS,
  maxResponseChars: ASSISTANT_DEFAULT_RESPONSE_CHARS,
}

function normalizeAssistantInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  if (parsed < min) {
    return min
  }
  if (parsed > max) {
    return max
  }
  return parsed
}

function normalizeAssistantSettingsConfig(config: Partial<AssistantSettingsConfig> | null | undefined): AssistantSettingsConfig {
  return {
    ...DEFAULT_ASSISTANT_SETTINGS_CONFIG,
    ...(config ?? {}),
    provider: String(config?.provider || DEFAULT_ASSISTANT_SETTINGS_CONFIG.provider).trim().toLowerCase(),
    model: String(config?.model || DEFAULT_ASSISTANT_SETTINGS_CONFIG.model).trim(),
    baseUrl: String(config?.baseUrl || '').trim(),
    reasoningEffort: String(config?.reasoningEffort || '').trim().toLowerCase(),
    maxContextNotes: normalizeAssistantInt(
      config?.maxContextNotes ?? DEFAULT_ASSISTANT_SETTINGS_CONFIG.maxContextNotes,
      ASSISTANT_DEFAULT_CONTEXT_NOTES,
      ASSISTANT_MIN_CONTEXT_NOTES,
      ASSISTANT_MAX_CONTEXT_NOTES
    ),
    maxContextChars: normalizeAssistantInt(
      config?.maxContextChars ?? DEFAULT_ASSISTANT_SETTINGS_CONFIG.maxContextChars,
      ASSISTANT_DEFAULT_CONTEXT_CHARS,
      ASSISTANT_MIN_CONTEXT_CHARS,
      ASSISTANT_MAX_CONTEXT_CHARS
    ),
    providerRetries: normalizeAssistantInt(
      config?.providerRetries ?? DEFAULT_ASSISTANT_SETTINGS_CONFIG.providerRetries,
      ASSISTANT_DEFAULT_PROVIDER_RETRIES,
      ASSISTANT_MIN_PROVIDER_RETRIES,
      ASSISTANT_MAX_PROVIDER_RETRIES
    ),
    maxRequestChars: normalizeAssistantInt(
      config?.maxRequestChars ?? DEFAULT_ASSISTANT_SETTINGS_CONFIG.maxRequestChars,
      ASSISTANT_DEFAULT_REQUEST_CHARS,
      ASSISTANT_MIN_REQUEST_CHARS,
      ASSISTANT_MAX_REQUEST_CHARS
    ),
    maxResponseChars: normalizeAssistantInt(
      config?.maxResponseChars ?? DEFAULT_ASSISTANT_SETTINGS_CONFIG.maxResponseChars,
      ASSISTANT_DEFAULT_RESPONSE_CHARS,
      ASSISTANT_MIN_RESPONSE_CHARS,
      ASSISTANT_MAX_RESPONSE_CHARS
    ),
  }
}

function assistantSettingsEqual(left: AssistantSettingsConfig, right: AssistantSettingsConfig): boolean {
  return JSON.stringify(normalizeAssistantSettingsConfig(left)) === JSON.stringify(normalizeAssistantSettingsConfig(right))
}

type AssistantProviderOptionMeta = Record<string, unknown>

function assistantProviderLabel(settings: AssistantSettingsResponse | null, provider: string): string {
  const option = (settings?.providerOptions ?? []).find((item) => String(item.id || '').toLowerCase() === provider)
  return String(option?.label || provider || 'Provider')
}

function assistantProviderOption(settings: AssistantSettingsResponse | null, provider: string): AssistantProviderOptionMeta | null {
  return (settings?.providerOptions ?? []).find((item) => String(item.id || '').toLowerCase() === provider) ?? null
}

function assistantModelOptions(option: AssistantProviderOptionMeta | null): AssistantProviderOptionMeta[] {
  const rawModels = option?.models
  return Array.isArray(rawModels)
    ? rawModels.filter((item): item is AssistantProviderOptionMeta => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function assistantReasoningOptions(option: AssistantProviderOptionMeta | null, model: string): string[] {
  const selectedModel = assistantModelOptions(option).find((item) => String(item.id ?? '') === model)
  const rawEfforts = selectedModel?.reasoningEfforts
  return Array.isArray(rawEfforts) ? rawEfforts.map((item) => String(item)).filter(Boolean) : []
}

function assistantReasoningLabel(value: string): string {
  switch (value) {
    case 'minimal':
      return 'Minimal'
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    default:
      return 'Aus'
  }
}

type SettingsEditorPanelProps = {
  displayName: string
  theme: ThemeMode
  activeColorProfileId: string
  colorProfiles: ColorProfile[]
  backendUrl: string
  vaultLoaded: boolean
  sidebarOpen: boolean
  explorerOptions: ExplorerOptions
  statusBarPrefs: StatusBarPrefs
  taskFeatureSettings: TaskFeatureSettings
  settingsDirty: boolean
  onClose: () => void
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setExplorerOptions: Dispatch<SetStateAction<ExplorerOptions>>
  setStatusBarPrefs: Dispatch<SetStateAction<StatusBarPrefs>>
  setTaskFeatureSettings: Dispatch<SetStateAction<TaskFeatureSettings>>
  onDisplayNameChange: (nextRawValue: string) => void
  onActiveColorProfileChange: (profileId: string) => void
  onColorProfilesChange: Dispatch<SetStateAction<ColorProfile[]>>
  onSave: () => void
  onDiscard: () => void
  onOneNoteImportComplete: (response: OneNoteImportResponse) => void
}

type SettingsSectionId = 'general' | 'appearance' | 'assistant' | 'imports' | 'layout' | 'explorer' | 'statusbar' | 'tasks'

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  title: string
  eyebrow: string
  description: string
  icon: string
}> = [
  {
    id: 'general',
    title: 'Allgemein',
    eyebrow: 'Basis',
    description: 'Persoenliche Anzeige und Grundverhalten.',
    icon: 'User',
  },
  {
    id: 'appearance',
    title: 'Darstellung',
    eyebrow: 'Oberflaeche',
    description: 'Theme und visuelle Arbeitsweise.',
    icon: 'Palette',
  },
  {
    id: 'assistant',
    title: 'Assistant',
    eyebrow: 'LLM',
    description: 'Provider, Modell und Freigaben.',
    icon: 'Bot',
  },
  {
    id: 'imports',
    title: 'Import',
    eyebrow: 'Quellen',
    description: 'Inhalte aus anderen Systemen uebernehmen.',
    icon: 'Download',
  },
  {
    id: 'layout',
    title: 'Layout',
    eyebrow: 'Arbeitsflaeche',
    description: 'Sichtbarkeit und Aufbau der Hauptbereiche.',
    icon: 'PanelLeft',
  },
  {
    id: 'explorer',
    title: 'Note Explorer',
    eyebrow: 'Navigation',
    description: 'Dateien und Ordner in der NoteBase anzeigen.',
    icon: 'FolderTree',
  },
  {
    id: 'statusbar',
    title: 'Statusleiste',
    eyebrow: 'Feedback',
    description: 'Informationen am unteren Fensterrand steuern.',
    icon: 'PanelBottom',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    eyebrow: 'Arbeitsmodus',
    description: 'Aufgabenfunktionen fuer deinen Workflow.',
    icon: 'ListChecks',
  },
]

export function SettingsEditorPanel({
  displayName,
  theme,
  activeColorProfileId,
  colorProfiles,
  backendUrl,
  vaultLoaded,
  sidebarOpen,
  explorerOptions,
  statusBarPrefs,
  taskFeatureSettings,
  settingsDirty,
  onClose,
  setSidebarOpen,
  setExplorerOptions,
  setStatusBarPrefs,
  setTaskFeatureSettings,
  onDisplayNameChange,
  onActiveColorProfileChange,
  onColorProfilesChange,
  onSave,
  onDiscard,
  onOneNoteImportComplete,
}: SettingsEditorPanelProps) {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('general')
  const [oneNoteSourcePaths, setOneNoteSourcePaths] = useState<string[]>([])
  const [oneNoteTargetFolder, setOneNoteTargetFolder] = useState('')
  const [oneNotePreview, setOneNotePreview] = useState<OneNoteImportPreview | null>(null)
  const [oneNotePending, setOneNotePending] = useState(false)
  const [oneNoteMessage, setOneNoteMessage] = useState('')
  const [oneNoteError, setOneNoteError] = useState('')
  const [oneNoteImportStatus, setOneNoteImportStatus] = useState<OneNoteImportStatus | null>(null)
  const [themeColorDrafts, setThemeColorDrafts] = useState<Record<string, Record<string, string>>>({})
  const [themeNameDrafts, setThemeNameDrafts] = useState<Record<string, string>>({})
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettingsResponse | null>(null)
  const [assistantDraft, setAssistantDraft] = useState<AssistantSettingsConfig>(DEFAULT_ASSISTANT_SETTINGS_CONFIG)
  const [assistantPending, setAssistantPending] = useState(false)
  const [assistantProbePending, setAssistantProbePending] = useState(false)
  const [assistantProbeMessage, setAssistantProbeMessage] = useState('')
  const [assistantProbeError, setAssistantProbeError] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const [assistantError, setAssistantError] = useState('')
  const [assistantSecretEditorOpen, setAssistantSecretEditorOpen] = useState(false)
  const [assistantSecretDraft, setAssistantSecretDraft] = useState('')
  const [assistantSecretPending, setAssistantSecretPending] = useState(false)

  const formatOneNoteImportError = (caught: unknown): string => {
    if (caught instanceof Error) {
      const text = caught.message || 'Unbekannter Fehler.'
      try {
        const payload = JSON.parse(text)
        const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error
        const message = error?.message
        if (typeof message === 'string' && message.trim()) {
          const code = error?.code
          const detailEntries =
            error?.details && typeof error.details === 'object'
              ? Object.entries(error.details)
                  .map(([key, value]) => `${key}: ${String(value)}`)
                  .join(', ')
              : ''
          return code ? `${code}: ${message}${detailEntries ? ` (${detailEntries})` : ''}` : `${message}${detailEntries ? ` (${detailEntries})` : ''}`
        }
      } catch {
        // Fallthrough to plain error text.
      }
      return text
    }

    return 'Unbekannter Fehler.'
  }

  useEffect(() => {
    if (!oneNotePending) {
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const status = await apiRequest<OneNoteImportStatus>(backendUrl, '/imports/onenote/status')
        if (!cancelled) {
          setOneNoteImportStatus(status)
        }
      } catch {
        // The actual import request reports the error; polling is only for progress UI.
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [backendUrl, oneNotePending])

  useEffect(() => {
    if (activeSectionId !== 'assistant') {
      return
    }
    if (!vaultLoaded) {
      setAssistantSettings(null)
      setAssistantDraft(DEFAULT_ASSISTANT_SETTINGS_CONFIG)
      setAssistantMessage('')
      setAssistantError('')
      setAssistantProbeMessage('')
      setAssistantProbeError('')
      setAssistantSecretEditorOpen(false)
      setAssistantSecretDraft('')
      return
    }

    let cancelled = false
    setAssistantPending(true)
    setAssistantError('')
    void apiRequest<AssistantSettingsResponse>(backendUrl, '/assistant/settings')
      .then((response) => {
        if (cancelled) {
          return
        }
        const config = normalizeAssistantSettingsConfig(response.config)
        setAssistantSettings({ ...response, config })
        setAssistantDraft(config)
        setAssistantMessage('')
        setAssistantProbeMessage('')
        setAssistantProbeError('')
        setAssistantSecretEditorOpen(false)
        setAssistantSecretDraft('')
      })
      .catch((caught) => {
        if (!cancelled) {
          setAssistantError(formatOneNoteImportError(caught))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAssistantPending(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeSectionId, backendUrl, vaultLoaded])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const chooseOneNoteSources = async () => {
    const selected = await window.nicknotes?.selectImportSources?.()
    if (!selected || selected.length === 0) {
      return
    }
    setOneNoteSourcePaths((prev) => {
      const merged = [...prev]
      for (const path of selected) {
        if (!merged.includes(path)) {
          merged.push(path)
        }
      }
      return merged
    })
    setOneNotePreview(null)
    setOneNoteMessage('')
    setOneNoteError('')
  }

  const previewOneNoteImport = async () => {
    if (!oneNoteSourcePaths.length) {
      setOneNoteError('Bitte mindestens eine .onepkg-Datei auswaehlen.')
      return
    }
    setOneNotePending(true)
    setOneNoteImportStatus(null)
    setOneNoteError('')
    setOneNoteMessage('')
    try {
      const response = await apiRequest<OneNoteImportPreview>(backendUrl, '/imports/onenote/preview', {
        method: 'POST',
        body: JSON.stringify({ sourcePaths: oneNoteSourcePaths }),
      })
      setOneNotePreview(response)
      if (response.pages === 0 && oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'))) {
        setOneNoteMessage('.onepkg erkannt. Die Seiten werden erst beim Import ueber OneNote Desktop ermittelt.')
      } else {
        setOneNoteMessage(`${response.pages} Seiten fuer den Import gefunden.`)
      }
    } catch (caught) {
      setOneNoteError(formatOneNoteImportError(caught))
    } finally {
      setOneNotePending(false)
    }
  }

  const startOneNoteImport = async () => {
    if (!oneNoteSourcePaths.length) {
      setOneNoteError('Bitte mindestens eine .onepkg-Datei auswaehlen.')
      return
    }
    const hasOnePkgSource = oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'))
    if (hasOnePkgSource) {
      const confirmed = window.confirm(
        'Der Import von .onepkg-Dateien benoetigt OneNote Desktop. OneNote kann waehrend des Imports sichtbar geoeffnet werden. Import fortsetzen?'
      )
      if (!confirmed) {
        return
      }
    }
    setOneNotePending(true)
    setOneNoteImportStatus({
      active: true,
      done: false,
      error: null,
      phase: 'Import wird vorbereitet ...',
      processed: 0,
      total: 0,
      currentPath: null,
      result: null,
    })
    setOneNoteError('')
    setOneNoteMessage('Import laeuft ...')
    try {
      const response = await apiRequest<OneNoteImportResponse>(backendUrl, '/imports/onenote/start', {
        method: 'POST',
        body: JSON.stringify({ sourcePaths: oneNoteSourcePaths, targetFolder: oneNoteTargetFolder }),
      })
      onOneNoteImportComplete(response)
      setOneNotePreview(null)
      setOneNoteMessage(
        `Import abgeschlossen: ${response.import?.importedPages ?? 0} Seiten, ${response.import?.mediaFiles ?? 0} Medien.`
      )
      setOneNoteImportStatus((prev) => ({
        active: false,
        done: true,
        error: null,
        errorCode: undefined,
        errorDetails: undefined,
        phase: 'Import abgeschlossen.',
        processed: response.import?.importedPages ?? prev?.processed ?? 0,
        total: Math.max(response.import?.importedPages ?? prev?.total ?? 1, 1),
        currentPath: null,
        result: response,
      }))
    } catch (caught) {
      setOneNoteError(formatOneNoteImportError(caught))
      setOneNoteImportStatus((prev) =>
        prev
          ? {
              ...prev,
              active: false,
              done: true,
              error: formatOneNoteImportError(caught),
              errorCode: 'onenote-import-unexpected',
              errorDetails: { error: formatOneNoteImportError(caught) },
              phase: 'Import fehlgeschlagen.',
            }
          : null
      )
    } finally {
      setOneNotePending(false)
    }
  }

  const oneNoteHasPackageSource = oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'))
  const oneNoteProgressPercent =
    oneNoteImportStatus && oneNoteImportStatus.total > 0
      ? Math.max(0, Math.min(100, Math.round((oneNoteImportStatus.processed / oneNoteImportStatus.total) * 100)))
      : 0
  const activeSection = useMemo(
    () => SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ?? SETTINGS_SECTIONS[0],
    [activeSectionId]
  )
  const selectedColorProfile = colorProfiles.find((profile) => profile.id === activeColorProfileId) ?? colorProfiles.find((profile) => profile.id === theme)
  const selectedThemeEditable = Boolean(selectedColorProfile && !selectedColorProfile.builtin)
  const assistantSettingsDirty = assistantSettings
    ? !assistantSettingsEqual(assistantDraft, assistantSettings.config)
    : false
  const activeSectionIsAssistant = activeSectionId === 'assistant'
  const footerDirty = activeSectionIsAssistant ? assistantSettingsDirty : settingsDirty
  const selectedAssistantProviderOption = assistantProviderOption(assistantSettings, assistantDraft.provider)
  const selectedAssistantProviderLabel = assistantProviderLabel(assistantSettings, assistantDraft.provider)
  const selectedAssistantModelOptions = assistantModelOptions(selectedAssistantProviderOption)
  const selectedAssistantReasoningOptions = assistantReasoningOptions(selectedAssistantProviderOption, assistantDraft.model)

  const updateAssistantDraft = (patch: Partial<AssistantSettingsConfig>) => {
    setAssistantDraft((prev) => normalizeAssistantSettingsConfig({ ...prev, ...patch }))
    setAssistantMessage('')
    setAssistantError('')
    setAssistantProbeMessage('')
    setAssistantProbeError('')
  }

  const selectAssistantProvider = (provider: string) => {
    const providerId = String(provider || '').trim().toLowerCase()
    const option = (assistantSettings?.providerOptions ?? []).find((item) => String(item.id || '').toLowerCase() === providerId)
    const defaultModel = String(option?.defaultModel || '').trim() || assistantDraft.model
    updateAssistantDraft({
      provider: providerId,
      model: defaultModel,
      reasoningEffort: '',
      baseUrl: '',
    })
    setAssistantSecretEditorOpen(false)
    setAssistantSecretDraft('')
  }

  const saveAssistantSettings = async () => {
    if (!vaultLoaded) {
      return
    }
    setAssistantPending(true)
    setAssistantError('')
    setAssistantMessage('')
    try {
      const response = await apiRequest<AssistantSettingsResponse>(backendUrl, '/assistant/settings', {
        method: 'PUT',
        body: JSON.stringify(normalizeAssistantSettingsConfig(assistantDraft)),
      })
      const config = normalizeAssistantSettingsConfig(response.config)
      setAssistantSettings({ ...response, config })
      setAssistantDraft(config)
      setAssistantMessage('Assistant-Einstellungen gespeichert.')
      setAssistantProbeMessage('')
      setAssistantProbeError('')
    } catch (caught) {
      setAssistantError(formatOneNoteImportError(caught))
    } finally {
      setAssistantPending(false)
    }
  }

  const discardAssistantSettings = () => {
    if (!assistantSettings) {
      return
    }
    setAssistantDraft(normalizeAssistantSettingsConfig(assistantSettings.config))
    setAssistantMessage('')
    setAssistantError('')
    setAssistantProbeMessage('')
    setAssistantProbeError('')
    setAssistantSecretEditorOpen(false)
    setAssistantSecretDraft('')
  }

  const applyAssistantSettingsResponse = (response: AssistantSettingsResponse, options: { preserveDraft?: boolean } = {}) => {
    const config = normalizeAssistantSettingsConfig(response.config)
    setAssistantSettings({ ...response, config })
    if (options.preserveDraft) {
      setAssistantDraft((prev) =>
        normalizeAssistantSettingsConfig({
          ...prev,
          provider: config.provider,
          model: prev.model || config.model,
          reasoningEffort: prev.reasoningEffort || config.reasoningEffort,
        }),
      )
      return
    }
    setAssistantDraft(config)
  }

  const saveAssistantSecret = async () => {
    const apiKey = assistantSecretDraft.trim()
    if (!vaultLoaded || assistantSecretPending || apiKey.length < 8) {
      if (apiKey.length > 0 && apiKey.length < 8) {
        setAssistantError('Der API-Key ist zu kurz.')
      }
      return
    }
    setAssistantSecretPending(true)
    setAssistantError('')
    setAssistantMessage('')
    setAssistantProbeMessage('')
    setAssistantProbeError('')
    try {
      const response = await apiRequest<AssistantSettingsResponse>(backendUrl, '/assistant/provider/secret', {
        method: 'PUT',
        body: JSON.stringify({ provider: assistantDraft.provider, apiKey }),
      })
      applyAssistantSettingsResponse(response, { preserveDraft: true })
      setAssistantSecretDraft('')
      setAssistantSecretEditorOpen(false)
      setAssistantMessage(`API-Key fuer ${assistantProviderLabel(response, response.config.provider)} gespeichert.`)
    } catch (caught) {
      setAssistantError(formatOneNoteImportError(caught))
    } finally {
      setAssistantSecretPending(false)
    }
  }

  const deleteAssistantSecret = async () => {
    if (!vaultLoaded || assistantSecretPending || !assistantSettings?.secretConfigured) {
      return
    }
    const confirmed = window.confirm(`API-Key fuer ${selectedAssistantProviderLabel} aus NickNotes entfernen?`)
    if (!confirmed) {
      return
    }
    setAssistantSecretPending(true)
    setAssistantError('')
    setAssistantMessage('')
    setAssistantProbeMessage('')
    setAssistantProbeError('')
    try {
      const response = await apiRequest<AssistantSettingsResponse>(
        backendUrl,
        `/assistant/provider/secret/${encodeURIComponent(assistantDraft.provider)}`,
        { method: 'DELETE' },
      )
      applyAssistantSettingsResponse(response, { preserveDraft: true })
      setAssistantSecretDraft('')
      setAssistantSecretEditorOpen(false)
      setAssistantMessage(`API-Key fuer ${selectedAssistantProviderLabel} geloescht.`)
    } catch (caught) {
      setAssistantError(formatOneNoteImportError(caught))
    } finally {
      setAssistantSecretPending(false)
    }
  }

  const testAssistantProvider = async () => {
    if (!vaultLoaded || assistantSettingsDirty || assistantProbePending) {
      return
    }
    setAssistantProbePending(true)
    setAssistantProbeMessage('')
    setAssistantProbeError('')
    try {
      const response = await apiRequest<AssistantProviderProbeResponse>(backendUrl, '/assistant/provider/probe', {
        method: 'POST',
      })
      const providerLabel = [response.provider, response.model].filter(Boolean).join(' / ')
      const privacyHint = response.noteContentSent
        ? 'Pruefe die Provider-Freigabe, der Test meldet gesendete Inhalte.'
        : 'Es wurden keine Notizinhalte gesendet.'
      if (response.ok) {
        setAssistantProbeMessage(
          `${response.message || 'Provider-Test erfolgreich.'}${providerLabel ? ` (${providerLabel})` : ''} ${privacyHint}`,
        )
      } else {
        setAssistantProbeError(
          `${response.message || 'Provider-Test fehlgeschlagen.'}${providerLabel ? ` (${providerLabel})` : ''} ${privacyHint}`,
        )
      }
    } catch (caught) {
      setAssistantProbeError(formatOneNoteImportError(caught))
    } finally {
      setAssistantProbePending(false)
    }
  }

  useEffect(() => {
    setThemeColorDrafts(() => {
      const next: Record<string, Record<string, string>> = {}
      for (const profile of colorProfiles) {
        next[profile.id] = { ...profile.colors }
      }
      return next
    })
    setThemeNameDrafts(() => {
      const next: Record<string, string> = {}
      for (const profile of colorProfiles) {
        next[profile.id] = profile.name
      }
      return next
    })
  }, [colorProfiles])

  const createCustomColorProfile = () => {
    const source = selectedColorProfile ?? (theme === 'dark' ? DEFAULT_DARK_COLOR_PROFILE : DEFAULT_LIGHT_COLOR_PROFILE)
    const existingIds = new Set(colorProfiles.map((profile) => profile.id))
    let counter = 1
    let id = `custom-${counter}`
    while (existingIds.has(id)) {
      counter += 1
      id = `custom-${counter}`
    }
    const existingNames = new Set(colorProfiles.map((profile) => profile.name.trim().toLowerCase()))
    let nameCounter = 1
    let profileName = 'New Theme'
    while (existingNames.has(profileName.toLowerCase())) {
      nameCounter += 1
      profileName = `New Theme ${nameCounter}`
    }
    const nextProfile: ColorProfile = {
      id,
      name: profileName,
      baseTheme: source.baseTheme,
      colors: { ...source.colors },
    }
    onColorProfilesChange((prev) => [...prev, nextProfile])
    onActiveColorProfileChange(nextProfile.id)
  }

  const updateCustomColorProfile = (profileId: string, updater: (profile: ColorProfile) => ColorProfile) => {
    onColorProfilesChange((prev) =>
      prev.map((profile) => {
        if (profile.id !== profileId || profile.builtin) {
          return profile
        }
        return updater(profile)
      })
    )
  }

  const removeCustomColorProfile = (profileId: string) => {
    const profile = colorProfiles.find((entry) => entry.id === profileId)
    if (!profile || profile.builtin) {
      return
    }
    onColorProfilesChange((prev) => prev.filter((entry) => entry.id !== profileId))
    onActiveColorProfileChange(profile.baseTheme)
  }

  const commitThemeColor = (profileId: string, token: ThemeColorToken, rawValue: string) => {
    const currentProfile = colorProfiles.find((profile) => profile.id === profileId)
    if (!currentProfile || currentProfile.builtin) {
      return
    }
    const currentValue = currentProfile.colors[token]
    const nextColor = normalizeCssColor(rawValue, currentValue)
    setThemeColorDrafts((prev) => ({
      ...prev,
      [profileId]: {
        ...(prev[profileId] ?? {}),
        [token]: nextColor,
      },
    }))
    if (nextColor === currentValue) {
      return
    }
    updateCustomColorProfile(profileId, (profile) => ({
      ...profile,
      colors: { ...profile.colors, [token]: nextColor },
    }))
  }

  const commitThemeName = (profileId: string, rawValue: string) => {
    const currentProfile = colorProfiles.find((profile) => profile.id === profileId)
    if (!currentProfile || currentProfile.builtin) {
      return
    }
    const nextName = normalizeLabel(rawValue) || 'New Theme'
    setThemeNameDrafts((prev) => ({ ...prev, [profileId]: nextName }))
    if (nextName === currentProfile.name) {
      return
    }
    updateCustomColorProfile(profileId, (profile) => ({ ...profile, name: nextName }))
  }

  return (
    <div
      className="modal-overlay settings-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <aside className="settings-nav" aria-label="Einstellungsbereiche">
          <div className="settings-nav-heading">
            <span>Optionen</span>
            <strong id="settings-modal-title">Einstellungen</strong>
          </div>
          <nav>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={section.id === activeSectionId ? 'active' : ''}
                onClick={() => setActiveSectionId(section.id)}
              >
                <LucideNamedIcon name={section.icon} size={15} />
                <span>{section.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          <header className="settings-content-header">
            <div>
              <span>{activeSection.eyebrow}</span>
              <h3>{activeSection.title}</h3>
              <p>{activeSection.description}</p>
            </div>
            <button className="icon-button compact muted" onClick={onClose} title="Einstellungen schliessen" aria-label="Einstellungen schliessen">
              <LucideNamedIcon name="X" size={16} />
            </button>
          </header>

          <div className="settings-section-body">
            {activeSectionId === 'general' ? (
              <section className="settings-block">
                <div className="settings-row">
                  <div>
                    <label htmlFor="settings-display-name">Anrede</label>
                    <p className="muted-copy">Name, mit dem NickNotes dich in der Oberflaeche anspricht.</p>
                  </div>
                  <input
                    id="settings-display-name"
                    value={displayName}
                    onChange={(event) => onDisplayNameChange(event.target.value)}
                    placeholder="Dein Name"
                  />
                </div>
              </section>
            ) : null}

            {activeSectionId === 'appearance' ? (
              <section className="settings-block">
                <div className="settings-row">
                  <div>
                    <h4>Theme</h4>
                    <p className="muted-copy">Farben fuer die gesamte App.</p>
                  </div>
                  <select value={selectedColorProfile?.id ?? theme} onChange={(event) => onActiveColorProfileChange(event.target.value)}>
                    {colorProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="theme-profile-actions">
                  <button type="button" onClick={createCustomColorProfile}>
                    Neues Theme
                  </button>
                  {selectedThemeEditable && selectedColorProfile ? (
                    <button type="button" className="danger" onClick={() => removeCustomColorProfile(selectedColorProfile.id)}>
                      Theme loeschen
                    </button>
                  ) : null}
                </div>
                {selectedColorProfile ? (
                  <div className="theme-profile-editor">
                    <div className="settings-row">
                      <div>
                        <label htmlFor="settings-color-profile-name">Theme-Name</label>
                        <p className="muted-copy">Light Mode und Dark Mode sind feste Standard-Themes.</p>
                      </div>
                      <input
                        id="settings-color-profile-name"
                        value={themeNameDrafts[selectedColorProfile.id] ?? selectedColorProfile.name}
                        disabled={!selectedThemeEditable}
                        onChange={(event) => {
                          const nextName = event.target.value
                          setThemeNameDrafts((prev) => ({ ...prev, [selectedColorProfile.id]: nextName }))
                        }}
                        onBlur={(event) => {
                          commitThemeName(selectedColorProfile.id, event.currentTarget.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitThemeName(selectedColorProfile.id, event.currentTarget.value)
                            event.currentTarget.blur()
                          }
                        }}
                      />
                    </div>
                    {THEME_COLOR_TOKEN_GROUPS.map((group) => (
                      <section key={group.title} className="theme-token-group">
                        <h4>{group.title}</h4>
                        <div className="theme-token-grid">
                          {group.tokens.map((token: ThemeColorToken) => {
                            const value = themeColorDrafts[selectedColorProfile.id]?.[token] ?? selectedColorProfile.colors[token]
                            const colorInputValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'
                            return (
                              <label key={token} className="theme-token-row">
                                <span>{THEME_COLOR_TOKEN_LABELS[token]}</span>
                                <input
                                  type="color"
                                  value={colorInputValue}
                                  disabled={!selectedThemeEditable}
                                  onChange={(event) => {
                                    const nextColor = event.target.value
                                    setThemeColorDrafts((prev) => ({
                                      ...prev,
                                      [selectedColorProfile.id]: {
                                        ...(prev[selectedColorProfile.id] ?? {}),
                                        [token]: nextColor,
                                      },
                                    }))
                                  }}
                                  onBlur={(event) => {
                                    commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value)
                                  }}
                                />
                                <input
                                  value={value}
                                  disabled={!selectedThemeEditable}
                                  onChange={(event) => {
                                    const nextColor = event.target.value
                                    setThemeColorDrafts((prev) => ({
                                      ...prev,
                                      [selectedColorProfile.id]: {
                                        ...(prev[selectedColorProfile.id] ?? {}),
                                        [token]: nextColor,
                                      },
                                    }))
                                  }}
                                  onBlur={(event) => {
                                    commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value)
                                      event.currentTarget.blur()
                                    }
                                  }}
                                />
                              </label>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeSectionId === 'assistant' ? (
              <section className="settings-block">
                {!vaultLoaded ? (
                  <div className="settings-row">
                    <div>
                      <h4>Keine NoteBase geoeffnet</h4>
                      <p className="muted-copy">Assistant-Einstellungen werden pro NoteBase gespeichert.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="settings-toggle-row" htmlFor="settings-assistant-enabled">
                      <span>
                        <strong>Assistant aktivieren</strong>
                        <small>Chat und lokale Assistant-Funktionen fuer diese NoteBase freischalten.</small>
                      </span>
                      <input
                        id="settings-assistant-enabled"
                        type="checkbox"
                        checked={assistantDraft.enabled}
                        disabled={assistantPending}
                        onChange={(event) => updateAssistantDraft({ enabled: event.target.checked })}
                      />
                    </label>
                    <div className="settings-subsection">
                      <div className="settings-subsection-header">
                        <strong>Provider und API-Key</strong>
                        <span>{selectedAssistantProviderLabel}</span>
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-provider">Provider</label>
                          <p className="muted-copy">Aktiver Adapter fuer Chat-Antworten.</p>
                        </div>
                        <select
                          id="settings-assistant-provider"
                          value={assistantDraft.provider}
                          disabled={assistantPending || assistantSecretPending}
                          onChange={(event) => selectAssistantProvider(event.target.value)}
                        >
                          {(assistantSettings?.providerOptions ?? [{ id: 'openai', label: 'OpenAI / GPT', status: 'available' }]).map((option) => (
                            <option key={String(option.id)} value={String(option.id)} disabled={String(option.status) !== 'available'}>
                              {String(option.label)}
                              {String(option.status) === 'planned' ? ' (geplant)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="assistant-key-panel">
                        <div className="assistant-key-state">
                          <span className={assistantSettings?.secretConfigured ? 'ok' : 'warn'}>
                            <LucideNamedIcon name={assistantSettings?.secretConfigured ? 'KeyRound' : 'TriangleAlert'} size={14} />
                            {assistantSettings?.secretConfigured ? 'API-Key hinterlegt' : 'Kein API-Key hinterlegt'}
                          </span>
                          <small>{assistantSettings?.secretName ? `NickNotes-Key-Slot: ${assistantSettings.secretName}` : selectedAssistantProviderLabel}</small>
                        </div>
                        <div className="assistant-key-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setAssistantSecretEditorOpen(true)
                              setAssistantSecretDraft('')
                              setAssistantError('')
                              setAssistantMessage('')
                            }}
                            disabled={assistantPending || assistantSecretPending}
                          >
                            <LucideNamedIcon name="KeyRound" size={13} />
                            <span>{assistantSettings?.secretConfigured ? 'Key ersetzen' : 'Key hinterlegen'}</span>
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => void deleteAssistantSecret()}
                            disabled={assistantPending || assistantSecretPending || !assistantSettings?.secretConfigured}
                          >
                            <LucideNamedIcon name="Trash2" size={13} />
                            <span>Key loeschen</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void testAssistantProvider()}
                            disabled={
                              assistantPending ||
                              assistantSecretPending ||
                              assistantProbePending ||
                              assistantSettingsDirty ||
                              !assistantSettings?.providerConfigured
                            }
                            title={assistantSettingsDirty ? 'Einstellungen zuerst speichern' : 'Provider-Verbindung testen'}
                          >
                            <LucideNamedIcon name="PlugZap" size={13} />
                            <span>{assistantProbePending ? 'Test laeuft ...' : 'Verbindung testen'}</span>
                          </button>
                        </div>
                      </div>
                      {assistantSecretEditorOpen ? (
                        <div className="assistant-secret-editor">
                          <label htmlFor="settings-assistant-api-key">API-Key fuer {selectedAssistantProviderLabel}</label>
                          <div className="assistant-secret-input-row">
                            <input
                              id="settings-assistant-api-key"
                              type="password"
                              value={assistantSecretDraft}
                              autoComplete="off"
                              spellCheck={false}
                              disabled={assistantSecretPending}
                              onChange={(event) => {
                                setAssistantSecretDraft(event.target.value)
                                setAssistantError('')
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void saveAssistantSecret()
                                }
                                if (event.key === 'Escape') {
                                  setAssistantSecretEditorOpen(false)
                                  setAssistantSecretDraft('')
                                }
                              }}
                              placeholder="API-Key einfuegen"
                            />
                            <button
                              type="button"
                              className="primary"
                              onClick={() => void saveAssistantSecret()}
                              disabled={assistantSecretPending || assistantSecretDraft.trim().length < 8}
                            >
                              <LucideNamedIcon name="Save" size={13} />
                              <span>{assistantSecretPending ? 'Speichert ...' : 'Speichern'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAssistantSecretEditorOpen(false)
                                setAssistantSecretDraft('')
                              }}
                              disabled={assistantSecretPending}
                            >
                              <LucideNamedIcon name="X" size={13} />
                              <span>Abbrechen</span>
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {assistantProbeMessage ? <p className="launch-message">{assistantProbeMessage}</p> : null}
                      {assistantProbeError ? <p className="launch-error">{assistantProbeError}</p> : null}
                    </div>

                    <div className="settings-subsection">
                      <div className="settings-subsection-header">
                        <strong>Modell</strong>
                        <span>{assistantDraft.model || 'Standard'}</span>
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-model">Modell</label>
                          <p className="muted-copy">Kann jederzeit gewechselt werden.</p>
                        </div>
                        <select
                          id="settings-assistant-model"
                          value={assistantDraft.model}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ model: event.target.value, reasoningEffort: '' })}
                        >
                          {assistantDraft.model && !selectedAssistantModelOptions.some((option) => String(option.id || '') === assistantDraft.model) ? (
                            <option value={assistantDraft.model}>{assistantDraft.model}</option>
                          ) : null}
                          {(selectedAssistantModelOptions.length ? selectedAssistantModelOptions : [{ id: assistantDraft.model || 'gpt-4.1-mini', label: assistantDraft.model || 'gpt-4.1-mini' }]).map((option) => (
                            <option key={String(option.id)} value={String(option.id)}>
                              {String(option.label || option.id)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {selectedAssistantReasoningOptions.length > 0 ? (
                        <div className="settings-row">
                          <div>
                            <label htmlFor="settings-assistant-reasoning">Reasoning</label>
                            <p className="muted-copy">Steuert den Denkaufwand fuer unterstuetzte Modelle.</p>
                          </div>
                          <select
                            id="settings-assistant-reasoning"
                            value={assistantDraft.reasoningEffort}
                            disabled={assistantPending}
                            onChange={(event) => updateAssistantDraft({ reasoningEffort: event.target.value })}
                          >
                            <option value="">Aus</option>
                            {selectedAssistantReasoningOptions.map((effort) => (
                              <option key={effort} value={effort}>
                                {assistantReasoningLabel(effort)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-base-url">Endpoint</label>
                          <p className="muted-copy">Optionaler Provider-Endpunkt oder lokaler Proxy.</p>
                        </div>
                        <input
                          id="settings-assistant-base-url"
                          value={assistantDraft.baseUrl}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ baseUrl: event.target.value })}
                          placeholder="https://api.openai.com/v1/responses"
                        />
                      </div>
                    </div>

                    <div className="settings-subsection">
                      <div className="settings-subsection-header">
                        <strong>Freigaben</strong>
                        <span>{assistantDraft.allowExternalNoteContent ? 'Provider-Kontext erlaubt' : 'Lokal geschuetzt'}</span>
                      </div>
                      <label className="settings-toggle-row" htmlFor="settings-assistant-external">
                        <span>
                          <strong>Externe Notizinhalte erlauben</strong>
                          <small>Erst danach duerfen relevante Ausschnitte an den Provider gesendet werden.</small>
                        </span>
                        <input
                          id="settings-assistant-external"
                          type="checkbox"
                          checked={assistantDraft.allowExternalNoteContent}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ allowExternalNoteContent: event.target.checked })}
                        />
                      </label>
                      <label className="settings-toggle-row" htmlFor="settings-assistant-write">
                        <span>
                          <strong>Schreibvorschlaege erlauben</strong>
                          <small>ChangeSets fuer Notizen, Tasks und Verschieben zusaetzlich freischalten.</small>
                        </span>
                        <input
                          id="settings-assistant-write"
                          type="checkbox"
                          checked={assistantDraft.allowWriteActions}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ allowWriteActions: event.target.checked })}
                        />
                      </label>
                    </div>

                    <div className="settings-subsection">
                      <div className="settings-subsection-header">
                        <strong>Kontext</strong>
                        <span>{assistantDraft.maxContextNotes} Quellen</span>
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-max-notes">Quellenlimit</label>
                          <p className="muted-copy">Maximale Anzahl Kontextnotizen pro Chatfrage.</p>
                        </div>
                        <input
                          id="settings-assistant-max-notes"
                          type="number"
                          min={ASSISTANT_MIN_CONTEXT_NOTES}
                          max={ASSISTANT_MAX_CONTEXT_NOTES}
                          value={assistantDraft.maxContextNotes}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ maxContextNotes: Number(event.target.value) })}
                        />
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-max-chars">Kontextlimit</label>
                          <p className="muted-copy">Maximale Zeichenmenge fuer lokalen Quellenkontext.</p>
                        </div>
                        <input
                          id="settings-assistant-max-chars"
                          type="number"
                          min={ASSISTANT_MIN_CONTEXT_CHARS}
                          max={ASSISTANT_MAX_CONTEXT_CHARS}
                          step={1000}
                          value={assistantDraft.maxContextChars}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ maxContextChars: Number(event.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="settings-subsection">
                      <div className="settings-subsection-header">
                        <strong>Providergrenzen</strong>
                        <span>{assistantDraft.providerRetries} Wiederholungsversuche</span>
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-provider-retries">Retry-Limit</label>
                          <p className="muted-copy">Wiederholung bei voruebergehenden Provider-Fehlern.</p>
                        </div>
                        <input
                          id="settings-assistant-provider-retries"
                          type="number"
                          min={ASSISTANT_MIN_PROVIDER_RETRIES}
                          max={ASSISTANT_MAX_PROVIDER_RETRIES}
                          value={assistantDraft.providerRetries}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ providerRetries: Number(event.target.value) })}
                        />
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-max-request-chars">Request-Limit</label>
                          <p className="muted-copy">Maximale Zeichen pro Provider-Request.</p>
                        </div>
                        <input
                          id="settings-assistant-max-request-chars"
                          type="number"
                          min={ASSISTANT_MIN_REQUEST_CHARS}
                          max={ASSISTANT_MAX_REQUEST_CHARS}
                          step={1000}
                          value={assistantDraft.maxRequestChars}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ maxRequestChars: Number(event.target.value) })}
                        />
                      </div>
                      <div className="settings-row">
                        <div>
                          <label htmlFor="settings-assistant-max-response-chars">Response-Limit</label>
                          <p className="muted-copy">Maximale Zeichen im Provider-Response.</p>
                        </div>
                        <input
                          id="settings-assistant-max-response-chars"
                          type="number"
                          min={ASSISTANT_MIN_RESPONSE_CHARS}
                          max={ASSISTANT_MAX_RESPONSE_CHARS}
                          step={1000}
                          value={assistantDraft.maxResponseChars}
                          disabled={assistantPending}
                          onChange={(event) => updateAssistantDraft({ maxResponseChars: Number(event.target.value) })}
                        />
                      </div>
                    </div>
                    {assistantMessage ? <p className="launch-message">{assistantMessage}</p> : null}
                    {assistantError ? <p className="launch-error">{assistantError}</p> : null}
                  </>
                )}
              </section>
            ) : null}

            {activeSectionId === 'imports' ? (
              <section className="settings-block">
                <div className="import-tool-panel">
          <div className="import-tool-header">
            <div>
              <strong>OneNote importieren</strong>
              <p className="muted-copy">Eine oder mehrere .onepkg-Dateien waehlen und ueber OneNote Desktop importieren.</p>
            </div>
            <button onClick={() => void chooseOneNoteSources()} disabled={!vaultLoaded || oneNotePending}>
              Dateien waehlen
            </button>
          </div>

          <label htmlFor="settings-onenote-target">Zielordner in der NoteBase</label>
          <input
            id="settings-onenote-target"
            value={oneNoteTargetFolder}
            onChange={(event) => setOneNoteTargetFolder(event.target.value)}
            placeholder="Leer lassen fuer oberste Ebene"
            disabled={!vaultLoaded || oneNotePending}
          />

          {oneNoteSourcePaths.length ? (
            <div className="import-source-list">
              {oneNoteSourcePaths.map((path) => (
                <div key={path} className="import-source-row">
                  <span title={path}>{path}</span>
                  <button
                    onClick={() => {
                      setOneNoteSourcePaths((prev) => prev.filter((item) => item !== path))
                      setOneNotePreview(null)
                    }}
                    disabled={oneNotePending}
                  >
                    Entfernen
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {oneNoteHasPackageSource ? (
            <p className="import-info-note">
              .onepkg-Import benoetigt OneNote Desktop. NickNotes laesst OneNote die Paketdatei temporaer oeffnen
              und uebernimmt danach die Seiten in deine NoteBase.
            </p>
          ) : null}

          <div className="import-actions">
            <button onClick={() => void previewOneNoteImport()} disabled={!vaultLoaded || oneNotePending || oneNoteSourcePaths.length === 0}>
              Vorschau
            </button>
            <button
              className="primary"
              onClick={() => void startOneNoteImport()}
              disabled={!vaultLoaded || oneNotePending || oneNoteSourcePaths.length === 0}
            >
              {oneNotePending ? 'Bitte warten ...' : 'Import starten'}
            </button>
          </div>

          {oneNotePreview ? (
            <div className="import-preview-box">
              <div className="import-preview-stats">
                <span>{oneNotePreview.notebooks} Notizbuecher</span>
                <span>Seiten werden beim Import ermittelt</span>
              </div>
              {oneNotePreview.warnings.length ? (
                <ul className="import-warning-list">
                  {oneNotePreview.warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {oneNotePreview.pagesPreview.length ? (
                <div className="import-page-preview">
                  {oneNotePreview.pagesPreview.slice(0, 8).map((page) => (
                    <div key={page.sourcePath}>
                      <strong>{page.title}</strong>
                      <span>
                        {page.notebook}
                        {page.section ? ` / ${page.section}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {oneNoteImportStatus ? (
            <div className="launch-progress">
              <div className="launch-progress-header">
                <span>{oneNoteImportStatus.phase || 'Import laeuft ...'}</span>
                <strong>{oneNoteImportStatus.total > 0 ? `${oneNoteProgressPercent}%` : '...'}</strong>
              </div>
              <div className={`launch-progress-track ${oneNoteImportStatus.total > 0 ? '' : 'indeterminate'}`}>
                <span style={{ width: oneNoteImportStatus.total > 0 ? `${oneNoteProgressPercent}%` : '42%' }} />
              </div>
              <p className="launch-progress-meta">
                {oneNoteImportStatus.total > 0
                  ? `${oneNoteImportStatus.processed} von ${oneNoteImportStatus.total} Seiten`
                  : 'OneNote bereitet die Seiten vor ...'}
              </p>
              {oneNoteImportStatus.currentPath ? (
                <p className="launch-progress-path">{oneNoteImportStatus.currentPath}</p>
              ) : null}
            </div>
          ) : null}

          {oneNoteMessage ? <p className="launch-message">{oneNoteMessage}</p> : null}
          {oneNoteError ? <p className="launch-error">{oneNoteError}</p> : null}
                </div>
              </section>
            ) : null}

            {activeSectionId === 'layout' ? (
              <section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-sidebar-open">
                  <span>
                    <strong>Sidebar anzeigen</strong>
                    <small>Linken Arbeitsbereich beim Start sichtbar halten.</small>
                  </span>
                  <input
                    id="settings-sidebar-open"
                    type="checkbox"
                    checked={sidebarOpen}
                    onChange={(event) => setSidebarOpen(event.target.checked)}
                  />
                </label>
              </section>
            ) : null}

            {activeSectionId === 'explorer' ? (
              <section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-explorer-show-hidden">
                  <span>
                    <strong>Nicht-Markdown-Dateien anzeigen</strong>
                    <small>Auch Hilfsdateien und andere Dateitypen im Explorer einblenden.</small>
                  </span>
                  <input
                    id="settings-explorer-show-hidden"
                    type="checkbox"
                    checked={explorerOptions.showHiddenFiles}
                    onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showHiddenFiles: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-folders-first">
                  <span>
                    <strong>Ordner zuerst anzeigen</strong>
                    <small>Ordner vor Notizen und Dateien sortieren.</small>
                  </span>
                  <input
                    id="settings-explorer-folders-first"
                    type="checkbox"
                    checked={explorerOptions.foldersFirst}
                    onChange={(event) => setExplorerOptions((prev) => ({ ...prev, foldersFirst: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-show-icons">
                  <span>
                    <strong>Dateisymbole anzeigen</strong>
                    <small>Icons fuer Dateitypen und Ordner sichtbar machen.</small>
                  </span>
                  <input
                    id="settings-explorer-show-icons"
                    type="checkbox"
                    checked={explorerOptions.showIcons}
                    onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showIcons: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-compact">
                  <span>
                    <strong>Kompakte Zeilen</strong>
                    <small>Mehr Eintraege auf gleicher Flaeche anzeigen.</small>
                  </span>
                  <input
                    id="settings-explorer-compact"
                    type="checkbox"
                    checked={explorerOptions.compactMode}
                    onChange={(event) => setExplorerOptions((prev) => ({ ...prev, compactMode: event.target.checked }))}
                  />
                </label>
              </section>
            ) : null}

            {activeSectionId === 'statusbar' ? (
              <section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-status-notebase">
                  <span>
                    <strong>NoteBase-Name anzeigen</strong>
                    <small>Aktuelle NoteBase in der Statusleiste nennen.</small>
                  </span>
                  <input
                    id="settings-status-notebase"
                    type="checkbox"
                    checked={statusBarPrefs.showNoteBaseName}
                    onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showNoteBaseName: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-open-tasks">
                  <span>
                    <strong>Offene Tasks anzeigen</strong>
                    <small>Anzahl offener Aufgaben dauerhaft sichtbar halten.</small>
                  </span>
                  <input
                    id="settings-status-open-tasks"
                    type="checkbox"
                    checked={statusBarPrefs.showOpenTasks}
                    onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showOpenTasks: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-due-today">
                  <span>
                    <strong>Heute faellige Tasks anzeigen</strong>
                    <small>Faellige Arbeit fuer den heutigen Tag hervorheben.</small>
                  </span>
                  <input
                    id="settings-status-due-today"
                    type="checkbox"
                    checked={statusBarPrefs.showDueToday}
                    onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showDueToday: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-total-notes">
                  <span>
                    <strong>Anzahl Notizen anzeigen</strong>
                    <small>Gesamtumfang der NoteBase in der Statusleiste zeigen.</small>
                  </span>
                  <input
                    id="settings-status-total-notes"
                    type="checkbox"
                    checked={statusBarPrefs.showTotalNotes}
                    onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showTotalNotes: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-message">
                  <span>
                    <strong>Statusmeldung anzeigen</strong>
                    <small>Rueckmeldungen wie Speichern oder Import unten anzeigen.</small>
                  </span>
                  <input
                    id="settings-status-message"
                    type="checkbox"
                    checked={statusBarPrefs.showStateMessage}
                    onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showStateMessage: event.target.checked }))}
                  />
                </label>
              </section>
            ) : null}

            {activeSectionId === 'tasks' ? (
              <section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-task-advanced">
                  <span>
                    <strong>Detailliertes Task-Handling</strong>
                    <small>Blocker, Waiting, Follow-up und Next Action verwenden.</small>
                  </span>
                  <input
                    id="settings-task-advanced"
                    type="checkbox"
                    checked={taskFeatureSettings.advancedTaskHandling}
                    onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, advancedTaskHandling: event.target.checked }))}
                  />
                </label>
                <label className="settings-toggle-row" htmlFor="settings-task-time-management">
                  <span>
                    <strong>Zeitmanagement bei Tasks</strong>
                    <small>Aufwandsschaetzungen fuer Aufgaben aktivieren.</small>
                  </span>
                  <input
                    id="settings-task-time-management"
                    type="checkbox"
                    checked={taskFeatureSettings.taskTimeManagement}
                    onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, taskTimeManagement: event.target.checked }))}
                  />
                </label>
              </section>
            ) : null}
          </div>

          <footer className="settings-modal-actions">
            <span>
              {activeSectionIsAssistant
                ? assistantPending
                  ? 'Assistant-Einstellungen werden synchronisiert'
                  : assistantSettingsDirty
                    ? 'Assistant-Einstellungen nicht gespeichert'
                    : 'Assistant-Einstellungen gespeichert'
                : settingsDirty
                  ? 'Nicht gespeicherte Aenderungen'
                  : 'Alle Einstellungen gespeichert'}
            </span>
            <div>
              <button
                onClick={activeSectionIsAssistant ? discardAssistantSettings : onDiscard}
                disabled={!footerDirty || (activeSectionIsAssistant && assistantPending)}
              >
                Verwerfen
              </button>
              <button
                className="primary"
                onClick={activeSectionIsAssistant ? () => void saveAssistantSettings() : onSave}
                disabled={!footerDirty || (activeSectionIsAssistant && assistantPending)}
              >
                Speichern
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}

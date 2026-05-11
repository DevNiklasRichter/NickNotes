import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { apiRequest, type NoteGroup, type VaultCounts } from '../app/AppShared'
import type { ExplorerOptions } from '../explorer/types'

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
  phase: string
  processed: number
  total: number
  currentPath: string | null
  result?: OneNoteImportResponse | null
}

type SettingsEditorPanelProps = {
  displayName: string
  theme: ThemeMode
  backendUrl: string
  vaultLoaded: boolean
  sidebarOpen: boolean
  explorerOptions: ExplorerOptions
  statusBarPrefs: StatusBarPrefs
  taskFeatureSettings: TaskFeatureSettings
  settingsDirty: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setExplorerOptions: Dispatch<SetStateAction<ExplorerOptions>>
  setStatusBarPrefs: Dispatch<SetStateAction<StatusBarPrefs>>
  setTaskFeatureSettings: Dispatch<SetStateAction<TaskFeatureSettings>>
  onDisplayNameChange: (nextRawValue: string) => void
  onThemeChange: (nextTheme: ThemeMode) => void
  onSave: () => void
  onDiscard: () => void
  onOneNoteImportComplete: (response: OneNoteImportResponse) => void
}

export function SettingsEditorPanel({
  displayName,
  theme,
  backendUrl,
  vaultLoaded,
  sidebarOpen,
  explorerOptions,
  statusBarPrefs,
  taskFeatureSettings,
  settingsDirty,
  setSidebarOpen,
  setExplorerOptions,
  setStatusBarPrefs,
  setTaskFeatureSettings,
  onDisplayNameChange,
  onThemeChange,
  onSave,
  onDiscard,
  onOneNoteImportComplete,
}: SettingsEditorPanelProps) {
  const [oneNoteSourcePaths, setOneNoteSourcePaths] = useState<string[]>([])
  const [oneNoteTargetFolder, setOneNoteTargetFolder] = useState('')
  const [oneNotePreview, setOneNotePreview] = useState<OneNoteImportPreview | null>(null)
  const [oneNotePending, setOneNotePending] = useState(false)
  const [oneNoteMessage, setOneNoteMessage] = useState('')
  const [oneNoteError, setOneNoteError] = useState('')
  const [oneNoteImportStatus, setOneNoteImportStatus] = useState<OneNoteImportStatus | null>(null)

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
      setOneNoteError(String(caught))
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
        phase: 'Import abgeschlossen.',
        processed: response.import?.importedPages ?? prev?.processed ?? 0,
        total: Math.max(response.import?.importedPages ?? prev?.total ?? 1, 1),
        currentPath: null,
        result: response,
      }))
    } catch (caught) {
      setOneNoteError(String(caught))
      setOneNoteImportStatus((prev) =>
        prev
          ? { ...prev, active: false, done: true, error: String(caught), phase: 'Import fehlgeschlagen.' }
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

  return (
    <div className="settings-editor">
      <h3>Einstellungen</h3>

      <section className="settings-block">
        <h4>Profil</h4>
        <label htmlFor="settings-display-name">Anrede</label>
        <input
          id="settings-display-name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder="Dein Name"
        />
      </section>

      <section className="settings-block">
        <h4>Task Management</h4>
        <label className="checkbox-row" htmlFor="settings-task-advanced">
          <input
            id="settings-task-advanced"
            type="checkbox"
            checked={taskFeatureSettings.advancedTaskHandling}
            onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, advancedTaskHandling: event.target.checked }))}
          />
          Detailliertes Task-Handling (Blocker, Waiting, Follow-up, Next Action)
        </label>
        <label className="checkbox-row" htmlFor="settings-task-time-management">
          <input
            id="settings-task-time-management"
            type="checkbox"
            checked={taskFeatureSettings.taskTimeManagement}
            onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, taskTimeManagement: event.target.checked }))}
          />
          Zeitmanagement bei Tasks (Estimate)
        </label>
      </section>

      <section className="settings-block">
        <h4>Theme</h4>
        <div className="theme-actions">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => onThemeChange('light')}>
            Light
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => onThemeChange('dark')}>
            Dark
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h4>Import</h4>
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

      <section className="settings-block">
        <h4>Layout</h4>
        <label className="checkbox-row" htmlFor="settings-sidebar-open">
          <input
            id="settings-sidebar-open"
            type="checkbox"
            checked={sidebarOpen}
            onChange={(event) => setSidebarOpen(event.target.checked)}
          />
          Sidebar anzeigen
        </label>
      </section>

      <section className="settings-block">
        <h4>Note Explorer</h4>
        <label className="checkbox-row" htmlFor="settings-explorer-show-hidden">
          <input
            id="settings-explorer-show-hidden"
            type="checkbox"
            checked={explorerOptions.showHiddenFiles}
            onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showHiddenFiles: event.target.checked }))}
          />
          Nicht-Markdown-Dateien anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-explorer-folders-first">
          <input
            id="settings-explorer-folders-first"
            type="checkbox"
            checked={explorerOptions.foldersFirst}
            onChange={(event) => setExplorerOptions((prev) => ({ ...prev, foldersFirst: event.target.checked }))}
          />
          Ordner zuerst anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-explorer-show-icons">
          <input
            id="settings-explorer-show-icons"
            type="checkbox"
            checked={explorerOptions.showIcons}
            onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showIcons: event.target.checked }))}
          />
          Dateisymbole anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-explorer-compact">
          <input
            id="settings-explorer-compact"
            type="checkbox"
            checked={explorerOptions.compactMode}
            onChange={(event) => setExplorerOptions((prev) => ({ ...prev, compactMode: event.target.checked }))}
          />
          Kompakte Zeilen
        </label>
      </section>

      <section className="settings-block">
        <h4>Statusleiste</h4>
        <label className="checkbox-row" htmlFor="settings-status-notebase">
          <input
            id="settings-status-notebase"
            type="checkbox"
            checked={statusBarPrefs.showNoteBaseName}
            onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showNoteBaseName: event.target.checked }))}
          />
          NoteBase-Name anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-status-open-tasks">
          <input
            id="settings-status-open-tasks"
            type="checkbox"
            checked={statusBarPrefs.showOpenTasks}
            onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showOpenTasks: event.target.checked }))}
          />
          Offene Tasks anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-status-due-today">
          <input
            id="settings-status-due-today"
            type="checkbox"
            checked={statusBarPrefs.showDueToday}
            onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showDueToday: event.target.checked }))}
          />
          Heute faellige Tasks anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-status-total-notes">
          <input
            id="settings-status-total-notes"
            type="checkbox"
            checked={statusBarPrefs.showTotalNotes}
            onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showTotalNotes: event.target.checked }))}
          />
          Anzahl Notizen anzeigen
        </label>
        <label className="checkbox-row" htmlFor="settings-status-message">
          <input
            id="settings-status-message"
            type="checkbox"
            checked={statusBarPrefs.showStateMessage}
            onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showStateMessage: event.target.checked }))}
          />
          Statusmeldung anzeigen
        </label>
      </section>

      <div className="settings-editor-actions">
        <button onClick={onSave} disabled={!settingsDirty}>
          Speichern
        </button>
        <button onClick={onDiscard} disabled={!settingsDirty}>
          Verwerfen
        </button>
      </div>
    </div>
  )
}

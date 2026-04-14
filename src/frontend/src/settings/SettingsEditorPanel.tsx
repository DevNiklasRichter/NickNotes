import type { Dispatch, SetStateAction } from 'react'
import type { ExplorerOptions } from '../explorer/types'

type ThemeMode = 'light' | 'dark'

type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

type SettingsEditorPanelProps = {
  displayName: string
  theme: ThemeMode
  sidebarOpen: boolean
  explorerOptions: ExplorerOptions
  statusBarPrefs: StatusBarPrefs
  settingsDirty: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setExplorerOptions: Dispatch<SetStateAction<ExplorerOptions>>
  setStatusBarPrefs: Dispatch<SetStateAction<StatusBarPrefs>>
  onDisplayNameChange: (nextRawValue: string) => void
  onThemeChange: (nextTheme: ThemeMode) => void
  onSave: () => void
  onDiscard: () => void
}

export function SettingsEditorPanel({
  displayName,
  theme,
  sidebarOpen,
  explorerOptions,
  statusBarPrefs,
  settingsDirty,
  setSidebarOpen,
  setExplorerOptions,
  setStatusBarPrefs,
  onDisplayNameChange,
  onThemeChange,
  onSave,
  onDiscard,
}: SettingsEditorPanelProps) {
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


import { useEffect, useState } from 'react'
import type { DesktopSettings } from '../electron'

/** Global capture shortcut, tray behaviour and morning overview; device-local and applied at once. */
export function DesktopIntegration() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    void window.nicknotes?.getDesktopSettings?.().then(setSettings).catch(() => setSettings(null))
  }, [])
  const change = async (patch: Partial<Pick<DesktopSettings, 'captureShortcut' | 'keepInTray' | 'dailyOverview'>>) => {
    setMessage('')
    const previous = settings
    // Show the choice at once; the main process confirms it (or the old value comes back).
    setSettings((current) => (current ? { ...current, ...patch } : current))
    try {
      setSettings(await window.nicknotes!.setDesktopSettings!(patch))
    } catch (error) {
      setSettings(previous)
      setMessage(String(error))
    }
  }
  if (!settings) {
    return <p className="settings-hint">Nur in der Desktop-App verfügbar.</p>
  }
  const taken = Boolean(settings.captureShortcut) && !settings.shortcutRegistered
  return (
    <div className="settings-card">
      <div className="settings-row">
        <div>
          <label htmlFor="settings-capture-shortcut">Schnellerfassung von überall</label>
          <p className="muted-copy">Öffnet aus jedem Programm ein kleines Fenster; der Text landet in der heutigen Tagesnotiz.</p>
          {taken ? <p className="settings-inline-warning" role="alert">Dieses Kürzel ist schon von einem anderen Programm belegt. Bitte ein anderes wählen.</p> : null}
        </div>
        <select id="settings-capture-shortcut" value={settings.captureShortcut} onChange={(event) => void change({ captureShortcut: event.target.value })}>
          {settings.shortcuts.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          <option value="">Aus</option>
        </select>
      </div>
      <label className="settings-toggle-row" htmlFor="settings-keep-in-tray">
        <span><strong>Beim Schließen im Infobereich weiterlaufen</strong><small>Das Fenster verschwindet, NickNotes bleibt über das Symbol unten rechts und das Kürzel erreichbar. Beenden über das Symbol.</small></span>
        <input id="settings-keep-in-tray" type="checkbox" checked={settings.keepInTray} onChange={(event) => void change({ keepInTray: event.target.checked })} />
      </label>
      <div className="settings-row">
        <div>
          <label htmlFor="settings-daily-overview">Tagesüberblick</label>
          <p className="muted-copy">Eine Windows-Benachrichtigung mit den heute fälligen und überfälligen Tasks. Erinnerungen an einzelne Tasks stellst du in deren Eigenschaften ein. Beides kommt, solange NickNotes läuft – mit „im Infobereich weiterlaufen“ auch bei geschlossenem Fenster.</p>
        </div>
        <select id="settings-daily-overview" value={settings.dailyOverview} onChange={(event) => void change({ dailyOverview: event.target.value })}>
          <option value="">Aus</option>
          {settings.overviewTimes.map((time) => <option key={time} value={time}>{time} Uhr</option>)}
        </select>
      </div>
      {message ? <p className="settings-inline-warning" role="alert">{message}</p> : null}
    </div>
  )
}

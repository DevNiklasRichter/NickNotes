import { useEffect, useState } from 'react'
import { apiRequest } from '../app/apiClient'

type Grant = { id: string; name: string; write: boolean; createdAt: string }
export function AgentConnections({ backendUrl, vaultLoaded }: { backendUrl: string; vaultLoaded: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([])
  const [name, setName] = useState('Mein Agent')
  const [write, setWrite] = useState(false)
  const [secret, setSecret] = useState('')
  const [format, setFormat] = useState<'claude'|'codex'|'json'>('claude')
  const [background, setBackground] = useState<{available: boolean; enabled: boolean} | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!vaultLoaded) return
    const controller = new AbortController()
    void apiRequest<{items: Grant[]}>(backendUrl, '/agents', {signal: controller.signal}).then(result => setGrants(result.items)).catch(error => { if (!controller.signal.aborted) setMessage(String(error)) })
    return () => controller.abort()
  }, [backendUrl, vaultLoaded])
  useEffect(() => { void window.nicknotes?.getBackgroundService?.().then(setBackground).catch(() => setBackground(null)) }, [])
  async function changeBackground(enabled: boolean) {
    try { setBackground(await window.nicknotes!.setBackgroundService!(enabled)) } catch (error) { setMessage(String(error)) }
  }
  async function create() {
    setBusy(true); setMessage(''); setSecret('')
    try {
      const result = await apiRequest<Grant & {token: string}>(backendUrl, '/agents', {method: 'POST', body: JSON.stringify({name, write})})
      setGrants(previous => [...previous, {id:result.id,name:result.name,write:result.write,createdAt:result.createdAt}]); setSecret(result.token)
      // A connection is only useful when agents reach it without the app; switch that on once.
      const autostarted = background?.available && !background.enabled && grants.length === 0
      if (autostarted) await changeBackground(true)
      setMessage(`Freigabe erstellt. Kopiere den Schlüssel jetzt; er wird nur einmal angezeigt.${autostarted ? ' NickNotes bleibt ab jetzt im Hintergrund erreichbar.' : ''}`)
    } catch (error) { setMessage(String(error)) } finally { setBusy(false) }
  }
  async function revoke(identity: string) {
    setBusy(true)
    try {
      await apiRequest(backendUrl, `/agents/${identity}`, {method: 'DELETE'})
      setGrants(previous => previous.filter(item => item.id !== identity)); setSecret(''); setMessage('Freigabe widerrufen.')
    } catch (error) { setMessage(String(error)) } finally { setBusy(false) }
  }
  const jsonConfig = JSON.stringify({mcpServers: {nicknotes: {url: `${backendUrl}/mcp/`, headers: {Authorization: `Bearer ${secret || '<DEIN-SCHLUESSEL>'}`}}}}, null, 2)
  const key = secret || '<DEIN-SCHLUESSEL>'
  const config = format === 'claude'
    ? `claude mcp add --transport http --scope user nicknotes ${backendUrl}/mcp/ --header "Authorization: Bearer ${key}"`
    : format === 'codex' ? `[mcp_servers.nicknotes]\nurl = "${backendUrl}/mcp/"\nhttp_headers = { Authorization = "Bearer ${key}" }\n` : jsonConfig
  return <section className="settings-block">
    <h4>Externe Agenten verbinden</h4>
    <p>Jede Freigabe gilt genau für diese NoteBase – auch wenn NickNotes eine andere NoteBase zeigt.</p>
    {background?.available
      ? <label className="settings-toggle"><input type="checkbox" checked={background.enabled} onChange={event => void changeBackground(event.target.checked)} /><span>Im Hintergrund erreichbar: startet mit Windows und läuft weiter, wenn die App geschlossen ist</span></label>
      : <p>Ohne geöffnete App erreichbar ist NickNotes nur in der installierten Windows-App.</p>}
    {!vaultLoaded ? <p>Öffne zuerst eine NoteBase.</p> : <>
      <label className="settings-field"><span>Name der Verbindung</span><input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <label className="settings-toggle"><input type="checkbox" checked={write} onChange={event => setWrite(event.target.checked)} /><span>Notizen, Tasks und Tags anlegen und bearbeiten erlauben</span></label>
      <button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>Freigabe erstellen</button>
      {message && <p role="status">{message}</p>}
      {secret && <div><label className="settings-field"><span>Format für den Client</span><select value={format} onChange={event=>setFormat(event.target.value as 'claude'|'codex'|'json')}><option value="claude">Claude Code (Befehl)</option><option value="codex">Codex (config.toml)</option><option value="json">MCP-JSON</option></select></label><label className="settings-field"><span>Verbindungskonfiguration (enthält den geheimen Schlüssel)</span><textarea readOnly rows={12} value={config} aria-label="MCP-Verbindungskonfiguration" /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(config).then(() => setMessage('Konfiguration kopiert.')).catch(() => setMessage('Bitte den Text manuell kopieren.')) }}>Konfiguration kopieren</button><button type="button" onClick={() => setSecret('')}>Schlüssel ausblenden</button></div>}
      <p>Transport: Streamable HTTP · Adresse: <code>{backendUrl}/mcp/</code> · Anmeldung: Bearer-Token</p>
      <ul>{grants.map(grant => <li key={grant.id}><strong>{grant.name}</strong> — {grant.write ? 'Lesen und Schreiben' : 'Nur Lesen'} <button type="button" disabled={busy} onClick={() => void revoke(grant.id)}>Widerrufen</button></li>)}</ul>
    </>}
  </section>
}

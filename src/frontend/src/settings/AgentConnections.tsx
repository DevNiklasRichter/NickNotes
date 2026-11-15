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
  const formats: Array<[typeof format, string]> = [['claude', 'Claude Code'], ['codex', 'Codex'], ['json', 'JSON']]
  return <div className="settings-groups">
    <section className="settings-group">
      <h4>Dienst</h4>
      <div className="settings-card">
        {background?.available
          ? <label className="settings-toggle-row" htmlFor="settings-mcp-background">
            <span><strong>Im Hintergrund erreichbar</strong><small>Gilt für alle NoteBases. Startet mit Windows und läuft weiter, wenn die App geschlossen ist.</small></span>
            <input id="settings-mcp-background" type="checkbox" checked={background.enabled} onChange={event => void changeBackground(event.target.checked)} />
          </label>
          : <div className="settings-row"><span><strong>Im Hintergrund erreichbar</strong><small className="muted-copy">Nur in der installierten Windows-App verfügbar.</small></span></div>}
      </div>
    </section>
    {!vaultLoaded ? <p className="settings-hint">Öffne zuerst eine NoteBase, um Verbindungen anzulegen.</p> : <>
      <section className="settings-group">
        <h4>Neue Verbindung</h4>
        <div className="settings-card">
          <div className="settings-row"><label htmlFor="settings-mcp-name">Name</label><input id="settings-mcp-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></div>
          <label className="settings-toggle-row" htmlFor="settings-mcp-write">
            <span><strong>Schreiben erlauben</strong><small>Notizen, Tasks und Tags anlegen und bearbeiten. Ohne: nur lesen.</small></span>
            <input id="settings-mcp-write" type="checkbox" checked={write} onChange={event => setWrite(event.target.checked)} />
          </label>
        </div>
        <div className="settings-group-actions"><button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>Verbindung erstellen</button></div>
        {message && <p className="settings-hint" role="status">{message}</p>}
        {secret && <>
          <div className="settings-group-actions" style={{justifyContent: 'space-between'}}>
            <div className="settings-segmented" role="group" aria-label="Format für den Client">
              {formats.map(([id, label]) => <button key={id} type="button" aria-pressed={format === id} onClick={() => setFormat(id)}>{label}</button>)}
            </div>
            <span className="settings-group-actions">
              <button type="button" onClick={() => { void navigator.clipboard.writeText(config).then(() => setMessage('Konfiguration kopiert.')).catch(() => setMessage('Bitte den Text manuell kopieren.')) }}>Kopieren</button>
              <button type="button" onClick={() => setSecret('')}>Ausblenden</button>
            </span>
          </div>
          <pre className="settings-code" aria-label="MCP-Verbindungskonfiguration">{config}</pre>
          <p className="settings-hint">Enthält den geheimen Schlüssel. Er wird nur jetzt angezeigt.</p>
        </>}
      </section>
      <section className="settings-group">
        <h4>Bestehende Verbindungen</h4>
        {grants.length === 0
          ? <p className="settings-hint">Noch keine Verbindungen.</p>
          : <div className="settings-card">{grants.map(grant => <div className="settings-row" key={grant.id}>
            <span><strong>{grant.name}</strong><small className="muted-copy">Angelegt am {new Date(grant.createdAt).toLocaleDateString('de-DE')}</small></span>
            <span className="settings-group-actions"><span className="settings-tag" data-write={grant.write}>{grant.write ? 'Lesen und Schreiben' : 'Nur Lesen'}</span><button type="button" disabled={busy} onClick={() => void revoke(grant.id)}>Widerrufen</button></span>
          </div>)}</div>}
      </section>
      <p className="settings-hint">Jede Verbindung gilt nur für diese NoteBase. Transport: Streamable HTTP · <code>{backendUrl}/mcp/</code> · Bearer-Token</p>
    </>}
  </div>
}

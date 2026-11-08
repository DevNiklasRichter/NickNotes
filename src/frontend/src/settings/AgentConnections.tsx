import { useEffect, useState } from 'react'
import { apiRequest } from '../app/apiClient'

type Grant = { id: string; name: string; write: boolean; createdAt: string }
export function AgentConnections({ backendUrl, vaultLoaded }: { backendUrl: string; vaultLoaded: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([])
  const [name, setName] = useState('Mein Agent')
  const [write, setWrite] = useState(false)
  const [secret, setSecret] = useState('')
  const [format, setFormat] = useState<'codex'|'json'>('codex')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!vaultLoaded) return
    const controller = new AbortController()
    void apiRequest<{items: Grant[]}>(backendUrl, '/agents', {signal: controller.signal}).then(result => setGrants(result.items)).catch(error => { if (!controller.signal.aborted) setMessage(String(error)) })
    return () => controller.abort()
  }, [backendUrl, vaultLoaded])
  async function create() {
    setBusy(true); setMessage(''); setSecret('')
    try {
      const result = await apiRequest<Grant & {token: string}>(backendUrl, '/agents', {method: 'POST', body: JSON.stringify({name, write})})
      setGrants(previous => [...previous, {id:result.id,name:result.name,write:result.write,createdAt:result.createdAt}]); setSecret(result.token)
      setMessage('Freigabe erstellt. Kopiere den Schluessel jetzt; er wird nur einmal angezeigt.')
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
  const config = format === 'codex' ? `[mcp_servers.nicknotes]\nurl = "${backendUrl}/mcp/"\nhttp_headers = { Authorization = "Bearer ${secret || '<DEIN-SCHLUESSEL>'}" }\n` : jsonConfig
  return <section className="settings-block">
    <h4>Externe Agenten verbinden</h4>
    <p>Der lokale MCP-Server laeuft mit NickNotes. Jede Freigabe gilt nur fuer diese NoteBase. Die App und diese NoteBase muessen geoeffnet bleiben.</p>
    {!vaultLoaded ? <p>Oeffne zuerst eine NoteBase.</p> : <>
      <label className="settings-field"><span>Name der Verbindung</span><input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <label className="settings-toggle"><input type="checkbox" checked={write} onChange={event => setWrite(event.target.checked)} /><span>Notizen, Tasks und Tags anlegen und bearbeiten erlauben</span></label>
      <button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>Freigabe erstellen</button>
      {message && <p role="status">{message}</p>}
      {secret && <div><label className="settings-field"><span>Format fuer den Client</span><select value={format} onChange={event=>setFormat(event.target.value as 'codex'|'json')}><option value="codex">Codex (config.toml)</option><option value="json">MCP-JSON</option></select></label><label className="settings-field"><span>Verbindungskonfiguration (enthaelt den geheimen Schluessel)</span><textarea readOnly rows={12} value={config} aria-label="MCP-Verbindungskonfiguration" /></label><button type="button" onClick={() => { void navigator.clipboard.writeText(config).then(() => setMessage('Konfiguration kopiert.')).catch(() => setMessage('Bitte den Text manuell kopieren.')) }}>Konfiguration kopieren</button><button type="button" onClick={() => setSecret('')}>Schluessel ausblenden</button></div>}
      <p>Transport: Streamable HTTP · Adresse: <code>{backendUrl}/mcp/</code> · Anmeldung: Bearer-Token</p>
      <ul>{grants.map(grant => <li key={grant.id}><strong>{grant.name}</strong> — {grant.write ? 'Lesen und Schreiben' : 'Nur Lesen'} <button type="button" disabled={busy} onClick={() => void revoke(grant.id)}>Widerrufen</button></li>)}</ul>
    </>}
  </section>
}

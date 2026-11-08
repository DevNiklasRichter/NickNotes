import {useEffect, useEffectEvent, type Dispatch, type MutableRefObject, type SetStateAction} from 'react'
import {apiRequest, ApiError} from './apiClient'
import type {NoteTab, VaultCounts} from './AppShared'
import type {BackendStateResponse, NoteContentResponse} from '../contracts/apiContracts'
import {mergeExternalDocument} from '../workspace/documentState'

type Options = {
  backendUrl: string; vaultLoaded: boolean; tabs: MutableRefObject<NoteTab[]>
  setTabs: Dispatch<SetStateAction<NoteTab[]>>
  setCounts: (counts: VaultCounts) => void
  refresh: () => Promise<void>
  warn: (message: string) => void
}
/** One bounded poll for both external file edits and MCP changes. */
export function useExternalChanges({backendUrl, vaultLoaded, tabs, setTabs, setCounts, refresh, warn}: Options) {
  const receive = useEffectEvent(async (state: BackendStateResponse) => {
    if (state.counts) setCounts(state.counts)
    if (state.pendingRecovery.length) warn('Eine unterbrochene Aenderung benoetigt eine Pruefung. Details und Wiederherstellung stehen in den Einstellungen.')
    await Promise.allSettled(tabs.current.filter(tab => tab.kind === 'note' && !tab.loading).slice(0, 100).map(async tab => {
      try {
        const stored = await apiRequest<NoteContentResponse>(backendUrl, `/notes/content?path=${encodeURIComponent(tab.path)}`)
        setTabs(current => current.map(entry => entry.id === tab.id ? mergeExternalDocument(entry, stored) : entry))
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setTabs(current => current.map(entry => entry.id === tab.id ? {...entry, conflict: true} : entry))
        }
      }
    }))
    await refresh()
  })
  useEffect(() => {
    if (!vaultLoaded) return
    const controller = new AbortController()
    let lastVersion: number | undefined
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const state = await apiRequest<BackendStateResponse>(backendUrl, '/state', {signal: controller.signal})
        if (controller.signal.aborted || !state.vaultLoaded) return
        if (lastVersion !== undefined && lastVersion !== state.changeVersion) await receive(state)
        lastVersion = state.changeVersion
      } catch { /* Transient disconnection is handled by the connection state. Drafts stay local. */ }
      finally {polling = false}
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => {controller.abort(); window.clearInterval(timer)}
  }, [backendUrl, vaultLoaded])
}

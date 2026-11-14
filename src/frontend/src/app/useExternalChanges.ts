import {useEffect, useEffectEvent, type Dispatch, type MutableRefObject, type SetStateAction} from 'react'
import {apiRequest, ApiError,connectionEpoch} from './apiClient'
import {normalizeFilePathKey} from './AppShared'
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
export function changedDocumentPaths(state:BackendStateResponse,previous:number):Set<string>|null {
  const change=state.lastChange
  if(change?.version!==state.changeVersion||state.changeVersion!==previous+1||change.truncated||!change.paths?.length)return null
  return new Set(change.paths.map(normalizeFilePathKey))
}
/** One bounded poll for both external file edits and MCP changes. */
export function useExternalChanges({backendUrl, vaultLoaded, tabs, setTabs, setCounts, refresh, warn}: Options) {
  const receive = useEffectEvent(async (state: BackendStateResponse,previous:number,signal:AbortSignal) => {
    const epoch=connectionEpoch()
    if (state.counts) setCounts(state.counts)
    if (state.pendingRecovery.length) warn('Eine unterbrochene Änderung benötigt eine Prüfung. Details und Wiederherstellung stehen in den Einstellungen.')
    // The last event is sufficient only for an unbroken version sequence.
    const paths=changedDocumentPaths(state,previous)
    const affected=tabs.current.filter(tab=>tab.kind==='note'&&!tab.loading&&(!paths||paths.has(normalizeFilePathKey(tab.path))))
    for(let offset=0;offset<affected.length;offset+=8){
      if(signal.aborted||epoch!==connectionEpoch())return
      await Promise.allSettled(affected.slice(offset,offset+8).map(async tab => {
      try {
        const stored = await apiRequest<NoteContentResponse>(backendUrl, `/notes/content?path=${encodeURIComponent(tab.path)}`,{signal})
        if(signal.aborted||epoch!==connectionEpoch())return
        setTabs(current => current.map(entry => entry.id === tab.id ? mergeExternalDocument(entry, stored) : entry))
      } catch (error) {
        if (!signal.aborted&&epoch===connectionEpoch()&&error instanceof ApiError && error.status === 404) {
          setTabs(current => current.map(entry => entry.id === tab.id ? {...entry, conflict: true} : entry))
        }
      }
      }))
    }
    if(signal.aborted||epoch!==connectionEpoch())return
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
        if (lastVersion !== undefined && lastVersion !== state.changeVersion) await receive(state,lastVersion,controller.signal)
        lastVersion = state.changeVersion
      } catch { /* Transient disconnection is handled by the connection state. Drafts stay local. */ }
      finally {polling = false}
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 2500)
    return () => {controller.abort(); window.clearInterval(timer)}
  }, [backendUrl, vaultLoaded])
}

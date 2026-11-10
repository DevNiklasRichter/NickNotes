import {apiRequest} from '../app/apiClient'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  GraphFilters,
  GraphEdge,
  GraphIndex,
  GraphIndexStatus,
  GraphMode,
  GraphNodePosition,
  GraphState,
  GraphViewMode,
  GraphViewport,
} from '../app/AppShared'
import {
  DEFAULT_GRAPH_FILTERS,
  DEFAULT_GRAPH_STATE,
  fetchGraphIndex,
  fetchGraphIndexStatus,
  fetchGraphState,
  filterGraph,
  rebuildGraphIndex,
  saveGraphState,
} from './graphModel'

const DEFAULT_GRAPH_VIEWPORT: GraphViewport = { zoom: 1, pan: { x: 0, y: 0 } }
const NO_SHARED_TAG_EDGES: GraphEdge[] = []

import {GraphWorkspaceContext, type GraphWorkspaceValue} from './useGraphWorkspace'
type GraphWorkspaceProviderProps = {
  backendUrl: string
  vaultLoaded: boolean
  enabled?: boolean
  graphUpdateToken: number
  latestGraphStatus: GraphIndexStatus | null
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
  onRevealNodePath?: (path: string) => void
  children: ReactNode
}

export function GraphWorkspaceProvider({
  backendUrl,
  vaultLoaded,
  enabled = true,
  graphUpdateToken,
  latestGraphStatus,
  onOpenNodePath,
  onRevealNodePath,
  children,
}: GraphWorkspaceProviderProps) {
  const [index, setIndex] = useState<GraphIndex | null>(null)
  const [mode, setMode] = useState<GraphMode>(DEFAULT_GRAPH_STATE.activeMode)
  const [viewMode, setViewMode] = useState<GraphViewMode>(DEFAULT_GRAPH_STATE.viewMode ?? 'graph')
  const [filters, setFilters] = useState<GraphFilters>({ ...DEFAULT_GRAPH_FILTERS })
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [savingState, setSavingState] = useState(false)
  const [stateLoaded, setStateLoaded] = useState(false)
  const [graphStatus, setGraphStatus] = useState<GraphIndexStatus | null>(null)
  const [focusNodeId, setFocusNodeId] = useState('')
  const [positions, setPositions] = useState<Record<string, GraphNodePosition>>({})
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_GRAPH_VIEWPORT)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [fitRequestVersion, setFitRequestVersion] = useState(0)
  const graphStale = Boolean(enabled && latestGraphStatus?.updated_at && latestGraphStatus.updated_at !== index?.updated_at)
  const [error, setError] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const seenGraphUpdateTokenRef = useRef(graphUpdateToken)

  const loadGraph = useCallback(() => {
    if (!vaultLoaded || !enabled) return Promise.resolve()
    return Promise.all([fetchGraphIndex(backendUrl), fetchGraphState(backendUrl), fetchGraphIndexStatus(backendUrl)]).then(([nextIndex, nextState, nextStatus]) => {
      setIndex(nextIndex)
      setMode(nextState.activeMode)
      setViewMode(nextState.viewMode ?? 'graph')
      setFilters(nextState.filters)
      setPositions(nextState.positions ?? {})
      setViewport(nextState.viewport ?? DEFAULT_GRAPH_VIEWPORT)
      setGraphStatus(nextStatus)
      setStateLoaded(true)
    }).catch(caught => setError(`Graph konnte nicht geladen werden: ${String(caught)}`)).finally(() => setLoading(false))
  }, [backendUrl, vaultLoaded, enabled])

  useEffect(() => {
    void loadGraph()
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [loadGraph])

  useEffect(() => {
    if (!stateLoaded || !vaultLoaded) {
      return
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      const nextState: GraphState = { activeMode: mode, viewMode, filters, positions, viewport }
      setSavingState(true)
      saveGraphState(backendUrl, nextState)
        .catch((caught) => setError(`Graph-State konnte nicht gespeichert werden: ${String(caught)}`))
        .finally(() => setSavingState(false))
    }, 500)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [backendUrl, filters, mode, positions, stateLoaded, vaultLoaded, viewMode, viewport])

  useEffect(() => {
    if (!graphUpdateToken || !vaultLoaded || seenGraphUpdateTokenRef.current === graphUpdateToken) {
      return
    }
    seenGraphUpdateTokenRef.current = graphUpdateToken

    if (!latestGraphStatus || !index?.updated_at || !latestGraphStatus.updated_at || latestGraphStatus.updated_at !== index.updated_at) {
      void loadGraph()
      return
    }

  }, [graphUpdateToken, index?.updated_at, latestGraphStatus, loadGraph, vaultLoaded])

  const [related, setRelated] = useState<{focus: string; edges: GraphEdge[]; total: number; truncated: boolean}>({focus: '', edges: [], total: 0, truncated: false})
  const focusPath = index?.nodes.find(node => node.id === focusNodeId)?.path
  useEffect(() => {
    if (!focusPath || !filters.showSharedTagEdges || !enabled) return
    const controller = new AbortController()
    type Neighbours = {items: Array<{id: string; sharedTags: string[]; sharedWeight: number}>; total: number; truncated: boolean}
    void apiRequest<Neighbours>(backendUrl, `/graph/related?path=${encodeURIComponent(focusPath)}&limit=50`, {signal: controller.signal}).then(result => {
      setRelated({focus: focusNodeId, total: result.total, truncated: result.truncated, edges: result.items.filter(item => item.sharedTags.length > 0).map(item => ({id: `sharedTag:${focusNodeId}->${item.id}`, source: focusNodeId, target: item.id, type: 'sharedTag', weight: item.sharedWeight, reasons: item.sharedTags.map(tag => `Shared tag ${tag}`)}))})
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)) })
    return () => controller.abort()
  }, [backendUrl, enabled, focusNodeId, focusPath, filters.showSharedTagEdges, index?.updated_at])
  const virtualEdges = useMemo(() => related.focus === focusNodeId && filters.showSharedTagEdges ? related.edges : NO_SHARED_TAG_EDGES, [related, focusNodeId, filters.showSharedTagEdges])
  const projected = useMemo(() => index ? {...index, edges: [...index.edges, ...virtualEdges]} : null, [index, virtualEdges])
  const filterFocusNodeId = mode === 'focus' ? focusNodeId : ''
  const filtered = useMemo(() => filterGraph(projected, mode, filters, filterFocusNodeId), [filters, filterFocusNodeId, projected, mode])
  const nodeById = useMemo(() => new Map((index?.nodes ?? []).map((node) => [node.id, node])), [index])
  const fileCount = index ? Object.keys(index.files).length : 0
  const hiddenNodeCount = index ? Math.max(0, index.nodes.length - filtered.nodes.length) : 0
  const hiddenEdgeCount = projected ? Math.max(0, projected.edges.length - filtered.edges.length) : 0
  const sharedTagEdgeCount = virtualEdges.length
  const relatedTruncated = related.focus === focusNodeId && filters.showSharedTagEdges && related.truncated
  const viewTruncated = Boolean(filtered.truncated)

  const updateFilters = (patch: Partial<GraphFilters>) => setFilters((current) => ({ ...current, ...patch }))

  const triggerRebuild = async () => {
    if (!vaultLoaded || rebuilding) {
      return
    }
    setRebuilding(true)
    setError('')
    try {
      const rebuilt = await rebuildGraphIndex(backendUrl)
      setIndex(rebuilt)
      setGraphStatus(await fetchGraphIndexStatus(backendUrl))
    } catch (caught) {
      setError(`Graph-Rebuild ist fehlgeschlagen: ${String(caught)}`)
    } finally {
      setRebuilding(false)
    }
  }

  const value: GraphWorkspaceValue = {
    index,
    mode,
    viewMode,
    filters,
    loading,
    rebuilding,
    savingState,
    stateLoaded,
    graphStatus,
    focusNodeId,
    positions,
    viewport,
    layoutVersion,
    fitRequestVersion,
    graphStale,
    error,
    filtered,
    fileCount,
    hiddenNodeCount,
    relatedTruncated,
    viewTruncated,
    hiddenEdgeCount,
    sharedTagEdgeCount,
    nodeById,
    setMode,
    setViewMode,
    updateFilters,
    setFocusNodeId,
    setPositions,
    setViewport,
    loadGraph,
    triggerRebuild,
    resetFilters: () => {
      setMode('link')
      setViewMode('graph')
      setFilters({ ...DEFAULT_GRAPH_FILTERS })
    },
    resetLayoutState: () => {
      setPositions({})
      setViewport(DEFAULT_GRAPH_VIEWPORT)
      setLayoutVersion((current) => current + 1)
    },
    rerunLayout: () => setLayoutVersion((current) => current + 1),
    requestFitGraph: () => setFitRequestVersion((current) => current + 1),
    onOpenNodePath,
    onRevealNodePath,
  }

  return <GraphWorkspaceContext.Provider value={value}>{children}</GraphWorkspaceContext.Provider>
}

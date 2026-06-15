import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  GraphEdge,
  GraphFilters,
  GraphIndex,
  GraphIndexStatus,
  GraphMode,
  GraphNode,
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

type GraphWorkspaceValue = {
  index: GraphIndex | null
  mode: GraphMode
  viewMode: GraphViewMode
  filters: GraphFilters
  loading: boolean
  rebuilding: boolean
  savingState: boolean
  stateLoaded: boolean
  graphStatus: GraphIndexStatus | null
  focusNodeId: string
  positions: Record<string, GraphNodePosition>
  viewport: GraphViewport
  layoutVersion: number
  fitRequestVersion: number
  graphStale: boolean
  error: string
  filtered: { nodes: GraphNode[]; edges: GraphEdge[] }
  fileCount: number
  hiddenNodeCount: number
  hiddenEdgeCount: number
  sharedTagEdgeCount: number
  nodeById: Map<string, GraphNode>
  setMode: (mode: GraphMode) => void
  setViewMode: (mode: GraphViewMode) => void
  updateFilters: (patch: Partial<GraphFilters>) => void
  setFocusNodeId: (nodeId: string) => void
  setPositions: (positions: Record<string, GraphNodePosition>) => void
  setViewport: (viewport: GraphViewport) => void
  loadGraph: () => Promise<void>
  triggerRebuild: () => Promise<void>
  resetFilters: () => void
  resetLayoutState: () => void
  rerunLayout: () => void
  requestFitGraph: () => void
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
  onRevealNodePath?: (path: string) => void
}

const GraphWorkspaceContext = createContext<GraphWorkspaceValue | null>(null)

type GraphWorkspaceProviderProps = {
  backendUrl: string
  vaultLoaded: boolean
  graphUpdateToken: number
  latestGraphStatus: GraphIndexStatus | null
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
  onRevealNodePath?: (path: string) => void
  children: ReactNode
}

export function GraphWorkspaceProvider({
  backendUrl,
  vaultLoaded,
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
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [savingState, setSavingState] = useState(false)
  const [stateLoaded, setStateLoaded] = useState(false)
  const [graphStatus, setGraphStatus] = useState<GraphIndexStatus | null>(null)
  const [focusNodeId, setFocusNodeId] = useState('')
  const [positions, setPositions] = useState<Record<string, GraphNodePosition>>({})
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_GRAPH_VIEWPORT)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [fitRequestVersion, setFitRequestVersion] = useState(0)
  const [graphStale, setGraphStale] = useState(false)
  const [error, setError] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const seenGraphUpdateTokenRef = useRef(graphUpdateToken)

  const loadGraph = useCallback(async () => {
    if (!vaultLoaded) {
      setIndex(null)
      setStateLoaded(false)
      setGraphStale(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [nextIndex, nextState, nextStatus] = await Promise.all([
        fetchGraphIndex(backendUrl),
        fetchGraphState(backendUrl),
        fetchGraphIndexStatus(backendUrl),
      ])
      setIndex(nextIndex)
      setMode(nextState.activeMode)
      setViewMode(nextState.viewMode ?? 'graph')
      setFilters(nextState.filters)
      setPositions(nextState.positions ?? {})
      setViewport(nextState.viewport ?? DEFAULT_GRAPH_VIEWPORT)
      setGraphStatus(nextStatus)
      setGraphStale(false)
      setStateLoaded(true)
    } catch (caught) {
      setError(`Graph konnte nicht geladen werden: ${String(caught)}`)
    } finally {
      setLoading(false)
    }
  }, [backendUrl, vaultLoaded])

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

    setGraphStale(true)
    if (latestGraphStatus) {
      setGraphStatus(latestGraphStatus)
    }

    if (!latestGraphStatus || !index?.updated_at || !latestGraphStatus.updated_at || latestGraphStatus.updated_at !== index.updated_at) {
      void loadGraph()
      return
    }

    setGraphStale(false)
  }, [graphUpdateToken, index?.updated_at, latestGraphStatus, loadGraph, vaultLoaded])

  const graphFilterFocusNodeId = mode === 'focus' ? focusNodeId : ''
  const filtered = useMemo(() => filterGraph(index, mode, filters, graphFilterFocusNodeId), [filters, graphFilterFocusNodeId, index, mode])
  const nodeById = useMemo(() => new Map((index?.nodes ?? []).map((node) => [node.id, node])), [index])
  const fileCount = index ? Object.keys(index.files).length : 0
  const hiddenNodeCount = index ? Math.max(0, index.nodes.length - filtered.nodes.length) : 0
  const hiddenEdgeCount = index ? Math.max(0, index.edges.length - filtered.edges.length) : 0
  const sharedTagEdgeCount = index?.edges.filter((edge) => edge.type === 'sharedTag').length ?? 0

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
      setGraphStale(false)
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

export function useGraphWorkspace(): GraphWorkspaceValue {
  const value = useContext(GraphWorkspaceContext)
  if (!value) {
    throw new Error('useGraphWorkspace must be used inside GraphWorkspaceProvider')
  }
  return value
}

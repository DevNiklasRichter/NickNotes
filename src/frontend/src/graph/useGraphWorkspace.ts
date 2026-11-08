import {createContext, useContext} from 'react'
import type {
  GraphEdge,
  GraphFilters,
  GraphIndex,
  GraphIndexStatus,
  GraphMode,
  GraphNode,
  GraphNodePosition,
  GraphViewMode,
  GraphViewport,
} from '../app/AppShared'
export type GraphWorkspaceValue = {
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
  relatedTruncated: boolean
  viewTruncated: boolean
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

export const GraphWorkspaceContext = createContext<GraphWorkspaceValue | null>(null)


export function useGraphWorkspace(): GraphWorkspaceValue {
  const value = useContext(GraphWorkspaceContext)
  if (!value) {
    throw new Error('useGraphWorkspace must be used inside GraphWorkspaceProvider')
  }
  return value
}

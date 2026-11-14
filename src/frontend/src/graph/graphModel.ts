import {
  apiRequest,
  type GraphEdge,
  type GraphFilters,
  type GraphIndex,
  type GraphIndexStatus,
  type GraphMode,
  type GraphNode,
  type GraphNodePosition,
  type GraphState,
  type GraphViewport,
  type GraphViewMode,
} from '../app/AppShared'

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  showNotes: true,
  showTasks: true,
  showTags: true,
  showLinkEdges: true,
  showTagUsageEdges: true,
  showSharedTagEdges: false,
  minimumEdgeWeight: 0,
  searchText: '',
  searchMode: 'filter',
  focusDepth: 1,
  tag: '',
}

export const DEFAULT_GRAPH_STATE: GraphState = {
  activeMode: 'focus',  // the neighbourhood of the open note; the whole graph is one click away
  viewMode: 'graph',
  filters: { ...DEFAULT_GRAPH_FILTERS },
  viewport: { zoom: 1, pan: { x: 0, y: 0 } },
  positions: {},
}

export type FilteredGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated?: boolean
}

export async function fetchGraphIndex(baseUrl: string): Promise<GraphIndex> {
  const response = await apiRequest<{ index: GraphIndex }>(baseUrl, '/graph-index')
  return normalizeGraphIndex(response.index)
}

export async function fetchGraphIndexStatus(baseUrl: string): Promise<GraphIndexStatus> {
  return apiRequest<GraphIndexStatus>(baseUrl, '/graph-index/status')
}

export async function rebuildGraphIndex(baseUrl: string): Promise<GraphIndex> {
  const response = await apiRequest<{ index: GraphIndex }>(baseUrl, '/graph-index/rebuild', { method: 'POST' })
  return normalizeGraphIndex(response.index)
}

export async function fetchGraphState(baseUrl: string): Promise<GraphState> {
  const response = await apiRequest<{ state: unknown }>(baseUrl, '/graph-state')
  return normalizeGraphState(response.state)
}

export async function saveGraphState(baseUrl: string, state: GraphState): Promise<GraphState> {
  const response = await apiRequest<{ state: unknown }>(baseUrl, '/graph-state', {
    method: 'PUT',
    body: JSON.stringify(state),
  })
  return normalizeGraphState(response.state)
}

export function normalizeGraphState(value: unknown): GraphState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_GRAPH_STATE, filters: { ...DEFAULT_GRAPH_FILTERS } }
  }
  const source = value as Record<string, unknown>
  const activeMode = toGraphMode(source.activeMode)
  return {
    version: typeof source.version === 'number' ? source.version : undefined,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : undefined,
    activeMode,
    viewMode: toGraphViewMode(source.viewMode),
    filters: normalizeGraphFilters(source.filters),
    layout: toObjectRecord(source.layout),
    viewport: normalizeGraphViewport(source.viewport),
    positions: normalizeGraphPositions(source.positions),
  }
}

export function filterGraph(index: GraphIndex | null, mode: GraphMode, filters: GraphFilters, focusNodeId = ''): FilteredGraph {
  if (!index) {
    return { nodes: [], edges: [] }
  }
  const normalizedSearch = filters.searchText.trim().toLowerCase()
  const edgeTypes = new Set<string>()
  if (filters.showLinkEdges) {
    edgeTypes.add('link')
  }
  if (filters.showTagUsageEdges) {
    edgeTypes.add('tagUsage')
  }
  if (filters.showSharedTagEdges) {
    edgeTypes.add('sharedTag')
  }

  // A tag filter keeps the tag itself and every file that uses it.
  const taggedFiles = filters.tag
    ? new Set(index.edges.filter(edge => edge.type === 'tagUsage' && edge.target === filters.tag).map(edge => edge.source))
    : null
  const nodes = index.nodes.filter((node) => {
    if (taggedFiles && node.id !== filters.tag && !taggedFiles.has(node.id)) {
      return false
    }
    if (node.type === 'note' && !filters.showNotes) {
      return false
    }
    if (node.type === 'task' && !filters.showTasks) {
      return false
    }
    if (node.type === 'tag' && !filters.showTags) {
      return false
    }
    if (!normalizedSearch || filters.searchMode === 'highlight') {
      return true
    }
    return [node.label, node.path, node.group, node.tag, node.id].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
  })

  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  const edges = index.edges.filter((edge) => {
    if (!edgeTypes.has(edge.type)) {
      return false
    }
    if (edge.weight < filters.minimumEdgeWeight) {
      return false
    }
    return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  })

  const selected = mode === 'focus' ? applyFocusLimit(nodes, edges, focusNodeId, filters.focusDepth) : {nodes, edges}
  const limitedNodes = selected.nodes.slice(0, 500)
  const limitedIds = new Set(limitedNodes.map(node => node.id))
  const limitedEdges = selected.edges.filter(edge => limitedIds.has(edge.source) && limitedIds.has(edge.target)).slice(0, 1500)
  return {nodes: limitedNodes, edges: limitedEdges, truncated: selected.truncated || selected.nodes.length > limitedNodes.length || selected.edges.length > limitedEdges.length}
}

function normalizeGraphIndex(value: unknown): GraphIndex {
  const fallback: GraphIndex = {
    version: 2,
    updated_at: '',
    source: {},
    files: {},
    nodes: [],
    edges: [],
    diagnostics: [],
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const source = value as Partial<GraphIndex>
  return {
    version: typeof source.version === 'number' ? source.version : 1,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : '',
    source: source.source && typeof source.source === 'object' ? source.source : {},
    files: source.files && typeof source.files === 'object' ? source.files : {},
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    edges: Array.isArray(source.edges) ? source.edges : [],
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics : [],
  }
}

function normalizeGraphFilters(value: unknown): GraphFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_GRAPH_FILTERS }
  }
  const source = value as Partial<GraphFilters>
  return {
    showNotes: source.showNotes ?? DEFAULT_GRAPH_FILTERS.showNotes,
    showTasks: source.showTasks ?? DEFAULT_GRAPH_FILTERS.showTasks,
    showTags: source.showTags ?? DEFAULT_GRAPH_FILTERS.showTags,
    showLinkEdges: source.showLinkEdges ?? DEFAULT_GRAPH_FILTERS.showLinkEdges,
    showTagUsageEdges: source.showTagUsageEdges ?? DEFAULT_GRAPH_FILTERS.showTagUsageEdges,
    showSharedTagEdges: source.showSharedTagEdges ?? DEFAULT_GRAPH_FILTERS.showSharedTagEdges,
    minimumEdgeWeight:
      typeof source.minimumEdgeWeight === 'number' && Number.isFinite(source.minimumEdgeWeight)
        ? Math.max(0, Math.min(20, source.minimumEdgeWeight))
        : DEFAULT_GRAPH_FILTERS.minimumEdgeWeight,
    searchText: typeof source.searchText === 'string' ? source.searchText : DEFAULT_GRAPH_FILTERS.searchText,
    searchMode: source.searchMode === 'highlight' ? 'highlight' : DEFAULT_GRAPH_FILTERS.searchMode,
    focusDepth: source.focusDepth === 2 ? 2 : 1,
    tag: typeof source.tag === 'string' ? source.tag : '',
  }
}

const FOCUS_NODE_LIMIT = 150

/** The focused note and everything within `depth` connections, strongest first and capped, so a popular tag cannot flood the view. */
export function applyFocusLimit(nodes: GraphNode[], edges: GraphEdge[], focusNodeId: string, depth: 1 | 2 = 1): FilteredGraph {
  const fileNodes = nodes.filter((node) => node.type === 'note' || node.type === 'task')
  const focusNode = nodes.find((node) => node.id === focusNodeId) ?? fileNodes[0] ?? nodes[0]
  if (!focusNode) {
    return { nodes: [], edges: [] }
  }
  const byNode = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    for (const end of [edge.source, edge.target]) {
      const list = byNode.get(end)
      if (list) list.push(edge)
      else byNode.set(end, [edge])
    }
  }
  const strongestFirst = (left: GraphEdge, right: GraphEdge) => right.weight - left.weight || left.type.localeCompare(right.type)
  const nodeIds = new Set<string>([focusNode.id])
  let ring = [focusNode.id]
  let truncated = false
  for (let level = 0; level < depth && ring.length; level += 1) {
    const next: string[] = []
    for (const id of ring) {
      for (const edge of [...(byNode.get(id) ?? [])].sort(strongestFirst)) {
        const other = edge.source === id ? edge.target : edge.source
        if (nodeIds.has(other)) continue
        if (nodeIds.size >= FOCUS_NODE_LIMIT) { truncated = true; break }
        nodeIds.add(other)
        next.push(other)
      }
    }
    ring = next
  }
  const limitedNodes = nodes.filter((node) => nodeIds.has(node.id))
  const limitedEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  return { nodes: limitedNodes, edges: limitedEdges, truncated }
}

function toGraphMode(value: unknown): GraphMode {
  return value === 'link' || value === 'tag' || value === 'focus' || value === 'debug' ? value : DEFAULT_GRAPH_STATE.activeMode
}

function toGraphViewMode(value: unknown): GraphViewMode {
  return value === 'graph' || value === 'debug' ? value : 'graph'
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function normalizeGraphViewport(value: unknown): GraphViewport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_GRAPH_STATE.viewport ?? { zoom: 1, pan: { x: 0, y: 0 } }
  }
  const source = value as Record<string, unknown>
  const panSource = source.pan && typeof source.pan === 'object' && !Array.isArray(source.pan) ? (source.pan as Record<string, unknown>) : {}
  return {
    zoom: typeof source.zoom === 'number' && Number.isFinite(source.zoom) ? Math.max(0.08, Math.min(3, source.zoom)) : 1,
    pan: {
      x: typeof panSource.x === 'number' && Number.isFinite(panSource.x) ? panSource.x : 0,
      y: typeof panSource.y === 'number' && Number.isFinite(panSource.y) ? panSource.y : 0,
    },
  }
}

function normalizeGraphPositions(value: unknown): Record<string, GraphNodePosition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const result: Record<string, GraphNodePosition> = {}
  for (const [nodeId, rawPosition] of Object.entries(value as Record<string, unknown>)) {
    if (!rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) {
      continue
    }
    const position = rawPosition as Record<string, unknown>
    if (typeof position.x !== 'number' || typeof position.y !== 'number' || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      continue
    }
    result[nodeId] = { x: position.x, y: position.y }
  }
  return result
}

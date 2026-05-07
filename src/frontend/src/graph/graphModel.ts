import {
  apiRequest,
  type GraphEdge,
  type GraphFilters,
  type GraphIndex,
  type GraphIndexStatus,
  type GraphMode,
  type GraphNode,
  type GraphState,
  type GraphViewMode,
} from '../app/AppShared'

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  showNotes: true,
  showTasks: true,
  showTags: true,
  showLinkEdges: true,
  showTagUsageEdges: true,
  showDiagnostics: true,
  minimumEdgeWeight: 0,
  searchText: '',
}

export const DEFAULT_GRAPH_STATE: GraphState = {
  activeMode: 'debug',
  viewMode: 'graph',
  filters: { ...DEFAULT_GRAPH_FILTERS },
}

export type FilteredGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
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
    viewport: toObjectRecord(source.viewport),
    positions: toObjectRecord(source.positions),
  }
}

export function filterGraph(index: GraphIndex | null, mode: GraphMode, filters: GraphFilters): FilteredGraph {
  if (!index) {
    return { nodes: [], edges: [] }
  }
  const normalizedSearch = filters.searchText.trim().toLowerCase()
  const edgeTypes = new Set<string>()
  if ((mode === 'debug' || mode === 'link') && filters.showLinkEdges) {
    edgeTypes.add('link')
  }
  if ((mode === 'debug' || mode === 'tag') && filters.showTagUsageEdges) {
    edgeTypes.add('tagUsage')
  }

  const nodes = index.nodes.filter((node) => {
    if (node.type === 'note' && !filters.showNotes) {
      return false
    }
    if (node.type === 'task' && !filters.showTasks) {
      return false
    }
    if (node.type === 'tag' && !filters.showTags) {
      return false
    }
    if (!normalizedSearch) {
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

  return { nodes, edges }
}

function normalizeGraphIndex(value: unknown): GraphIndex {
  const fallback: GraphIndex = {
    version: 1,
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
    showDiagnostics: source.showDiagnostics ?? DEFAULT_GRAPH_FILTERS.showDiagnostics,
    minimumEdgeWeight:
      typeof source.minimumEdgeWeight === 'number' && Number.isFinite(source.minimumEdgeWeight)
        ? Math.max(0, Math.min(20, source.minimumEdgeWeight))
        : DEFAULT_GRAPH_FILTERS.minimumEdgeWeight,
    searchText: typeof source.searchText === 'string' ? source.searchText : DEFAULT_GRAPH_FILTERS.searchText,
  }
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

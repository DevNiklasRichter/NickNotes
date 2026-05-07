import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphEdge, GraphFilters, GraphIndex, GraphIndexStatus, GraphMode, GraphNode, GraphState, GraphViewMode } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { GraphNetworkView } from './GraphNetworkView'
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

type GraphDashboardCanvasProps = {
  backendUrl: string
  vaultLoaded: boolean
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
}

type PositionedNode = GraphNode & {
  x: number
  y: number
}

const GRAPH_PREVIEW_LIMIT = 80

export function GraphDashboardCanvas({ backendUrl, vaultLoaded, onOpenNodePath }: GraphDashboardCanvasProps) {
  const [index, setIndex] = useState<GraphIndex | null>(null)
  const [mode, setMode] = useState<GraphMode>(DEFAULT_GRAPH_STATE.activeMode)
  const [viewMode, setViewMode] = useState<GraphViewMode>(DEFAULT_GRAPH_STATE.viewMode ?? 'graph')
  const [filters, setFilters] = useState<GraphFilters>({ ...DEFAULT_GRAPH_FILTERS })
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [savingState, setSavingState] = useState(false)
  const [stateLoaded, setStateLoaded] = useState(false)
  const [graphStatus, setGraphStatus] = useState<GraphIndexStatus | null>(null)
  const [error, setError] = useState('')
  const saveTimerRef = useRef<number | null>(null)

  const loadGraph = async () => {
    if (!vaultLoaded) {
      setIndex(null)
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
      setGraphStatus(nextStatus)
      setStateLoaded(true)
    } catch (caught) {
      setError(`Graph konnte nicht geladen werden: ${String(caught)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadGraph()
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
    // The view should reload when the backend target or NoteBase availability changes.
  }, [backendUrl, vaultLoaded])

  useEffect(() => {
    if (!stateLoaded || !vaultLoaded) {
      return
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      const nextState: GraphState = {
        activeMode: mode,
        viewMode,
        filters,
      }
      setSavingState(true)
      saveGraphState(backendUrl, nextState)
        .catch((caught) => {
          setError(`Graph-State konnte nicht gespeichert werden: ${String(caught)}`)
        })
        .finally(() => {
          setSavingState(false)
        })
    }, 500)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [backendUrl, filters, mode, stateLoaded, vaultLoaded, viewMode])

  const filtered = useMemo(() => filterGraph(index, mode, filters), [filters, index, mode])
  const nodeById = useMemo(() => new Map((index?.nodes ?? []).map((node) => [node.id, node])), [index])
  const diagnostics = useMemo(() => (filters.showDiagnostics ? index?.diagnostics ?? [] : []), [filters.showDiagnostics, index])
  const fileCount = index ? Object.keys(index.files).length : 0
  const previewNodes = filtered.nodes.slice(0, GRAPH_PREVIEW_LIMIT)
  const previewNodeIds = new Set(previewNodes.map((node) => node.id))
  const previewEdges = filtered.edges.filter((edge) => previewNodeIds.has(edge.source) && previewNodeIds.has(edge.target)).slice(0, 160)

  const updateFilters = (patch: Partial<GraphFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
  }

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

  const resetFilters = () => {
    setMode('debug')
    setFilters({ ...DEFAULT_GRAPH_FILTERS })
  }

  const renderCheckbox = (key: keyof GraphFilters, label: string) => {
    const value = filters[key]
    if (typeof value !== 'boolean') {
      return null
    }
    return (
      <label className="graph-check-option">
        <input type="checkbox" checked={value} onChange={(event) => updateFilters({ [key]: event.target.checked })} />
        <span>{label}</span>
      </label>
    )
  }

  return (
    <div className="graph-dashboard-shell">
      <header className="graph-dashboard-header">
        <div>
          <h2>Graph Preview</h2>
          <p>Indexdaten, Kanten und Diagnostics aus der aktuellen NoteBase.</p>
        </div>
        <div className="graph-dashboard-actions">
          <button className="icon-button compact muted" onClick={() => void loadGraph()} disabled={loading || rebuilding} title="Graph neu laden">
            <LucideNamedIcon name="RefreshCw" size={14} />
          </button>
          <button className="primary graph-rebuild-button" onClick={() => void triggerRebuild()} disabled={rebuilding || loading}>
            {rebuilding ? 'Wird aufgebaut ...' : 'Graph neu aufbauen'}
          </button>
        </div>
      </header>

      <section className="graph-metric-strip">
        <Metric label="Nodes" value={index?.nodes.length ?? 0} />
        <Metric label="Edges" value={index?.edges.length ?? 0} />
        <Metric label="Dateien" value={fileCount} />
        <Metric label="Diagnostics" value={index?.diagnostics.length ?? 0} />
        <Metric label="Sichtbar" value={`${filtered.nodes.length}/${filtered.edges.length}`} />
        <Metric label="Updated" value={index?.updated_at || '-'} wide />
      </section>
      {graphStatus ? (
        <section className="graph-status-strip">
          <span>{graphStatus.available ? 'Index verfuegbar' : 'Index nicht verfuegbar'}</span>
          <span>{graphStatus.is_updating ? 'Update laeuft' : 'Update idle'}</span>
          <span>{graphStatus.node_count} Nodes</span>
          <span>{graphStatus.edge_count} Edges</span>
          <span>{graphStatus.diagnostic_count} Diagnostics</span>
          {graphStatus.last_error ? <strong>{graphStatus.last_error}</strong> : null}
        </section>
      ) : null}

      <section className="graph-toolbar">
        <label>
          <span>Ansicht</span>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as GraphViewMode)}>
            <option value="graph">Graph</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <label>
          <span>Modus</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as GraphMode)}>
            <option value="debug">Debug</option>
            <option value="link">Link</option>
            <option value="tag">Tag</option>
            <option value="focus">Focus</option>
          </select>
        </label>
        <label className="graph-search-label">
          <span>Suche</span>
          <input
            value={filters.searchText}
            onChange={(event) => updateFilters({ searchText: event.target.value })}
            placeholder="Label, Pfad, Gruppe, Tag"
          />
        </label>
        <label>
          <span>Min. Gewicht</span>
          <input
            type="number"
            min={0}
            max={20}
            value={filters.minimumEdgeWeight}
            onChange={(event) => updateFilters({ minimumEdgeWeight: Math.max(0, Number.parseFloat(event.target.value) || 0) })}
          />
        </label>
        <button className="muted graph-reset-button" onClick={resetFilters}>
          Filter zuruecksetzen
        </button>
      </section>

      <section className="graph-filter-panel">
        {renderCheckbox('showNotes', 'Notes')}
        {renderCheckbox('showTasks', 'Tasks')}
        {renderCheckbox('showTags', 'Tags')}
        {renderCheckbox('showLinkEdges', 'Link-Edges')}
        {renderCheckbox('showTagUsageEdges', 'TagUsage-Edges')}
        {renderCheckbox('showDiagnostics', 'Diagnostics')}
        <span className="graph-save-state">{savingState ? 'State wird gespeichert ...' : stateLoaded ? 'State geladen' : 'State offen'}</span>
      </section>

      {error ? <p className="graph-error">{error}</p> : null}
      {loading ? <p className="empty-copy">Graph wird geladen ...</p> : null}
      {filtered.nodes.length > 450 || filtered.edges.length > 900 ? (
        <p className="graph-warning">
          Viele sichtbare Elemente ({filtered.nodes.length} Nodes, {filtered.edges.length} Edges). Filter oder Suche halten die Ansicht reaktionsfreudiger.
        </p>
      ) : null}

      {viewMode === 'graph' ? (
        <GraphNetworkView nodes={filtered.nodes} edges={filtered.edges} searchText={filters.searchText} onOpenNodePath={onOpenNodePath} />
      ) : (
        <GraphPreview nodes={previewNodes} edges={previewEdges} />
      )}

      {viewMode === 'debug' ? (
        <div className="graph-data-grid">
          <section className="graph-panel">
            <header>
              <h3>Knoten</h3>
              <span>{filtered.nodes.length}</span>
            </header>
            <div className="graph-table graph-node-table">
              {filtered.nodes.map((node) => (
                <article key={node.id} className="graph-row">
                  <div>
                    <strong>{node.label || node.id}</strong>
                    <span>{node.id}</span>
                  </div>
                  <span className={`graph-pill ${node.type}`}>{node.type}</span>
                  <span>{node.path || node.group || '-'}</span>
                  <span>{node.tag || '-'}</span>
                </article>
              ))}
              {filtered.nodes.length === 0 ? <p className="empty-copy">Keine Knoten fuer den aktuellen Filter.</p> : null}
            </div>
          </section>

          <section className="graph-panel">
            <header>
              <h3>Kanten</h3>
              <span>{filtered.edges.length}</span>
            </header>
            <div className="graph-table graph-edge-table">
              {filtered.edges.map((edge) => (
                <article key={edge.id} className="graph-row">
                  <div>
                    <strong>{labelForNode(nodeById.get(edge.source), edge.source)}</strong>
                    <span>{edge.source}</span>
                  </div>
                  <div>
                    <strong>{labelForNode(nodeById.get(edge.target), edge.target)}</strong>
                    <span>{edge.target}</span>
                  </div>
                  <span className={`graph-pill edge-${edge.type}`}>{edge.type}</span>
                  <span>{edge.weight}</span>
                  <span>{edge.reasons.join(', ') || '-'}</span>
                </article>
              ))}
              {filtered.edges.length === 0 ? <p className="empty-copy">Keine Kanten fuer den aktuellen Filter.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {filters.showDiagnostics ? (
        <section className="graph-panel graph-diagnostics-panel">
          <header>
            <h3>Diagnostics</h3>
            <span>{diagnostics.length}</span>
          </header>
          <div className="graph-diagnostic-list">
            {diagnostics.map((item, indexValue) => (
              <article key={`${item.type}-${item.path}-${item.target}-${item.tag}-${indexValue}`} className="graph-diagnostic-row">
                <span className={`graph-pill severity-${item.severity}`}>{item.type}</span>
                <strong>{item.message}</strong>
                <span>{item.path || '-'}</span>
                <span>{item.target || item.tag || '-'}</span>
              </article>
            ))}
            {diagnostics.length === 0 ? <p className="empty-copy">Keine Diagnostics im aktuellen Index.</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Metric({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <article className={`graph-metric ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function GraphPreview({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const width = 920
  const height = 360
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.38
  const positioned = nodes.map<PositionedNode>((node, index) => {
    const angle = nodes.length <= 1 ? -Math.PI / 2 : (index / nodes.length) * Math.PI * 2 - Math.PI / 2
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    }
  })
  const positions = new Map(positioned.map((node) => [node.id, node]))

  return (
    <section className="graph-preview-panel">
      <header>
        <h3>Preview</h3>
        <span>{nodes.length >= GRAPH_PREVIEW_LIMIT ? `erste ${GRAPH_PREVIEW_LIMIT}` : `${nodes.length}`} Knoten</span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Graph Preview">
        <rect x="0" y="0" width={width} height={height} rx="8" className="graph-preview-bg" />
        {edges.map((edge) => {
          const source = positions.get(edge.source)
          const target = positions.get(edge.target)
          if (!source || !target) {
            return null
          }
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              className={`graph-preview-edge edge-${edge.type}`}
              strokeWidth={Math.max(1, Math.min(4, edge.weight / 2))}
            />
          )
        })}
        {positioned.map((node) => (
          <g key={node.id} className={`graph-preview-node ${node.type}`} transform={`translate(${node.x} ${node.y})`}>
            <circle r={node.type === 'tag' ? 8 : 11} />
            <text x="14" y="4">
              {truncateLabel(node.label || node.id, 22)}
            </text>
          </g>
        ))}
      </svg>
    </section>
  )
}

function labelForNode(node: GraphNode | undefined, fallback: string): string {
  return node?.label || fallback
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

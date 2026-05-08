import { useMemo, useState } from 'react'
import type { GraphEdge, GraphFilters, GraphMode, GraphNode, GraphViewMode } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { useGraphWorkspace } from './GraphWorkspaceContext'

type PositionedNode = GraphNode & { x: number; y: number }

const GRAPH_PREVIEW_LIMIT = 40

export function GraphSidebarPanel({ vaultLoaded, onOpenGraphDashboard }: { vaultLoaded: boolean; onOpenGraphDashboard: () => void }) {
  const graph = useGraphWorkspace()
  const staleNoticeKey = useMemo(() => graph.graphStatus?.updated_at ?? graph.index?.updated_at ?? 'stale', [graph.graphStatus?.updated_at, graph.index?.updated_at])
  const [dismissedStaleNoticeKey, setDismissedStaleNoticeKey] = useState('')
  const showStaleNotice = graph.graphStale && dismissedStaleNoticeKey !== staleNoticeKey
  const previewNodes = graph.filtered.nodes.slice(0, GRAPH_PREVIEW_LIMIT)
  const previewNodeIds = new Set(previewNodes.map((node) => node.id))
  const previewEdges = graph.filtered.edges.filter((edge) => previewNodeIds.has(edge.source) && previewNodeIds.has(edge.target)).slice(0, 80)

  const renderCheckbox = (key: keyof GraphFilters, label: string, title?: string) => {
    const value = graph.filters[key]
    if (typeof value !== 'boolean') {
      return null
    }
    return (
      <label className="focus-sidebar-check-option" title={title}>
        <input type="checkbox" checked={value} onChange={(event) => graph.updateFilters({ [key]: event.target.checked })} />
        <span>{label}</span>
      </label>
    )
  }

  return (
    <div className="explorer-shell todo-explorer-shell graph-sidebar-shell">
      <header className="explorer-toolbar todo-sidebar-toolbar">
        <div className="explorer-toolbar-top">
          <h3>Graph</h3>
          <div className="explorer-toolbar-right">
            <button className="icon-button compact" onClick={() => void graph.loadGraph()} disabled={!vaultLoaded || graph.loading} title="Graph neu laden">
              <LucideNamedIcon name="RefreshCw" size={14} />
            </button>
            <button className="icon-button compact" onClick={onOpenGraphDashboard} disabled={!vaultLoaded} title="Graph-Tab oeffnen">
              <LucideNamedIcon name="Network" size={14} />
            </button>
          </div>
        </div>
      </header>

      <button className="todo-open-dashboard-button" onClick={onOpenGraphDashboard} disabled={!vaultLoaded}>
        Graph oeffnen
      </button>

      {showStaleNotice ? (
        <section className="graph-update-banner compact">
          <span>Graph wurde aktualisiert.</span>
          <div className="graph-notice-actions">
            <button className="muted graph-reset-button" onClick={() => void graph.loadGraph()}>
              Aktualisieren
            </button>
            <button className="icon-button compact muted" onClick={() => setDismissedStaleNoticeKey(staleNoticeKey)} title="Hinweis ausblenden">
              x
            </button>
          </div>
        </section>
      ) : null}

      <section className="todo-sidebar-section">
        <div className="todo-section-header">
          <h4>Status</h4>
          <button className="icon-button compact muted todo-section-reset-button" onClick={() => void graph.triggerRebuild()} disabled={graph.rebuilding} title="Graph neu aufbauen">
            <LucideNamedIcon name="RefreshCw" size={13} />
          </button>
        </div>
        <div className="graph-sidebar-metrics">
          <span>{graph.index?.nodes.length ?? 0} Nodes</span>
          <span>{graph.index?.edges.length ?? 0} Edges</span>
          <span>{graph.fileCount} Dateien</span>
          <span>{graph.graphStatus?.watcher_enabled ? 'Watcher aktiv' : 'Watcher aus'}</span>
        </div>
        {graph.error ? <p className="graph-error">{graph.error}</p> : null}
      </section>

      <section className="todo-sidebar-section">
        <div className="todo-section-header">
          <h4>Ansicht</h4>
          <button className="icon-button compact muted todo-section-reset-button" onClick={graph.resetFilters} title="Filter zuruecksetzen">
            <LucideNamedIcon name="FilterX" size={13} />
          </button>
        </div>
        <div className="todo-filter-rows">
          <div className="todo-filter-row">
            <span className="todo-filter-row-label">Modus</span>
            <label className="todo-grouping-select">
              <select value={graph.mode} onChange={(event) => graph.setMode(event.target.value as GraphMode)}>
                <option value="debug">Debug</option>
                <option value="link">Link</option>
                <option value="tag">Tag</option>
                <option value="focus">Focus</option>
              </select>
            </label>
          </div>
          <div className="todo-filter-row">
            <span className="todo-filter-row-label">Debug</span>
            <label className="todo-grouping-select">
              <select value={graph.viewMode} onChange={(event) => graph.setViewMode(event.target.value as GraphViewMode)}>
                <option value="graph">Graph</option>
                <option value="debug">Preview</option>
              </select>
            </label>
          </div>
          <div className="todo-filter-row">
            <span className="todo-filter-row-label">Gewicht</span>
            <input
              className="graph-sidebar-number"
              type="number"
              min={0}
              max={20}
              value={graph.filters.minimumEdgeWeight}
              onChange={(event) => graph.updateFilters({ minimumEdgeWeight: Math.max(0, Number.parseFloat(event.target.value) || 0) })}
            />
          </div>
          <div className="explorer-search-input-wrap">
            <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
            <input
              className="explorer-search-input"
              value={graph.filters.searchText}
              onChange={(event) => graph.updateFilters({ searchText: event.target.value })}
              placeholder="Graph suchen"
            />
          </div>
        </div>
      </section>

      <section className="todo-sidebar-section">
        <h4>Filter</h4>
        <div className="graph-filter-groups">
          <div className="graph-filter-group">
            <span>Knoten</span>
            <div className="focus-sidebar-check-grid">
              {renderCheckbox('showNotes', 'Notizen')}
              {renderCheckbox('showTasks', 'Tasks')}
              {renderCheckbox('showTags', 'Tags')}
            </div>
          </div>
          <div className="graph-filter-group">
            <span>Verbindungen</span>
            <div className="focus-sidebar-check-grid">
              {renderCheckbox('showLinkEdges', 'Links', 'Direkte WikiLinks von einer Datei zu einer anderen Datei.')}
              {renderCheckbox('showTagUsageEdges', 'Tag-Nutzung', 'Verbindung von einer Datei zu einem Tag, den sie verwendet.')}
              {renderCheckbox('showSharedTagEdges', 'Gemeinsame Tags', 'Similarity-Kanten zwischen Dateien mit gemeinsamen Tags. Kann bei grossen NoteBases viele Kanten erzeugen.')}
            </div>
          </div>
        </div>
        <p className="task-sidebar-summary">
          Sichtbar: {graph.filtered.nodes.length} Nodes, {graph.filtered.edges.length} Edges
        </p>
      </section>

      <section className="todo-sidebar-section">
        <h4>Layout</h4>
        <div className="graph-sidebar-actions">
          <button className="muted graph-reset-button" onClick={graph.resetLayoutState} title="Gespeicherte Positionen loeschen">
            Layout zuruecksetzen
          </button>
          <button className="muted graph-reset-button" onClick={graph.rerunLayout} title="Layout neu berechnen">
            Neu berechnen
          </button>
        </div>
      </section>

      {graph.viewMode === 'debug' ? (
        <>
          <GraphPreview nodes={previewNodes} edges={previewEdges} />
          <GraphDebugList />
        </>
      ) : null}

    </div>
  )
}

function GraphDebugList() {
  const graph = useGraphWorkspace()
  return (
    <section className="todo-sidebar-section">
      <h4>Debug</h4>
      <div className="graph-sidebar-list">
        {graph.filtered.nodes.slice(0, 40).map((node) => (
          <article key={node.id} className="graph-sidebar-row">
            <strong>{node.label || node.id}</strong>
            <span>{node.type} {node.path || node.group || ''}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function GraphPreview({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const width = 260
  const height = 180
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.34
  const positioned = nodes.map<PositionedNode>((node, index) => {
    const angle = nodes.length <= 1 ? -Math.PI / 2 : (index / nodes.length) * Math.PI * 2 - Math.PI / 2
    return { ...node, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
  })
  const positions = new Map(positioned.map((node) => [node.id, node]))
  return (
    <section className="todo-sidebar-section graph-sidebar-preview">
      <h4>Preview</h4>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Graph Preview">
        {edges.map((edge) => {
          const source = positions.get(edge.source)
          const target = positions.get(edge.target)
          if (!source || !target) {
            return null
          }
          return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`graph-preview-edge edge-${edge.type}`} />
        })}
        {positioned.map((node) => (
          <circle key={node.id} cx={node.x} cy={node.y} r={node.type === 'tag' ? 4 : 6} className={`graph-sidebar-preview-node ${node.type}`} />
        ))}
      </svg>
    </section>
  )
}

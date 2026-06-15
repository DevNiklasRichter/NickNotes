import { useState } from 'react'
import { GraphNetworkView } from './GraphNetworkView'
import { useGraphWorkspace } from './GraphWorkspaceContext'

export function GraphDashboardCanvas() {
  const graph = useGraphWorkspace()
  const largeGraph = graph.filtered.nodes.length > 450 || graph.filtered.edges.length > 900
  const largeGraphNoticeKey = `${graph.filtered.nodes.length}:${graph.filtered.edges.length}`
  const [dismissedLargeGraphNoticeKey, setDismissedLargeGraphNoticeKey] = useState('')
  const showLargeGraphNotice = largeGraph && dismissedLargeGraphNoticeKey !== largeGraphNoticeKey

  return (
    <div className="graph-editor-canvas-shell">
      {graph.error ? <p className="graph-error graph-editor-overlay">{graph.error}</p> : null}
      {showLargeGraphNotice ? (
        <div className="graph-warning graph-editor-overlay graph-dismissible-notice">
          <span>
            Groesserer Graph sichtbar ({graph.filtered.nodes.length} Nodes, {graph.filtered.edges.length} Edges). Filter sind in der Sidebar.
          </span>
          <button className="icon-button compact muted" onClick={() => setDismissedLargeGraphNoticeKey(largeGraphNoticeKey)} title="Hinweis ausblenden">
            x
          </button>
        </div>
      ) : null}
      {graph.loading ? <p className="graph-editor-empty">Graph wird geladen ...</p> : null}
      {!graph.loading && graph.index && graph.index.nodes.length === 0 ? (
        <p className="graph-editor-empty">Keine Graph-Daten vorhanden. Oeffne die Graph-Sidebar zum Neuaufbau.</p>
      ) : null}
      <GraphNetworkView
        nodes={graph.filtered.nodes}
        edges={graph.filtered.edges}
        searchText={graph.filters.searchText}
        searchMode={graph.filters.searchMode}
        positions={graph.positions}
        viewport={graph.viewport}
        layoutVersion={graph.layoutVersion}
        fitRequestVersion={graph.fitRequestVersion}
        showDetails={false}
        compactChrome
        onOpenNodePath={graph.onOpenNodePath}
        onRevealNodePath={graph.onRevealNodePath}
        onSelectNode={graph.setFocusNodeId}
        onPositionsChange={graph.setPositions}
        onViewportChange={graph.setViewport}
        onShowNeighbors={(nodeId) => {
          graph.setFocusNodeId(nodeId)
        }}
        onClearSelection={() => graph.setFocusNodeId('')}
      />
    </div>
  )
}

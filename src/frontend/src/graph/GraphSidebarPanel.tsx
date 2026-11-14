import { useMemo } from 'react'
import type { GraphFilters } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { useGraphWorkspace } from './useGraphWorkspace'

export function GraphSidebarPanel({ vaultLoaded, onOpenGraphDashboard }: { vaultLoaded: boolean; onOpenGraphDashboard: () => void }) {
  const graph = useGraphWorkspace()
  const graphUnavailable = !graph.graphStatus?.available || !graph.index || graph.index.nodes.length === 0
  const tagNodes = useMemo(() => (graph.index?.nodes ?? []).filter(node => node.type === 'tag')
    .sort((left, right) => `${left.group}${left.label}`.localeCompare(`${right.group}${right.label}`, 'de')), [graph.index])

  const handleOpenGraphDashboard = async () => {
    if (!vaultLoaded) {
      return
    }
    if (graphUnavailable && !graph.rebuilding) {
      await graph.triggerRebuild()
    }
    onOpenGraphDashboard()
  }

  const renderCheckbox = (key: keyof GraphFilters, label: string, title?: string) => {
    const value = graph.filters[key]
    if (typeof value !== 'boolean') {
      return null
    }
    return (
      <label className="focus-sidebar-check-option" data-tooltip={title}>
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
            <button className="icon-button compact" onClick={graph.requestFitGraph} disabled={!vaultLoaded} aria-label="Graph in Fenster einpassen" data-tooltip="Graph in Fenster einpassen">
              <LucideNamedIcon name="Maximize" size={14} />
            </button>
            <button className="icon-button compact" onClick={() => void graph.triggerRebuild()} disabled={!vaultLoaded || graph.rebuilding} aria-label="Graph neu laden" data-tooltip="Graph neu laden">
              <LucideNamedIcon name="RefreshCw" size={14} />
            </button>
          </div>
        </div>
      </header>

      <button className="todo-open-dashboard-button" onClick={() => void handleOpenGraphDashboard()} disabled={!vaultLoaded || graph.rebuilding}>
        Graph öffnen
      </button>

      <section className="todo-sidebar-section">
        <h4>Ansicht</h4>
        <div className="graph-search-mode-options" role="radiogroup" aria-label="Graph-Ansicht">
          <label data-tooltip="Nur die geöffnete Notiz und ihre Verbindungen">
            <input type="radio" name="graph-view" checked={graph.mode === 'focus'} onChange={() => graph.setMode('focus')} />
            <span>Umgebung der Notiz</span>
          </label>
          <label data-tooltip="Alle Notizen, Tasks und Tags">
            <input type="radio" name="graph-view" checked={graph.mode !== 'focus'} onChange={() => graph.setMode('link')} />
            <span>Ganzer Graph</span>
          </label>
        </div>
        <div className="todo-filter-rows">
          {graph.mode === 'focus' ? (
            <label className="todo-filter-row">
              <span className="todo-filter-row-label">Tiefe</span>
              <select value={graph.filters.focusDepth} onChange={(event) => graph.updateFilters({ focusDepth: event.target.value === '2' ? 2 : 1 })}>
                <option value={1}>Direkte Verbindungen</option>
                <option value={2}>Zwei Ebenen</option>
              </select>
            </label>
          ) : null}
          <label className="todo-filter-row">
            <span className="todo-filter-row-label">Tag</span>
            <select value={graph.filters.tag} onChange={(event) => graph.updateFilters({ tag: event.target.value })}>
              <option value="">Alle</option>
              {tagNodes.map(node => <option key={node.id} value={node.id}>{node.group ? `${node.group} · ${node.label}` : node.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="todo-sidebar-section graph-sidebar-search-section">
        <h4>Suche</h4>
        <div className="explorer-search-input-wrap">
          <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
          <input
            className="explorer-search-input graph-sidebar-search-input"
            value={graph.filters.searchText}
            onChange={(event) => graph.updateFilters({ searchText: event.target.value })}
            placeholder="Suchen"
          />
        </div>
        <div className="graph-search-mode-options" role="radiogroup" aria-label="Suchdarstellung">
          <label data-tooltip="Nur Suchtreffer im Graph anzeigen">
            <input
              type="radio"
              name="graph-search-mode"
              checked={graph.filters.searchMode === 'filter'}
              onChange={() => graph.updateFilters({ searchMode: 'filter' })}
            />
            <span>Nur Treffer anzeigen</span>
          </label>
          <label data-tooltip="Gesamtgraph behalten und Suchtreffer hervorheben">
            <input
              type="radio"
              name="graph-search-mode"
              checked={graph.filters.searchMode === 'highlight'}
              onChange={() => graph.updateFilters({ searchMode: 'highlight' })}
            />
            <span>Treffer im Graphen highlighten</span>
          </label>
        </div>
      </section>

      <section className="todo-sidebar-section">
        <h4>Status</h4>
        <div className="graph-sidebar-metrics">
          <span>{graph.index?.nodes.length ?? 0} Nodes</span>
          <span>{graph.index?.edges.length ?? 0} Edges</span>
          <span>{graph.fileCount} Dateien</span>
        </div>
        {graph.error ? <p className="graph-error">{graph.error}</p> : null}
      </section>

      <section className="todo-sidebar-section">
        <div className="todo-section-header">
          <h4>Filter</h4>
          <button className="icon-button compact muted todo-section-reset-button" onClick={graph.resetFilters} aria-label="Filter zurücksetzen" data-tooltip="Filter zurücksetzen">
            <LucideNamedIcon name="FilterX" size={13} />
          </button>
        </div>
        <div className="todo-filter-rows">
          <div className="todo-filter-row">
            <span className="todo-filter-row-label graph-filter-label-with-info">
              Gewicht
              <span
                className="graph-filter-info-icon"
                tabIndex={0} role="img" aria-label="Hinweis zum Kantengewicht"
                data-tooltip="Mindestgewicht für Kanten: Höhere Werte blenden schwache Beziehungen aus. Link-Kanten und gemeinsame Tags bleiben nur sichtbar, wenn ihr berechnetes Gewicht mindestens diesem Wert entspricht."
              >
                <LucideNamedIcon name="Info" size={13} />
              </span>
            </span>
            <input
              className="graph-sidebar-number"
              type="number"
              min={0}
              max={20}
              value={graph.filters.minimumEdgeWeight}
              onChange={(event) => graph.updateFilters({ minimumEdgeWeight: Math.max(0, Number.parseFloat(event.target.value) || 0) })}
            />
          </div>
        </div>
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
              {renderCheckbox('showSharedTagEdges', 'Gemeinsame Tags', 'Gemeinsame Tags der ausgewählten Notiz mit maximal 50 Nachbarn. Wähle zuerst einen Notizknoten.')}
            </div>
          </div>
        </div>
        <p className="task-sidebar-summary">
          Sichtbar: {graph.filtered.nodes.length} Knoten, {graph.filtered.edges.length} Verbindungen. Insgesamt {graph.index?.nodes.length ?? 0} Knoten.
        </p>
      </section>
    </div>
  )
}

import cytoscape from 'cytoscape'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Core, ElementDefinition, EventObject, NodeSingular, StylesheetStyle } from 'cytoscape'
import type { GraphEdge, GraphNode, GraphNodePosition, GraphViewport } from '../app/AppShared'
import {ContextMenu, ContextMenuItem} from '../ui/ContextMenu'
import {isContextMenuKey} from '../ui/contextMenuAnchor'
import type {ContextMenuAnchor} from '../ui/contextMenuAnchor'

type GraphNetworkViewProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  searchText: string
  searchMode: 'filter' | 'highlight'
  positions: Record<string, GraphNodePosition>
  viewport: GraphViewport
  layoutVersion: number
  fitRequestVersion: number
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
  onRevealNodePath?: (path: string) => void
  onSelectNode?: (nodeId: string) => void
  onPositionsChange?: (positions: Record<string, GraphNodePosition>) => void
  onViewportChange?: (viewport: GraphViewport) => void
  onShowNeighbors?: (nodeId: string) => void
  onClearSelection?: () => void
  showDetails?: boolean
  compactChrome?: boolean
}

type SelectedGraphItem =
  | { kind: 'node'; node: GraphNode; connectedEdges: GraphEdge[]; neighbors: GraphNode[] }
  | { kind: 'edge'; edge: GraphEdge; source?: GraphNode; target?: GraphNode }
  | null

type GraphNodeContextMenu = ContextMenuAnchor & {
  node: GraphNode
} | null

const LARGE_GRAPH_NODE_WARNING = 450
const LARGE_GRAPH_EDGE_WARNING = 900

type GraphPhysicsSimulation = {
  kick: (heat?: number, fitWhenSettled?: boolean) => void
  reset: (randomize: boolean, fitWhenSettled?: boolean) => void
  setDraggedNode: (nodeId: string | null) => void
  stop: () => void
}

export function GraphNetworkView({
  nodes,
  edges,
  searchText,
  searchMode,
  positions,
  viewport,
  layoutVersion,
  fitRequestVersion,
  onOpenNodePath,
  onRevealNodePath,
  onSelectNode,
  onPositionsChange,
  onViewportChange,
  onShowNeighbors,
  onClearSelection,
  showDetails = true,
  compactChrome = false,
}: GraphNetworkViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const keyboardHintId = useId()
  const [selected, setSelected] = useState<SelectedGraphItem>(null)
  const [hoverText, setHoverText] = useState('')
  const [initError, setInitError] = useState('')
  const [nodeContextMenu, setNodeContextMenu] = useState<GraphNodeContextMenu>(null)
  const applyingViewportRef = useRef(false)
  const viewportTimerRef = useRef<number | null>(null)
  const zoomStyleTimerRef = useRef<number | null>(null)
  const physicsSimulationRef = useRef<GraphPhysicsSimulation | null>(null)
  const lastLayoutVersionRef = useRef(layoutVersion)
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const displayEdges = useMemo(() => aggregateDisplayEdges(edges, nodes), [edges, nodes])
  const connectedEdgesByNode = useMemo(() => {
    const map = new Map<string, GraphEdge[]>()
    for (const edge of displayEdges) {
      if (!map.has(edge.source)) {
        map.set(edge.source, [])
      }
      if (!map.has(edge.target)) {
        map.set(edge.target, [])
      }
      map.get(edge.source)?.push(edge)
      map.get(edge.target)?.push(edge)
    }
    return map
  }, [displayEdges])
  const elements = useMemo<ElementDefinition[]>(() => buildElements(nodes, displayEdges, searchText, searchMode), [displayEdges, nodes, searchMode, searchText])
  const largeGraph = nodes.length > LARGE_GRAPH_NODE_WARNING || displayEdges.length > LARGE_GRAPH_EDGE_WARNING
  const nodeByIdRef = useLatest(nodeById)
  const edgeByIdRef = useLatest(useMemo(() => new Map(displayEdges.map((edge) => [edge.id, edge])), [displayEdges]))
  const connectedEdgesByNodeRef = useLatest(connectedEdgesByNode)
  const onOpenNodePathRef = useLatest(onOpenNodePath)
  const onRevealNodePathRef = useLatest(onRevealNodePath)
  const onSelectNodeRef = useLatest(onSelectNode)
  const onPositionsChangeRef = useLatest(onPositionsChange)
  const onViewportChangeRef = useLatest(onViewportChange)
  const onShowNeighborsRef = useLatest(onShowNeighbors)
  const onClearSelectionRef = useLatest(onClearSelection)
  const viewportRef = useLatest(viewport)
  const positionsRef = useLatest(positions)
  const largeGraphRef = useLatest(largeGraph)

  const selectGraphNode = useCallback((nodeId: string) => {
    const cy = cyRef.current
    const node = nodeByIdRef.current.get(nodeId)
    if (!cy || !node) return
    const connectedEdges = connectedEdgesByNodeRef.current.get(nodeId) ?? []
    const neighbors = connectedEdges
      .map(edge => nodeByIdRef.current.get(edge.source === nodeId ? edge.target : edge.source))
      .filter((neighbor): neighbor is GraphNode => Boolean(neighbor))
    applySelectionFocus(cy, nodeId, largeGraphRef.current)
    setSelected({kind: 'node', node, connectedEdges, neighbors})
    onSelectNodeRef.current?.(nodeId)
  }, [connectedEdgesByNodeRef, largeGraphRef, nodeByIdRef, onSelectNodeRef])

  useEffect(() => {
    if (!hostRef.current || cyRef.current) {
      return
    }
    try {
      const cy = cytoscape({
        container: hostRef.current,
        elements: [],
        style: createCytoscapeStyles(readGraphThemeColors()),
        minZoom: 0.08,
        maxZoom: 3,
        autounselectify: true,
      })
      cyRef.current = cy
      applyGraphThemeColors(cy)
      physicsSimulationRef.current = createGraphPhysicsSimulation(cy, largeGraphRef, () => {
        onPositionsChangeRef.current?.(collectPositions(cy))
      }, () => {
        fitGraphToViewport(cy)
      })
      applyZoomDensity(cy, false)

      cy.on('tap', 'node', (event) => {
        setNodeContextMenu(null)
        selectGraphNode(event.target.id())
      })

      cy.on('tap', 'edge', (event) => {
        const edgeId = event.target.id()
        const edge = edgeByIdRef.current.get(edgeId)
        applyEdgeFocus(cy, edgeId, largeGraphRef.current)
        setNodeContextMenu(null)
        setSelected(edge ? { kind: 'edge', edge, source: nodeByIdRef.current.get(edge.source), target: nodeByIdRef.current.get(edge.target) } : null)
      })

      cy.on('tap', (event) => {
        if (event.target === cy) {
          clearSelectionFocus(cy, largeGraphRef.current)
          setNodeContextMenu(null)
          setSelected(null)
          onSelectNodeRef.current?.('')
          onClearSelectionRef.current?.()
        }
      })

      cy.on('cxttap', 'node', (event) => {
        const node = nodeByIdRef.current.get(event.target.id())
        if (!node) {
          return
        }
        const host = hostRef.current
        if (!host) return
        const originalEvent = event.originalEvent as MouseEvent | undefined
        const bounds = host.getBoundingClientRect()
        originalEvent?.preventDefault()
        selectGraphNode(node.id)
        host.focus({preventScroll: true})
        setNodeContextMenu({
          x: originalEvent?.clientX ?? bounds.left + event.renderedPosition.x,
          y: originalEvent?.clientY ?? bounds.top + event.renderedPosition.y,
          trigger: host,
          node,
        })
      })

      cy.on('cxttap', (event) => {
        if (event.target === cy) {
          setNodeContextMenu(null)
        }
      })

      cy.on('dbltap', 'node', (event) => {
        const node = nodeByIdRef.current.get(event.target.id())
        if (!node || (node.type !== 'note' && node.type !== 'task') || !node.path) {
          return
        }
        onOpenNodePathRef.current?.(node.path, node.label, node.type)
      })

      cy.on('mouseover', 'node, edge', (event: EventObject) => {
        const target = event.target
        if (target.isNode()) {
          const node = nodeByIdRef.current.get(target.id())
          setHoverText(node ? `${node.label} (${node.type})` : target.id())
          return
        }
        const edge = edgeByIdRef.current.get(target.id())
        setHoverText(edge ? `${edge.type} | ${edge.weight}` : target.id())
      })

      cy.on('mouseout', 'node, edge', () => {
        setHoverText('')
      })

      cy.on('grab', 'node', (event) => {
        physicsSimulationRef.current?.setDraggedNode(event.target.id())
        physicsSimulationRef.current?.kick(0.72)
      })

      cy.on('drag', 'node', () => {
        physicsSimulationRef.current?.kick(0.46)
      })

      cy.on('free', 'node', () => {
        physicsSimulationRef.current?.setDraggedNode(null)
        physicsSimulationRef.current?.kick(0.82)
      })

      cy.on('zoom pan', () => {
        if (applyingViewportRef.current) {
          return
        }
        if (zoomStyleTimerRef.current === null) {
          zoomStyleTimerRef.current = window.setTimeout(() => {
            zoomStyleTimerRef.current = null
            applyZoomDensity(cy, largeGraphRef.current)
          }, 80)
        }
        if (viewportTimerRef.current !== null) {
          return
        }
        viewportTimerRef.current = window.setTimeout(() => {
          viewportTimerRef.current = null
          const pan = cy.pan()
          onViewportChangeRef.current?.({ zoom: cy.zoom(), pan: { x: pan.x, y: pan.y } })
        }, 160)
      })
    } catch (caught) {
      window.setTimeout(() => setInitError(`Cytoscape konnte nicht initialisiert werden: ${String(caught)}`), 0)
    }
    return () => {
      if (viewportTimerRef.current !== null) {
        window.clearTimeout(viewportTimerRef.current)
        viewportTimerRef.current = null
      }
      if (zoomStyleTimerRef.current !== null) {
        window.clearTimeout(zoomStyleTimerRef.current)
        zoomStyleTimerRef.current = null
      }
      const cy = cyRef.current
      if (cy) {
        physicsSimulationRef.current?.stop()
        physicsSimulationRef.current = null
        cy.destroy()
      }
      cyRef.current = null
    }
  }, [connectedEdgesByNodeRef, edgeByIdRef, largeGraphRef, nodeByIdRef, onClearSelectionRef, onOpenNodePathRef, onPositionsChangeRef, onSelectNodeRef, onViewportChangeRef, selectGraphNode])

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const cy = cyRef.current
      if (!cy) {
        return
      }
      applyGraphThemeColors(cy)
    }
    applyTheme()
    const observer = new MutationObserver(applyTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) {
      return
    }
    try {
      cy.batch(() => {
        cy.elements().remove()
        cy.add(elements)
        clearSelectionFocus(cy, largeGraph)
        applyStoredPositions(cy, positionsRef.current)
      })
      const layoutRequested = layoutVersion !== lastLayoutVersionRef.current
      const shouldRunLayout = layoutRequested || !hasEnoughStoredPositions(nodes, positionsRef.current)
      lastLayoutVersionRef.current = layoutVersion
      if (shouldRunLayout) {
        physicsSimulationRef.current?.reset(layoutRequested, true)
      } else {
        physicsSimulationRef.current?.kick(0.58, true)
      }
      window.setTimeout(() => fitGraphToViewport(cy), 0)
      window.setTimeout(() => applyZoomDensity(cy, largeGraph), 0)
    } catch (caught) {
      window.setTimeout(() => setInitError(`Graph konnte nicht gerendert werden: ${String(caught)}`), 0)
    }
  }, [elements, largeGraph, layoutVersion, nodes, onPositionsChangeRef, positionsRef, viewportRef])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) {
      return
    }
    fitGraphToViewport(cy)
  }, [fitRequestVersion])

  return (
    <section className={`graph-network-shell ${compactChrome ? 'compact-chrome' : ''}`}>
      {!compactChrome && largeGraph ? (
        <p className="graph-warning">
          Groesserer Graph sichtbar. Layout laeuft ohne Animation; Filter koennen die Ansicht fluessiger machen.
        </p>
      ) : null}
      {initError ? <p className="graph-error">{initError}</p> : null}
      <div className={`graph-network-grid ${showDetails ? '' : 'graph-network-grid-full'}`}>
        <div className="graph-network-canvas-wrap">
          <div ref={hostRef} className="graph-network-canvas" tabIndex={0}
            role="group" aria-label="Wissensgraph" aria-describedby={keyboardHintId}
            onContextMenu={event => event.preventDefault()}
            onKeyDown={event => {
              if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return
              const index = selected?.kind === 'node' ? nodes.findIndex(node => node.id === selected.node.id) : -1
              if (isContextMenuKey(event)) {
                event.preventDefault(); event.stopPropagation()
                const node = nodes[index < 0 ? 0 : index]
                const position = node && cyRef.current?.getElementById(node.id).renderedPosition()
                if (!node || !position) return
                const bounds = event.currentTarget.getBoundingClientRect()
                selectGraphNode(node.id)
                setNodeContextMenu({x: bounds.left + position.x, y: bounds.top + position.y, trigger: event.currentTarget, node})
              } else if (['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation()
                if (!nodes.length) return
                const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1
                  : index < 0 ? backwards ? nodes.length - 1 : 0 : (index + (backwards ? -1 : 1) + nodes.length) % nodes.length
                selectGraphNode(nodes[next].id)
              }
            }} />
          <GraphLegend />
          <p className="graph-keyboard-hint" id={keyboardHintId} role="status">
            {selected?.kind === 'node' && nodeById.has(selected.node.id) ? `${nodeById.get(selected.node.id)?.label || selected.node.id}. ` : 'Kein Knoten ausgewählt. '}
            Pfeile/Home/End: Knoten wählen. Shift+F10: Aktionen.
          </p>
          {hoverText ? <div className="graph-network-hover">{hoverText}</div> : null}
          {nodeContextMenu ? (
            <GraphNodeContextMenu
              menu={nodeContextMenu}
              onClose={() => setNodeContextMenu(null)}
              onFocus={selectGraphNode}
              onReveal={(path) => {
                onRevealNodePathRef.current?.(path)
                setNodeContextMenu(null)
              }}
              onOpen={(node) => {
                if (node.path && (node.type === 'note' || node.type === 'task')) {
                  onOpenNodePathRef.current?.(node.path, node.label, node.type)
                }
                setNodeContextMenu(null)
              }}
            />
          ) : null}
          {nodes.length === 0 ? <p className="graph-network-empty">Keine Knoten im aktuellen Filter.</p> : null}
        </div>
        {showDetails ? (
          <GraphSelectionPanel
            selected={selected}
            onOpenNodePath={onOpenNodePath}
            onShowNeighbors={(nodeId) => onShowNeighborsRef.current?.(nodeId)}
            onFocusNode={(nodeId) => {
              onSelectNodeRef.current?.(nodeId)
              onShowNeighborsRef.current?.(nodeId)
            }}
            onClearSelection={() => {
              setSelected(null)
              onSelectNodeRef.current?.('')
              onClearSelectionRef.current?.()
            }}
          />
        ) : null}
      </div>
    </section>
  )
}

function GraphLegend() {
  return (
    <div className="graph-legend" aria-label="Graph Legende">
      <span><i className="legend-node note" /> Note</span>
      <span><i className="legend-node task" /> Task</span>
      <span><i className="legend-node tag" /> Tag</span>
      <span><i className="legend-edge" /> Beziehung</span>
    </div>
  )
}

function GraphSelectionPanel({
  selected,
  onOpenNodePath,
  onShowNeighbors,
  onFocusNode,
  onClearSelection,
}: {
  selected: SelectedGraphItem
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
  onShowNeighbors: (nodeId: string) => void
  onFocusNode: (nodeId: string) => void
  onClearSelection: () => void
}) {
  if (!selected) {
    return (
      <aside className="graph-selection-panel">
        <h3>Details</h3>
        <p className="empty-copy">Knoten oder Kante auswaehlen.</p>
        <button className="muted graph-reset-button" onClick={onClearSelection}>
          Auswahl zuruecksetzen
        </button>
      </aside>
    )
  }

  if (selected.kind === 'edge') {
    return (
      <aside className="graph-selection-panel">
        <h3>Kante</h3>
        <Detail label="Typ" value={selected.edge.type} />
        <Detail label="Gewicht" value={String(selected.edge.weight)} />
        <Detail label="Source" value={selected.source?.label || selected.edge.source} />
        <Detail label="Target" value={selected.target?.label || selected.edge.target} />
        <div className="graph-selection-block">
          <span>Reasons</span>
          <ul>
            {selected.edge.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <button className="muted graph-reset-button" onClick={onClearSelection}>
          Auswahl zuruecksetzen
        </button>
      </aside>
    )
  }

  return (
    <aside className="graph-selection-panel">
      <h3>Knoten</h3>
      <Detail label="Label" value={selected.node.label} />
      <Detail label="Typ" value={selected.node.type} />
      <Detail label="Pfad" value={selected.node.path || '-'} />
      <Detail label="ID" value={selected.node.id} />
      <Detail label="Ausgehende Links" value={String(selected.connectedEdges.filter((edge) => edge.type === 'link' && edge.source === selected.node.id).length)} />
      <Detail label="Eingehende Links" value={String(selected.connectedEdges.filter((edge) => edge.type === 'link' && edge.target === selected.node.id).length)} />
      <Detail label="Shared Tags" value={String(selected.connectedEdges.filter((edge) => edge.type === 'sharedTag').length)} />
      <div className="graph-selection-actions">
        {selected.node.path && (selected.node.type === 'note' || selected.node.type === 'task') ? (
          <button
            className="primary graph-reset-button"
            onClick={() => {
              if (selected.node.path && (selected.node.type === 'note' || selected.node.type === 'task')) {
                onOpenNodePath?.(selected.node.path, selected.node.label, selected.node.type)
              }
            }}
          >
            Notiz oeffnen
          </button>
        ) : null}
        <button className="muted graph-reset-button" onClick={() => onShowNeighbors(selected.node.id)}>
          Nur Nachbarn anzeigen
        </button>
        <button className="muted graph-reset-button" onClick={() => onFocusNode(selected.node.id)}>
          Fokus auf diesen Node
        </button>
        <button className="muted graph-reset-button" onClick={onClearSelection}>
          Auswahl zuruecksetzen
        </button>
      </div>
      <div className="graph-selection-block">
        <span>Wichtigste Verbindungen</span>
        <ul>
          {selected.connectedEdges
            .slice()
            .sort((left, right) => right.weight - left.weight)
            .slice(0, 12)
            .map((edge) => {
              const neighborId = edge.source === selected.node.id ? edge.target : edge.source
              const neighbor = selected.neighbors.find((item) => item.id === neighborId)
              return <li key={edge.id}>{edge.type}: {neighbor?.label || neighborId} ({edge.weight})</li>
            })}
        </ul>
      </div>
      <div className="graph-selection-block">
        <span>Nachbarn</span>
        <ul>
          {selected.neighbors.slice(0, 24).map((neighbor) => (
            <li key={neighbor.id}>{neighbor.label || neighbor.id}</li>
          ))}
          {selected.neighbors.length > 24 ? <li>{selected.neighbors.length - 24} weitere</li> : null}
        </ul>
      </div>
      <div className="graph-selection-block">
        <span>Verbundene Kanten</span>
        <ul>
          {selected.connectedEdges.slice(0, 24).map((edge) => (
            <li key={edge.id}>{edge.type}: {edge.weight}</li>
          ))}
          {selected.connectedEdges.length > 24 ? <li>{selected.connectedEdges.length - 24} weitere</li> : null}
        </ul>
      </div>
    </aside>
  )
}

function GraphNodeContextMenu({
  menu,
  onClose,
  onFocus,
  onReveal,
  onOpen,
}: {
  menu: NonNullable<GraphNodeContextMenu>
  onClose: () => void
  onFocus: (nodeId: string) => void
  onReveal: (path: string) => void
  onOpen: (node: GraphNode) => void
}) {
  const canOpen = Boolean(menu.node.path && (menu.node.type === 'note' || menu.node.type === 'task'))
  return (
    <ContextMenu anchor={menu} label={`Knotenaktionen: ${menu.node.label || menu.node.id}`} heading={menu.node.label || menu.node.id} onClose={onClose}>
      <ContextMenuItem onClick={() => onFocus(menu.node.id)}>Knoten hervorheben</ContextMenuItem>
      <ContextMenuItem onClick={() => menu.node.path && onReveal(menu.node.path)} disabled={!canOpen}>
        Im Explorer anzeigen
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onOpen(menu.node)} disabled={!canOpen}>
        Im Editor oeffnen
      </ContextMenuItem>
      <ContextMenuItem onClick={onClose}>
        Schliessen
      </ContextMenuItem>
    </ContextMenu>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="graph-selection-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function buildElements(nodes: GraphNode[], edges: GraphEdge[], searchText: string, searchMode: 'filter' | 'highlight'): ElementDefinition[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const query = searchText.trim().toLowerCase()
  const matchedNodeIds = new Set(nodes.filter((node) => query && matchesNode(node, query)).map((node) => node.id))
  const nodeElements = nodes.map<ElementDefinition>((node) => ({
    group: 'nodes',
    data: {
      id: node.id,
      label: node.label || node.id,
      type: node.type,
    },
    classes: [
      node.type,
      query && matchedNodeIds.has(node.id) ? 'search-match' : '',
      query && searchMode === 'highlight' && !matchedNodeIds.has(node.id) ? 'search-muted' : '',
    ].filter(Boolean).join(' '),
  }))
  const edgeElements = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map<ElementDefinition>((edge) => ({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.type,
        type: edge.type,
        weight: edge.weight,
      },
      classes: [
        edge.type,
        query && searchMode === 'highlight' && !matchedNodeIds.has(edge.source) && !matchedNodeIds.has(edge.target) ? 'search-muted' : '',
      ].filter(Boolean).join(' '),
    }))
  return [...nodeElements, ...edgeElements]
}

function aggregateDisplayEdges(edges: GraphEdge[], nodes: GraphNode[]): GraphEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const merged = new Map<string, GraphEdge>()
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      continue
    }
    const [source, target] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
    const id = `relationship:${source}<->${target}`
    const current = merged.get(id)
    if (!current) {
      merged.set(id, { ...edge, id, source, target, reasons: [...edge.reasons] })
      continue
    }
    current.weight += edge.weight
    current.type = preferredRelationshipType(current.type, edge.type)
    for (const reason of edge.reasons) {
      if (!current.reasons.includes(reason)) {
        current.reasons.push(reason)
      }
    }
  }
  return Array.from(merged.values())
}

function preferredRelationshipType(left: GraphEdge['type'], right: GraphEdge['type']): GraphEdge['type'] {
  const priority = { link: 3, tagUsage: 2, sharedTag: 1 }
  return (priority[right] ?? 0) > (priority[left] ?? 0) ? right : left
}

function matchesNode(node: GraphNode, query: string): boolean {
  return [node.id, node.label, node.path, node.group, node.tag].some((value) => String(value ?? '').toLowerCase().includes(query))
}

function hasEnoughStoredPositions(nodes: GraphNode[], positions: Record<string, GraphNodePosition>): boolean {
  if (nodes.length === 0) {
    return true
  }
  const positioned = nodes.filter((node) => positions[node.id]).length
  return positioned / nodes.length >= 0.7
}

function applyStoredPositions(cy: Core, positions: Record<string, GraphNodePosition>) {
  cy.nodes().forEach((node, index) => {
    const position = positions[node.id()]
    if (position) {
      node.position(position)
      return
    }
    const angle = (index / Math.max(1, cy.nodes().length)) * Math.PI * 2
    node.position({ x: Math.cos(angle) * 160, y: Math.sin(angle) * 160 })
  })
}

function collectPositions(cy: Core): Record<string, GraphNodePosition> {
  const next: Record<string, GraphNodePosition> = {}
  cy.nodes().forEach((node) => {
    const position = node.position()
    next[node.id()] = { x: Math.round(position.x), y: Math.round(position.y) }
  })
  return next
}

function fitGraphToViewport(cy: Core) {
  if (!cy.destroyed() && cy.nodes().length > 0) {
    cy.fit(cy.nodes(), 54)
  }
}

function applySelectionFocus(cy: Core, nodeId: string, largeGraph: boolean) {
  clearSelectionFocus(cy, largeGraph)
  const node = cy.getElementById(nodeId)
  if (!node.length) {
    return
  }
  const visibleEdges = node.connectedEdges(':visible')
  const visibleNeighbors = visibleEdges.connectedNodes(':visible')
  const activeElements = node.union(visibleEdges).union(visibleNeighbors)
  node.addClass('graph-focus-primary')
  visibleNeighbors.addClass('graph-focus-neighbor')
  visibleEdges.addClass('graph-focus-edge')
  const muted = cy.elements().difference(activeElements)
  muted.addClass('graph-muted')
  muted.nodes().style({ opacity: 0.16, 'text-opacity': 0.04 })
  muted.edges().style({ opacity: 0.07, 'target-arrow-shape': 'none' })
}

function applyEdgeFocus(cy: Core, edgeId: string, largeGraph: boolean) {
  clearSelectionFocus(cy, largeGraph)
  const edge = cy.getElementById(edgeId)
  if (!edge.length) {
    return
  }
  const activeElements = edge.union(edge.connectedNodes(':visible'))
  const muted = cy.elements().difference(activeElements)
  muted.addClass('graph-muted')
  muted.nodes().style({ opacity: 0.16, 'text-opacity': 0.04 })
  muted.edges().style({ opacity: 0.07, 'target-arrow-shape': 'none' })
}

function clearSelectionFocus(cy: Core, largeGraph: boolean) {
  cy.elements().removeClass('graph-muted graph-focus-primary graph-focus-neighbor graph-focus-edge')
  cy.nodes().removeStyle('opacity')
  cy.edges().removeStyle('opacity target-arrow-shape')
  applyZoomDensity(cy, largeGraph)
}

function applyZoomDensity(cy: Core, largeGraph: boolean) {
  if (cy.destroyed()) {
    return
  }
  const zoom = cy.zoom()
  const exponent = largeGraph ? 1.15 : 0.75
  const minFactor = largeGraph ? 0.28 : 0.42
  const factor = zoom > 1 ? Math.max(minFactor, Math.pow(zoom, -exponent)) : 1
  const labelOpacity = largeGraph ? (zoom < 0.65 ? 0.08 : zoom < 1.2 ? 0.28 : 0.64) : 0.92
  const edgeFactor = zoom > 1 ? Math.max(0.34, Math.pow(zoom, -0.85)) : 1

  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const nodeType = String(node.data('type') ?? '')
      const baseWidth = nodeType === 'task' ? 18 : nodeType === 'tag' ? 14 : 16
      const baseHeight = baseWidth
      const baseFontSize = nodeType === 'tag' ? 8 : 9
      node.style({
        width: Math.max(7, Math.round(baseWidth * factor)),
        height: Math.max(7, Math.round(baseHeight * factor)),
        'font-size': Math.max(3, Math.round(baseFontSize * factor)),
        'border-width': Math.max(0.5, 1.2 * factor),
        'text-opacity': labelOpacity,
      })
    })

    cy.edges().forEach((edge) => {
      const edgeType = String(edge.data('type') ?? '')
      const weight = Number(edge.data('weight') ?? 1)
      const baseWidth =
        edgeType === 'tagUsage'
          ? Math.max(0.8, Math.min(3, weight / 2.8))
          : edgeType === 'sharedTag'
              ? Math.max(1, Math.min(5, weight / 2.4))
              : Math.max(1, Math.min(5, weight / 1.8))
      edge.style({
        width: Math.max(0.35, baseWidth * edgeFactor),
        opacity: edgeType === 'sharedTag' ? 0.26 : largeGraph ? 0.38 : 0.48,
      })
    })
  })
}

function createGraphPhysicsSimulation(
  cy: Core,
  largeGraphRef: { current: boolean },
  onSettled: () => void,
  onFitRequested: () => void,
): GraphPhysicsSimulation {
  const velocities = new Map<string, GraphNodePosition>()
  let animationFrame: number | null = null
  let draggedNodeId: string | null = null
  let heat = 0
  let lastFrameTime = 0
  let lastInteractionTime = 0
  let quietFrames = 0
  let fitWhenSettled = false
  let center = { x: 0, y: 0 }

  const captureCenter = () => {
    const graphNodes = collectGraphNodes(cy)
    if (graphNodes.length === 0) {
      center = { x: 0, y: 0 }
      return
    }
    const sum = graphNodes.reduce(
      (current, node) => {
        const position = node.position()
        return { x: current.x + position.x, y: current.y + position.y }
      },
      { x: 0, y: 0 },
    )
    center = { x: sum.x / graphNodes.length, y: sum.y / graphNodes.length }
  }

  const stop = () => {
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    heat = 0
    lastFrameTime = 0
    quietFrames = 0
    velocities.clear()
  }

  const tick = (frameTime: number) => {
    animationFrame = null
    if (cy.destroyed()) {
      return
    }
    const graphNodes = collectGraphNodes(cy)
    if (graphNodes.length === 0) {
      onSettled()
      return
    }
    const timeStep = lastFrameTime ? Math.min(1.8, Math.max(0.45, (frameTime - lastFrameTime) / 16.67)) : 1
    lastFrameTime = frameTime
    const forces = new Map(graphNodes.map((node) => [node.id(), { x: 0, y: 0 }]))
    const repulsion = largeGraphRef.current ? 1180 : 1650

    for (let leftIndex = 0; leftIndex < graphNodes.length - 1; leftIndex += 1) {
      const left = graphNodes[leftIndex]
      const leftPosition = left.position()
      for (let rightIndex = leftIndex + 1; rightIndex < graphNodes.length; rightIndex += 1) {
        const right = graphNodes[rightIndex]
        const rightPosition = right.position()
        let deltaX = rightPosition.x - leftPosition.x
        let deltaY = rightPosition.y - leftPosition.y
        let distanceSquared = deltaX * deltaX + deltaY * deltaY
        if (distanceSquared < 1) {
          deltaX = (rightIndex - leftIndex) % 2 === 0 ? 1 : -1
          deltaY = 1
          distanceSquared = 2
        }
        const distance = Math.sqrt(distanceSquared)
        const force = repulsion / Math.max(140, distanceSquared)
        const forceX = (deltaX / distance) * force
        const forceY = (deltaY / distance) * force
        addForce(forces, left.id(), -forceX, -forceY)
        addForce(forces, right.id(), forceX, forceY)
      }
    }

    cy.edges().forEach((edge) => {
      const source = edge.source()
      const target = edge.target()
      const sourcePosition = source.position()
      const targetPosition = target.position()
      const deltaX = targetPosition.x - sourcePosition.x
      const deltaY = targetPosition.y - sourcePosition.y
      const distance = Math.max(0.01, Math.sqrt(deltaX * deltaX + deltaY * deltaY))
      const edgeType = String(edge.data('type') ?? '')
      const weight = Math.max(1, Number(edge.data('weight') ?? 1))
      const restLength = edgeType === 'tagUsage' ? 78 : edgeType === 'sharedTag' ? 118 : 104
      const stiffness = (edgeType === 'tagUsage' ? 0.014 : edgeType === 'sharedTag' ? 0.007 : 0.012) * (1 + Math.min(8, weight) * 0.08)
      const force = (distance - restLength) * stiffness
      const forceX = (deltaX / distance) * force
      const forceY = (deltaY / distance) * force
      addForce(forces, source.id(), forceX, forceY)
      addForce(forces, target.id(), -forceX, -forceY)
    })

    let maximumSpeed = 0
    const isSettling = !draggedNodeId && heat < 0.18
    const damping = draggedNodeId ? 0.9 : isSettling ? 0.62 : 0.82
    const effectiveHeat = draggedNodeId ? Math.max(0.08, heat) : heat
    cy.batch(() => {
      graphNodes.forEach((node) => {
        const nodeId = node.id()
        if (nodeId === draggedNodeId || node.grabbed()) {
          velocities.set(nodeId, { x: 0, y: 0 })
          return
        }
        const position = node.position()
        const force = forces.get(nodeId) ?? { x: 0, y: 0 }
        force.x += (center.x - position.x) * 0.0017
        force.y += (center.y - position.y) * 0.0017
        const currentVelocity = velocities.get(nodeId) ?? { x: 0, y: 0 }
        const nextVelocity = {
          x: clamp((currentVelocity.x + force.x * effectiveHeat * timeStep) * damping, -22, 22),
          y: clamp((currentVelocity.y + force.y * effectiveHeat * timeStep) * damping, -22, 22),
        }
        if (isSettling && Math.abs(nextVelocity.x) + Math.abs(nextVelocity.y) < 0.04) {
          velocities.set(nodeId, { x: 0, y: 0 })
          return
        }
        velocities.set(nodeId, nextVelocity)
        maximumSpeed = Math.max(maximumSpeed, Math.abs(nextVelocity.x) + Math.abs(nextVelocity.y))
        node.position({
          x: position.x + nextVelocity.x * timeStep,
          y: position.y + nextVelocity.y * timeStep,
        })
      })
    })

    heat = draggedNodeId ? Math.max(0.42, heat * 0.985) : heat * 0.95
    quietFrames = !draggedNodeId && heat < 0.14 && maximumSpeed < 0.42 ? quietFrames + 1 : 0
    if (quietFrames >= 8 || (!draggedNodeId && frameTime - lastInteractionTime > 3000)) {
      stop()
      onSettled()
      if (fitWhenSettled) {
        fitWhenSettled = false
        onFitRequested()
      }
      return
    }
    animationFrame = window.requestAnimationFrame(tick)
  }

  const kick = (nextHeat = 0.7, nextFitWhenSettled = false) => {
    if (cy.destroyed()) {
      return
    }
    if (animationFrame === null) {
      captureCenter()
      lastFrameTime = 0
      quietFrames = 0
      animationFrame = window.requestAnimationFrame(tick)
    }
    lastInteractionTime = performance.now()
    fitWhenSettled ||= nextFitWhenSettled
    heat = Math.max(heat, nextHeat)
  }

  const reset = (randomize: boolean, nextFitWhenSettled = false) => {
    stop()
    velocities.clear()
    if (randomize) {
      randomizePhysicsPositions(cy)
    }
    kick(1.18, nextFitWhenSettled)
  }

  return {
    kick,
    reset,
    setDraggedNode: (nodeId) => {
      draggedNodeId = nodeId
      if (nodeId) {
        velocities.set(nodeId, { x: 0, y: 0 })
      }
    },
    stop,
  }
}

function collectGraphNodes(cy: Core): NodeSingular[] {
  return cy.nodes().toArray().filter((node): node is NodeSingular => node.isNode())
}

function addForce(forces: Map<string, GraphNodePosition>, nodeId: string, x: number, y: number) {
  const force = forces.get(nodeId)
  if (!force) {
    return
  }
  force.x += x
  force.y += y
}

function randomizePhysicsPositions(cy: Core) {
  const graphNodes = collectGraphNodes(cy)
  const radius = Math.max(180, Math.sqrt(graphNodes.length) * 44)
  graphNodes.forEach((node, index) => {
    const angle = index * 2.399963229728653
    const distance = radius * Math.sqrt((index + 1) / Math.max(1, graphNodes.length))
    node.position({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance })
  })
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

type GraphThemeColors = {
  text: string
  graphNote: string
  graphTask: string
  graphTag: string
  line: string
}

function readCssVariable(name: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function readGraphThemeColors(): GraphThemeColors {
  return {
    text: readCssVariable('--text', '#edf0f5'),
    graphNote: readCssVariable('--graph-note', '#91aeca'),
    graphTask: readCssVariable('--graph-task', '#d4ae61'),
    graphTag: readCssVariable('--graph-tag', '#c98989'),
    line: readCssVariable('--line', '#99a3ad'),
  }
}

function applyGraphThemeColors(cy: Core): void {
  const colors = readGraphThemeColors()
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const nodeType = String(node.data('type') ?? '')
      const graphColor = nodeType === 'task' ? colors.graphTask : nodeType === 'tag' ? colors.graphTag : colors.graphNote
      node.style({
        color: colors.text,
        'background-color': graphColor,
        'border-color': graphColor,
      })
    })
  })
}

function createCytoscapeStyles(colors: GraphThemeColors): StylesheetStyle[] {
  return [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 10,
      color: colors.text,
      'text-outline-width': 0,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'background-color': colors.graphNote,
      'border-color': colors.graphNote,
      'border-width': 1,
      width: 16,
      height: 16,
    },
  },
  {
    selector: 'node.task',
    style: {
      shape: 'ellipse',
      'background-color': colors.graphTask,
      'border-color': colors.graphTask,
      width: 18,
      height: 18,
    },
  },
  {
    selector: 'node.tag',
    style: {
      shape: 'ellipse',
      'background-color': colors.graphTag,
      'border-color': colors.graphTag,
      width: 14,
      height: 14,
      'font-size': 8,
    },
  },
  {
    selector: 'node.search-match',
    style: {
      'border-width': 2.5,
      'border-color': '#ffffff',
      'background-opacity': 1,
      'z-index': 24,
    },
  },
  {
    selector: 'node.search-muted',
    style: {
      opacity: 0.22,
      'text-opacity': 0.08,
    },
  },
  {
    selector: 'edge.search-muted',
    style: {
      opacity: 0.08,
    },
  },
  {
    selector: 'node.graph-focus-primary',
    style: {
      'border-color': '#ffffff',
      'border-width': 2.4,
      'background-opacity': 1,
      opacity: 1,
      width: 21,
      height: 21,
      'z-compound-depth': 'top',
      'z-index': 20,
    },
  },
  {
    selector: 'node.graph-focus-neighbor',
    style: {
      'border-color': '#dce3ee',
      'border-width': 2,
      'z-index': 14,
    },
  },
  {
    selector: 'edge.graph-focus-edge',
    style: {
      opacity: 0.92,
      'z-index': 12,
    },
  },
  {
    selector: 'node.graph-muted',
    style: {
      opacity: 0.16,
      'text-opacity': 0.04,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'mapData(weight, 1, 8, 1, 5)',
      'line-color': colors.line,
      'target-arrow-shape': 'none',
      'curve-style': 'bezier',
      opacity: 0.48,
    },
  },
  {
    selector: 'edge.link',
    style: {
      'line-color': '#9caaba',
      opacity: 0.54,
    },
  },
  {
    selector: 'edge.tagUsage',
    style: {
      'line-color': '#9caf9f',
      width: 'mapData(weight, 1, 8, 0.8, 3)',
      opacity: 0.46,
    },
  },
  {
    selector: 'edge.sharedTag',
    style: {
      'line-color': '#aebbb3',
      'target-arrow-shape': 'none',
      'curve-style': 'unbundled-bezier',
      'control-point-distance': 18,
      width: 'mapData(weight, 2, 10, 1, 5)',
      opacity: 0.34,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#ffffff',
      width: 6,
      opacity: 1,
    },
  },
  {
    selector: 'edge.graph-muted',
    style: {
      opacity: 0.07,
      'target-arrow-shape': 'none',
    },
  },
  ]
}

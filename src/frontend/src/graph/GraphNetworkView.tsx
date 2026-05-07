import cytoscape from 'cytoscape'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Core, ElementDefinition, EventObject, StylesheetStyle } from 'cytoscape'
import type { GraphEdge, GraphNode } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'

type GraphNetworkViewProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  searchText: string
  onOpenNodePath?: (path: string, title: string, nodeType: 'note' | 'task') => void
}

type SelectedGraphItem =
  | { kind: 'node'; node: GraphNode; connectedEdges: GraphEdge[]; neighbors: GraphNode[] }
  | { kind: 'edge'; edge: GraphEdge; source?: GraphNode; target?: GraphNode }
  | null

const LARGE_GRAPH_NODE_WARNING = 450
const LARGE_GRAPH_EDGE_WARNING = 900

export function GraphNetworkView({ nodes, edges, searchText, onOpenNodePath }: GraphNetworkViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const [selected, setSelected] = useState<SelectedGraphItem>(null)
  const [hoverText, setHoverText] = useState('')
  const [initError, setInitError] = useState('')
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const connectedEdgesByNode = useMemo(() => {
    const map = new Map<string, GraphEdge[]>()
    for (const edge of edges) {
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
  }, [edges])
  const elements = useMemo<ElementDefinition[]>(() => buildElements(nodes, edges, searchText), [edges, nodes, searchText])
  const largeGraph = nodes.length > LARGE_GRAPH_NODE_WARNING || edges.length > LARGE_GRAPH_EDGE_WARNING

  useEffect(() => {
    if (!hostRef.current || cyRef.current) {
      return
    }
    try {
      const cy = cytoscape({
        container: hostRef.current,
        elements: [],
        style: cytoscapeStyles,
        minZoom: 0.08,
        maxZoom: 3,
        wheelSensitivity: 0.18,
      })
      cyRef.current = cy

      cy.on('tap', 'node', (event) => {
        const nodeId = event.target.id()
        const node = nodeByIdRef.current.get(nodeId)
        if (!node) {
          setSelected(null)
          return
        }
        const connectedEdges = connectedEdgesByNodeRef.current.get(nodeId) ?? []
        const neighbors = connectedEdges
          .map((edge) => nodeByIdRef.current.get(edge.source === nodeId ? edge.target : edge.source))
          .filter((item): item is GraphNode => Boolean(item))
        setSelected({ kind: 'node', node, connectedEdges, neighbors })
      })

      cy.on('tap', 'edge', (event) => {
        const edgeId = event.target.id()
        const edge = edgeByIdRef.current.get(edgeId)
        setSelected(edge ? { kind: 'edge', edge, source: nodeByIdRef.current.get(edge.source), target: nodeByIdRef.current.get(edge.target) } : null)
      })

      cy.on('tap', (event) => {
        if (event.target === cy) {
          setSelected(null)
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
    } catch (caught) {
      setInitError(`Cytoscape konnte nicht initialisiert werden: ${String(caught)}`)
    }
    return () => {
      cyRef.current?.destroy()
      cyRef.current = null
    }
  }, [])

  const nodeByIdRef = useLatest(nodeById)
  const edgeByIdRef = useLatest(useMemo(() => new Map(edges.map((edge) => [edge.id, edge])), [edges]))
  const connectedEdgesByNodeRef = useLatest(connectedEdgesByNode)
  const onOpenNodePathRef = useLatest(onOpenNodePath)

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) {
      return
    }
    try {
      cy.batch(() => {
        cy.elements().remove()
        cy.add(elements)
      })
      runLayout(cy, largeGraph)
    } catch (caught) {
      setInitError(`Graph konnte nicht gerendert werden: ${String(caught)}`)
    }
  }, [elements, largeGraph])

  const fitGraph = () => {
    cyRef.current?.fit(undefined, 36)
  }

  const resetView = () => {
    const cy = cyRef.current
    if (!cy) {
      return
    }
    cy.zoom(1)
    cy.center()
  }

  const rerunLayout = () => {
    const cy = cyRef.current
    if (!cy) {
      return
    }
    runLayout(cy, largeGraph)
  }

  return (
    <section className="graph-network-shell">
      <header className="graph-network-toolbar">
        <div>
          <h3>Interaktiver Graph</h3>
          <p>{nodes.length} Nodes | {edges.length} Edges</p>
        </div>
        <div className="graph-network-actions">
          <button className="icon-button compact muted" onClick={fitGraph} title="Fit">
            <LucideNamedIcon name="Maximize" size={14} />
          </button>
          <button className="icon-button compact muted" onClick={resetView} title="Ansicht zuruecksetzen">
            <LucideNamedIcon name="LocateFixed" size={14} />
          </button>
          <button className="icon-button compact muted" onClick={rerunLayout} title="Layout neu starten">
            <LucideNamedIcon name="RefreshCw" size={14} />
          </button>
        </div>
      </header>
      {largeGraph ? (
        <p className="graph-warning">
          Groesserer Graph sichtbar. Layout laeuft ohne Animation; Filter koennen die Ansicht fluessiger machen.
        </p>
      ) : null}
      {initError ? <p className="graph-error">{initError}</p> : null}
      <div className="graph-network-grid">
        <div className="graph-network-canvas-wrap">
          <div ref={hostRef} className="graph-network-canvas" />
          {hoverText ? <div className="graph-network-hover">{hoverText}</div> : null}
          {nodes.length === 0 ? <p className="graph-network-empty">Keine Knoten im aktuellen Filter.</p> : null}
        </div>
        <GraphSelectionPanel selected={selected} />
      </div>
    </section>
  )
}

function GraphSelectionPanel({ selected }: { selected: SelectedGraphItem }) {
  if (!selected) {
    return (
      <aside className="graph-selection-panel">
        <h3>Details</h3>
        <p className="empty-copy">Knoten oder Kante auswaehlen.</p>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="graph-selection-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function buildElements(nodes: GraphNode[], edges: GraphEdge[], searchText: string): ElementDefinition[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const query = searchText.trim().toLowerCase()
  const nodeElements = nodes.map<ElementDefinition>((node) => ({
    group: 'nodes',
    data: {
      id: node.id,
      label: node.label || node.id,
      type: node.type,
    },
    classes: [node.type, query && matchesNode(node, query) ? 'search-match' : ''].filter(Boolean).join(' '),
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
      classes: edge.type,
    }))
  return [...nodeElements, ...edgeElements]
}

function matchesNode(node: GraphNode, query: string): boolean {
  return [node.id, node.label, node.path, node.group, node.tag].some((value) => String(value ?? '').toLowerCase().includes(query))
}

function runLayout(cy: Core, largeGraph: boolean) {
  const layout = cy.layout({
    name: 'cose',
    animate: !largeGraph,
    animationDuration: 280,
    randomize: true,
    fit: true,
    padding: 42,
    nodeRepulsion: largeGraph ? 8500 : 11000,
    idealEdgeLength: largeGraph ? 90 : 115,
    edgeElasticity: 120,
    nestingFactor: 1.1,
    gravity: 1,
    numIter: largeGraph ? 900 : 1600,
  })
  layout.run()
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

const cytoscapeStyles: StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 10,
      color: '#dce3ee',
      'text-outline-color': '#1f252f',
      'text-outline-width': 2,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'background-color': '#4f8cff',
      'border-color': '#a7c3ff',
      'border-width': 1,
      width: 34,
      height: 34,
    },
  },
  {
    selector: 'node.task',
    style: {
      shape: 'round-rectangle',
      'background-color': '#d3a33a',
      'border-color': '#f4d27c',
      width: 40,
      height: 28,
    },
  },
  {
    selector: 'node.tag',
    style: {
      shape: 'diamond',
      'background-color': '#2fba7a',
      'border-color': '#9de4bf',
      width: 24,
      height: 24,
      'font-size': 9,
    },
  },
  {
    selector: 'node.search-match',
    style: {
      'border-width': 4,
      'border-color': '#ffffff',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 5,
      'border-color': '#ffffff',
      'overlay-color': '#ffffff',
      'overlay-opacity': 0.12,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'mapData(weight, 1, 8, 1, 5)',
      'line-color': '#728096',
      'target-arrow-color': '#728096',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      opacity: 0.72,
    },
  },
  {
    selector: 'edge.link',
    style: {
      'line-color': '#7aa2ff',
      'target-arrow-color': '#7aa2ff',
      opacity: 0.9,
    },
  },
  {
    selector: 'edge.tagUsage',
    style: {
      'line-color': '#45c58a',
      'target-arrow-color': '#45c58a',
      width: 'mapData(weight, 1, 8, 0.8, 3)',
      opacity: 0.62,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#ffffff',
      'target-arrow-color': '#ffffff',
      width: 6,
      opacity: 1,
    },
  },
]

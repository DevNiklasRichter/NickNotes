import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphIndex, GraphNode } from '../app/AppShared'
import { DEFAULT_GRAPH_FILTERS, filterGraph } from './graphModel'

const note = (id: string): GraphNode => ({ id, type: 'note', label: id, path: `${id}.md` })
const link = (source: string, target: string): GraphEdge => ({ id: `${source}->${target}`, source, target, type: 'link', weight: 5, reasons: [] })
const uses = (source: string, tag: string): GraphEdge => ({ id: `${source}#${tag}`, source, target: tag, type: 'tagUsage', weight: 1, reasons: [] })

// a - b - c - d chain; a and x share the tag "projekt"; y also uses it.
const index: GraphIndex = {
  version: 2, updated_at: '', source: {}, files: {}, diagnostics: [],
  nodes: [note('a'), note('b'), note('c'), note('d'), note('x'), note('y'), { id: 'tag:p/projekt', type: 'tag', label: 'projekt', group: 'p' }],
  edges: [link('a', 'b'), link('b', 'c'), link('c', 'd'), uses('a', 'tag:p/projekt'), uses('x', 'tag:p/projekt'), uses('y', 'tag:p/projekt')],
}
const ids = (result: { nodes: GraphNode[] }) => result.nodes.map(node => node.id).sort()

describe('graph focus', () => {
  it('shows direct connections or two rings', () => {
    expect(ids(filterGraph(index, 'focus', { ...DEFAULT_GRAPH_FILTERS, focusDepth: 1 }, 'b'))).toEqual(['a', 'b', 'c'])
    // From b: a and c, then a's tag and d; the outer tag is not expanded any further.
    expect(ids(filterGraph(index, 'focus', { ...DEFAULT_GRAPH_FILTERS, focusDepth: 2 }, 'b'))).toEqual(['a', 'b', 'c', 'd', 'tag:p/projekt'])
    // Centred on a, its own tag leads to the notes sharing it.
    expect(ids(filterGraph(index, 'focus', { ...DEFAULT_GRAPH_FILTERS, focusDepth: 2 }, 'a'))).toEqual(['a', 'b', 'c', 'tag:p/projekt', 'x', 'y'])
  })

  it('keeps only files using the chosen tag', () => {
    expect(ids(filterGraph(index, 'link', { ...DEFAULT_GRAPH_FILTERS, tag: 'tag:p/projekt' }))).toEqual(['a', 'tag:p/projekt', 'x', 'y'])
  })
})

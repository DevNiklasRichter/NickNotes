import type {
  ExplorerNode,
  ExplorerOptions,
  ExplorerSourceFile,
  ExplorerSourceGroup,
  ExplorerTreeBuildResult,
  ExplorerVisibleNode,
} from './types'

type BuildTreeInput = {
  groups: ExplorerSourceGroup[]
  files: ExplorerSourceFile[]
  vaultPath: string
  options: ExplorerOptions
  expandedNodes: Record<string, boolean>
  selectedNodeId: string | null
  activeFilePath: string
  filterQuery: string
  dirtyFilePaths?: Set<string>
}

type MutableExplorerNode = ExplorerNode & {
  children: MutableExplorerNode[]
  updatedAtMs: number
}

const PROTECTED_ROOTS = new Set([
  '01_daily',
  '02_tags',
  '03_tasks',
  'daily',
  'tags',
  'tasks',
])

function toRootToken(groupKey: string): string {
  const clean = normalizeGroupKey(groupKey)
  const root = clean.split('/')[0] || ''
  return root.toLowerCase().replace(/^\d+_/, '')
}

function normalizeGroupKey(value: string): string {
  return value.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
}

function stripGroupPrefix(value: string): string {
  if (value.length > 3 && /^\d{2}_/.test(value)) {
    return value.slice(3)
  }
  return value
}

function toFolderLabel(groupKey: string): string {
  const cleanKey = normalizeGroupKey(groupKey)
  const segment = cleanKey.includes('/') ? cleanKey.slice(cleanKey.lastIndexOf('/') + 1) : cleanKey
  const base = stripGroupPrefix(segment)
  const clean = base.replace(/[_-]/g, ' ').trim()
  return clean || segment || 'Ordner'
}

function toNodeId(kind: 'file' | 'folder', path: string): string {
  return `${kind}:${path}`
}

function toTimestampMs(value: string | undefined): number {
  if (!value) {
    return 0
  }
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function toParentGroupKey(groupKey: string): string {
  const clean = normalizeGroupKey(groupKey)
  if (!clean.includes('/')) {
    return ''
  }
  return clean.slice(0, clean.lastIndexOf('/'))
}

function toRelativePath(path: string, vaultPath: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedVault = vaultPath.replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalizedVault) {
    return normalizedPath
  }
  const prefix = `${normalizedVault}/`
  if (normalizedPath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return normalizedPath.slice(prefix.length)
  }
  return normalizedPath
}

function isHiddenEntry(name: string): boolean {
  return name.trim().startsWith('.')
}

function toFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return ''
  }
  return name.slice(dotIndex + 1).toLowerCase()
}

function isMarkdownFile(name: string): boolean {
  return toFileExtension(name) === 'md'
}

function isDefaultExpanded(folderPath: string): boolean {
  const clean = normalizeGroupKey(folderPath)
  if (!clean) {
    return false
  }
  return false
}

function compareNodes(left: MutableExplorerNode, right: MutableExplorerNode, options: ExplorerOptions): number {
  if (left.type !== right.type) {
    if (options.foldersFirst) {
      return left.type === 'folder' ? -1 : 1
    }
    return left.type === 'file' ? -1 : 1
  }

  if (options.sortMode === 'modified') {
    if (left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs
    }
  }

  if (options.sortMode === 'type') {
    const leftType = left.type === 'file' ? toFileExtension(left.name) : 'folder'
    const rightType = right.type === 'file' ? toFileExtension(right.name) : 'folder'
    const typeCompare = leftType.localeCompare(rightType, 'de')
    if (typeCompare !== 0) {
      return typeCompare
    }
  }

  return left.name.localeCompare(right.name, 'de')
}

function computeFolderTimestamps(nodes: MutableExplorerNode[]): number {
  let maxTimestamp = 0
  for (const node of nodes) {
    if (node.type === 'folder') {
      node.updatedAtMs = computeFolderTimestamps(node.children)
    }
    if (node.updatedAtMs > maxTimestamp) {
      maxTimestamp = node.updatedAtMs
    }
  }
  return maxTimestamp
}

function sortTree(nodes: MutableExplorerNode[], options: ExplorerOptions): void {
  nodes.sort((left, right) => compareNodes(left, right, options))
  for (const node of nodes) {
    if (node.type === 'folder' && node.children.length > 0) {
      sortTree(node.children, options)
    }
  }
}

function matchesQuery(node: MutableExplorerNode, query: string): boolean {
  if (!query) {
    return true
  }
  const nodeName = node.name.toLowerCase()
  if (nodeName.includes(query)) {
    return true
  }
  if (node.type === 'file') {
    return nodeName.replace(/\.md$/i, '').includes(query)
  }
  return false
}

function cloneNode(node: MutableExplorerNode): MutableExplorerNode {
  return {
    ...node,
    children: node.children.map((child) => cloneNode(child as MutableExplorerNode)),
  }
}

function filterTree(nodes: MutableExplorerNode[], options: ExplorerOptions, query: string): MutableExplorerNode[] {
  const filtered: MutableExplorerNode[] = []

  for (const sourceNode of nodes) {
    if (!options.showHiddenFiles && sourceNode.hidden) {
      continue
    }

    const node = cloneNode(sourceNode)
    node.children = filterTree(node.children, options, query)
    const selfMatches = matchesQuery(node, query)
    const hasChildren = node.children.length > 0

    if (!query || selfMatches || hasChildren) {
      filtered.push(node)
    }
  }

  return filtered
}

function flattenVisible(nodes: MutableExplorerNode[], depth: number, output: ExplorerVisibleNode[]): void {
  for (const node of nodes) {
    output.push({ node, depth })
    if (node.type === 'folder' && node.expanded) {
      flattenVisible(node.children, depth + 1, output)
    }
  }
}

function applySelection(nodes: MutableExplorerNode[], selectedNodeId: string | null): void {
  for (const node of nodes) {
    node.selected = node.id === selectedNodeId
    if (node.children.length > 0) {
      applySelection(node.children, selectedNodeId)
    }
  }
}

export function buildExplorerTree({
  groups,
  files,
  vaultPath,
  options,
  expandedNodes,
  selectedNodeId,
  activeFilePath,
  filterQuery,
  dirtyFilePaths,
}: BuildTreeInput): ExplorerTreeBuildResult {
  const normalizedGroups = [...groups]
    .map((group) => ({ ...group, key: normalizeGroupKey(group.key) }))
    .sort((left, right) => left.key.length - right.key.length)

  const rootNodes: MutableExplorerNode[] = []
  const folderByKey = new Map<string, MutableExplorerNode>()
  const fileNodeIdByPath = new Map<string, string>()

  const ensureFolder = (groupKey: string, group?: ExplorerSourceGroup): MutableExplorerNode => {
    const cleanKey = normalizeGroupKey(groupKey)
    const existing = folderByKey.get(cleanKey)
    if (existing) {
      if (group) {
        existing.favorite = group.favorite
        existing.canCreateNotes = group.canCreateNotes
        existing.canCreateGroups = group.canCreateGroups
        existing.canDelete = group.canDelete
        existing.path = cleanKey
        existing.name = group.label || existing.name
      }
      return existing
    }

    const parentKey = toParentGroupKey(cleanKey)
    const parentNode = parentKey ? ensureFolder(parentKey) : null
    const node: MutableExplorerNode = {
      id: toNodeId('folder', cleanKey),
      name: group?.label || toFolderLabel(cleanKey),
      path: cleanKey,
      type: 'folder',
      children: [],
      expanded: expandedNodes[toNodeId('folder', cleanKey)] ?? isDefaultExpanded(cleanKey),
      selected: false,
      hidden: isHiddenEntry(cleanKey.split('/').pop() || cleanKey),
      updatedAt: undefined,
      updatedAtMs: 0,
      favorite: group?.favorite ?? false,
      canCreateNotes: group?.canCreateNotes ?? !['tags', 'tasks', 'system'].includes(toRootToken(cleanKey)),
      canCreateGroups: group?.canCreateGroups ?? !['tags', 'tasks', 'system'].includes(toRootToken(cleanKey)),
      canDelete: group?.canDelete ?? !PROTECTED_ROOTS.has(cleanKey),
      parentId: parentNode?.id ?? null,
    }

    folderByKey.set(cleanKey, node)
    if (parentNode) {
      parentNode.children.push(node)
    } else {
      rootNodes.push(node)
    }

    return node
  }

  for (const group of normalizedGroups) {
    if (!group.key || toRootToken(group.key) === 'system') {
      continue
    }
    ensureFolder(group.key, group)
  }

  for (const file of files) {
    const relativePath = toRelativePath(file.path, vaultPath)
    if (!relativePath || toRootToken(relativePath) === 'system') {
      continue
    }

    const fileName = relativePath.includes('/') ? relativePath.slice(relativePath.lastIndexOf('/') + 1) : relativePath
    const parentKey = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
    const parentNode = parentKey ? ensureFolder(parentKey) : null

    const nodeId = toNodeId('file', file.path)
    fileNodeIdByPath.set(file.path, nodeId)

    const node: MutableExplorerNode = {
      id: nodeId,
      name: fileName,
      path: file.path,
      type: 'file',
      children: [],
      expanded: false,
      selected: false,
      hidden: isHiddenEntry(fileName) || !isMarkdownFile(fileName),
      updatedAt: file.updated_at,
      updatedAtMs: toTimestampMs(file.updated_at),
      modified: dirtyFilePaths?.has(file.path) ?? false,
      parentId: parentNode?.id ?? null,
    }

    if (parentNode) {
      parentNode.children.push(node)
    } else {
      rootNodes.push(node)
    }
  }

  computeFolderTimestamps(rootNodes)
  sortTree(rootNodes, options)

  const filteredRoots = filterTree(rootNodes, options, filterQuery.trim().toLowerCase())

  const selectedFromPath = fileNodeIdByPath.get(activeFilePath) ?? null
  const nodeById = new Map<string, ExplorerNode>()
  const parentById = new Map<string, string | null>()

  const collectMaps = (nodesToCollect: MutableExplorerNode[]) => {
    for (const node of nodesToCollect) {
      nodeById.set(node.id, node)
      parentById.set(node.id, node.parentId)
      if (node.children.length > 0) {
        collectMaps(node.children)
      }
    }
  }

  collectMaps(filteredRoots)

  let effectiveSelectedNodeId = selectedNodeId
  if (!effectiveSelectedNodeId || !nodeById.has(effectiveSelectedNodeId)) {
    effectiveSelectedNodeId = selectedFromPath && nodeById.has(selectedFromPath) ? selectedFromPath : null
  }

  const visibleNodes: ExplorerVisibleNode[] = []
  flattenVisible(filteredRoots, 0, visibleNodes)

  if ((!effectiveSelectedNodeId || !nodeById.has(effectiveSelectedNodeId)) && visibleNodes.length > 0) {
    effectiveSelectedNodeId = visibleNodes[0].node.id
  }

  applySelection(filteredRoots, effectiveSelectedNodeId)

  return {
    rootNodes: filteredRoots,
    visibleNodes,
    nodeById,
    parentById,
    fileNodeIdByPath,
  }
}

export function getParentFolderKey(node: ExplorerNode, parentById: Map<string, string | null>, nodeById: Map<string, ExplorerNode>): string {
  if (node.type === 'folder') {
    return normalizeGroupKey(node.path)
  }

  const parentId = parentById.get(node.id)
  if (!parentId) {
    return ''
  }
  const parentNode = nodeById.get(parentId)
  if (!parentNode || parentNode.type !== 'folder') {
    return ''
  }
  return normalizeGroupKey(parentNode.path)
}

export { normalizeGroupKey, toFileExtension, toRelativePath }

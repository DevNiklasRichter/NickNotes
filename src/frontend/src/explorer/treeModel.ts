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
  folderOrder?: Record<string, string[]>
  expandedNodes: Record<string, boolean>
  selectedNodeId: string | null
  activeFilePath: string
  filterQuery: string
  contentMatchFilePathKeys?: Set<string>
  dirtyFilePaths?: Set<string>
}

type MutableExplorerNode = ExplorerNode & {
  children: MutableExplorerNode[]
  updatedAtMs: number
  noteCount: number
  normalizedKey?: string
  parentKey: string
}

const PROTECTED_ROOTS = new Set([
  '01_daily',
  '02_tags',
  '03_tasks',
  'daily',
  'tags',
  'tasks',
])
const FIXED_ROOT_ORDER: string[] = ['daily', 'tags', 'tasks']
const FIXED_ROOT_RANK = new Map(FIXED_ROOT_ORDER.map((token, index) => [token, index]))
const FIXED_SCOPE_ALPHA = new Set(['tags', 'tasks'])

function toDateSortKey(name: string): number {
  const match = String(name || '').match(/(\d{4}-\d{2}-\d{2})/)
  const iso = match?.[1] ?? ''
  if (!iso) {
    return 0
  }
  const ms = new Date(`${iso}T00:00:00`).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function toRootToken(groupKey: string): string {
  const clean = normalizeGroupKey(groupKey)
  const root = clean.split('/')[0] || ''
  return root.toLowerCase().replace(/^\d+_/, '')
}

function normalizeGroupKey(value: string): string {
  return value.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
}

function normalizeFilePathKey(path: string): string {
  return path.replace(/\\/g, '/').trim().replace(/\/+$/g, '').toLowerCase()
}

function toNodeGroupKey(node: MutableExplorerNode): string {
  if (node.type !== 'folder') {
    return ''
  }
  return normalizeGroupKey(node.normalizedKey || node.path)
}

function toNodeRootScope(node: MutableExplorerNode): string {
  if (node.type === 'folder') {
    const folderKey = toNodeGroupKey(node)
    if (folderKey) {
      return toRootToken(folderKey)
    }
  }
  if (node.parentKey) {
    return toRootToken(node.parentKey)
  }
  return ''
}

function toFixedRootRank(groupKey: string): number {
  const clean = normalizeGroupKey(groupKey)
  if (!clean || clean.includes('/')) {
    return Number.POSITIVE_INFINITY
  }
  const rank = FIXED_ROOT_RANK.get(toRootToken(clean))
  return rank === undefined ? Number.POSITIVE_INFINITY : rank
}

function toFolderOrderIndex(
  parentKey: string,
  folderKey: string,
  folderOrder: Record<string, string[]>
): number {
  const cleanParent = normalizeGroupKey(parentKey)
  const cleanFolder = normalizeGroupKey(folderKey)
  const ordered = folderOrder[cleanParent] ?? []
  const index = ordered.findIndex((value) => normalizeGroupKey(value) === cleanFolder)
  return index >= 0 ? index : Number.POSITIVE_INFINITY
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

function compareNodes(
  left: MutableExplorerNode,
  right: MutableExplorerNode,
  options: ExplorerOptions,
  folderOrder: Record<string, string[]>
): number {
  const siblingScope = left.parentKey ? toRootToken(left.parentKey) : ''
  const hasFixedScopeSorting = siblingScope === 'daily' || siblingScope === 'tags' || siblingScope === 'tasks'

  if (left.type === 'folder' && right.type === 'folder' && left.parentKey === right.parentKey) {
    const leftKey = toNodeGroupKey(left)
    const rightKey = toNodeGroupKey(right)
    if (left.parentKey === '') {
      const leftRank = toFixedRootRank(leftKey)
      const rightRank = toFixedRootRank(rightKey)
      if (leftRank !== rightRank) {
        return leftRank - rightRank
      }
    }

    if (!hasFixedScopeSorting) {
      const leftPinned = Boolean(left.favorite)
      const rightPinned = Boolean(right.favorite)
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1
      }

      if (options.sortMode === 'manual') {
        const leftIndex = toFolderOrderIndex(left.parentKey, leftKey, folderOrder)
        const rightIndex = toFolderOrderIndex(right.parentKey, rightKey, folderOrder)
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex
        }
      }
    }
  }

  const leftScope = toNodeRootScope(left)
  const rightScope = toNodeRootScope(right)
  if (leftScope && leftScope === rightScope) {
    if (FIXED_SCOPE_ALPHA.has(leftScope)) {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1
      }
      return left.name.localeCompare(right.name, 'de')
    }
    if (leftScope === 'daily') {
      const leftDate = toDateSortKey(left.name)
      const rightDate = toDateSortKey(right.name)
      if (leftDate !== rightDate) {
        return rightDate - leftDate
      }
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1
      }
      return left.name.localeCompare(right.name, 'de')
    }
  }

  if (left.type !== right.type) {
    if (options.foldersFirst) {
      return left.type === 'folder' ? -1 : 1
    }
    return left.type === 'file' ? -1 : 1
  }

  if (options.sortMode === 'noteCount' && left.type === 'folder' && right.type === 'folder') {
    if (left.noteCount !== right.noteCount) {
      return options.sortDirection === 'asc' ? left.noteCount - right.noteCount : right.noteCount - left.noteCount
    }
  }

  if (options.sortMode === 'modified') {
    if (left.updatedAtMs !== right.updatedAtMs) {
      return options.sortDirection === 'asc' ? left.updatedAtMs - right.updatedAtMs : right.updatedAtMs - left.updatedAtMs
    }
  }

  const nameCompare = left.name.localeCompare(right.name, 'de')
  return options.sortDirection === 'asc' ? nameCompare : -nameCompare
}

function computeFolderAggregates(nodes: MutableExplorerNode[]): { maxTimestamp: number; totalNotes: number } {
  let maxTimestamp = 0
  let totalNotes = 0
  for (const node of nodes) {
    if (node.type === 'file') {
      node.noteCount = 1
      totalNotes += 1
    } else {
      const childStats = computeFolderAggregates(node.children)
      node.updatedAtMs = childStats.maxTimestamp
      node.noteCount = childStats.totalNotes
      totalNotes += childStats.totalNotes
    }
    if (node.updatedAtMs > maxTimestamp) {
      maxTimestamp = node.updatedAtMs
    }
  }
  return { maxTimestamp, totalNotes }
}

function sortTree(nodes: MutableExplorerNode[], options: ExplorerOptions, folderOrder: Record<string, string[]>): void {
  nodes.sort((left, right) => compareNodes(left, right, options, folderOrder))
  for (const node of nodes) {
    if (node.type === 'folder' && node.children.length > 0) {
      sortTree(node.children, options, folderOrder)
    }
  }
}

function matchesQuery(node: MutableExplorerNode, query: string, contentMatchFilePathKeys: Set<string>): boolean {
  if (!query) {
    return true
  }
  const nodeName = node.name.toLowerCase()
  if (nodeName.includes(query)) {
    return true
  }
  if (node.type === 'file') {
    if (nodeName.replace(/\.md$/i, '').includes(query)) {
      return true
    }
    const contentPath = node.linkTargetPath || node.path
    return contentMatchFilePathKeys.has(normalizeFilePathKey(contentPath))
  }
  return false
}

function cloneNode(node: MutableExplorerNode): MutableExplorerNode {
  return {
    ...node,
    children: node.children.map((child) => cloneNode(child as MutableExplorerNode)),
  }
}

function filterTree(
  nodes: MutableExplorerNode[],
  options: ExplorerOptions,
  query: string,
  contentMatchFilePathKeys: Set<string>
): MutableExplorerNode[] {
  const filtered: MutableExplorerNode[] = []

  for (const sourceNode of nodes) {
    if (!options.showHiddenFiles && sourceNode.hidden) {
      continue
    }

    const node = cloneNode(sourceNode)
    node.children = filterTree(node.children, options, query, contentMatchFilePathKeys)
    const selfMatches = matchesQuery(node, query, contentMatchFilePathKeys)
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
  folderOrder = {},
  expandedNodes,
  selectedNodeId,
  activeFilePath,
  filterQuery,
  contentMatchFilePathKeys,
  dirtyFilePaths,
}: BuildTreeInput): ExplorerTreeBuildResult {
  void activeFilePath
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
      canCreateNotes: group?.canCreateNotes ?? !['daily', 'tags', 'tasks', 'system'].includes(toRootToken(cleanKey)),
      canCreateGroups: group?.canCreateGroups ?? !['daily', 'tags', 'tasks', 'system'].includes(toRootToken(cleanKey)),
      canDelete: group?.canDelete ?? !PROTECTED_ROOTS.has(cleanKey),
      parentId: parentNode?.id ?? null,
      parentKey,
      normalizedKey: cleanKey,
      noteCount: 0,
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
    const displayName = typeof file.display_name === 'string' ? file.display_name.trim() : ''
    const effectiveName = displayName || fileName
    const linkTargetPath = typeof file.link_target_path === 'string' ? file.link_target_path.trim() : ''
    const isVirtualLink = Boolean(file.is_virtual_link || linkTargetPath)
    const parentKey = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : ''
    const parentNode = parentKey ? ensureFolder(parentKey) : null

    const nodeId = toNodeId('file', file.path)
    if (!isVirtualLink) {
      fileNodeIdByPath.set(file.path, nodeId)
    }

    const node: MutableExplorerNode = {
      id: nodeId,
      name: effectiveName,
      path: file.path,
      type: 'file',
      noteType: file.note_type,
      linkTargetPath: linkTargetPath || undefined,
      isVirtualLink,
      children: [],
      expanded: false,
      selected: false,
      hidden: isHiddenEntry(effectiveName) || (!isMarkdownFile(effectiveName) && !isMarkdownFile(fileName)),
      updatedAt: file.updated_at,
      updatedAtMs: toTimestampMs(file.updated_at),
      noteCount: 1,
      modified: dirtyFilePaths?.has(file.path) ?? false,
      parentId: parentNode?.id ?? null,
      parentKey,
    }

    if (parentNode) {
      parentNode.children.push(node)
    } else {
      rootNodes.push(node)
    }
  }

  computeFolderAggregates(rootNodes)
  sortTree(rootNodes, options, folderOrder)

  const filteredRoots = filterTree(
    rootNodes,
    options,
    filterQuery.trim().toLowerCase(),
    contentMatchFilePathKeys ?? new Set<string>()
  )

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
  if (effectiveSelectedNodeId && !nodeById.has(effectiveSelectedNodeId)) {
    effectiveSelectedNodeId = null
  }

  const visibleNodes: ExplorerVisibleNode[] = []
  flattenVisible(filteredRoots, 0, visibleNodes)

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

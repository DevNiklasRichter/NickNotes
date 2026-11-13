import {ContextMenu, ContextMenuItem} from '../ui/ContextMenu'
import {MenuButton} from '../ui/MenuButton'
import {contextMenuAnchor, isContextMenuKey} from '../ui/contextMenuAnchor'
import type {ContextMenuAnchor} from '../ui/contextMenuAnchor'
import {useSyncedDraft} from '../editor/useSyncedDraft'
import {commandTitle} from '../app/commands'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type {
  ExplorerNode,
  ExplorerIconOverrides,
  ExplorerOptions,
  ExplorerSourceFile,
  ExplorerSourceGroup,
  ExplorerViewState,
} from './types'
import { buildExplorerTree, getParentFolderKey, normalizeGroupKey, toFileExtension, toRelativePath } from './treeModel'
import { LUCIDE_ICON_NAMES, LucideNamedIcon, isLucideIconName } from '../icons/lucideCatalog'
import './ExplorerSidebar.css'

type ExplorerSidebarProps = {
  vaultLoaded: boolean
  vaultPath: string
  groups: ExplorerSourceGroup[]
  files: ExplorerSourceFile[]
  tasks: Array<{
    id: string
    title: string
    status: string
    path: string | null
    updated_at?: string
  }>
  activeFilePath: string
  dirtyFilePaths: Set<string>
  width: number
  onWidthChange: (nextWidth: number) => void
  onOpenFile: (path: string, title?: string) => Promise<void>
  onPreviewFile: (path: string, title?: string) => Promise<void>
  onOpenOrCreateTodayDaily: () => Promise<void>
  onCreateFile: (parentFolderKey: string, title: string) => Promise<void>
  onCreateTask: (parentFolderKey: string, title: string) => Promise<void>
  onCreateFolder: (parentFolderKey: string, name: string) => Promise<void>
  onRenameFile: (path: string, newName: string) => Promise<void>
  onRenameFolder: (groupKey: string, newName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  onDeleteFolder: (groupKey: string) => Promise<void>
  onMoveFile: (path: string, targetGroupKey: string) => Promise<void>
  onMoveFiles: (paths: string[], targetGroupKey: string) => Promise<void>
  onMoveFolder: (groupKey: string, targetParentKey: string) => Promise<void>
  onToggleFavoriteFolder: (groupKey: string) => Promise<void>
  options: ExplorerOptions
  contentMatchFilePathKeys?: Set<string>
  onFilterQueryChange?: (query: string) => void
  onOptionsChange?: (next: ExplorerOptions) => void
  onRefresh: () => void
  revealFilePath?: string
  revealRequestId?: number
  viewStateSeed?: ExplorerViewState | null
  viewStateSeedId?: number
  onViewStateChange?: (next: ExplorerViewState) => void
}

type DropPosition = 'before' | 'inside' | 'after'
type DropIndicator = { nodeId: string; position: DropPosition } | null
type ContextMenu =
  | (ContextMenuAnchor & { target: 'tree' })
  | (ContextMenuAnchor & { target: 'node'; nodeId: string })
  | null
type FolderFileCount = { direct: number; total: number }
type NodeIconOverrides = ExplorerIconOverrides
type IconPickerTarget =
  | {
      nodeType: 'folder'
      path: string
      label: string
    }
  | {
      nodeType: 'file'
      path: string
      label: string
    }
type IconPickerState = IconPickerTarget | null
type ExplorerActionDialogState =
  | {
      kind: 'input'
      title: string
      placeholder: string
      confirmLabel: string
      value: string
      validate?: (value: string) => string | null
      danger?: boolean
      resolve: (result: { confirmed: boolean; value: string }) => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel: string
      danger?: boolean
      resolve: (result: { confirmed: boolean }) => void
    }

const ROOT_TOKENS = ['daily', 'tags', 'tasks'] as const
const ROOT_TOKEN_SET = new Set<string>(ROOT_TOKENS)
const MIN_WIDTH = 220
const MAX_WIDTH = 520
const EXPLORER_MULTI_DRAG_MIME = 'application/x-nicknotes-explorer-files'

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeRootToken(groupKey: string): string {
  const root = normalizeGroupKey(groupKey).split('/')[0] || ''
  return root.toLowerCase().replace(/^\d+_/, '')
}

function isPinnedRoot(groupKey: string): boolean {
  const clean = normalizeGroupKey(groupKey)
  return !clean.includes('/') && ROOT_TOKEN_SET.has(normalizeRootToken(clean))
}

function isCreateLockedFolderKey(folderKey: string): boolean {
  const clean = normalizeGroupKey(folderKey)
  if (!clean) {
    return false
  }
  return ROOT_TOKEN_SET.has(normalizeRootToken(clean))
}

function createLockedReason(folderKey: string): string {
  if (!isCreateLockedFolderKey(folderKey)) {
    return ''
  }
  return 'In daily, tags und tasks koennen keine neuen Ordner, Notizen oder Tasks angelegt werden.'
}

function isInputEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName.toLowerCase()
  return ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable
}

function hasSelectionModifier(event: Pick<ReactMouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey'>): boolean
function hasSelectionModifier(event: Pick<ReactKeyboardEvent<HTMLDivElement>, 'ctrlKey' | 'metaKey'>): boolean
function hasSelectionModifier(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey
}

function collectVisibleFileNodeIdsInOrder(nodes: Array<{ node: ExplorerNode }>): string[] {
  const ids: string[] = []
  for (const entry of nodes) {
    if (entry.node.type === 'file') {
      ids.push(entry.node.id)
    }
  }
  return ids
}

function collectFileRangeSelection(
  visibleNodes: Array<{ node: ExplorerNode }>,
  fromNodeId: string | null,
  toNodeId: string
): string[] {
  const startIndex = fromNodeId ? visibleNodes.findIndex((entry) => entry.node.id === fromNodeId) : -1
  const endIndex = visibleNodes.findIndex((entry) => entry.node.id === toNodeId)
  if (endIndex < 0) {
    return []
  }
  if (startIndex < 0) {
    const targetNode = visibleNodes[endIndex]?.node ?? null
    return targetNode?.type === 'file' ? [toNodeId] : []
  }

  const lower = Math.min(startIndex, endIndex)
  const upper = Math.max(startIndex, endIndex)
  const ids: string[] = []
  for (let index = lower; index <= upper; index += 1) {
    const node = visibleNodes[index]?.node
    if (node?.type === 'file') {
      ids.push(node.id)
    }
  }
  return ids
}

function toSafeExpanded(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const next: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) {
      continue
    }
    next[key] = Boolean(raw)
  }
  return next
}

function toSafeOrder(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const next: Record<string, string[]> = {}
  for (const [parent, rawChildren] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawChildren)) {
      continue
    }
    const key = normalizeGroupKey(parent)
    const children = Array.from(new Set(rawChildren.map((item) => normalizeGroupKey(String(item ?? ''))).filter(Boolean)))
    if (children.length > 0) {
      next[key] = children
    }
  }
  return next
}

function sanitizeOrder(order: Record<string, string[]>, validFolders: Set<string>, fixedRoots: string[]): Record<string, string[]> {
  const fixedSet = new Set(fixedRoots)
  const next: Record<string, string[]> = {}
  for (const [parent, children] of Object.entries(order)) {
    const cleanParent = normalizeGroupKey(parent)
    const deduped = Array.from(new Set(children.filter((item) => validFolders.has(normalizeGroupKey(item)))))
    if (cleanParent === '') {
      next[''] = [...fixedRoots, ...deduped.filter((item) => !fixedSet.has(item))]
      continue
    }
    if (deduped.length > 0) {
      next[cleanParent] = deduped
    }
  }
  if (!next[''] && fixedRoots.length > 0) {
    next[''] = [...fixedRoots]
  }
  return next
}

function toDropPosition(event: ReactDragEvent<HTMLDivElement>, node: ExplorerNode): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
  if (node.type === 'file') {
    return ratio < 0.5 ? 'before' : 'after'
  }
  if (ratio < 0.25) {
    return 'before'
  }
  if (ratio > 0.75) {
    return 'after'
  }
  return 'inside'
}

function folderKey(node: ExplorerNode | null | undefined): string {
  return node && node.type === 'folder' ? normalizeGroupKey(node.path) : ''
}

function normalizeFilePathKey(path: string): string {
  return path.replace(/\\/g, '/').trim().toLowerCase()
}

function toTaskStatusToken(rawStatus: string): string {
  const clean = String(rawStatus || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || 'open'
}

function toSafeTaskToken(raw: string): string {
  const clean = normalizeLabel(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || 'task'
}

function toTaskLinkDisplayName(rawTitle: string, fallback: string): string {
  const cleanTitle = normalizeLabel(rawTitle).replace(/[\\/:*?"<>|]+/g, ' ').trim()
  const base = cleanTitle || fallback || 'Task'
  return /\.md$/i.test(base) ? base : `${base}.md`
}

function isReadonlyLinkFile(node: ExplorerNode): boolean {
  return node.type === 'file' && Boolean(node.isVirtualLink || node.linkTargetPath)
}

function resolveOpenPath(node: ExplorerNode): string {
  if (node.type !== 'file') {
    return node.path
  }
  return node.linkTargetPath || node.path
}

function slugifyForDuplicateCheck(raw: string): string {
  return normalizeLabel(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function toParentKey(value: string): string {
  const clean = normalizeGroupKey(value)
  if (!clean.includes('/')) {
    return ''
  }
  return clean.slice(0, clean.lastIndexOf('/'))
}

function toLeafKey(value: string): string {
  const clean = normalizeGroupKey(value)
  if (!clean.includes('/')) {
    return clean
  }
  return clean.slice(clean.lastIndexOf('/') + 1)
}

function toFileStem(name: string): string {
  return /\.md$/i.test(name) ? name.replace(/\.md$/i, '') : name
}

function toSafeIconOverrides(value: unknown): NodeIconOverrides {
  const empty: NodeIconOverrides = { folders: {}, files: {} }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return empty
  }

  const source = value as Record<string, unknown>
  const foldersRaw = source.folders
  const filesRaw = source.files
  const safeFolders: Record<string, string> = {}
  const safeFiles: Record<string, string> = {}

  if (typeof foldersRaw === 'object' && foldersRaw !== null && !Array.isArray(foldersRaw)) {
    for (const [rawPath, rawIcon] of Object.entries(foldersRaw as Record<string, unknown>)) {
      const path = normalizeGroupKey(rawPath)
      const iconName = typeof rawIcon === 'string' ? rawIcon.trim() : ''
      if (path && iconName && isLucideIconName(iconName)) {
        safeFolders[path] = iconName
      }
    }
  }

  if (typeof filesRaw === 'object' && filesRaw !== null && !Array.isArray(filesRaw)) {
    for (const [rawPath, rawIcon] of Object.entries(filesRaw as Record<string, unknown>)) {
      const path = normalizeFilePathKey(rawPath)
      const iconName = typeof rawIcon === 'string' ? rawIcon.trim() : ''
      if (path && iconName && isLucideIconName(iconName)) {
        safeFiles[path] = iconName
      }
    }
  }

  return { folders: safeFolders, files: safeFiles }
}

function pruneIconOverrides(overrides: NodeIconOverrides, validFolders: Set<string>, validFiles: Set<string>): NodeIconOverrides {
  const folders: Record<string, string> = {}
  const files: Record<string, string> = {}
  for (const [path, iconName] of Object.entries(overrides.folders)) {
    if (validFolders.has(path) && isLucideIconName(iconName)) {
      folders[path] = iconName
    }
  }
  for (const [path, iconName] of Object.entries(overrides.files)) {
    if (validFiles.has(path) && isLucideIconName(iconName)) {
      files[path] = iconName
    }
  }
  return { folders, files }
}

function defaultIconNameForNode(node: ExplorerNode): string {
  if (node.type === 'folder') {
    return 'Folder'
  }
  if (String(node.noteType ?? '').trim().toLowerCase() === 'task') {
    return 'CheckSquare'
  }
  return toFileExtension(node.name) === 'md' ? 'FileText' : 'File'
}

function rowName(node: ExplorerNode): string {
  if (node.type !== 'file') {
    return node.name
  }
  return /\.md$/i.test(node.name) ? node.name.replace(/\.md$/i, '') : node.name
}

export function ExplorerSidebar({
  vaultLoaded,
  vaultPath,
  groups,
  files,
  tasks,
  activeFilePath,
  dirtyFilePaths,
  width,
  onWidthChange,
  onOpenFile,
  onOpenOrCreateTodayDaily,
  onCreateFile,
  onCreateTask,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onMoveFile,
  onMoveFiles,
  onMoveFolder,
  onToggleFavoriteFolder,
  options,
  contentMatchFilePathKeys,
  onFilterQueryChange,
  onOptionsChange,
  onRefresh,
  revealFilePath,
  revealRequestId,
  viewStateSeed,
  viewStateSeedId,
  onViewStateChange,
}: ExplorerSidebarProps) {
  const seed = useMemo(() => ({
    expanded: toSafeExpanded(viewStateSeed?.expandedNodes),
    selected: typeof viewStateSeed?.selectedNodeId === 'string' ? viewStateSeed.selectedNodeId : null,
    query: typeof viewStateSeed?.filterQuery === 'string' ? viewStateSeed.filterQuery : '',
    order: toSafeOrder(viewStateSeed?.folderOrder),
    icons: toSafeIconOverrides(viewStateSeed?.iconOverrides),
  }), [viewStateSeed])
  const seedIdentity = String(viewStateSeedId ?? '')
  const treeRef = useRef<HTMLElement | null>(null)
  const [expandedNodes, setExpandedNodes] = useSyncedDraft(seedIdentity, seed.expanded)
  const [selectedNodeId, setSelectedNodeId] = useSyncedDraft<string | null>(seedIdentity, seed.selected)
  const [rawSelectedFileNodeIds, setSelectedFileNodeIds] = useState<Set<string>>(() => new Set())
  const [rawSelectionAnchorNodeId, setSelectionAnchorNodeId] = useState<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [draggingFileNodeIds, setDraggingFileNodeIds] = useState<Set<string>>(() => new Set())
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)
  const [filterQuery, setFilterQuery] = useSyncedDraft(seedIdentity, seed.query)
  const [rawFolderOrder, setFolderOrder] = useSyncedDraft(seedIdentity, seed.order)
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
  const [rawIconOverrides, setIconOverrides] = useSyncedDraft(seedIdentity, seed.icons)
  const [iconPicker, setIconPicker] = useState<IconPickerState>(null)
  const [iconSearchQuery, setIconSearchQuery] = useState('')
  const [actionDialog, setActionDialog] = useState<ExplorerActionDialogState | null>(null)
  const actionDialogRef = useRef<ExplorerActionDialogState | null>(null)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const onViewStateChangeRef = useRef(onViewStateChange)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const fixedRootKeys = useMemo(() => {
    const byToken = new Map<string, string>()
    for (const group of groups) {
      const cleanKey = normalizeGroupKey(group.key)
      if (!cleanKey || cleanKey.includes('/')) {
        continue
      }
      const token = normalizeRootToken(cleanKey)
      if (!ROOT_TOKEN_SET.has(token) || byToken.has(token)) {
        continue
      }
      byToken.set(token, cleanKey)
    }
    return ROOT_TOKENS.map((token) => byToken.get(token) ?? '').filter(Boolean)
  }, [groups])

  const folderOrder = useMemo(() => sanitizeOrder(rawFolderOrder, new Set(groups.map(group => normalizeGroupKey(group.key))), fixedRootKeys), [rawFolderOrder, groups, fixedRootKeys])
  const iconOverrides = useMemo(() => pruneIconOverrides(rawIconOverrides, new Set(groups.map(group => normalizeGroupKey(group.key))), new Set(files.map(file => normalizeFilePathKey(file.path)))), [rawIconOverrides, files, groups])

  const tasksRootKey = useMemo(() => {
    for (const group of groups) {
      const cleanKey = normalizeGroupKey(group.key)
      if (!cleanKey || cleanKey.includes('/')) {
        continue
      }
      if (normalizeRootToken(cleanKey) === 'tasks') {
        return cleanKey
      }
    }
    return 'tasks'
  }, [groups])

  const filesWithTaskLinks = useMemo(() => {
    if (!vaultLoaded || tasks.length === 0) {
      return files
    }

    const usedRelativePaths = new Set<string>()
    for (const file of files) {
      const relative = normalizeGroupKey(toRelativePath(file.path, vaultPath))
      if (relative) {
        usedRelativePaths.add(relative.toLowerCase())
      }
    }

    const seenTargetPaths = new Set<string>()
    const virtualTaskFiles: ExplorerSourceFile[] = []

    for (const task of tasks) {
      const targetPath = typeof task.path === 'string' ? task.path.trim() : ''
      if (!targetPath) {
        continue
      }
      const targetKey = normalizeFilePathKey(targetPath)
      if (!targetKey || seenTargetPaths.has(targetKey)) {
        continue
      }
      seenTargetPaths.add(targetKey)

      const statusToken = toTaskStatusToken(task.status)
      const targetRelativePath = normalizeGroupKey(toRelativePath(targetPath, vaultPath))
      const expectedStatusPrefix = `${tasksRootKey}/${statusToken}`.toLowerCase()
      if (
        targetRelativePath &&
        (targetRelativePath.toLowerCase() === expectedStatusPrefix || targetRelativePath.toLowerCase().startsWith(`${expectedStatusPrefix}/`))
      ) {
        continue
      }
      const baseToken = toSafeTaskToken(task.id || task.title || targetPath)
      let relativePath = `${tasksRootKey}/${statusToken}/${baseToken}.md`
      let suffix = 2
      while (usedRelativePaths.has(relativePath.toLowerCase())) {
        relativePath = `${tasksRootKey}/${statusToken}/${baseToken}_${suffix}.md`
        suffix += 1
      }
      usedRelativePaths.add(relativePath.toLowerCase())

      const fallbackTitle = targetPath.includes('/')
        ? targetPath.slice(targetPath.lastIndexOf('/') + 1).replace(/\.md$/i, '').trim()
        : targetPath.replace(/\.md$/i, '').trim()

      virtualTaskFiles.push({
        id: `task_link_${task.id || baseToken}_${virtualTaskFiles.length + 1}`,
        title: task.title || fallbackTitle || 'Task',
        note_type: 'task',
        updated_at: typeof task.updated_at === 'string' ? task.updated_at : '',
        path: relativePath,
        display_name: toTaskLinkDisplayName(task.title || '', fallbackTitle || 'Task'),
        link_target_path: targetPath,
        is_virtual_link: true,
      })
    }

    if (virtualTaskFiles.length === 0) {
      return files
    }
    return [...files, ...virtualTaskFiles]
  }, [files, tasks, tasksRootKey, vaultLoaded, vaultPath])

  useEffect(() => {
    actionDialogRef.current = actionDialog
  }, [actionDialog])

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange
  }, [onViewStateChange])

  useEffect(() => {
    const notify = onViewStateChangeRef.current
    if (!notify) {
      return
    }
    notify({
      expandedNodes,
      selectedNodeId,
      filterQuery,
      folderOrder,
      iconOverrides,
    })
  }, [expandedNodes, filterQuery, folderOrder, iconOverrides, selectedNodeId])

  useEffect(() => {
    onFilterQueryChange?.(filterQuery)
  }, [filterQuery, onFilterQueryChange])

  const tree = useMemo(
    () =>
      buildExplorerTree({
        groups,
        files: filesWithTaskLinks,
        vaultPath,
        options,
        folderOrder,
        expandedNodes,
        selectedNodeId,
        activeFilePath,
        filterQuery,
        contentMatchFilePathKeys,
        dirtyFilePaths,
      }),
    [
      activeFilePath,
      contentMatchFilePathKeys,
      dirtyFilePaths,
      expandedNodes,
      filesWithTaskLinks,
      filterQuery,
      folderOrder,
      groups,
      options,
      selectedNodeId,
      vaultPath,
    ]
  )

  const selectedFileNodeIds = useMemo(() => new Set([...rawSelectedFileNodeIds].filter(id => tree.nodeById.get(id)?.type === 'file')), [rawSelectedFileNodeIds, tree.nodeById])
  const selectionAnchorNodeId = rawSelectionAnchorNodeId && tree.nodeById.get(rawSelectionAnchorNodeId)?.type === 'file' ? rawSelectionAnchorNodeId : null

  const visibleFileNodeIds = useMemo(() => collectVisibleFileNodeIdsInOrder(tree.visibleNodes), [tree.visibleNodes])

  const clearFileSelection = useCallback(() => {
    setSelectedFileNodeIds((prev) => (prev.size === 0 ? prev : new Set()))
    setSelectionAnchorNodeId(null)
  }, [])

  const selectSingleFile = useCallback((nodeId: string) => {
    setSelectedFileNodeIds(() => new Set([nodeId]))
    setSelectionAnchorNodeId(nodeId)
  }, [])

  const toggleFileSelection = useCallback((nodeId: string) => {
    setSelectedFileNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
    setSelectionAnchorNodeId(nodeId)
  }, [])

  const extendSelectionToNode = useCallback(
    (targetNodeId: string, appendToExisting: boolean) => {
      const anchorNodeId = selectionAnchorNodeId ?? selectedNodeId ?? targetNodeId
      const rangeIds = collectFileRangeSelection(tree.visibleNodes, anchorNodeId, targetNodeId)
      if (rangeIds.length === 0) {
        return
      }
      setSelectedFileNodeIds((prev) => {
        const next = appendToExisting ? new Set(prev) : new Set<string>()
        for (const id of rangeIds) {
          next.add(id)
        }
        return next
      })
      if (!selectionAnchorNodeId) {
        setSelectionAnchorNodeId(anchorNodeId)
      }
    },
    [selectedNodeId, selectionAnchorNodeId, tree.visibleNodes]
  )

  const orderedDraggedFileNodeIds = useMemo(() => {
    if (draggingFileNodeIds.size === 0) {
      return []
    }
    const ids: string[] = []
    for (const nodeId of visibleFileNodeIds) {
      if (draggingFileNodeIds.has(nodeId)) {
        ids.push(nodeId)
      }
    }
    for (const nodeId of draggingFileNodeIds) {
      if (!ids.includes(nodeId)) {
        ids.push(nodeId)
      }
    }
    return ids
  }, [draggingFileNodeIds, visibleFileNodeIds])

  const folderFileCounts = useMemo(() => {
    const counts = new Map<string, FolderFileCount>()
    const walk = (node: ExplorerNode): number => {
      if (node.type === 'file') {
        return 1
      }
      let direct = 0
      let total = 0
      for (const child of node.children) {
        if (child.type === 'file') {
          direct += 1
          total += 1
        } else {
          total += walk(child)
        }
      }
      counts.set(node.id, { direct, total })
      return total
    }
    for (const root of tree.rootNodes) {
      walk(root)
    }
    return counts
  }, [tree.rootNodes])

  const dividerBeforeNodeId = useMemo(() => {
    let sawFixed = false
    for (const entry of tree.visibleNodes) {
      if (entry.depth !== 0 || entry.node.type !== 'folder') {
        continue
      }
      if (!isPinnedRoot(entry.node.path) && sawFixed) {
        return entry.node.id
      }
      if (isPinnedRoot(entry.node.path)) {
        sawFixed = true
      }
    }
    return null
  }, [tree.visibleNodes])

  const revealPathInTree = useCallback(
    (path: string): boolean => {
      if (!path) {
        return false
      }
      const activeId = tree.fileNodeIdByPath.get(path)
      if (!activeId) {
        return false
      }
      setSelectedNodeId(activeId)
      selectSingleFile(activeId)
      setExpandedNodes((prev) => {
        const next = { ...prev }
        let changed = false
        let cursor = tree.parentById.get(activeId) ?? null
        while (cursor) {
          if (next[cursor] !== true) {
            next[cursor] = true
            changed = true
          }
          cursor = tree.parentById.get(cursor) ?? null
        }
        return changed ? next : prev
      })
      return true
    },
    [selectSingleFile, tree.fileNodeIdByPath, tree.parentById, setExpandedNodes, setSelectedNodeId]
  )

  const [lastAutoRevealPath, setLastAutoRevealPath] = useState('')
  const [lastRevealRequest, setLastRevealRequest] = useState<number | null>(null)
  if (!activeFilePath && lastAutoRevealPath) {
    setLastAutoRevealPath('')
  } else if (activeFilePath && activeFilePath !== lastAutoRevealPath && tree.fileNodeIdByPath.has(activeFilePath)) {
    setLastAutoRevealPath(activeFilePath)
    revealPathInTree(activeFilePath)
  }
  if (typeof revealRequestId === 'number' && revealRequestId !== lastRevealRequest && revealFilePath && tree.fileNodeIdByPath.has(revealFilePath)) {
    setLastRevealRequest(revealRequestId)
    setLastAutoRevealPath(revealFilePath)
    revealPathInTree(revealFilePath)
  }

  const selectedNode = useMemo(() => tree.visibleNodes.find((entry) => entry.node.selected)?.node ?? null, [tree.visibleNodes])
  const selectedFolderKeyForCreate = useMemo(() => {
    if (!selectedNode) {
      return ''
    }
    return getParentFolderKey(selectedNode, tree.parentById, tree.nodeById)
  }, [selectedNode, tree.nodeById, tree.parentById])
  const selectedCreateLockReason = createLockedReason(selectedFolderKeyForCreate)
  const createActionsDisabledReason = !vaultLoaded
    ? 'Keine NoteBase geladen'
    : selectedCreateLockReason
  const createActionsDisabled = Boolean(createActionsDisabledReason)

  const resolveNodeIconName = useCallback(
    (node: ExplorerNode): string => {
      if (node.type === 'folder') {
        const key = normalizeGroupKey(node.path)
        return iconOverrides.folders[key] || defaultIconNameForNode(node)
      }
      const key = normalizeFilePathKey(node.path)
      return iconOverrides.files[key] || defaultIconNameForNode(node)
    },
    [iconOverrides.files, iconOverrides.folders]
  )

  const visibleIconNames = useMemo(() => {
    const query = iconSearchQuery.trim().toLowerCase()
    if (!query) {
      return LUCIDE_ICON_NAMES
    }
    return LUCIDE_ICON_NAMES.filter((name) => name.toLowerCase().includes(query))
  }, [iconSearchQuery])

  const resolveSelectedFolderKey = useCallback((): string => {
    if (!selectedNode) {
      return ''
    }
    return getParentFolderKey(selectedNode, tree.parentById, tree.nodeById)
  }, [selectedNode, tree.nodeById, tree.parentById])

  const autoScrollForDrag = useCallback((clientY: number) => {
    const box = treeRef.current?.getBoundingClientRect()
    if (!box || !treeRef.current) {
      return
    }
    if (clientY < box.top + 48) {
      treeRef.current.scrollTop -= 16
    } else if (clientY > box.bottom - 48) {
      treeRef.current.scrollTop += 16
    }
  }, [])

  const closeActionDialog = useCallback((confirmed: boolean) => {
    const current = actionDialogRef.current
    if (!current) {
      return
    }
    actionDialogRef.current = null
    setActionDialog(null)
    if (dialogReturnFocusRef.current?.isConnected) dialogReturnFocusRef.current.focus({preventScroll: true})
    if (current.kind === 'input') current.resolve({ confirmed, value: current.value })
    else current.resolve({ confirmed })
  }, [])

  const setSortMode = useCallback(
    (mode: ExplorerOptions['sortMode']) => {
      if (!onOptionsChange) {
        return
      }
      onOptionsChange({ ...options, sortMode: mode })
    },
    [onOptionsChange, options]
  )

  const setSortDirection = useCallback(
    (direction: ExplorerOptions['sortDirection']) => {
      if (!onOptionsChange) {
        return
      }
      onOptionsChange({ ...options, sortDirection: direction })
    },
    [onOptionsChange, options]
  )

  const askInputDialog = useCallback(
    (
      title: string,
      placeholder: string,
      initialValue: string,
      confirmLabel: string,
      danger = false,
      validate?: (value: string) => string | null
    ): Promise<string | null> =>
      new Promise((resolve) => {
        dialogReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setActionDialog({
          kind: 'input',
          title,
          placeholder,
          confirmLabel,
          value: initialValue,
          validate,
          danger,
          resolve: (result) => {
            resolve(result.confirmed ? normalizeLabel(result.value) : null)
          },
        })
      }),
    []
  )

  const askConfirmDialog = useCallback(
    (title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> =>
      new Promise((resolve) => {
        dialogReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setActionDialog({
          kind: 'confirm',
          title,
          message,
          confirmLabel,
          danger,
          resolve: (result) => {
            resolve(result.confirmed)
          },
        })
      }),
    []
  )

  const hasFolderNameCollision = useCallback(
    (parentFolderKey: string, proposedName: string): boolean => {
      const cleanParent = normalizeGroupKey(parentFolderKey)
      const proposedSlug = slugifyForDuplicateCheck(proposedName)
      if (!proposedSlug) {
        return false
      }
      return groups.some((group) => {
        const key = normalizeGroupKey(group.key)
        if (toParentKey(key) !== cleanParent) {
          return false
        }
        return slugifyForDuplicateCheck(toLeafKey(key)) === proposedSlug
      })
    },
    [groups]
  )

  const hasFileNameCollision = useCallback(
    (parentFolderKey: string, proposedName: string): boolean => {
      const cleanParent = normalizeGroupKey(parentFolderKey)
      const proposedSlug = slugifyForDuplicateCheck(proposedName)
      if (!proposedSlug) {
        return false
      }
      return files.some((file) => {
        const relativePath = normalizeGroupKey(toRelativePath(file.path, vaultPath))
        const fileParent = toParentKey(relativePath)
        if (fileParent !== cleanParent) {
          return false
        }
        const fileLeaf = toLeafKey(relativePath)
        return slugifyForDuplicateCheck(toFileStem(fileLeaf)) === proposedSlug
      })
    },
    [files, vaultPath]
  )

  const hasNameCollision = useCallback(
    (parentFolderKey: string, proposedName: string): boolean =>
      hasFolderNameCollision(parentFolderKey, proposedName) || hasFileNameCollision(parentFolderKey, proposedName),
    [hasFileNameCollision, hasFolderNameCollision]
  )

  const suggestSequentialName = useCallback(
    (parentFolderKey: string, baseName: string): string => {
      let candidate = normalizeLabel(baseName) || baseName
      let suffix = 2
      while (hasNameCollision(parentFolderKey, candidate)) {
        candidate = `${baseName} ${suffix}`
        suffix += 1
      }
      return candidate
    },
    [hasNameCollision]
  )

  const runCreateFile = useCallback(async () => {
    const parentFolderKey = resolveSelectedFolderKey()
    if (isCreateLockedFolderKey(parentFolderKey)) {
      return
    }
    const name = suggestSequentialName(parentFolderKey, 'Neue Notiz')
    await onCreateFile(parentFolderKey, name)
  }, [onCreateFile, resolveSelectedFolderKey, suggestSequentialName])

  const runCreateTask = useCallback(async () => {
    const parentFolderKey = resolveSelectedFolderKey()
    if (isCreateLockedFolderKey(parentFolderKey)) {
      return
    }
    const name = suggestSequentialName(parentFolderKey, 'Neuer Task')
    await onCreateTask(parentFolderKey, name)
  }, [onCreateTask, resolveSelectedFolderKey, suggestSequentialName])

  const runCreateFolder = useCallback(async () => {
    const parentFolderKey = resolveSelectedFolderKey()
    if (isCreateLockedFolderKey(parentFolderKey)) {
      return
    }
    const name = suggestSequentialName(parentFolderKey, 'New Folder')
    await onCreateFolder(parentFolderKey, name)
  }, [onCreateFolder, resolveSelectedFolderKey, suggestSequentialName])

  const runOpenOrCreateTodayDaily = useCallback(async () => {
    await onOpenOrCreateTodayDaily()
  }, [onOpenOrCreateTodayDaily])

  const collectFolderNodeIds = useCallback((rootNode: ExplorerNode): string[] => {
    if (rootNode.type !== 'folder') {
      return []
    }
    const ids: string[] = []
    const walk = (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      ids.push(node.id)
      for (const child of node.children) {
        if (child.type === 'folder') {
          walk(child)
        }
      }
    }
    walk(rootNode)
    return ids
  }, [])

  const applyExpandedValueForFolders = useCallback((folderIds: string[], expanded: boolean) => {
    if (folderIds.length === 0) {
      return
    }
    setExpandedNodes((prev) => {
      let changed = false
      const next = { ...prev }
      for (const folderId of folderIds) {
        if (next[folderId] !== expanded) {
          next[folderId] = expanded
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [setExpandedNodes])

  const expandAllFolders = useCallback(() => {
    const folderIds: string[] = []
    const walk = (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      folderIds.push(node.id)
      for (const child of node.children) {
        walk(child)
      }
    }
    for (const root of tree.rootNodes) {
      walk(root)
    }
    applyExpandedValueForFolders(folderIds, true)
  }, [applyExpandedValueForFolders, tree.rootNodes])

  const collapseAllFolders = useCallback(() => {
    const folderIds: string[] = []
    const walk = (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      folderIds.push(node.id)
      for (const child of node.children) {
        walk(child)
      }
    }
    for (const root of tree.rootNodes) {
      walk(root)
    }
    applyExpandedValueForFolders(folderIds, false)
  }, [applyExpandedValueForFolders, tree.rootNodes])

  const expandFolderSubtree = useCallback(
    (node: ExplorerNode) => {
      const folderIds = collectFolderNodeIds(node)
      applyExpandedValueForFolders(folderIds, true)
    },
    [applyExpandedValueForFolders, collectFolderNodeIds]
  )

  const collapseFolderSubtree = useCallback(
    (node: ExplorerNode) => {
      const folderIds = collectFolderNodeIds(node)
      applyExpandedValueForFolders(folderIds, false)
    },
    [applyExpandedValueForFolders, collectFolderNodeIds]
  )

  const toggleExpand = useCallback((node: ExplorerNode) => {
    if (node.type !== 'folder') {
      return
    }
    if (node.expanded) {
      collapseFolderSubtree(node)
      return
    }
    setExpandedNodes((prev) => ({ ...prev, [node.id]: true }))
  }, [collapseFolderSubtree, setExpandedNodes])

  const resolveFileDropTargetKey = useCallback(
    (target: ExplorerNode, position: DropPosition): string => {
      const parentId = position === 'inside' ? target.id : tree.parentById.get(target.id) ?? null
      const parentNode = parentId ? tree.nodeById.get(parentId) : null
      return folderKey(parentNode)
    },
    [tree.nodeById, tree.parentById]
  )

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, node: ExplorerNode) => {
      if (!draggingNodeId && draggingFileNodeIds.size === 0) {
        return
      }
      const source = draggingNodeId ? tree.nodeById.get(draggingNodeId) : null
      if (!source && draggingFileNodeIds.size === 0) {
        return
      }
      const position = toDropPosition(event, node)
      if (position === 'inside' && node.type !== 'folder') {
        return
      }
      event.preventDefault()
      setDropIndicator({ nodeId: node.id, position })
      autoScrollForDrag(event.clientY)
    },
    [autoScrollForDrag, draggingFileNodeIds.size, draggingNodeId, tree.nodeById]
  )

  const doDrop = useCallback(
    async (source: ExplorerNode, target: ExplorerNode, position: DropPosition) => {
      if (source.type === 'file') {
        if (isReadonlyLinkFile(source)) {
          return
        }
        const targetKey = resolveFileDropTargetKey(target, position)
        const sourceParentId = tree.parentById.get(source.id) ?? null
        const sourceParentNode = sourceParentId ? tree.nodeById.get(sourceParentId) : null
        const sourceKey = folderKey(sourceParentNode)
        if (sourceKey !== targetKey) {
          await onMoveFile(source.path, targetKey)
        }
        return
      }

      const sourceKey = normalizeGroupKey(source.path)
      const sourceParentId = tree.parentById.get(source.id) ?? null
      const sourceParentNode = sourceParentId ? tree.nodeById.get(sourceParentId) : null
      const sourceParentKey = folderKey(sourceParentNode)
      const destinationParentId = position === 'inside' ? target.id : tree.parentById.get(target.id) ?? null
      const destinationParentNode = destinationParentId ? tree.nodeById.get(destinationParentId) : null
      const destinationParentKey = folderKey(destinationParentNode)
      if (destinationParentId && destinationParentId === source.id) {
        return
      }

      let effectiveSourceKey = sourceKey
      if (sourceParentKey !== destinationParentKey) {
        await onMoveFolder(sourceKey, destinationParentKey)
        const base = sourceKey.includes('/') ? sourceKey.slice(sourceKey.lastIndexOf('/') + 1) : sourceKey
        effectiveSourceKey = destinationParentKey ? `${destinationParentKey}/${base}` : base
      }

      if (position !== 'inside' && target.type === 'folder' && !isPinnedRoot(target.path) && !isPinnedRoot(source.path)) {
        const parentKey = destinationParentKey
        const targetKey = normalizeGroupKey(target.path)
        setFolderOrder((prev) => {
          const current = (prev[parentKey] ?? []).filter((item) => normalizeGroupKey(item) !== normalizeGroupKey(effectiveSourceKey))
          if (!current.includes(targetKey)) {
            current.push(targetKey)
          }
          const idx = current.indexOf(targetKey)
          const insertAt = position === 'before' ? idx : idx + 1
          current.splice(Math.max(0, insertAt), 0, normalizeGroupKey(effectiveSourceKey))
          const next = { ...prev, [parentKey]: Array.from(new Set(current)) }
          return sanitizeOrder(next, new Set(groups.map((group) => normalizeGroupKey(group.key))), fixedRootKeys)
        })
      }
    },
    [fixedRootKeys, groups, onMoveFile, onMoveFolder, resolveFileDropTargetKey, tree.nodeById, tree.parentById, setFolderOrder]
  )

  const onDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>, node: ExplorerNode) => {
      if (!draggingNodeId && orderedDraggedFileNodeIds.length === 0) {
        return
      }
      event.preventDefault()
      const position = toDropPosition(event, node)

      if (orderedDraggedFileNodeIds.length > 0) {
        const targetKey = resolveFileDropTargetKey(node, position)
        const pathsToMove: string[] = []
        for (const fileNodeId of orderedDraggedFileNodeIds) {
          const sourceNode = tree.nodeById.get(fileNodeId)
          if (!sourceNode || sourceNode.type !== 'file' || isReadonlyLinkFile(sourceNode)) {
            continue
          }
          const sourceParentId = tree.parentById.get(sourceNode.id) ?? null
          const sourceParentNode = sourceParentId ? tree.nodeById.get(sourceParentId) : null
          const sourceKey = folderKey(sourceParentNode)
          if (sourceKey === targetKey) {
            continue
          }
          pathsToMove.push(sourceNode.path)
        }
        if (pathsToMove.length > 0) {
          await onMoveFiles(pathsToMove, targetKey)
        }
      } else if (draggingNodeId) {
        const source = tree.nodeById.get(draggingNodeId)
        if (!source) {
          return
        }
        await doDrop(source, node, position)
      }

      setDraggingNodeId(null)
      setDraggingFileNodeIds(() => new Set())
      setDropIndicator(null)
    },
    [doDrop, draggingNodeId, onMoveFiles, orderedDraggedFileNodeIds, resolveFileDropTargetKey, tree.nodeById, tree.parentById]
  )

  const openNodeContextMenu = useCallback((anchor: ContextMenuAnchor, node: ExplorerNode) => {
    if (node.type === 'file') {
      const isAlreadySelected = selectedFileNodeIds.has(node.id)
      if (!isAlreadySelected) {
        setSelectedFileNodeIds(() => new Set([node.id]))
        setSelectionAnchorNodeId(node.id)
      }
    } else {
      clearFileSelection()
    }
    setSelectedNodeId(node.id)
    setContextMenu({ ...anchor, target: 'node', nodeId: node.id })
  }, [clearFileSelection, selectedFileNodeIds, setSelectedNodeId])

  const openContextMenuAt = useCallback((event: ReactMouseEvent<HTMLElement>, node: ExplorerNode) => {
    event.preventDefault(); event.stopPropagation()
    const anchor = contextMenuAnchor(event.currentTarget, event.currentTarget.closest<HTMLElement>('.explorer-shell'))
    openNodeContextMenu(event.detail === 0 && event.type === 'click' ? anchor : {...anchor, x: event.clientX, y: event.clientY}, node)
  }, [openNodeContextMenu])

  const openTreeContextMenuAt = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...contextMenuAnchor(event.currentTarget, event.currentTarget.closest<HTMLElement>('.explorer-shell')), x: event.clientX, y: event.clientY, target: 'tree' })
  }, [])

  const contextNode = contextMenu?.target === 'node' ? tree.nodeById.get(contextMenu.nodeId) ?? null : null
  const contextCreateLockReason = contextNode?.type === 'folder' ? createLockedReason(contextNode.path) : ''
  const contextCreateLocked = Boolean(contextCreateLockReason)
  const contextReadonlyLinkFile = contextNode?.type === 'file' ? isReadonlyLinkFile(contextNode) : false
  const iconPickerCurrentIconName = useMemo(() => {
    if (!iconPicker) {
      return ''
    }
    if (iconPicker.nodeType === 'folder') {
      return iconOverrides.folders[iconPicker.path] || 'Folder'
    }
    const fileName = iconPicker.path.includes('/') ? iconPicker.path.slice(iconPicker.path.lastIndexOf('/') + 1) : iconPicker.path
    return iconOverrides.files[iconPicker.path] || (toFileExtension(fileName) === 'md' ? 'FileText' : 'File')
  }, [iconOverrides.files, iconOverrides.folders, iconPicker])

  const openIconPicker = useCallback((node: ExplorerNode) => {
    if (node.type === 'folder') {
      setIconPicker({ nodeType: 'folder', path: normalizeGroupKey(node.path), label: node.name })
    } else {
      setIconPicker({ nodeType: 'file', path: normalizeFilePathKey(node.path), label: rowName(node) })
    }
    setIconSearchQuery('')
    setContextMenu(null)
  }, [])

  const createFileInFolderFromContext = useCallback(
    async (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      setContextMenu(null)
      const folderKey = normalizeGroupKey(node.path)
      if (isCreateLockedFolderKey(folderKey)) {
        return
      }
      const name = suggestSequentialName(folderKey, 'New Note')
      await onCreateFile(folderKey, name)
    },
    [onCreateFile, suggestSequentialName]
  )

  const createTaskInFolderFromContext = useCallback(
    async (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      setContextMenu(null)
      const folderKey = normalizeGroupKey(node.path)
      if (isCreateLockedFolderKey(folderKey)) {
        return
      }
      const name = suggestSequentialName(folderKey, 'New Task')
      await onCreateTask(folderKey, name)
    },
    [onCreateTask, suggestSequentialName]
  )

  const createFolderInFolderFromContext = useCallback(
    async (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      setContextMenu(null)
      const folderKey = normalizeGroupKey(node.path)
      if (isCreateLockedFolderKey(folderKey)) {
        return
      }
      const name = suggestSequentialName(folderKey, 'New Folder')
      await onCreateFolder(folderKey, name)
    },
    [onCreateFolder, suggestSequentialName]
  )

  const renameNodeFromContext = useCallback(
    async (node: ExplorerNode) => {
      setContextMenu(null)
      if (node.type === 'folder') {
        if (node.canDelete === false) {
          return
        }
        const name = await askInputDialog('Ordner umbenennen', 'Neuer Ordnername', node.name, 'Umbenennen')
        if (!name || name === node.name) {
          return
        }
        await onRenameFolder(normalizeGroupKey(node.path), name)
        return
      }
      if (isReadonlyLinkFile(node)) {
        return
      }
      const current = rowName(node)
      const name = await askInputDialog('Datei umbenennen', 'Neuer Dateiname', current, 'Umbenennen')
      if (!name || name === current) {
        return
      }
      await onRenameFile(node.path, name)
    },
    [askInputDialog, onRenameFile, onRenameFolder]
  )

  const deleteNodeFromContext = useCallback(
    async (node: ExplorerNode) => {
      setContextMenu(null)
      if (node.type === 'folder') {
        if (node.canDelete === false) {
          return
        }
        const confirmed = await askConfirmDialog(
          'Ordner loeschen',
          `Ordner "${node.name}" wirklich loeschen?`,
          'Loeschen',
          true
        )
        if (!confirmed) {
          return
        }
        await onDeleteFolder(normalizeGroupKey(node.path))
        return
      }
      if (isReadonlyLinkFile(node)) {
        return
      }

      const confirmed = await askConfirmDialog(
        'Datei loeschen',
        `Datei "${node.name}" wirklich loeschen?`,
        'Loeschen',
        true
      )
      if (!confirmed) {
        return
      }
      await onDeleteFile(node.path)
    },
    [askConfirmDialog, onDeleteFile, onDeleteFolder]
  )

  const setIconForTarget = useCallback((target: IconPickerTarget, iconName: string | null) => {
    setIconOverrides((prev) => {
      if (target.nodeType === 'folder') {
        const nextFolders = { ...prev.folders }
        if (iconName) {
          nextFolders[target.path] = iconName
        } else {
          delete nextFolders[target.path]
        }
        return { ...prev, folders: nextFolders }
      }
      const nextFiles = { ...prev.files }
      if (iconName) {
        nextFiles[target.path] = iconName
      } else {
        delete nextFiles[target.path]
      }
      return { ...prev, files: nextFiles }
    })
  }, [setIconOverrides])


  const actionDialogValidationMessage =
    actionDialog && actionDialog.kind === 'input' && actionDialog.validate
      ? actionDialog.validate(actionDialog.value)
      : null
  const canConfirmActionDialog =
    actionDialog?.kind === 'input'
      ? Boolean(normalizeLabel(actionDialog.value)) && !actionDialogValidationMessage
      : Boolean(actionDialog)

  return (
    <div
      className="explorer-shell"
      tabIndex={0}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (isInputEventTarget(event.target)) return
        if (isContextMenuKey(event)) {
          event.preventDefault(); event.stopPropagation()
          const focusedNodeId = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId : null
          const nodeId = focusedNodeId ?? selectedNodeId
          const node = nodeId ? tree.nodeById.get(nodeId) : null
          const row = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find(row => row.dataset.nodeId === node?.id)
          const anchor = contextMenuAnchor(row ?? event.currentTarget, event.currentTarget)
          if (node) openNodeContextMenu(anchor, node)
          else setContextMenu({...anchor, target: 'tree'})
          return
        }
        if (tree.visibleNodes.length === 0) {
          return
        }
        const selectedIndex = selectedNodeId
          ? tree.visibleNodes.findIndex((entry) => entry.node.id === selectedNodeId)
          : tree.visibleNodes.findIndex((entry) => entry.node.selected)
        const index = selectedIndex >= 0 ? selectedIndex : -1
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          const nextIndex = Math.min(tree.visibleNodes.length - 1, index + 1)
          const nextNode = tree.visibleNodes[nextIndex].node
          setSelectedNodeId(nextNode.id)
          if (nextNode.type === 'file') {
            if (event.shiftKey) {
              extendSelectionToNode(nextNode.id, hasSelectionModifier(event))
            } else if (hasSelectionModifier(event)) {
              setSelectedFileNodeIds((prev) => {
                const next = new Set(prev)
                next.add(nextNode.id)
                return next
              })
              setSelectionAnchorNodeId((prev) => prev ?? nextNode.id)
            } else {
              selectSingleFile(nextNode.id)
            }
          } else if (!event.shiftKey && !hasSelectionModifier(event)) {
            clearFileSelection()
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          const nextIndex = index < 0 ? 0 : Math.max(0, index - 1)
          const nextNode = tree.visibleNodes[nextIndex].node
          setSelectedNodeId(nextNode.id)
          if (nextNode.type === 'file') {
            if (event.shiftKey) {
              extendSelectionToNode(nextNode.id, hasSelectionModifier(event))
            } else if (hasSelectionModifier(event)) {
              setSelectedFileNodeIds((prev) => {
                const next = new Set(prev)
                next.add(nextNode.id)
                return next
              })
              setSelectionAnchorNodeId((prev) => prev ?? nextNode.id)
            } else {
              selectSingleFile(nextNode.id)
            }
          } else if (!event.shiftKey && !hasSelectionModifier(event)) {
            clearFileSelection()
          }
        }
      }}
    >
      <header className="explorer-toolbar">
        <div className="explorer-toolbar-top">
          <div className="explorer-toolbar-left">
            <MenuButton label="Notizen sortieren" disabled={!vaultLoaded}
              icon={<LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />}>
              <div role="group" aria-label="Sortieren nach" className="nn-context-menu-group">
                <div className="nn-context-menu-heading" aria-hidden="true">Sortieren nach</div>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortMode === 'manual'} onClick={() => setSortMode('manual')}>Manuell</ContextMenuItem>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortMode === 'name'} onClick={() => setSortMode('name')}>Name</ContextMenuItem>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortMode === 'noteCount'} onClick={() => setSortMode('noteCount')}>Notizanzahl</ContextMenuItem>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortMode === 'modified'} onClick={() => setSortMode('modified')}>Letzte Änderung</ContextMenuItem>
              </div>
              <div role="group" aria-label="Richtung" className="nn-context-menu-group">
                <div className="nn-context-menu-heading" aria-hidden="true">Richtung</div>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortDirection === 'asc'} onClick={() => setSortDirection('asc')}>Aufsteigend</ContextMenuItem>
                <ContextMenuItem role="menuitemradio" aria-checked={options.sortDirection === 'desc'} onClick={() => setSortDirection('desc')}>Absteigend</ContextMenuItem>
              </div>
              <div role="separator" />
              <ContextMenuItem onClick={onRefresh} disabled={!vaultLoaded}>Aktualisieren</ContextMenuItem>
            </MenuButton>
            <button
              className="icon-button compact"
              onClick={() => {
                void runOpenOrCreateTodayDaily()
              }}
              disabled={!vaultLoaded}
              aria-label={commandTitle('daily','Tagesnotiz öffnen oder anlegen')} data-tooltip={commandTitle('daily','Tagesnotiz öffnen oder anlegen')}
            >
              <LucideNamedIcon name="CalendarDays" className="row-action-icon" size={14} />
            </button>
          </div>

          <h3>Notizen</h3>

          <div className="explorer-toolbar-right">
            <span data-tooltip={createActionsDisabled ? createActionsDisabledReason : commandTitle('newNote')}>
              <button
                className="icon-button compact"
                onClick={() => {
                  void runCreateFile()
                }}
                disabled={createActionsDisabled}
                aria-label="Neue Notiz"
              >
                <LucideNamedIcon name="FilePlus" className="row-action-icon" size={14} />
              </button>
            </span>
            <span data-tooltip={createActionsDisabled ? createActionsDisabledReason : commandTitle('newTask')}>
              <button
                className="icon-button compact"
                onClick={() => {
                  void runCreateTask()
                }}
                disabled={createActionsDisabled}
                aria-label="Neue Task"
              >
                <LucideNamedIcon name="CheckSquare" className="row-action-icon" size={14} />
              </button>
            </span>
            <span data-tooltip={createActionsDisabled ? createActionsDisabledReason : 'Neuer Ordner'}>
              <button
                className="icon-button compact"
                onClick={() => {
                  void runCreateFolder()
                }}
                disabled={createActionsDisabled}
                aria-label="Neuer Ordner"
              >
                <LucideNamedIcon name="FolderPlus" className="row-action-icon" size={14} />
              </button>
            </span>
          </div>
        </div>

        <div className="explorer-toolbar-search">
          <div className="explorer-search-input-wrap">
            <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
            <input
              ref={searchInputRef}
              className="explorer-search-input"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Search"
            />
            {filterQuery ? (
              <button
                type="button"
                className="explorer-search-clear"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setFilterQuery('')
                  onFilterQueryChange?.('')
                  window.requestAnimationFrame(() => {
                    searchInputRef.current?.focus()
                  })
                }}
                aria-label="Suche leeren"
                data-tooltip="Suche leeren"
              >
                <LucideNamedIcon name="X" size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <section
        className="explorer-tree explorer-flat-tree"
        tabIndex={-1}
        ref={treeRef}
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) {
            return
          }
          if (target.closest('.explorer-row')) {
            return
          }
          setSelectedNodeId(null)
          clearFileSelection()
        }}
        onDragOver={(event) => {
          if (draggingNodeId || draggingFileNodeIds.size > 0) {
            event.preventDefault()
            autoScrollForDrag(event.clientY)
          }
        }}
        onDrop={() => {
          setDraggingNodeId(null)
          setDraggingFileNodeIds(() => new Set())
          setDropIndicator(null)
        }}
        onContextMenu={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) {
            return
          }
          if (target.closest('.explorer-row')) {
            return
          }
          openTreeContextMenuAt(event)
        }}
      >
        {tree.visibleNodes.length === 0 ? <p className="empty-copy">Keine passenden Dateien oder Ordner.</p> : null}
        {tree.visibleNodes.map((entry) => {
          const node = entry.node
          const dropPos = dropIndicator?.nodeId === node.id ? dropIndicator.position : null
          const canDrag = node.type === 'file' ? !isReadonlyLinkFile(node) : (node.canDelete !== false && !isPinnedRoot(node.path))
          const isFileSelected = node.type === 'file' && selectedFileNodeIds.has(node.id)
          const isRowSelected = node.type === 'file' ? isFileSelected : node.selected
          const countInfo = folderFileCounts.get(node.id)
          const folderCount = node.type === 'folder' ? (countInfo?.total ?? 0) : 0

          return (
            <div key={node.id} className="explorer-row-wrap">
              {dividerBeforeNodeId === node.id ? <div className="explorer-fixed-divider" /> : null}
              <div
                className={`explorer-row ${isRowSelected ? 'selected' : ''} ${options.compactMode ? 'compact' : ''} ${dropPos ? `drop-${dropPos}` : ''}`}
                style={{ marginLeft: `${8 + entry.depth * 14}px` }}
                data-node-id={node.id}
                tabIndex={-1}
                draggable={canDrag}
                onDragStart={(event) => {
                  if (!canDrag) {
                    event.preventDefault()
                    return
                  }
                  setDraggingNodeId(node.id)
                  if (node.type === 'file') {
                    const selectionSource = selectedFileNodeIds.has(node.id) ? selectedFileNodeIds : new Set([node.id])
                    const draggedFileIds = Array.from(selectionSource).filter((nodeId) => {
                      const selectedNode = tree.nodeById.get(nodeId)
                      return selectedNode?.type === 'file' && !isReadonlyLinkFile(selectedNode)
                    })
                    if (draggedFileIds.length === 0) {
                      if (isReadonlyLinkFile(node)) {
                        event.preventDefault()
                        return
                      }
                      draggedFileIds.push(node.id)
                    }
                    const dragSet = new Set(draggedFileIds)
                    setDraggingFileNodeIds(dragSet)
                    if (!selectedFileNodeIds.has(node.id)) {
                      setSelectedFileNodeIds(() => new Set([node.id]))
                      setSelectionAnchorNodeId(node.id)
                    }
                    const draggedPaths = draggedFileIds
                      .map((nodeId) => {
                        const selectedNode = tree.nodeById.get(nodeId)
                        return selectedNode?.type === 'file' ? selectedNode.path : ''
                      })
                      .filter(Boolean)
                    if (draggedPaths.length > 0) {
                      event.dataTransfer.setData(EXPLORER_MULTI_DRAG_MIME, JSON.stringify(draggedPaths))
                      event.dataTransfer.setData('application/x-note-path', draggedPaths[0])
                      event.dataTransfer.setData('application/x-note-title', node.name)
                    }
                  } else {
                    setDraggingFileNodeIds(() => new Set())
                    event.dataTransfer.setData('text/plain', node.id)
                  }
                  event.dataTransfer.effectAllowed = node.type === 'file' ? 'copyMove' : 'move'
                }}
                onDragEnd={() => {
                  setDraggingNodeId(null)
                  setDraggingFileNodeIds(() => new Set())
                  setDropIndicator(null)
                }}
                onDragOver={(event) => onDragOver(event, node)}
                onDrop={(event) => {
                  void onDrop(event, node)
                }}
                onClick={(event) => {
                  const target = event.target
                  if (target instanceof HTMLElement && target.closest('.row-pin-slot')) {
                    setSelectedNodeId(null)
                    clearFileSelection()
                    return
                  }
                  setSelectedNodeId(node.id)
                  if (node.type === 'file') {
                    if (event.shiftKey) {
                      extendSelectionToNode(node.id, hasSelectionModifier(event))
                      return
                    }
                    if (hasSelectionModifier(event)) {
                      toggleFileSelection(node.id)
                      return
                    }
                    selectSingleFile(node.id)
                  } else {
                    clearFileSelection()
                  }
                }}
                onDoubleClick={() => {
                  if (node.type === 'folder') {
                    toggleExpand(node)
                  } else {
                    selectSingleFile(node.id)
                    void onOpenFile(resolveOpenPath(node), node.name)
                  }
                }}
                onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
                  const target = event.target
                  if (target instanceof HTMLElement && target.closest('.row-pin-slot')) {
                    openTreeContextMenuAt(event)
                    return
                  }
                  openContextMenuAt(event, node)
                }}
              >
                <div className="row-content">
                  <span className={`row-pin-slot ${node.type === 'folder' && node.favorite ? 'active' : ''}`} aria-hidden="true">
                    {node.type === 'folder' && node.favorite ? (
                      <LucideNamedIcon name="Pin" size={11} className="row-pin-icon" />
                    ) : null}
                  </span>
                  <button type="button" className={`twistie row-twistie ${node.type === 'folder' ? 'show' : ''}`} onClick={(event) => {
                    event.stopPropagation()
                    if (node.type === 'folder') {
                      toggleExpand(node)
                    }
                  }}>
                    {node.type === 'folder' ? (
                      <LucideNamedIcon name={node.expanded ? 'ChevronDown' : 'ChevronRight'} size={12} className="twistie-icon" />
                    ) : null}
                  </button>
                  {options.showIcons ? (
                    <span className="row-icon">
                      <LucideNamedIcon name={resolveNodeIconName(node)} size={14} className="row-node-icon" />
                    </span>
                  ) : null}
                  <span className="row-name">{rowName(node)}</span>
                </div>
                <div className="row-meta">
                  {node.type === 'folder' ? (
                    <button type="button" className="row-folder-menu" onClick={(event) => openContextMenuAt(event, node)} aria-label="Ordner-Aktionen" data-tooltip="Ordner-Aktionen">
                      <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                    </button>
                  ) : null}
                  {node.type === 'folder' ? <span className="row-count">{folderCount}</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {contextMenu && (contextMenu.target === 'tree' || contextNode) ? (
        <ContextMenu anchor={contextMenu} label="Exploreraktionen" onClose={() => setContextMenu(null)}>
            {contextMenu.target === 'tree' ? (
              <>
                <ContextMenuItem onClick={() => { expandAllFolders(); setContextMenu(null) }}>
                  <LucideNamedIcon name="ChevronsDown" className="context-menu-icon" size={14} />
                  <span>Alle erweitern</span>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => { collapseAllFolders(); setContextMenu(null) }}>
                  <LucideNamedIcon name="ChevronsUp" className="context-menu-icon" size={14} />
                  <span>Alle reduzieren</span>
                </ContextMenuItem>
              </>
            ) : null}
            {contextMenu.target === 'node' && contextNode?.type === 'folder' ? (
              <ContextMenuItem onClick={() => { expandFolderSubtree(contextNode); setContextMenu(null) }}>
                <LucideNamedIcon name="ChevronsDown" className="context-menu-icon" size={14} />
                <span>Alle erweitern</span>
              </ContextMenuItem>
            ) : null}
            {contextMenu.target === 'node' && contextNode?.type === 'folder' ? (
              <ContextMenuItem onClick={() => { collapseFolderSubtree(contextNode); setContextMenu(null) }}>
                <LucideNamedIcon name="ChevronsUp" className="context-menu-icon" size={14} />
                <span>Alle reduzieren</span>
              </ContextMenuItem>
            ) : null}
            {contextMenu.target === 'node' && contextNode ? (
              <div role="separator" />
            ) : null}
            {contextMenu.target === 'node' && contextNode ? (
              <>
                {contextNode.type === 'file' ? (
                  <ContextMenuItem onClick={() => { void onOpenFile(resolveOpenPath(contextNode), contextNode.name); setContextMenu(null) }}>
                    <LucideNamedIcon name="ExternalLink" className="context-menu-icon" size={14} />
                    <span>Datei oeffnen</span>
                  </ContextMenuItem>
                ) : null}
                {contextNode.type === 'folder' ? (
                  <ContextMenuItem

                    disabled={contextCreateLocked}
                    data-tooltip={contextCreateLocked ? contextCreateLockReason : 'Neue Datei'}
                    onClick={() => {
                      void createFileInFolderFromContext(contextNode)
                    }}
                  >
                    <LucideNamedIcon name="FilePlus" className="context-menu-icon" size={14} />
                    <span>Neue Datei</span>
                  </ContextMenuItem>
                ) : null}
                {contextNode.type === 'folder' ? (
                  <ContextMenuItem

                    disabled={contextCreateLocked}
                    data-tooltip={contextCreateLocked ? contextCreateLockReason : 'Neue Task'}
                    onClick={() => {
                      void createTaskInFolderFromContext(contextNode)
                    }}
                  >
                    <LucideNamedIcon name="CheckSquare" className="context-menu-icon" size={14} />
                    <span>Neue Task</span>
                  </ContextMenuItem>
                ) : null}
                {contextNode.type === 'folder' ? (
                  <ContextMenuItem

                    disabled={contextCreateLocked}
                    data-tooltip={contextCreateLocked ? contextCreateLockReason : 'Neuer Ordner'}
                    onClick={() => {
                      void createFolderInFolderFromContext(contextNode)
                    }}
                  >
                    <LucideNamedIcon name="FolderPlus" className="context-menu-icon" size={14} />
                    <span>Neuer Ordner</span>
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem

                  disabled={contextReadonlyLinkFile}
                  data-tooltip={contextReadonlyLinkFile ? 'Task-Links koennen hier nicht umbenannt werden.' : 'Umbenennen'}
                  onClick={() => {
                    void renameNodeFromContext(contextNode)
                  }}
                >
                  <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
                  <span>Umbenennen</span>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => { openIconPicker(contextNode) }}>
                  <LucideNamedIcon name="Palette" className="context-menu-icon" size={14} />
                  <span>Icon festlegen</span>
                </ContextMenuItem>
                {contextNode.type === 'folder' ? (
                  <ContextMenuItem disabled={isPinnedRoot(contextNode.path) && contextNode.favorite} onClick={() => { if (!(isPinnedRoot(contextNode.path) && contextNode.favorite)) { void onToggleFavoriteFolder(normalizeGroupKey(contextNode.path)) }; setContextMenu(null) }}>
                    <LucideNamedIcon name={contextNode.favorite ? 'PinOff' : 'Pin'} className="context-menu-icon" size={14} />
                    <span>{isPinnedRoot(contextNode.path) && contextNode.favorite ? 'Fixierung aktiv (nicht aufhebbar)' : contextNode.favorite ? 'Fixierung aufheben' : 'Ordner fixieren'}</span>
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  className="danger"
                  disabled={(contextNode.type === 'folder' && contextNode.canDelete === false) || contextReadonlyLinkFile}
                  data-tooltip={contextReadonlyLinkFile ? 'Task-Links koennen hier nicht geloescht werden.' : 'Loeschen'}
                  onClick={() => {
                    void deleteNodeFromContext(contextNode)
                  }}
                >
                  <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
                  <span>Loeschen</span>
                </ContextMenuItem>
              </>
            ) : null}
        </ContextMenu>
      ) : null}

      {actionDialog ? (
        <div
          className="explorer-action-dialog-overlay"
          onClick={() => {
            closeActionDialog(false)
          }}
        >
          <aside
            className="explorer-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={actionDialog.title}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Escape') {event.preventDefault(); closeActionDialog(false)}
              if (event.key === 'Tab') {
                const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input,button:not(:disabled)')]
                const first = controls[0], last = controls[controls.length - 1]
                if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus()}
                else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus()}
              }
            }}
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <h4>{actionDialog.title}</h4>
            {actionDialog.kind === 'confirm' ? <p>{actionDialog.message}</p> : null}
            {actionDialog.kind === 'input' ? (
              <input
                value={actionDialog.value}
                placeholder={actionDialog.placeholder}
                onChange={(event) => {
                  setActionDialog((prev) =>
                    prev && prev.kind === 'input'
                      ? {
                          ...prev,
                          value: event.target.value,
                        }
                      : prev
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (canConfirmActionDialog) {
                      closeActionDialog(true)
                    }
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeActionDialog(false)
                  }
                }}
                autoFocus
              />
            ) : null}
            {actionDialog.kind === 'input' && actionDialogValidationMessage ? (
              <p className="explorer-action-dialog-validation">
                <LucideNamedIcon name="AlertCircle" size={13} className="explorer-action-dialog-validation-icon" />
                <span>{actionDialogValidationMessage}</span>
              </p>
            ) : null}
            <div className="explorer-action-dialog-actions">
              <button
                className={actionDialog.danger ? 'danger' : ''}
                autoFocus={actionDialog.kind === 'confirm' && !actionDialog.danger}
                disabled={!canConfirmActionDialog}
                onClick={() => {
                  closeActionDialog(true)
                }}
              >
                {actionDialog.confirmLabel}
              </button>
              <button
                autoFocus={actionDialog.kind === 'confirm' && actionDialog.danger}
                onClick={() => {
                  closeActionDialog(false)
                }}
              >
                Abbrechen
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {iconPicker ? (
        <div
          className="explorer-icon-picker-overlay"
          onClick={() => {
            setIconPicker(null)
            setIconSearchQuery('')
          }}
        >
          <aside
            className="explorer-icon-picker-modal"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <header className="explorer-icon-picker-header">
              <h4>Icon waehlen: {iconPicker.label}</h4>
              <button
                className="icon-button compact muted"
                onClick={() => {
                  setIconPicker(null)
                  setIconSearchQuery('')
                }}
                aria-label="Schliessen" data-tooltip="Schliessen"
              >
                <LucideNamedIcon name="X" size={14} className="row-action-icon" />
              </button>
            </header>

            <div className="explorer-icon-picker-search">
              <input
                value={iconSearchQuery}
                onChange={(event) => setIconSearchQuery(event.target.value)}
                placeholder="Icon suchen, z. B. folder, file, tag ..."
                autoFocus
              />
              <button
                className="icon-button compact muted"
                onClick={() => {
                  setIconForTarget(iconPicker, null)
                  setIconPicker(null)
                  setIconSearchQuery('')
                }}
                aria-label="Standardicon wiederherstellen" data-tooltip="Standardicon wiederherstellen"
              >
                <LucideNamedIcon name="RotateCcw" size={14} className="row-action-icon" />
              </button>
            </div>

            <p className="explorer-icon-picker-current">
              Aktuell: <strong>{iconPickerCurrentIconName}</strong>
            </p>

            <div className="explorer-icon-grid">
              {visibleIconNames.map((iconName) => (
                <button
                  key={`lucide-icon-${iconName}`}
                  className={`explorer-icon-option ${iconName === iconPickerCurrentIconName ? 'active' : ''}`}
                  onClick={() => {
                    setIconForTarget(iconPicker, iconName)
                    setIconPicker(null)
                    setIconSearchQuery('')
                  }}
                  data-tooltip={iconName}
                >
                  <LucideNamedIcon name={iconName} size={16} className="explorer-icon-option-glyph" />
                  <span>{iconName}</span>
                </button>
              ))}
              {visibleIconNames.length === 0 ? <p className="empty-copy">Keine passenden Icons gefunden.</p> : null}
            </div>
          </aside>
        </div>
      ) : null}

      <div className="explorer-width-handle" onMouseDown={(event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = width
        const onMove = (moveEvent: MouseEvent) => onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX)))
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }} data-tooltip="Explorer-Breite anpassen" />
    </div>
  )
}

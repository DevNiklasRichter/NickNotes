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
  activeFilePath: string
  dirtyFilePaths: Set<string>
  width: number
  onWidthChange: (nextWidth: number) => void
  onOpenFile: (path: string, title?: string) => Promise<void>
  onPreviewFile: (path: string, title?: string) => Promise<void>
  onCreateFile: (parentFolderKey: string, title: string) => Promise<void>
  onCreateFolder: (parentFolderKey: string, name: string) => Promise<void>
  onRenameFile: (path: string, newName: string) => Promise<void>
  onRenameFolder: (groupKey: string, newName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  onDeleteFolder: (groupKey: string) => Promise<void>
  onMoveFile: (path: string, targetGroupKey: string) => Promise<void>
  onMoveFolder: (groupKey: string, targetParentKey: string) => Promise<void>
  onToggleFavoriteFolder: (groupKey: string) => Promise<void>
  options: ExplorerOptions
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
type ContextMenu = { x: number; y: number; nodeId: string } | null
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

function isInputEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName.toLowerCase()
  return ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable
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

function slugifyForDuplicateCheck(raw: string): string {
  return normalizeLabel(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
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
  activeFilePath,
  dirtyFilePaths,
  width,
  onWidthChange,
  onOpenFile,
  onPreviewFile,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onMoveFile,
  onMoveFolder,
  onToggleFavoriteFolder,
  options,
  onOptionsChange,
  onRefresh,
  revealFilePath,
  revealRequestId,
  viewStateSeed,
  viewStateSeedId,
  onViewStateChange,
}: ExplorerSidebarProps) {
  const treeRef = useRef<HTMLElement | null>(null)
  const contextPanelRef = useRef<HTMLDivElement | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [folderOrder, setFolderOrder] = useState<Record<string, string[]>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
  const [iconOverrides, setIconOverrides] = useState<NodeIconOverrides>({ folders: {}, files: {} })
  const [iconPicker, setIconPicker] = useState<IconPickerState>(null)
  const [iconSearchQuery, setIconSearchQuery] = useState('')
  const [actionDialog, setActionDialog] = useState<ExplorerActionDialogState | null>(null)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const actionDialogRef = useRef<ExplorerActionDialogState | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const lastAutoRevealPathRef = useRef('')
  const lastHandledRevealRequestRef = useRef<number | null>(null)
  const previewClickTimerRef = useRef<number | null>(null)

  const clearPreviewClickTimer = useCallback(() => {
    if (previewClickTimerRef.current !== null) {
      window.clearTimeout(previewClickTimerRef.current)
      previewClickTimerRef.current = null
    }
  }, [])

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

  useEffect(() => {
    actionDialogRef.current = actionDialog
  }, [actionDialog])

  useEffect(() => {
    if (!sortMenuOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && sortMenuRef.current?.contains(target)) {
        return
      }
      setSortMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [sortMenuOpen])

  useEffect(() => {
    return () => {
      clearPreviewClickTimer()
    }
  }, [clearPreviewClickTimer])

  useEffect(() => {
    const seed = viewStateSeed ?? {
      expandedNodes: {},
      selectedNodeId: null,
      filterQuery: '',
      folderOrder: {},
      iconOverrides: { folders: {}, files: {} },
    }
    setExpandedNodes(toSafeExpanded(seed.expandedNodes))
    setSelectedNodeId(typeof seed.selectedNodeId === 'string' ? seed.selectedNodeId : null)
    setFilterQuery(typeof seed.filterQuery === 'string' ? seed.filterQuery : '')
    setFolderOrder(toSafeOrder(seed.folderOrder))
    setIconOverrides(toSafeIconOverrides(seed.iconOverrides))
  }, [viewStateSeed, viewStateSeedId])

  useEffect(() => {
    if (!onViewStateChange) {
      return
    }
    onViewStateChange({
      expandedNodes,
      selectedNodeId,
      filterQuery,
      folderOrder,
      iconOverrides,
    })
  }, [expandedNodes, filterQuery, folderOrder, iconOverrides, onViewStateChange, selectedNodeId])

  useEffect(() => {
    const valid = new Set(groups.map((group) => normalizeGroupKey(group.key)))
    setFolderOrder((prev) => sanitizeOrder(prev, valid, fixedRootKeys))
  }, [fixedRootKeys, groups])

  useEffect(() => {
    if (!vaultLoaded || groups.length === 0) {
      return
    }
    const validFolders = new Set(groups.map((group) => normalizeGroupKey(group.key)))
    const validFiles = new Set(files.map((file) => normalizeFilePathKey(file.path)))
    setIconOverrides((prev) => pruneIconOverrides(prev, validFolders, validFiles))
  }, [files, groups, vaultLoaded])

  const tree = useMemo(
    () =>
      buildExplorerTree({
        groups,
        files,
        vaultPath,
        options,
        folderOrder,
        expandedNodes,
        selectedNodeId,
        activeFilePath,
        filterQuery,
        dirtyFilePaths,
      }),
    [activeFilePath, dirtyFilePaths, expandedNodes, files, filterQuery, folderOrder, groups, options, selectedNodeId, vaultPath]
  )

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
    [tree.fileNodeIdByPath, tree.parentById]
  )

  useEffect(() => {
    if (!activeFilePath) {
      lastAutoRevealPathRef.current = ''
      return
    }
    if (lastAutoRevealPathRef.current === activeFilePath) {
      return
    }
    const revealed = revealPathInTree(activeFilePath)
    if (revealed) {
      lastAutoRevealPathRef.current = activeFilePath
    }
  }, [activeFilePath, revealPathInTree])

  useEffect(() => {
    if (typeof revealRequestId !== 'number') {
      return
    }
    if (lastHandledRevealRequestRef.current === revealRequestId) {
      return
    }
    lastHandledRevealRequestRef.current = revealRequestId
    if (!revealFilePath) {
      return
    }
    const revealed = revealPathInTree(revealFilePath)
    if (revealed) {
      lastAutoRevealPathRef.current = revealFilePath
    }
  }, [revealFilePath, revealRequestId, revealPathInTree])

  const selectedNode = useMemo(() => tree.visibleNodes.find((entry) => entry.node.selected)?.node ?? null, [tree.visibleNodes])

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
    setActionDialog(null)
    window.setTimeout(() => {
      if (current.kind === 'input') {
        current.resolve({ confirmed, value: current.value })
        return
      }
      current.resolve({ confirmed })
    }, 0)
  }, [])

  const setSortMode = useCallback(
    (mode: ExplorerOptions['sortMode']) => {
      if (!onOptionsChange) {
        return
      }
      onOptionsChange({ ...options, sortMode: mode })
      setSortMenuOpen(false)
    },
    [onOptionsChange, options]
  )

  const setSortDirection = useCallback(
    (direction: ExplorerOptions['sortDirection']) => {
      if (!onOptionsChange) {
        return
      }
      onOptionsChange({ ...options, sortDirection: direction })
      setSortMenuOpen(false)
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

  const runCreateFile = useCallback(async () => {
    const parentFolderKey = resolveSelectedFolderKey()
    const name = await askInputDialog(
      'Neue Datei',
      'Name der neuen Datei',
      'Neue Notiz',
      'Anlegen',
      false,
      (value) =>
        hasNameCollision(parentFolderKey, value)
          ? 'Datei bereits vorhanden'
          : null
    )
    if (!name) {
      return
    }
    await onCreateFile(parentFolderKey, name)
  }, [askInputDialog, hasNameCollision, onCreateFile, resolveSelectedFolderKey])

  const runCreateFolder = useCallback(async () => {
    const parentFolderKey = resolveSelectedFolderKey()
    const name = await askInputDialog(
      'Neuer Ordner',
      'Name des neuen Ordners',
      'Neuer Ordner',
      'Anlegen',
      false,
      (value) =>
        hasNameCollision(parentFolderKey, value)
          ? 'Ordner bereits vorhanden'
          : null
    )
    if (!name) {
      return
    }
    await onCreateFolder(parentFolderKey, name)
  }, [askInputDialog, hasNameCollision, onCreateFolder, resolveSelectedFolderKey])

  const toggleExpand = useCallback((node: ExplorerNode) => {
    if (node.type !== 'folder') {
      return
    }
    setExpandedNodes((prev) => ({ ...prev, [node.id]: !node.expanded }))
  }, [])

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, node: ExplorerNode) => {
      if (!draggingNodeId) {
        return
      }
      const source = tree.nodeById.get(draggingNodeId)
      if (!source) {
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
    [autoScrollForDrag, draggingNodeId, tree.nodeById]
  )

  const doDrop = useCallback(
    async (source: ExplorerNode, target: ExplorerNode, position: DropPosition) => {
      if (source.type === 'file') {
        const parentId = position === 'inside' ? target.id : tree.parentById.get(target.id) ?? null
        const parentNode = parentId ? tree.nodeById.get(parentId) : null
        const targetKey = folderKey(parentNode)
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
    [fixedRootKeys, groups, onMoveFile, onMoveFolder, tree.nodeById, tree.parentById]
  )

  const onDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>, node: ExplorerNode) => {
      if (!draggingNodeId) {
        return
      }
      event.preventDefault()
      const source = tree.nodeById.get(draggingNodeId)
      if (!source) {
        return
      }
      const position = toDropPosition(event, node)
      await doDrop(source, node, position)
      setDraggingNodeId(null)
      setDropIndicator(null)
    },
    [doDrop, draggingNodeId, tree.nodeById]
  )

  const openContextMenuAt = useCallback((event: ReactMouseEvent<HTMLElement>, node: ExplorerNode) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedNodeId(node.id)
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  const contextNode = contextMenu ? tree.nodeById.get(contextMenu.nodeId) ?? null : null
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
      const name = await askInputDialog(
        'Neue Datei',
        'Name der neuen Datei',
        'Neue Notiz',
        'Anlegen',
        false,
        (value) =>
          hasNameCollision(folderKey, value)
            ? 'Datei bereits vorhanden'
            : null
      )
      if (!name) {
        return
      }
      await onCreateFile(folderKey, name)
    },
    [askInputDialog, hasNameCollision, onCreateFile]
  )

  const createFolderInFolderFromContext = useCallback(
    async (node: ExplorerNode) => {
      if (node.type !== 'folder') {
        return
      }
      setContextMenu(null)
      const folderKey = normalizeGroupKey(node.path)
      const name = await askInputDialog(
        'Neuer Ordner',
        'Name des neuen Ordners',
        'Neuer Ordner',
        'Anlegen',
        false,
        (value) =>
          hasNameCollision(folderKey, value)
            ? 'Ordner bereits vorhanden'
            : null
      )
      if (!name) {
        return
      }
      await onCreateFolder(folderKey, name)
    },
    [askInputDialog, hasNameCollision, onCreateFolder]
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
  }, [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && contextPanelRef.current?.contains(target)) {
        return
      }
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [contextMenu])

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
        if (isInputEventTarget(event.target) || tree.visibleNodes.length === 0) {
          return
        }
        const selectedIndex = tree.visibleNodes.findIndex((entry) => entry.node.selected)
        const index = selectedIndex >= 0 ? selectedIndex : -1
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          const nextIndex = Math.min(tree.visibleNodes.length - 1, index + 1)
          setSelectedNodeId(tree.visibleNodes[nextIndex].node.id)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          const nextIndex = index < 0 ? 0 : Math.max(0, index - 1)
          setSelectedNodeId(tree.visibleNodes[nextIndex].node.id)
        }
      }}
    >
      <header className="explorer-toolbar">
        <h3>NOTIZEN</h3>
        <div className="explorer-toolbar-search">
          <input className="explorer-search-input" value={filterQuery} onChange={(event) => setFilterQuery(event.target.value)} placeholder="Dateien filtern" />
        </div>
      </header>
      <div className="explorer-toolbar-actions-row">
        <div className="explorer-toolbar-actions">
          <button className="icon-button compact" onClick={onRefresh} disabled={!vaultLoaded} title="Aktualisieren">
            <LucideNamedIcon name="RefreshCw" className="row-action-icon" size={14} />
          </button>
          <button
            className="icon-button compact"
            onClick={() => {
              void runCreateFile()
            }}
            disabled={!vaultLoaded}
            title="Neue Datei"
          >
            <LucideNamedIcon name="FilePlus" className="row-action-icon" size={14} />
          </button>
          <button
            className="icon-button compact"
            onClick={() => {
              void runCreateFolder()
            }}
            disabled={!vaultLoaded}
            title="Neuer Ordner"
          >
            <LucideNamedIcon name="FolderPlus" className="row-action-icon" size={14} />
          </button>
          <div className="explorer-sort-anchor" ref={sortMenuRef}>
            <button
              className={`icon-button compact ${sortMenuOpen ? 'active' : ''}`}
              onClick={() => {
                setSortMenuOpen((prev) => !prev)
              }}
              disabled={!vaultLoaded}
              title="Sortierung"
            >
              <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
            </button>
            {sortMenuOpen ? (
              <div className="explorer-sort-menu">
                <div className="explorer-sort-menu-section">
                  <span>Sortieren nach</span>
                  <button className={options.sortMode === 'manual' ? 'active' : ''} onClick={() => setSortMode('manual')}>
                    Manuell
                  </button>
                  <button className={options.sortMode === 'name' ? 'active' : ''} onClick={() => setSortMode('name')}>
                    Name
                  </button>
                  <button className={options.sortMode === 'noteCount' ? 'active' : ''} onClick={() => setSortMode('noteCount')}>
                    Notizanzahl
                  </button>
                  <button className={options.sortMode === 'modified' ? 'active' : ''} onClick={() => setSortMode('modified')}>
                    Letzte Aenderung
                  </button>
                </div>
                <div className="explorer-sort-menu-section">
                  <span>Richtung</span>
                  <button className={options.sortDirection === 'asc' ? 'active' : ''} onClick={() => setSortDirection('asc')}>
                    Aufsteigend
                  </button>
                  <button className={options.sortDirection === 'desc' ? 'active' : ''} onClick={() => setSortDirection('desc')}>
                    Absteigend
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <section
        className="explorer-tree explorer-flat-tree"
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
        }}
        onDragOver={(event) => {
          if (draggingNodeId) {
            event.preventDefault()
            autoScrollForDrag(event.clientY)
          }
        }}
        onDrop={() => {
          setDraggingNodeId(null)
          setDropIndicator(null)
        }}
      >
        {tree.visibleNodes.length === 0 ? <p className="empty-copy">Keine passenden Dateien oder Ordner.</p> : null}
        {tree.visibleNodes.map((entry) => {
          const node = entry.node
          const dropPos = dropIndicator?.nodeId === node.id ? dropIndicator.position : null
          const canDrag = node.type === 'file' || (node.canDelete !== false && !isPinnedRoot(node.path))
          const countInfo = folderFileCounts.get(node.id)
          const folderCount = node.type === 'folder' ? (countInfo?.total ?? 0) : 0

          return (
            <div key={node.id} className="explorer-row-wrap">
              {dividerBeforeNodeId === node.id ? <div className="explorer-fixed-divider" /> : null}
              <div
                className={`explorer-row ${node.selected ? 'selected' : ''} ${options.compactMode ? 'compact' : ''} ${dropPos ? `drop-${dropPos}` : ''}`}
                style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
                draggable={canDrag}
                onDragStart={(event) => {
                  setDraggingNodeId(node.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', node.id)
                }}
                onDragOver={(event) => onDragOver(event, node)}
                onDrop={(event) => {
                  void onDrop(event, node)
                }}
                onClick={() => {
                  setSelectedNodeId(node.id)
                  if (node.type === 'file') {
                    clearPreviewClickTimer()
                    previewClickTimerRef.current = window.setTimeout(() => {
                      previewClickTimerRef.current = null
                      void onPreviewFile(node.path, node.name)
                    }, 280)
                  } else {
                    clearPreviewClickTimer()
                  }
                }}
                onDoubleClick={() => {
                  clearPreviewClickTimer()
                  if (node.type === 'folder') {
                    toggleExpand(node)
                  } else {
                    void onOpenFile(node.path, node.name)
                  }
                }}
                onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => openContextMenuAt(event, node)}
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
                    <button type="button" className="row-folder-menu" onClick={(event) => openContextMenuAt(event, node)} title="Ordner-Aktionen">
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

      {contextMenu && contextNode ? (
        <div className="explorer-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          <div className="explorer-context-panel" ref={contextPanelRef}>
            {contextNode.type === 'file' ? (
              <button className="context-menu-item" onClick={() => { void onOpenFile(contextNode.path, contextNode.name); setContextMenu(null) }}>
                <LucideNamedIcon name="ExternalLink" className="context-menu-icon" size={14} />
                <span>Datei oeffnen</span>
              </button>
            ) : null}
            {contextNode.type === 'folder' ? (
              <button
                className="context-menu-item"
                onClick={() => {
                  void createFileInFolderFromContext(contextNode)
                }}
              >
                <LucideNamedIcon name="FilePlus" className="context-menu-icon" size={14} />
                <span>Neue Datei</span>
              </button>
            ) : null}
            {contextNode.type === 'folder' ? (
              <button
                className="context-menu-item"
                onClick={() => {
                  void createFolderInFolderFromContext(contextNode)
                }}
              >
                <LucideNamedIcon name="FolderPlus" className="context-menu-icon" size={14} />
                <span>Neuer Ordner</span>
              </button>
            ) : null}
            <button
              className="context-menu-item"
              onClick={() => {
                void renameNodeFromContext(contextNode)
              }}
            >
              <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
              <span>Umbenennen</span>
            </button>
            <button className="context-menu-item" onClick={() => { openIconPicker(contextNode) }}>
              <LucideNamedIcon name="Palette" className="context-menu-icon" size={14} />
              <span>Icon festlegen</span>
            </button>
            {contextNode.type === 'folder' ? (
              <button className="context-menu-item" disabled={isPinnedRoot(contextNode.path) && contextNode.favorite} onClick={() => { if (!(isPinnedRoot(contextNode.path) && contextNode.favorite)) { void onToggleFavoriteFolder(normalizeGroupKey(contextNode.path)) }; setContextMenu(null) }}>
                <LucideNamedIcon name={contextNode.favorite ? 'PinOff' : 'Pin'} className="context-menu-icon" size={14} />
                <span>{isPinnedRoot(contextNode.path) && contextNode.favorite ? 'Fixierung aktiv (nicht aufhebbar)' : contextNode.favorite ? 'Fixierung aufheben' : 'Ordner fixieren'}</span>
              </button>
            ) : null}
            <button
              className="context-menu-item danger"
              disabled={contextNode.type === 'folder' && contextNode.canDelete === false}
              onClick={() => {
                void deleteNodeFromContext(contextNode)
              }}
            >
              <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
              <span>Loeschen</span>
            </button>
          </div>
        </div>
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
                disabled={!canConfirmActionDialog}
                onClick={() => {
                  closeActionDialog(true)
                }}
              >
                {actionDialog.confirmLabel}
              </button>
              <button
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
                title="Schliessen"
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
                title="Standardicon wiederherstellen"
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
                  title={iconName}
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
      }} title="Explorer-Breite anpassen" />
    </div>
  )
}


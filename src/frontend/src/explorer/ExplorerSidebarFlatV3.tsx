import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type {
  ExplorerNode,
  ExplorerOptions,
  ExplorerSourceFile,
  ExplorerSourceGroup,
} from './types'
import { buildExplorerTree, getParentFolderKey, normalizeGroupKey, toFileExtension } from './treeModel'
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
  onRefresh: () => void
}

type DropPosition = 'before' | 'inside' | 'after'
type DropIndicator = { nodeId: string; position: DropPosition } | null
type ContextMenu = { x: number; y: number; nodeId: string } | null
type FolderFileCount = { direct: number; total: number }
type NodeIconOverrides = {
  folders: Record<string, string>
  files: Record<string, string>
}
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

const STORAGE_PREFIX = 'nicknotes-explorer-flat-v3'
const ROOT_TOKENS = ['daily', 'tags', 'tasks'] as const
const ROOT_TOKEN_SET = new Set<string>(ROOT_TOKENS)
const MIN_WIDTH = 220
const MAX_WIDTH = 520

function readStorageValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorageValue<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Best effort only.
  }
}

function normalizeStorageKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

function scopedStorageKey(base: string, vaultPath: string): string {
  return `${base}-${normalizeStorageKey(vaultPath) || 'default'}`
}

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
  onRefresh,
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

  const storage = useMemo(
    () => ({
      expanded: scopedStorageKey(`${STORAGE_PREFIX}-expanded`, vaultPath),
      selected: scopedStorageKey(`${STORAGE_PREFIX}-selected`, vaultPath),
      filter: scopedStorageKey(`${STORAGE_PREFIX}-filter`, vaultPath),
      order: scopedStorageKey(`${STORAGE_PREFIX}-order`, vaultPath),
      icons: scopedStorageKey(`${STORAGE_PREFIX}-icons`, vaultPath),
    }),
    [vaultPath]
  )

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
    setExpandedNodes(toSafeExpanded(readStorageValue(storage.expanded, {})))
    setSelectedNodeId(readStorageValue(storage.selected, null))
    setFilterQuery(readStorageValue(storage.filter, ''))
    setFolderOrder(toSafeOrder(readStorageValue(storage.order, {})))
    setIconOverrides(toSafeIconOverrides(readStorageValue(storage.icons, {})))
  }, [storage.expanded, storage.filter, storage.icons, storage.order, storage.selected])

  useEffect(() => writeStorageValue(storage.expanded, expandedNodes), [expandedNodes, storage.expanded])
  useEffect(() => writeStorageValue(storage.selected, selectedNodeId), [selectedNodeId, storage.selected])
  useEffect(() => writeStorageValue(storage.filter, filterQuery), [filterQuery, storage.filter])
  useEffect(() => writeStorageValue(storage.order, folderOrder), [folderOrder, storage.order])
  useEffect(() => writeStorageValue(storage.icons, iconOverrides), [iconOverrides, storage.icons])

  useEffect(() => {
    const valid = new Set(groups.map((group) => normalizeGroupKey(group.key)))
    setFolderOrder((prev) => sanitizeOrder(prev, valid, fixedRootKeys))
  }, [fixedRootKeys, groups])

  useEffect(() => {
    const validFolders = new Set(groups.map((group) => normalizeGroupKey(group.key)))
    const validFiles = new Set(files.map((file) => normalizeFilePathKey(file.path)))
    setIconOverrides((prev) => pruneIconOverrides(prev, validFolders, validFiles))
  }, [files, groups])

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

  useEffect(() => {
    if (!activeFilePath) {
      return
    }
    const activeId = tree.fileNodeIdByPath.get(activeFilePath)
    if (!activeId) {
      return
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
  }, [activeFilePath, tree.fileNodeIdByPath, tree.parentById])

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

  const runCreateFile = useCallback(() => {
    const name = normalizeLabel(window.prompt('Name der neuen Datei', 'Neue Notiz') ?? '')
    if (!name) {
      return
    }
    void onCreateFile(resolveSelectedFolderKey(), name)
  }, [onCreateFile, resolveSelectedFolderKey])

  const runCreateFolder = useCallback(() => {
    const name = normalizeLabel(window.prompt('Name des neuen Ordners', 'Neuer Ordner') ?? '')
    if (!name) {
      return
    }
    void onCreateFolder(resolveSelectedFolderKey(), name)
  }, [onCreateFolder, resolveSelectedFolderKey])

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

  return (
    <div
      className="explorer-shell"
      tabIndex={0}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (isInputEventTarget(event.target) || tree.visibleNodes.length === 0) {
          return
        }
        const index = Math.max(0, tree.visibleNodes.findIndex((entry) => entry.node.selected))
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedNodeId(tree.visibleNodes[Math.min(tree.visibleNodes.length - 1, index + 1)].node.id)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedNodeId(tree.visibleNodes[Math.max(0, index - 1)].node.id)
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
          <button className="icon-button compact" onClick={runCreateFile} disabled={!vaultLoaded} title="Neue Datei">
            <LucideNamedIcon name="FilePlus" className="row-action-icon" size={14} />
          </button>
          <button className="icon-button compact" onClick={runCreateFolder} disabled={!vaultLoaded} title="Neuer Ordner">
            <LucideNamedIcon name="FolderPlus" className="row-action-icon" size={14} />
          </button>
        </div>
      </div>

      <section
        className="explorer-tree explorer-flat-tree"
        ref={treeRef}
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
          const folderCount = node.type === 'folder' ? (node.expanded ? countInfo?.direct ?? 0 : countInfo?.total ?? 0) : 0

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
                    void onPreviewFile(node.path, node.name)
                  }
                }}
                onDoubleClick={() => {
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
              <button className="context-menu-item" onClick={() => { const name = normalizeLabel(window.prompt('Name der neuen Datei', 'Neue Notiz') ?? ''); if (name) { void onCreateFile(normalizeGroupKey(contextNode.path), name) }; setContextMenu(null) }}>
                <LucideNamedIcon name="FilePlus" className="context-menu-icon" size={14} />
                <span>Neue Datei</span>
              </button>
            ) : null}
            {contextNode.type === 'folder' ? (
              <button className="context-menu-item" onClick={() => { const name = normalizeLabel(window.prompt('Name des neuen Ordners', 'Neuer Ordner') ?? ''); if (name) { void onCreateFolder(normalizeGroupKey(contextNode.path), name) }; setContextMenu(null) }}>
                <LucideNamedIcon name="FolderPlus" className="context-menu-icon" size={14} />
                <span>Neuer Ordner</span>
              </button>
            ) : null}
            <button className="context-menu-item" onClick={() => {
              if (contextNode.type === 'folder') {
                if (contextNode.canDelete === false) {
                  setContextMenu(null)
                  return
                }
                const name = normalizeLabel(window.prompt('Ordner umbenennen', contextNode.name) ?? '')
                if (name && name !== contextNode.name) {
                  void onRenameFolder(normalizeGroupKey(contextNode.path), name)
                }
              } else {
                const current = rowName(contextNode)
                const name = normalizeLabel(window.prompt('Datei umbenennen', current) ?? '')
                if (name && name !== current) {
                  void onRenameFile(contextNode.path, name)
                }
              }
              setContextMenu(null)
            }}>
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
            <button className="context-menu-item danger" disabled={contextNode.type === 'folder' && contextNode.canDelete === false} onClick={() => {
              if (contextNode.type === 'folder') {
                if (window.confirm(`Ordner "${contextNode.name}" wirklich loeschen?`)) {
                  void onDeleteFolder(normalizeGroupKey(contextNode.path))
                }
              } else if (window.confirm(`Datei "${contextNode.name}" wirklich loeschen?`)) {
                void onDeleteFile(contextNode.path)
              }
              setContextMenu(null)
            }}>
              <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
              <span>Loeschen</span>
            </button>
          </div>
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


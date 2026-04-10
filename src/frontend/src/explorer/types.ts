export type ExplorerNodeType = 'file' | 'folder'

export type ExplorerSortMode = 'manual' | 'name' | 'modified' | 'noteCount'
export type ExplorerSortDirection = 'asc' | 'desc'

export type ExplorerGitStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export type ExplorerSourceGroup = {
  key: string
  label: string
  path: string
  favorite: boolean
  canCreateNotes: boolean
  canCreateGroups?: boolean
  canDelete?: boolean
}

export type ExplorerSourceFile = {
  id: string
  title: string
  note_type: string
  updated_at: string
  path: string
}

export type ExplorerNode = {
  id: string
  name: string
  path: string
  type: ExplorerNodeType
  children: ExplorerNode[]
  expanded: boolean
  selected: boolean
  hidden?: boolean
  modified?: boolean
  gitStatus?: ExplorerGitStatus
  updatedAt?: string
  favorite?: boolean
  canCreateNotes?: boolean
  canCreateGroups?: boolean
  canDelete?: boolean
  parentId: string | null
}

export type ExplorerVisibleNode = {
  node: ExplorerNode
  depth: number
}

export type ExplorerOptions = {
  showHiddenFiles: boolean
  showFileExtensions: boolean
  sortMode: ExplorerSortMode
  sortDirection: ExplorerSortDirection
  foldersFirst: boolean
  showIcons: boolean
  compactMode: boolean
}

export type ExplorerIconOverrides = {
  folders: Record<string, string>
  files: Record<string, string>
}

export type ExplorerViewState = {
  expandedNodes: Record<string, boolean>
  selectedNodeId: string | null
  filterQuery: string
  folderOrder: Record<string, string[]>
  iconOverrides: ExplorerIconOverrides
}

export type ExplorerTreeBuildResult = {
  rootNodes: ExplorerNode[]
  visibleNodes: ExplorerVisibleNode[]
  nodeById: Map<string, ExplorerNode>
  parentById: Map<string, string | null>
  fileNodeIdByPath: Map<string, string>
}

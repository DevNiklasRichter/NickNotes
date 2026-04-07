export type ExplorerNodeType = 'file' | 'folder'

export type ExplorerSortMode = 'name' | 'modified' | 'type'

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
  foldersFirst: boolean
  showIcons: boolean
  compactMode: boolean
}

export type ExplorerTreeBuildResult = {
  rootNodes: ExplorerNode[]
  visibleNodes: ExplorerVisibleNode[]
  nodeById: Map<string, ExplorerNode>
  parentById: Map<string, string | null>
  fileNodeIdByPath: Map<string, string>
}

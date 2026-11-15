export type PaneId = 'left' | 'right'
export type LayoutMode = 'single' | 'split'

export type WorkspaceTabRef = {
  id: string
  noteId: string
}

export type WorkspaceNoteRef = {
  id: string
}

export type WorkspacePaneState = {
  tabIds: string[]
  activeTabId: string | null
}

export type WorkspaceState = {
  layoutMode: LayoutMode
  panes: Record<PaneId, WorkspacePaneState>
  tabsById: Record<string, WorkspaceTabRef>
  notesById: Record<string, WorkspaceNoteRef>
  lastFocusedPane: PaneId
  lastFocusedTabId: string | null
  splitRatio: number
}

export type WorkspaceAction =
  | {
      type: 'REGISTER_TABS'
      tabs: WorkspaceTabRef[]
    }
  | {
      type: 'OPEN_TAB'
      paneId: PaneId
      tabId: string
      activate?: boolean
    }
  | {
      type: 'ACTIVATE_TAB'
      paneId: PaneId
      tabId: string
    }
  | {
      type: 'CLOSE_TAB'
      tabId: string
    }
  | {
      type: 'MOVE_TAB_WITHIN_PANE'
      paneId: PaneId
      fromIndex: number
      toIndex: number
    }
  | {
      type: 'MOVE_TAB_TO_OTHER_PANE'
      fromPaneId: PaneId
      toPaneId: PaneId
      tabId: string
    }
  | {
      type: 'TOGGLE_SPLIT_MODE'
      enabled?: boolean
    }
  | {
      type: 'INITIALIZE_SPLIT_LAYOUT'
    }
  | {
      type: 'MERGE_PANES_TO_SINGLE'
    }
  | {
      type: 'SET_SPLIT_RATIO'
      splitRatio: number
    }
  | {
      type: 'SET_LAST_FOCUSED_PANE'
      paneId: PaneId
      tabId?: string | null
    }
  | {
      type: 'RESET'
    }

const MIN_SPLIT_RATIO = 0.15
const MAX_SPLIT_RATIO = 0.85

const EMPTY_PANE: WorkspacePaneState = {
  tabIds: [],
  activeTabId: null,
}

function clonePane(pane: WorkspacePaneState): WorkspacePaneState {
  return {
    tabIds: [...pane.tabIds],
    activeTabId: pane.activeTabId,
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function paneEquals(left: WorkspacePaneState, right: WorkspacePaneState): boolean {
  return left.activeTabId === right.activeTabId && arraysEqual(left.tabIds, right.tabIds)
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5
  }
  return Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, value))
}

function toUniqueTabIds(tabIds: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const tabId of tabIds) {
    if (!tabId || seen.has(tabId)) {
      continue
    }
    seen.add(tabId)
    next.push(tabId)
  }
  return next
}

function resolveFilteredActiveTabId(
  originalTabIds: string[],
  filteredTabIds: string[],
  previousActiveTabId: string | null
): string | null {
  if (filteredTabIds.length === 0) {
    return null
  }
  if (previousActiveTabId && filteredTabIds.includes(previousActiveTabId)) {
    return previousActiveTabId
  }
  if (!previousActiveTabId) {
    return filteredTabIds[filteredTabIds.length - 1] ?? null
  }

  const activeIndex = originalTabIds.indexOf(previousActiveTabId)
  if (activeIndex < 0) {
    return filteredTabIds[filteredTabIds.length - 1] ?? null
  }

  for (let offset = 1; offset <= originalTabIds.length; offset += 1) {
    const leftIndex = activeIndex - offset
    if (leftIndex >= 0) {
      const leftTabId = originalTabIds[leftIndex]
      if (filteredTabIds.includes(leftTabId)) {
        return leftTabId
      }
    }

    const rightIndex = activeIndex + offset
    if (rightIndex < originalTabIds.length) {
      const rightTabId = originalTabIds[rightIndex]
      if (filteredTabIds.includes(rightTabId)) {
        return rightTabId
      }
    }
  }

  return filteredTabIds[filteredTabIds.length - 1] ?? null
}

function moveItemWithin<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (items.length < 2 || fromIndex === toIndex) {
    return items
  }
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  if (typeof item === 'undefined') {
    return items
  }
  next.splice(toIndex, 0, item)
  return next
}

function removeTabFromPane(pane: WorkspacePaneState, removedTabId: string): WorkspacePaneState {
  if (!pane.tabIds.includes(removedTabId)) {
    return pane
  }
  const nextTabIds = pane.tabIds.filter((tabId) => tabId !== removedTabId)
  if (pane.activeTabId !== removedTabId) {
    return {
      tabIds: nextTabIds,
      activeTabId: pane.activeTabId,
    }
  }

  return {
    tabIds: nextTabIds,
    activeTabId: getNextActiveTabIdAfterRemoval(pane.tabIds, removedTabId),
  }
}

function mergePanesToSingle(state: WorkspaceState): WorkspaceState {
  const mergedTabIds = toUniqueTabIds([...state.panes.left.tabIds, ...state.panes.right.tabIds])
  const preferredActiveTabId =
    state.lastFocusedTabId && mergedTabIds.includes(state.lastFocusedTabId)
      ? state.lastFocusedTabId
      : state.panes.left.activeTabId && mergedTabIds.includes(state.panes.left.activeTabId)
        ? state.panes.left.activeTabId
        : mergedTabIds[0] ?? null

  return {
    ...state,
    layoutMode: 'single',
    panes: {
      left: {
        tabIds: mergedTabIds,
        activeTabId: preferredActiveTabId,
      },
      right: { ...EMPTY_PANE },
    },
    lastFocusedPane: 'left',
    lastFocusedTabId: preferredActiveTabId,
  }
}

function registerTabs(state: WorkspaceState, tabs: WorkspaceTabRef[]): WorkspaceState {
  const nextTabsById: Record<string, WorkspaceTabRef> = {}
  const nextNotesById: Record<string, WorkspaceNoteRef> = {}
  const orderedTabIds: string[] = []

  for (const tab of tabs) {
    if (!tab.id) {
      continue
    }
    const noteId = tab.noteId || tab.id
    nextTabsById[tab.id] = { id: tab.id, noteId }
    nextNotesById[noteId] = { id: noteId }
    orderedTabIds.push(tab.id)
  }

  const existingTabIds = new Set(orderedTabIds)
  const previousLeft = clonePane(state.panes.left)
  const previousRight = clonePane(state.panes.right)

  const nextLeftTabIds = toUniqueTabIds(previousLeft.tabIds.filter((tabId) => existingTabIds.has(tabId)))
  const leftAssigned = new Set(nextLeftTabIds)
  const nextRightTabIds = toUniqueTabIds(
    previousRight.tabIds.filter((tabId) => existingTabIds.has(tabId) && !leftAssigned.has(tabId))
  )

  const assigned = new Set([...nextLeftTabIds, ...nextRightTabIds])
  const unassigned = orderedTabIds.filter((tabId) => !assigned.has(tabId))
  const targetPaneId: PaneId = state.layoutMode === 'split' ? state.lastFocusedPane : 'left'
  const withUnassignedLeft = targetPaneId === 'left' ? [...nextLeftTabIds, ...unassigned] : nextLeftTabIds
  const withUnassignedRight = targetPaneId === 'right' ? [...nextRightTabIds, ...unassigned] : nextRightTabIds

  const nextLeft: WorkspacePaneState = {
    tabIds: withUnassignedLeft,
    activeTabId: resolveFilteredActiveTabId(previousLeft.tabIds, withUnassignedLeft, previousLeft.activeTabId),
  }
  const nextRight: WorkspacePaneState = {
    tabIds: withUnassignedRight,
    activeTabId: resolveFilteredActiveTabId(previousRight.tabIds, withUnassignedRight, previousRight.activeTabId),
  }

  if (!nextLeft.activeTabId && nextLeft.tabIds.length > 0) {
    nextLeft.activeTabId = nextLeft.tabIds[nextLeft.tabIds.length - 1] ?? null
  }
  if (!nextRight.activeTabId && nextRight.tabIds.length > 0) {
    nextRight.activeTabId = nextRight.tabIds[nextRight.tabIds.length - 1] ?? null
  }

  if (state.layoutMode === 'single') {
    nextRight.tabIds = []
    nextRight.activeTabId = null
  }

  const nextLastFocusedTabId =
    state.lastFocusedTabId && nextTabsById[state.lastFocusedTabId]
      ? state.lastFocusedTabId
      : state.lastFocusedPane === 'right'
        ? nextRight.activeTabId ?? nextLeft.activeTabId ?? null
        : nextLeft.activeTabId ?? nextRight.activeTabId ?? null

  const nextState: WorkspaceState = {
    ...state,
    tabsById: nextTabsById,
    notesById: nextNotesById,
    panes: {
      left: nextLeft,
      right: nextRight,
    },
    lastFocusedTabId: nextLastFocusedTabId,
  }

  if (
    paneEquals(state.panes.left, nextState.panes.left) &&
    paneEquals(state.panes.right, nextState.panes.right) &&
    state.lastFocusedTabId === nextState.lastFocusedTabId &&
    Object.keys(state.tabsById).length === Object.keys(nextState.tabsById).length &&
    Object.keys(state.notesById).length === Object.keys(nextState.notesById).length
  ) {
    let tabsEqual = true
    for (const tabId of Object.keys(nextState.tabsById)) {
      const currentTab = state.tabsById[tabId]
      const nextTab = nextState.tabsById[tabId]
      if (!currentTab || currentTab.noteId !== nextTab.noteId) {
        tabsEqual = false
        break
      }
    }
    if (tabsEqual) {
      return state
    }
  }

  return nextState
}

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    layoutMode: 'single',
    panes: {
      left: { ...EMPTY_PANE },
      right: { ...EMPTY_PANE },
    },
    tabsById: {},
    notesById: {},
    lastFocusedPane: 'left',
    lastFocusedTabId: null,
    splitRatio: 0.5,
  }
}

export function getNextActiveTabIdAfterRemoval(tabIds: string[], removedTabId: string): string | null {
  const removedIndex = tabIds.indexOf(removedTabId)
  if (removedIndex < 0) {
    return tabIds[tabIds.length - 1] ?? null
  }

  const leftCandidate = tabIds[removedIndex - 1]
  if (leftCandidate) {
    return leftCandidate
  }

  const rightCandidate = tabIds[removedIndex + 1]
  if (rightCandidate) {
    return rightCandidate
  }

  return null
}

export function findPaneByTabId(state: WorkspaceState, tabId: string): PaneId | null {
  if (!tabId) {
    return null
  }
  if (state.panes.left.tabIds.includes(tabId)) {
    return 'left'
  }
  if (state.panes.right.tabIds.includes(tabId)) {
    return 'right'
  }
  return null
}

export function findOpenTabByNoteId(state: WorkspaceState, noteId: string): WorkspaceTabRef | null {
  if (!noteId) {
    return null
  }
  for (const tab of Object.values(state.tabsById)) {
    if (tab.noteId === noteId) {
      return tab
    }
  }
  return null
}

export function getActiveTabIdForPane(state: WorkspaceState, paneId: PaneId): string | null {
  return state.panes[paneId].activeTabId
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'RESET':
      return createInitialWorkspaceState()

    case 'REGISTER_TABS':
      return registerTabs(state, action.tabs)

    case 'SET_SPLIT_RATIO': {
      const nextRatio = clampSplitRatio(action.splitRatio)
      if (nextRatio === state.splitRatio) {
        return state
      }
      return {
        ...state,
        splitRatio: nextRatio,
      }
    }

    case 'SET_LAST_FOCUSED_PANE': {
      const nextTabId = action.tabId === undefined ? state.lastFocusedTabId : action.tabId
      if (state.lastFocusedPane === action.paneId && state.lastFocusedTabId === nextTabId) {
        return state
      }
      return {
        ...state,
        lastFocusedPane: action.paneId,
        lastFocusedTabId: nextTabId,
      }
    }

    case 'ACTIVATE_TAB': {
      const pane = clonePane(state.panes[action.paneId])
      if (!pane.tabIds.includes(action.tabId)) {
        return state
      }
      if (pane.activeTabId === action.tabId && state.lastFocusedPane === action.paneId && state.lastFocusedTabId === action.tabId) {
        return state
      }

      pane.activeTabId = action.tabId
      return {
        ...state,
        panes: {
          ...state.panes,
          [action.paneId]: pane,
        },
        lastFocusedPane: action.paneId,
        lastFocusedTabId: action.tabId,
      }
    }

    case 'OPEN_TAB': {
      const targetPaneId: PaneId = state.layoutMode === 'single' ? 'left' : action.paneId
      const left = removeTabFromPane(clonePane(state.panes.left), action.tabId)
      const right = removeTabFromPane(clonePane(state.panes.right), action.tabId)
      const targetPane = targetPaneId === 'left' ? left : right
      targetPane.tabIds = [...targetPane.tabIds, action.tabId]
      if (action.activate !== false) {
        targetPane.activeTabId = action.tabId
      } else if (!targetPane.activeTabId) {
        targetPane.activeTabId = action.tabId
      }

      const nextState: WorkspaceState = {
        ...state,
        panes: {
          left: targetPaneId === 'left' ? targetPane : left,
          right: state.layoutMode === 'single' ? { ...EMPTY_PANE } : targetPaneId === 'right' ? targetPane : right,
        },
      }
      if (action.activate !== false) {
        nextState.lastFocusedPane = targetPaneId
        nextState.lastFocusedTabId = action.tabId
      }
      return nextState
    }

    case 'CLOSE_TAB': {
      const left = removeTabFromPane(clonePane(state.panes.left), action.tabId)
      const right = removeTabFromPane(clonePane(state.panes.right), action.tabId)

      const nextLastFocusedTabId =
        state.lastFocusedTabId === action.tabId
          ? state.lastFocusedPane === 'right'
            ? right.activeTabId ?? left.activeTabId ?? null
            : left.activeTabId ?? right.activeTabId ?? null
          : state.lastFocusedTabId

      return {
        ...state,
        panes: {
          left,
          right,
        },
        lastFocusedTabId: nextLastFocusedTabId,
      }
    }

    case 'MOVE_TAB_WITHIN_PANE': {
      const pane = clonePane(state.panes[action.paneId])
      const nextTabIds = moveItemWithin(pane.tabIds, action.fromIndex, action.toIndex)
      if (arraysEqual(pane.tabIds, nextTabIds)) {
        return state
      }
      pane.tabIds = nextTabIds
      return {
        ...state,
        panes: {
          ...state.panes,
          [action.paneId]: pane,
        },
      }
    }

    case 'MOVE_TAB_TO_OTHER_PANE': {
      if (action.fromPaneId === action.toPaneId) {
        return state
      }
      if (state.layoutMode !== 'split') {
        return state
      }
      const fromPane = clonePane(state.panes[action.fromPaneId])
      const toPane = clonePane(state.panes[action.toPaneId])
      if (!fromPane.tabIds.includes(action.tabId)) {
        return state
      }

      const nextFromPane = removeTabFromPane(fromPane, action.tabId)
      toPane.tabIds = [...toPane.tabIds.filter((tabId) => tabId !== action.tabId), action.tabId]
      toPane.activeTabId = action.tabId

      const movedState: WorkspaceState = {
        ...state,
        panes: {
          ...state.panes,
          [action.fromPaneId]: nextFromPane,
          [action.toPaneId]: toPane,
        },
        lastFocusedPane: action.toPaneId,
        lastFocusedTabId: action.tabId,
      }

      if (nextFromPane.tabIds.length === 0 && toPane.tabIds.length > 0) {
        return mergePanesToSingle(movedState)
      }

      return movedState
    }

    case 'INITIALIZE_SPLIT_LAYOUT': {
      if (state.layoutMode === 'split') {
        return state
      }
      return {
        ...state,
        layoutMode: 'split',
        panes: {
          left: clonePane(state.panes.left),
          right: { ...EMPTY_PANE },
        },
      }
    }

    case 'MERGE_PANES_TO_SINGLE':
      return mergePanesToSingle(state)

    case 'TOGGLE_SPLIT_MODE': {
      const nextEnabled = action.enabled ?? state.layoutMode !== 'split'
      if (nextEnabled && state.layoutMode === 'split') {
        return state
      }
      if (!nextEnabled && state.layoutMode === 'single') {
        return state
      }
      if (nextEnabled) {
        return {
          ...state,
          layoutMode: 'split',
          panes: {
            left: clonePane(state.panes.left),
            right: { ...EMPTY_PANE },
          },
        }
      }
      return mergePanesToSingle(state)
    }

    default:
      return state
  }
}

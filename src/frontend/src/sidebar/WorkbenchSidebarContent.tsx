import { useEffect, useMemo, useRef } from 'react'
import {MultiSelectPicker, type MultiSelectPickerOption} from '../ui/MultiSelectPicker'
import {ContextMenuItem} from '../ui/ContextMenu'
import {MenuButton} from '../ui/MenuButton'
import { ExplorerSidebar } from '../explorer/ExplorerSidebar'
import { TagSidebar } from '../explorer/TagSidebar'
import type { ExplorerOptions, ExplorerSourceFile, ExplorerSourceGroup, ExplorerViewState } from '../explorer/types'
import { GraphSidebarPanel } from '../graph/GraphSidebarPanel'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'
import {
  DEFAULT_FOCUS_DASHBOARD_FILTERS,
  DEFAULT_REVIEW_DASHBOARD_FILTERS,
  DEFAULT_TASK_DASHBOARD_FILTERS,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_OPTIONS,
  TASK_PRIORITY_COLORS,
  normalizeRelatedCandidate,
  normalizeTagCandidate,
  type NoteTab,
  type RecentNoteBase,
  type TaskDashboardFilters,
  type FocusDashboardFilters,
  type TaskDueBucket,
  type TodoDashboardFilters,
  type TodoPromotionFilterValue,
  type TodoStatusFilterValue,
  type TaskRow,
  type ReviewDashboardFilters,
} from '../app/AppShared'
import { filterTaskRows, toTaskDashboardTodayIso } from '../tasks/taskDashboardModel'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review' | 'graph'

type WorkbenchSidebarContentProps = {
  sidebarView: SidebarView
  noteBaseName: string
  vaultLoaded: boolean
  recentNoteBases: RecentNoteBase[]
  explorerWidth: number
  onExplorerWidthChange: (nextWidth: number) => void
  onRenameNoteBase: () => void
  onDeleteNoteBase: () => void
  onPickAndOpenVault: () => void
  onCreateVault: () => void
  onOpenRecentNoteBase: (path: string) => void
  onRenameRecentNoteBase: (path: string) => void
  onDeleteRecentNoteBase: (path: string) => void
  onRemoveRecentNoteBase: (path: string) => void
  onOpenNoteBaseInExplorer: (path: string) => void
  tasks: TaskRow[]
  taskFilters: TaskDashboardFilters
  todoFilters: TodoDashboardFilters
  focusFilters: FocusDashboardFilters
  onTaskFiltersChange: (next: TaskDashboardFilters) => void
  onTodoFiltersChange: (next: TodoDashboardFilters) => void
  onFocusFiltersChange: (next: FocusDashboardFilters) => void
  onRefreshTasks: () => void
  onRefreshTodos: () => void
  onRefreshFocusData: () => void
  onOpenTodoDashboard: () => void
  onOpenTaskDashboard: () => void
  activeTabKind: NoteTab['kind'] | null
  onOpenFocusDashboard: () => void
  onOpenReviewDashboard: () => void
  onOpenGraphDashboard: () => void
  reviewFilters: ReviewDashboardFilters
  onReviewFiltersChange: (next: ReviewDashboardFilters) => void
  onRefreshReview: () => void
  mergedTagGroups: TagGroupDefinition[]
  expandedFolders: Record<string, boolean>
  onToggleFolder: (folderKey: string) => void
  onCreateTagGroup: () => void
  onCreateTagInExistingGroup: (groupName: string | null) => void
  onRenameTagGroup: (groupName: string) => void
  onSetTagGroupColor: (groupName: string) => void
  onDeleteTagGroup: (groupName: string) => void
  onRenameTag: (groupName: string, tagName: string) => void
  onDeleteTag: (groupName: string, tagName: string) => void
  onOpenTagOverview?: (groupName: string, tagName: string) => void
  onOpenTagMatchWorkflow: () => void
  noteGroups: ExplorerSourceGroup[]
  explorerRows: ExplorerSourceFile[]
  activeNotePath: string
  dirtyFilePaths: Set<string>
  vaultPath: string
  onOpenNoteInTab: (path: string, title?: string) => Promise<void>
  onOpenNoteInCurrentEditor: (path: string, title?: string) => Promise<void>
  onOpenOrCreateTodayDaily: () => Promise<void>
  onCreateExplorerFile: (parentFolderKey: string, title: string) => Promise<void>
  onCreateExplorerTask: (parentFolderKey: string, title: string) => Promise<void>
  onCreateExplorerFolder: (parentFolderKey: string, name: string) => Promise<void>
  onRenameExplorerFile: (path: string, newName: string) => Promise<void>
  onRenameExplorerFolder: (groupKey: string, newName: string) => Promise<void>
  onDeleteExplorerFile: (path: string) => Promise<void>
  onDeleteExplorerFolder: (groupKey: string) => Promise<void>
  onMoveExplorerFile: (path: string, targetGroupKey: string) => Promise<void>
  onMoveExplorerFiles: (paths: string[], targetGroupKey: string) => Promise<void>
  onMoveExplorerFolder: (groupKey: string, targetParentKey: string) => Promise<void>
  onToggleFavoriteFolder: (groupKey: string) => Promise<void>
  explorerOptions: ExplorerOptions
  explorerContentMatchPathKeys: Set<string>
  onExplorerFilterQueryChange: (query: string) => void
  onExplorerOptionsChange: (next: ExplorerOptions) => void
  explorerRevealPath: string
  explorerRevealRequestId: number
  explorerViewSeed: ExplorerViewState | null
  explorerViewSeedId: number
  onExplorerViewStateChange: (next: ExplorerViewState) => void
  onRefreshExplorerSidebarData: () => void
}

type TodoTagOption = {
  value: string
  label: string
  groupId: string
  groupLabel: string
  color: string
}

type TodoDropdownKey = 'status' | 'tag_groups' | 'tags' | 'promotions'
type TaskDropdownKey = 'status' | 'priority' | 'due' | 'tag_groups' | 'tags' | 'related'

function noteBasePathKey(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase()
}

export function WorkbenchSidebarContent({
  sidebarView,
  noteBaseName,
  vaultLoaded,
  recentNoteBases,
  explorerWidth,
  onExplorerWidthChange,
  onRenameNoteBase,
  onDeleteNoteBase,
  onPickAndOpenVault,
  onCreateVault,
  onOpenRecentNoteBase,
  onRenameRecentNoteBase,
  onDeleteRecentNoteBase,
  onRemoveRecentNoteBase,
  onOpenNoteBaseInExplorer,
  tasks,
  taskFilters,
  todoFilters,
  focusFilters,
  onTaskFiltersChange,
  onTodoFiltersChange,
  onFocusFiltersChange,
  onRefreshTasks,
  onRefreshTodos,
  onRefreshFocusData,
  onOpenTodoDashboard,
  onOpenTaskDashboard,
  activeTabKind,
  onOpenFocusDashboard,
  onOpenReviewDashboard,
  onOpenGraphDashboard,
  reviewFilters,
  onReviewFiltersChange,
  onRefreshReview,
  mergedTagGroups,
  expandedFolders,
  onToggleFolder,
  onCreateTagGroup,
  onCreateTagInExistingGroup,
  onRenameTagGroup,
  onSetTagGroupColor,
  onDeleteTagGroup,
  onRenameTag,
  onDeleteTag,
  onOpenTagOverview,
  onOpenTagMatchWorkflow,
  noteGroups,
  explorerRows,
  activeNotePath,
  dirtyFilePaths,
  vaultPath,
  onOpenNoteInTab,
  onOpenNoteInCurrentEditor,
  onOpenOrCreateTodayDaily,
  onCreateExplorerFile,
  onCreateExplorerTask,
  onCreateExplorerFolder,
  onRenameExplorerFile,
  onRenameExplorerFolder,
  onDeleteExplorerFile,
  onDeleteExplorerFolder,
  onMoveExplorerFile,
  onMoveExplorerFiles,
  onMoveExplorerFolder,
  onToggleFavoriteFolder,
  explorerOptions,
  explorerContentMatchPathKeys,
  onExplorerFilterQueryChange,
  onExplorerOptionsChange,
  explorerRevealPath,
  explorerRevealRequestId,
  explorerViewSeed,
  explorerViewSeedId,
  onExplorerViewStateChange,
  onRefreshExplorerSidebarData,
}: WorkbenchSidebarContentProps) {
  const taskTodayIso = toTaskDashboardTodayIso()
  const taskFilterHits = useMemo(() => filterTaskRows(tasks, taskFilters, taskTodayIso), [taskFilters, taskTodayIso, tasks])
  const setTaskFilter = (patch: Partial<TaskDashboardFilters>) => {
    onTaskFiltersChange({ ...taskFilters, ...patch })
  }
  const setTodoFilter = (patch: Partial<TodoDashboardFilters>) => {
    onTodoFiltersChange({ ...todoFilters, ...patch })
  }
  const setFocusFilter = (patch: Partial<FocusDashboardFilters>) => {
    onFocusFiltersChange({ ...focusFilters, ...patch })
  }
  const noteBaseShellRef = useRef<HTMLDivElement | null>(null)
  const todoTagOptions = useMemo<TodoTagOption[]>(() => {
    const byKey = new Map<string, TodoTagOption>()
    for (const group of mergedTagGroups) {
      const groupId = group.id.trim().toLowerCase()
      const groupLabel = group.displayName || group.id
      for (const tag of group.tags) {
        const value = `${group.id}:${tag.id}`
        byKey.set(value.toLowerCase(), {
          value,
          label: tag.displayName || tag.id,
          groupId,
          groupLabel,
          color: group.color || '#94a3b8',
        })
      }
    }
    return Array.from(byKey.values()).sort((left, right) => {
      const byGroup = left.groupLabel.localeCompare(right.groupLabel, 'de', { sensitivity: 'base' })
      if (byGroup !== 0) {
        return byGroup
      }
      const byTag = left.label.localeCompare(right.label, 'de', { sensitivity: 'base' })
      if (byTag !== 0) {
        return byTag
      }
      return left.value.localeCompare(right.value, 'de', { sensitivity: 'base' })
    })
  }, [mergedTagGroups])

  const todoTagGroups = useMemo<MultiSelectPickerOption[]>(() => {
    const byId = new Map<string, MultiSelectPickerOption>()
    for (const group of mergedTagGroups) {
      const groupId = group.id.trim().toLowerCase()
      if (!groupId || byId.has(groupId)) {
        continue
      }
      byId.set(groupId, {
        value: groupId,
        label: group.displayName || group.id,
        color: group.color || '#94a3b8',
      })
    }
    return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }))
  }, [mergedTagGroups])

  const statusOptions = useMemo<MultiSelectPickerOption[]>(
    () => [
      { value: 'open', label: 'Offen' },
      { value: 'done', label: 'Erledigt' },
    ],
    []
  )

  const promotionOptions = useMemo<MultiSelectPickerOption[]>(
    () => [
      { value: 'promoted', label: 'Als Task übernommen' },
      { value: 'unpromoted', label: 'Nicht übernommen' },
    ],
    []
  )

  const taskStatusOptions = useMemo<MultiSelectPickerOption[]>(
    () =>
      TASK_STATUS_OPTIONS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: TASK_STATUS_COLORS[entry.value],
      })),
    []
  )

  const taskPriorityOptions = useMemo<MultiSelectPickerOption[]>(
    () =>
      TASK_PRIORITY_OPTIONS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: TASK_PRIORITY_COLORS[entry.value],
      })),
    []
  )

  const taskDueOptions = useMemo<MultiSelectPickerOption[]>(
    () => [
      { value: 'overdue', label: 'Überfällig' },
      { value: 'tomorrow', label: 'Morgen' },
      { value: 'this_week', label: 'Diese Woche' },
      { value: 'later', label: 'Später' },
      { value: 'none', label: 'Ohne Fälligkeit' },
    ],
    []
  )

  const taskTagGroups = useMemo<MultiSelectPickerOption[]>(() => {
    const byId = new Map<string, MultiSelectPickerOption>()
    for (const group of mergedTagGroups) {
      const groupId = group.id.trim().toLowerCase()
      if (!groupId || byId.has(groupId)) {
        continue
      }
      byId.set(groupId, {
        value: groupId,
        label: group.displayName || group.id,
        color: group.color || '#94a3b8',
      })
    }
    return Array.from(byId.values()).sort((left, right) => left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }))
  }, [mergedTagGroups])

  const taskTagOptions = useMemo<TodoTagOption[]>(() => {
    const byKey = new Map<string, TodoTagOption>()
    for (const group of mergedTagGroups) {
      const groupId = group.id.trim().toLowerCase()
      const groupLabel = group.displayName || group.id
      for (const tag of group.tags) {
        const value = `${group.id}:${tag.id}`
        byKey.set(value.toLowerCase(), {
          value,
          label: tag.displayName || tag.id,
          groupId,
          groupLabel,
          color: group.color || '#94a3b8',
        })
      }
    }
    for (const task of tasks) {
      for (const rawTag of task.tags || []) {
        const normalized = normalizeTagCandidate(rawTag)
        if (!normalized) {
          continue
        }
        if (byKey.has(normalized.toLowerCase())) {
          continue
        }
        const [groupId = 'topic', tagId = normalized] = normalized.split(':', 2)
        byKey.set(normalized.toLowerCase(), {
          value: normalized,
          label: tagId || normalized,
          groupId,
          groupLabel: groupId,
          color: '#94a3b8',
        })
      }
    }
    return Array.from(byKey.values()).sort((left, right) => {
      const byGroup = left.groupLabel.localeCompare(right.groupLabel, 'de', { sensitivity: 'base' })
      if (byGroup !== 0) {
        return byGroup
      }
      const byTag = left.label.localeCompare(right.label, 'de', { sensitivity: 'base' })
      if (byTag !== 0) {
        return byTag
      }
      return left.value.localeCompare(right.value, 'de', { sensitivity: 'base' })
    })
  }, [mergedTagGroups, tasks])

  const visibleTaskTagOptions = useMemo(() => {
    if (taskFilters.tagGroups.length === 0) {
      return taskTagOptions
    }
    const selectedGroups = new Set(taskFilters.tagGroups.map((value) => value.toLowerCase()))
    return taskTagOptions.filter((option) => selectedGroups.has(option.groupId.toLowerCase()))
  }, [taskFilters.tagGroups, taskTagOptions])

  const taskRelatedOptions = useMemo<MultiSelectPickerOption[]>(() => {
    const byValue = new Map<string, MultiSelectPickerOption>()
    for (const task of tasks) {
      for (const rawRelated of task.related || []) {
        const normalized = normalizeRelatedCandidate(rawRelated)
        if (!normalized || byValue.has(normalized.toLowerCase())) {
          continue
        }
        byValue.set(normalized.toLowerCase(), {
          value: normalized,
          label: normalized,
        })
      }
    }
    return Array.from(byValue.values()).sort((left, right) => left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }))
  }, [tasks])

  const visibleTodoTagOptions = useMemo(() => {
    if (todoFilters.tagGroups.length === 0) {
      return todoTagOptions
    }
    const selectedGroups = new Set(todoFilters.tagGroups.map((value) => value.toLowerCase()))
    return todoTagOptions.filter((option) => selectedGroups.has(option.groupId.toLowerCase()))
  }, [todoFilters.tagGroups, todoTagOptions])

  useEffect(() => {
    if (todoFilters.tags.length === 0) {
      return
    }
    const availableValues = new Set(visibleTodoTagOptions.map((option) => option.value))
    const nextTags = todoFilters.tags.filter((tag) => availableValues.has(tag))
    if (nextTags.length === todoFilters.tags.length) {
      return
    }
    onTodoFiltersChange({ ...todoFilters, tags: nextTags })
  }, [onTodoFiltersChange, todoFilters, visibleTodoTagOptions])

  useEffect(() => {
    const selectedStatusSet = new Set(statusOptions.map((option) => option.value))
    const nextStatuses = todoFilters.statuses.filter((value) => selectedStatusSet.has(value))
    if (nextStatuses.length !== todoFilters.statuses.length) {
      onTodoFiltersChange({ ...todoFilters, statuses: nextStatuses as TodoStatusFilterValue[] })
      return
    }

    const selectedPromotionSet = new Set(promotionOptions.map((option) => option.value))
    const nextPromotions = todoFilters.promotions.filter((value) => selectedPromotionSet.has(value))
    if (nextPromotions.length !== todoFilters.promotions.length) {
      onTodoFiltersChange({ ...todoFilters, promotions: nextPromotions as TodoPromotionFilterValue[] })
      return
    }

    const availableGroupSet = new Set(todoTagGroups.map((group) => group.value.toLowerCase()))
    const nextTagGroups = todoFilters.tagGroups.filter((value) => availableGroupSet.has(value.toLowerCase()))
    if (nextTagGroups.length !== todoFilters.tagGroups.length) {
      onTodoFiltersChange({ ...todoFilters, tagGroups: nextTagGroups })
    }
  }, [onTodoFiltersChange, promotionOptions, statusOptions, todoFilters, todoTagGroups])

  useEffect(() => {
    if (taskFilters.tags.length === 0) {
      return
    }
    const availableValues = new Set(visibleTaskTagOptions.map((option) => option.value.toLowerCase()))
    const nextTags = taskFilters.tags.filter((tag) => availableValues.has(normalizeTagCandidate(tag).toLowerCase()))
    if (nextTags.length === taskFilters.tags.length) {
      return
    }
    onTaskFiltersChange({ ...taskFilters, tags: nextTags })
  }, [onTaskFiltersChange, taskFilters, visibleTaskTagOptions])

  useEffect(() => {
    const availableStatusSet = new Set(taskStatusOptions.map((option) => option.value))
    const nextStatuses = taskFilters.statuses.filter((value) => availableStatusSet.has(value))
    if (nextStatuses.length !== taskFilters.statuses.length) {
      onTaskFiltersChange({ ...taskFilters, statuses: nextStatuses })
      return
    }

    const availablePrioritySet = new Set(taskPriorityOptions.map((option) => option.value))
    const nextPriorities = taskFilters.priorities.filter((value) => availablePrioritySet.has(value))
    if (nextPriorities.length !== taskFilters.priorities.length) {
      onTaskFiltersChange({ ...taskFilters, priorities: nextPriorities })
      return
    }

    const availableDueSet = new Set(taskDueOptions.map((option) => option.value))
    const nextDueBuckets = taskFilters.dueBuckets.filter((value) => availableDueSet.has(value))
    if (nextDueBuckets.length !== taskFilters.dueBuckets.length) {
      onTaskFiltersChange({ ...taskFilters, dueBuckets: nextDueBuckets as TaskDueBucket[] })
      return
    }

    const availableGroupSet = new Set(taskTagGroups.map((group) => group.value.toLowerCase()))
    const nextTagGroups = taskFilters.tagGroups.filter((value) => availableGroupSet.has(value.toLowerCase()))
    if (nextTagGroups.length !== taskFilters.tagGroups.length) {
      onTaskFiltersChange({ ...taskFilters, tagGroups: nextTagGroups })
      return
    }

    const availableTags = new Set(taskTagOptions.map((option) => option.value.toLowerCase()))
    const nextTags = taskFilters.tags.filter((value) => availableTags.has(normalizeTagCandidate(value).toLowerCase()))
    if (nextTags.length !== taskFilters.tags.length) {
      onTaskFiltersChange({ ...taskFilters, tags: nextTags })
      return
    }

    const availableRelated = new Set(taskRelatedOptions.map((option) => option.value.toLowerCase()))
    const nextRelated = taskFilters.related.filter((value) => availableRelated.has(normalizeRelatedCandidate(value).toLowerCase()))
    if (nextRelated.length !== taskFilters.related.length) {
      onTaskFiltersChange({ ...taskFilters, related: nextRelated })
    }
  }, [onTaskFiltersChange, taskDueOptions, taskFilters, taskPriorityOptions, taskRelatedOptions, taskStatusOptions, taskTagGroups, taskTagOptions])

  const toggleMultiSelection = (key: 'statuses' | 'tagGroups' | 'tags' | 'promotions', value: string) => {
    const current = [...(todoFilters[key] as string[])]
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
    if (key === 'statuses') {
      setTodoFilter({ statuses: next as TodoStatusFilterValue[] })
      return
    }
    if (key === 'promotions') {
      setTodoFilter({ promotions: next as TodoPromotionFilterValue[] })
      return
    }
    if (key === 'tagGroups') {
      setTodoFilter({ tagGroups: next })
      return
    }
    setTodoFilter({ tags: next })
  }

  const toggleTaskMultiSelection = (key: 'statuses' | 'priorities' | 'dueBuckets' | 'tagGroups' | 'tags' | 'related', value: string) => {
    const current = [...(taskFilters[key] as string[])]
    const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
    if (key === 'statuses') {
      setTaskFilter({ statuses: next as TaskDashboardFilters['statuses'] })
      return
    }
    if (key === 'priorities') {
      setTaskFilter({ priorities: next as TaskDashboardFilters['priorities'] })
      return
    }
    if (key === 'tagGroups') {
      setTaskFilter({ tagGroups: next })
      return
    }
    if (key === 'tags') {
      setTaskFilter({ tags: next })
      return
    }
    if (key === 'related') {
      setTaskFilter({ related: next })
      return
    }
    setTaskFilter({ dueBuckets: next as TaskDashboardFilters['dueBuckets'] })
  }

  const renderTodoMultiSelect = (key: TodoDropdownKey, selected: string[], options: MultiSelectPickerOption[], allLabel: string, onToggle: (value: string) => void) => {
    const names: Record<TodoDropdownKey, string> = {status: 'Status', tag_groups: 'Tag-Gruppe', tags: 'Tags', promotions: 'Als Task'}
    return <MultiSelectPicker key={`todo-${key}`} label={`To-dos: ${names[key]}`} selectedValues={selected} options={options} allLabel={allLabel} disabled={!vaultLoaded} onToggle={onToggle}/>
  }
  const renderTaskMultiSelect = (key: TaskDropdownKey, selected: string[], options: MultiSelectPickerOption[], allLabel: string, onToggle: (value: string) => void) => {
    const names: Record<TaskDropdownKey, string> = {status: 'Status', priority: 'Priorität', due: 'Fälligkeit', tag_groups: 'Tag-Gruppe', tags: 'Tags', related: 'Verknüpfungen'}
    return <MultiSelectPicker key={`task-${key}`} label={`Tasks: ${names[key]}`} selectedValues={selected} options={options} allLabel={allLabel} disabled={!vaultLoaded} onToggle={onToggle}/>
  }
  const resetTodoFilters = () => {
    onTodoFiltersChange({...todoFilters, query: '', statuses: [], tagGroups: [], tags: [], promotions: []})
  }
  const resetTaskFilters = () => {
    onTaskFiltersChange({...taskFilters, query: '', statuses: [...DEFAULT_TASK_DASHBOARD_FILTERS.statuses], priorities: [...DEFAULT_TASK_DASHBOARD_FILTERS.priorities], dueBuckets: [...DEFAULT_TASK_DASHBOARD_FILTERS.dueBuckets], tagGroups: [], tags: [], related: []})
  }

  const focusSectionOptions: Array<{ value: 'tasks' | 'todos' | 'notes'; label: string }> = [
    { value: 'tasks', label: 'Tasks' },
    { value: 'todos', label: 'Todos' },
    { value: 'notes', label: 'Notizen' },
  ]

  const toggleFocusSection = (section: 'tasks' | 'todos' | 'notes') => {
    const selected = new Set(focusFilters.sections)
    if (selected.has(section)) {
      selected.delete(section)
    } else {
      selected.add(section)
    }
    setFocusFilter({ sections: Array.from(selected) })
  }

  const focusSectionSummary = focusFilters.sections.length === 0 ? 'Alle Bereiche' : `${focusFilters.sections.length} ausgewählt`

  const resetFocusFilters = () => {
    onFocusFiltersChange({ ...DEFAULT_FOCUS_DASHBOARD_FILTERS })
  }

  const resetReviewFilters = () => {
    onReviewFiltersChange({ ...DEFAULT_REVIEW_DASHBOARD_FILTERS })
  }
  const currentNoteBasePathKey = noteBasePathKey(vaultPath)
  const recentNoteBasesForList = recentNoteBases.filter((recent) => noteBasePathKey(recent.path) !== currentNoteBasePathKey)

  const renderNoteBaseMenu = (path: string, name: string, variant: 'active' | 'recent') => {
    const hasPath = Boolean(path.trim())
    return (
      <div className="notebase-menu-anchor">
        <MenuButton key={path} label={`Aktionen für NoteBase ${name || 'Keine NoteBase'}`} heading={name}
          className="icon-button compact muted notebase-menu-button" disabled={!hasPath} fallbackRef={noteBaseShellRef}
          icon={<LucideNamedIcon name="MoreHorizontal" size={14} />}>
            {variant === 'recent' ? (
              <ContextMenuItem onClick={() => onOpenRecentNoteBase(path)}>
                <LucideNamedIcon name="FolderOpen" className="context-menu-icon" size={14} />
                <span>NoteBase öffnen</span>
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => (variant === 'active' ? onRenameNoteBase() : onRenameRecentNoteBase(path))}>
              <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
              <span>NoteBase umbenennen</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onOpenNoteBaseInExplorer(path)}>
              <LucideNamedIcon name="ExternalLink" className="context-menu-icon" size={14} />
              <span>Im Windows Explorer öffnen</span>
            </ContextMenuItem>
            {variant === 'recent' ? (
              <ContextMenuItem onClick={() => onRemoveRecentNoteBase(path)}>
                <LucideNamedIcon name="ListX" className="context-menu-icon" size={14} />
                <span>Aus Liste entfernen</span>
              </ContextMenuItem>
            ) : null}
            <div role="separator" />
            <ContextMenuItem className="danger" onClick={() => (variant === 'active' ? onDeleteNoteBase() : onDeleteRecentNoteBase(path))}>
              <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
              <span>NoteBase löschen</span>
            </ContextMenuItem>
        </MenuButton>
      </div>
    )
  }

  if (sidebarView === 'vault') {
    return (
      <div className="explorer-shell notebase-sidebar-shell" ref={noteBaseShellRef} tabIndex={-1}>
        <header className="explorer-toolbar notebase-sidebar-toolbar">
          <div className="explorer-toolbar-top">
            <div className="explorer-toolbar-left" />
            <h3>NoteBase</h3>
            <div className="explorer-toolbar-right">
              <button className="icon-button compact" onClick={onPickAndOpenVault} aria-label="NoteBase laden" data-tooltip="NoteBase laden">
                <LucideNamedIcon name="FolderOpen" size={14} />
              </button>
              <button className="icon-button compact" onClick={onCreateVault} aria-label="NoteBase erstellen" data-tooltip="NoteBase erstellen">
                <LucideNamedIcon name="FolderPlus" size={14} />
              </button>
            </div>
          </div>
        </header>

        <div className="notebase-sidebar-body">
          <section className="notebase-section">
            <p className="muted-label">Aktive NoteBase</p>
            <div className="notebase-list">
              <div className="notebase-row active" data-tooltip={vaultPath || 'Keine NoteBase geladen'}>
                <div className="notebase-row-main">
                  <strong>{noteBaseName || 'Keine NoteBase'}</strong>
                  <span>{vaultPath || 'Keine NoteBase geladen'}</span>
                </div>
                {renderNoteBaseMenu(vaultLoaded ? vaultPath : '', noteBaseName, 'active')}
              </div>
            </div>
          </section>

          <section className="notebase-section recent-notebases">
            <p className="muted-label">Zuletzt geöffnet</p>
            {recentNoteBasesForList.length > 0 ? (
              <div className="notebase-list recent-notebase-list">
                {recentNoteBasesForList.map((recent) => (
                  <div className="notebase-row" key={recent.path} data-tooltip={recent.path}>
                    <div className="notebase-row-main">
                      <strong>{recent.name}</strong>
                      <span>{recent.path}</span>
                    </div>
                    {renderNoteBaseMenu(recent.path, recent.name, 'recent')}
                  </div>
                ))}
              </div>
            ) : (
              <p className="recent-notebases-empty">Noch keine NoteBase-Historie.</p>
            )}
          </section>
        </div>
      </div>
    )
  }

  if (sidebarView === 'todos') {
    return (
      <div className="explorer-shell todo-explorer-shell">
        <header className="explorer-toolbar todo-sidebar-toolbar">
          <div className="explorer-toolbar-top">
            <div className="explorer-toolbar-left">
              <div className="explorer-sort-anchor">
                <button className="icon-button compact" disabled={!vaultLoaded} aria-label="Filteroptionen" data-tooltip="Filteroptionen">
                  <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
                </button>
              </div>
            </div>
            <h3>To-dos</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshTodos()
                }}
                disabled={!vaultLoaded}
                aria-label="Todos aktualisieren" data-tooltip="Todos aktualisieren"
              >
                <LucideNamedIcon name="RefreshCw" size={14} />
              </button>
            </div>
          </div>

          <div className="explorer-toolbar-search">
            <div className="explorer-search-input-wrap">
              <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
              <input
                className="explorer-search-input"
                value={todoFilters.query}
                onChange={(event) => setTodoFilter({ query: event.target.value })}
                placeholder="Suchen"
                aria-label="Todos durchsuchen" data-tooltip="Todos durchsuchen"
              />
              {todoFilters.query ? (
                <button
                  type="button"
                  className="explorer-search-clear"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setTodoFilter({ query: '' })
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

        {activeTabKind === 'todo_dashboard' ? null : (
          <button className="todo-open-dashboard-button" onClick={onOpenTodoDashboard} disabled={!vaultLoaded}>
            Ansicht öffnen
          </button>
        )}

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetTodoFilters}
              data-tooltip="Alle Filter zurücksetzen"
              aria-label="Alle Filter zurücksetzen"
            >
              <LucideNamedIcon name="FilterX" size={13} />
            </button>
          </div>
          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Status</span>
              {renderTodoMultiSelect('status', todoFilters.statuses, statusOptions, 'Alle', (value) =>
                toggleMultiSelection('statuses', value)
              )}
            </div>

            <div className="todo-filter-divider" />

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Tag-Gruppe</span>
              {renderTodoMultiSelect('tag_groups', todoFilters.tagGroups, todoTagGroups, 'Alle', (value) =>
                toggleMultiSelection('tagGroups', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Tag</span>
              {renderTodoMultiSelect(
                'tags',
                todoFilters.tags,
                visibleTodoTagOptions.map((option) => ({
                  value: option.value,
                  label:
                    todoFilters.tagGroups.length === 0 && option.groupLabel
                      ? `${option.groupLabel} / ${option.label}`
                      : option.label,
                  color: option.color,
                })),
                'Alle',
                (value) => toggleMultiSelection('tags', value)
              )}
            </div>

            <div className="todo-filter-divider" />

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Als Task</span>
              {renderTodoMultiSelect(
                'promotions',
                todoFilters.promotions,
                promotionOptions,
                'Alle',
                (value) => toggleMultiSelection('promotions', value)
              )}
            </div>
          </div>
        </section>

        <section className="todo-sidebar-section todo-sidebar-grouping-section">
          <h4>Gruppierung</h4>
          <label className="todo-grouping-select">
            <select
              value={todoFilters.grouping}
              onChange={(event) =>
                setTodoFilter({ grouping: event.target.value as 'note' | 'tag' | 'tag_group' | 'updated_at' })
              }
            >
              <option value="tag_group">Tag-Gruppe</option>
              <option value="tag">Tag</option>
              <option value="updated_at">Datum</option>
              <option value="note">Notiz</option>
            </select>
          </label>
        </section>
      </div>
    )
  }

  if (sidebarView === 'tasks') {
    return (
      <div className="explorer-shell todo-explorer-shell">
        <header className="explorer-toolbar todo-sidebar-toolbar">
          <div className="explorer-toolbar-top">
            <div className="explorer-toolbar-left">
              <div className="explorer-sort-anchor">
                <button className="icon-button compact" disabled={!vaultLoaded} aria-label="Filteroptionen" data-tooltip="Filteroptionen">
                  <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
                </button>
              </div>
            </div>
            <h3>Tasks</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshTasks()
                }}
                disabled={!vaultLoaded}
                aria-label="Tasks aktualisieren" data-tooltip="Tasks aktualisieren"
              >
                <LucideNamedIcon name="RefreshCw" size={14} />
              </button>
            </div>
          </div>

          <div className="explorer-toolbar-search">
            <div className="explorer-search-input-wrap">
              <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
              <input
                className="explorer-search-input"
                value={taskFilters.query}
                onChange={(event) => setTaskFilter({ query: event.target.value })}
                placeholder="Suchen"
                aria-label="Tasks durchsuchen" data-tooltip="Tasks durchsuchen"
              />
              {taskFilters.query ? (
                <button
                  type="button"
                  className="explorer-search-clear"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setTaskFilter({ query: '' })
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

        {activeTabKind === 'task_dashboard' ? null : (
          <button className="todo-open-dashboard-button" onClick={onOpenTaskDashboard} disabled={!vaultLoaded}>
            Ansicht öffnen
          </button>
        )}

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetTaskFilters}
              data-tooltip="Alle Filter zurücksetzen"
              aria-label="Alle Filter zurücksetzen"
            >
              <LucideNamedIcon name="FilterX" size={13} />
            </button>
          </div>

          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Status</span>
              {renderTaskMultiSelect('status', taskFilters.statuses, taskStatusOptions, 'Alle', (value) =>
                toggleTaskMultiSelection('statuses', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Priorität</span>
              {renderTaskMultiSelect('priority', taskFilters.priorities, taskPriorityOptions, 'Alle', (value) =>
                toggleTaskMultiSelection('priorities', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Fälligkeit</span>
              {renderTaskMultiSelect('due', taskFilters.dueBuckets, taskDueOptions, 'Alle', (value) =>
                toggleTaskMultiSelection('dueBuckets', value)
              )}
            </div>

            <div className="todo-filter-divider" />

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Tag-Gruppe</span>
              {renderTaskMultiSelect('tag_groups', taskFilters.tagGroups, taskTagGroups, 'Alle', (value) =>
                toggleTaskMultiSelection('tagGroups', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Tags</span>
              {renderTaskMultiSelect(
                'tags',
                taskFilters.tags,
                visibleTaskTagOptions.map((option) => ({
                  value: option.value,
                  label:
                    taskFilters.tagGroups.length === 0 && option.groupLabel
                      ? `${option.groupLabel} / ${option.label}`
                      : option.label,
                  color: option.color,
                })),
                'Alle',
                (value) => toggleTaskMultiSelection('tags', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Verknüpft</span>
              {renderTaskMultiSelect('related', taskFilters.related, taskRelatedOptions, 'Alle', (value) =>
                toggleTaskMultiSelection('related', value)
              )}
            </div>
          </div>
          <p className="task-sidebar-summary">Treffer: {taskFilterHits.length}</p>
        </section>

        <section className="todo-sidebar-section todo-sidebar-grouping-section">
          <h4>Gruppierung</h4>
          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Gruppieren nach</span>
              <label className="todo-grouping-select">
                <select
                  value={taskFilters.grouping}
                  onChange={(event) => setTaskFilter({ grouping: event.target.value as TaskDashboardFilters['grouping'] })}
                >
                  <option value="status">Status</option>
                  <option value="priority">Priorität</option>
                  <option value="due_date">Fälligkeit</option>
                </select>
              </label>
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Darstellung</span>
              <label className="todo-grouping-select">
                <select
                  value={taskFilters.layout}
                  onChange={(event) => setTaskFilter({ layout: event.target.value as TaskDashboardFilters['layout'] })}
                >
                  <option value="board">Spalten</option>
                  <option value="list">Liste</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (sidebarView === 'focus') {
    return (
      <div className="explorer-shell todo-explorer-shell">
        <header className="explorer-toolbar todo-sidebar-toolbar">
          <div className="explorer-toolbar-top">
            <div className="explorer-toolbar-left">
              <div className="explorer-sort-anchor">
                <button className="icon-button compact" disabled={!vaultLoaded} aria-label="Filteroptionen" data-tooltip="Filteroptionen">
                  <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
                </button>
              </div>
            </div>
            <h3>Fokus</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshFocusData()
                }}
                disabled={!vaultLoaded}
                aria-label="Focus-Daten aktualisieren" data-tooltip="Focus-Daten aktualisieren"
              >
                <LucideNamedIcon name="RefreshCw" size={14} />
              </button>
            </div>
          </div>

          <div className="explorer-toolbar-search">
            <div className="explorer-search-input-wrap">
              <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
              <input
                className="explorer-search-input"
                value={focusFilters.query}
                onChange={(event) => setFocusFilter({ query: event.target.value })}
                placeholder="Suchen"
                aria-label="Focus durchsuchen" data-tooltip="Focus durchsuchen"
              />
              {focusFilters.query ? (
                <button
                  type="button"
                  className="explorer-search-clear"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setFocusFilter({ query: '' })
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

        {activeTabKind === 'focus_dashboard' ? null : (
          <button className="todo-open-dashboard-button" onClick={onOpenFocusDashboard} disabled={!vaultLoaded}>
            Ansicht öffnen
          </button>
        )}

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetFocusFilters}
              data-tooltip="Focus-Filter zurücksetzen"
              aria-label="Focus-Filter zurücksetzen"
            >
              <LucideNamedIcon name="FilterX" size={13} />
            </button>
          </div>
          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Bereiche</span>
              <div className="focus-sidebar-check-grid">
                {focusSectionOptions.map((option) => {
                  const checked = focusFilters.sections.includes(option.value)
                  return (
                    <label key={option.value} className="focus-sidebar-check-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          toggleFocusSection(option.value)
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
                <span className="focus-sidebar-check-summary">{focusSectionSummary}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="todo-sidebar-section todo-sidebar-grouping-section">
          <h4>Ausrichtung</h4>
          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Modus</span>
              <label className="todo-grouping-select">
                <select value={focusFilters.mode} onChange={(event) => setFocusFilter({ mode: event.target.value as FocusDashboardFilters['mode'] })}>
                  <option value="execution">Execution</option>
                  <option value="planning">Planning</option>
                  <option value="rescue">Rescue</option>
                  <option value="context">Context</option>
                </select>
              </label>
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Zeitraum</span>
              <label className="todo-grouping-select">
                <select value={focusFilters.scope} onChange={(event) => setFocusFilter({ scope: event.target.value as FocusDashboardFilters['scope'] })}>
                  <option value="overdue">Überfällig</option>
                  <option value="today">Heute</option>
                  <option value="tomorrow">Morgen</option>
                  <option value="week">Woche</option>
                  <option value="next7">7 Tage</option>
                  <option value="all">Alles</option>
                </select>
              </label>
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Fokuspunkte</span>
              <label className="todo-grouping-select">
                <select
                  value={String(focusFilters.maxItems)}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10)
                    if (Number.isFinite(parsed)) {
                      setFocusFilter({ maxItems: parsed })
                    }
                  }}
                >
                  <option value="8">8</option>
                  <option value="12">12</option>
                  <option value="16">16</option>
                  <option value="20">20</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (sidebarView === 'review') {
    return (
      <div className="explorer-shell todo-explorer-shell">
        <header className="explorer-toolbar todo-sidebar-toolbar">
          <div className="explorer-toolbar-top">
            <h3>Rückblick</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshReview()
                }}
                disabled={!vaultLoaded}
                aria-label="Rückblick aktualisieren" data-tooltip="Rückblick aktualisieren"
              >
                <LucideNamedIcon name="RefreshCw" size={14} />
              </button>
            </div>
          </div>
        </header>

        {activeTabKind === 'review_dashboard' ? null : (
          <button className="todo-open-dashboard-button" onClick={onOpenReviewDashboard} disabled={!vaultLoaded}>
            Ansicht öffnen
          </button>
        )}

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetReviewFilters}
              data-tooltip="Rückblick-Filter zurücksetzen"
              aria-label="Rückblick-Filter zurücksetzen"
            >
              <LucideNamedIcon name="FilterX" size={13} />
            </button>
          </div>
          <div className="todo-filter-rows">
            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Zeitraum</span>
              <label className="todo-grouping-select">
                <select
                  value={reviewFilters.window}
                  onChange={(event) =>
                    onReviewFiltersChange({
                      ...reviewFilters,
                      window: event.target.value as ReviewDashboardFilters['window'],
                    })
                  }
                >
                  <option value="7d">7 Tage</option>
                  <option value="30d">30 Tage</option>
                  <option value="90d">90 Tage</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>
    )
  }

  if (sidebarView === 'graph') {
    return <GraphSidebarPanel vaultLoaded={vaultLoaded} onOpenGraphDashboard={onOpenGraphDashboard} />
  }

  if (sidebarView === 'tags') {
    return (
      <TagSidebar
        vaultLoaded={vaultLoaded}
        width={explorerWidth}
        onWidthChange={onExplorerWidthChange}
        groups={mergedTagGroups}
        expandedGroups={expandedFolders}
        onToggleGroup={onToggleFolder}
        onCreateGroup={onCreateTagGroup}
        onCreateTag={onCreateTagInExistingGroup}
        onRenameGroup={onRenameTagGroup}
        onSetGroupColor={onSetTagGroupColor}
        onDeleteGroup={onDeleteTagGroup}
        onRenameTag={onRenameTag}
        onDeleteTag={onDeleteTag}
        onOpenTagOverview={onOpenTagOverview}
        onOpenTagMatchWorkflow={onOpenTagMatchWorkflow}
      />
    )
  }

  return (
    <ExplorerSidebar
      vaultLoaded={vaultLoaded}
      vaultPath={vaultPath}
      groups={noteGroups}
      files={explorerRows}
      tasks={tasks}
      activeFilePath={activeNotePath}
      dirtyFilePaths={dirtyFilePaths}
      width={explorerWidth}
      onWidthChange={onExplorerWidthChange}
      onOpenFile={onOpenNoteInTab}
      onPreviewFile={onOpenNoteInCurrentEditor}
      onOpenOrCreateTodayDaily={onOpenOrCreateTodayDaily}
      onCreateFile={onCreateExplorerFile}
      onCreateTask={onCreateExplorerTask}
      onCreateFolder={onCreateExplorerFolder}
      onRenameFile={onRenameExplorerFile}
      onRenameFolder={onRenameExplorerFolder}
      onDeleteFile={onDeleteExplorerFile}
      onDeleteFolder={onDeleteExplorerFolder}
      onMoveFile={onMoveExplorerFile}
      onMoveFiles={onMoveExplorerFiles}
      onMoveFolder={onMoveExplorerFolder}
      onToggleFavoriteFolder={onToggleFavoriteFolder}
      options={explorerOptions}
      contentMatchFilePathKeys={explorerContentMatchPathKeys}
      onFilterQueryChange={onExplorerFilterQueryChange}
      onOptionsChange={onExplorerOptionsChange}
      revealFilePath={explorerRevealPath}
      revealRequestId={explorerRevealRequestId}
      viewStateSeed={explorerViewSeed}
      viewStateSeedId={explorerViewSeedId}
      onViewStateChange={onExplorerViewStateChange}
      onRefresh={onRefreshExplorerSidebarData}
    />
  )
}

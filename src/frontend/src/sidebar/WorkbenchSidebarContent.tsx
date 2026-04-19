import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ExplorerSidebar } from '../explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from '../explorer/TagSidebarV2'
import type { ExplorerOptions, ExplorerSourceFile, ExplorerSourceGroup, ExplorerViewState } from '../explorer/types'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'
import {
  DEFAULT_FOCUS_DASHBOARD_FILTERS,
  DEFAULT_TASK_DASHBOARD_FILTERS,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_OPTIONS,
  TASK_PRIORITY_COLORS,
  normalizeRelatedCandidate,
  normalizeTagCandidate,
  type TaskDashboardFilters,
  type FocusDashboardFilters,
  type TaskDueBucket,
  type TodoDashboardFilters,
  type TodoPromotionFilterValue,
  type TodoStatusFilterValue,
  type TaskRow,
  type ReviewDaily,
  type ReviewWeekly,
} from '../app/AppShared'
import { filterTaskRows, toTaskDashboardTodayIso } from '../tasks/taskDashboardModel'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review'

type WorkbenchSidebarContentProps = {
  sidebarView: SidebarView
  noteBaseName: string
  vaultLoaded: boolean
  explorerWidth: number
  onExplorerWidthChange: (nextWidth: number) => void
  onRenameNoteBase: () => void
  onDeleteNoteBase: () => void
  onPickAndOpenVault: () => void
  onCreateVault: () => void
  onMigrateExistingNotesToTemplate: () => void
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
  onOpenFocusDashboard: () => void
  daily: ReviewDaily | null
  weekly: ReviewWeekly | null
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
  noteGroups: ExplorerSourceGroup[]
  explorerRows: ExplorerSourceFile[]
  activeNotePath: string
  dirtyFilePaths: Set<string>
  vaultPath: string
  onOpenNoteInTab: (path: string, title?: string) => Promise<void>
  onOpenNoteInCurrentEditor: (path: string, title?: string) => Promise<void>
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

type TodoMultiSelectOption = {
  value: string
  label: string
  color?: string
}

type TodoDropdownKey = 'status' | 'tag_groups' | 'tags' | 'promotions'
type TaskDropdownKey = 'status' | 'priority' | 'due' | 'tag_groups' | 'tags' | 'related'

function summarizeTodoSelection(selectedValues: string[], allOptions: TodoMultiSelectOption[], fallbackAllLabel: string): string {
  if (allOptions.length === 0) {
    return 'Keine Optionen'
  }
  if (selectedValues.length === 0) {
    return fallbackAllLabel
  }
  if (selectedValues.length === allOptions.length) {
    return fallbackAllLabel
  }
  if (selectedValues.length === 1) {
    const selected = allOptions.find((option) => option.value === selectedValues[0])
    return selected?.label || selectedValues[0]
  }
  return `${selectedValues.length} ausgewaehlt`
}

export function WorkbenchSidebarContent({
  sidebarView,
  noteBaseName,
  vaultLoaded,
  explorerWidth,
  onExplorerWidthChange,
  onRenameNoteBase,
  onDeleteNoteBase,
  onPickAndOpenVault,
  onCreateVault,
  onMigrateExistingNotesToTemplate,
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
  onOpenFocusDashboard,
  daily,
  weekly,
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
  noteGroups,
  explorerRows,
  activeNotePath,
  dirtyFilePaths,
  vaultPath,
  onOpenNoteInTab,
  onOpenNoteInCurrentEditor,
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
  const [taskOpenDropdown, setTaskOpenDropdown] = useState<TaskDropdownKey | null>(null)
  const [taskDropdownQueries, setTaskDropdownQueries] = useState<Record<TaskDropdownKey, string>>({
    status: '',
    priority: '',
    due: '',
    tag_groups: '',
    tags: '',
    related: '',
  })
  const [taskDropdownActiveIndex, setTaskDropdownActiveIndex] = useState<Record<TaskDropdownKey, number>>({
    status: 0,
    priority: 0,
    due: 0,
    tag_groups: 0,
    tags: 0,
    related: 0,
  })
  const [todoOpenDropdown, setTodoOpenDropdown] = useState<TodoDropdownKey | null>(null)
  const [todoDropdownQueries, setTodoDropdownQueries] = useState<Record<TodoDropdownKey, string>>({
    status: '',
    tag_groups: '',
    tags: '',
    promotions: '',
  })
  const [todoDropdownActiveIndex, setTodoDropdownActiveIndex] = useState<Record<TodoDropdownKey, number>>({
    status: 0,
    tag_groups: 0,
    tags: 0,
    promotions: 0,
  })

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

  const todoTagGroups = useMemo<TodoMultiSelectOption[]>(() => {
    const byId = new Map<string, TodoMultiSelectOption>()
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

  const statusOptions = useMemo<TodoMultiSelectOption[]>(
    () => [
      { value: 'open', label: 'Open' },
      { value: 'done', label: 'Done' },
    ],
    []
  )

  const promotionOptions = useMemo<TodoMultiSelectOption[]>(
    () => [
      { value: 'promoted', label: 'Promoted' },
      { value: 'unpromoted', label: 'Unpromoted' },
    ],
    []
  )

  const taskStatusOptions = useMemo<TodoMultiSelectOption[]>(
    () =>
      TASK_STATUS_OPTIONS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: TASK_STATUS_COLORS[entry.value],
      })),
    []
  )

  const taskPriorityOptions = useMemo<TodoMultiSelectOption[]>(
    () =>
      TASK_PRIORITY_OPTIONS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        color: TASK_PRIORITY_COLORS[entry.value],
      })),
    []
  )

  const taskDueOptions = useMemo<TodoMultiSelectOption[]>(
    () => [
      { value: 'overdue', label: 'Ueberfaellig' },
      { value: 'tomorrow', label: 'Morgen' },
      { value: 'this_week', label: 'Diese Woche' },
      { value: 'later', label: 'Spaeter' },
      { value: 'none', label: 'Ohne Faelligkeit' },
    ],
    []
  )

  const taskTagGroups = useMemo<TodoMultiSelectOption[]>(() => {
    const byId = new Map<string, TodoMultiSelectOption>()
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

  const taskRelatedOptions = useMemo<TodoMultiSelectOption[]>(() => {
    const byValue = new Map<string, TodoMultiSelectOption>()
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

  useEffect(() => {
    if (!taskOpenDropdown) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.todo-multiselect')) {
        return
      }
      setTaskOpenDropdown(null)
      setTaskDropdownQueries({
        status: '',
        priority: '',
        due: '',
        tag_groups: '',
        tags: '',
        related: '',
      })
      setTaskDropdownActiveIndex({
        status: 0,
        priority: 0,
        due: 0,
        tag_groups: 0,
        tags: 0,
        related: 0,
      })
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [taskOpenDropdown])

  useEffect(() => {
    if (!taskOpenDropdown) {
      return
    }
    setTaskDropdownActiveIndex((prev) => ({ ...prev, [taskOpenDropdown]: 0 }))
  }, [taskOpenDropdown])

  useEffect(() => {
    if (!taskOpenDropdown) {
      return
    }
    const menu = document.querySelector<HTMLElement>(`.todo-multiselect-menu[data-dropdown-key="task_${taskOpenDropdown}"]`)
    const active = menu?.querySelector<HTMLElement>('.todo-multiselect-option.is-active')
    if (!active) {
      return
    }
    active.scrollIntoView({ block: 'nearest' })
  }, [taskDropdownActiveIndex, taskDropdownQueries, taskOpenDropdown])

  useEffect(() => {
    if (!todoOpenDropdown) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.todo-multiselect')) {
        return
      }
      setTodoOpenDropdown(null)
      setTodoDropdownQueries({
        status: '',
        tag_groups: '',
        tags: '',
        promotions: '',
      })
      setTodoDropdownActiveIndex({
        status: 0,
        tag_groups: 0,
        tags: 0,
        promotions: 0,
      })
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [todoOpenDropdown])

  useEffect(() => {
    if (!todoOpenDropdown) {
      return
    }
    setTodoDropdownActiveIndex((prev) => ({ ...prev, [todoOpenDropdown]: 0 }))
  }, [todoOpenDropdown])

  useEffect(() => {
    if (!todoOpenDropdown) {
      return
    }
    const menu = document.querySelector<HTMLElement>(`.todo-multiselect-menu[data-dropdown-key="${todoOpenDropdown}"]`)
    const active = menu?.querySelector<HTMLElement>('.todo-multiselect-option.is-active')
    if (!active) {
      return
    }
    active.scrollIntoView({ block: 'nearest' })
  }, [todoDropdownActiveIndex, todoDropdownQueries, todoOpenDropdown])

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

  const renderTodoMultiSelect = (
    dropdownKey: TodoDropdownKey,
    selectedValues: string[],
    allOptions: TodoMultiSelectOption[],
    fallbackAllLabel: string,
    onToggleValue: (value: string) => void
  ) => {
    const open = todoOpenDropdown === dropdownKey
    const optionQuery = (todoDropdownQueries[dropdownKey] || '').trim().toLowerCase()
    const filteredOptions = optionQuery
      ? allOptions.filter(
          (option) =>
            option.label.toLowerCase().includes(optionQuery) || option.value.toLowerCase().includes(optionQuery)
        )
      : allOptions
    const currentActive = todoDropdownActiveIndex[dropdownKey] ?? 0
    const activeIndex =
      filteredOptions.length === 0 ? -1 : Math.max(0, Math.min(currentActive, filteredOptions.length - 1))
    const summary = summarizeTodoSelection(selectedValues, allOptions, fallbackAllLabel)
    return (
      <div className={`todo-multiselect ${open ? 'open' : ''}`}>
        <button
          type="button"
          className="todo-multiselect-trigger"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setTodoOpenDropdown((current) => {
              const next = current === dropdownKey ? null : dropdownKey
              if (next === null) {
                setTodoDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
              }
              return next
            })
          }}
        >
          <span className="todo-multiselect-summary">{summary}</span>
          <LucideNamedIcon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
        {open ? (
          <div className="todo-multiselect-menu" data-dropdown-key={dropdownKey}>
            <div className="todo-multiselect-search-wrap">
              <div className="explorer-search-input-wrap todo-multiselect-search-field">
                <LucideNamedIcon name="Search" className="explorer-search-icon" size={13} />
                <input
                  className="explorer-search-input"
                  autoFocus
                  value={todoDropdownQueries[dropdownKey] || ''}
                  onChange={(event) => {
                    const next = event.target.value
                    setTodoDropdownQueries((prev) => ({ ...prev, [dropdownKey]: next }))
                    setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (filteredOptions.length === 0) {
                        return
                      }
                      setTodoDropdownActiveIndex((prev) => ({
                        ...prev,
                        [dropdownKey]: ((prev[dropdownKey] ?? 0) + 1 + filteredOptions.length) % filteredOptions.length,
                      }))
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      if (filteredOptions.length === 0) {
                        return
                      }
                      setTodoDropdownActiveIndex((prev) => ({
                        ...prev,
                        [dropdownKey]: ((prev[dropdownKey] ?? 0) - 1 + filteredOptions.length) % filteredOptions.length,
                      }))
                      return
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      const selectedOption = activeIndex >= 0 ? filteredOptions[activeIndex] : null
                      if (!selectedOption) {
                        return
                      }
                      onToggleValue(selectedOption.value)
                      setTodoOpenDropdown(null)
                      setTodoDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setTodoOpenDropdown(null)
                      setTodoDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                    }
                  }}
                  placeholder="Search"
                  title="Option suchen"
                />
                {(todoDropdownQueries[dropdownKey] || '').length > 0 ? (
                  <button
                    type="button"
                    className="explorer-search-clear"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setTodoDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                    }}
                    aria-label="Suche leeren"
                    title="Suche leeren"
                  >
                    <LucideNamedIcon name="X" size={12} />
                  </button>
                ) : null}
              </div>
            </div>
            {filteredOptions.length === 0 ? <p className="empty-copy">Keine Optionen</p> : null}
            {filteredOptions.map((option, index) => {
              const isSelected = selectedValues.includes(option.value)
              const isActive = index === activeIndex
              return (
                <label
                  key={`${dropdownKey}-${option.value}`}
                  className={`todo-multiselect-option ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={() => {
                    setTodoDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: index }))
                  }}
                >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    onToggleValue(option.value)
                  }}
                />
                {option.color ? (
                  <span
                    className="todo-multiselect-color-dot"
                    style={{ '--todo-option-color': option.color } as CSSProperties}
                    aria-hidden="true"
                  />
                ) : null}
                <span>{option.label}</span>
                <span className={`todo-multiselect-hint-check ${isActive && !isSelected ? 'visible' : ''}`} aria-hidden="true">
                  <LucideNamedIcon name="Check" size={12} />
                </span>
              </label>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  const renderTaskMultiSelect = (
    dropdownKey: TaskDropdownKey,
    selectedValues: string[],
    allOptions: TodoMultiSelectOption[],
    fallbackAllLabel: string,
    onToggleValue: (value: string) => void
  ) => {
    const open = taskOpenDropdown === dropdownKey
    const optionQuery = (taskDropdownQueries[dropdownKey] || '').trim().toLowerCase()
    const filteredOptions = optionQuery
      ? allOptions.filter(
          (option) =>
            option.label.toLowerCase().includes(optionQuery) || option.value.toLowerCase().includes(optionQuery)
        )
      : allOptions
    const currentActive = taskDropdownActiveIndex[dropdownKey] ?? 0
    const activeIndex =
      filteredOptions.length === 0 ? -1 : Math.max(0, Math.min(currentActive, filteredOptions.length - 1))
    const summary = summarizeTodoSelection(selectedValues, allOptions, fallbackAllLabel)
    return (
      <div className={`todo-multiselect ${open ? 'open' : ''}`}>
        <button
          type="button"
          className="todo-multiselect-trigger"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setTaskOpenDropdown((current) => {
              const next = current === dropdownKey ? null : dropdownKey
              if (next === null) {
                setTaskDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
              }
              return next
            })
          }}
        >
          <span className="todo-multiselect-summary">{summary}</span>
          <LucideNamedIcon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
        {open ? (
          <div className="todo-multiselect-menu" data-dropdown-key={`task_${dropdownKey}`}>
            <div className="todo-multiselect-search-wrap">
              <div className="explorer-search-input-wrap todo-multiselect-search-field">
                <LucideNamedIcon name="Search" className="explorer-search-icon" size={13} />
                <input
                  className="explorer-search-input"
                  autoFocus
                  value={taskDropdownQueries[dropdownKey] || ''}
                  onChange={(event) => {
                    const next = event.target.value
                    setTaskDropdownQueries((prev) => ({ ...prev, [dropdownKey]: next }))
                    setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (filteredOptions.length === 0) {
                        return
                      }
                      setTaskDropdownActiveIndex((prev) => ({
                        ...prev,
                        [dropdownKey]: ((prev[dropdownKey] ?? 0) + 1 + filteredOptions.length) % filteredOptions.length,
                      }))
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      if (filteredOptions.length === 0) {
                        return
                      }
                      setTaskDropdownActiveIndex((prev) => ({
                        ...prev,
                        [dropdownKey]: ((prev[dropdownKey] ?? 0) - 1 + filteredOptions.length) % filteredOptions.length,
                      }))
                      return
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      const selectedOption = activeIndex >= 0 ? filteredOptions[activeIndex] : null
                      if (!selectedOption) {
                        return
                      }
                      onToggleValue(selectedOption.value)
                      setTaskOpenDropdown(null)
                      setTaskDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setTaskOpenDropdown(null)
                      setTaskDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                    }
                  }}
                  placeholder="Search"
                  title="Option suchen"
                />
                {(taskDropdownQueries[dropdownKey] || '').length > 0 ? (
                  <button
                    type="button"
                    className="explorer-search-clear"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setTaskDropdownQueries((prev) => ({ ...prev, [dropdownKey]: '' }))
                      setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: 0 }))
                    }}
                    aria-label="Suche leeren"
                    title="Suche leeren"
                  >
                    <LucideNamedIcon name="X" size={12} />
                  </button>
                ) : null}
              </div>
            </div>
            {filteredOptions.length === 0 ? <p className="empty-copy">Keine Optionen</p> : null}
            {filteredOptions.map((option, index) => {
              const isSelected = selectedValues.includes(option.value)
              const isActive = index === activeIndex
              return (
                <label
                  key={`task-${dropdownKey}-${option.value}`}
                  className={`todo-multiselect-option ${isActive ? 'is-active' : ''}`}
                  onMouseEnter={() => {
                    setTaskDropdownActiveIndex((prev) => ({ ...prev, [dropdownKey]: index }))
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {
                      onToggleValue(option.value)
                    }}
                  />
                  {option.color ? (
                    <span
                      className="todo-multiselect-color-dot"
                      style={{ '--todo-option-color': option.color } as CSSProperties}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{option.label}</span>
                  <span className={`todo-multiselect-hint-check ${isActive && !isSelected ? 'visible' : ''}`} aria-hidden="true">
                    <LucideNamedIcon name="Check" size={12} />
                  </span>
                </label>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  const resetTodoFilters = () => {
    onTodoFiltersChange({
      ...todoFilters,
      query: '',
      statuses: [],
      tagGroups: [],
      tags: [],
      promotions: [],
    })
    setTodoOpenDropdown(null)
    setTodoDropdownQueries({
      status: '',
      tag_groups: '',
      tags: '',
      promotions: '',
    })
    setTodoDropdownActiveIndex({
      status: 0,
      tag_groups: 0,
      tags: 0,
      promotions: 0,
    })
  }

  const resetTaskFilters = () => {
    onTaskFiltersChange({
      ...taskFilters,
      query: '',
      statuses: [...DEFAULT_TASK_DASHBOARD_FILTERS.statuses],
      priorities: [...DEFAULT_TASK_DASHBOARD_FILTERS.priorities],
      dueBuckets: [...DEFAULT_TASK_DASHBOARD_FILTERS.dueBuckets],
      tagGroups: [],
      tags: [],
      related: [],
    })
    setTaskOpenDropdown(null)
    setTaskDropdownQueries({
      status: '',
      priority: '',
      due: '',
      tag_groups: '',
      tags: '',
      related: '',
    })
    setTaskDropdownActiveIndex({
      status: 0,
      priority: 0,
      due: 0,
      tag_groups: 0,
      tags: 0,
      related: 0,
    })
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

  const focusSectionSummary = focusFilters.sections.length === 0 ? 'Alle Bereiche' : `${focusFilters.sections.length} ausgewaehlt`

  const resetFocusFilters = () => {
    onFocusFiltersChange({ ...DEFAULT_FOCUS_DASHBOARD_FILTERS })
  }

  if (sidebarView === 'vault') {
    return (
      <div className="sidebar-content">
        <h3>Board</h3>
        <p className="muted-label">Aktive NoteBase</p>
        <div className="active-notebase-row">
          <strong>{noteBaseName || 'Keine NoteBase'}</strong>
          <div className="hover-menu-anchor">
            <button className="icon-button compact muted" title="NoteBase-Menue">
              <LucideNamedIcon name="MoreHorizontal" size={14} />
            </button>
            <div className="hover-menu">
              <button onClick={onRenameNoteBase}>NoteBase umbenennen</button>
              <button className="danger" onClick={onDeleteNoteBase}>
                NoteBase loeschen
              </button>
            </div>
          </div>
        </div>

        <div className="stacked-actions">
          <button onClick={onPickAndOpenVault}>NoteBase laden</button>
          <button onClick={onCreateVault}>NoteBase anlegen</button>
          <button onClick={onMigrateExistingNotesToTemplate} disabled={!vaultLoaded}>
            Templates migrieren
          </button>
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
                <button className="icon-button compact" disabled={!vaultLoaded} title="Filteroptionen">
                  <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
                </button>
              </div>
            </div>
            <h3>Todos</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshTodos()
                }}
                disabled={!vaultLoaded}
                title="Todos aktualisieren"
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
                placeholder="Search"
                title="Todos durchsuchen"
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
                  title="Suche leeren"
                >
                  <LucideNamedIcon name="X" size={12} />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <button className="todo-open-dashboard-button" onClick={onOpenTodoDashboard} disabled={!vaultLoaded}>
          Dashboard oeffnen
        </button>

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetTodoFilters}
              title="Alle Filter zuruecksetzen"
              aria-label="Alle Filter zuruecksetzen"
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
              <span className="todo-filter-row-label">Promotion</span>
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
                <button className="icon-button compact" disabled={!vaultLoaded} title="Filteroptionen">
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
                title="Tasks aktualisieren"
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
                placeholder="Search"
                title="Tasks durchsuchen"
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
                  title="Suche leeren"
                >
                  <LucideNamedIcon name="X" size={12} />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <button className="todo-open-dashboard-button" onClick={onOpenTaskDashboard} disabled={!vaultLoaded}>
          Dashboard oeffnen
        </button>

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetTaskFilters}
              title="Alle Filter zuruecksetzen"
              aria-label="Alle Filter zuruecksetzen"
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
              <span className="todo-filter-row-label">Prioritaet</span>
              {renderTaskMultiSelect('priority', taskFilters.priorities, taskPriorityOptions, 'Alle', (value) =>
                toggleTaskMultiSelection('priorities', value)
              )}
            </div>

            <div className="todo-filter-row">
              <span className="todo-filter-row-label">Faelligkeit</span>
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
              <span className="todo-filter-row-label">Related</span>
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
              <span className="todo-filter-row-label">Sortierung</span>
              <label className="todo-grouping-select">
                <select
                  value={taskFilters.grouping}
                  onChange={(event) => setTaskFilter({ grouping: event.target.value as TaskDashboardFilters['grouping'] })}
                >
                  <option value="status">Status</option>
                  <option value="priority">Prioritaet</option>
                  <option value="due_date">Faelligkeit</option>
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
                  <option value="board">Board</option>
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
                <button className="icon-button compact" disabled={!vaultLoaded} title="Filteroptionen">
                  <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
                </button>
              </div>
            </div>
            <h3>Focus</h3>
            <div className="explorer-toolbar-right">
              <button
                className="icon-button compact"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshFocusData()
                }}
                disabled={!vaultLoaded}
                title="Focus-Daten aktualisieren"
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
                placeholder="Search"
                title="Focus durchsuchen"
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
                  title="Suche leeren"
                >
                  <LucideNamedIcon name="X" size={12} />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <button className="todo-open-dashboard-button" onClick={onOpenFocusDashboard} disabled={!vaultLoaded}>
          Dashboard oeffnen
        </button>

        <section className="todo-sidebar-section">
          <div className="todo-section-header">
            <h4>Filter</h4>
            <button
              className="icon-button compact muted todo-section-reset-button"
              onClick={resetFocusFilters}
              title="Focus-Filter zuruecksetzen"
              aria-label="Focus-Filter zuruecksetzen"
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
              <span className="todo-filter-row-label">Zeitraum</span>
              <label className="todo-grouping-select">
                <select value={focusFilters.scope} onChange={(event) => setFocusFilter({ scope: event.target.value as FocusDashboardFilters['scope'] })}>
                  <option value="overdue">Ueberfaellig</option>
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
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Review</h3>
          <button onClick={onRefreshReview} disabled={!vaultLoaded}>
            Aktualisieren
          </button>
        </div>

        <section className="review-card">
          <h4>Daily</h4>
          {daily ? (
            <>
              <p>Datum: {daily.date}</p>
              <p>Neue Notizen: {daily.new_notes}</p>
              <p>Offene Tasks: {daily.open_tasks}</p>
              <p>Heute erledigt: {daily.done_today}</p>
            </>
          ) : (
            <p className="empty-copy">Keine Daily-Daten.</p>
          )}
        </section>

        <section className="review-card">
          <h4>Weekly</h4>
          {weekly ? (
            <>
              <p>
                Zeitraum: {weekly.from} bis {weekly.to}
              </p>
              <p>Notizen gesamt: {weekly.notes_total}</p>
              <p>Tasks offen: {weekly.tasks_open}</p>
              <p>Tasks erledigt: {weekly.tasks_done}</p>
            </>
          ) : (
            <p className="empty-copy">Keine Weekly-Daten.</p>
          )}
        </section>
      </div>
    )
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
      />
    )
  }

  return (
    <ExplorerSidebar
      vaultLoaded={vaultLoaded}
      vaultPath={vaultPath}
      groups={noteGroups}
      files={explorerRows}
      activeFilePath={activeNotePath}
      dirtyFilePaths={dirtyFilePaths}
      width={explorerWidth}
      onWidthChange={onExplorerWidthChange}
      onOpenFile={onOpenNoteInTab}
      onPreviewFile={onOpenNoteInCurrentEditor}
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

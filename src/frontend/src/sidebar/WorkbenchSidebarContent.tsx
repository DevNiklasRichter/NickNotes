import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ExplorerSidebar } from '../explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from '../explorer/TagSidebarV2'
import type { ExplorerOptions, ExplorerSourceFile, ExplorerSourceGroup, ExplorerViewState } from '../explorer/types'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'
import type { TodoDashboardFilters, TodoPromotionFilterValue, TodoStatusFilterValue } from '../app/AppShared'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review'

type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  updated_at: string
  path?: string | null
}

type TodoRow = {
  id: string
  note_id: string
  note_title: string
  note_path: string
  line_no: number
  block_ref: string | null
  checked: boolean
  raw_text: string
  explicit_tags: string[]
  inherited_tags: string[]
  links: string[]
  promoted: boolean
  promoted_task_id: string | null
  updated_at: string
}

type ReviewDaily = {
  date: string
  new_notes: number
  open_tasks: number
  done_today: number
}

type ReviewWeekly = {
  from: string
  to: string
  notes_total: number
  tasks_open: number
  tasks_done: number
}

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
  todos: TodoRow[]
  todoFilters: TodoDashboardFilters
  onTodoFiltersChange: (next: TodoDashboardFilters) => void
  onRefreshTasks: () => void
  onRefreshTodos: () => void
  onMarkTaskDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onPromoteTodo: (id: string) => void
  onOpenTodoOrigin: (notePath: string, title?: string) => void
  onOpenTodoDashboard: () => void
  onOpenTaskPath: (path: string, title?: string) => void
  taskStatusClassName: (raw: string) => string
  taskStatusLabel: (raw: string) => string
  taskPriorityDotClassName: (raw: string) => string
  taskPriorityLabel: (raw: string) => string
  toGermanTimestamp: (value: string) => string
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

type TaskDueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

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

function toTodayIso(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

function toIsoDate(value: string | null): string {
  return (value || '').trim().slice(0, 10)
}

function toTaskBucket(dueDate: string | null, todayIso: string): TaskDueBucket {
  const iso = toIsoDate(dueDate)
  if (!iso) {
    return 'none'
  }
  const due = new Date(`${iso}T00:00:00`)
  const today = new Date(`${todayIso}T00:00:00`)
  if (Number.isNaN(due.getTime()) || Number.isNaN(today.getTime())) {
    return 'none'
  }
  if (due.getTime() < today.getTime()) {
    return 'overdue'
  }
  if (due.getTime() === today.getTime()) {
    return 'today'
  }
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diffDays <= 7 ? 'week' : 'later'
}

function taskPriorityRank(priority: string): number {
  const clean = priority.trim().toLowerCase()
  if (clean === 'h' || clean === 'high') {
    return 0
  }
  if (clean === 'm' || clean === 'medium') {
    return 1
  }
  return 2
}

function todoLabel(todo: TodoRow): string {
  const explicit = todo.note_title?.trim()
  if (explicit) {
    return explicit
  }
  const normalized = (todo.note_path || '').replace(/\\/g, '/')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || todo.note_id || 'Unknown Note'
}

function todoTags(todo: TodoRow): string[] {
  return Array.from(new Set([...(todo.explicit_tags || []), ...(todo.inherited_tags || [])])).sort((left, right) =>
    left.localeCompare(right)
  )
}

function summarizeTodoSelection(selectedValues: string[], allOptions: TodoMultiSelectOption[], fallbackAllLabel: string): string {
  if (allOptions.length === 0) {
    return 'Keine Optionen'
  }
  if (selectedValues.length === 0) {
    return 'Keine Auswahl'
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
  todos,
  todoFilters,
  onTodoFiltersChange,
  onRefreshTasks,
  onRefreshTodos,
  onMarkTaskDone,
  onToggleTodo,
  onPromoteTodo,
  onOpenTodoOrigin,
  onOpenTodoDashboard,
  onOpenTaskPath,
  taskStatusClassName,
  taskStatusLabel,
  taskPriorityDotClassName,
  taskPriorityLabel,
  toGermanTimestamp,
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
  const todayIso = toTodayIso()
  const [taskStatusFilter, setTaskStatusFilter] = useState('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('all')
  const [taskDueFilter, setTaskDueFilter] = useState<'all' | TaskDueBucket>('all')
  const setTodoFilter = (patch: Partial<TodoDashboardFilters>) => {
    onTodoFiltersChange({ ...todoFilters, ...patch })
  }
  const [todoOpenDropdown, setTodoOpenDropdown] = useState<TodoDropdownKey | null>(null)

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status !== 'done')
      .filter((task) => {
        if (taskStatusFilter !== 'all' && task.status !== taskStatusFilter) {
          return false
        }
        const normalizedPriority = task.priority.trim().toLowerCase()
        const priority =
          normalizedPriority === 'h'
            ? 'high'
            : normalizedPriority === 'm'
              ? 'medium'
              : normalizedPriority === 'l'
                ? 'low'
                : normalizedPriority
        if (taskPriorityFilter !== 'all' && priority !== taskPriorityFilter) {
          return false
        }
        if (taskDueFilter !== 'all' && toTaskBucket(task.due_date, todayIso) !== taskDueFilter) {
          return false
        }
        return true
      })
      .sort((left, right) => {
        const leftBucket = toTaskBucket(left.due_date, todayIso)
        const rightBucket = toTaskBucket(right.due_date, todayIso)
        const bucketRank: Record<TaskDueBucket, number> = {
          overdue: 0,
          today: 1,
          week: 2,
          later: 3,
          none: 4,
        }
        if (bucketRank[leftBucket] !== bucketRank[rightBucket]) {
          return bucketRank[leftBucket] - bucketRank[rightBucket]
        }
        const prio = taskPriorityRank(left.priority) - taskPriorityRank(right.priority)
        if (prio !== 0) {
          return prio
        }
        const leftDue = toIsoDate(left.due_date)
        const rightDue = toIsoDate(right.due_date)
        if (leftDue !== rightDue) {
          if (!leftDue) {
            return 1
          }
          if (!rightDue) {
            return -1
          }
          return leftDue.localeCompare(rightDue)
        }
        return right.updated_at.localeCompare(left.updated_at)
      })
  }, [tasks, taskDueFilter, taskPriorityFilter, taskStatusFilter, todayIso])

  const taskSections = useMemo(() => {
    const rows: Record<TaskDueBucket, TaskRow[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
      none: [],
    }
    for (const task of visibleTasks) {
      rows[toTaskBucket(task.due_date, todayIso)].push(task)
    }
    return rows
  }, [todayIso, visibleTasks])

  const todoTagGroupLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of mergedTagGroups) {
      map.set(group.id.toLowerCase(), group.displayName || group.id)
    }
    return map
  }, [mergedTagGroups])

  const todoTagLabelByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of mergedTagGroups) {
      for (const tag of group.tags) {
        map.set(`${group.id}:${tag.id}`.toLowerCase(), tag.displayName || tag.id)
      }
    }
    return map
  }, [mergedTagGroups])

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

    for (const todo of todos) {
      for (const tag of todoTags(todo)) {
        const cleanTag = tag.trim()
        if (!cleanTag) {
          continue
        }
        const [groupRaw = '', tagRaw = ''] = cleanTag.includes(':') ? cleanTag.split(':', 2) : ['', cleanTag]
        const groupId = groupRaw.trim().toLowerCase()
        const key = cleanTag.toLowerCase()
        if (!byKey.has(key)) {
          const fallbackLabel = tagRaw || cleanTag
          byKey.set(key, {
            value: cleanTag,
            label: todoTagLabelByKey.get(key) || fallbackLabel,
            groupId,
            groupLabel: todoTagGroupLabelById.get(groupId) || groupId,
            color: '#94a3b8',
          })
        }
      }
    }
    return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }))
  }, [mergedTagGroups, todoTagGroupLabelById, todoTagLabelByKey, todos])

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
    if (!todoOpenDropdown) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.todo-multiselect')) {
        return
      }
      setTodoOpenDropdown(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [todoOpenDropdown])

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

  const focusTodos = useMemo(() => {
    return todos
      .filter((todo) => !todo.checked)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 10)
  }, [todos])

  const focusTasks = useMemo(() => visibleTasks.slice(0, 8), [visibleTasks])

  const renderTodoMultiSelect = (
    dropdownKey: TodoDropdownKey,
    selectedValues: string[],
    allOptions: TodoMultiSelectOption[],
    fallbackAllLabel: string,
    onToggleValue: (value: string) => void,
    openUpward = false
  ) => {
    const open = todoOpenDropdown === dropdownKey
    const summary = summarizeTodoSelection(selectedValues, allOptions, fallbackAllLabel)
    return (
      <div className={`todo-multiselect ${open ? 'open' : ''}`}>
        <button
          type="button"
          className="todo-multiselect-trigger"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setTodoOpenDropdown((current) => (current === dropdownKey ? null : dropdownKey))
          }}
        >
          <span className="todo-multiselect-summary">{summary}</span>
          <LucideNamedIcon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
        {open ? (
          <div className={`todo-multiselect-menu ${openUpward ? 'upward' : ''}`}>
            {allOptions.length === 0 ? <p className="empty-copy">Keine Optionen</p> : null}
            {allOptions.map((option) => (
              <label key={`${dropdownKey}-${option.value}`} className="todo-multiselect-option">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option.value)}
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
              </label>
            ))}
          </div>
        ) : null}
      </div>
    )
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
          <h4>Filter</h4>
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
                (value) => toggleMultiSelection('promotions', value),
                true
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
              <option value="note">Nach Notiz</option>
              <option value="tag">Nach Tag</option>
              <option value="tag_group">Nach Tag-Gruppe</option>
              <option value="updated_at">Nach Datum</option>
            </select>
          </label>
        </section>
      </div>
    )
  }

  if (sidebarView === 'tasks') {
    const renderTaskSection = (title: string, items: TaskRow[]) =>
      items.length > 0 ? (
        <section className="dashboard-section">
          <h4>{title}</h4>
          <div className="dashboard-item-list">
            {items.map((task) => (
              <article key={task.id} className="task-item">
                <header>
                  <strong>{task.title}</strong>
                  <div className="task-meta-badges">
                    <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                    <span className="task-priority-badge">
                      <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                      {taskPriorityLabel(task.priority)}
                    </span>
                  </div>
                </header>
                <p>{task.due_date ? `Faellig: ${task.due_date}` : 'Kein Faelligkeitsdatum'}</p>
                <p className="muted-copy">{toGermanTimestamp(task.updated_at)}</p>
                <div className="task-actions-row">
                  {task.path ? (
                    <button className="muted" onClick={() => onOpenTaskPath(task.path || '', task.title)}>
                      Oeffnen
                    </button>
                  ) : null}
                  <button onClick={() => onMarkTaskDone(task.id)} disabled={task.status === 'done'}>
                    Done
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null

    return (
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Tasks</h3>
          <button onClick={onRefreshTasks} disabled={!vaultLoaded}>
            Aktualisieren
          </button>
        </div>

        <div className="dashboard-filter-grid task-filter-grid">
          <label>
            Status
            <select value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.target.value)}>
              <option value="all">Alle</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="new_topic">New Topic</option>
            </select>
          </label>
          <label>
            Prioritaet
            <select value={taskPriorityFilter} onChange={(event) => setTaskPriorityFilter(event.target.value)}>
              <option value="all">Alle</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            Faelligkeit
            <select value={taskDueFilter} onChange={(event) => setTaskDueFilter(event.target.value as 'all' | TaskDueBucket)}>
              <option value="all">Alle</option>
              <option value="overdue">Ueberfaellig</option>
              <option value="today">Heute</option>
              <option value="week">Diese Woche</option>
              <option value="later">Spaeter</option>
              <option value="none">Ohne Datum</option>
            </select>
          </label>
        </div>

        <div className="task-list">
          {visibleTasks.length === 0 ? <p className="empty-copy">Keine offenen Tasks.</p> : null}
          {renderTaskSection('Ueberfaellig', taskSections.overdue)}
          {renderTaskSection('Heute', taskSections.today)}
          {renderTaskSection('Diese Woche', taskSections.week)}
          {renderTaskSection('Geplant', taskSections.later)}
          {renderTaskSection('Ohne Datum', taskSections.none)}
        </div>
      </div>
    )
  }

  if (sidebarView === 'focus') {
    return (
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Focus</h3>
          <div className="header-inline-actions">
            <button onClick={onRefreshTasks} disabled={!vaultLoaded}>
              Tasks
            </button>
            <button onClick={onRefreshTodos} disabled={!vaultLoaded}>
              Todos
            </button>
          </div>
        </div>

        <section className="dashboard-section">
          <h4>Task Fokus</h4>
          <div className="dashboard-item-list">
            {focusTasks.length === 0 ? <p className="empty-copy">Keine offenen Tasks.</p> : null}
            {focusTasks.map((task) => (
              <article key={task.id} className="task-item compact">
                <header>
                  <strong>{task.title}</strong>
                  <span className="item-kind-pill">TASK</span>
                </header>
                <p>{task.due_date ? `Faellig: ${task.due_date}` : 'Kein Faelligkeitsdatum'}</p>
                <div className="task-actions-row">
                  {task.path ? (
                    <button className="muted" onClick={() => onOpenTaskPath(task.path || '', task.title)}>
                      Oeffnen
                    </button>
                  ) : null}
                  <button onClick={() => onMarkTaskDone(task.id)}>Done</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="dashboard-section">
          <h4>Todo Fokus</h4>
          <div className="dashboard-item-list">
            {focusTodos.length === 0 ? <p className="empty-copy">Keine offenen Todos.</p> : null}
            {focusTodos.map((todo) => (
              <article key={todo.id} className="todo-item compact">
                <header>
                  <strong>{todo.raw_text}</strong>
                  <span className="item-kind-pill todo">TODO</span>
                </header>
                <p className="muted-copy">
                  {todoLabel(todo)} | Zeile {todo.line_no}
                </p>
                <div className="todo-actions-row">
                  <button onClick={() => onToggleTodo(todo.id)}>{todo.checked ? 'Reopen' : 'Done'}</button>
                  <button className="muted" onClick={() => onOpenTodoOrigin(todo.note_path, todo.note_title || undefined)}>
                    Ursprung
                  </button>
                  <button onClick={() => onPromoteTodo(todo.id)} disabled={todo.promoted}>
                    {todo.promoted ? 'Promoted' : 'Als Task'}
                  </button>
                </div>
              </article>
            ))}
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

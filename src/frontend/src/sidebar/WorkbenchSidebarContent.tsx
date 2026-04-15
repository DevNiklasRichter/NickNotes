import { useMemo, useState } from 'react'
import { ExplorerSidebar } from '../explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from '../explorer/TagSidebarV2'
import type { ExplorerOptions, ExplorerSourceFile, ExplorerSourceGroup, ExplorerViewState } from '../explorer/types'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'

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
  onRefreshTasks: () => void
  onRefreshTodos: () => void
  onMarkTaskDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onPromoteTodo: (id: string) => void
  onOpenTodoOrigin: (notePath: string, title?: string) => void
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
  onRefreshTasks,
  onRefreshTodos,
  onMarkTaskDone,
  onToggleTodo,
  onPromoteTodo,
  onOpenTodoOrigin,
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
  const [todoStatusFilter, setTodoStatusFilter] = useState<'all' | 'open' | 'done'>('open')
  const [todoPromotionFilter, setTodoPromotionFilter] = useState<'all' | 'promoted' | 'unpromoted'>('all')
  const [todoGroupMode, setTodoGroupMode] = useState<'note' | 'tag' | 'tag_group' | 'uncategorized'>('note')
  const [todoNoteFilter, setTodoNoteFilter] = useState('all')
  const [todoTagFilter, setTodoTagFilter] = useState('all')
  const [todoTagGroupFilter, setTodoTagGroupFilter] = useState('all')

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

  const todoNotes = useMemo(() => {
    const rows = new Map<string, string>()
    for (const todo of todos) {
      if (todo.note_path && !rows.has(todo.note_path)) {
        rows.set(todo.note_path, todoLabel(todo))
      }
    }
    return Array.from(rows.entries()).sort((left, right) => left[1].localeCompare(right[1]))
  }, [todos])

  const todoTagOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const todo of todos) {
      for (const tag of todoTags(todo)) {
        tags.add(tag)
      }
    }
    return Array.from(tags).sort((left, right) => left.localeCompare(right))
  }, [todos])

  const todoTagGroups = useMemo(() => {
    const groups = new Set<string>()
    for (const tag of todoTagOptions) {
      if (tag.includes(':')) {
        groups.add(tag.split(':', 1)[0] || '')
      }
    }
    return Array.from(groups).filter(Boolean).sort((left, right) => left.localeCompare(right))
  }, [todoTagOptions])

  const visibleTodos = useMemo(() => {
    return todos
      .filter((todo) => {
        if (todoStatusFilter === 'open' && todo.checked) {
          return false
        }
        if (todoStatusFilter === 'done' && !todo.checked) {
          return false
        }
        if (todoPromotionFilter === 'promoted' && !todo.promoted) {
          return false
        }
        if (todoPromotionFilter === 'unpromoted' && todo.promoted) {
          return false
        }
        if (todoNoteFilter !== 'all' && todo.note_path !== todoNoteFilter) {
          return false
        }
        const tags = todoTags(todo)
        if (todoTagFilter !== 'all' && !tags.includes(todoTagFilter)) {
          return false
        }
        if (todoTagGroupFilter !== 'all' && !tags.some((tag) => tag.startsWith(`${todoTagGroupFilter}:`))) {
          return false
        }
        return true
      })
      .sort((left, right) => {
        if (left.checked !== right.checked) {
          return left.checked ? 1 : -1
        }
        return right.updated_at.localeCompare(left.updated_at)
      })
  }, [todoNoteFilter, todoPromotionFilter, todoStatusFilter, todoTagFilter, todoTagGroupFilter, todos])

  const groupedTodos = useMemo(() => {
    const groups = new Map<string, { label: string; items: TodoRow[] }>()
    for (const todo of visibleTodos) {
      let key = 'uncategorized'
      let label = 'Unkategorisiert'
      const tags = todoTags(todo)
      if (todoGroupMode === 'note') {
        key = todo.note_path || todo.note_id
        label = todoLabel(todo)
      } else if (todoGroupMode === 'tag') {
        const firstTag = tags[0] || ''
        key = firstTag || 'uncategorized'
        label = firstTag || 'Unkategorisiert'
      } else if (todoGroupMode === 'tag_group') {
        const firstGroup = tags[0]?.split(':', 1)[0] || ''
        key = firstGroup || 'uncategorized'
        label = firstGroup || 'Unkategorisiert'
      }

      const existing = groups.get(key)
      if (existing) {
        existing.items.push(todo)
      } else {
        groups.set(key, { label, items: [todo] })
      }
    }
    return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label))
  }, [todoGroupMode, visibleTodos])

  const focusTodos = useMemo(() => {
    return todos
      .filter((todo) => !todo.checked)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 10)
  }, [todos])

  const focusTasks = useMemo(() => visibleTasks.slice(0, 8), [visibleTasks])

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
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Todos</h3>
          <button onClick={onRefreshTodos} disabled={!vaultLoaded}>
            Aktualisieren
          </button>
        </div>

        <div className="dashboard-filter-grid">
          <label>
            Status
            <select value={todoStatusFilter} onChange={(event) => setTodoStatusFilter(event.target.value as 'all' | 'open' | 'done')}>
              <option value="open">Open</option>
              <option value="done">Done</option>
              <option value="all">Alle</option>
            </select>
          </label>
          <label>
            Notiz
            <select value={todoNoteFilter} onChange={(event) => setTodoNoteFilter(event.target.value)}>
              <option value="all">Alle</option>
              {todoNotes.map(([path, label]) => (
                <option key={path} value={path}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tag
            <select value={todoTagFilter} onChange={(event) => setTodoTagFilter(event.target.value)}>
              <option value="all">Alle</option>
              {todoTagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tag-Gruppe
            <select value={todoTagGroupFilter} onChange={(event) => setTodoTagGroupFilter(event.target.value)}>
              <option value="all">Alle</option>
              {todoTagGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>
          <label>
            Promotion
            <select
              value={todoPromotionFilter}
              onChange={(event) => setTodoPromotionFilter(event.target.value as 'all' | 'promoted' | 'unpromoted')}
            >
              <option value="all">Alle</option>
              <option value="promoted">Promoted</option>
              <option value="unpromoted">Unpromoted</option>
            </select>
          </label>
          <label>
            Gruppierung
            <select
              value={todoGroupMode}
              onChange={(event) =>
                setTodoGroupMode(event.target.value as 'note' | 'tag' | 'tag_group' | 'uncategorized')
              }
            >
              <option value="note">Nach Notiz</option>
              <option value="tag">Nach Tag</option>
              <option value="tag_group">Nach Tag-Gruppe</option>
              <option value="uncategorized">Unkategorisiert</option>
            </select>
          </label>
        </div>

        <div className="task-list">
          {groupedTodos.length === 0 ? <p className="empty-copy">Keine Todos fuer den aktuellen Filter.</p> : null}
          {groupedTodos.map((group) => (
            <section key={group.label} className="dashboard-section">
              <h4>{group.label}</h4>
              <div className="dashboard-item-list">
                {group.items.map((todo) => (
                  <article key={todo.id} className="todo-item">
                    <header>
                      <strong>{todo.raw_text}</strong>
                      <span className={`status-badge ${todo.checked ? 'status-done' : 'status-open'}`}>
                        {todo.checked ? 'Done' : 'Open'}
                      </span>
                    </header>
                    <p className="muted-copy">
                      {todoLabel(todo)} | Zeile {todo.line_no}
                    </p>
                    <p className="muted-copy">Tags: {todoTags(todo).join(', ') || 'keine'}</p>
                    <p className="muted-copy">Promoted: {todo.promoted ? todo.promoted_task_id || 'ja' : 'nein'}</p>
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
          ))}
        </div>
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

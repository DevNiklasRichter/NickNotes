import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  type FocusDashboardMode,
  taskPriorityDotClassName,
  taskPriorityLabel,
  taskStatusClassName,
  taskStatusLabel,
  getRelativeVaultPath,
  toLocalIsoDate,
  type FocusDashboardFilters,
  type SearchRow,
  type TaskFeatureSettings,
  type TaskRow,
  type TodoRow,
} from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import {
  buildFocusContextHits,
  buildFocusDashboardData,
  toDotDateLabel,
  type FocusCapacityStatus,
  type FocusMitSuggestion,
  type FocusNextActionItem,
  type FocusPrimaryItem,
} from './focusDashboardModel'

type FocusDashboardCanvasProps = {
  tasks: TaskRow[]
  todos: TodoRow[]
  notes: SearchRow[]
  noteBasePath: string
  filters: FocusDashboardFilters
  mitIds: string[]
  taskFeatureSettings: TaskFeatureSettings
  onFiltersChange: (next: FocusDashboardFilters) => void
  onSaveMit: (nextMitIds: string[]) => Promise<string[]>
  onQuickCaptureTodo: (rawText: string) => Promise<void>
  onOpenTaskPath: (path: string, title?: string) => void
  onOpenTodoOrigin: (notePath: string, title?: string) => void
  onOpenNotePath: (path: string, title?: string, noteType?: 'note' | 'task') => void
  toGermanTimestamp: (value: string) => string
}

type ScopeOption = {
  value: FocusDashboardFilters['scope']
  label: string
}

type ModeOption = {
  value: FocusDashboardMode
  label: string
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'overdue', label: 'Ueberfaellig' },
  { value: 'today', label: 'Heute' },
  { value: 'tomorrow', label: 'Morgen' },
  { value: 'week', label: 'Woche' },
  { value: 'next7', label: '7 Tage' },
  { value: 'all', label: 'Alles' },
]

const MODE_OPTIONS: ModeOption[] = [
  { value: 'execution', label: 'Execution' },
  { value: 'planning', label: 'Planning' },
  { value: 'rescue', label: 'Rescue' },
  { value: 'context', label: 'Context' },
]

function focusItemMetaLabel(item: FocusPrimaryItem): string {
  if (item.kind === 'task') {
    const dueLabel = toDotDateLabel(item.dueDate)
    return `Faellig: ${dueLabel} | Update: ${item.updatedAt.slice(0, 10)}`
  }
  return `Todo | Update: ${item.updatedAt.slice(0, 10)}`
}

function cleanNoteTitle(rawTitle: string): string {
  return rawTitle.replace(/\.md$/i, '')
}

function toNoteRelativeDisplayPath(path: string, noteBasePath: string): string {
  return getRelativeVaultPath(path, noteBasePath).replace(/\\/g, '/').replace(/\.md$/i, '')
}

function toMarkedRelativeNotePath(path: string, noteBasePath: string): string {
  return toNoteRelativeDisplayPath(path, noteBasePath)
    .split('/')
    .filter(Boolean)
    .join(' / ')
}

function noteTypeIcon(noteType: string): string {
  return noteType.trim().toLowerCase() === 'task' ? 'CheckSquare' : 'FileText'
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

function toEstimateLabel(minutes: number | null): string {
  if (minutes === null || minutes <= 0) {
    return ''
  }
  return `${minutes}m`
}

function truncateText(raw: string | null, limit: number): string {
  const clean = (raw || '').trim()
  if (!clean) {
    return ''
  }
  if (clean.length <= limit) {
    return clean
  }
  return `${clean.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

function dedupeByKey(items: FocusPrimaryItem[]): FocusPrimaryItem[] {
  const seen = new Set<string>()
  const deduped: FocusPrimaryItem[] = []
  for (const item of items) {
    if (seen.has(item.key)) {
      continue
    }
    seen.add(item.key)
    deduped.push(item)
  }
  return deduped
}

function toCapacityLabel(status: FocusCapacityStatus): string {
  if (status === 'light') {
    return 'Leicht'
  }
  if (status === 'balanced') {
    return 'Ausbalanciert'
  }
  if (status === 'heavy') {
    return 'Voll'
  }
  return 'Ueberladen'
}

function toSuggestionActionDisabled(entry: FocusMitSuggestion, mitBusyKey: string): boolean {
  return Boolean(mitBusyKey) || !entry.item.canAddToMit
}

function toNextActionEntry(item: FocusNextActionItem): FocusPrimaryItem {
  return item.item
}

type FocusItemCardProps = {
  item: FocusPrimaryItem
  selected: boolean
  overdue?: boolean
  focusMode: FocusDashboardMode
  showAdvancedTaskSignals: boolean
  showTaskTimeManagement: boolean
  mitBusy: boolean
  onSelect: (itemKey: string) => void
  onToggleMit: (item: FocusPrimaryItem) => void
  onOpenOrigin: (item: FocusPrimaryItem) => void
}

function FocusItemCard({
  item,
  selected,
  overdue = false,
  focusMode,
  showAdvancedTaskSignals,
  showTaskTimeManagement,
  mitBusy,
  onSelect,
  onToggleMit,
  onOpenOrigin,
}: FocusItemCardProps) {
  const canOpen = Boolean(item.path)
  const mitActionDisabled = mitBusy || (!item.isMit && !item.canAddToMit)
  const mitActionTitle = item.isMit
    ? 'Aus MIT entfernen'
    : item.canAddToMit
      ? 'Als MIT setzen'
      : 'MIT-Limit erreicht oder Element ist erledigt'

  return (
    <article
      className={`focus-primary-card ${selected ? 'selected' : ''} ${overdue ? 'overdue' : ''} ${item.isMit ? 'mit' : ''} ${item.isDone ? 'done' : ''} ${
        item.isBlocked ? 'blocked' : ''
      } ${focusMode === 'context' && item.contextBadgeCount > 0 ? 'context-boost' : ''}`}
    >
      <button
        className="focus-primary-card-main"
        onClick={() => {
          onSelect(item.key)
        }}
        title="Kontext zu diesem Fokuspunkt anzeigen"
      >
        <div className="focus-primary-card-head">
          <span className={`item-kind-pill ${item.kind === 'todo' ? 'todo' : ''}`}>{item.kind === 'task' ? 'TASK' : 'TODO'}</span>
          {item.kind === 'task' ? <span className={taskStatusClassName(item.status || 'open')}>{taskStatusLabel(item.status || 'open')}</span> : null}
          {item.kind === 'task' ? (
            <span className="task-priority-badge">
              <span className={taskPriorityDotClassName(item.priority || 'medium')} aria-hidden="true" />
              {taskPriorityLabel(item.priority || 'medium')}
            </span>
          ) : null}
          {showTaskTimeManagement && item.kind === 'task' && item.estimateMinutes !== null ? (
            <span className="focus-context-badge-chip">{toEstimateLabel(item.estimateMinutes)}</span>
          ) : null}
          {item.isDone ? <span className="focus-context-badge-chip">Erledigt</span> : null}
          {showAdvancedTaskSignals && item.hasTaskBlocker ? <span className="focus-context-badge-chip">Blockiert</span> : null}
          {showAdvancedTaskSignals && item.hasExternalWaiting ? <span className="focus-context-badge-chip">Waiting</span> : null}
          {showAdvancedTaskSignals && item.followUpDate ? <span className="focus-context-badge-chip">Follow-up {toDotDateLabel(item.followUpDate)}</span> : null}
          {showAdvancedTaskSignals && item.unknownBlockerCount > 0 ? (
            <span className="focus-context-badge-chip">
              {item.unknownBlockerCount} unbekannter Blocker
            </span>
          ) : null}
        </div>
        <strong>{item.title}</strong>
        <p>{focusItemMetaLabel(item)}</p>
        {showAdvancedTaskSignals && item.waitingFor ? <p className="focus-item-secondary">Warten auf: {truncateText(item.waitingFor, 56)}</p> : null}
        {showAdvancedTaskSignals && item.blockedReason ? <p className="focus-item-secondary">Blocker: {truncateText(item.blockedReason, 56)}</p> : null}
        {showAdvancedTaskSignals && item.nextActionHint ? <p className="focus-item-secondary">Naechster Schritt: {truncateText(item.nextActionHint, 72)}</p> : null}
        {item.contextBadgeCount > 0 ? (
          <div className="focus-context-badge-row">
            <span className="focus-context-badge-chip">Kontext {item.contextBadgeCount}</span>
            {item.hasOriginNote ? <span className="focus-context-badge-chip">Ursprung</span> : null}
            {item.hasRelatedContext ? <span className="focus-context-badge-chip">Related</span> : null}
            {item.hasTagContext ? <span className="focus-context-badge-chip">Tag</span> : null}
          </div>
        ) : null}
      </button>

      <div className="focus-primary-actions">
        <button
          className="focus-card-action-button"
          onClick={() => {
            onToggleMit(item)
          }}
          disabled={mitActionDisabled}
          title={mitActionTitle}
        >
          {item.isMit ? 'Aus MIT' : 'Als MIT'}
        </button>
        <button
          className="icon-button compact muted"
          disabled={!canOpen}
          onClick={() => {
            onOpenOrigin(item)
          }}
          title={canOpen ? 'Ursprung oeffnen' : 'Kein Ursprungspfad vorhanden'}
        >
          <LucideNamedIcon name="ArrowUpRight" size={14} />
        </button>
      </div>
    </article>
  )
}

export function FocusDashboardCanvas({
  tasks,
  todos,
  notes,
  noteBasePath,
  filters,
  mitIds,
  taskFeatureSettings,
  onFiltersChange,
  onSaveMit,
  onQuickCaptureTodo,
  onOpenTaskPath,
  onOpenTodoOrigin,
  onOpenNotePath,
  toGermanTimestamp,
}: FocusDashboardCanvasProps) {
  const todayIso = useMemo(() => toLocalIsoDate(), [])
  const data = useMemo(
    () =>
      buildFocusDashboardData({
        tasks,
        todos,
        notes,
        filters,
        todayIso,
        mitIds,
        taskFeatureSettings,
      }),
    [filters, mitIds, notes, taskFeatureSettings, tasks, todayIso, todos]
  )

  const showAdvancedTaskSignals = taskFeatureSettings.advancedTaskHandling
  const showTaskTimeManagement = taskFeatureSettings.taskTimeManagement

  const selectableItems = useMemo(
    () => dedupeByKey([...data.mitItems, ...data.overdueItems, ...data.blockedItems, ...data.waitingItems, ...data.followUpTodayItems, ...data.focusItems, ...data.candidateItems]),
    [data.blockedItems, data.candidateItems, data.focusItems, data.followUpTodayItems, data.mitItems, data.overdueItems, data.waitingItems]
  )

  const [selectedKey, setSelectedKey] = useState<string>('')
  const [mitBusyKey, setMitBusyKey] = useState<string>('')
  const [mitError, setMitError] = useState('')
  const [captureValue, setCaptureValue] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [captureSuccess, setCaptureSuccess] = useState('')

  const selectedItem = useMemo(
    () => selectableItems.find((item) => item.key === selectedKey) || selectableItems[0] || null,
    [selectableItems, selectedKey]
  )
  const contextHits = useMemo(() => (selectedItem ? buildFocusContextHits(selectedItem, notes, todayIso) : []), [notes, selectedItem, todayIso])

  useEffect(() => {
    if (!selectedItem) {
      if (selectedKey) {
        setSelectedKey('')
      }
      return
    }
    if (selectedKey && selectedItem.key === selectedKey) {
      return
    }
    setSelectedKey(selectedItem.key)
  }, [selectedItem, selectedKey])

  useEffect(() => {
    if (!captureSuccess) {
      return
    }
    const timer = window.setTimeout(() => {
      setCaptureSuccess('')
    }, 2200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [captureSuccess])

  const setScope = (scope: FocusDashboardFilters['scope']) => {
    if (scope === filters.scope) {
      return
    }
    onFiltersChange({ ...filters, scope })
  }

  const setMode = (mode: FocusDashboardMode) => {
    if (mode === filters.mode) {
      return
    }
    onFiltersChange({ ...filters, mode })
  }

  const openItemOrigin = (item: FocusPrimaryItem) => {
    if (!item.path) {
      return
    }
    if (item.kind === 'task') {
      onOpenTaskPath(item.path, item.title)
      return
    }
    onOpenTodoOrigin(item.path, item.title)
  }

  const toggleMit = async (item: FocusPrimaryItem) => {
    if (mitBusyKey) {
      return
    }
    const currentMitIds = data.mitIds
    const nextMitIds = item.isMit ? currentMitIds.filter((entry) => entry !== item.key) : [...currentMitIds, item.key]
    setMitBusyKey(item.key)
    setMitError('')
    try {
      await onSaveMit(nextMitIds)
    } catch (error) {
      setMitError(toErrorMessage(error, 'MIT konnte nicht gespeichert werden.'))
    } finally {
      setMitBusyKey('')
    }
  }

  const submitQuickCapture = async () => {
    if (captureBusy) {
      return
    }
    const clean = captureValue.trim()
    if (!clean) {
      return
    }
    setCaptureBusy(true)
    setCaptureError('')
    setCaptureSuccess('')
    try {
      await onQuickCaptureTodo(clean)
      setCaptureValue('')
      setCaptureSuccess('Todo fuer heute gespeichert.')
    } catch (error) {
      setCaptureError(toErrorMessage(error, 'Quick Capture konnte nicht gespeichert werden.'))
    } finally {
      setCaptureBusy(false)
    }
  }

  const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitQuickCapture()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setCaptureValue('')
      setCaptureError('')
      setCaptureSuccess('')
    }
  }

  const totalAutoFocusItems = data.focusItems.length + data.candidateItems.length
  const blockingSectionItems = useMemo(
    () => dedupeByKey([...data.followUpTodayItems, ...data.waitingItems, ...data.blockedItems]).slice(0, 10),
    [data.blockedItems, data.followUpTodayItems, data.waitingItems]
  )
  const planningHintEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; count: number }> = []
    if (showTaskTimeManagement && data.planningHints.focusWithoutEstimateCount > 0) {
      entries.push({
        key: 'focus_without_estimate',
        label: 'Fokus ohne Schaetzung',
        count: data.planningHints.focusWithoutEstimateCount,
      })
    }
    if (showTaskTimeManagement && data.planningHints.mitWithoutEstimateCount > 0) {
      entries.push({
        key: 'mit_without_estimate',
        label: 'MIT ohne Schaetzung',
        count: data.planningHints.mitWithoutEstimateCount,
      })
    }
    if (showAdvancedTaskSignals && data.planningHints.waitingWithoutFollowUpCount > 0) {
      entries.push({
        key: 'waiting_without_followup',
        label: 'Waiting ohne Follow-up',
        count: data.planningHints.waitingWithoutFollowUpCount,
      })
    }
    if (showAdvancedTaskSignals && data.planningHints.unknownBlockerTaskCount > 0) {
      entries.push({
        key: 'unknown_blockers',
        label: 'Tasks mit unbekanntem Blocker',
        count: data.planningHints.unknownBlockerTaskCount,
      })
    }
    return entries
  }, [
    data.planningHints.focusWithoutEstimateCount,
    data.planningHints.mitWithoutEstimateCount,
    data.planningHints.unknownBlockerTaskCount,
    data.planningHints.waitingWithoutFollowUpCount,
    showAdvancedTaskSignals,
    showTaskTimeManagement,
  ])

  return (
    <div className="focus-canvas">
      <div className="focus-canvas-header">
        <div className="focus-canvas-header-top">
          <h2>Focus Dashboard</h2>
          <div className="focus-header-switchers">
            <div className="focus-mode-switcher" role="tablist" aria-label="Fokusmodus">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`focus-scope-switch-button ${filters.mode === option.value ? 'active' : ''}`}
                  onClick={() => {
                    setMode(option.value)
                  }}
                  role="tab"
                  aria-selected={filters.mode === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="focus-scope-switcher" role="tablist" aria-label="Zeithorizont">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`focus-scope-switch-button ${filters.scope === option.value ? 'active' : ''}`}
                  onClick={() => {
                    setScope(option.value)
                  }}
                  role="tab"
                  aria-selected={filters.scope === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p>
          Modus: {data.focusMode} | Query: {filters.query.trim() || 'keine'} | Auto-Fokus: {totalAutoFocusItems} | MIT: {data.mitItems.length}/3
        </p>
        {showTaskTimeManagement ? (
          <div className={`focus-capacity-strip focus-capacity-${data.capacityStatus}`}>
            <strong>
              Kapazitaet: {toCapacityLabel(data.capacityStatus)} ({data.estimatedLoadTodayMinutes}m)
            </strong>
            <span>{data.capacityMessage}</span>
            <span>
              MIT {data.estimatedMitMinutes}m | Fokus {data.estimatedFocusMinutes}m | Ohne Schaetzung {data.withoutEstimateCount}
            </span>
          </div>
        ) : null}

        <div className="focus-capture-inline">
          <label className="focus-capture-label" htmlFor="focus-quick-capture">
            Quick Capture
          </label>
          <input
            id="focus-quick-capture"
            className="focus-capture-input"
            value={captureValue}
            onChange={(event) => {
              setCaptureValue(event.target.value)
            }}
            onKeyDown={onCaptureKeyDown}
            placeholder="Neues Todo fuer heute..."
            disabled={captureBusy}
          />
          <button className="focus-capture-submit" onClick={() => void submitQuickCapture()} disabled={captureBusy || !captureValue.trim()}>
            {captureBusy ? 'Speichere...' : 'Erfassen'}
          </button>
        </div>
        {captureError ? <p className="focus-inline-error">{captureError}</p> : null}
        {!captureError && captureSuccess ? <p className="focus-inline-success">{captureSuccess}</p> : null}
      </div>

      <div className="focus-metric-grid">
        <article className="focus-metric-card">
          <span className="focus-metric-label">Offene Tasks</span>
          <strong>{data.openTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">In Progress</span>
          <strong>{data.inProgressTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">Heute faellig</span>
          <strong>{data.dueTodayTaskCount}</strong>
        </article>
        <article className="focus-metric-card">
          <span className="focus-metric-label">Offene Todos</span>
          <strong>{data.openTodoCount}</strong>
        </article>
        {showAdvancedTaskSignals ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Blockiert</span>
            <strong>{data.blockedTaskCount}</strong>
          </article>
        ) : null}
        {showAdvancedTaskSignals ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Waiting For</span>
            <strong>{data.waitingTaskCount}</strong>
            <span className="focus-metric-subtext">Follow-up heute: {data.followUpTodayCount}</span>
          </article>
        ) : null}
        {showTaskTimeManagement ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Dauer heute</span>
            <strong>{data.todayEstimatedMinutes > 0 ? `${data.todayEstimatedMinutes}m` : '-'}</strong>
          </article>
        ) : null}
        {showTaskTimeManagement ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Dauer MIT</span>
            <strong>{data.mitEstimatedMinutes > 0 ? `${data.mitEstimatedMinutes}m` : '-'}</strong>
          </article>
        ) : null}
        {showTaskTimeManagement ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Dauer Fokus</span>
            <strong>{data.focusEstimatedMinutes > 0 ? `${data.focusEstimatedMinutes}m` : '-'}</strong>
          </article>
        ) : null}
        {showTaskTimeManagement ? (
          <article className="focus-metric-card">
            <span className="focus-metric-label">Ohne Schaetzung</span>
            <strong>{data.withoutEstimateCount}</strong>
          </article>
        ) : null}
        <article className="focus-metric-card">
          <span className="focus-metric-label">Done heute</span>
          <strong>{data.doneToday}</strong>
          <span className="focus-metric-subtext">
            {data.doneTodayTasks} Tasks | {data.doneTodayTodos} Todos
          </span>
        </article>
      </div>

      <div className={`focus-canvas-grid ${data.focusMode === 'context' ? 'context-mode' : ''}`}>
        <div className="focus-panel-stack">
          <section className="focus-panel focus-panel-mit">
            <header className="focus-panel-header">
              <h3>Heute committen (MIT)</h3>
              <span>{data.mitItems.length}</span>
            </header>
            {mitError ? <p className="focus-inline-error">{mitError}</p> : null}
            {data.mitItems.length === 0 ? <p className="empty-copy">Noch keine MITs fuer heute gesetzt.</p> : null}
            <div className="focus-primary-list">
              {data.mitItems.map((item) => (
                <FocusItemCard
                  key={item.key}
                  item={item}
                  selected={selectedItem?.key === item.key}
                  focusMode={data.focusMode}
                  showAdvancedTaskSignals={showAdvancedTaskSignals}
                  showTaskTimeManagement={showTaskTimeManagement}
                  mitBusy={mitBusyKey === item.key}
                  onSelect={setSelectedKey}
                  onToggleMit={(target) => {
                    void toggleMit(target)
                  }}
                  onOpenOrigin={openItemOrigin}
                />
              ))}
            </div>
            {data.suggestedMitItems.length > 0 ? (
              <div className="focus-inline-suggestions">
                <p className="focus-context-subtitle">MIT-Vorschlaege</p>
                <ul className="focus-note-list">
                  {data.suggestedMitItems.map((entry) => (
                    <li key={`mit-suggestion-${entry.item.key}`} className="focus-note-row">
                      <button
                        className="focus-blocking-row-main"
                        onClick={() => {
                          setSelectedKey(entry.item.key)
                        }}
                      >
                        <span className="focus-note-row-title">{entry.item.title}</span>
                        <span className="focus-context-badge-row">
                          {entry.reasons.map((reason) => (
                            <span key={`${entry.item.key}-${reason}`} className="focus-context-badge-chip">
                              {reason}
                            </span>
                          ))}
                        </span>
                      </button>
                      <button
                        className="focus-card-action-button"
                        disabled={toSuggestionActionDisabled(entry, mitBusyKey)}
                        title={entry.item.canAddToMit ? 'Als MIT uebernehmen' : 'MIT-Limit erreicht oder Element ist erledigt'}
                        onClick={() => {
                          void toggleMit(entry.item)
                        }}
                      >
                        Uebernehmen
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="focus-panel focus-panel-overdue">
            <header className="focus-panel-header">
              <h3>Ueberfaellig</h3>
              <span>{data.overdueItems.length}</span>
            </header>
            {data.overdueItems.length === 0 ? <p className="empty-copy">Keine ueberfaelligen Tasks.</p> : null}
            <div className="focus-primary-list">
              {data.overdueItems.map((item) => (
                <FocusItemCard
                  key={item.key}
                  item={item}
                  selected={selectedItem?.key === item.key}
                  overdue
                  focusMode={data.focusMode}
                  showAdvancedTaskSignals={showAdvancedTaskSignals}
                  showTaskTimeManagement={showTaskTimeManagement}
                  mitBusy={mitBusyKey === item.key}
                  onSelect={setSelectedKey}
                  onToggleMit={(target) => {
                    void toggleMit(target)
                  }}
                  onOpenOrigin={openItemOrigin}
                />
              ))}
            </div>
          </section>

          <section className="focus-panel">
            <header className="focus-panel-header">
              <h3>Heute im Fokus</h3>
              <span>{data.focusItems.length}</span>
            </header>
            {data.focusItems.length === 0 ? <p className="empty-copy">Keine Fokuspunkte fuer den aktuellen Filter.</p> : null}
            <div className="focus-primary-list">
              {data.focusItems.map((item) => (
                <FocusItemCard
                  key={item.key}
                  item={item}
                  selected={selectedItem?.key === item.key}
                  focusMode={data.focusMode}
                  showAdvancedTaskSignals={showAdvancedTaskSignals}
                  showTaskTimeManagement={showTaskTimeManagement}
                  mitBusy={mitBusyKey === item.key}
                  onSelect={setSelectedKey}
                  onToggleMit={(target) => {
                    void toggleMit(target)
                  }}
                  onOpenOrigin={openItemOrigin}
                />
              ))}
            </div>
          </section>

          <section className="focus-panel">
            <header className="focus-panel-header">
              <h3>Weitere Kandidaten</h3>
              <span>{data.candidateItems.length}</span>
            </header>
            {data.candidateItems.length === 0 ? <p className="empty-copy">Keine weiteren Kandidaten.</p> : null}
            <div className="focus-primary-list">
              {data.candidateItems.map((item) => (
                <FocusItemCard
                  key={item.key}
                  item={item}
                  selected={selectedItem?.key === item.key}
                  focusMode={data.focusMode}
                  showAdvancedTaskSignals={showAdvancedTaskSignals}
                  showTaskTimeManagement={showTaskTimeManagement}
                  mitBusy={mitBusyKey === item.key}
                  onSelect={setSelectedKey}
                  onToggleMit={(target) => {
                    void toggleMit(target)
                  }}
                  onOpenOrigin={openItemOrigin}
                />
              ))}
            </div>
          </section>
        </div>

        <div className="focus-panel-stack">
          {showAdvancedTaskSignals ? (
            <section className={`focus-panel ${data.focusMode === 'context' ? 'focus-panel-context-priority' : ''}`}>
              <header className="focus-panel-header">
                <h3>Naechste sinnvolle Schritte</h3>
                <span>{data.nextActionItems.length}</span>
              </header>
              {data.nextActionItems.length === 0 ? <p className="empty-copy">Noch keine klaren Next Actions in MIT/Fokus.</p> : null}
              <ul className="focus-note-list">
                {data.nextActionItems.map((entry) => {
                  const item = toNextActionEntry(entry)
                  return (
                  <li key={`next-action-${item.key}`} className="focus-note-row">
                    <button
                      className="focus-blocking-row-main"
                      onClick={() => {
                        setSelectedKey(item.key)
                      }}
                    >
                      <span className="focus-note-row-title">{item.title}</span>
                      <span className="focus-context-badge-row">
                        {item.nextActionHint ? <span className="focus-context-badge-chip">{truncateText(item.nextActionHint, 54)}</span> : null}
                        {entry.reasons.map((reason) => (
                          <span key={`${item.key}-${reason}`} className="focus-context-badge-chip">
                            {reason}
                          </span>
                        ))}
                      </span>
                    </button>
                    <button
                      className="icon-button compact muted"
                      onClick={() => {
                        openItemOrigin(item)
                      }}
                      disabled={!item.path}
                      title="Ursprung oeffnen"
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          <section className={`focus-panel ${data.focusMode === 'context' ? 'focus-panel-context-priority' : ''}`}>
            <header className="focus-panel-header">
              <h3>Kontext</h3>
              <span>{contextHits.length}</span>
            </header>
            {!selectedItem ? <p className="empty-copy">Waehle links einen Fokuspunkt aus.</p> : null}
            {selectedItem ? (
              <p className="focus-context-subtitle">
                Aktiv: {selectedItem.kind === 'task' ? 'Task' : 'Todo'} | {selectedItem.title}
              </p>
            ) : null}
            {selectedItem && contextHits.length === 0 ? <p className="empty-copy">Keine passenden Querverweise gefunden.</p> : null}
            <ul className="focus-context-list">
              {contextHits.map((note) => (
                <li key={note.key} className="focus-context-row">
                  <div className="focus-context-row-main">
                    <span className="focus-context-note-type">
                      <LucideNamedIcon name={noteTypeIcon(note.noteType)} size={12} />
                    </span>
                    <span className="focus-context-note-title">{cleanNoteTitle(note.title)}</span>
                    <span className="focus-context-reasons">{note.reasons.join(', ')}</span>
                  </div>
                  <button
                    className="icon-button compact muted"
                    onClick={() => {
                      const noteType = note.noteType.trim().toLowerCase() === 'task' ? 'task' : 'note'
                      onOpenNotePath(note.path, note.title, noteType)
                    }}
                    title={`Notiz oeffnen (${note.path})`}
                  >
                    <LucideNamedIcon name="ArrowUpRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {data.focusMode === 'context' ? (
            <section className="focus-panel focus-panel-context-priority">
              <header className="focus-panel-header">
                <h3>Daily Trail</h3>
                <span>{data.dailyTrailItems.length}</span>
              </header>
              <p className="focus-context-subtitle">Daily Notes der letzten Tage.</p>
              {data.dailyTrailItems.length === 0 ? <p className="empty-copy">Keine Daily Notes gefunden.</p> : null}
              <ul className="focus-note-list">
                {data.dailyTrailItems.map((dailyItem) => (
                  <li key={dailyItem.key} className="focus-note-row">
                    <div className="focus-note-row-main">
                      <span className="focus-note-row-title">{cleanNoteTitle(dailyItem.title)}</span>
                      {dailyItem.isToday ? <span className="focus-trail-today">Heute</span> : null}
                      <span className="focus-note-row-time">{toGermanTimestamp(dailyItem.updatedAt)}</span>
                    </div>
                    <button
                      className="icon-button compact muted"
                      onClick={() => {
                        onOpenNotePath(dailyItem.path, dailyItem.title, 'note')
                      }}
                      title="Daily oeffnen"
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {showAdvancedTaskSignals ? (
            <section className="focus-panel focus-panel-blocking">
              <header className="focus-panel-header">
                <h3>Blockiert / Warten auf</h3>
                <span>{blockingSectionItems.length}</span>
              </header>
              <p className="focus-context-subtitle">
                Blockiert: {data.blockedTaskCount} | Waiting: {data.waitingTaskCount} | Follow-up heute: {data.followUpTodayCount}
              </p>
              {blockingSectionItems.length === 0 ? <p className="empty-copy">Keine offenen Blocker oder Waiting-Themen.</p> : null}
              <ul className="focus-note-list">
                {blockingSectionItems.map((item) => (
                  <li key={`blocking-${item.key}`} className="focus-note-row">
                    <button
                      className="focus-blocking-row-main"
                      onClick={() => {
                        setSelectedKey(item.key)
                      }}
                    >
                      <span className="focus-note-row-title">{item.title}</span>
                      <span className="focus-context-badge-row">
                        {item.hasTaskBlocker ? <span className="focus-context-badge-chip">Blockiert</span> : null}
                        {item.hasExternalWaiting ? <span className="focus-context-badge-chip">Waiting</span> : null}
                        {item.unknownBlockerCount > 0 ? <span className="focus-context-badge-chip">{item.unknownBlockerCount} unbekannt</span> : null}
                        {item.followUpDate ? <span className="focus-context-badge-chip">Follow-up {toDotDateLabel(item.followUpDate)}</span> : null}
                        {showTaskTimeManagement && item.estimateMinutes !== null ? (
                          <span className="focus-context-badge-chip">{toEstimateLabel(item.estimateMinutes)}</span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      className="icon-button compact muted"
                      onClick={() => {
                        openItemOrigin(item)
                      }}
                      disabled={!item.path}
                      title="Ursprung oeffnen"
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {showAdvancedTaskSignals || showTaskTimeManagement ? (
            <section className="focus-panel focus-panel-hints">
              <header className="focus-panel-header">
                <h3>Planungshinweise</h3>
                <span>{planningHintEntries.length}</span>
              </header>
              {planningHintEntries.length === 0 ? <p className="empty-copy">Keine offenen Hygiene-Hinweise.</p> : null}
              {planningHintEntries.length > 0 ? (
                <ul className="focus-note-list">
                  {planningHintEntries.map((hint) => (
                    <li key={`hint-${hint.key}`} className="focus-note-row">
                      <div className="focus-note-row-main">
                        <span className="focus-note-row-title">{hint.label}</span>
                      </div>
                      <span className="focus-context-badge-chip">{hint.count}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {showAdvancedTaskSignals && data.planningHints.unknownBlockerReferenceCount > 0 ? (
                <p className="focus-context-subtitle">Unbekannte Blocker-Referenzen: {data.planningHints.unknownBlockerReferenceCount}</p>
              ) : null}
            </section>
          ) : null}

          {data.focusMode !== 'context' ? (
            <section className="focus-panel">
              <header className="focus-panel-header">
                <h3>Daily Trail</h3>
                <span>{data.dailyTrailItems.length}</span>
              </header>
              <p className="focus-context-subtitle">Daily Notes der letzten Tage.</p>
              {data.dailyTrailItems.length === 0 ? <p className="empty-copy">Keine Daily Notes gefunden.</p> : null}
              <ul className="focus-note-list">
                {data.dailyTrailItems.map((dailyItem) => (
                  <li key={dailyItem.key} className="focus-note-row">
                    <div className="focus-note-row-main">
                      <span className="focus-note-row-title">{cleanNoteTitle(dailyItem.title)}</span>
                      {dailyItem.isToday ? <span className="focus-trail-today">Heute</span> : null}
                      <span className="focus-note-row-time">{toGermanTimestamp(dailyItem.updatedAt)}</span>
                    </div>
                    <button
                      className="icon-button compact muted"
                      onClick={() => {
                        onOpenNotePath(dailyItem.path, dailyItem.title, 'note')
                      }}
                      title="Daily oeffnen"
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="focus-panel">
            <header className="focus-panel-header">
              <h3>Notizen heute</h3>
              <span>{data.notesToday.length}</span>
            </header>
            <p className="focus-context-subtitle">Notizen, die heute bearbeitet wurden.</p>
            <ul className="focus-note-list">
              {data.notesToday.length === 0 ? <li className="empty-copy">Heute noch keine Notizen.</li> : null}
              {data.notesToday.map((note) => (
                <li key={`${note.id}:${note.path}`} className="focus-note-row">
                  <div className="focus-note-row-main">
                    <span className="focus-note-row-title">{toMarkedRelativeNotePath(note.path, noteBasePath)}</span>
                    <span className="focus-note-row-time">{toGermanTimestamp(note.updated_at)}</span>
                  </div>
                  <button
                    className="icon-button compact muted"
                    onClick={() => {
                      const noteType = note.note_type.trim().toLowerCase() === 'task' ? 'task' : 'note'
                      onOpenNotePath(note.path, note.title, noteType)
                    }}
                    title="Notiz oeffnen"
                  >
                    <LucideNamedIcon name="ArrowUpRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import type { ReviewDashboardFilters, ReviewDashboardResponse } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'

type ReviewDashboardCanvasProps = {
  data: ReviewDashboardResponse | null
  filters: ReviewDashboardFilters
  onFiltersChange: (next: ReviewDashboardFilters) => void
  onOpenNotePath: (path: string, title?: string, noteType?: 'note' | 'task') => void
}

type ReviewWindowOption = {
  value: ReviewDashboardFilters['window']
  label: string
}

const WINDOW_OPTIONS: ReviewWindowOption[] = [
  { value: 'today', label: 'Heute' },
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: '90d', label: '90 Tage' },
]

function toDayLabel(dayIso: string): string {
  const [year, month, day] = dayIso.split('-')
  if (!year || !month || !day) {
    return dayIso
  }
  return `${day}.${month}`
}

function toRiskLabel(level: string): string {
  if (level === 'high') {
    return 'Hoch'
  }
  if (level === 'medium') {
    return 'Mittel'
  }
  return 'Niedrig'
}

function toPercent(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0
  return `${Math.round(normalized * 100)}%`
}

function buildTickIndices(length: number, maxTicks: number): number[] {
  if (length <= 0) {
    return []
  }
  if (length === 1) {
    return [0]
  }
  const ticks = new Set<number>([0, length - 1])
  const safeTicks = Math.max(2, maxTicks)
  for (let index = 1; index < safeTicks - 1; index += 1) {
    const ratio = index / (safeTicks - 1)
    ticks.add(Math.round((length - 1) * ratio))
  }
  return Array.from(ticks.values()).sort((left, right) => left - right)
}

function toBarHeight(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return '0%'
  }
  return `${Math.max(2, Math.round((value / maxValue) * 100))}%`
}

type YAxisTick = {
  ratio: number
  value: number
}

function buildYAxisTicks(maxValue: number): YAxisTick[] {
  const safeMax = Math.max(1, Math.round(maxValue))
  const ratios = safeMax <= 4 ? [1, 0.5, 0] : [1, 0.75, 0.5, 0.25, 0]
  return ratios.map((ratio) => ({
    ratio,
    value: Math.round(safeMax * ratio),
  }))
}

export function ReviewDashboardCanvas({ data, filters, onFiltersChange, onOpenNotePath }: ReviewDashboardCanvasProps) {
  const safeData = data

  const throughputMax = useMemo(() => {
    if (!safeData) {
      return 1
    }
    const maxValue = safeData.series.reduce((currentMax, point) => {
      const created = point.new_tasks + point.new_todos
      const done = point.completed_tasks + point.completed_todos
      return Math.max(currentMax, created, done)
    }, 0)
    return Math.max(maxValue, 1)
  }, [safeData])

  const backlogMax = useMemo(() => {
    if (!safeData) {
      return 1
    }
    const maxValue = safeData.series.reduce((currentMax, point) => {
      const openTotal = point.open_tasks + point.open_todos
      return Math.max(currentMax, openTotal)
    }, 0)
    return Math.max(maxValue, 1)
  }, [safeData])

  const tickIndices = useMemo(() => {
    if (!safeData) {
      return []
    }
    const count = safeData.series.length <= 7 ? safeData.series.length : safeData.series.length <= 30 ? 6 : 7
    return buildTickIndices(safeData.series.length, count)
  }, [safeData])

  const throughputYAxisTicks = useMemo(() => buildYAxisTicks(throughputMax), [throughputMax])
  const backlogYAxisTicks = useMemo(() => buildYAxisTicks(backlogMax), [backlogMax])

  if (!safeData) {
    return (
      <div className="review-canvas">
        <div className="review-canvas-header">
          <h2>Rückblick</h2>
          <p className="muted-copy">Keine Review-Daten geladen.</p>
        </div>
      </div>
    )
  }

  const periodLabel = `${safeData.period.from} bis ${safeData.period.to}`

  return (
    <div className="review-canvas">
      <div className="review-canvas-header">
        <div className="review-canvas-header-top">
          <h2>Rückblick</h2>
          <div className="review-window-switcher" role="tablist" aria-label="Review Zeitraum">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`review-window-switch-button ${filters.window === option.value ? 'active' : ''}`}
                onClick={() => {
                  if (filters.window === option.value) {
                    return
                  }
                  onFiltersChange({ ...filters, window: option.value })
                }}
                role="tab"
                aria-selected={filters.window === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p>
          Zeitraum: {periodLabel} | Risiko: {toRiskLabel(safeData.risk.level)} | Erledigungsquote: {toPercent(safeData.kpis.completion_ratio)}
        </p>
      </div>

      <section className="review-metric-grid" aria-label="Review KPI Karten">
        <article className="review-metric-card">
          <span className="review-metric-label">Offene Arbeit</span>
          <strong>{safeData.kpis.open_total_now}</strong>
          <span className="review-metric-subtext">
            Tasks {safeData.kpis.open_tasks_now} | Todos {safeData.kpis.open_todos_now}
          </span>
        </article>
        <article className="review-metric-card">
          <span className="review-metric-label">Neu (Zeitraum)</span>
          <strong>{safeData.kpis.new_work_period}</strong>
          <span className="review-metric-subtext">
            Tasks {safeData.kpis.new_tasks_period} | Todos {safeData.kpis.new_todos_period}
          </span>
        </article>
        <article className="review-metric-card">
          <span className="review-metric-label">Erledigt (Zeitraum)</span>
          <strong>{safeData.kpis.done_work_period}</strong>
          <span className="review-metric-subtext">
            Tasks {safeData.kpis.done_tasks_period} | Todos {safeData.kpis.done_todos_period}
          </span>
        </article>
        <article className="review-metric-card">
          <span className="review-metric-label">Backlog Delta</span>
          <strong className={safeData.kpis.backlog_delta > 0 ? 'review-trend-up' : safeData.kpis.backlog_delta < 0 ? 'review-trend-down' : ''}>
            {safeData.kpis.backlog_delta > 0 ? '+' : ''}
            {safeData.kpis.backlog_delta}
          </strong>
          <span className="review-metric-subtext">
            Start {safeData.kpis.backlog_start} -&gt; Ende {safeData.kpis.backlog_end}
          </span>
        </article>
        <article className="review-metric-card">
          <span className="review-metric-label">Notizen</span>
          <strong>{safeData.kpis.new_notes_period}</strong>
          <span className="review-metric-subtext">Aktualisiert: {safeData.kpis.notes_updated_period}</span>
        </article>
        <article className="review-metric-card">
          <span className="review-metric-label">Überfällige Tasks</span>
          <strong>{safeData.kpis.overdue_open_tasks}</strong>
          <span className="review-metric-subtext">Im aktuellen Backlog</span>
        </article>
      </section>

      <div className="review-canvas-grid">
        <section className="review-panel">
          <header className="review-panel-header">
            <h3>Durchsatz</h3>
          </header>
          <div className="review-chart-shell">
            <div className="review-chart-frame">
              <div className="review-y-axis" aria-hidden="true">
                {throughputYAxisTicks.map((tick) => (
                  <span key={`throughput-y-${tick.ratio}`} className="review-y-axis-tick" style={{ top: `${(1 - tick.ratio) * 100}%` }}>
                    {tick.value}
                  </span>
                ))}
              </div>
              <div className="review-throughput-chart">
                {safeData.series.map((point) => {
                  const created = point.new_tasks + point.new_todos
                  const done = point.completed_tasks + point.completed_todos
                  return (
                    <div
                      key={point.date}
                      className="review-throughput-column"
                      role="img" aria-label={`${point.date} | Neu ${created} | Erledigt ${done}`}
                      data-tooltip={`${point.date} | Neu ${created} | Erledigt ${done}`}
                    >
                      <div className="review-throughput-bars">
                        <span className="review-throughput-bar created" style={{ height: toBarHeight(created, throughputMax) }} />
                        <span className="review-throughput-bar done" style={{ height: toBarHeight(done, throughputMax) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="review-axis-ticks" aria-hidden="true">
              {tickIndices.map((index) => {
                const ratio = safeData.series.length > 1 ? index / (safeData.series.length - 1) : 0
                const tickClass = index === 0 ? 'is-start' : index === safeData.series.length - 1 ? 'is-end' : ''
                return (
                  <span key={`throughput-${index}`} className={`review-axis-tick ${tickClass}`} style={{ left: `${ratio * 100}%` }}>
                    {toDayLabel(safeData.series[index]?.date ?? '')}
                  </span>
                )
              })}
            </div>
          </div>
          <p className="review-chart-legend">
            <span className="legend-dot created" /> Neu
            <span className="legend-dot done" /> Erledigt
          </p>
        </section>

        <section className="review-panel">
          <header className="review-panel-header">
            <h3>Backlog Verlauf</h3>
            <div className="review-inline-toggle" role="tablist" aria-label="Backlog Darstellung">
              <button
                className={`review-inline-toggle-button ${filters.backlogMode === 'grouped' ? 'active' : ''}`}
                onClick={() => {
                  if (filters.backlogMode === 'grouped') {
                    return
                  }
                  onFiltersChange({ ...filters, backlogMode: 'grouped' })
                }}
                role="tab"
                aria-selected={filters.backlogMode === 'grouped'}
                data-tooltip="Tasks und Todos nebeneinander"
              >
                Nebeneinander
              </button>
              <button
                className={`review-inline-toggle-button ${filters.backlogMode === 'stacked' ? 'active' : ''}`}
                onClick={() => {
                  if (filters.backlogMode === 'stacked') {
                    return
                  }
                  onFiltersChange({ ...filters, backlogMode: 'stacked' })
                }}
                role="tab"
                aria-selected={filters.backlogMode === 'stacked'}
                data-tooltip="Tasks und Todos gestapelt"
              >
                Gestapelt
              </button>
            </div>
          </header>
          <div className="review-chart-shell">
            <div className="review-chart-frame">
              <div className="review-y-axis" aria-hidden="true">
                {backlogYAxisTicks.map((tick) => (
                  <span key={`backlog-y-${tick.ratio}`} className="review-y-axis-tick" style={{ top: `${(1 - tick.ratio) * 100}%` }}>
                    {tick.value}
                  </span>
                ))}
              </div>
              <div className={`review-backlog-chart ${filters.backlogMode === 'stacked' ? 'is-stacked' : ''}`}>
                {safeData.series.map((point) => {
                  const totalOpen = point.open_tasks + point.open_todos
                  return (
                    <div
                      key={point.date}
                      className="review-backlog-column"
                      role="img" aria-label={`${point.date} | Offen ${totalOpen} (Tasks ${point.open_tasks}, Todos ${point.open_todos})`}
                      data-tooltip={`${point.date} | Offen ${totalOpen} (Tasks ${point.open_tasks}, Todos ${point.open_todos})`}
                    >
                      <div className="review-backlog-bars">
                        <span className="review-backlog-bar tasks" style={{ height: toBarHeight(point.open_tasks, backlogMax) }} />
                        <span className="review-backlog-bar todos" style={{ height: toBarHeight(point.open_todos, backlogMax) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="review-axis-ticks" aria-hidden="true">
              {tickIndices.map((index) => {
                const ratio = safeData.series.length > 1 ? index / (safeData.series.length - 1) : 0
                const tickClass = index === 0 ? 'is-start' : index === safeData.series.length - 1 ? 'is-end' : ''
                return (
                  <span key={`backlog-${index}`} className={`review-axis-tick ${tickClass}`} style={{ left: `${ratio * 100}%` }}>
                    {toDayLabel(safeData.series[index]?.date ?? '')}
                  </span>
                )
              })}
            </div>
          </div>
          <p className="review-chart-legend">
            <span className="legend-dot tasks" /> Tasks offen
            <span className="legend-dot todos" /> Todos offen
          </p>
        </section>
      </div>

      <div className={`review-risk-strip review-risk-${safeData.risk.level}`}>
        <strong>Risiko: {toRiskLabel(safeData.risk.level)}</strong>
        {safeData.risk.reasons.length > 0 ? (
          <ul>
            {safeData.risk.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p>Keine kritischen Überlastungssignale für den gewählten Zeitraum erkannt.</p>
        )}
      </div>

      <div className="review-bottom-grid">
        <section className="review-panel review-top-panel">
          <header className="review-panel-header">
            <h3>Top bearbeitete Notizen</h3>
            <span>{safeData.top_notes.length}</span>
          </header>
          {safeData.top_notes.length === 0 ? (
            <p className="empty-copy">Keine Aktivität im gewählten Zeitraum.</p>
          ) : (
            <ul className="review-top-note-list">
              {safeData.top_notes.map((entry) => {
                const normalizedType = entry.note_type.trim().toLowerCase()
                return (
                  <li key={entry.path} className="review-top-note-row">
                    <div className="review-top-note-main">
                      <strong>{entry.title}</strong>
                      <p>
                        Events: {entry.activity_events} | Note {entry.note_events} | Todo {entry.todo_events}
                      </p>
                      <p className="muted-copy">Update: {entry.updated_at || '-'}</p>
                    </div>
                    <button
                      className="icon-button compact muted"
                      aria-label="Notiz öffnen" data-tooltip="Notiz öffnen"
                      onClick={() => {
                        onOpenNotePath(entry.path, entry.title, normalizedType === 'task' ? 'task' : 'note')
                      }}
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="review-panel review-top-panel">
          <header className="review-panel-header">
            <h3>Top bearbeitete Tasks</h3>
            <span>{safeData.top_tasks.length}</span>
          </header>
          {safeData.top_tasks.length === 0 ? (
            <p className="empty-copy">Keine Task-Aktivitaet im gewählten Zeitraum.</p>
          ) : (
            <ul className="review-top-note-list">
              {safeData.top_tasks.map((entry) => (
                <li key={entry.path} className="review-top-note-row">
                  <div className="review-top-note-main">
                    <strong>{entry.title}</strong>
                    <p>
                      Events: {entry.activity_events} | Neu {entry.created_events} | Erledigt {entry.done_events}
                    </p>
                    <p className="muted-copy">Update: {entry.updated_at || '-'}</p>
                  </div>
                  <button
                    className="icon-button compact muted"
                    aria-label="Task öffnen" data-tooltip="Task öffnen"
                    onClick={() => {
                      onOpenNotePath(entry.path, entry.title, 'task')
                    }}
                  >
                    <LucideNamedIcon name="ArrowUpRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="review-panel review-top-panel">
          <header className="review-panel-header">
            <h3>Erledigte Tasks und Todos</h3>
            <span>{safeData.completed_items.length}</span>
          </header>
          {safeData.completed_items.length === 0 ? (
            <p className="empty-copy">Keine erledigten Items im gewählten Zeitraum.</p>
          ) : (
            <ul className="review-top-note-list">
              {safeData.completed_items.map((entry, index) => {
                const normalizedType = entry.note_type.trim().toLowerCase()
                return (
                  <li key={`${entry.path}-${entry.completed_at}-${index}`} className="review-top-note-row">
                    <div className="review-top-note-main">
                      <strong>{entry.title}</strong>
                      <p>
                        {entry.kind === 'task' ? 'Task' : 'Todo'} erledigt am {entry.completed_at}
                      </p>
                    </div>
                    <button
                      className="icon-button compact muted"
                      aria-label="Eintrag öffnen" data-tooltip="Eintrag öffnen"
                      onClick={() => {
                        const noteType = entry.kind === 'task' || normalizedType === 'task' ? 'task' : 'note'
                        onOpenNotePath(entry.path, entry.title, noteType)
                      }}
                    >
                      <LucideNamedIcon name="ArrowUpRight" size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

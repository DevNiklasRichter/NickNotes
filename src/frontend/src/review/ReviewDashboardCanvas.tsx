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

  const xLabelStep = useMemo(() => {
    if (!safeData || safeData.series.length <= 1) {
      return 1
    }
    return Math.max(1, Math.floor(safeData.series.length / 7))
  }, [safeData])

  if (!safeData) {
    return (
      <div className="review-canvas">
        <div className="review-canvas-header">
          <h2>Review Dashboard</h2>
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
          <h2>Review Dashboard</h2>
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
          <span className="review-metric-label">Ueberfaellige Tasks</span>
          <strong>{safeData.kpis.overdue_open_tasks}</strong>
          <span className="review-metric-subtext">Im aktuellen Backlog</span>
        </article>
      </section>

      <div className="review-canvas-grid">
        <section className="review-panel">
          <header className="review-panel-header">
            <h3>Durchsatz</h3>
            <button
              className={`review-chart-mode-toggle ${filters.chartMode === 'throughput' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ ...filters, chartMode: 'throughput' })}
              title="Neu vs erledigt pro Tag"
            >
              <LucideNamedIcon name="BarChart3" size={14} />
            </button>
          </header>
          <div className={`review-throughput-chart ${filters.chartMode === 'throughput' ? 'is-active' : ''}`}>
            {safeData.series.map((point, index) => {
              const created = point.new_tasks + point.new_todos
              const done = point.completed_tasks + point.completed_todos
              const createdHeight = `${Math.max(4, Math.round((created / throughputMax) * 100))}%`
              const doneHeight = `${Math.max(4, Math.round((done / throughputMax) * 100))}%`
              const showLabel = index % xLabelStep === 0 || index === safeData.series.length - 1
              return (
                <div
                  key={point.date}
                  className="review-throughput-column"
                  title={`${point.date} | Neu ${created} | Erledigt ${done}`}
                >
                  <div className="review-throughput-bars">
                    <span className="review-throughput-bar created" style={{ height: createdHeight }} />
                    <span className="review-throughput-bar done" style={{ height: doneHeight }} />
                  </div>
                  <span className="review-throughput-label">{showLabel ? toDayLabel(point.date) : ''}</span>
                </div>
              )
            })}
          </div>
          <p className="review-chart-legend">
            <span className="legend-dot created" /> Neu
            <span className="legend-dot done" /> Erledigt
          </p>
        </section>

        <section className="review-panel">
          <header className="review-panel-header">
            <h3>Backlog Verlauf</h3>
            <button
              className={`review-chart-mode-toggle ${filters.chartMode === 'backlog' ? 'active' : ''}`}
              onClick={() => onFiltersChange({ ...filters, chartMode: 'backlog' })}
              title="Offene Tasks und Todos pro Tag"
            >
              <LucideNamedIcon name="ChartNoAxesCombined" size={14} />
            </button>
          </header>
          <div className={`review-backlog-chart ${filters.chartMode === 'backlog' ? 'is-active' : ''}`}>
            {safeData.series.map((point, index) => {
              const totalOpen = point.open_tasks + point.open_todos
              const taskHeight = `${Math.max(2, Math.round((point.open_tasks / backlogMax) * 100))}%`
              const todoHeight = `${Math.max(2, Math.round((point.open_todos / backlogMax) * 100))}%`
              const showLabel = index % xLabelStep === 0 || index === safeData.series.length - 1
              return (
                <div
                  key={point.date}
                  className="review-backlog-column"
                  title={`${point.date} | Open ${totalOpen} (Tasks ${point.open_tasks}, Todos ${point.open_todos})`}
                >
                  <div className="review-backlog-bars">
                    <span className="review-backlog-bar tasks" style={{ height: taskHeight }} />
                    <span className="review-backlog-bar todos" style={{ height: todoHeight }} />
                  </div>
                  <span className="review-throughput-label">{showLabel ? toDayLabel(point.date) : ''}</span>
                </div>
              )
            })}
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
          <p>Keine kritischen Ueberlastungssignale fuer den gewaehlten Zeitraum erkannt.</p>
        )}
      </div>

      <section className="review-panel review-top-panel">
        <header className="review-panel-header">
          <h3>Top bearbeitete Notizen</h3>
          <span>{safeData.top_notes.length}</span>
        </header>
        {safeData.top_notes.length === 0 ? (
          <p className="empty-copy">Keine Aktivitaet im gewaehlten Zeitraum.</p>
        ) : (
          <ul className="review-top-note-list">
            {safeData.top_notes.map((entry) => {
              const normalizedType = entry.note_type.trim().toLowerCase()
              return (
                <li key={entry.path} className="review-top-note-row">
                  <div className="review-top-note-main">
                    <strong>{entry.title}</strong>
                    <p>
                      Events: {entry.activity_events} | Note {entry.note_events} | Task {entry.task_events} | Todo {entry.todo_events}
                    </p>
                    <p className="muted-copy">Update: {entry.updated_at || '-'}</p>
                  </div>
                  <button
                    className="icon-button compact muted"
                    title="Notiz oeffnen"
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
    </div>
  )
}

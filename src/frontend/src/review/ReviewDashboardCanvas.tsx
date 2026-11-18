import { useMemo, useState } from 'react'
import type { ReviewAttentionGroup, ReviewDashboardFilters, ReviewDashboardItem, ReviewDashboardResponse } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { buildReviewBuckets, formatShortDay, formatSignedDelta, groupCompletedByDay, type ReviewBucket } from './reviewSeries'

type ReviewDashboardCanvasProps = {
  data: ReviewDashboardResponse | null
  filters: ReviewDashboardFilters
  onFiltersChange: (next: ReviewDashboardFilters) => void
  onOpenNotePath: (path: string, title?: string, noteType?: 'note' | 'task') => void
  onToggleTodo: (todoId: string, checked: boolean) => void
}

const WINDOW_OPTIONS: Array<{ value: ReviewDashboardFilters['window']; label: string }> = [
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: '90d', label: '90 Tage' },
]

type AttentionKey = keyof ReviewDashboardResponse['attention']

const ATTENTION_GROUPS: Array<{ key: AttentionKey; title: string; icon: string }> = [
  { key: 'overdue', title: 'Überfällig', icon: 'AlertCircle' },
  { key: 'follow_up', title: 'Wiedervorlage fällig', icon: 'CalendarDays' },
  { key: 'waiting', title: 'Wartet oder blockiert', icon: 'MoreHorizontal' },
  { key: 'stale_todos', title: 'Liegt lange offen', icon: 'ListTodo' },
]

const DATA_BASIS_HINT =
  'Grundlage sind die Erstell- und Erledigt-Zeitpunkte in den Markdown-Dateien. Ein ToDo zählt ab dem ersten Speichern in NickNotes; ' +
  'ohne diesen Zeitpunkt gilt das Datum der Notiz. Gelöschte Einträge verschwinden auch rückwirkend aus dem Verlauf. ' +
  'Zu Tasks gemachte ToDos zählen nur als Task, Checklisten innerhalb von Tasks zählen nicht.'

function itemContext(groupKey: AttentionKey, item: ReviewDashboardItem): string {
  if (groupKey === 'overdue') {
    return `fällig seit ${formatShortDay(item.date)}`
  }
  if (groupKey === 'follow_up') {
    return `Wiedervorlage ${formatShortDay(item.date)}`
  }
  if (groupKey === 'waiting') {
    return item.detail ? `wartet: ${item.detail}` : 'pausiert'
  }
  return `offen seit ${formatShortDay(item.date)} · ${item.source_title}`
}

function bucketReadout(bucket: ReviewBucket): string {
  const open = bucket.openTasks + bucket.openTodos
  return `${bucket.label}: ${open} offen (${bucket.openTasks} Tasks, ${bucket.openTodos} ToDos) · ${bucket.newCount} neu · ${bucket.doneCount} erledigt`
}

function ReviewTrend({ buckets }: { buckets: ReviewBucket[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const count = buckets.length
  const openValues = buckets.map((bucket) => bucket.openTasks + bucket.openTodos)
  const openMax = Math.max(1, ...openValues)
  const flowMax = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.newCount, bucket.doneCount)))
  const activeIndex = hoverIndex ?? count - 1
  const active = buckets[activeIndex]
  const toY = (value: number) => 100 - (value / openMax) * 92
  const linePoints = openValues.map((value, index) => `${index + 0.5},${toY(value)}`).join(' ')
  const areaPoints = `0.5,100 ${linePoints} ${count - 0.5},100`
  const tickIndices = count <= 1 ? [0] : [0, Math.floor((count - 1) / 2), count - 1]

  return (
    <section className="review-panel review-trend-panel" aria-label="Verlauf">
      <header className="review-panel-header">
        <h3>Verlauf</h3>
        <p className="review-trend-readout" aria-live="polite">{active ? bucketReadout(active) : ''}</p>
      </header>
      <div className="review-trend-charts" onMouseLeave={() => setHoverIndex(null)}>
        <span className="review-chart-caption">Offen</span>
        <div className="review-chart review-open-chart">
          <span className="review-chart-max" aria-hidden="true">{openMax}</span>
          <svg viewBox={`0 0 ${count} 100`} preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2={count} y1={toY(openMax)} y2={toY(openMax)} className="review-gridline" vectorEffect="non-scaling-stroke" />
            <polygon points={areaPoints} className="review-open-area" />
            <polyline points={linePoints} className="review-open-line" vectorEffect="non-scaling-stroke" />
            {hoverIndex !== null ? (
              <line x1={hoverIndex + 0.5} x2={hoverIndex + 0.5} y1="0" y2="100" className="review-crosshair" vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>
          {hoverIndex !== null ? (
            <span className="review-open-marker" style={{ left: `${((hoverIndex + 0.5) / count) * 100}%`, top: `${toY(openValues[hoverIndex])}%` }} aria-hidden="true" />
          ) : null}
        </div>
        <span className="review-chart-caption">Neu und erledigt</span>
        <div className="review-chart review-flow-chart" aria-hidden="true">
          <span className="review-chart-max">{flowMax}</span>
          {buckets.map((bucket, index) => (
            <div key={bucket.from} className={`review-flow-column ${hoverIndex === index ? 'is-active' : ''}`}>
              <span className="review-flow-bar is-new" style={{ height: `${(bucket.newCount / flowMax) * 100}%` }} />
              <span className="review-flow-bar is-done" style={{ height: `${(bucket.doneCount / flowMax) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="review-hover-layer" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {buckets.map((bucket, index) => (
            <span key={bucket.from} onMouseEnter={() => setHoverIndex(index)} />
          ))}
        </div>
        <div className="review-axis" aria-hidden="true">
          {tickIndices.map((index, position) => (
            <span
              key={`${index}-${position}`}
              className={position === 0 ? 'is-start' : position === tickIndices.length - 1 ? 'is-end' : ''}
              style={{ left: `${((index + 0.5) / count) * 100}%` }}
            >
              {formatShortDay(buckets[index]?.from ?? '')}
            </span>
          ))}
        </div>
      </div>
      <p className="review-chart-legend">
        <span><i className="legend-swatch is-open" />Offen gesamt</span>
        <span><i className="legend-swatch is-new" />Neu</span>
        <span><i className="legend-swatch is-done" />Erledigt</span>
      </p>
      <div className="review-sr-only">
      <table>
        <caption>Verlauf je {buckets.length > 0 && buckets[0].from !== buckets[0].to ? 'Woche' : 'Tag'}</caption>
        <thead>
          <tr><th>Zeitraum</th><th>Offen</th><th>Neu</th><th>Erledigt</th></tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.from}>
              <td>{bucket.label}</td>
              <td>{bucket.openTasks + bucket.openTodos}</td>
              <td>{bucket.newCount}</td>
              <td>{bucket.doneCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}

export function ReviewDashboardCanvas({ data, filters, onFiltersChange, onOpenNotePath, onToggleTodo }: ReviewDashboardCanvasProps) {
  const buckets = useMemo(() => (data ? buildReviewBuckets(data.series) : []), [data])
  const completedDays = useMemo(() => (data ? groupCompletedByDay(data.completed_items) : []), [data])

  const header = (
    <div className="review-canvas-header">
      <h2>Rückblick</h2>
      <div className="review-window-switcher" role="tablist" aria-label="Zeitraum">
        {WINDOW_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`review-window-switch-button ${filters.window === option.value ? 'active' : ''}`}
            onClick={() => {
              if (filters.window !== option.value) {
                onFiltersChange({ ...filters, window: option.value })
              }
            }}
            role="tab"
            aria-selected={filters.window === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  if (!data) {
    return (
      <div className="review-canvas">
        {header}
        <p className="muted-copy">Rückblick wird geladen …</p>
      </div>
    )
  }

  const { summary } = data
  const done = summary.done_tasks + summary.done_todos
  const created = summary.new_tasks + summary.new_todos
  const openEnd = summary.open_tasks_end + summary.open_todos_end
  const openStart = summary.open_tasks_start + summary.open_todos_start
  const attentionTotal = ATTENTION_GROUPS.reduce((sum, group) => sum + data.attention[group.key].total, 0)

  const openItem = (item: ReviewDashboardItem) => onOpenNotePath(item.path, item.kind === 'task' ? item.title : item.source_title, item.kind === 'task' ? 'task' : 'note')

  const renderAttentionGroup = (key: AttentionKey, title: string, icon: string, group: ReviewAttentionGroup) => {
    if (group.total === 0) {
      return null
    }
    return (
      <section key={key} className="review-attention-group">
        <h4>
          <LucideNamedIcon name={icon} size={13} />
          {title}
          <span className="review-count">{group.total}</span>
        </h4>
        <ul className="review-item-list">
          {group.items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="review-item-row">
              {item.kind === 'todo' ? (
                <input
                  type="checkbox"
                  className="review-item-check"
                  aria-label={`„${item.title}“ abhaken`}
                  data-tooltip="Abhaken"
                  onChange={() => onToggleTodo(item.id, true)}
                />
              ) : null}
              <button className="review-item-main" onClick={() => openItem(item)} data-tooltip={item.kind === 'task' ? 'Task öffnen' : 'Notiz öffnen'}>
                <span className="review-item-title">{item.title}</span>
                <span className="review-item-meta">{itemContext(key, item)}</span>
              </button>
            </li>
          ))}
        </ul>
        {group.total > group.items.length ? <p className="review-more">und {group.total - group.items.length} weitere</p> : null}
      </section>
    )
  }

  return (
    <div className="review-canvas">
      {header}

      <p className="review-summary">
        <strong>{done}</strong> erledigt · <strong>{created}</strong> neu · <strong>{openEnd}</strong> offen
        <span className="review-summary-delta" data-tooltip={`Zu Beginn des Zeitraums waren ${openStart} offen.`}>
          {' '}({formatSignedDelta(openEnd - openStart)})
        </span>
        <span className="review-summary-period"> · {formatShortDay(data.period.from)}–{formatShortDay(data.period.to)}</span>
        <span className="review-info" tabIndex={0} aria-label={DATA_BASIS_HINT} data-tooltip={DATA_BASIS_HINT}>
          <LucideNamedIcon name="Info" size={13} />
        </span>
      </p>

      <ReviewTrend buckets={buckets} />

      <div className="review-columns">
        <section className="review-panel" aria-label="Braucht Aufmerksamkeit">
          <header className="review-panel-header">
            <h3>Braucht Aufmerksamkeit</h3>
            {attentionTotal > 0 ? <span className="review-count">{attentionTotal}</span> : null}
          </header>
          {attentionTotal === 0 ? (
            <p className="empty-copy">Nichts liegt quer: keine überfälligen, wartenden oder seit {data.stale_todo_days} Tagen offenen Einträge.</p>
          ) : (
            <div className="review-attention-groups">
              {ATTENTION_GROUPS.map((group) => renderAttentionGroup(group.key, group.title, group.icon, data.attention[group.key]))}
            </div>
          )}
        </section>

        <section className="review-panel" aria-label="Erledigt">
          <header className="review-panel-header">
            <h3>Erledigt</h3>
            {data.completed_total > 0 ? <span className="review-count">{data.completed_total}</span> : null}
          </header>
          {completedDays.length === 0 ? (
            <p className="empty-copy">Im gewählten Zeitraum wurde nichts abgehakt.</p>
          ) : (
            <div className="review-completed-days">
              {completedDays.map((day) => (
                <section key={day.day} className="review-completed-day">
                  <h4>{day.label}</h4>
                  <ul className="review-item-list">
                    {day.items.map((item, index) => (
                      <li key={`${item.kind}-${item.id}-${index}`} className="review-item-row">
                        <LucideNamedIcon name="Check" size={13} className="review-done-icon" />
                        <button className="review-item-main" onClick={() => openItem(item)} data-tooltip={item.kind === 'task' ? 'Task öffnen' : 'Notiz öffnen'}>
                          <span className="review-item-title">{item.title}</span>
                          <span className="review-item-meta">{item.kind === 'task' ? 'Task' : item.source_title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {data.completed_total > data.completed_items.length ? (
                <p className="review-more">und {data.completed_total - data.completed_items.length} ältere</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

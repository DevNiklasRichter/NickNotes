import { describe, expect, it } from 'vitest'
import type { ReviewDashboardCompletedItem, ReviewDashboardSeriesPoint } from '../app/AppShared'
import { buildReviewBuckets, formatSignedDelta, groupCompletedByDay } from './reviewSeries'

function point(date: string, values: Partial<ReviewDashboardSeriesPoint> = {}): ReviewDashboardSeriesPoint {
  return { date, new_tasks: 0, new_todos: 0, completed_tasks: 0, completed_todos: 0, open_tasks: 0, open_todos: 0, focus_minutes: 0, ...values }
}

function days(from: string, count: number): string[] {
  const [year, month, day] = from.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1, day + index)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
}

describe('buildReviewBuckets', () => {
  it('keeps one column per day for short periods', () => {
    const buckets = buildReviewBuckets([
      point('2026-11-16', { new_todos: 2, completed_tasks: 1, open_tasks: 3, open_todos: 4 }),
      point('2026-11-17', { new_tasks: 1, open_tasks: 4, open_todos: 4 }),
    ])
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({ from: '2026-11-16', newCount: 2, doneCount: 1, openTasks: 3, openTodos: 4 })
    expect(buckets[0].label).toBe('Mo, 16.11.')
  })

  it('sums flow per calendar week and keeps the open count of its last day', () => {
    const series = days('2026-08-20', 90).map((date, index) => point(date, { new_todos: 1, open_todos: index }))
    const buckets = buildReviewBuckets(series)
    // 20.08.2026 is a Thursday: the first week is partial (Thu to Sun).
    expect(buckets[0]).toMatchObject({ from: '2026-08-20', to: '2026-08-23', newCount: 4, openTodos: 3 })
    expect(buckets[1]).toMatchObject({ from: '2026-08-24', to: '2026-08-30', newCount: 7, openTodos: 10 })
    expect(buckets[1].label).toBe('KW 35 (24.08.–30.08.)')
    expect(buckets.reduce((sum, bucket) => sum + bucket.newCount, 0)).toBe(90)
  })

  it('sums focus minutes per week', () => {
    const series = days('2026-08-24', 14).map((date, index) => point(date, { focus_minutes: index < 7 ? 25 : 50 }))
    const buckets = buildReviewBuckets([...days('2026-07-01', 54).map((date) => point(date)), ...series])
    expect(buckets.at(-2)).toMatchObject({ from: '2026-08-24', focusMinutes: 175 })
    expect(buckets.at(-1)).toMatchObject({ from: '2026-08-31', focusMinutes: 350 })
  })
})

describe('groupCompletedByDay', () => {
  it('groups the newest-first list by completion day', () => {
    const item = (title: string, date: string): ReviewDashboardCompletedItem => ({
      kind: 'todo', id: title, path: 'a.md', title, source_title: 'Notiz', date, detail: '', completed_at: `${date}T10:00:00`,
    })
    const groups = groupCompletedByDay([item('A', '2026-11-17'), item('B', '2026-11-17'), item('C', '2026-11-14')])
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([['Di, 17.11.', 2], ['Sa, 14.11.', 1]])
  })
})

describe('formatSignedDelta', () => {
  it('shows direction explicitly', () => {
    expect([formatSignedDelta(7), formatSignedDelta(-3), formatSignedDelta(0)]).toEqual(['+7', '−3', '±0'])
  })
})

import { describe, expect, test } from 'vitest'
import type { SearchRow, TaskRow, TodoRow } from '../app/AppShared'
import { addDays, buildFocusDashboardData, deferOptions, normalizeMitIds, toPlainTodoText, toShortDayLabel, toTaskReasonLabel } from './focusDashboardModel'

const TODAY = '2026-11-18' // a Wednesday

function task(id: string, overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    title: overrides.title ?? `Task ${id}`,
    status: 'open',
    priority: 'medium',
    due_date: null,
    project_tag: null,
    estimate_minutes: null,
    completed_at: null,
    blocked_by_ids: [],
    waiting_for: null,
    follow_up_date: null,
    blocked_reason: null,
    next_action_hint: null,
    repeat: null,
    tags: [],
    related: [],
    updated_at: '2026-11-10T08:00:00+01:00',
    path: `/nb/tasks/${id}.md`,
    ...overrides,
  }
}

function todo(id: string, overrides: Partial<TodoRow> = {}): TodoRow {
  return {
    id,
    note_id: 'daily_today',
    note_title: TODAY,
    note_path: `/nb/daily/2026-11/${TODAY}.md`,
    line_no: 1,
    block_ref: null,
    checked: false,
    raw_text: `To-do ${id}`,
    explicit_tags: [],
    inherited_tags: [],
    links: [],
    promoted: false,
    promoted_task_id: null,
    created_at: `${TODAY}T08:00:00+01:00`,
    completed_at: null,
    updated_at: `${TODAY}T08:00:00+01:00`,
    ...overrides,
  }
}

function note(id: string, updatedAt: string, overrides: Partial<SearchRow> = {}): SearchRow {
  return { id, title: `Notiz ${id}`, note_type: 'note', updated_at: updatedAt, path: `/nb/${id}.md`, ...overrides }
}

function build(args: { tasks?: TaskRow[]; todos?: TodoRow[]; notes?: SearchRow[]; mitIds?: string[]; query?: string }) {
  return buildFocusDashboardData({ tasks: args.tasks ?? [], todos: args.todos ?? [], notes: args.notes ?? [], mitIds: args.mitIds ?? [], todayIso: TODAY, query: args.query })
}

describe('focus tasks', () => {
  test('shows due, overdue, in-progress and resumed tasks today; hides undated backlog', () => {
    const data = build({
      tasks: [
        task('late', { due_date: '2026-11-15' }),
        task('today', { due_date: TODAY, priority: 'high' }),
        task('doing', { status: 'in_progress' }),
        task('resumed', { follow_up_date: TODAY }),
        task('backlog'),
        task('done', { status: 'done', due_date: '2026-11-01' }),
      ],
    })
    expect(data.tasksToday.map((item) => item.id)).toEqual(['late', 'today', 'resumed', 'doing'])
    expect(data.tasksToday[0].overdueDays).toBe(3)
    expect(data.stats.overdue).toBe(1)
  })

  test('a Wiedervorlage date in the future hides even an overdue task until that day', () => {
    const data = build({ tasks: [task('waiting', { due_date: '2026-11-10', follow_up_date: '2026-11-21' })] })
    expect(data.tasksToday).toEqual([])
    expect(data.tasksDeferred.map((item) => item.id)).toEqual(['waiting'])
    expect(toTaskReasonLabel(data.tasksDeferred[0], TODAY)).toBe('ab Sa. 21.11.')
    expect(data.stats).toMatchObject({ overdue: 0, deferred: 1 })
  })

  test('the day of the Wiedervorlage brings it back, also for paused tasks', () => {
    const data = build({
      tasks: [
        task('back', { status: 'on_hold', due_date: '2026-11-10', follow_up_date: TODAY }),
        task('paused', { status: 'on_hold', due_date: '2026-11-10' }),
      ],
    })
    expect(data.tasksToday.map((item) => [item.id, item.reason])).toEqual([['back', 'resumed']])
    expect(toTaskReasonLabel(data.tasksToday[0], TODAY)).toBe('wieder dran · seit 8 T. fällig')
  })

  test('tasks due within a week wait in the upcoming group', () => {
    const data = build({ tasks: [task('soon', { due_date: '2026-11-20' }), task('later', { due_date: '2026-12-20' })] })
    expect(data.tasksUpcoming.map((item) => item.id)).toEqual(['soon'])
    expect(data.tasksToday).toEqual([])
  })
})

describe('focus to-dos', () => {
  test('separates today from earlier, keeps checked-today items in place and skips promoted ones', () => {
    const data = build({
      todos: [
        todo('a'),
        todo('b', { checked: true, completed_at: `${TODAY}T09:00:00+01:00` }),
        todo('old', { note_path: '/nb/Projekt.md', note_title: 'Projekt', created_at: '2026-11-12T10:00:00+01:00' }),
        todo('legacy', { note_path: '/nb/Alt.md', note_title: 'Alt', created_at: null }),
        todo('done-earlier', { checked: true, completed_at: '2026-11-17T09:00:00+01:00' }),
        todo('promoted', { promoted: true, promoted_task_id: 'tk_1' }),
      ],
    })
    expect(data.todosToday.map((item) => item.id)).toEqual(['a', 'b'])
    expect(data.todosEarlier.map((item) => item.id)).toEqual(['old', 'legacy'])
    expect(data.openTodosToday).toBe(1)
    expect(data.stats.doneToday).toBe(1)
  })

  test('a to-do in today\'s daily note counts as today even without a creation time', () => {
    const data = build({ todos: [todo('x', { created_at: null })] })
    expect(data.todosToday.map((item) => item.id)).toEqual(['x'])
  })
})

describe('focus MIT, notes and stats', () => {
  test('MIT keeps at most three resolvable entries and blocks a fourth', () => {
    const tasks = [task('t1'), task('t2'), task('t3', { status: 'done' })]
    const todos = [todo('d1')]
    expect(normalizeMitIds(['task:t1', 'task:missing', 't2', 'todo:d1', 'task:t3'], tasks, todos)).toEqual(['task:t1', 'task:t2', 'todo:d1'])
    const data = build({ tasks, todos, mitIds: ['task:t1', 'task:t3', 'todo:d1'] })
    expect(data.mitEntries.map((entry) => [entry.key, entry.isDone])).toEqual([['task:t1', false], ['task:t3', true], ['todo:d1', false]])
    expect(data.canAddMit).toBe(false)
  })

  test('notes edited today exclude task files; otherwise the latest notes fill in', () => {
    const today = build({ notes: [note('n1', `${TODAY}T10:00:00+01:00`), note('t', `${TODAY}T11:00:00+01:00`, { note_type: 'task' }), note('old', '2026-11-12T10:00:00+01:00')] })
    expect(today.notesToday.map((item) => item.title)).toEqual(['Notiz n1'])
    expect(today.recentNotes).toEqual([])
    const quiet = build({ notes: [note('old', '2026-11-12T10:00:00+01:00')] })
    expect(quiet.recentNotes.map((item) => item.title)).toEqual(['Notiz old'])
  })

  test('done today only counts recorded completion times', () => {
    const data = build({
      tasks: [task('done', { status: 'done', completed_at: `${TODAY}T07:00:00+01:00` }), task('legacy', { status: 'done', completed_at: null, updated_at: `${TODAY}T07:00:00+01:00` })],
      todos: [todo('legacy', { checked: true, completed_at: null })],
    })
    expect(data.stats.doneToday).toBe(1)
  })

  test('the sidebar search narrows all three columns', () => {
    const data = build({
      tasks: [task('a', { title: 'Angebot', due_date: TODAY }), task('b', { title: 'Bericht', due_date: TODAY })],
      todos: [todo('x', { raw_text: 'Angebot drucken' }), todo('y', { raw_text: 'Kaffee' })],
      notes: [note('n', `${TODAY}T10:00:00+01:00`, { title: 'Angebotsentwurf' })],
      query: 'angebot',
    })
    expect(data.tasksToday.map((item) => item.id)).toEqual(['a'])
    expect(data.todosToday.map((item) => item.id)).toEqual(['x'])
    expect(data.notesToday).toHaveLength(1)
  })
})

describe('focus labels', () => {
  test('dates read relative to today', () => {
    expect(toShortDayLabel(TODAY, TODAY)).toBe('heute')
    expect(toShortDayLabel('2026-11-19', TODAY)).toBe('morgen')
    expect(toShortDayLabel('2027-01-04', TODAY)).toBe('Mo. 04.01.2027')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  test('defer offers tomorrow, next Monday and one week', () => {
    expect(deferOptions(TODAY).map((option) => option.date)).toEqual(['2026-11-19', '2026-11-23', '2026-11-25'])
    expect(deferOptions('2026-11-23')[1].date).toBe('2026-11-30')
  })

  test('to-do markup reads as plain text', () => {
    expect(toPlainTodoText('Mit {tag:person/max-muster} über [[Messeplanung|die Messe]] und [Budget](./b.md) reden')).toBe('Mit #max-muster über die Messe und Budget reden')
  })
})

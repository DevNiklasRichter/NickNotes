import type { FocusDashboardFilters, SearchRow, TaskRow, TodoRow } from '../app/AppShared'
import { buildFocusContextHits, buildFocusDashboardData } from './focusDashboardModel'

type AssertContext = {
  name: string
}

function assert(condition: boolean, context: AssertContext, message: string): void {
  if (!condition) {
    throw new Error(`[${context.name}] ${message}`)
  }
}

function baseFilters(mode: FocusDashboardFilters['mode']): FocusDashboardFilters {
  return {
    query: '',
    sections: [],
    scope: 'today',
    mode,
    maxItems: 12,
  }
}

function makeTask(overrides: Partial<TaskRow> & Pick<TaskRow, 'id' | 'title'>): TaskRow {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status ?? 'open',
    priority: overrides.priority ?? 'medium',
    due_date: overrides.due_date ?? null,
    project_tag: overrides.project_tag ?? null,
    estimate_minutes: overrides.estimate_minutes ?? null,
    completed_at: overrides.completed_at ?? null,
    blocked_by_ids: overrides.blocked_by_ids ?? [],
    waiting_for: overrides.waiting_for ?? null,
    follow_up_date: overrides.follow_up_date ?? null,
    blocked_reason: overrides.blocked_reason ?? null,
    next_action_hint: overrides.next_action_hint ?? null,
    tags: overrides.tags ?? [],
    related: overrides.related ?? [],
    updated_at: overrides.updated_at ?? '2026-04-20T08:00:00',
    path: overrides.path ?? `/vault/tasks/open/${overrides.id}.md`,
  }
}

function makeTodo(id: string, rawText: string, updatedAt: string): TodoRow {
  return {
    id,
    note_id: `note_${id}`,
    note_title: 'Daily',
    note_path: '/vault/01_daily/2026-04-20.md',
    line_no: 1,
    block_ref: null,
    checked: false,
    raw_text: rawText,
    explicit_tags: [],
    inherited_tags: [],
    links: [],
    promoted: false,
    promoted_task_id: null,
    created_at: null,
    completed_at: null,
    updated_at: updatedAt,
  }
}

function makeNote(id: string, title: string, path: string, updatedAt: string): SearchRow {
  return {
    id,
    title,
    note_type: 'note',
    updated_at: updatedAt,
    path,
  }
}

export function runPhaseFFocusModelAssertions(): void {
  const todayIso = '2026-04-20'
  const tasks: TaskRow[] = [
    makeTask({
      id: 'tk_mit',
      title: 'MIT mit klarem Schritt',
      status: 'in_progress',
      priority: 'high',
      due_date: todayIso,
      estimate_minutes: 25,
      next_action_hint: 'Draft fertigstellen',
      tags: ['project:alpha'],
    }),
    makeTask({
      id: 'tk_blocked',
      title: 'Blockiertes Thema',
      status: 'open',
      priority: 'high',
      due_date: todayIso,
      estimate_minutes: 45,
      blocked_by_ids: ['tk_unknown'],
      next_action_hint: 'Warten',
    }),
    makeTask({
      id: 'tk_waiting',
      title: 'Wartet auf Rueckmeldung',
      status: 'open',
      priority: 'medium',
      due_date: todayIso,
      estimate_minutes: null,
      waiting_for: 'Team',
      follow_up_date: null,
    }),
    makeTask({
      id: 'tk_candidate',
      title: 'Kleiner Kandidat',
      status: 'open',
      priority: 'medium',
      due_date: todayIso,
      estimate_minutes: 15,
      next_action_hint: 'Kurz pruefen',
    }),
    makeTask({
      id: 'tk_big',
      title: 'Grosses Thema ohne Schritt',
      status: 'open',
      priority: 'medium',
      due_date: '2026-04-21',
      estimate_minutes: 240,
      next_action_hint: null,
    }),
  ]
  const todos: TodoRow[] = [makeTodo('td_1', 'Inbox Todo', '2026-04-20T09:00:00')]
  const data = buildFocusDashboardData({
    tasks,
    todos,
    notes: [],
    filters: baseFilters('execution'),
    todayIso,
    mitIds: ['task:tk_mit'],
    taskFeatureSettings: {
      advancedTaskHandling: true,
      taskTimeManagement: true,
    },
  })

  assert(data.capacityStatus === 'balanced' || data.capacityStatus === 'heavy' || data.capacityStatus === 'overloaded', { name: 'capacity' }, 'capacity status should consider estimates and uncertainty')
  assert(data.nextActionItems.length > 0, { name: 'next-action' }, 'next action list should not be empty')
  assert(data.nextActionItems[0]?.item.key === 'task:tk_mit', { name: 'next-action' }, 'MIT task with clear next action should be ranked first')
  assert(
    data.nextActionItems[0]?.reasons.some((reason) => reason === 'MIT' || reason === 'klarer Schritt'),
    { name: 'next-action-reasons' },
    'next action reasons should explain selection'
  )
  assert(data.suggestedMitItems.length > 0, { name: 'mit-suggestions' }, 'MIT suggestions should be available when less than 3 MITs are set')
  assert(
    data.suggestedMitItems.every((entry) => entry.item.key !== 'task:tk_blocked'),
    { name: 'mit-suggestions' },
    'blocked items should not dominate MIT suggestions'
  )
  assert(data.planningHints.focusWithoutEstimateCount >= 1, { name: 'planning-hints' }, 'focus without estimate hint should be reported')
  assert(data.planningHints.waitingWithoutFollowUpCount >= 1, { name: 'planning-hints' }, 'waiting without follow-up should be reported')
  assert(data.planningHints.unknownBlockerTaskCount >= 1, { name: 'planning-hints' }, 'unknown blockers should be reported')

  const simpleData = buildFocusDashboardData({
    tasks,
    todos,
    notes: [],
    filters: baseFilters('execution'),
    todayIso,
    mitIds: ['task:tk_mit'],
    taskFeatureSettings: {
      advancedTaskHandling: false,
      taskTimeManagement: false,
    },
  })
  assert(simpleData.blockedTaskCount === 0, { name: 'feature-toggle-blocked' }, 'blocked KPI should be hidden in simple task mode')
  assert(simpleData.waitingTaskCount === 0, { name: 'feature-toggle-waiting' }, 'waiting KPI should be hidden in simple task mode')
  assert(simpleData.nextActionItems.length === 0, { name: 'feature-toggle-next-action' }, 'next action selection should be disabled in simple task mode')
  assert(simpleData.todayEstimatedMinutes === 0, { name: 'feature-toggle-estimate' }, 'estimate KPIs should be disabled when time management is off')
  assert(
    simpleData.suggestedMitItems.every((entry) => entry.reasons.length === 0),
    { name: 'feature-toggle-mit-reasons' },
    'MIT reason badges should be hidden when advanced task handling is disabled'
  )

  const statsOverrideData = buildFocusDashboardData({
    tasks,
    todos,
    notes: [],
    filters: baseFilters('execution'),
    todayIso,
    mitIds: ['task:tk_mit'],
    focusStats: {
      overdueCount: 7,
      blockedCount: 4,
      waitingCount: 5,
      doneToday: 3,
      doneTodayTasks: 1,
      doneTodayTodos: 2,
      openTasksWithoutEstimateCount: 8,
      waitingWithoutFollowUpCount: 6,
      unknownBlockerTaskCount: 3,
      unknownBlockerReferenceCount: 4,
    },
    taskFeatureSettings: {
      advancedTaskHandling: true,
      taskTimeManagement: true,
    },
  })
  assert(statsOverrideData.blockedTaskCount === 4, { name: 'focus-stats-override' }, 'blocked task count should be sourced from backend stats when provided')
  assert(statsOverrideData.waitingTaskCount === 5, { name: 'focus-stats-override' }, 'waiting task count should be sourced from backend stats when provided')
  assert(statsOverrideData.doneToday === 3, { name: 'focus-stats-override' }, 'done today totals should be sourced from backend stats')
  assert(statsOverrideData.planningHints.waitingWithoutFollowUpCount === 6, { name: 'focus-stats-override' }, 'planning hints should use backend stats when provided')

  const contextTask: TaskRow = makeTask({
    id: 'tk_context_generic',
    title: 'Task Integration Overview',
    status: 'open',
    priority: 'medium',
    due_date: todayIso,
    updated_at: `${todayIso}T10:00:00`,
  })
  const contextNotes: SearchRow[] = [
    makeNote('n_generic', 'Task Overview', '/vault/notes/task-overview.md', `${todayIso}T12:00:00`),
    makeNote('n_specific', 'Integration Plan', '/vault/notes/integration-plan.md', `${todayIso}T11:00:00`),
  ]
  const contextData = buildFocusDashboardData({
    tasks: [contextTask],
    todos: [],
    notes: contextNotes,
    filters: baseFilters('execution'),
    todayIso,
    mitIds: [],
    taskFeatureSettings: {
      advancedTaskHandling: true,
      taskTimeManagement: false,
    },
  })
  const contextItem = contextData.focusItems[0]
  assert(Boolean(contextItem), { name: 'context-stopwords' }, 'context test item should exist')
  if (contextItem) {
    const contextHits = buildFocusContextHits(contextItem, contextNotes, todayIso)
    assert(
      contextHits.some((hit) => hit.path.endsWith('/integration-plan.md')),
      { name: 'context-stopwords' },
      'specific context words should still match'
    )
    assert(
      !contextHits.some((hit) => hit.path.endsWith('/task-overview.md')),
      { name: 'context-stopwords' },
      'generic words should not create context matches'
    )
  }
}

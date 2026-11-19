import { describe, expect, it } from 'vitest'
import {
  adjustTimer,
  breakMinutesFor,
  elapsedMs,
  finishPhase,
  focusedMinutes,
  formatClock,
  pauseTimer,
  remainingMs,
  resumeTimer,
  startBreak,
  startFocusTimer,
  toOffsetTimestamp,
  toSessionLog,
  type FocusTimerTarget,
} from './focusTimerModel'

const MINUTE = 60_000
const start = new Date(2026, 10, 19, 9, 30, 0).getTime()
const task: FocusTimerTarget = { kind: 'task', id: 'tk_1', title: 'Angebot schreiben', path: 'tasks/open/tk_1.md' }

describe('focus timer', () => {
  it('counts down from wall-clock time and stops counting while paused', () => {
    const timer = startFocusTimer(task, 25, start)
    expect(remainingMs(timer, start + 10 * MINUTE)).toBe(15 * MINUTE)
    const paused = pauseTimer(timer, start + 10 * MINUTE)
    expect(remainingMs(paused, start + 40 * MINUTE)).toBe(15 * MINUTE)
    const resumed = resumeTimer(paused, start + 40 * MINUTE)
    expect(remainingMs(resumed, start + 45 * MINUTE)).toBe(10 * MINUTE)
    expect(focusedMinutes(resumed, start + 45 * MINUTE)).toBe(15)
  })

  it('never runs past the planned length', () => {
    const timer = startFocusTimer(task, 25, start)
    expect(elapsedMs(timer, start + 90 * MINUTE)).toBe(25 * MINUTE)
    expect(remainingMs(timer, start + 90 * MINUTE)).toBe(0)
  })

  it('adjusts the length but always keeps a minute left', () => {
    const timer = startFocusTimer(task, 25, start)
    expect(adjustTimer(timer, 5, start).plannedMs).toBe(30 * MINUTE)
    expect(adjustTimer(timer, -5, start).plannedMs).toBe(20 * MINUTE)
    expect(adjustTimer(timer, -5, start + 22 * MINUTE).plannedMs).toBe(23 * MINUTE)
    expect(adjustTimer(startFocusTimer(task, 180, start), 5, start).plannedMs).toBe(180 * MINUTE)
  })

  it('suggests a short break after a round and a longer one after long rounds', () => {
    expect(breakMinutesFor(25)).toBe(5)
    expect(breakMinutesFor(50)).toBe(10)
    const pause = startBreak(finishPhase(startFocusTimer(task, 50, start)), start + 50 * MINUTE)
    expect(pause.phase).toBe('break')
    expect(pause.plannedMs).toBe(10 * MINUTE)
    expect(remainingMs(pause, start + 50 * MINUTE)).toBe(10 * MINUTE)
  })

  it('formats the clock', () => {
    expect(formatClock(25 * MINUTE)).toBe('25:00')
    expect(formatClock(59_001)).toBe('01:00')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65 * MINUTE)).toBe('1:05:00')
  })

  it('writes timestamps with the local offset', () => {
    expect(toOffsetTimestamp(start)).toMatch(/^2026-11-19T09:30:00[+-]\d{2}:\d{2}$/)
  })

  it('logs a focus round with its task once and ignores breaks and short rounds', () => {
    const finished = finishPhase(startFocusTimer(task, 25, start))
    const entry = toSessionLog(finished, start + 27 * MINUTE)
    expect(entry).toMatchObject({ date: '2026-11-19', minutes: 25, label: 'Angebot schreiben', taskId: 'tk_1' })
    expect(entry?.todoId).toBeUndefined()
    expect(entry?.startedAt.slice(0, 19)).toBe('2026-11-19T09:30:00')
    expect(entry?.endedAt.slice(0, 19)).toBe('2026-11-19T09:57:00')
    expect(toSessionLog({ ...finished, logged: true }, start + 27 * MINUTE)).toBeNull()
    expect(toSessionLog(startFocusTimer(task, 25, start), start + 40_000)).toBeNull()
    expect(toSessionLog(startBreak(finished, start), start + 5 * MINUTE)).toBeNull()

    const todo = toSessionLog(startFocusTimer({ kind: 'todo', id: 'td_1', title: 'Folien kürzen', path: 'daily/x.md' }, 25, start), start + 12 * MINUTE)
    expect(todo).toMatchObject({ minutes: 12, todoId: 'td_1' })
    const free = toSessionLog(startFocusTimer({ kind: 'free', id: '', title: '  ', path: '' }, 25, start), start + 3 * MINUTE)
    expect(free).toMatchObject({ minutes: 3, label: '' })
    expect(free?.taskId).toBeUndefined()
  })
})

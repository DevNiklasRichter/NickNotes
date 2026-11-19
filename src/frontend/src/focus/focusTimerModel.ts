/** Focus timer ("Fokuszeit"): one countdown for the whole app, computed from wall-clock timestamps. */

export type FocusTimerTarget = {
  kind: 'task' | 'todo' | 'free'
  /** Task or to-do id; empty for a free timer. */
  id: string
  title: string
  /** File that holds the task or to-do; empty for a free timer. */
  path: string
  /** Next step of a task, shown under the title. */
  detail?: string
}

export type FocusTimerPhase = 'focus' | 'break'

export type FocusTimer = {
  phase: FocusTimerPhase
  target: FocusTimerTarget
  /** Planned length of the current phase. */
  plannedMs: number
  /** Wall-clock start of the current phase (ms). */
  startedAt: number
  /** Running since (ms); null while paused or finished. */
  runningSince: number | null
  /** Time counted before `runningSince`. */
  elapsedMs: number
  /** The phase ran out and waits for the next step. */
  finished: boolean
  /** The focus round was written to the daily note. */
  logged: boolean
  /** Full view instead of the small display in the status bar. */
  expanded: boolean
}

export type FocusSessionLog = {
  date: string
  startedAt: string
  endedAt: string
  minutes: number
  label: string
  taskId?: string
  todoId?: string
}

const MINUTE = 60_000
export const FOCUS_PRESET_MINUTES = [15, 25, 50] as const
export const DEFAULT_FOCUS_MINUTES = 25
export const MIN_FOCUS_MINUTES = 1
export const MAX_FOCUS_MINUTES = 180
export const FOCUS_ADJUST_MINUTES = 5

export function clampFocusMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FOCUS_MINUTES
  return Math.min(MAX_FOCUS_MINUTES, Math.max(MIN_FOCUS_MINUTES, Math.round(value)))
}

/** Short break after a round: five minutes, ten after long rounds. */
export function breakMinutesFor(focusMinutes: number): number {
  return focusMinutes > 30 ? 10 : 5
}

export function startFocusTimer(target: FocusTimerTarget, minutes: number, now: number): FocusTimer {
  return {
    phase: 'focus',
    target,
    plannedMs: clampFocusMinutes(minutes) * MINUTE,
    startedAt: now,
    runningSince: now,
    elapsedMs: 0,
    finished: false,
    logged: false,
    expanded: true,
  }
}

export function startBreak(timer: FocusTimer, now: number): FocusTimer {
  return {
    ...timer,
    phase: 'break',
    plannedMs: breakMinutesFor(Math.round(timer.plannedMs / MINUTE)) * MINUTE,
    startedAt: now,
    runningSince: now,
    elapsedMs: 0,
    finished: false,
  }
}

export function elapsedMs(timer: FocusTimer, now: number): number {
  const running = timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince)
  return Math.min(timer.plannedMs, timer.elapsedMs + running)
}

export function remainingMs(timer: FocusTimer, now: number): number {
  return Math.max(0, timer.plannedMs - elapsedMs(timer, now))
}

export function isRunning(timer: FocusTimer): boolean {
  return timer.runningSince !== null && !timer.finished
}

export function pauseTimer(timer: FocusTimer, now: number): FocusTimer {
  if (!isRunning(timer)) return timer
  return { ...timer, elapsedMs: elapsedMs(timer, now), runningSince: null }
}

export function resumeTimer(timer: FocusTimer, now: number): FocusTimer {
  if (timer.finished || timer.runningSince !== null) return timer
  return { ...timer, runningSince: now }
}

export function finishPhase(timer: FocusTimer): FocusTimer {
  return { ...timer, elapsedMs: timer.plannedMs, runningSince: null, finished: true }
}

/** Lengthen or shorten the running phase; at least one minute stays left. */
export function adjustTimer(timer: FocusTimer, deltaMinutes: number, now: number): FocusTimer {
  if (timer.finished) return timer
  const elapsed = elapsedMs(timer, now)
  const minimum = Math.max(MIN_FOCUS_MINUTES * MINUTE, elapsed + MINUTE)
  const plannedMs = Math.min(MAX_FOCUS_MINUTES * MINUTE, Math.max(minimum, timer.plannedMs + deltaMinutes * MINUTE))
  return { ...timer, plannedMs }
}

/** Whole minutes spent in the focus phase; pauses do not count. */
export function focusedMinutes(timer: FocusTimer, now: number): number {
  if (timer.phase !== 'focus') return 0
  return Math.floor(elapsedMs(timer, now) / MINUTE + 0.001)
}

/** "24:59", or "1:05:00" from one hour on. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

function pad(value: number): string {
  return String(Math.abs(value)).padStart(2, '0')
}

/** Local time with offset, e.g. 2026-11-19T09:30:00+01:00. */
export function toOffsetTimestamp(ms: number): string {
  const date = new Date(ms)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
}

/** Entry for the daily note, or null when less than a minute of focus was spent or it is logged already. */
export function toSessionLog(timer: FocusTimer, now: number): FocusSessionLog | null {
  if (timer.phase !== 'focus' || timer.logged) return null
  const minutes = focusedMinutes(timer, now)
  if (minutes < 1) return null
  const endedAt = timer.finished ? Math.max(timer.startedAt, now) : now
  const started = toOffsetTimestamp(timer.startedAt)
  return {
    date: started.slice(0, 10),
    startedAt: started,
    endedAt: toOffsetTimestamp(endedAt),
    minutes,
    label: timer.target.title.trim(),
    ...(timer.target.kind === 'task' && timer.target.id ? { taskId: timer.target.id } : {}),
    ...(timer.target.kind === 'todo' && timer.target.id ? { todoId: timer.target.id } : {}),
  }
}

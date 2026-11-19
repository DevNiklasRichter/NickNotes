import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import {
  adjustTimer,
  clampFocusMinutes,
  DEFAULT_FOCUS_MINUTES,
  finishPhase,
  isRunning,
  pauseTimer,
  remainingMs,
  resumeTimer,
  startBreak as startBreakPhase,
  startFocusTimer,
  toSessionLog,
  type FocusSessionLog,
  type FocusTimer,
  type FocusTimerTarget,
} from './focusTimerModel'

const LAST_MINUTES_KEY = 'nicknotes.focusTimer.minutes'

export type FocusTimerControls = {
  timer: FocusTimer | null
  lastMinutes: number
  logError: string
  start: (target: FocusTimerTarget, minutes?: number) => void
  pause: () => void
  resume: () => void
  adjust: (deltaMinutes: number) => void
  startBreak: () => void
  nextRound: () => void
  /** End the timer; a focus round of at least one minute is written to the daily note first. */
  stop: () => void
  setExpanded: (expanded: boolean) => void
  setLabel: (label: string) => void
}

type ScopedTimer = { scope: string; timer: FocusTimer | null }

function readLastMinutes(): number {
  try {
    const stored = Number(window.localStorage.getItem(LAST_MINUTES_KEY))
    return stored > 0 ? clampFocusMinutes(stored) : DEFAULT_FOCUS_MINUTES
  } catch {
    return DEFAULT_FOCUS_MINUTES
  }
}

function storeLastMinutes(minutes: number): void {
  try {
    window.localStorage.setItem(LAST_MINUTES_KEY, String(minutes))
  } catch {
    // Device-local convenience only.
  }
}

/** A short, quiet two-tone chime. */
function playChime(): void {
  try {
    const context = new AudioContext()
    const tones: Array<[number, number]> = [[660, 0], [880, 0.22]]
    for (const [frequency, offset] of tones) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const start = context.currentTime + offset
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.95)
    }
    window.setTimeout(() => void context.close(), 1600)
  } catch {
    // Sound is optional.
  }
}

/** Windows notification, only when NickNotes is not in front. */
function notify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    const show = () => {
      const notification = new Notification(title, { body, silent: true })
      notification.onclick = () => window.focus()
    }
    if (Notification.permission === 'granted') show()
    else if (Notification.permission !== 'denied') void Notification.requestPermission().then((permission) => { if (permission === 'granted') show() })
  } catch {
    // Notifications are optional.
  }
}

/**
 * One focus timer for the whole app. Time comes from timestamps, so a throttled or hidden window
 * does not drift; finished focus rounds go to the daily note through `onLog`. A timer belongs to
 * the NoteBase (`resetKey`) it was started in and disappears when another one is opened.
 */
export function useFocusTimer({ onLog, resetKey }: { onLog: (entry: FocusSessionLog) => Promise<void>; resetKey: string }): FocusTimerControls {
  const [state, setState] = useState<ScopedTimer>({ scope: resetKey, timer: null })
  const [lastMinutes, setLastMinutes] = useState(readLastMinutes)
  const [logError, setLogError] = useState('')
  const stateRef = useRef<ScopedTimer>(state)
  const onLogRef = useRef(onLog)
  useLayoutEffect(() => {
    onLogRef.current = onLog
  })
  const timer = state.scope === resetKey ? state.timer : null

  const current = (): FocusTimer | null => (stateRef.current.scope === resetKey ? stateRef.current.timer : null)
  const commit = (next: FocusTimer | null) => {
    const value = { scope: resetKey, timer: next }
    stateRef.current = value
    setState(value)
  }
  const update = (next: (timer: FocusTimer) => FocusTimer) => {
    const value = current()
    if (value) commit(next(value))
  }

  /** Writes a focus round once; the timer is marked first so a later step cannot log it twice. */
  const logRound = (value: FocusTimer, now: number): FocusTimer => {
    const entry = toSessionLog(value, now)
    if (!entry) return value
    setLogError('')
    onLogRef.current(entry).catch((error: unknown) => {
      setLogError(error instanceof Error && error.message.trim() ? error.message : 'Die Fokuszeit konnte nicht in die Tagesnotiz geschrieben werden.')
    })
    return { ...value, logged: true }
  }

  const rememberMinutes = (minutes: number) => {
    const clean = clampFocusMinutes(minutes)
    setLastMinutes(clean)
    storeLastMinutes(clean)
  }

  const endPhase = useEffectEvent(() => {
    const latest = current()
    const now = Date.now()
    // The planned length may have changed meanwhile; the effect re-arms with the new values.
    if (!latest || !isRunning(latest) || remainingMs(latest, now) > 50) return
    let finished: FocusTimer = { ...finishPhase(latest), expanded: true }
    if (latest.phase === 'focus') {
      finished = logRound(finished, now)
      rememberMinutes(Math.round(latest.plannedMs / 60_000))
      notify('Fokuszeit vorbei', latest.target.title ? `${latest.target.title} – Zeit für eine kurze Pause.` : 'Zeit für eine kurze Pause.')
    } else {
      notify('Pause vorbei', 'Bereit für die nächste Runde?')
    }
    playChime()
    commit(finished)
  })

  const running = timer ? isRunning(timer) : false
  const plannedMs = timer?.plannedMs ?? 0
  const runningSince = timer?.runningSince ?? null
  const elapsedBefore = timer?.elapsedMs ?? 0
  useEffect(() => {
    if (!running || runningSince === null) return
    const left = plannedMs - elapsedBefore - Math.max(0, Date.now() - runningSince)
    const handle = window.setTimeout(endPhase, Math.max(0, left))
    return () => window.clearTimeout(handle)
  }, [running, plannedMs, runningSince, elapsedBefore])

  const start = (target: FocusTimerTarget, minutes?: number) => {
    const now = Date.now()
    const previous = current()
    if (previous) logRound(previous, now)
    const length = clampFocusMinutes(minutes ?? lastMinutes)
    if (minutes !== undefined) rememberMinutes(length)
    setLogError('')
    commit(startFocusTimer(target, length, now))
  }

  return {
    timer,
    lastMinutes,
    logError,
    start,
    stop: () => {
      const value = current()
      if (value) logRound(value, Date.now())
      commit(null)
    },
    pause: () => update((value) => pauseTimer(value, Date.now())),
    resume: () => update((value) => resumeTimer(value, Date.now())),
    adjust: (deltaMinutes) => update((value) => adjustTimer(value, deltaMinutes, Date.now())),
    startBreak: () => update((value) => startBreakPhase(logRound(value, Date.now()), Date.now())),
    nextRound: () => {
      const value = current()
      if (value) start(value.target, lastMinutes)
    },
    setExpanded: (expanded) => update((value) => ({ ...value, expanded })),
    setLabel: (label) => update((value) => (value.target.kind === 'free' ? { ...value, target: { ...value.target, title: label } } : value)),
  }
}

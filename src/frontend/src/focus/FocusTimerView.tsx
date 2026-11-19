import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { trapDialogTab, useDialogFocus } from '../ui/useDialogFocus'
import {
  breakMinutesFor,
  elapsedMs,
  FOCUS_ADJUST_MINUTES,
  formatClock,
  isRunning,
  remainingMs,
  type FocusTimer,
  type FocusTimerTarget,
} from './focusTimerModel'
import type { FocusTimerControls } from './useFocusTimer'
import './FocusTimerView.css'

/** Current time, refreshed while the timer runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const handle = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(handle)
  }, [active])
  // Paused and finished timers do not depend on the clock.
  return now
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function phaseLabel(timer: FocusTimer): string {
  if (timer.phase === 'break') return timer.finished ? 'Pause vorbei' : 'Pause'
  return timer.finished ? 'Fokuszeit vorbei' : 'Fokuszeit'
}

type FocusTimerOverlayProps = {
  controls: FocusTimerControls
  onCaptureThought: (text: string) => Promise<void>
  onComplete: (target: FocusTimerTarget) => Promise<void>
}

/** Full view of the running focus timer with the task underneath. */
export function FocusTimerOverlay({ controls, onCaptureThought, onComplete }: FocusTimerOverlayProps) {
  const timer = controls.timer!
  const root = useDialogFocus()
  const now = useNow(isRunning(timer))
  const [thought, setThought] = useState('')
  const [thoughtBusy, setThoughtBusy] = useState(false)
  const [thoughtStatus, setThoughtStatus] = useState('')
  const [completeBusy, setCompleteBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [actionError, setActionError] = useState('')

  const remaining = remainingMs(timer, now)
  const progress = timer.plannedMs > 0 ? Math.min(1, elapsedMs(timer, now) / timer.plannedMs) : 0
  const plannedMinutes = Math.round(timer.plannedMs / 60_000)
  const paused = !timer.finished && timer.runningSince === null
  const { target } = timer

  const minimize = () => controls.setExpanded(false)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      minimize()
      return
    }
    trapDialogTab(event)
  }

  const submitThought = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = thought.trim()
    if (!clean || thoughtBusy) return
    setThoughtBusy(true)
    setThoughtStatus('')
    try {
      await onCaptureThought(clean)
      setThought('')
      setThoughtStatus('Notiert – steht als To-do in der heutigen Tagesnotiz.')
    } catch (error) {
      setThoughtStatus(errorText(error, 'Der Gedanke konnte nicht gespeichert werden.'))
    } finally {
      setThoughtBusy(false)
    }
  }

  const complete = async () => {
    if (completeBusy) return
    setCompleteBusy(true)
    setActionError('')
    try {
      await onComplete(target)
      setCompleted(true)
    } catch (error) {
      setActionError(errorText(error, target.kind === 'task' ? 'Die Task konnte nicht erledigt werden.' : 'Das To-do konnte nicht abgehakt werden.'))
    } finally {
      setCompleteBusy(false)
    }
  }

  const finishedNote = timer.phase === 'focus'
    ? (timer.logged ? `${plannedMinutes} min in der Tagesnotiz festgehalten.` : '')
    : 'Bereit für die nächste Runde?'

  return (
    <div className="focus-timer-overlay" ref={root} role="dialog" aria-modal="true" aria-labelledby="focus-timer-phase" onKeyDown={onKeyDown}>
      <header className="focus-timer-top">
        <span id="focus-timer-phase" className="focus-timer-phase">{phaseLabel(timer)}</span>
        <button type="button" className="icon-button compact muted" aria-label="Verkleinern (Esc)" data-tooltip="Verkleinern (Esc)" onClick={minimize}>
          <LucideNamedIcon name="Minimize2" size={15} />
        </button>
      </header>

      <div className="focus-timer-center">
        <div className={`focus-timer-clock${paused ? ' paused' : ''}`} role="timer" aria-label={`Noch ${formatClock(remaining)}`}>{formatClock(remaining)}</div>
        <div className="focus-timer-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>

        {target.kind === 'free' ? (
          <input className="focus-timer-label" value={target.title} onChange={(event) => controls.setLabel(event.target.value)}
            placeholder="Woran arbeitest du? (optional)" aria-label="Woran arbeitest du?" maxLength={200} />
        ) : (
          <h2 className={`focus-timer-target${completed ? ' done' : ''}`}>{target.title}</h2>
        )}
        {target.detail && !timer.finished ? <p className="focus-timer-detail">{target.detail}</p> : null}

        {timer.finished ? (
          <>
            {finishedNote ? <p className="focus-timer-note" role="status">{finishedNote}</p> : null}
            <div className="focus-timer-actions">
              {timer.phase === 'focus' ? (
                <button type="button" className="primary" onClick={controls.startBreak}>
                  <LucideNamedIcon name="Coffee" size={14} />Pause · {breakMinutesFor(plannedMinutes)} min
                </button>
              ) : null}
              <button type="button" className={timer.phase === 'break' ? 'primary' : ''} onClick={controls.nextRound}>
                <LucideNamedIcon name="Play" size={14} />{timer.phase === 'break' ? `Nächste Runde · ${controls.lastMinutes} min` : 'Noch eine Runde'}
              </button>
              {target.kind !== 'free' && timer.phase === 'focus' ? (
                <button type="button" onClick={() => void complete()} disabled={completeBusy || completed}>
                  <LucideNamedIcon name="Check" size={14} />{completed ? 'Erledigt' : target.kind === 'task' ? 'Task erledigt' : 'To-do abhaken'}
                </button>
              ) : null}
              <button type="button" onClick={controls.stop}>Schließen</button>
            </div>
          </>
        ) : (
          <div className="focus-timer-actions">
            {paused ? (
              <button type="button" className="primary" onClick={controls.resume}><LucideNamedIcon name="Play" size={14} />Fortsetzen</button>
            ) : (
              <button type="button" className="primary" onClick={controls.pause}><LucideNamedIcon name="Pause" size={14} />Anhalten</button>
            )}
            <button type="button" onClick={() => controls.adjust(-FOCUS_ADJUST_MINUTES)} aria-label={`${FOCUS_ADJUST_MINUTES} Minuten weniger`}>−{FOCUS_ADJUST_MINUTES} min</button>
            <button type="button" onClick={() => controls.adjust(FOCUS_ADJUST_MINUTES)} aria-label={`${FOCUS_ADJUST_MINUTES} Minuten mehr`}>+{FOCUS_ADJUST_MINUTES} min</button>
            {timer.phase === 'break' ? (
              <>
                <button type="button" onClick={controls.nextRound}>Pause überspringen</button>
                <button type="button" onClick={controls.stop}>Beenden</button>
              </>
            ) : (
              <button type="button" onClick={controls.stop} data-tooltip="Beendet die Fokuszeit; ab einer Minute wird sie in der Tagesnotiz festgehalten.">Beenden</button>
            )}
          </div>
        )}
        {controls.logError ? <p className="focus-inline-error" role="alert">{controls.logError}</p> : null}
        {actionError ? <p className="focus-inline-error" role="alert">{actionError}</p> : null}
      </div>

      {timer.phase === 'focus' && !timer.finished ? (
        <div className="focus-timer-thought-area">
          <form className="focus-timer-thought" onSubmit={(event) => void submitThought(event)}>
            <LucideNamedIcon name="Plus" size={14} aria-hidden="true" />
            <input value={thought} onChange={(event) => { setThought(event.target.value); setThoughtStatus('') }} disabled={thoughtBusy}
              placeholder="Gedanke für später … (Eingabe notiert ihn als To-do)" aria-label="Gedanke für später notieren" />
          </form>
          <p className="focus-timer-thought-status" role="status">{thoughtStatus}</p>
        </div>
      ) : null}
    </div>
  )
}

/** Small display in the status bar while the full view is minimized. */
export function FocusTimerStatus({ controls }: { controls: FocusTimerControls }) {
  const timer = controls.timer
  const now = useNow(Boolean(timer && isRunning(timer)))
  if (!timer || timer.expanded) return null
  const paused = !timer.finished && timer.runningSince === null
  const label = timer.finished ? phaseLabel(timer) : `${timer.phase === 'break' ? 'Pause' : 'Fokus'} ${formatClock(remainingMs(timer, now))}${paused ? ' (angehalten)' : ''}`
  const title = timer.target.title.trim()
  return (
    <button type="button" className={`status-item focus-timer-status${timer.finished ? ' finished' : ''}`} onClick={() => controls.setExpanded(true)}
      data-tooltip={title ? `${title} – Fokuszeit groß anzeigen` : 'Fokuszeit groß anzeigen'}>
      <LucideNamedIcon name="Timer" size={12} />
      <span>{label}</span>
    </button>
  )
}

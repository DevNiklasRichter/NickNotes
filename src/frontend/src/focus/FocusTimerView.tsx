import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { commandTitle } from '../app/commands'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import { ContextMenuItem } from '../ui/ContextMenu'
import { MenuButton } from '../ui/MenuButton'
import { trapDialogTab, useDialogFocus } from '../ui/useDialogFocus'
import {
  breakMinutesFor,
  elapsedMs,
  FOCUS_ADJUST_MINUTES,
  FOCUS_PRESET_MINUTES,
  formatClock,
  isRunning,
  remainingMs,
  type FocusTimer,
  type FocusTimerTarget,
} from './focusTimerModel'
import type { FocusTimerControls } from './useFocusTimer'
import './FocusTimerView.css'

/** Where a thought from the focus view is written. */
export type FocusThoughtTarget = 'task' | 'daily'

const MINI_OFFSET_KEY = 'nicknotes.focusTimer.miniOffset'

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

/** Pause, ±5 minutes and end: the same controls in the full view and the small window. */
function RunningControls({ timer, controls, compact = false }: { timer: FocusTimer; controls: FocusTimerControls; compact?: boolean }) {
  const paused = timer.runningSince === null
  const iconSize = compact ? 13 : 14
  return (
    <div className={`focus-timer-actions${compact ? ' compact' : ''}`}>
      {paused ? (
        <button type="button" className="primary" onClick={controls.resume} aria-label="Fortsetzen" data-tooltip={compact ? 'Fortsetzen' : undefined}>
          <LucideNamedIcon name="Play" size={iconSize} />{compact ? null : 'Fortsetzen'}
        </button>
      ) : (
        <button type="button" className="primary" onClick={controls.pause} aria-label="Anhalten" data-tooltip={compact ? 'Anhalten' : undefined}>
          <LucideNamedIcon name="Pause" size={iconSize} />{compact ? null : 'Anhalten'}
        </button>
      )}
      <button type="button" onClick={() => controls.adjust(-FOCUS_ADJUST_MINUTES)} aria-label={`${FOCUS_ADJUST_MINUTES} Minuten weniger`}>−{FOCUS_ADJUST_MINUTES}{compact ? '' : ' min'}</button>
      <button type="button" onClick={() => controls.adjust(FOCUS_ADJUST_MINUTES)} aria-label={`${FOCUS_ADJUST_MINUTES} Minuten mehr`}>+{FOCUS_ADJUST_MINUTES}{compact ? '' : ' min'}</button>
      {timer.phase === 'break' && !compact ? <button type="button" onClick={controls.nextRound}>Pause überspringen</button> : null}
      <button type="button" onClick={controls.stop}
        data-tooltip={timer.phase === 'focus' ? 'Beendet die Fokuszeit; ab einer Minute wird sie in der Tagesnotiz festgehalten.' : undefined}>
        Beenden
      </button>
    </div>
  )
}

type FocusTimerOverlayProps = {
  controls: FocusTimerControls
  onSaveThought: (text: string, target: FocusThoughtTarget) => Promise<void>
  onComplete: (target: FocusTimerTarget) => Promise<void>
}

/** Full view of the running focus timer with the task underneath. */
export function FocusTimerOverlay({ controls, onSaveThought, onComplete }: FocusTimerOverlayProps) {
  const timer = controls.timer!
  const root = useDialogFocus()
  const now = useNow(isRunning(timer))
  const [thought, setThought] = useState('')
  const [thoughtBusy, setThoughtBusy] = useState(false)
  const [thoughtStatus, setThoughtStatus] = useState('')
  const [thoughtTarget, setThoughtTarget] = useState<FocusThoughtTarget>('task')
  const [completeBusy, setCompleteBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [actionError, setActionError] = useState('')

  const remaining = remainingMs(timer, now)
  const progress = timer.plannedMs > 0 ? Math.min(1, elapsedMs(timer, now) / timer.plannedMs) : 0
  const plannedMinutes = Math.round(timer.plannedMs / 60_000)
  const paused = !timer.finished && timer.runningSince === null
  const { target } = timer
  // Only a task has a file of its own; everything else goes to the daily note.
  const destination: FocusThoughtTarget = target.kind === 'task' ? thoughtTarget : 'daily'

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
      await onSaveThought(clean, destination)
      setThought('')
      setThoughtStatus(destination === 'task' ? 'In der Task festgehalten.' : 'In der Tagesnotiz festgehalten.')
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
          <RunningControls timer={timer} controls={controls} />
        )}
        {controls.logError ? <p className="focus-inline-error" role="alert">{controls.logError}</p> : null}
        {actionError ? <p className="focus-inline-error" role="alert">{actionError}</p> : null}
      </div>

      {timer.phase === 'focus' && !timer.finished ? (
        <div className="focus-timer-thought-area">
          <form className="focus-timer-thought" onSubmit={(event) => void submitThought(event)}>
            <LucideNamedIcon name="Plus" size={14} aria-hidden="true" />
            <input value={thought} onChange={(event) => { setThought(event.target.value); setThoughtStatus('') }} disabled={thoughtBusy}
              placeholder={destination === 'task' ? 'Gedanke festhalten … (Eingabe speichert ihn in der Task)' : 'Gedanke festhalten … (Eingabe speichert ihn in der Tagesnotiz)'}
              aria-label="Gedanke festhalten" />
            {target.kind === 'task' ? (
              <span className="focus-timer-thought-target" role="group" aria-label="Gedanke speichern in">
                <button type="button" aria-pressed={thoughtTarget === 'task'} onClick={() => setThoughtTarget('task')}
                  data-tooltip="Gehört zur Task und wird in ihrer Datei gespeichert">Task</button>
                <button type="button" aria-pressed={thoughtTarget === 'daily'} onClick={() => setThoughtTarget('daily')}
                  data-tooltip="Allgemeiner Gedanke für die heutige Tagesnotiz">Tagesnotiz</button>
              </span>
            ) : null}
          </form>
          <p className="focus-timer-thought-status" role="status">{thoughtStatus}</p>
        </div>
      ) : null}
    </div>
  )
}

type Offset = { x: number; y: number }

function readMiniOffset(): Offset {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MINI_OFFSET_KEY) || 'null') as Offset | null
    if (!stored || !Number.isFinite(stored.x) || !Number.isFinite(stored.y)) return { x: 0, y: 0 }
    // The window may have shrunk since; the panel stays reachable.
    return {
      x: Math.min(0, Math.max(stored.x, -(window.innerWidth - 280))),
      y: Math.min(0, Math.max(stored.y, -(window.innerHeight - 220))),
    }
  } catch {
    return { x: 0, y: 0 }
  }
}

function storeMiniOffset(offset: Offset): void {
  try {
    window.localStorage.setItem(MINI_OFFSET_KEY, JSON.stringify(offset))
  } catch {
    // Device-local convenience only.
  }
}

/** Small floating window while the full view is minimized, so a running timer is never out of sight. */
export function FocusTimerMini({ controls }: { controls: FocusTimerControls }) {
  const timer = controls.timer!
  const now = useNow(isRunning(timer))
  const [offset, setOffset] = useState(readMiniOffset)
  const panel = useRef<HTMLElement>(null)
  const drag = useRef<{ startX: number; startY: number; base: Offset; min: Offset; max: Offset } | null>(null)
  const paused = !timer.finished && timer.runningSince === null
  const title = timer.target.title.trim()

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') || !panel.current) return
    const rect = panel.current.getBoundingClientRect()
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      base: offset,
      min: { x: offset.x - rect.left + 8, y: offset.y - rect.top + 40 },
      max: { x: offset.x + window.innerWidth - rect.right - 8, y: offset.y + window.innerHeight - rect.bottom - 8 },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    setOffset({
      x: Math.min(current.max.x, Math.max(current.min.x, current.base.x + event.clientX - current.startX)),
      y: Math.min(current.max.y, Math.max(current.min.y, current.base.y + event.clientY - current.startY)),
    })
  }
  const endDrag = () => {
    if (!drag.current) return
    drag.current = null
    storeMiniOffset(offset)
  }

  return (
    <aside ref={panel} className={`focus-timer-mini${timer.finished ? ' finished' : ''}`} aria-label="Fokuszeit"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
      <header className="focus-timer-mini-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        data-tooltip="Zum Verschieben ziehen">
        <span className="focus-timer-phase">{phaseLabel(timer)}{paused ? ' · angehalten' : ''}</span>
        <button type="button" className="icon-button compact muted" aria-label="Groß anzeigen" data-tooltip="Groß anzeigen" onClick={() => controls.setExpanded(true)}>
          <LucideNamedIcon name="Maximize2" size={13} />
        </button>
      </header>
      <div className={`focus-timer-mini-clock${paused ? ' paused' : ''}`} role="timer">{formatClock(remainingMs(timer, now))}</div>
      {title ? <div className="focus-timer-mini-title" title={title}>{title}</div> : null}
      {timer.finished ? (
        <div className="focus-timer-actions compact">
          <button type="button" className="primary" onClick={() => controls.setExpanded(true)}>Weiter</button>
          <button type="button" onClick={controls.stop}>Schließen</button>
        </div>
      ) : (
        <RunningControls timer={timer} controls={controls} compact />
      )}
    </aside>
  )
}

/** Toolbar entry above the editor: start with a length, or bring a running timer back. */
export function FocusTimerToolbarButton({ controls, onStartFree }: { controls: FocusTimerControls; onStartFree: (minutes: number) => void }) {
  const label = <><LucideNamedIcon name="Timer" size={14} /><span>Fokuszeit</span></>
  if (controls.timer) {
    return (
      <button type="button" className="workspace-writing-button active" aria-pressed="true" onClick={() => controls.setExpanded(true)}
        aria-label="Fokuszeit groß anzeigen" data-tooltip={commandTitle('focusTimer', 'Fokuszeit groß anzeigen')}>
        {label}
      </button>
    )
  }
  return (
    <MenuButton label={commandTitle('focusTimer')} heading="Fokuszeit" className="workspace-writing-button" icon={label}>
      {FOCUS_PRESET_MINUTES.map((minutes) => (
        <ContextMenuItem key={minutes} onClick={() => onStartFree(minutes)}>{minutes} Minuten</ContextMenuItem>
      ))}
    </MenuButton>
  )
}

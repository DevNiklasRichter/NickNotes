import {useEffectEvent, useLayoutEffect, useRef} from 'react'
import type {KeyboardEvent} from 'react'

function dialogControls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')]
    .filter(node => !node.matches(':disabled,[hidden],[tabindex="-1"]') && !node.closest('[inert]') && node.getClientRects().length > 0)
}

export function trapDialogTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return
  const controls = dialogControls(event.currentTarget)
  const first = controls[0], last = controls.at(-1)
  if (!first) {event.preventDefault(); event.currentTarget.focus(); return}
  if (!controls.includes(document.activeElement as HTMLElement)) {
    event.preventDefault(); (event.shiftKey ? last : first)?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus()
  }
}

/** Shared lifecycle for the top dialog, including busy forms and temporary overlays. */
export function useDialogFocus({active = true, busy = false, fallback}: {
  active?: boolean
  busy?: boolean
  fallback?: () => HTMLElement | null
} = {}) {
  const root = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<{trigger: HTMLElement | null; fallback: HTMLElement | null} | null>(null)
  const fallbackTarget = useEffectEvent(() => fallback?.() ?? null)
  const focusInside = useEffectEvent(() => {
    const dialog = root.current
    if (!dialog || !active) return
    const controls = dialogControls(dialog)
    const target = busy ? dialog : controls.find(node => node.matches('input,select,textarea')) ?? controls[0] ?? dialog
    target.focus({preventScroll: true})
  })
  useLayoutEffect(() => {
    const dialog = root.current
    if (!returnFocus.current) {
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnFocus.current = {trigger, fallback: trigger?.closest<HTMLElement>('.explorer-shell,[data-pane-id],.activity-rail') ?? null}
    }
    return () => {
      // Run after the outside pointer's native focus action as well as DOM removal.
      window.requestAnimationFrame(() => {
        if (!dialog || dialog.isConnected || document.activeElement !== document.body) return
        const saved = returnFocus.current
        const target = saved?.trigger?.isConnected ? saved.trigger : saved?.fallback?.isConnected ? saved.fallback : fallbackTarget()
        target?.focus({preventScroll: true})
      })
    }
  }, [])
  useLayoutEffect(() => {
    if (!active) return
    focusInside()
    const containFocus = (event: FocusEvent) => {
      const dialog = root.current
      if (!dialog || !(event.target instanceof HTMLElement) || dialog.contains(event.target)) return
      // A confirmation or native control may temporarily own the interaction.
      if (event.target.closest('[aria-modal="true"]')) return
      focusInside()
    }
    document.addEventListener('focusin', containFocus)
    return () => document.removeEventListener('focusin', containFocus)
  }, [active, busy])
  return root
}

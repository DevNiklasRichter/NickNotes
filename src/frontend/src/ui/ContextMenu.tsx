import {createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef} from 'react'
import type {ButtonHTMLAttributes, KeyboardEvent, ReactNode} from 'react'
import {createPortal} from 'react-dom'
import type {ContextMenuAnchor} from './contextMenuAnchor'
import './ContextMenu.css'

const MenuActivation = createContext<((action: () => void) => void) | null>(null)

const menuItemSelector = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'

export function ContextMenuItem({disabled, onClick, role = 'menuitem', className = '', children, ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const activate = useContext(MenuActivation)
  return <button {...props} type="button" role={role} tabIndex={-1}
    className={`context-menu-item ${className}`} aria-disabled={disabled || undefined}
    onClick={event => {
      if (disabled) {event.preventDefault(); event.stopPropagation(); return}
      if (activate) activate(() => onClick?.(event))
      else onClick?.(event)
    }}>
    {role === 'menuitemradio' ? <span className="context-menu-check" aria-hidden="true">
      {props['aria-checked'] === true ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4 10-10" /></svg> : null}
    </span> : null}
    {children}
  </button>
}

/** Flat action menu. Domain actions and their confirmation dialogs stay with the caller. */
export function ContextMenu({anchor, label, heading, initialFocus = 'first', triggerToggles = false, onClose, children}: {
  anchor: ContextMenuAnchor
  label: string
  heading?: string
  initialFocus?: 'first' | 'last'
  triggerToggles?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useEffectEvent(onClose)
  const restoreFocus = () => {
    const target = anchor.trigger.isConnected ? anchor.trigger : anchor.fallback
    target?.focus({preventScroll: true})
  }
  const dismiss = (restore: boolean) => {if (restore) restoreFocus(); onClose()}
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(menuItemSelector) ?? [])]
  const focusItem = (item?: HTMLButtonElement) => {
    item?.focus({preventScroll: true})
    item?.scrollIntoView({block: 'nearest'})
  }
  const activate = (action: () => void) => {
    // The item owns this call: restoring focus cannot unmount its pending handler.
    restoreFocus()
    onClose()
    action()
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) restoreFocus()
    })
  }

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const place = () => {
      const {width, height} = menu.getBoundingClientRect()
      const edge = 8
      menu.style.left = `${Math.max(edge, Math.min(anchor.x, window.innerWidth - width - edge))}px`
      menu.style.top = `${Math.max(edge, Math.min(anchor.y, window.innerHeight - height - edge))}px`
    }
    place()
    const entries = menu.querySelectorAll<HTMLElement>(menuItemSelector)
    entries[initialFocus === 'last' ? entries.length - 1 : 0]?.focus({preventScroll: true})
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    window.addEventListener('resize', place)
    return () => {observer.disconnect(); window.removeEventListener('resize', place)}
  }, [anchor, initialFocus])

  useEffect(() => {
    const outside = (event: Event) => {
      // Explicit menu buttons own their toggle, including the pointer/focus before click.
      if (triggerToggles && event.type !== 'wheel' && event.target instanceof Node && anchor.trigger.contains(event.target)) return
      if (event.target instanceof Node && !ref.current?.contains(event.target)) close()
    }
    const blur = () => close()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('wheel', outside, {capture: true, passive: true})
    document.addEventListener('focusin', outside)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('wheel', outside, true)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('blur', blur)
    }
  }, [anchor.trigger, triggerToggles])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const entries = items()
    const index = entries.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {event.preventDefault(); dismiss(true)}
    else if (event.key === 'Tab') {
      // Native tab navigation continues from the invoking control, outside the menu.
      dismiss(true)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
      focusItem(entries[next])
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const ordered = [...entries.slice(index + 1), ...entries.slice(0, index + 1)]
      const match = ordered.find(item => item.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
      if (match) {event.preventDefault(); focusItem(match)}
    }
  }

  return createPortal(<MenuActivation.Provider value={activate}><div ref={ref} role="menu" aria-label={label} className="nn-context-menu"
    style={{left: anchor.x, top: anchor.y}} onKeyDown={onKeyDown}
    onContextMenu={event => {event.preventDefault(); event.stopPropagation()}}
    onPointerMove={event => {
      if (!event.movementX && !event.movementY) return
      const item = (event.target as Element).closest<HTMLButtonElement>(menuItemSelector)
      if (item && ref.current?.contains(item)) item.focus({preventScroll: true})
    }}
    onClick={event => event.stopPropagation()}>
    {heading ? <div className="nn-context-menu-heading" aria-hidden="true">{heading}</div> : null}
    {children}</div></MenuActivation.Provider>, document.body)
}

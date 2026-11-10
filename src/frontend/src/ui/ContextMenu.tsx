import {createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef} from 'react'
import type {ButtonHTMLAttributes, KeyboardEvent, ReactNode} from 'react'
import {createPortal} from 'react-dom'
import type {ContextMenuAnchor} from './contextMenuAnchor'
import './ContextMenu.css'

const MenuActivation = createContext<((action: () => void) => void) | null>(null)

export function ContextMenuItem({disabled, onClick, className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const activate = useContext(MenuActivation)
  return <button {...props} type="button" role="menuitem" tabIndex={-1}
    className={`context-menu-item ${className}`} aria-disabled={disabled || undefined}
    onClick={event => {
      if (disabled) {event.preventDefault(); event.stopPropagation(); return}
      if (activate) activate(() => onClick?.(event))
      else onClick?.(event)
    }} />
}

/** Flat action menu. Domain actions and their confirmation dialogs stay with the caller. */
export function ContextMenu({anchor, label, onClose, children}: {
  anchor: ContextMenuAnchor
  label: string
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
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
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
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({preventScroll: true})
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    window.addEventListener('resize', place)
    return () => {observer.disconnect(); window.removeEventListener('resize', place)}
  }, [anchor])

  useEffect(() => {
    const outside = (event: Event) => {
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
  }, [])

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
      const item = (event.target as Element).closest<HTMLButtonElement>('[role="menuitem"]')
      if (item && ref.current?.contains(item)) item.focus({preventScroll: true})
    }}
    onClick={event => event.stopPropagation()}>{children}</div></MenuActivation.Provider>, document.body)
}

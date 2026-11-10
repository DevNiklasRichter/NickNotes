import {useState} from 'react'
import type {ReactNode, RefObject} from 'react'
import {ContextMenu} from './ContextMenu'
import {contextMenuAnchor, isContextMenuKey} from './contextMenuAnchor'
import type {ContextMenuAnchor} from './contextMenuAnchor'

/** Explicit trigger for the shared menu; domain actions remain with its caller. */
export function MenuButton({label, heading, icon, disabled, className = 'icon-button compact', fallbackRef, children}: {
  label: string
  heading?: string
  icon: ReactNode
  disabled?: boolean
  className?: string
  fallbackRef?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const [anchor, setAnchor] = useState<(ContextMenuAnchor & {focusLast?: boolean}) | null>(null)
  return <>
    <button type="button" className={`${className}${anchor ? ' active' : ''}`}
      disabled={disabled} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
      onClick={event => {
        event.stopPropagation()
        setAnchor(anchor ? null : contextMenuAnchor(event.currentTarget, fallbackRef?.current))
      }}
      onKeyDown={event => {
        if (!isContextMenuKey(event) && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        event.stopPropagation()
        setAnchor({...contextMenuAnchor(event.currentTarget, fallbackRef?.current), focusLast: event.key === 'ArrowUp'})
      }}
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
        setAnchor({...contextMenuAnchor(event.currentTarget, fallbackRef?.current), x: event.clientX, y: event.clientY})
      }}>
      {icon}
    </button>
    {anchor && !disabled ? <ContextMenu anchor={anchor} label={label} heading={heading}
      initialFocus={anchor.focusLast ? 'last' : 'first'} triggerToggles onClose={() => setAnchor(null)}>
      {children}
    </ContextMenu> : null}
  </>
}

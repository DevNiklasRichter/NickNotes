import type {KeyboardEvent} from 'react'

export type ContextMenuAnchor = {
  x: number
  y: number
  trigger: HTMLElement
  fallback?: HTMLElement | null
}

export function isContextMenuKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>) {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

export function contextMenuAnchor(trigger: HTMLElement, fallback?: HTMLElement | null): ContextMenuAnchor {
  const bounds = trigger.getBoundingClientRect()
  return {x: bounds.left, y: bounds.bottom, trigger, fallback}
}
